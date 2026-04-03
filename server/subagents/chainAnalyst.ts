/**
 * server/subagents/chainAnalyst.ts
 *
 * Analyzes chain-level metrics: TVL, gas, top protocols.
 * Uses DefiLlama chains + protocols API (free, no key).
 */

import { runSubAgent, SubAgentRunInput } from '../agent/executor'
import type { LLMTool } from '../llm'

const PROTOCOL_BASE = 'https://api.llama.fi'
const YIELDS_BASE   = 'https://yields.llama.fi'

// ── TTL cache ─────────────────────────────────────────────────────────────────
const cache = new Map<string, { value: unknown; expiresAt: number }>()
function cGet<T>(k: string): T | null {
  const e = cache.get(k)
  if (!e || Date.now() > e.expiresAt) { cache.delete(k); return null }
  return e.value as T
}
function cSet(k: string, v: unknown, ttl = 5 * 60_000) { cache.set(k, { value: v, expiresAt: Date.now() + ttl }) }

async function apiFetch<T>(url: string): Promise<T> {
  const cached = cGet<T>(url)
  if (cached) return cached
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json() as T
  cSet(url, data)
  return data
}

const TOOLS: LLMTool[] = [
  {
    name: 'get_chain_tvl',
    description: 'Get TVL breakdown by chain from DefiLlama',
    parameters: {
      type: 'object',
      properties: {
        chain: { type: 'string', description: 'Chain name e.g. Ethereum, Base, Arbitrum, Optimism, Polygon' },
      },
      required: ['chain'],
    },
  },
  {
    name: 'get_top_protocols_on_chain',
    description: 'Get top DeFi protocols by TVL on a specific chain',
    parameters: {
      type: 'object',
      properties: {
        chain: { type: 'string', description: 'Chain name' },
        limit: { type: 'number', description: 'Max protocols to return (default 10)' },
      },
      required: ['chain'],
    },
  },
  {
    name: 'get_chain_stablecoin_tvl',
    description: 'Get stablecoin circulating supply on a chain',
    parameters: {
      type: 'object',
      properties: {
        chain: { type: 'string', description: 'Chain name' },
      },
      required: ['chain'],
    },
  },
  {
    name: 'get_top_yield_pools_on_chain',
    description: 'Get top yield pools on a specific chain sorted by base APY',
    parameters: {
      type: 'object',
      properties: {
        chain: { type: 'string', description: 'Chain name' },
        limit: { type: 'number', description: 'Number of results (default 5)' },
      },
      required: ['chain'],
    },
  },
]

export async function runChainAnalyst(input: Omit<SubAgentRunInput, 'tools' | 'toolHandlers'>) {
  return runSubAgent({
    ...input,
    tools: TOOLS,
    toolHandlers: {
      get_chain_tvl: async ({ chain }) => {
        const data = await apiFetch<Array<{ name: string; tvl: number }>>(`${PROTOCOL_BASE}/v2/chains`)
        const found = data.find(c => c.name.toLowerCase() === String(chain).toLowerCase())
        return found ?? { error: `Chain ${chain} not found`, available: data.slice(0, 10).map(c => c.name) }
      },

      get_top_protocols_on_chain: async ({ chain, limit = 10 }) => {
        const data = await apiFetch<Array<{ name: string; tvl: number; category: string; chains: string[] }>>(`${PROTOCOL_BASE}/protocols`)
        return data
          .filter(p => p.chains?.some((c: string) => c.toLowerCase() === String(chain).toLowerCase()))
          .sort((a, b) => b.tvl - a.tvl)
          .slice(0, Number(limit))
          .map(p => ({ name: p.name, tvl: `$${(p.tvl / 1e6).toFixed(1)}M`, category: p.category }))
      },

      get_chain_stablecoin_tvl: async ({ chain }) => {
        type StablecoinData = { name: string; chainCirculating: Record<string, { current: { peggedUSD: number } }> }
        const data = await apiFetch<{ peggedAssets: StablecoinData[] }>(`https://stablecoins.llama.fi/stablecoins?includePrices=true`)
        const chainKey = String(chain).toLowerCase()
        const result = data.peggedAssets
          .map(s => ({
            name: s.name,
            circulatingUsd: s.chainCirculating?.[chainKey]?.current?.peggedUSD ?? 0,
          }))
          .filter(s => s.circulatingUsd > 0)
          .sort((a, b) => b.circulatingUsd - a.circulatingUsd)
          .slice(0, 8)
        const total = result.reduce((s, x) => s + x.circulatingUsd, 0)
        return { chain, totalStablecoinTvl: `$${(total / 1e6).toFixed(0)}M`, breakdown: result.map(s => ({ ...s, circulatingUsd: `$${(s.circulatingUsd / 1e6).toFixed(1)}M` })) }
      },

      get_top_yield_pools_on_chain: async ({ chain, limit = 5 }) => {
        type Pool = { chain: string; project: string; symbol: string; tvlUsd: number; apyBase: number; stablecoin: boolean }
        const data = await apiFetch<{ data: Pool[] }>(`${YIELDS_BASE}/pools`)
        return data.data
          .filter(p => p.chain?.toLowerCase() === String(chain).toLowerCase() && p.apyBase > 0 && p.tvlUsd > 1_000_000)
          .sort((a, b) => b.apyBase - a.apyBase)
          .slice(0, Number(limit))
          .map(p => ({ protocol: p.project, symbol: p.symbol, apyBase: `${p.apyBase.toFixed(2)}%`, tvl: `$${(p.tvlUsd / 1e6).toFixed(0)}M`, stable: p.stablecoin }))
      },
    },
  })
}
