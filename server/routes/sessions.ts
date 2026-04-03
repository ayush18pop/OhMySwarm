/**
 * server/routes/sessions.ts
 *
 * POST /api/sessions          — create + start a session
 * GET  /api/sessions/:id      — get session state
 * POST /api/sessions/:id/approve — resume after approval
 * GET  /api/sessions          — list recent sessions
 */

import { Router, Request, Response } from "express";
import { prisma } from "../db";
import { startSession, resumeSession } from "../agent/runner";
import { v4 as uuidv4 } from "uuid";
import {
  getWalletAddress,
  getWalletBalance,
  isPaidModeEnabled,
} from "../wallet";
import {
  emitChatMessage,
  emitSessionFailed,
  emitSessionFunded,
  emitSessionFundingRequired,
} from "../emit";
import { getTopPools } from "../integrations/defillama";
import { getPortfolio } from "../integrations/zerion";
import { executeSpawnSubAgent } from "../tools/spawnSubAgent";
import crypto from "crypto";
const router = Router();
const TREASURY_WALLET_NAME =
  process.env.OWS_TREASURY_WALLET_NAME ?? "ohmyswarm-treasury";
const MASTER_BALANCE_MULTIPLIER = Number(
  process.env.MASTER_WALLET_BUFFER_MULTIPLIER ?? "1.5",
);

type FundingMode = "pay_per_session" | "prefunded_master";
type FollowupRole =
  | "executor"
  | "route-planner"
  | "risk-analyst"
  | "yield-scanner"
  | "portfolio-scout";

const FOLLOWUP_ROLE_SET = new Set<FollowupRole>([
  "executor",
  "route-planner",
  "risk-analyst",
  "yield-scanner",
  "portfolio-scout",
]);

function clampFollowupBudget(value: unknown): number {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 0.03;
  return Math.min(Math.max(parsed, 0.01), 0.2);
}

