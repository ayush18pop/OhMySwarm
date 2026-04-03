/**
 * server/tools/spawnSubAgent.ts
 *
 * Implements the spawn_sub_agent tool:
 *   1. Check + atomically reserve session budget
 *   2. Create sub-agent DB record
 *   3. Emit AGENT_SPAWNED
 *   4. POST to sub-agent x402 endpoint (blocking)
 *   5. Deduct budget, emit PAYMENT_CONFIRMED
 *   6. Update agent DB record
 *   7. Return result to master agent
 */

import { v4 as uuidv4 } from "uuid";
import { prisma } from "../db";
import {
  reserveSessionBudget,
  deductAgentBudget,
  deriveVirtualAddress,
} from "../virtualWallet";
import { payX402 } from "../wallet";
import {
  emitAgentSpawned,
  emitAgentComplete,
  emitAgentFailed,
  emitPaymentConfirmed,
  emitPaymentFailed,
} from "../emit";

const AGENT_PRICES: Record<string, number> = {
  "portfolio-scout": parseFloat(process.env.PRICE_PORTFOLIO_SCOUT ?? "0.02"),
  "yield-scanner": parseFloat(process.env.PRICE_YIELD_SCANNER ?? "0.05"),
  "risk-analyst": parseFloat(process.env.PRICE_RISK_ANALYST ?? "0.03"),
  "route-planner": parseFloat(process.env.PRICE_ROUTE_PLANNER ?? "0.03"),
  executor: parseFloat(process.env.PRICE_EXECUTOR ?? "0.02"),
};

const SUBAGENT_BASE_URL = `http://localhost:${process.env.PORT ?? 3001}`;
const PAYMENT_CHAIN_ID =
  (process.env.PAYMENT_NETWORK ?? "base-sepolia") === "sepolia"
    ? 11155111
    : 84532;

export interface SpawnSubAgentInput {
  sessionId: string;
  role: string;
  task: string;
  budgetUsdc: number;
  context?: string;
  parentId?: string;
}

export interface SpawnSubAgentResult {
  agentId: string;
  output: string;
  spentUsdc: number;
  status: "complete" | "failed";
  durationMs: number;
}

export async function executeSpawnSubAgent(
  input: SpawnSubAgentInput,
): Promise<SpawnSubAgentResult> {
  const { sessionId, role, task, budgetUsdc, context, parentId } = input;
  const agentPrice = AGENT_PRICES[role] ?? 0.03;
  const agentId = uuidv4();
  const startTime = Date.now();

  // 1. Atomic budget check
  const reserved = await reserveSessionBudget(sessionId, agentPrice);
  if (!reserved) {
    throw new Error(
      `Insufficient session budget to spawn ${role} (costs $${agentPrice})`,
    );
  }

  // 2. Create agent DB record
  const walletAddress = deriveVirtualAddress(agentId);
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
  });
  const requestedParentId = parentId ?? session.masterAgentId ?? null;

  let resolvedParentId: string | null = null;
  if (requestedParentId) {
    const parentAgent = await prisma.agent.findUnique({
      where: { id: requestedParentId },
    });
    resolvedParentId = parentAgent ? parentAgent.id : null;
  }

  await prisma.agent.create({
    data: {
      id: agentId,
      sessionId,
      parentAgentId: resolvedParentId,
      depth: resolvedParentId ? 1 : 0,
      role,
      task,
      status: "running",
      walletAddress,
      budgetUsdc,
    },
  });

  await prisma.session.update({
    where: { id: sessionId },
    data: { agentCount: { increment: 1 } },
  });

  // 3. Emit spawned
  emitAgentSpawned(sessionId, {
    agentId,
    parentId: resolvedParentId,
    role,
    task,
    walletAddress,
    budgetUsdc,
  });

  // 4. POST to sub-agent x402 endpoint (blocking call)
  let output = "";
  let success = false;

  try {
    const sessionWalletName =
      session.sessionWalletName ?? `session-${sessionId}`;

    // Pay x402 fee before calling the endpoint
    const payment = await payX402(sessionWalletName, {
      amount: String(agentPrice),
      token: "USDC",
      network: process.env.PAYMENT_NETWORK ?? "base-sepolia",
      address: process.env.PAYMENT_RECEIVER_ADDRESS ?? walletAddress,
      chainId: PAYMENT_CHAIN_ID,
    });

    // Record payment
    const dbPayment = await prisma.payment.create({
      data: {
        sessionId,
        agentId,
        amountUsdc: agentPrice,
        txHash: payment.txHash,
        status: "confirmed",
        description: `x402 payment for ${role}`,
      },
    });

    emitPaymentConfirmed(sessionId, {
      paymentId: dbPayment.id,
      agentId,
      amountUsdc: agentPrice,
      txHash: payment.txHash,
      description: `x402 payment for ${role}`,
    });

    // Call the sub-agent endpoint
    const res = await fetch(`${SUBAGENT_BASE_URL}/agents/${role}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, sessionId, task, budgetUsdc, context }),
      signal: AbortSignal.timeout(
        parseInt(process.env.AGENT_TIMEOUT_MS ?? "180000"),
      ),
    });

    if (!res.ok) {
      throw new Error(
        `Sub-agent ${role} returned ${res.status}: ${await res.text()}`,
      );
    }

    const result = (await res.json()) as { output: string; spentUsdc?: number };
    output = result.output;
    success = true;

    const durationMs = Date.now() - startTime;

    // Deduct from agent virtual budget
    await deductAgentBudget(agentId, agentPrice);

    await prisma.agent.update({
      where: { id: agentId },
      data: { status: "complete", output, completedAt: new Date() },
    });

    emitAgentComplete(sessionId, {
      agentId,
      output,
      spentUsdc: agentPrice,
      durationMs,
    });

    return {
      agentId,
      output,
      spentUsdc: agentPrice,
      status: "complete",
      durationMs,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;

    await prisma.agent
      .update({
        where: { id: agentId },
        data: {
          status: "failed",
          output: `Error: ${error}`,
          completedAt: new Date(),
        },
      })
      .catch(() => {});

    if (!success) {
      emitPaymentFailed(sessionId, {
        agentId,
        amountUsdc: agentPrice,
        reason: error,
      });
    }

    emitAgentFailed(sessionId, { agentId, error });

    return {
      agentId,
      output: `Error: ${error}`,
      spentUsdc: agentPrice,
      status: "failed",
      durationMs,
    };
  }
}
