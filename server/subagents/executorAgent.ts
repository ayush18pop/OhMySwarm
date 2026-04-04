/**
 * server/subagents/executorAgent.ts
 *
 * Simulates DeFi transaction execution.
 * In demo mode: validates via policy engine, returns mock txHashes.
 * Real execution would require integrating viem + protocol ABIs.
 *
 * Tools: check_policy, simulate_deposit, get_wallet_info
 */

import { runSubAgent, SubAgentRunInput } from "../agent/executor";
import { checkPolicy, formatPolicyResult } from "../policy";
import { prisma } from "../db";
import { decryptKey, getWalletAddress, isPaidModeEnabled } from "../wallet";
import { getProtocolInfo } from "../integrations/defillama";
import type { LLMTool } from "../llm";
import type { ProposedTx } from "../policy";
import crypto from "crypto";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  USDC_ADDRESS,
  AAVE_V3_POOL_ADDRESS,
  ERC20_ABI,
  AAVE_V3_POOL_ABI,
  toUsdcUnits,
} from "../constants/sepolia";

const TOOLS: LLMTool[] = [
  {
    name: "check_policy",
    description:
      "REQUIRED before any execution step. Validates the transaction against the policy engine.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "swap | bridge | lend | stake | withdraw",
          enum: ["swap", "bridge", "lend", "stake", "withdraw"],
        },
        fromToken: { type: "string", description: "Source token symbol" },
        toToken: { type: "string", description: "Target token (if swap)" },
        amountUsdc: {
          type: "number",
          description: "USDC value of the transaction",
        },
        chain: { type: "string", description: "Chain slug e.g. base-sepolia" },
        protocol: { type: "string", description: "Protocol slug e.g. aave-v3" },
        sessionId: {
          type: "string",
          description: "Session ID for budget tracking",
        },
      },
      required: [
        "action",
        "fromToken",
        "amountUsdc",
        "chain",
        "protocol",
        "sessionId",
      ],
    },
  },
  {
    name: "simulate_deposit",
    description:
      "Simulate a DeFi deposit — returns expected outcome and a mock tx hash. Use after check_policy approves.",
    parameters: {
      type: "object",
      properties: {
        protocol: { type: "string", description: "Protocol slug" },
        token: { type: "string", description: "Token to deposit" },
        amount: { type: "number", description: "Amount to deposit" },
        chain: { type: "string", description: "Target chain" },
        walletAddress: { type: "string", description: "Wallet address" },
      },
      required: ["protocol", "token", "amount", "chain", "walletAddress"],
    },
  },
  {
    name: "execute_deposit",
    description:
      "Execute a real on-chain deposit via Aave V3 on Sepolia. Use this instead of simulate_deposit when OWS_BILLING_MODE=paid.",
    parameters: {
      type: "object",
      properties: {
        protocol: { type: "string", description: "Protocol slug" },
        token: { type: "string", description: "Token to deposit" },
        amount: { type: "number", description: "Amount to deposit" },
        chain: { type: "string", description: "Target chain" },
        walletAddress: { type: "string", description: "Wallet address" },
      },
      required: ["protocol", "token", "amount", "chain", "walletAddress"],
    },
  },
  {
    name: "get_wallet_info",
    description: "Get the session OWS wallet address and balance",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
      },
      required: ["sessionId"],
    },
  },
];

async function checkPolicyTool(args: Record<string, unknown>): Promise<object> {
  const sessionId = args.sessionId as string;
  const session = await prisma.session.findUnique({ where: { id: sessionId } });

  const tx: ProposedTx = {
    action: args.action as ProposedTx["action"],
    fromToken: args.fromToken as string,
    toToken: args.toToken as string | undefined,
    amountUsdc: args.amountUsdc as number,
    chain: args.chain as string,
    protocol: args.protocol as string,
    sessionSpentUsdc: session?.spentUsdc ?? 0,
    sessionBudgetUsdc: session?.budgetUsdc ?? 2,
    simulated: true,
    simDeviation: 0.1,
  };

  const result = checkPolicy(tx);
  return { approved: result.approved, summary: formatPolicyResult(result) };
}

