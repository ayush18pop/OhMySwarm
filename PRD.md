# OhMySwarm — Product Requirements Document

> OWS Hackathon · April 3, 2026
> Stack: TypeScript · Node.js · Express · LangGraph.js · Next.js · Socket.io · OWS · x402 · Prisma · Supabase

---

## The Product Story

**Problem:** Optimizing a DeFi portfolio means opening Zerion, DefiLlama, a bridge app, a DEX, and a lending protocol simultaneously. Two hours of research, cross-referencing APYs, estimating IL, manually executing 8 transactions across 3 chains. Most people leave money idle.

**OhMySwarm:** User submits a goal and a budget from the frontend. Session is created, then user funds that budget in Sepolia USDC using WalletConnect (MetaMask) or uses a pre-funded master wallet path. Once funded, the master agent orchestrates specialist agents in parallel and pays sub-agents autonomously via x402 when needed.

**Demo task:** _"I have $5k USDC idle, medium risk — find the best yield right now."_ 40 seconds. $0.15 USDC spent. A wealth manager charges 1% AUM for worse advice.

---

## Partner Integrations (Final)

| Partner                                    | Job                                                                  | Used By                      |
| ------------------------------------------ | -------------------------------------------------------------------- | ---------------------------- |
| **OWS SDK** (`@open-wallet-standard/core`) | Wallet creation, x402 payment signing — treasury + session wallets   | Wallet layer                 |
| **x402** (`@x402/express`, `@x402/core`)   | HTTP payment protocol — master OWS wallet pays sub-agent endpoints   | Orchestration layer          |
| **Zerion API**                             | Portfolio positions, DeFi holdings, multi-chain balances (free tier) | Portfolio Scout              |
| **DefiLlama API**                          | Yield pool data, protocol TVL, APY across 10k+ pools (no key)        | Yield Scanner + Risk Analyst |

MoonPay removed — requires business account/KYB, not usable in hackathon.
Swap/bridge execution is simulated (policy-checked mock txHashes). Real execution can be added post-hackathon via viem + protocol ABIs.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            OhMySwarm                                     │
│                                                                          │
│  USER: "Find best yield for $5k USDC, medium risk"                      │
│       │                                                                  │
│       ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  FRONTEND  (Next.js · Sci-Fi Theme)                             │    │
│  │  ┌──────────────────────────┐  ┌────────────────────────────┐  │    │
│  │  │  CANVAS  (left 50%)      │  │  TERMINAL PANEL (right 50%)│  │    │
│  │  │  React Flow · HUD style  │  │  [Chat]  [Details]         │  │    │
│  │  │  Incremental tree layout │  │  Sci-fi activity stream    │  │    │
│  │  │  [Master]                │  │  Two-phase approval modals │  │    │
│  │  │    ├─[Portfolio Scout]   │  └────────────────────────────┘  │    │
│  │  │    ├─[Yield Scanner]     │                                   │    │
│  │  │    ├─[Risk Analyst]      │                                   │    │
│  │  │    ├─[Route Planner]     │                                   │    │
│  │  │    └─[Executor]          │                                   │    │
│  │  └──────────────────────────┘                                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                    │  REST + WebSocket (Socket.io rooms)                  │
│                    ▼                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  BACKEND  (Node.js · Express · LangGraph)                       │    │
│  │                                                                  │    │
│  │  Master Agent (LangGraph ReAct)                                  │    │
│  │  LLM ──tools──► [spawn_sub_agent · request_approval]            │    │
│  │       ◄──results──                                               │    │
│  │            │  x402 payment per sub-agent invocation              │    │
│  │            ▼                                                      │    │
│  │  ┌──────────────────────────────────────────────────────────┐   │    │
│  │  │  Sub-Agent x402 Endpoints                                │   │    │
│  │  │  POST /agents/portfolio-scout  ←402→  Zerion API         │   │    │
│  │  │  POST /agents/yield-scanner    ←402→  DefiLlama API      │   │    │
│  │  │  POST /agents/risk-analyst     ←402→  DefiLlama API      │   │    │
│  │  │  POST /agents/route-planner    ←402→  MoonPay CLI        │   │    │
│  │  │  POST /agents/executor         ←402→  MoonPay CLI        │   │    │
│  │  └──────────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│            │                              │                              │
│            ▼                              ▼                              │
│  ┌──────────────────────┐    ┌───────────────────────────────┐          │
│  │  Supabase Postgres   │    │  OWS Wallet Tier Model        │          │
│  │  Prisma + PGSaver    │    │  Treasury → Session → Virtual │          │
│  └──────────────────────┘    └───────────────────────────────┘          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Funding Workflow (Mandatory)

1. User submits task + budget from frontend.
2. Backend creates session in `pending_funding` and returns funding requirements.
3. Frontend opens WalletConnect (MetaMask) and asks user to send Sepolia USDC for that budget.
4. On tx confirmation, backend marks session funded and starts master agent (or uses pre-funded master wallet path).
5. Master agent autonomously pays sub-agents from its funded wallet via x402 per invocation.

Funding modes supported:

- `pay_per_session`: user funds each session budget via WalletConnect.
- `prefunded_master`: user pre-funds master wallet once, sessions draw budget from that balance.

---

## What's In / Cut

| Feature                                       | Status        |
| --------------------------------------------- | ------------- |
| Master agent ReAct loop                       | IN            |
| `spawn_sub_agent` blocking + x402             | IN            |
| `request_approval` two-phase interrupt        | IN            |
| Policy engine (deterministic, 7 checks)       | IN            |
| 3-tier wallet model                           | IN            |
| Frontend task + budget input                  | IN            |
| WalletConnect (MetaMask) session funding gate | IN            |
| Session status `pending_funding` before run   | IN            |
| Pre-fund master wallet mode                   | IN            |
| Simulation before execution                   | IN            |
| Atomic budget lock (no race conditions)       | IN            |
| Context summarization every 5 tool calls      | IN            |
| LangGraph PostgresSaver checkpointing         | IN            |
| Socket.io rooms (explicit)                    | IN            |
| Pre-seeded demo session                       | IN            |
| MoonPay CLI — swap/bridge/balance             | IN            |
| Zerion API — portfolio/positions              | IN            |
| DefiLlama API — yield/TVL data                | IN            |
| Allium, Uniblock, DFlow, Myriad, XMTP         | CUT           |
| Real OWS wallet per sub-agent                 | CUT (virtual) |
| `judge_output` tool                           | CUT           |
| `store_context` tool                          | CUT           |
| `get_agent_status` tool                       | CUT           |
| Recursive sub-agent spawning (depth > 2)      | CUT           |

---

---

# BACKEND PRD

---

## Environment Variables

```env
# Server
PORT=3001
FRONTEND_URL=http://localhost:3000

# LLM (OpenAI-compatible — swap freely)
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o

# Supabase
DATABASE_URL=postgresql://...supabase.co:5432/postgres
DIRECT_URL=postgresql://...supabase.co:5432/postgres

# OWS Wallets
OWS_TREASURY_WALLET_NAME=ohmyswarm-treasury
OWS_TREASURY_WALLET_SECRET=...

# WalletConnect / Funding
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
FUNDING_CHAIN=base-sepolia
FUNDING_CHAIN_ID=84532
FUNDING_TOKEN_SYMBOL=USDC
FUNDING_TOKEN_ADDRESS=0x...
SESSION_FUNDING_CONFIRMATIONS=1

# Payments
PAYMENT_NETWORK=base-sepolia
PAYMENT_RECEIVER_ADDRESS=0x...

# MoonPay
MOONPAY_API_KEY=...
MOONPAY_SECRET_KEY=...

# Zerion
ZERION_API_KEY=...

# DefiLlama — no key needed
DEFILLAMA_BASE_URL=https://yields.llama.fi

# Sub-agent prices (USDC)
PRICE_PORTFOLIO_SCOUT=0.02
PRICE_YIELD_SCANNER=0.05
PRICE_RISK_ANALYST=0.03
PRICE_ROUTE_PLANNER=0.03
PRICE_EXECUTOR=0.02

# Limits
AGENT_MAX_TOOL_CALLS=15
AGENT_MAX_DEPTH=2
AGENT_TIMEOUT_MS=180000
DEFAULT_SESSION_BUDGET_USDC=2.00

# Demo
PARTNER_FALLBACK_MODE=cached
PARTNER_TIMEOUT_MS=5000
```

