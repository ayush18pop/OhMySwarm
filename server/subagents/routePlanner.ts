/**
 * server/subagents/routePlanner.ts
 *
 * Plans the optimal deposit/strategy execution sequence.
 * No external swap API — uses DefiLlama for pool data and OWS for wallet info.
 * Produces a step-by-step human-readable plan (no live execution).
 */

import { runSubAgent, SubAgentRunInput }          from '../agent/executor'
import { getTopPools, getProtocolInfo }            from '../integrations/defillama'
import { getWalletAddress }                        from '../wallet'
import type { LLMTool }                            from '../llm'

const TOOLS: LLMTool[] = [
  {
    name: 'get_pool_details',
    description: 'Get detailed information about a specific yield pool including current APY and TVL',
    parameters: {
      type: 'object',
      properties: {
        poolId:   { type: 'string', description: 'DefiLlama pool ID' },
        protocol: { type: 'string', description: 'Protocol name e.g. aave-v3' },
      },
      required: ['protocol'],
    },
  },
  {
    name: 'get_wallet_info',
    description: 'Get OWS session wallet address for the current session',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'estimate_transaction_costs',
    description: 'Estimate gas and fees for a transaction sequence on a given chain',
    parameters: {
      type: 'object',
      properties: {
        chain:       { type: 'string', description: 'Chain name e.g. base, ethereum' },
        actionCount: { type: 'number', description: 'Number of transactions to estimate for' },
        actionTypes: { type: 'string', description: 'Comma-separated action types: swap,bridge,deposit' },
      },
      required: ['chain', 'actionCount'],
    },
  },
]

function estimateGas(args: Record<string, unknown>): object {
  const chain  = String(args.chain ?? 'base')
  const count  = Number(args.actionCount ?? 1)
  const types  = String(args.actionTypes ?? 'deposit').split(',')

  const gasPerAction: Record<string, number> = {
    swap:    chain === 'ethereum' ? 8 : 0.8,
    bridge:  chain === 'ethereum' ? 15 : 2.5,
    deposit: chain === 'ethereum' ? 5  : 0.5,
    stake:   chain === 'ethereum' ? 6  : 0.6,
  }

  let totalGas = 0
  for (let i = 0; i < count; i++) {
    const type = types[i % types.length]?.trim() ?? 'deposit'
    totalGas += gasPerAction[type] ?? 1
  }

  return {
    chain,
    actionCount:        count,
    estimatedGasUsdc:   totalGas.toFixed(2),
    note:               chain === 'base' ? 'Base gas is ~90% cheaper than Ethereum mainnet' : 'Ethereum mainnet gas estimate',
    recommendation:     totalGas > 20 ? 'Consider batching or using Base/Arbitrum to save gas' : 'Gas cost is reasonable',
  }
}

export async function runRoutePlanner(input: Omit<SubAgentRunInput, 'tools' | 'toolHandlers'>) {
  return runSubAgent({
    ...input,
    tools: TOOLS,
    toolHandlers: {
      get_pool_details: async ({ protocol }) => {
        const pools = await getTopPools({ projects: [String(protocol)] }, 3)
        const info  = await getProtocolInfo(String(protocol))
        return { pools, protocol: info }
      },
      get_wallet_info: async ({ sessionId }) => {
        const walletName = `session-${sessionId}`
        const address    = await getWalletAddress(walletName)
        return { walletName, address, network: process.env.PAYMENT_NETWORK ?? 'base-sepolia' }
      },
      estimate_transaction_costs: (args) => Promise.resolve(estimateGas(args)),
    },
  })
}
