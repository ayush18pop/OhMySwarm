/**
 * server/seed.ts
 *
 * Pre-seeded demo session with realistic DeFi data.
 * Run: npm run seed
 *
 * Also exports seedReplay() which re-emits the seeded session's events
 * with realistic timing delays to simulate a live run for demos.
 */

import 'dotenv/config'
import { prisma }     from './db'
import { initEmitter } from './emit'
import * as E          from './emit'
import { Server }      from 'socket.io'
import http            from 'http'

const DEMO_SESSION_ID = 'demo-session-00000000-0000-0000-0000-000000000001'
const DEMO_TASK       = 'I have $5k USDC idle on Base. Medium risk. Find the best yield right now.'
const DEMO_BUDGET     = 2.00

// ── Seed data ────────────────────────────────────────────────────────────────

const DEMO_AGENTS = [
  {
    id:           'agent-master-0001',
    role:         'master',
    task:         DEMO_TASK,
    status:       'complete',
    walletAddress: '0x' + 'a'.repeat(40),
    budgetUsdc:   DEMO_BUDGET,
    spentUsdc:    0.15,
    output:       'Strategy complete. $5,000 USDC allocated to Aave V3 on Base (5.2% APY base) and Pendle USDe on Ethereum (18.4% APY base). Total expected annual yield: ~$671 on $5k capital.',
    depth:        0,
    parentAgentId: null,
  },
  {
    id:           'agent-scout-0001',
    role:         'portfolio-scout',
    task:         'Fetch current portfolio state for the user wallet on Base and Ethereum',
    status:       'complete',
    walletAddress: '0x' + 'b'.repeat(40),
    budgetUsdc:   0.30,
    spentUsdc:    0.02,
    output:       'Portfolio: $5,200 total. Holdings: 5,000 USDC (Base), 0.05 ETH (Ethereum, ~$200). No active DeFi positions. All capital is idle.',
    depth:        1,
    parentAgentId: 'agent-master-0001',
  },
  {
    id:           'agent-scanner-0001',
    role:         'yield-scanner',
    task:         'Scan DefiLlama for best yield pools for USDC, medium risk, Base and Ethereum',
    status:       'complete',
    walletAddress: '0x' + 'c'.repeat(40),
    budgetUsdc:   0.30,
    spentUsdc:    0.05,
    output:       `Top pools found:
1. Aave V3 USDC (Base) — 5.2% base APY, $890M TVL, no IL risk ✓
2. Pendle USDe PT (Ethereum) — 18.4% base APY, $430M TVL, no IL risk ✓
3. Curve 3pool (Ethereum) — 3.8% base APY, $310M TVL, low IL risk
4. Compound V3 USDC (Base) — 4.9% base APY, $145M TVL, no IL risk`,
    depth:        1,
    parentAgentId: 'agent-master-0001',
  },
  {
    id:           'agent-risk-0001',
    role:         'risk-analyst',
    task:         'Assess risk for Aave V3 USDC on Base and Pendle USDe on Ethereum',
    status:       'complete',
    walletAddress: '0x' + 'd'.repeat(40),
    budgetUsdc:   0.30,
    spentUsdc:    0.03,
    output:       `Risk Assessment:
Aave V3 USDC (Base): RISK 2/10 — Battle-tested, $890M TVL stable, 12 audits, no IL, pure lending. RECOMMENDED.
Pendle USDe PT: RISK 4/10 — USDe is backed by hedged ETH (Ethena). Pendle is well-audited. Fixed-rate PT means no variable APY risk until maturity. RECOMMENDED for 30% allocation.
Recommended split: 70% Aave ($3,500), 30% Pendle ($1,500).`,
    depth:        1,
    parentAgentId: 'agent-master-0001',
  },
  {
    id:           'agent-planner-0001',
    role:         'route-planner',
    task:         'Plan swap/bridge transactions to deposit $3,500 USDC into Aave V3 Base and $1,500 USDC into Pendle Ethereum',
    status:       'complete',
    walletAddress: '0x' + 'e'.repeat(40),
    budgetUsdc:   0.30,
    spentUsdc:    0.03,
    output:       `Execution Plan:
Step 1: Deposit $3,500 USDC → Aave V3 on Base (direct, no swap needed) — gas ~$0.80
Step 2: Bridge $1,500 USDC: Base → Ethereum via MoonPay — fee $0.75, ETA 2min
Step 3: Deposit $1,500 USDC → Pendle USDe pool on Ethereum — gas ~$4.20
Total costs: ~$5.75 in gas/fees. Net APY after fees breakeven: 2 weeks.`,
    depth:        1,
    parentAgentId: 'agent-master-0001',
  },
  {
    id:           'agent-exec-0001',
    role:         'executor',
    task:         'Execute the approved 3-step plan',
    status:       'complete',
    walletAddress: '0x' + 'f'.repeat(40),
    budgetUsdc:   0.30,
    spentUsdc:    0.02,
    output:       `Execution Complete:
✓ Step 1: 3,500 USDC deposited into Aave V3 Base — tx 0xabc123...
✓ Step 2: 1,500 USDC bridged Base→Ethereum — tx 0xdef456...
✓ Step 3: 1,500 USDC deposited into Pendle USDe — tx 0x789ghi...
Portfolio now earning: $3,500 @ 5.2% + $1,500 @ 18.4% = ~$460 + $276 = $736/year`,
    depth:        1,
    parentAgentId: 'agent-master-0001',
  },
]