---

## Folder Structure

```
server/
├── index.ts
├── llm.ts
├── policy.ts
├── emit.ts
├── seed.ts
├── wallet.ts
├── virtualWallet.ts
├── agent/
│   ├── graph.ts
│   ├── tools.ts
│   ├── executor.ts
│   ├── runner.ts
│   └── prompts.ts
├── tools/
│   ├── spawnSubAgent.ts
│   └── requestApproval.ts
├── subagents/
│   ├── portfolioScout.ts
│   ├── yieldScanner.ts
│   ├── riskAnalyst.ts
│   ├── routePlanner.ts
│   └── executor.ts
├── integrations/
│   ├── moonpay.ts
│   ├── zerion.ts
│   └── defillama.ts
├── routes/
│   ├── sessions.ts
│   ├── subagents.ts
│   └── wallet.ts
└── prisma/
    └── schema.prisma
```

---

## Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

model Session {
  id                   String     @id @default(uuid())
  task                 String
  status               String     @default("pending_funding")
  // pending_funding | running | awaiting_approval | complete | failed | cancelled
  masterAgentId        String?
  fundingMode          String     @default("pay_per_session")
  userWalletAddress    String?
  fundingTxHash        String?
  fundedAt             DateTime?
  sessionWalletName    String?
  sessionWalletAddress String?
  budgetUsdc           Float
  spentUsdc            Float      @default(0)
  finalOutput          String?
  agentCount           Int        @default(0)
  durationMs           Int?
  isSeeded             Boolean    @default(false)
  createdAt            DateTime   @default(now())
  updatedAt            DateTime   @updatedAt

  agents    Agent[]
  payments  Payment[]
}

model Agent {
  id            String    @id @default(uuid())
  sessionId     String
  parentAgentId String?
  depth         Int       @default(0)
  role          String
  task          String
  status        String    @default("running")
  // running | awaiting_approval | complete | failed
  walletAddress String?
  budgetUsdc    Float
  spentUsdc     Float     @default(0)
  output        String?
  toolCallCount Int       @default(0)
  createdAt     DateTime  @default(now())
  completedAt   DateTime?

  session   Session    @relation(fields: [sessionId], references: [id])
  parent    Agent?     @relation("AgentTree", fields: [parentAgentId], references: [id])
  children  Agent[]    @relation("AgentTree")
  toolCalls ToolCall[]
  payments  Payment[]
}

model ToolCall {
  id         String   @id @default(uuid())
  agentId    String
  sessionId  String
  toolName   String
  input      Json
  output     Json?
  status     String   @default("pending")
  // pending | running | done | failed
  durationMs Int?
  createdAt  DateTime @default(now())

  agent Agent @relation(fields: [agentId], references: [id])
}

model Payment {
  id          String   @id @default(uuid())
  sessionId   String
  agentId     String?
  type        String   @default("agent_invoke")
  // session_funding | treasury_prefund | agent_invoke
  payerWalletAddress    String?
  receiverWalletAddress String?
  amountUsdc  Float
  txHash      String?
  status      String   @default("pending")
  // pending | confirmed | failed
  description String?
  createdAt   DateTime @default(now())

  session Session @relation(fields: [sessionId], references: [id])
  agent   Agent?  @relation(fields: [agentId], references: [id])
}
```

---

## `server/llm.ts` — Exact API

```typescript
export interface LLMMessage {
  role:    'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
}

export interface LLMOptions {
  system?:      string
  temperature?: number
  max_tokens?:  number
}

export interface LLMTool {
  name:        string
  description: string
  parameters:  {
    type:       'object'
    properties: Record<string, { type: string; description: string; enum?: string[] }>
    required:   string[]
  }
}

export interface LLMToolCall {
  id:        string
  name:      string
  arguments: Record<string, any>
}

export interface LLMToolCallResponse {
  content:   string | null
  toolCalls: LLMToolCall[]
}

// Full response — for coordinator, judge, summarizer
export async function llmCall(
  messages: LLMMessage[],
  options?:  LLMOptions
): Promise<string>

// Streaming — yields tokens for chat panel
export async function* llmStream(
  messages: LLMMessage[],
  options?:  LLMOptions
): AsyncGenerator<string>

// Tool calling — for ReAct agent node
export async function llmCallWithTools(
  messages: LLMMessage[],
  tools:     LLMTool[],
  options?:  LLMOptions
): Promise<LLMToolCallResponse>
```

---

## `server/integrations/moonpay.ts` — Exact API

Wraps MoonPay CLI via `child_process.exec` or `@moonpay/sdk`. All functions throw on error.

```typescript
// ── Types ──────────────────────────────────────────────────────────────

export interface SwapQuoteParams {
  fromToken: string; // e.g. 'USDC'
  toToken: string; // e.g. 'ETH'
  amount: number; // in fromToken units
  chain: string; // e.g. 'base-sepolia'
  walletAddress: string;
}

export interface SwapQuote {
  fromToken: string;
  toToken: string;
  fromAmount: number;
  toAmount: number;
  priceImpactPct: number;
  slippagePct: number;
  estimatedGasUsdc: number;
  route: string;
  quoteId: string;
  expiresAt: number;
}

export interface SwapParams {
  quoteId: string;
  walletAddress: string;
  walletName: string; // OWS wallet name for signing
}

export interface SwapResult {
  txHash: string;
  fromAmount: number;
  toAmount: number;
  gasUsed: number;
  status: "confirmed" | "pending";
}

export interface BridgeQuoteParams {
  token: string;
  amount: number;
  fromChain: string;
  toChain: string;
  toAddress: string;
}

export interface BridgeQuote {
  token: string;
  amount: number;
  fromChain: string;
  toChain: string;
  estimatedOut: number;
  bridgeFeeUsdc: number;
  estimatedTimeMs: number;
  quoteId: string;
}

export interface BridgeResult {
  txHash: string;
  status: "confirmed" | "pending";
  outAmount: number;
}

export interface WalletBalance {
  token: string;
  amount: number;
  usdValue: number;
  chain: string;
}

// ── Functions ──────────────────────────────────────────────────────────

export async function getSwapQuote(params: SwapQuoteParams): Promise<SwapQuote>;

export async function executeSwap(params: SwapParams): Promise<SwapResult>;

export async function getBridgeQuote(
  params: BridgeQuoteParams,
): Promise<BridgeQuote>;

export async function executeBridge(
  params: BridgeParams,
): Promise<BridgeResult>;

export async function getWalletBalances(
  address: string,
  chain: string,
): Promise<WalletBalance[]>;

export async function getTokenBalance(
  address: string,
  token: string,
  chain: string,
): Promise<number>;
```

---

## `server/integrations/zerion.ts` — Exact API

Direct REST calls to `https://api.zerion.io/v1`. Auth: `Authorization: Basic base64(apiKey:)`.

