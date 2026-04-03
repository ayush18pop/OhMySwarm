/**
 * server/subagents/riskAnalyst.ts
 *
 * Assesses risk of proposed DeFi positions.
 * Tools: get_protocol_info, get_pool_history, assess_il_risk
 */

import { runSubAgent, SubAgentRunInput } from '../agent/executor'
import { getProtocolInfo, getPoolHistory } from '../integrations/defillama'
import type { LLMTool } from '../llm'

const TOOLS: LLMTool[] = [
  {
    name: 'get_protocol_info',
    description: 'Get TVL trends and audit status for a DeFi protocol',
    parameters: {
      type: 'object',
      properties: {
        protocol: { type: 'string', description: 'Protocol slug e.g. "aave-v3"' },
      },
      required: ['protocol'],
    },
  },
  {
    name: 'get_pool_history',
    description: 'Get historical APY stability for a pool — check for sudden spikes or drops',
    parameters: {
      type: 'object',
      properties: {
        poolId: { type: 'string', description: 'DefiLlama pool ID' },
        days:   { type: 'number', description: 'Days of history (default 30)' },
      },
      required: ['poolId'],
    },
  },
  {
    name: 'assess_il_risk',
    description: 'Calculate impermanent loss risk for an LP position given two tokens',
    parameters: {
      type: 'object',
      properties: {
        token0:         { type: 'string', description: 'First token symbol' },
        token1:         { type: 'string', description: 'Second token symbol' },
        priceRangeMin:  { type: 'number', description: 'Min price ratio relative to entry' },
        priceRangeMax:  { type: 'number', description: 'Max price ratio relative to entry' },
      },
      required: ['token0', 'token1'],
    },
  },
]

function assessIlRisk(args: Record<string, unknown>): object {
  const { token0, token1, priceRangeMin = 0.5, priceRangeMax = 2 } = args
  const isStable = ['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD'].includes(String(token0))
    && ['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD'].includes(String(token1))

  if (isStable) {
    return { ilRisk: 'none', maxIlPct: 0, note: 'Stablecoin/stablecoin pairs have negligible IL' }
  }

  // Simplified IL formula: IL = 2*sqrt(r)/(1+r) - 1 where r = price ratio change
  const r = Number(priceRangeMax)
  const maxIlPct = Math.abs(2 * Math.sqrt(r) / (1 + r) - 1) * 100

  return {
    token0,
    token1,
    priceRangeMin,
    priceRangeMax,
    maxIlPct: maxIlPct.toFixed(2),
    ilRisk:   maxIlPct > 10 ? 'high' : maxIlPct > 3 ? 'medium' : 'low',
    note:     `At ${priceRangeMax}x price change, max IL is ~${maxIlPct.toFixed(1)}%`,
  }
}

export async function runRiskAnalyst(input: Omit<SubAgentRunInput, 'tools' | 'toolHandlers'>) {
  return runSubAgent({
    ...input,
    tools: TOOLS,
    toolHandlers: {
      get_protocol_info: ({ protocol }) => getProtocolInfo(protocol as string),
      get_pool_history:  ({ poolId, days }) => getPoolHistory(poolId as string, days as number | undefined),
      assess_il_risk:    (args) => Promise.resolve(assessIlRisk(args)),
    },
  })
}
