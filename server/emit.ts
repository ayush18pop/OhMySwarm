/**
 * server/emit.ts
 *
 * All Socket.io events go through here.
 * Events are always scoped to a session room: `session:{sessionId}`.
 * Never broadcasts globally.
 */

import type { Server as SocketServer } from "socket.io";

let _io: SocketServer | null = null;

export function initEmitter(io: SocketServer) {
  _io = io;
}

function room(sessionId: string): string {
  return `session:${sessionId}`;
}

function emit(sessionId: string, event: string, data: unknown) {
  if (!_io) return;
  _io.to(room(sessionId)).emit(event, data);
}

// ── Event emitters ────────────────────────────────────────────────────────────

export function emitSessionFundingRequired(
  sessionId: string,
  payload: {
    requiredMasterBalanceUsdc: number;
    treasuryBalanceUsdc: number;
    shortfallUsdc: number;
    treasuryAddress: string;
    multiplier: number;
    tokenSymbol: "USDC";
    network: string;
  },
) {
  emit(sessionId, "SESSION_FUNDING_REQUIRED", payload);
}

export function emitSessionFunded(
  sessionId: string,
  payload: {
    status: "running";
    requiredMasterBalanceUsdc: number;
    treasuryBalanceUsdc: number;
    multiplier: number;
  },
) {
  emit(sessionId, "SESSION_FUNDED", payload);
}

export function emitAgentSpawned(
  sessionId: string,
  payload: {
    agentId: string;
    parentId: string | null;
    role: string;
    task: string;
    walletAddress: string;
    budgetUsdc: number;
  },
) {
  emit(sessionId, "AGENT_SPAWNED", payload);
}

export function emitAgentThinking(
  sessionId: string,
  payload: {
    agentId: string;
    token: string;
  },
) {
  emit(sessionId, "AGENT_THINKING", payload);
}

export function emitAgentComplete(
  sessionId: string,
  payload: {
    agentId: string;
    output: string;
    spentUsdc: number;
    durationMs: number;
  },
) {
  emit(sessionId, "AGENT_COMPLETE", payload);
}

export function emitAgentFailed(
  sessionId: string,
  payload: {
    agentId: string;
    error: string;
  },
) {
  emit(sessionId, "AGENT_FAILED", payload);
}

export function emitToolCalled(
  sessionId: string,
  payload: {
    agentId: string;
    toolCallId: string;
    toolName: string;
    input: unknown;
  },
) {
  emit(sessionId, "TOOL_CALLED", payload);
}

export function emitToolResult(
  sessionId: string,
  payload: {
    agentId: string;
    toolCallId: string;
    toolName: string;
    output: unknown;
    durationMs: number;
  },
) {
  emit(sessionId, "TOOL_RESULT", payload);
}

export function emitPaymentConfirmed(
  sessionId: string,
  payload: {
    paymentId: string;
    agentId: string;
    amountUsdc: number;
    txHash: string;
    description: string;
  },
) {
  emit(sessionId, "PAYMENT_CONFIRMED", payload);
}

export function emitPaymentFailed(
  sessionId: string,
  payload: {
    agentId: string;
    amountUsdc: number;
    reason: string;
  },
) {
  emit(sessionId, "PAYMENT_FAILED", payload);
}

export function emitAwaitingApproval(
  sessionId: string,
  payload: {
    phase: "research" | "execution";
    summary: string;
    proposals: unknown[];
    timeoutMs: number;
  },
) {
  emit(sessionId, "AWAITING_APPROVAL", payload);
}

export function emitSessionComplete(
  sessionId: string,
  payload: {
    finalOutput: string;
    totalSpentUsdc: number;
    durationMs: number;
  },
) {
  emit(sessionId, "SESSION_COMPLETE", payload);
}

export function emitSessionFailed(
  sessionId: string,
  payload: {
    error: string;
  },
) {
  emit(sessionId, "SESSION_FAILED", payload);
}

export function emitChatMessage(
  sessionId: string,
  payload: {
    id: string;
    agentId: string;
    role: "assistant" | "tool" | "user";
    content: string;
    timestamp: number;
  },
) {
  emit(sessionId, "CHAT_MESSAGE", payload);
}

export function emitWalletUpdate(
  sessionId: string,
  payload: {
    agentId: string;
    walletAddress: string;
    spentUsdc: number;
    budgetUsdc: number;
  },
) {
  emit(sessionId, "WALLET_UPDATE", payload);
}

export function emitTreasuryUpdate(
  sessionId: string,
  payload: {
    sessionWalletAddress: string;
    spentUsdc: number;
    budgetUsdc: number;
  },
) {
  emit(sessionId, "TREASURY_UPDATE", payload);
}