```typescript
// ── Types ──────────────────────────────────────────────────────────────

export interface TokenPosition {
  name: string;
  symbol: string;
  chain: string;
  balance: number;
  balanceUsd: number;
  priceUsd: number;
  contractAddress: string;
}

export interface DeFiPosition {
  protocol: string;
  chain: string;
  type: "lending" | "borrowing" | "lp" | "staking" | "farming";
  valueUsd: number;
  apy?: number;
  tokens: string[];
}

export interface Portfolio {
  totalValueUsd: number;
  totalPositions: number;
  chains: string[];
  tokens: TokenPosition[];
  defiPositions: DeFiPosition[];
}

// ── Functions ──────────────────────────────────────────────────────────

// GET /v1/wallets/{address}/portfolio
export async function getPortfolio(address: string): Promise<Portfolio>;

// GET /v1/wallets/{address}/positions?filter[position_types]=wallet
export async function getTokenPositions(
  address: string,
): Promise<TokenPosition[]>;

// GET /v1/wallets/{address}/positions?filter[position_types]=deposited,staked,locked
export async function getDeFiPositions(
  address: string,
): Promise<DeFiPosition[]>;

// Convenience: full summary formatted for agent consumption
export async function getPortfolioSummary(address: string): Promise<string>;
```

---

## `server/integrations/defillama.ts` — Exact API

No API key. Base URL: `https://yields.llama.fi`.

```typescript
// ── Types ──────────────────────────────────────────────────────────────

export interface YieldPool {
  pool: string; // pool id
  chain: string;
  project: string; // protocol name e.g. 'aave-v3'
  symbol: string; // e.g. 'USDC'
  tvlUsd: number;
  apy: number;
  apyBase: number; // base APY without rewards
  apyReward: number; // reward APY (often inflationary — be careful)
  il7d: number; // 7d impermanent loss
  volumeUsd1d: number;
  stablecoin: boolean;
  ilRisk: "no" | "low" | "high";
  exposure: "single" | "multi";
}

export interface YieldFilters {
  chains?: string[]; // ['base', 'ethereum', 'arbitrum']
  projects?: string[]; // ['aave-v3', 'curve']
  minTvlUsd?: number; // 50_000_000
  minApy?: number; // 3
  maxApy?: number; // 30 — cap to avoid obvious farming traps
  stablecoinOnly?: boolean;
  noIlRisk?: boolean;
}

export interface ProtocolInfo {
  name: string;
  tvl: number;
  tvl7dChange: number;
  tvl30dChange: number;
  audits: number;
  category: string;
}

// ── Functions ──────────────────────────────────────────────────────────

// GET /pools — returns all pools, then filter client-side
export async function getYieldPools(
  filters: YieldFilters,
): Promise<YieldPool[]>;

// GET /chart/{poolId} — historical APY/TVL for a specific pool
export async function getPoolHistory(
  poolId: string,
  days?: number, // default 30
): Promise<Array<{ date: string; apy: number; tvlUsd: number }>>;

// https://api.llama.fi/protocol/{protocol}
export async function getProtocolInfo(protocol: string): Promise<ProtocolInfo>;

// Convenience: top N pools matching filters, sorted by real APY (base only, no rewards)
export async function getTopPools(
  filters: YieldFilters,
  limit?: number, // default 5
): Promise<YieldPool[]>;
```

---

## `server/wallet.ts` — Exact API

```typescript
import {
  createWallet,
  signMessage,
  signTransaction,
  getAddress,
} from "@open-wallet-standard/core";

// ── Types ──────────────────────────────────────────────────────────────

export interface WalletInfo {
  name: string;
  address: string; // EVM address on PAYMENT_NETWORK
  balance?: number; // USDC balance if fetched
}

export interface X402PaymentInfo {
  amount: string; // USDC amount as string e.g. '0.05'
  token: "USDC";
  network: string; // e.g. 'base-sepolia'
  address: string; // recipient address
  chainId: number;
}

// ── Wallet lifecycle ───────────────────────────────────────────────────

export async function createAgentWallet(name: string): Promise<WalletInfo>;

export async function getWalletAddress(name: string): Promise<string>;

export async function getWalletBalance(name: string): Promise<number>;

// ── User funding intent via WalletConnect (MetaMask) ─────────────────

export interface SessionFundingIntent {
  sessionId: string;
  amountUsdc: number;
  tokenAddress: string;
  tokenSymbol: "USDC";
  chain: string;
  chainId: number;
  receiverAddress: string; // master/session receiving wallet
}

export async function createSessionFundingIntent(
  sessionId: string,
  userWallet: string,
  budgetUsdc: number,
): Promise<SessionFundingIntent>;

export async function verifySessionFunding(
  sessionId: string,
  txHash: string,
): Promise<{ confirmed: boolean; amountUsdc: number }>;

export async function prefundMasterWallet(
  userWallet: string,
  amountUsdc: number,
  txHash: string,
): Promise<{ confirmed: boolean; newTreasuryBalance: number }>;

// ── Tier 1→2: Treasury funds a new session wallet ─────────────────────

export async function fundSessionWallet(
  sessionId: string,
  budgetUsdc: number,
): Promise<{ walletName: string; walletAddress: string; txHash: string }>;

// ── Tier 2: Session wallet pays x402 endpoint ─────────────────────────

export async function payX402(
  walletName: string,
  paymentInfo: X402PaymentInfo,
): Promise<{ txHash: string; amountPaid: number }>;

// ── Sweep remainder back to Treasury on session end ───────────────────

export async function sweepSessionWallet(sessionId: string): Promise<void>;
```

---

## `server/virtualWallet.ts` — Exact API

```typescript
import crypto from "crypto";
import { db } from "./db";

// Derive deterministic address from agentId — no real wallet created
export function deriveVirtualAddress(agentId: string): string {
  const hash = crypto.createHash("sha256").update(agentId).digest("hex");
  return "0x" + hash.slice(0, 40);
}

// Get virtual balance from DB
export async function getVirtualBalance(agentId: string): Promise<number>;

// Atomic session-level spend reservation — prevents race conditions
// Returns false if session budget ceiling would be breached
export async function reserveSessionBudget(
  sessionId: string,
  amountUsdc: number,
): Promise<boolean>;

// Deduct from agent's virtual budget after actual spend
export async function deductAgentBudget(
  agentId: string,
  amountUsdc: number,
): Promise<void>;
```

---

## `server/policy.ts` — Exact API

```typescript
export interface ProposedTx {
  amountUsdc: number;
  token: string;
  chain: string;
  protocol: string;
  estimatedSlippagePct: number;
  estimatedGasUsdc: number;
  sessionSpentUsdc: number;
  simulationPassed: boolean;
}

export interface PolicyConfig {
  maxSingleTxUsdc: number;
  maxSessionSpendUsdc: number;
  maxSlippagePct: number;
  maxGasUsdc: number;
  allowedTokens: string[];
  allowedChains: string[];
  allowedProtocols: string[];
  requireSimulation: boolean;
}

export type PolicyViolationCode =
  | "AMOUNT_EXCEEDED"
  | "SESSION_BUDGET_EXCEEDED"
  | "SLIPPAGE_EXCEEDED"
  | "GAS_EXCEEDED"
  | "TOKEN_NOT_ALLOWED"
  | "CHAIN_NOT_ALLOWED"
  | "PROTOCOL_NOT_ALLOWED"
  | "SIMULATION_REQUIRED";

export type PolicyResult =
  | { ok: true }
  | { ok: false; reason: string; code: PolicyViolationCode };

export const DEFAULT_POLICY: PolicyConfig = {
  maxSingleTxUsdc: 500,
  maxSessionSpendUsdc: 2.0,
  maxSlippagePct: 2,
  maxGasUsdc: 5,
  allowedTokens: ["USDC", "WETH", "WBTC"],
  allowedChains: ["base-sepolia"],
  allowedProtocols: ["aave-v3", "curve", "pendle", "uniswap-v3"],
  requireSimulation: true,
};

export function checkPolicy(
  tx: ProposedTx,
  policy?: PolicyConfig,
): PolicyResult;
```

---

## `server/emit.ts` — Exact API

