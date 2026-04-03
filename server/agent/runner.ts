/**
 * server/agent/runner.ts
 *
 * Starts and resumes master agent sessions.
 * Manages the LangGraph thread lifecycle.
 */

import { Command } from "@langchain/langgraph";
import { buildMasterGraph, getCheckpointer } from "./graph";
import { LLMMessage } from "../llm";
import { MASTER_SYSTEM_PROMPT } from "./prompts";
import { prisma } from "../db";
import { fundSessionWallet, sweepSessionWallet } from "../wallet";
import {
  emitSessionComplete,
  emitSessionFailed,
  emitAwaitingApproval,
} from "../emit";
import { v4 as uuidv4 } from "uuid";

export interface StartSessionOptions {
  sessionId: string;
  task: string;
  budgetUsdc: number;
}

/** Start a new master agent session in the background. */
export async function startSession(opts: StartSessionOptions): Promise<void> {
  const { sessionId, task, budgetUsdc } = opts;
  let sessionWalletAddress: string | null = null;

  // Ensure the session has a real master Agent row before any sub-agents spawn.
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  let masterAgentId = session.masterAgentId;
  if (masterAgentId) {
    const existingMaster = await prisma.agent.findUnique({
      where: { id: masterAgentId },
    });
    if (!existingMaster) {
      masterAgentId = null;
    }
  }

  if (!masterAgentId) {
    masterAgentId = uuidv4();
    await prisma.agent.create({
      data: {
        id: masterAgentId,
        sessionId,
        parentAgentId: null,
        depth: 0,
        role: "master",
        task,
        status: "running",
        budgetUsdc,
      },
    });

    await prisma.session.update({
      where: { id: sessionId },
      data: { masterAgentId },
    });
  }

  // Fund session wallet
  try {
    const wallet = await fundSessionWallet(sessionId, budgetUsdc);
    sessionWalletAddress = wallet.walletAddress;
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        sessionWalletName: wallet.walletName,
        sessionWalletAddress: wallet.walletAddress,
        status: "running",
      },
    });
  } catch (err) {
    console.error("[runner] Failed to fund session wallet:", err);
    await prisma.session
      .update({
        where: { id: sessionId },
        data: { status: "failed" },
      })
      .catch(() => {});
    emitSessionFailed(sessionId, { error: `Funding failed: ${String(err)}` });
    return;
  }

  const checkpointer = await getCheckpointer();
  const graph = buildMasterGraph(checkpointer);

  const initialMessages: LLMMessage[] = [
    { role: "system", content: MASTER_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Task: ${task}\nSession budget: $${budgetUsdc} USDC\nSession ID: ${sessionId}\nSession wallet address: ${sessionWalletAddress ?? "unknown"}`,
    },
  ];

  const config = { configurable: { thread_id: sessionId } };

  // Run in background — don't await
  runGraphLoop(
    graph,
    sessionId,
    { messages: initialMessages, sessionId, task },
    config,
  ).catch((err) => {
    console.error(`[runner] Session ${sessionId} crashed:`, err);
    emitSessionFailed(sessionId, { error: String(err) });
    prisma.session
      .update({
        where: { id: sessionId },
        data: { status: "failed" },
      })
      .catch(() => {});
  });
}

/** Resume a session after user approval. */
export async function resumeSession(
  sessionId: string,
  decision: "approved" | "rejected",
): Promise<void> {
  const checkpointer = await getCheckpointer();
  const graph = buildMasterGraph(checkpointer);
  const config = { configurable: { thread_id: sessionId } };

  await prisma.session.update({
    where: { id: sessionId },
    data: { status: "running" },
  });

  // Resume with the interrupt value
  runGraphLoop(
    graph,
    sessionId,
    new Command({ resume: decision }),
    config,
  ).catch((err) => {
    console.error(`[runner] Session ${sessionId} resume crashed:`, err);
    emitSessionFailed(sessionId, { error: String(err) });
  });
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function runGraphLoop(
  graph: ReturnType<typeof buildMasterGraph>,
  sessionId: string,
  input: Parameters<ReturnType<typeof buildMasterGraph>["stream"]>[0],
  config: Partial<
    NonNullable<Parameters<ReturnType<typeof buildMasterGraph>["stream"]>[1]>
  >,
): Promise<void> {
  const startTime = Date.now();

  const stream = await graph.stream(input, { ...config, streamMode: "values" });
  for await (const event of stream) {
    // Check for interrupt (awaiting_approval)
    if (event.__interrupt__) {
      const interruptData = event.__interrupt__[0]?.value as {
        phase: "research" | "execution";
        summary: string;
        proposals: unknown[];
      };
      await prisma.session.update({
        where: { id: sessionId },
        data: { status: "awaiting_approval" },
      });
      emitAwaitingApproval(sessionId, {
        ...interruptData,
        timeoutMs: 300_000, // 5 min timeout
      });
      return; // Graph is paused — will resume via resumeSession()
    }

    // Check for final output
    if (event.finalOutput) {
      const durationMs = Date.now() - startTime;
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
      });

      await prisma.session.update({
        where: { id: sessionId },
        data: {
          status: "complete",
          finalOutput: event.finalOutput,
          durationMs,
        },
      });

      emitSessionComplete(sessionId, {
        finalOutput: event.finalOutput,
        totalSpentUsdc: session?.spentUsdc ?? 0,
        durationMs,
      });

      // Sweep session wallet back to treasury
      await sweepSessionWallet(sessionId).catch((err) =>
        console.warn("[runner] Sweep failed:", err),
      );
      return;
    }
  }
}