async function simulateDeposit(args: Record<string, unknown>): Promise<object> {
  const { protocol, token, amount, chain, walletAddress } = args;
  const info = await getProtocolInfo(String(protocol)).catch(() => null);

  // Fetch real APY from DefiLlama pools for this protocol+token
  let realApy = 'unknown';
  try {
    const { getTopPools } = await import('../integrations/defillama');
    const pools = await getTopPools({
      projects: [String(protocol)],
      chains: chain ? [String(chain)] : undefined,
    }, 3);
    const match = pools.find(p =>
      p.symbol.toUpperCase().includes(String(token).toUpperCase()),
    ) ?? pools[0];
    if (match) {
      realApy = `${match.apyBase.toFixed(2)}% base APY (live from DefiLlama)`;
    }
  } catch {
    // If DefiLlama is down, report unknown rather than faking it
  }

  return {
    status: "simulated",
    protocol,
    token,
    depositedAmount: amount,
    chain,
    walletAddress,
    expectedApy: realApy,
    protocolTvl: info ? `$${(info.tvl / 1e6).toFixed(0)}M` : 'unknown',
    protocolAudits: info?.audits ?? 'unknown',
    note: "Simulation with real market data — execute_deposit for on-chain execution",
  };
}

async function executeDeposit(args: Record<string, unknown>): Promise<object> {
  if (!isPaidModeEnabled() || !process.env.TREASURY_PRIVATE_KEY) {
    return simulateDeposit(args);
  }

  const protocol = String(args.protocol ?? "aave-v3");
  const token = String(args.token ?? "USDC");
  const amount = Number(args.amount ?? 0);
  const chain = String(args.chain ?? "sepolia");
  const walletAddress = String(args.walletAddress ?? "");

  if (!walletAddress) {
    throw new Error("walletAddress is required for execute_deposit");
  }

  const sessionRows = await prisma.$queryRaw<
    Array<{ sessionWalletKey: string | null }>
  >`
    SELECT "sessionWalletKey"
    FROM "Session"
    WHERE "sessionWalletAddress" = ${walletAddress}
    LIMIT 1
  `;

  const sessionWalletKey = sessionRows[0]?.sessionWalletKey;
  if (!sessionWalletKey) {
    throw new Error("Session wallet key not found for provided walletAddress");
  }

  const privateKey = decryptKey(sessionWalletKey) as `0x${string}`;
  const account = privateKeyToAccount(privateKey);

  const rpcUrl = process.env.FUNDING_RPC_URL ?? process.env.PAYMENT_RPC_URL;
  if (!rpcUrl) {
    throw new Error("FUNDING_RPC_URL (or PAYMENT_RPC_URL) is required");
  }

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const amountUnits = toUsdcUnits(amount);

  const approveTxHash = await walletClient.writeContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [AAVE_V3_POOL_ADDRESS, amountUnits],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTxHash });

  const supplyTxHash = await walletClient.writeContract({
    address: AAVE_V3_POOL_ADDRESS,
    abi: AAVE_V3_POOL_ABI,
    functionName: "supply",
    args: [USDC_ADDRESS, amountUnits, account.address, 0],
  });
  const supplyReceipt = await publicClient.waitForTransactionReceipt({
    hash: supplyTxHash,
  });

  return {
    status: "confirmed",
    txHash: supplyTxHash,
    approveTxHash,
    protocol,
    token,
    depositedAmount: amount,
    chain,
    walletAddress,
    blockNumber: Number(supplyReceipt.blockNumber),
  };
}

export async function runExecutor(
  input: Omit<SubAgentRunInput, "tools" | "toolHandlers">,
) {
  return runSubAgent({
    ...input,
    tools: TOOLS,
    toolHandlers: {
      check_policy: (args) => checkPolicyTool(args),
      simulate_deposit: (args) => simulateDeposit(args),
      execute_deposit: (args) => executeDeposit(args),
      get_wallet_info: async ({ sessionId }) => {
        const walletName = `session-${sessionId}`;
        const address = await getWalletAddress(walletName);
        return {
          walletName,
          address,
          network: process.env.PAYMENT_NETWORK ?? "base-sepolia",
        };
      },
    },
  });
}