```typescript
import { Server } from "socket.io";

let _io: Server;

export function initEmit(io: Server): void;

// All events scoped to session room — never broadcast globally
export function emit(sessionId: string, event: SocketEvent, data: object): void;

export type SocketEvent =
  | "session:started"
  | "session:awaiting_approval"
  | "session:complete"
  | "session:failed"
  | "agent:spawned"
  | "agent:thinking"
  | "agent:complete"
  | "agent:failed"
  | "tool:called"
  | "tool:result"
  | "payment:confirmed"
  | "payment:failed"
  | "wallet:update"
  | "treasury:update";
```

---

## `server/agent/tools.ts` — Tool Schemas for LangGraph

These are the only two tools the master LLM sees.

```typescript
import { LLMTool } from "../llm";

export const SPAWN_SUB_AGENT_TOOL: LLMTool = {
  name: "spawn_sub_agent",
  description:
    "Spawn a specialist agent to handle a specific subtask. Blocks until complete.",
  parameters: {
    type: "object",
    properties: {
      role: {
        type: "string",
        description: "Agent role — determines which specialist runs",
        enum: [
          "Portfolio Scout",
          "Yield Scanner",
          "Risk Analyst",
          "Route Planner",
          "Executor",
        ],
      },
      task: {
        type: "string",
        description:
          "Specific instruction for this agent. Be explicit about tokens, chains, amounts.",
      },
      context: {
        type: "string",
        description:
          "Relevant data from previous agents to pass in as context.",
      },
    },
    required: ["role", "task"],
  },
};

export const REQUEST_APPROVAL_TOOL: LLMTool = {
  name: "request_approval",
  description:
    "Pause and request human approval before proceeding. Use before spawning research agents (phase=research) and before executing transactions (phase=execution).",
  parameters: {
    type: "object",
    properties: {
      phase: {
        type: "string",
        enum: ["research", "execution"],
      },
      reason: {
        type: "string",
        description: "Why approval is needed",
      },
      plan: {
        type: "array",
        description: "List of agents or steps to be approved",
        items: {
          type: "object",
          properties: {
            role: { type: "string" },
            task: { type: "string" },
            costUsdc: { type: "number" },
          },
        },
      },
      totalEstimatedCostUsdc: {
        type: "number",
      },
    },
    required: ["phase", "reason", "plan", "totalEstimatedCostUsdc"],
  },
};

export const ALL_TOOLS = [SPAWN_SUB_AGENT_TOOL, REQUEST_APPROVAL_TOOL];
```

---

## `server/tools/spawnSubAgent.ts` — Exact Implementation

```typescript
import { db } from "../db";
import { emit } from "../emit";
import {
  reserveSessionBudget,
  deriveVirtualAddress,
  deductAgentBudget,
} from "../virtualWallet";
import { payX402 } from "../wallet";
import { X402PaymentInfo } from "../wallet";

const ROLE_PRICES: Record<string, number> = {
  "Portfolio Scout": Number(process.env.PRICE_PORTFOLIO_SCOUT) || 0.02,
  "Yield Scanner": Number(process.env.PRICE_YIELD_SCANNER) || 0.05,
  "Risk Analyst": Number(process.env.PRICE_RISK_ANALYST) || 0.03,
  "Route Planner": Number(process.env.PRICE_ROUTE_PLANNER) || 0.03,
  Executor: Number(process.env.PRICE_EXECUTOR) || 0.02,
};

const ROLE_ENDPOINTS: Record<string, string> = {
  "Portfolio Scout": "/agents/portfolio-scout",
  "Yield Scanner": "/agents/yield-scanner",
  "Risk Analyst": "/agents/risk-analyst",
  "Route Planner": "/agents/route-planner",
  Executor: "/agents/executor",
};

export interface SpawnInput {
  role: string;
  task: string;
  context?: string;
}

export interface SpawnOutput {
  agentId: string;
  output: string;
  spentUsdc: number;
  status: "complete" | "failed";
  durationMs: number;
}

export async function spawnSubAgent(
  input: SpawnInput,
  parentAgentId: string,
  sessionId: string,
  sessionWalletName: string,
): Promise<SpawnOutput>;
```

---

## `server/tools/requestApproval.ts` — Exact Implementation

```typescript
import { interrupt } from "@langchain/langgraph";
import { emit } from "../emit";
import { db } from "../db";

export type ApprovalPhase = "research" | "execution";

export interface PlanItem {
  role: string;
  task: string;
  costUsdc: number;
}

export interface ApprovalInput {
  phase: ApprovalPhase;
  reason: string;
  plan: PlanItem[];
  totalEstimatedCostUsdc: number;
}

export interface ApprovalOutput {
  phase: ApprovalPhase;
  approved: boolean;
}

// Emits session:awaiting_approval then calls interrupt()
// Resumes when POST /api/sessions/:id/approve is called
export async function requestApproval(
  input: ApprovalInput,
  sessionId: string,
): Promise<ApprovalOutput>;
```

---

## Sub-Agent Handlers (`server/subagents/`)

Each file exports a single Express handler wrapped in `@x402/express` middleware.

### `portfolioScout.ts`

```typescript
import { Router } from "express";
import { paymentMiddleware } from "@x402/express";
import { getPortfolioSummary } from "../integrations/zerion";

// POST /agents/portfolio-scout
// x402: $0.02 USDC
export function portfolioScoutHandler(): Router;

interface PortfolioScoutInput {
  task: string; // "Read positions for wallet 0x..."
  context?: string;
}

interface PortfolioScoutOutput {
  output: string; // human-readable summary for LLM
  data: {
    totalValueUsd: number;
    topPositions: Array<{ symbol: string; balanceUsd: number; chain: string }>;
    defiPositions: Array<{
      protocol: string;
      type: string;
      valueUsd: number;
      apy?: number;
    }>;
  };
}
```

### `yieldScanner.ts`

```typescript
import { getTopPools } from "../integrations/defillama";

// POST /agents/yield-scanner
// x402: $0.05 USDC
export function yieldScannerHandler(): Router;

interface YieldScannerInput {
  task: string; // "Find best yield for USDC on Base + Arbitrum, medium risk"
  context?: string;
}

interface YieldScannerOutput {
  output: string;
  data: {
    pools: Array<{
      protocol: string;
      chain: string;
      symbol: string;
      apy: number; // base only — no inflationary rewards
      apyWithRewards: number;
      tvlUsd: number;
      ilRisk: string;
      poolId: string;
    }>;
  };
}
```

### `riskAnalyst.ts`

```typescript
import { getProtocolInfo, getPoolHistory } from "../integrations/defillama";

// POST /agents/risk-analyst
// x402: $0.03 USDC
export function riskAnalystHandler(): Router;

interface RiskAnalystInput {
  task: string; // "Score Curve 3pool Base, Aave USDC Arbitrum, Pendle USDC"
  context?: string; // pool list from yield scanner
}

interface RiskScore {
  protocol: string;
  chain: string;
  score: number; // 1-10
  tvlStability: "stable" | "declining" | "volatile";
  auditCount: number;
  hasRewardToken: boolean;
  rewardInflation: "none" | "low" | "high";
  recommendation: "safe" | "caution" | "avoid";
  reasoning: string;
}

interface RiskAnalystOutput {
  output: string;
  data: {
    scores: RiskScore[];
    topPick: string; // protocol name
  };
}
```

### `routePlanner.ts`

```typescript
import { getSwapQuote, getBridgeQuote } from "../integrations/moonpay";

// POST /agents/route-planner
// x402: $0.03 USDC
export function routePlannerHandler(): Router;

interface RoutePlannerInput {
  task: string; // "Plan execution: swap 5000 USDC → deposit Curve 3pool Base"
  context?: string; // risk scores + top pick from previous agents
}

export interface ExecutionStep {
  stepNumber: number;
  type: "swap" | "bridge" | "deposit";
  fromToken: string;
  toToken?: string;
  amount: number;
  fromChain: string;
  toChain?: string;
  protocol?: string;
  fromPriceUsd: number;
  toPriceUsd?: number;
  // Filled after simulation
  quoteId?: string;
  estimatedOut?: number;
  slippagePct?: number;
  estimatedGasUsdc?: number;
  simulationPassed?: boolean;
}

interface RoutePlannerOutput {
  output: string;
  data: {
    steps: ExecutionStep[];
    totalGasUsdc: number;
    estimatedSlippage: number;
    worstCaseOut: number;
  };
}
```

