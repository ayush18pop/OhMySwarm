/**
 * server/subagents/yieldScanner.ts
 *
 * Finds yield opportunities using DefiLlama.
 * Tools: get_top_pools, get_pool_history, get_protocol_info
 */

import { runSubAgent, SubAgentRunInput } from '../agent/executor'
import { getTopPools, getPoolHistory, getProtocolInfo } from '../integrations/defillama'
import type { LLMTool } from '../llm'
import type { YieldFilters } from '../integrations/defillama'

const TOOLS: LLMTool[] = [
  {
    name: 'get_top_pools',
    description: 'Get top yield pools from DefiLlama filtered by risk/chain/protocol. Sorted by base APY (no inflationary rewards).',
    parameters: {
      type: 'object',
      properties: {
        chains:          { type: 'string', description: 'Comma-separated chains e.g. "base,ethereum,arbitrum"' },
        projects:        { type: 'string', description: 'Comma-separated protocols e.g. "aave-v3,curve"' },
        minTvlUsd:       { type: 'number', description: 'Minimum TVL in USD (default 50000000)' },
        minApy:          { type: 'number', description: 'Minimum APY %' },
        maxApy:          { type: 'number', description: 'Maximum APY % (cap to exclude farming traps)' },
        stablecoinOnly:  { type: 'string', description: 'true/false — only stablecoin pools' },
        noIlRisk:        { type: 'string', description: 'true/false — only no-IL-risk pools' },
        limit:           { type: 'number', description: 'Max results to return (default 5)' },
      },
      required: [],
    },
  },
  {
    name: 'get_pool_history',
    description: 'Get 30-day APY and TVL history for a specific pool by pool ID',
    parameters: {
      type: 'object',
      properties: {
        poolId: { type: 'string', description: 'DefiLlama pool ID from get_top_pools' },
        days:   { type: 'number', description: 'Number of days of history (default 30)' },
      },
      required: ['poolId'],
    },
  },
  {
    name: 'get_protocol_info',
    description: 'Get protocol TVL, audit status, and category',
    parameters: {
      type: 'object',
      properties: {
        protocol: { type: 'string', description: 'Protocol slug e.g. "aave-v3", "curve"' },
      },
      required: ['protocol'],
    },
  },
]

export async function runYieldScanner(input: Omit<SubAgentRunInput, 'tools' | 'toolHandlers'>) {
  return runSubAgent({
    ...input,
    tools: TOOLS,
    toolHandlers: {
      get_top_pools: (args) => {
        const filters: YieldFilters = {
          chains:         args.chains ? String(args.chains).split(',').map(s => s.trim()) : undefined,
          projects:       args.projects ? String(args.projects).split(',').map(s => s.trim()) : undefined,
          minTvlUsd:      args.minTvlUsd as number | undefined ?? 50_000_000,
          minApy:         args.minApy   as number | undefined,
          maxApy:         args.maxApy   as number | undefined,
          stablecoinOnly: args.stablecoinOnly === 'true',
          noIlRisk:       args.noIlRisk       === 'true',
        }
        return getTopPools(filters, (args.limit as number | undefined) ?? 5)
      },
      get_pool_history: ({ poolId, days }) =>
        getPoolHistory(poolId as string, days as number | undefined),
      get_protocol_info: ({ protocol }) =>
        getProtocolInfo(protocol as string),
    },
  })
}
