// ── Domain types shared between client + server ───────────────────────────────

export type SessionStatus =
  | "pending_funding"
  | "running"
  | "awaiting_approval"
  | "complete"
  | "failed"
  | "cancelled";
export type AgentStatus =
  | "running"
  | "awaiting_approval"
  | "complete"
  | "failed";
export type PaymentStatus = "pending" | "confirmed" | "failed";
export type FundingMode = "pay_per_session" | "prefunded_master";

export interface Session {
  id: string;
  task: string;
  status: SessionStatus;
  fundingMode?: FundingMode;
  userWalletAddress?: string | null;
  masterAgentId?: string;
  sessionWalletName?: string;
  sessionWalletAddress?: string;
  budgetUsdc: number;
  spentUsdc: number;
  finalOutput?: string;
  agentCount: number;
  durationMs?: number;
  isSeeded: boolean;
  createdAt: string;
  updatedAt: string;
  agents: Agent[];
  payments: Payment[];
}

export interface Agent {
  id: string;
  sessionId: string;
  parentAgentId: string | null;
  depth: number;
  role: string;
  task: string;
  status: AgentStatus;
  walletAddress: string | null;
  budgetUsdc: number;
  spentUsdc: number;
  output?: string;
  toolCallCount: number;
  createdAt: string;
  completedAt?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  agentId: string;
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: "pending" | "running" | "done" | "failed";
  durationMs?: number;
  createdAt: string;
}

export interface Payment {
  id: string;
  sessionId: string;
  agentId: string;
  amountUsdc: number;
  txHash?: string;
  status: PaymentStatus;
  description?: string;
  createdAt: string;
}

// ── Socket event payloads ─────────────────────────────────────────────────────

export interface AgentSpawnedPayload {
  agentId: string;
  parentId: string | null;
  role: string;
  task: string;
  walletAddress: string;
  budgetUsdc: number;
}

export interface AgentThinkingPayload {
  agentId: string;
  token: string;
}

export interface AgentCompletePayload {
  agentId: string;
  output: string;
  spentUsdc: number;
  durationMs: number;
}

export interface AgentFailedPayload {
  agentId: string;
  error: string;
}

export interface ToolCalledPayload {
  agentId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface ToolResultPayload {
  agentId: string;
  toolCallId: string;
  toolName: string;
  output: unknown;
  durationMs: number;
}

export interface PaymentConfirmedPayload {
  paymentId: string;
  agentId: string;
  amountUsdc: number;
  txHash: string;
  description: string;
}

export interface AwaitingApprovalPayload {
  phase: "research" | "execution";
  summary: string;
  proposals: unknown[];
  timeoutMs: number;
}

export interface SessionFundingRequiredPayload {
  requiredMasterBalanceUsdc: number;
  treasuryBalanceUsdc: number;
  shortfallUsdc: number;
  treasuryAddress: string;
  multiplier: number;
  tokenSymbol: "USDC";
  network: string;
}

export interface SessionFundedPayload {
  status: "running";
  requiredMasterBalanceUsdc: number;
  treasuryBalanceUsdc: number;
  multiplier: number;
}

export interface SessionCompletePayload {
  finalOutput: string;
  totalSpentUsdc: number;
  durationMs: number;
}

export interface WalletUpdatePayload {
  agentId: string;
  walletAddress: string;
  spentUsdc: number;
  budgetUsdc: number;
}

export interface TreasuryUpdatePayload {
  sessionWalletAddress: string;
  spentUsdc: number;
  budgetUsdc: number;
}

export interface ChatMessage {
  id: string;
  agentId: string;
  role: "assistant" | "tool" | "user";
  content: string;
  timestamp: number;
}