### `executor.ts`

```typescript
import { executeSwap, executeBridge } from "../integrations/moonpay";
import { checkPolicy, DEFAULT_POLICY } from "../policy";

// POST /agents/executor
// x402: $0.02 USDC
export function executorHandler(): Router;

interface ExecutorInput {
  task: string;
  context: string; // execution steps JSON from route planner — required
  sessionId: string;
}

interface StepResult {
  stepNumber: number;
  status: "executed" | "simulation_failed" | "policy_rejected" | "tx_failed";
  txHash?: string;
  reason?: string;
  code?: string;
}

interface ExecutorOutput {
  output: string;
  data: {
    steps: StepResult[];
    executed: number;
    rejected: number;
    txHashes: string[];
  };
}
```

---

## `server/routes/sessions.ts` — Exact Endpoints

```typescript
import { Router }        from 'express'
import { db }            from '../db'
import { fundSessionWallet, sweepSessionWallet } from '../wallet'
import { runAgent }      from '../agent/runner'
import { agentGraph }    from '../agent/graph'

const router = Router()

// POST /api/sessions
// Body: {
//   task: string,
//   budgetUsdc: number,
//   userWalletAddress: string,
//   fundingMode?: 'pay_per_session' | 'prefunded_master'
// }
// Creates session.
// - pay_per_session: returns funding intent and keeps status=pending_funding
// - prefunded_master: validates treasury balance then starts master immediately
// Returns: { sessionId, status, fundingIntent?, masterAgentId?, sessionWalletAddress? }
router.post('/', async (req, res) => { ... })

// POST /api/sessions/:id/funding-intent
// Body: { userWalletAddress: string }
// Returns Sepolia USDC payment requirements for WalletConnect send
router.post('/:id/funding-intent', async (req, res) => { ... })

// POST /api/sessions/:id/funding-confirm
// Body: { txHash: string }
// Verifies transfer to receiving wallet; if confirmed, marks funded and starts master agent
// Returns: { status: 'running', masterAgentId, sessionWalletAddress }
router.post('/:id/funding-confirm', async (req, res) => { ... })

// GET /api/sessions
// Returns: { sessions: Session[] } sorted by createdAt desc
router.get('/', async (req, res) => { ... })

// GET /api/sessions/:id
// Returns: { session, agents, toolCalls, payments }
router.get('/:id', async (req, res) => { ... })

// POST /api/sessions/:id/approve
// Body: { phase: 'research' | 'execution', approved: boolean }
// Resumes LangGraph interrupt for the given phase
router.post('/:id/approve', async (req, res) => { ... })

export default router
```

---

## `server/routes/wallet.ts` — Exact Endpoints

```typescript
const router = Router()

// GET /api/wallet
// Returns master treasury wallet info + session wallet list
// Response: { address, balance, network, recentSessions: [...] }
router.get('/', async (req, res) => { ... })

// POST /api/wallet/fund
// Body: { amountUsdc: number, userWalletAddress: string, txHash: string }
// Records/validates WalletConnect prefund transfer from user wallet to master treasury wallet
// Response: { txHash, newBalance, confirmed }
router.post('/fund', async (req, res) => { ... })

export default router
```

---

## `server/routes/subagents.ts`

```typescript
import { portfolioScoutHandler } from "../subagents/portfolioScout";
import { yieldScannerHandler } from "../subagents/yieldScanner";
import { riskAnalystHandler } from "../subagents/riskAnalyst";
import { routePlannerHandler } from "../subagents/routePlanner";
import { executorHandler } from "../subagents/executor";

// Mounts all x402-gated sub-agent endpoints
// POST /agents/portfolio-scout
// POST /agents/yield-scanner
// POST /agents/risk-analyst
// POST /agents/route-planner
// POST /agents/executor
export function mountSubAgentRoutes(app: Express): void;
```

---

## `server/index.ts` — Bootstrap

```typescript
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { initEmit } from "./emit";
import { mountSubAgentRoutes } from "./routes/subagents";
import sessionsRouter from "./routes/sessions";
import walletRouter from "./routes/wallet";

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: process.env.FRONTEND_URL } });

// Socket.io rooms — explicit
io.on("connection", (socket) => {
  socket.on("session:subscribe", ({ sessionId }) =>
    socket.join(`session:${sessionId}`),
  );
  socket.on("session:unsubscribe", ({ sessionId }) =>
    socket.leave(`session:${sessionId}`),
  );
});

initEmit(io);

app.use(express.json());
app.use("/api/sessions", sessionsRouter);
app.use("/api/wallet", walletRouter);
mountSubAgentRoutes(app); // mounts /agents/* x402 endpoints
```

---

## Socket.io Events

### Server → Client

| Event                       | Payload                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `session:funding_required`  | `{ sessionId, amountUsdc, tokenSymbol, tokenAddress, chain, chainId, receiverAddress }` |
| `session:funded`            | `{ sessionId, txHash, fundedAmountUsdc, fundingMode }`                                  |
| `session:started`           | `{ sessionId, masterAgentId, sessionWalletAddress }`                                    |
| `session:awaiting_approval` | `{ sessionId, phase, plan: PlanItem[], totalCost, walletBalance }`                      |
| `session:complete`          | `{ sessionId, output, totalSpent, durationMs, agentCount }`                             |
| `session:failed`            | `{ sessionId, error }`                                                                  |
| `agent:spawned`             | `{ sessionId, agent: Agent }`                                                           |
| `agent:thinking`            | `{ sessionId, agentId, token }`                                                         |
| `agent:complete`            | `{ sessionId, agentId, output, spentUsdc, durationMs }`                                 |
| `agent:failed`              | `{ sessionId, agentId, error }`                                                         |
| `tool:called`               | `{ sessionId, agentId, toolCall: ToolCall }`                                            |
| `tool:result`               | `{ sessionId, agentId, toolCallId, output, durationMs }`                                |
| `payment:confirmed`         | `{ sessionId, agentId, amountUsdc, txHash, description }`                               |
| `payment:failed`            | `{ sessionId, agentId, error }`                                                         |
| `wallet:update`             | `{ sessionId, agentId, spentUsdc, remainingUsdc }`                                      |
| `treasury:update`           | `{ sessionId, totalSpent, remaining }`                                                  |

### Client → Server

| Event                 | Payload         |
| --------------------- | --------------- |
| `session:subscribe`   | `{ sessionId }` |
| `session:unsubscribe` | `{ sessionId }` |

---

## Error Handling

| Scenario                                | Behavior                                        | Demo Risk |
| --------------------------------------- | ----------------------------------------------- | --------- |
| WalletConnect rejected by user          | Keep `pending_funding`, session not started     | Medium    |
| Funding tx pending too long             | Poll by txHash + show retry/replace guidance    | High      |
| Funding amount lower than budget        | Keep `pending_funding`, show shortfall          | High      |
| Funding tx to wrong address/token/chain | Reject confirmation, do not start session       | Critical  |
| LLM skips delegation                    | Retry once; then force deterministic core plan  | Medium    |
| x402 payment fails                      | Mark agent failed, continue session             | High      |
| Budget reservation race                 | `reserveSessionBudget` blocks early, no payment | Critical  |
| Policy violation                        | Executor rejects step, notes in output          | Critical  |
| Simulation fails                        | Step skipped, reason included in output         | Critical  |
| Partner API timeout                     | Retry + cached fallback snapshot                | Medium    |
| Session wallet underfunded              | Session never starts, 400 returned              | High      |
| Agent timeout (3min)                    | Mark failed, master continues with rest         | Medium    |
| Server crash                            | PostgresSaver resumes from checkpoint           | Medium    |

