const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type FundingMode = "pay_per_session" | "prefunded_master";

export interface FundingStatus {
  fundingRequired: boolean;
  requiredMasterBalanceUsdc?: number;
  treasuryBalanceUsdc?: number;
  shortfallUsdc?: number;
  treasuryAddress?: string;
  multiplier?: number;
  network?: string;
  tokenSymbol?: "USDC";
  message?: string;
}

export interface CreateSessionResponse extends FundingStatus {
  sessionId: string;
  status:
    | "pending_funding"
    | "running"
    | "awaiting_approval"
    | "complete"
    | "failed"
    | "cancelled";
}

async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function createSession(
  task: string,
  budgetUsdc = 2,
  options?: { userWalletAddress?: string; fundingMode?: FundingMode },
): Promise<CreateSessionResponse> {
  const res = await fetch(`${API}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task,
      budgetUsdc,
      userWalletAddress: options?.userWalletAddress,
      fundingMode: options?.fundingMode ?? "pay_per_session",
    }),
  });

  const payload = await parseJsonSafe<CreateSessionResponse>(res);
  if (res.status === 402 && payload) return payload;
  if (!res.ok)
    throw new Error((await res.text()) || "Failed to create session");
  if (!payload) throw new Error("Malformed create session response");
  return payload;
}

export async function startPendingSession(
  sessionId: string,
): Promise<CreateSessionResponse> {
  const res = await fetch(`${API}/api/sessions/${sessionId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  const payload = await parseJsonSafe<CreateSessionResponse>(res);
  if (res.status === 402 && payload) return payload;
  if (!res.ok) throw new Error((await res.text()) || "Failed to start session");
  if (!payload) throw new Error("Malformed start session response");
  return payload;
}

export async function getSession(sessionId: string) {
  const res = await fetch(`${API}/api/sessions/${sessionId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getSessions() {
  const res = await fetch(`${API}/api/sessions`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function approveSession(
  sessionId: string,
  decision: "approved" | "rejected",
): Promise<void> {
  const res = await fetch(`${API}/api/sessions/${sessionId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function sendSessionChatMessage(
  sessionId: string,
  message: string,
  options?: {
    role?:
      | "executor"
      | "route-planner"
      | "risk-analyst"
      | "yield-scanner"
      | "portfolio-scout";
    budgetUsdc?: number;
  },
): Promise<void> {
  const res = await fetch(`${API}/api/sessions/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      role: options?.role,
      budgetUsdc: options?.budgetUsdc,
    }),
  });

  if (!res.ok) {
    throw new Error((await res.text()) || "Failed to send chat message");
  }
}

export async function getWallet(): Promise<{
  name: string;
  address: string;
  balance: number;
  network: string;
  token: "USDC";
}> {
  const res = await fetch(`${API}/api/wallet`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fundWallet(
  amountUsdc: number,
  userWalletAddress?: string,
  txHash?: string,
): Promise<{
  confirmed: boolean;
  txHash: string;
  amountUsdc: number;
  userWalletAddress: string | null;
  newBalance: number;
  treasuryAddress: string;
  network: string;
  token: "USDC";
}> {
  const res = await fetch(`${API}/api/wallet/fund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amountUsdc, userWalletAddress, txHash }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