const DEMO_PAYMENTS = [
  { agentId: 'agent-scout-0001',   amountUsdc: 0.02, txHash: '0x' + 'a1'.repeat(32), status: 'confirmed', description: 'x402 payment for portfolio-scout' },
  { agentId: 'agent-scanner-0001', amountUsdc: 0.05, txHash: '0x' + 'b2'.repeat(32), status: 'confirmed', description: 'x402 payment for yield-scanner' },
  { agentId: 'agent-risk-0001',    amountUsdc: 0.03, txHash: '0x' + 'c3'.repeat(32), status: 'confirmed', description: 'x402 payment for risk-analyst' },
  { agentId: 'agent-planner-0001', amountUsdc: 0.03, txHash: '0x' + 'd4'.repeat(32), status: 'confirmed', description: 'x402 payment for route-planner' },
  { agentId: 'agent-exec-0001',    amountUsdc: 0.02, txHash: '0x' + 'e5'.repeat(32), status: 'confirmed', description: 'x402 payment for executor' },
]

// ── Seed function ─────────────────────────────────────────────────────────────

export async function seed() {
  console.log('[seed] Seeding demo session...')

  // Upsert session
  await prisma.session.upsert({
    where:  { id: DEMO_SESSION_ID },
    create: {
      id:                   DEMO_SESSION_ID,
      task:                 DEMO_TASK,
      status:               'complete',
      masterAgentId:        'agent-master-0001',
      sessionWalletName:    `session-${DEMO_SESSION_ID}`,
      sessionWalletAddress: '0x' + '1a2b'.repeat(10),
      budgetUsdc:           DEMO_BUDGET,
      spentUsdc:            0.15,
      finalOutput:          DEMO_AGENTS[0].output,
      agentCount:           5,
      durationMs:           42_000,
      isSeeded:             true,
    },
    update: {
      status:      'complete',
      spentUsdc:   0.15,
      finalOutput: DEMO_AGENTS[0].output,
      isSeeded:    true,
    },
  })

  // Upsert agents
  for (const agent of DEMO_AGENTS) {
    await prisma.agent.upsert({
      where:  { id: agent.id },
      create: { ...agent, sessionId: DEMO_SESSION_ID, toolCallCount: 3 },
      update: { status: agent.status, output: agent.output },
    })
  }

  // Upsert payments
  for (const p of DEMO_PAYMENTS) {
    const existing = await prisma.payment.findFirst({
      where: { sessionId: DEMO_SESSION_ID, agentId: p.agentId },
    })
    if (!existing) {
      await prisma.payment.create({
        data: { ...p, sessionId: DEMO_SESSION_ID },
      })
    }
  }

  console.log('[seed] Done! Demo session ID:', DEMO_SESSION_ID)
  return DEMO_SESSION_ID
}

// ── Replay function (for live demo) ─────────────────────────────────────────

export async function seedReplay(sessionId: string) {
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

  console.log(`[seedReplay] Replaying session ${sessionId}`)

  const session = await prisma.session.findUnique({ where: { id: sessionId } })
  if (!session) throw new Error('Session not found for replay')

  // Treasury update
  E.emitTreasuryUpdate(sessionId, {
    sessionWalletAddress: session.sessionWalletAddress ?? '0x0',
    spentUsdc:  0,
    budgetUsdc: session.budgetUsdc,
  })

  await delay(800)

  // Spawn research agents in parallel (simulate)
  for (const agent of DEMO_AGENTS.slice(1, 4)) {
    E.emitAgentSpawned(sessionId, {
      agentId:       agent.id,
      parentId:      agent.parentAgentId,
      role:          agent.role,
      task:          agent.task,
      walletAddress: agent.walletAddress,
      budgetUsdc:    agent.budgetUsdc,
    })
    await delay(200)
  }

  // Simulate payment for each
  const payments = DEMO_PAYMENTS.slice(0, 3)
  for (let i = 0; i < payments.length; i++) {
    await delay(600)
    E.emitPaymentConfirmed(sessionId, {
      paymentId:   `replay-pay-${i}`,
      agentId:     payments[i].agentId,
      amountUsdc:  payments[i].amountUsdc,
      txHash:      payments[i].txHash,
      description: payments[i].description,
    })
  }

  // Simulate thinking tokens for scanner (most interesting output)
  await delay(1000)
  const scannerOutput = DEMO_AGENTS[2].output
  for (const char of scannerOutput) {
    E.emitAgentThinking(sessionId, { agentId: 'agent-scanner-0001', token: char })
    await delay(10)
  }

  // Complete research agents
  await delay(2000)
  for (const agent of DEMO_AGENTS.slice(1, 4)) {
    E.emitAgentComplete(sessionId, {
      agentId:    agent.id,
      output:     agent.output,
      spentUsdc:  agent.spentUsdc,
      durationMs: 8000 + Math.random() * 4000,
    })
    await delay(300)
  }

  // Approval gate 1
  await delay(500)
  E.emitAwaitingApproval(sessionId, {
    phase:   'research',
    summary: 'Research complete. Found 2 strong opportunities: Aave V3 USDC (5.2% base APY) + Pendle USDe (18.4% base APY). Risk assessed at 2/10 and 4/10. Recommend 70/30 split.',
    proposals: [
      { pool: 'aave-v3-usdc-base', apy: 5.2, allocation: 3500, risk: 2 },
      { pool: 'pendle-usde-eth',   apy: 18.4, allocation: 1500, risk: 4 },
    ],
    timeoutMs: 300_000,
  })

  return DEMO_SESSION_ID
}

// ── CLI runner ────────────────────────────────────────────────────────────────

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1) })
}
