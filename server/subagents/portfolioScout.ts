/**
 * server/subagents/portfolioScout.ts
 *
 * Fetches the user's current portfolio using Zerion.
 * Tools: get_portfolio, get_token_positions, get_defi_positions
 */

import { runSubAgent, SubAgentRunInput } from '../agent/executor'
import { prisma } from '../db'
import { getPortfolio, getTokenPositions, getDeFiPositions, getPortfolioSummary, isValidWalletAddress } from '../integrations/zerion'
import type { LLMTool } from '../llm'

const TOOLS: LLMTool[] = [
  {
    name: 'get_portfolio',
    description: 'Get full portfolio overview including total value, chains, tokens, and DeFi positions',
    parameters: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Wallet address to fetch portfolio for' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_portfolio_summary',
    description: 'Get a human-readable portfolio summary formatted for analysis',
    parameters: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Wallet address' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_defi_positions',
    description: 'Get all active DeFi positions (lending, staking, LP)',
    parameters: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Wallet address' },
      },
      required: ['address'],
    },
  },
]

async function resolveAddress(raw: unknown, sessionId: string): Promise<string> {
  const provided = String(raw ?? '').trim()
  if (provided && isValidWalletAddress(provided)) return provided

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { sessionWalletAddress: true, userWalletAddress: true },
  })

  const candidates = [
    session?.sessionWalletAddress,
    session?.userWalletAddress,
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (isValidWalletAddress(candidate)) return candidate
  }

  return provided
}

export async function runPortfolioScout(input: Omit<SubAgentRunInput, 'tools' | 'toolHandlers'>) {
  return runSubAgent({
    ...input,
    tools: TOOLS,
    toolHandlers: {
      get_portfolio: async ({ address }) => {
        const resolved = await resolveAddress(address, input.sessionId)
        return getPortfolio(resolved)
      },
      get_portfolio_summary: async ({ address }) => {
        const resolved = await resolveAddress(address, input.sessionId)
        return getPortfolioSummary(resolved)
      },
      get_defi_positions: async ({ address }) => {
        const resolved = await resolveAddress(address, input.sessionId)
        return getDeFiPositions(resolved)
      },
    },
  })
}
