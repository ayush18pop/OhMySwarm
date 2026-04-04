/**
 * server/subagents/portfolioScout.ts
 *
 * Fetches the user's current portfolio using Zerion.
 * Tools: get_portfolio, get_token_positions, get_defi_positions
 */

import { runSubAgent, SubAgentRunInput } from '../agent/executor'
import { prisma } from '../db'
import { getPortfolio, getDeFiPositions, getPortfolioSummary, isValidWalletAddress } from '../integrations/zerion'
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

  // Prefer user's real mainnet wallet (connected via RainbowKit) over
  // the session wallet (which is a Sepolia testnet address for payments).
  // Portfolio data should always reflect the user's real holdings.
  if (session?.userWalletAddress && isValidWalletAddress(session.userWalletAddress)) {
    return session.userWalletAddress
  }

  if (session?.sessionWalletAddress && isValidWalletAddress(session.sessionWalletAddress)) {
    return session.sessionWalletAddress
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