function normalizeWalletAddress(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

function deriveMasterWalletName(userWalletAddress: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(userWalletAddress)
    .digest("hex")
    .slice(0, 12);
  return `master-${hash}`;
}

async function getOrCreateWalletMaster(userWalletAddress: string) {
  const existing = await prisma.walletMaster.findUnique({
    where: { userWalletAddress },
  });
  if (existing) return existing;

  return prisma.walletMaster.create({
    data: {
      userWalletAddress,
      masterAgentId: uuidv4(),
      masterWalletName: deriveMasterWalletName(userWalletAddress),
    },
  });
}

function requiredMasterBalance(budgetUsdc: number): number {
  return Number((budgetUsdc * MASTER_BALANCE_MULTIPLIER).toFixed(6));
}

async function fundingSnapshot(budgetUsdc: number) {
  const [treasuryAddress, treasuryBalance] = await Promise.all([
    getWalletAddress(TREASURY_WALLET_NAME),
    getWalletBalance(TREASURY_WALLET_NAME),
  ]);

  if (!isPaidModeEnabled()) {
    return {
      treasuryAddress,
      treasuryBalanceUsdc: treasuryBalance,
      requiredMasterBalanceUsdc: 0,
      shortfallUsdc: 0,
      hasEnough: true,
      multiplier: 0,
    };
  }

  const required = requiredMasterBalance(budgetUsdc);
  const shortfall = Math.max(
    0,
    Number((required - treasuryBalance).toFixed(6)),
  );
  const hasEnough = treasuryBalance >= required;

  return {
    treasuryAddress,
    treasuryBalanceUsdc: treasuryBalance,
    requiredMasterBalanceUsdc: required,
    shortfallUsdc: shortfall,
    hasEnough,
    multiplier: MASTER_BALANCE_MULTIPLIER,
  };
}

// POST /api/sessions
router.post("/", async (req: Request, res: Response) => {
  const { task, budgetUsdc, userWalletAddress, fundingMode } = req.body as {
    task?: string;
    budgetUsdc?: number;
    userWalletAddress?: string;
    fundingMode?: FundingMode;
  };

  if (!task || typeof task !== "string") {
    return res.status(400).json({ error: "task is required" });
  }

  const budget = Number(
    budgetUsdc ?? parseFloat(process.env.DEFAULT_SESSION_BUDGET_USDC ?? "2.00"),
  );

  if (Number.isNaN(budget) || budget <= 0) {
    return res
      .status(400)
      .json({ error: "budgetUsdc must be a positive number" });
  }

  const normalizedWallet = normalizeWalletAddress(userWalletAddress);
  const mode: FundingMode =
    fundingMode === "prefunded_master" ? "prefunded_master" : "pay_per_session";

  if (isPaidModeEnabled() && mode === "pay_per_session" && !normalizedWallet) {
    return res.status(400).json({
      error:
        "userWalletAddress is required in paid mode when fundingMode=pay_per_session",
    });
  }

  const walletMaster = normalizedWallet
    ? await getOrCreateWalletMaster(normalizedWallet)
    : null;

  const funding = await fundingSnapshot(budget);

  // Always create session first, then decide if we can run immediately.
  const session = await prisma.session.create({
    data: {
      id: uuidv4(),
      task: task.trim(),
      budgetUsdc: budget,
      status: funding.hasEnough ? "running" : "pending_funding",
      fundingMode: mode,
      userWalletAddress: normalizedWallet,
      // masterAgentId must reference a real Agent row in this session.
      // Wallet-level mapping is tracked in WalletMaster and applied at runtime.
      masterAgentId: null,
    },
  });

  if (!funding.hasEnough) {
    emitSessionFundingRequired(session.id, {
      requiredMasterBalanceUsdc: funding.requiredMasterBalanceUsdc,
      treasuryBalanceUsdc: funding.treasuryBalanceUsdc,
      shortfallUsdc: funding.shortfallUsdc,
      treasuryAddress: funding.treasuryAddress,
      multiplier: funding.multiplier,
      tokenSymbol: "USDC",
      network: process.env.PAYMENT_NETWORK ?? "base-sepolia",
    });

    return res.status(402).json({
      sessionId: session.id,
      status: "pending_funding",
      fundingRequired: true,
      ...funding,
      network: process.env.PAYMENT_NETWORK ?? "base-sepolia",
      tokenSymbol: "USDC",
      message:
        "Master wallet balance is below required threshold. Please fund treasury wallet and retry.",
    });
  }

  // Start master agent in background (non-blocking)
  startSession({
    sessionId: session.id,
    task: session.task,
    budgetUsdc: budget,
  }).catch((err) => {
    console.error("[sessions] startSession error:", err);
    emitSessionFailed(session.id, { error: String(err) });
  });

  res.status(201).json({
    sessionId: session.id,
    status: "running",
    fundingRequired: false,
  });
});

// POST /api/sessions/:id/start
// Re-checks master wallet threshold and starts a pending session if funded.
router.post("/:id/start", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return res.status(404).json({ error: "Session not found" });

  if (session.status === "running" || session.status === "awaiting_approval") {
    return res.status(200).json({
      sessionId,
      status: session.status,
      fundingRequired: false,
      message: "Session already started",
    });
  }

  if (session.status !== "pending_funding") {
    return res.status(409).json({
      error: `Session cannot be started from status ${session.status}`,
    });
  }

  const funding = await fundingSnapshot(session.budgetUsdc);
  if (!funding.hasEnough) {
    emitSessionFundingRequired(sessionId, {
      requiredMasterBalanceUsdc: funding.requiredMasterBalanceUsdc,
      treasuryBalanceUsdc: funding.treasuryBalanceUsdc,
      shortfallUsdc: funding.shortfallUsdc,
      treasuryAddress: funding.treasuryAddress,
      multiplier: funding.multiplier,
      tokenSymbol: "USDC",
      network: process.env.PAYMENT_NETWORK ?? "base-sepolia",
    });

    return res.status(402).json({
      sessionId,
      status: "pending_funding",
      fundingRequired: true,
      ...funding,
      network: process.env.PAYMENT_NETWORK ?? "base-sepolia",
      tokenSymbol: "USDC",
      message: "Still underfunded. Please fund treasury wallet and retry.",
    });
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: { status: "running" },
  });

  emitSessionFunded(sessionId, {
    status: "running",
    requiredMasterBalanceUsdc: funding.requiredMasterBalanceUsdc,
    treasuryBalanceUsdc: funding.treasuryBalanceUsdc,
    multiplier: funding.multiplier,
  });

  startSession({
    sessionId,
    task: session.task,
    budgetUsdc: session.budgetUsdc,
  }).catch((err) => {
    console.error("[sessions] startSession(retry) error:", err);
    emitSessionFailed(sessionId, { error: String(err) });
  });

  return res.status(200).json({
    sessionId,
    status: "running",
    fundingRequired: false,
    message: "Session started",
  });
});