---

---

# FRONTEND PRD

---

## Tech Stack

| Layer      | Technology                                      |
| ---------- | ----------------------------------------------- |
| Framework  | Next.js 14 (App Router)                         |
| Language   | TypeScript                                      |
| Styling    | Tailwind CSS                                    |
| Canvas     | `reactflow` + incremental layout                |
| Animations | Framer Motion                                   |
| Real-time  | `socket.io-client`                              |
| Markdown   | `react-markdown`                                |
| State      | `useReducer` + React Context                    |
| Fonts      | `JetBrains Mono` (data/code), `Inter` (UI text) |

---

## Sci-Fi Theme

### Design Philosophy

HUD (heads-up display) aesthetic. Dark space background with neon glows. Monospace fonts for all data. Panel borders glow. Agent nodes feel like entity cards in a tactical interface. The whole UI looks like you're commanding a fleet.

### Color Palette

```typescript
// tailwind.config.ts — extend colors
export const scifi = {
  bg: "#010b0f", // deep space black
  surface: "#051a24", // dark panel background
  surface2: "#0a2535", // elevated surface
  border: "#0e3d52", // default border
  borderGlow: "#00b4d8", // glowing border

  // Neon accents
  cyan: "#00f5ff", // primary accent — agent running, highlights
  green: "#00ff88", // success, complete, payment confirmed
  yellow: "#ffe600", // warning, awaiting approval
  red: "#ff2d55", // error, failed
  purple: "#bf5fff", // judging, processing

  // Text
  textPrimary: "#c8f0f8",
  textMuted: "#4a8fa8",
  textDim: "#1e5c73",

  // Agent status
  agentRunning: "#00b4d8", // cyan border + pulse
  agentApproval: "#ffe600", // yellow border + pulse
  agentComplete: "#00ff88", // green border
  agentFailed: "#ff2d55", // red border
};
```

### Typography

```css
/* Monospace for all data: wallet addresses, amounts, timestamps, tx hashes */
font-family: "JetBrains Mono", monospace;

/* UI labels, headings, nav */
font-family: "Inter", sans-serif;
```

### Reusable Visual Elements

```
Scan line overlay:     repeating horizontal lines, 2px each, 4px gap, 3% opacity
Grid background:       #0a2535 dots, 20px spacing, on main background
Glow effect:           box-shadow: 0 0 8px {color}, 0 0 20px {color}40
Pulsing border:        @keyframes borderPulse { 0% opacity 1, 50% opacity 0.4 }
Data chip:             bg #0a2535, border #0e3d52, font-mono, text-xs
Panel header:          bg #051a24, border-b #0e3d52, uppercase tracking-widest
```

### Tailwind Classes (Reusable)

```
sci-panel:      bg-[#051a24] border border-[#0e3d52] rounded-lg
sci-panel-glow: bg-[#051a24] border border-[#00b4d8] shadow-[0_0_12px_#00b4d820]
sci-text-data:  font-mono text-[#c8f0f8] text-sm
sci-text-muted: font-mono text-[#4a8fa8] text-xs
sci-badge:      font-mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded
sci-address:    font-mono text-[#4a8fa8] text-xs hover:text-[#00f5ff] transition
```

---

## Pages

### `/` — Landing

```
[scan lines overlay]
[dot grid background]

        ██████╗ ██╗  ██╗███╗   ███╗██╗   ██╗    ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
       ██╔═══██╗██║  ██║████╗ ████║╚██╗ ██╔╝    ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
       ██║   ██║███████║██╔████╔██║ ╚████╔╝     ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
       ██║   ██║██╔══██║██║╚██╔╝██║  ╚██╔╝      ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
       ╚██████╔╝██║  ██║██║ ╚═╝ ██║   ██║       ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
        ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝   ╚═╝       ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝

  [dim]  AUTONOMOUS DEFI INTELLIGENCE · POWERED BY OWS + x402 + MOONPAY + ZERION  [/dim]

  ┌── MISSION INPUT ──────────────────────────────────────────────────────────────────────────┐
  │  >_                                                                                        │
  │  "I have $5k USDC idle, medium risk — find the best yield right now"                      │
  │                                                                                            │
  └────────────────────────────────────────────────────────────────────────────────────────────┘
                              [ DEPLOY SWARM → ]

  ─── SUGGESTED MISSIONS ────────────────────────────────────────────
  > "Optimize my portfolio for max yield, low risk"
  > "Find best stablecoin yield across Base and Arbitrum"
  > "Bridge 2k USDC to Base and deploy it"
```

---

### `/session/[id]` — Command Center

```
┌──── SWARM CANVAS ────────────────────────┬──── TERMINAL ──────────────────────────┐
│                                          │  ┌────────────┬──────────────────────┐ │
│  [React Flow · dark theme · HUD nodes]  │  │   CHAT     │      DETAILS         │ │
│                                          │  └────────────┴──────────────────────┘ │
│  [Master Agent]                          │                                        │
│       │                                  │  [scrolling sci-fi activity log]      │
│       ├──[Portfolio Scout] ●running      │                                        │
│       ├──[Yield Scanner]   ●running      │                                        │
│       ├──[Risk Analyst]    ○waiting      │                                        │
│       └──[Route Planner]   ○waiting      │                                        │
│                                          │                                        │
└──────────────────────────────────────────┴────────────────────────────────────────┘
```

---

### `/sessions` — Mission Log

```
┌── MISSION LOG ─────────────────────────────────────────────────────────────────────┐
│                                                                                     │
│  MISSION                                          AGENTS  COST    TIME   STATUS    │
│  ──────────────────────────────────────────────────────────────────────────────── │
│  Find best yield for $5k USDC, medium risk         5      $0.15   41s   ✓ DONE    │
│  Optimize portfolio, low risk                      4      $0.13   36s   ✓ DONE    │
│  Bridge $2k USDC to Base + deploy                  5      $0.15   44s   ✓ DONE    │
│  Best stablecoin yield on Arbitrum                 4      $0.10   29s   ✗ FAILED  │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

### `/wallet` — Treasury

```
┌── TREASURY WALLET ────────────────────────────────────────────────┐
│                                                                    │
│  ADDRESS    0x7f3a...c2d1                          [Base Sepolia] │
│  BALANCE    1.56 USDC                                              │
│                                                                    │
│  ─── TOP UP ──────────────────────────────────────────────────── │
│  AMOUNT     [  2.00  ] USDC                  [ FUND WALLET ]     │
│                                                                    │
│  ─── ACTIVITY ────────────────────────────────────────────────── │
│  10:31   Session: yield scan    -$0.15   tx:0x7f...   ✓          │
│  10:15   Top up                 +$2.00   tx:0xa3...   ✓          │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Funding UX (WalletConnect + MetaMask)

- Landing includes `task` + `budgetUsdc` input.
- User connects wallet via WalletConnect (MetaMask).
- On session create, if funding mode is `pay_per_session`, frontend shows `PayBudgetModal` with Sepolia USDC transfer details.
- After tx confirmation, frontend calls `/api/sessions/:id/funding-confirm` and only then transitions to live session view.
- `/wallet` page supports `pre-fund master wallet` flow using the same connected wallet.

---

## Folder Structure

```
frontend/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── session/[id]/page.tsx
│   ├── sessions/page.tsx
│   └── wallet/page.tsx
├── components/
│   ├── canvas/
│   │   ├── AgentCanvas.tsx
│   │   ├── AgentNode.tsx
│   │   └── SpawnEdge.tsx
│   ├── terminal/
│   │   ├── TerminalPanel.tsx
│   │   ├── ChatTab.tsx
│   │   └── DetailsTab.tsx
│   ├── modals/
│   │   ├── ResearchApprovalModal.tsx
│   │   └── ExecutionApprovalModal.tsx
│   └── shared/
│       ├── SciFiPanel.tsx
│       ├── StatusBadge.tsx
│       ├── AddressChip.tsx
│       └── AnimatedNumber.tsx
├── hooks/
│   ├── useSocket.ts
│   └── useSession.ts
├── lib/
│   ├── api.ts
│   └── seedReplay.ts
└── types.ts
```

