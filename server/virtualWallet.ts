/**
 * server/virtualWallet.ts
 *
 * Virtual wallet layer for sub-agents.
 * No on-chain transactions — budget is tracked in the DB.
 * Addresses are deterministic (sha256 of agentId) for display purposes only.
 *
 * Race-condition-safe budget deduction uses atomic SQL.
 */

import crypto  from 'crypto'
import { prisma } from './db'

// ── Address derivation ───────────────────────────────────────────────────────

/** Deterministic EVM-style address from agentId (display only). */
export function deriveVirtualAddress(agentId: string): string {
  const hash = crypto.createHash('sha256').update(`virtual:${agentId}`).digest('hex')
  return `0x${hash.slice(0, 40)}`
}

// ── Budget management ────────────────────────────────────────────────────────

/**
 * Atomically reserve `amountUsdc` from session budget.
 * Returns true if successful, false if insufficient budget.
 *
 * Uses raw SQL UPDATE with WHERE clause to prevent race conditions:
 *   UPDATE "Session" SET "spentUsdc" = "spentUsdc" + X
 *   WHERE id = $1 AND "spentUsdc" + X <= "budgetUsdc"
 *   RETURNING id
 */
export async function reserveSessionBudget(
  sessionId:   string,
  amountUsdc:  number,
): Promise<boolean> {
  const result = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "Session"
    SET "spentUsdc" = "spentUsdc" + ${amountUsdc}
    WHERE id = ${sessionId}
      AND "spentUsdc" + ${amountUsdc} <= "budgetUsdc"
    RETURNING id
  `
  return result.length > 0
}

/**
 * Deduct `amountUsdc` from an agent's virtual budget.
 * Assumes reserveSessionBudget was called first — does not check limits here.
 */
export async function deductAgentBudget(
  agentId:    string,
  amountUsdc: number,
): Promise<void> {
  await prisma.agent.update({
    where: { id: agentId },
    data:  { spentUsdc: { increment: amountUsdc } },
  })
}

/**
 * Get current virtual wallet state for an agent.
 */
export async function getAgentWalletState(agentId: string): Promise<{
  address:    string
  budgetUsdc: number
  spentUsdc:  number
  remaining:  number
}> {
  const agent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } })
  const address = deriveVirtualAddress(agentId)
  return {
    address,
    budgetUsdc: agent.budgetUsdc,
    spentUsdc:  agent.spentUsdc,
    remaining:  agent.budgetUsdc - agent.spentUsdc,
  }
}
