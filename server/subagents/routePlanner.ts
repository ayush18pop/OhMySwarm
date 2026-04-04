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

// Gas units per action type (approximate gas units, not USD)
const GAS_UNITS: Record<string, number> = {
  swap:    180_000,
  bridge:  250_000,
  deposit: 150_000,
  stake:   160_000,
}

async function estimateGas(args: Record<string, unknown>): Promise<object> {
  const chain  = String(args.chain ?? 'ethereum')
  const count  = Number(args.actionCount ?? 1)
  const types  = String(args.actionTypes ?? 'deposit').split(',')

  // Fetch real gas price from public RPC
  let gasPriceGwei = 30 // will be overwritten by real data
  let ethPriceUsd  = 3500
  try {
    const rpcUrl = chain === 'base'
      ? 'https://mainnet.base.org'
      : chain === 'arbitrum'
        ? 'https://arb1.arbitrum.io/rpc'
        : 'https://eth.llamarpc.com'

    const gasRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }),
      signal: AbortSignal.timeout(5000),
    })
    const gasData = await gasRes.json() as { result: string }
    gasPriceGwei = parseInt(gasData.result, 16) / 1e9

    // Fetch real ETH price from CoinGecko
    const priceRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      { signal: AbortSignal.timeout(5000) },
    )
    const priceData = await priceRes.json() as { ethereum: { usd: number } }
    ethPriceUsd = priceData.ethereum.usd
  } catch {
    // If RPC/price fetch fails, use last known reasonable values
  }

  let totalGasUnits = 0
  for (let i = 0; i < count; i++) {
    const type = types[i % types.length]?.trim() ?? 'deposit'
    totalGasUnits += GAS_UNITS[type] ?? 150_000
  }

  const totalEth = (totalGasUnits * gasPriceGwei) / 1e9
  const totalUsdc = totalEth * ethPriceUsd

  return {
    chain,
    actionCount:        count,
    gasPriceGwei:       gasPriceGwei.toFixed(2),
    ethPriceUsd:        ethPriceUsd.toFixed(0),
    totalGasUnits,
    estimatedEth:       totalEth.toFixed(6),
    estimatedGasUsdc:   totalUsdc.toFixed(2),
    note:               `Live gas price: ${gasPriceGwei.toFixed(1)} gwei on ${chain}`,
    recommendation:     totalUsdc > 20 ? 'Consider batching or using L2s (Base/Arbitrum) to save gas' : 'Gas cost is reasonable',
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
      estimate_transaction_costs: (args) => estimateGas(args),
    },
  })
}