---

## `frontend/types.ts` — Shared Types

```typescript
// Mirrors server types exactly

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
export type ApprovalPhase = "research" | "execution";
export type FundingMode = "pay_per_session" | "prefunded_master";

export interface Session {
  id: string;
  task: string;
  status: SessionStatus;
  fundingMode: FundingMode;
  userWalletAddress?: string;
  fundingTxHash?: string;
  fundedAt?: string;
  masterAgentId?: string;
  sessionWalletAddress?: string;
  budgetUsdc: number;
  spentUsdc: number;
  finalOutput?: string;
  agentCount: number;
  durationMs?: number;
  isSeeded: boolean;
  createdAt: string;
}

export interface Agent {
  id: string;
  sessionId: string;
  parentAgentId?: string;
  depth: number;
  role: string;
  task: string;
  status: AgentStatus;
  walletAddress?: string;
  budgetUsdc: number;
  spentUsdc: number;
  output?: string;
  toolCallCount: number;
  createdAt: string;
  completedAt?: string;
}

export interface ToolCall {
  id: string;
  agentId: string;
  sessionId: string;
  toolName: string;
  input: Record<string, any>;
  output?: Record<string, any>;
  status: "pending" | "running" | "done" | "failed";
  durationMs?: number;
  createdAt: string;
}

export interface Payment {
  id: string;
  sessionId: string;
  agentId?: string;
  type: "session_funding" | "treasury_prefund" | "agent_invoke";
  payerWalletAddress?: string;
  receiverWalletAddress?: string;
  amountUsdc: number;
  txHash?: string;
  status: PaymentStatus;
  description?: string;
  createdAt: string;
}

export interface PlanItem {
  role: string;
  task: string;
  costUsdc: number;
}

export interface ApprovalRequest {
  phase: ApprovalPhase;
  reason: string;
  plan: PlanItem[];
  totalEstimatedCostUsdc: number;
  walletBalance: number;
  // execution phase extras
  simulationResults?: SimulationResult[];
  policyChecksPassed?: boolean;
}

export interface SimulationResult {
  step: number;
  type: string;
  expectedOut: number;
  slippagePct: number;
  gasUsdc: number;
  passed: boolean;
}

export interface ChatMessage {
  id: string;
  type:
    | "system"
    | "agent_thinking"
    | "agent_complete"
    | "payment"
    | "tool_call"
    | "approval_needed"
    | "final_output";
  agentId?: string;
  agentRole?: string;
  content: string;
  timestamp: number;
  meta?: Record<string, any>;
}
```

---

## `frontend/lib/api.ts` — Exact Functions

```typescript
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function createSession(input: {
  task: string;
  budgetUsdc: number;
  userWalletAddress: string;
  fundingMode: FundingMode;
}): Promise<{
  sessionId: string;
  status: SessionStatus;
  fundingIntent?: SessionFundingIntent;
  masterAgentId?: string;
}>;

export interface SessionFundingIntent {
  sessionId: string;
  amountUsdc: number;
  tokenSymbol: "USDC";
  tokenAddress: string;
  chain: string;
  chainId: number;
  receiverAddress: string;
}

export async function getSessionFundingIntent(
  id: string,
  userWalletAddress: string,
): Promise<SessionFundingIntent>;

export async function confirmSessionFunding(
  id: string,
  txHash: string,
): Promise<{ status: SessionStatus; masterAgentId?: string }>;

export async function getSession(id: string): Promise<{
  session: Session;
  agents: Agent[];
  toolCalls: ToolCall[];
  payments: Payment[];
}>;

export async function getSessions(): Promise<{ sessions: Session[] }>;

export async function approveSession(
  id: string,
  phase: ApprovalPhase,
  approved: boolean,
): Promise<{ status: string }>;

export async function getWallet(): Promise<{
  address: string;
  balance: number;
  network: string;
}>;

export async function fundWallet(input: {
  amountUsdc: number;
  userWalletAddress: string;
  txHash: string;
}): Promise<{ txHash: string; newBalance: number; confirmed: boolean }>;

export async function getSeedSession(): Promise<{
  session: Session;
  agents: Agent[];
  toolCalls: ToolCall[];
  payments: Payment[];
}>;
```

---

## `frontend/hooks/useSocket.ts` — Exact Implementation

```typescript
import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { SessionAction } from "./useSession";

export function useSocket(
  sessionId: string | null,
  dispatch: React.Dispatch<SessionAction>,
): { connected: boolean } {
  // Creates socket, joins session room, maps all server events to dispatch
  // Cleans up on unmount or sessionId change
  // Returns connection status for UI indicator
}

// Internal event → dispatch mappings:
// 'session:funding_required'   → SESSION_FUNDING_REQUIRED
// 'session:funded'             → SESSION_FUNDED
// 'session:awaiting_approval' → AWAITING_APPROVAL
// 'session:complete'          → SESSION_COMPLETE
// 'session:failed'            → SESSION_FAILED
// 'agent:spawned'             → AGENT_SPAWNED
// 'agent:thinking'            → AGENT_THINKING
// 'agent:complete'            → AGENT_COMPLETE
// 'agent:failed'              → AGENT_FAILED
// 'tool:called'               → TOOL_CALLED
// 'tool:result'               → TOOL_RESULT
// 'payment:confirmed'         → PAYMENT_CONFIRMED
// 'payment:failed'            → PAYMENT_FAILED
// 'wallet:update'             → WALLET_UPDATE
// 'treasury:update'           → TREASURY_UPDATE
```

---

## `frontend/hooks/useSession.ts` — Exact Reducer

```typescript
export interface SessionState {
  session: Session | null;
  agents: Record<string, Agent>; // keyed by agentId
  toolCalls: ToolCall[];
  payments: Payment[];
  chatMessages: ChatMessage[];
  streamingTokens: Record<string, string>; // agentId → partial text
  pendingApproval: ApprovalRequest | null;
  activeTab: "chat" | "details";
  selectedAgentId: string | null;
  finalOutput: string | null;
  connected: boolean;
}

export type SessionAction =
  | { type: "INIT"; payload: Partial<SessionState> }
  | { type: "SESSION_FUNDING_REQUIRED"; payload: SessionFundingIntent }
  | {
      type: "SESSION_FUNDED";
      payload: {
        txHash: string;
        fundedAmountUsdc: number;
        fundingMode: FundingMode;
      };
    }
  | { type: "AGENT_SPAWNED"; payload: { agent: Agent } }
  | { type: "AGENT_THINKING"; payload: { agentId: string; token: string } }
  | {
      type: "AGENT_COMPLETE";
      payload: {
        agentId: string;
        output: string;
        spentUsdc: number;
        durationMs: number;
      };
    }
  | { type: "AGENT_FAILED"; payload: { agentId: string; error: string } }
  | { type: "TOOL_CALLED"; payload: { toolCall: ToolCall } }
  | {
      type: "TOOL_RESULT";
      payload: { toolCallId: string; output: any; durationMs: number };
    }
  | { type: "PAYMENT_CONFIRMED"; payload: { payment: Payment } }
  | { type: "PAYMENT_FAILED"; payload: { agentId: string; error: string } }
  | {
      type: "WALLET_UPDATE";
      payload: { agentId: string; spentUsdc: number; remainingUsdc: number };
    }
  | {
      type: "TREASURY_UPDATE";
      payload: { totalSpent: number; remaining: number };
    }
  | { type: "AWAITING_APPROVAL"; payload: ApprovalRequest }
  | {
      type: "SESSION_COMPLETE";
      payload: { output: string; totalSpent: number; durationMs: number };
    }
  | { type: "SESSION_FAILED"; payload: { error: string } }
  | { type: "SELECT_AGENT"; payload: { agentId: string } }
  | { type: "SET_TAB"; payload: { tab: "chat" | "details" } }
  | { type: "SET_CONNECTED"; payload: { connected: boolean } };

export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState;

export const initialSessionState: SessionState;

// Convenience: derive ReactFlow nodes + edges from agents Record
export function agentsToFlowNodes(
  agents: Record<string, Agent>,
  selected: string | null,
): { nodes: Node[]; edges: Edge[] };
```