// POST /api/sessions/:id/chat
// Accepts a user follow-up and continues the same session graph by spawning a new branch.
router.post("/:id/chat", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  const { message, role, budgetUsdc } = req.body as {
    message?: string;
    role?: string;
    budgetUsdc?: number;
  };

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return res.status(404).json({ error: "Session not found" });

  if (session.status === "pending_funding") {
    return res.status(409).json({
      error: "Session is awaiting funding and cannot accept chat follow-ups",
    });
  }

  if (session.status === "failed" || session.status === "cancelled") {
    return res.status(409).json({
      error: `Session cannot continue from status ${session.status}`,
    });
  }

  const trimmedMessage = message.trim();
  const followupRole = FOLLOWUP_ROLE_SET.has(role as FollowupRole)
    ? (role as FollowupRole)
    : "executor";
  const followupBudget = clampFollowupBudget(budgetUsdc);

  emitChatMessage(sessionId, {
    id: uuidv4(),
    agentId: "user",
    role: "user",
    content: trimmedMessage,
    timestamp: Date.now(),
  });

  const contextParts = [
    `Original session task: ${session.task}`,
    session.finalOutput
      ? `Latest session output:\n${session.finalOutput}`
      : null,
    "Treat this as a follow-up instruction and continue the same swarm context.",
  ].filter(Boolean);

  executeSpawnSubAgent({
    sessionId,
    parentId: session.masterAgentId ?? undefined,
    role: followupRole,
    task: trimmedMessage,
    budgetUsdc: followupBudget,
    context: contextParts.join("\n\n"),
  }).catch((err) => {
    console.error("[sessions] follow-up spawn failed:", err);
    emitSessionFailed(sessionId, { error: String(err) });
  });

  return res.status(202).json({
    ok: true,
    sessionId,
    role: followupRole,
    budgetUsdc: followupBudget,
    message: "Follow-up accepted and queued",
  });
});

// GET /api/sessions/:id
router.get("/:id", async (req: Request, res: Response) => {
  const sessionId = String(req.params.id);
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      agents: {
        include: { toolCalls: true },
        orderBy: { createdAt: "asc" },
      },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!session) return res.status(404).json({ error: "Session not found" });

  res.json(session);
});

// GET /api/sessions
router.get("/", async (_req: Request, res: Response) => {
  const sessions = await prisma.session.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      task: true,
      status: true,
      budgetUsdc: true,
      spentUsdc: true,
      agentCount: true,
      durationMs: true,
      isSeeded: true,
      createdAt: true,
    },
  });
  res.json(sessions);
});

//testing defillama integration
router.get("/defillama/top-pools", async (_req: Request, res: Response) => {
  try {
    const topPools = await getTopPools({}, 10);
    res.json(topPools);
  } catch (err) {
    console.error("Error fetching top pools from DeFiLlama:", err);
    res.status(500).json({ error: "Failed to fetch top pools" });
  }
});
//testing zerion integration
router.get(
  "/zerion/portfolio/:address",
  async (req: Request, res: Response) => {
    const address = String(req.params.address);
    try {
      const portfolio = await getPortfolio(address);
      res.json(portfolio);
    } catch (err) {
      console.error("Error fetching portfolio from Zerion:", err);
      res.status(500).json({ error: "Failed to fetch portfolio" });
    }
  },
);

// POST /api/sessions/:id/approve
router.post("/:id/approve", async (req: Request, res: Response) => {
  const { decision } = req.body as { decision?: "approved" | "rejected" };
  const sessionId = String(req.params.id);

  if (!decision || !["approved", "rejected"].includes(decision)) {
    return res
      .status(400)
      .json({ error: 'decision must be "approved" or "rejected"' });
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.status !== "awaiting_approval") {
    return res.status(409).json({
      error: `Session is not awaiting approval (status: ${session.status})`,
    });
  }

  resumeSession(sessionId, decision).catch((err) =>
    console.error("[sessions] resumeSession error:", err),
  );

  res.json({ ok: true, decision });
});

export default router;