---

## `components/canvas/AgentNode.tsx` — Exact Props

```typescript
export interface AgentNodeData {
  agent: Agent;
  isSelected: boolean;
  apiLabel: string; // e.g. "Zerion API", "DefiLlama", "MoonPay CLI"
  streaming?: string; // partial output text while running
}

// Status → border color + glow
const STATUS_STYLES: Record<
  AgentStatus,
  { border: string; glow: string; dot: string }
> = {
  running: { border: "#00b4d8", glow: "#00b4d820", dot: "#00f5ff" },
  awaiting_approval: { border: "#ffe600", glow: "#ffe60020", dot: "#ffe600" },
  complete: { border: "#00ff88", glow: "#00ff8820", dot: "#00ff88" },
  failed: { border: "#ff2d55", glow: "#ff2d5520", dot: "#ff2d55" },
};

// Node visual:
// ┌─────────────────────────────────────┐
// │  YIELD SCANNER             ● ══════ │  ← role + animated status dot
// │  ─────────────────────────────────  │
// │  "Find best USDC pools on Base..."  │  ← task (2 lines max)
// │                                     │
// │  0x4a...f2 · Base Sepolia           │  ← monospace address
// │  ████████░░  $0.03 / $0.05   USDC   │  ← budget bar
// │                                     │
// │  DefiLlama                          │  ← api label (appears on running)
// │  > Scanning 847 pools...▌           │  ← streaming output
// └─────────────────────────────────────┘
```

---

## `components/canvas/AgentCanvas.tsx` — Exact Props

```typescript
export interface AgentCanvasProps {
  agents: Record<string, Agent>;
  streamingTokens: Record<string, string>;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
}

// Incremental layout — never repositions existing nodes
function positionNewNode(
  existingNodes: Node[],
  newAgent: Agent,
  parentAgent: Agent | null,
): { x: number; y: number };
// master → { x: 400, y: 50 }
// children → spaced 240px apart horizontally, 200px below parent
// never moves already-placed nodes
```

---

## `components/terminal/ChatTab.tsx` — Exact Props

```typescript
export interface ChatTabProps {
  messages: ChatMessage[];
  connected: boolean;
}

// Message rendering by type:
// system          → dim cyan, uppercase, no agent name
// agent_thinking  → cyan "> [ROLE]" + streaming text + blinking cursor
// agent_complete  → green "✓ [ROLE] complete · Xs · $Y USDC"
// payment         → green-tinted row "💸 $X → [ROLE] · tx:0x... · x402"
// tool_call       → orange collapsed row, click to expand input/output
// approval_needed → yellow pulsing "⚡ APPROVAL REQUIRED" + button
// final_output    → full-width markdown render + stats row
```

---

## `components/modals/ResearchApprovalModal.tsx` — Exact Props

```typescript
export interface ResearchApprovalModalProps {
  request: ApprovalRequest; // phase === 'research'
  onApprove: () => Promise<void>;
  onCancel: () => void;
}
// Shows plan items with stagger animation (100ms each)
// Shows research cost, wallet balance, balance after
// Note: "No funds moved to protocols until Step 2"
```

---

## `components/modals/ExecutionApprovalModal.tsx` — Exact Props

```typescript
export interface ExecutionApprovalModalProps {
  request: ApprovalRequest; // phase === 'execution'
  onApprove: () => Promise<void>;
  onCancel: () => void;
}
// Shows recommended protocol + risk score
// Shows each execution step with simulation result (✓ passed / ✗ failed)
// Shows gas estimate, worst case output
// Shows "✓ All 7 policy checks passed" badge
// Warning: "⚠ This moves real testnet funds"
```

---

## `components/shared/` — Exact Props

```typescript
// Sci-fi bordered panel with optional glow
export interface SciFiPanelProps {
  children: React.ReactNode;
  glow?: boolean; // neon border glow
  label?: string; // panel header label (uppercase)
  className?: string;
}

// Colored status badge
export interface StatusBadgeProps {
  status: AgentStatus | SessionStatus;
  pulse?: boolean;
}
// running → cyan "● ACTIVE" pulse
// complete → green "✓ DONE"
// failed → red "✗ FAILED"
// awaiting_approval → yellow "⚡ WAITING" pulse

// Truncated monospace address with copy-on-click
export interface AddressChipProps {
  address: string;
  chars?: number; // default 6 (shows 0x1234...abcd)
  explorer?: string; // optional block explorer base URL
}

// Number that animates to new value (spring easing)
export interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  prefix?: string; // '$', ''
  suffix?: string; // ' USDC'
}
```

---

## `frontend/lib/seedReplay.ts` — Exact API

```typescript
export interface SeedEvent {
  event: string;
  payload: object;
  delayMs: number; // delay from previous event
}

// Pre-built event timeline for the demo session
export const SEED_EVENTS: SeedEvent[];

// Replays seed events with realistic timing delays
// Dispatches each event to session reducer
export async function replaySeedSession(
  dispatch: React.Dispatch<SessionAction>,
): Promise<void>;
```

---

## npm Packages

```bash
# Backend
npm install express socket.io cors \
  @langchain/langgraph @langchain/langgraph-checkpoint-postgres \
  @open-wallet-standard/core \
  @x402/express @x402/core \
  @prisma/client prisma \
  uuid dotenv node-fetch

npm install -D tsx typescript \
  @types/express @types/node @types/uuid @types/cors

# Frontend
npm install reactflow framer-motion \
  socket.io-client react-markdown \
  @tailwindcss/typography \
  @fontsource/jetbrains-mono @fontsource/inter
```

---

## Build Order (12 Hours)

| Hours | What                                                                                           | Milestone            |
| ----- | ---------------------------------------------------------------------------------------------- | -------------------- |
| 0–1   | `llm.ts` curl test + Prisma schema + `prisma migrate dev`                                      | Infra live           |
| 1–2   | WalletConnect + MetaMask flow + `/api/sessions/:id/funding-*` + `/api/wallet/fund` verify path | Funding gate working |
| 2–3   | LangGraph graph + PostgresSaver + `runner.ts` + hard limits                                    | Graph stable         |
| 3–4   | `policy.ts` + `reserveSessionBudget` atomic lock                                               | Safety layer         |
| 4–5   | Integrations: `zerion.ts`, `defillama.ts`, `moonpay.ts` basic calls                            | Data flowing         |
| 5–6   | 5 x402 sub-agent handlers + simulation in executor                                             | x402 live            |
| 6–7   | `spawnSubAgent.ts` + `requestApproval.ts` + full agent loop                                    | End-to-end loop      |
| 7–8   | Socket.io rooms + all emit events wired                                                        | Real-time working    |
| 8–9   | `AgentCanvas` + `AgentNode` sci-fi theme (seed data first)                                     | Canvas looks great   |
| 9–10  | `ChatTab` + both Approval Modals                                                               | Terminal panel done  |
| 10–11 | Wire frontend to backend + `seedReplay.ts` + `/sessions` page                                  | Demo ready           |
| 11–12 | Polish + smoke tests × 5 + demo script rehearsal                                               | Ship                 |

**Hard gates:**

- T-120: If simulation/policy broken → lock Executor to dry-run (log tx, skip execute)
- T-60: If partner APIs flaky → enable cached fallback mode
- T-30: Code freeze. Env fixes only.
