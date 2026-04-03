/**
 * server/subagents/liquidityScout.ts
 *
 * Finds best liquidity opportunities: LP pools, bridges, swap routes.
 * Uses DefiLlama pools API + free bridge aggregator data.
 */

import { runSubAgent, SubAgentRunInput } from '../agent/executor'
import type { LLMTool } from '../llm'

const YIELDS_BASE = 'https://yields.llama.fi'

const cache = new Map<string, { value: unknown; expiresAt: number }>()
function cGet<T>(k: string): T | null {
  const e = cache.get(k)
  if (!e || Date.now() > e.expiresAt) { cache.delete(k); return null }
  return e.value as T
}
function cSet(k: string, v: unknown, ttl = 5 * 60_000) { cache.set(k, { value: v, expiresAt: Date.now() + ttl }) }

async function poolsFetch() {
  const key = 'all-pools'
  const cached = cGet<Array<Record<string, unknown>>>(key)
  if (cached) return cached
  const res = await fetch(`${YIELDS_BASE}/pools`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json() as { data: Array<Record<string, unknown>> }
  cSet(key, data.data)
  return data.data
}

const TOOLS: LLMTool[] = [
  {
    name: 'find_lp_pools',
    description: 'Find best LP pools for a token pair with lowest IL risk and highest fees',
    parameters: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol to find LP pools for (e.g. ETH, USDC, wBTC)' },
        minTvl: { type: 'number', description: 'Minimum TVL in USD (default 5000000)' },
        chain: { type: 'string', description: 'Optional chain filter' },
      },
      required: ['token'],
    },
  },
  {
    name: 'find_stable_pools',
    description: 'Find stablecoin LP pools with deep liquidity and low IL',
    parameters: {
      type: 'object',
      properties: {
        minApy: { type: 'number', description: 'Minimum APY % (default 2)' },
        chain: { type: 'string', description: 'Optional chain filter' },
        limit: { type: 'number', description: 'Results limit (default 8)' },
      },
      required: [],
    },
  },
  {
    name: 'find_single_sided_pools',
    description: 'Find single-asset deposit pools (no IL risk) with best yields',
    parameters: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol (e.g. USDC, ETH, USDT)' },
        chain: { type: 'string', description: 'Optional chain filter' },
        limit: { type: 'number', description: 'Results limit (default 6)' },
      },
      required: ['token'],
    },
  },
  {
    name: 'get_pool_depth_analysis',
    description: 'Analyze liquidity depth and volume for top pools of a token',
    parameters: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol' },
        limit: { type: 'number', description: 'Number of pools to analyze (default 5)' },
      },
      required: ['token'],
    },
  },
]

export async function runLiquidityScout(input: Omit<SubAgentRunInput, 'tools' | 'toolHandlers'>) {
  return runSubAgent({
    ...input,
    tools: TOOLS,
    toolHandlers: {
      find_lp_pools: async ({ token, minTvl = 5_000_000, chain }) => {
        const pools = await poolsFetch()
        const sym = String(token).toUpperCase()
        return pools
          .filter(p => {
            const symbolMatch = String(p.symbol ?? '').toUpperCase().includes(sym)
            const tvlOk = Number(p.tvlUsd ?? 0) >= Number(minTvl)
            const chainOk = !chain || String(p.chain ?? '').toLowerCase() === String(chain).toLowerCase()
            const isMulti = p.exposure === 'multi'
            return symbolMatch && tvlOk && chainOk && isMulti
          })
          .sort((a, b) => Number(b.apyBase ?? 0) - Number(a.apyBase ?? 0))
          .slice(0, 8)
          .map(p => ({
            protocol: p.project, chain: p.chain, symbol: p.symbol,
            apyBase: `${Number(p.apyBase ?? 0).toFixed(2)}%`,
            tvl: `$${(Number(p.tvlUsd ?? 0) / 1e6).toFixed(0)}M`,
            ilRisk: p.ilRisk, vol24h: `$${(Number(p.volumeUsd1d ?? 0) / 1e6).toFixed(1)}M`,
          }))
      },

      find_stable_pools: async ({ minApy = 2, chain, limit = 8 }) => {
        const pools = await poolsFetch()
        return pools
          .filter(p => p.stablecoin && Number(p.apyBase ?? 0) >= Number(minApy) && Number(p.tvlUsd ?? 0) > 1_000_000
            && (!chain || String(p.chain ?? '').toLowerCase() === String(chain).toLowerCase()))
          .sort((a, b) => Number(b.apyBase ?? 0) - Number(a.apyBase ?? 0))
          .slice(0, Number(limit))
          .map(p => ({ protocol: p.project, chain: p.chain, symbol: p.symbol, apyBase: `${Number(p.apyBase ?? 0).toFixed(2)}%`, tvl: `$${(Number(p.tvlUsd ?? 0) / 1e6).toFixed(0)}M`, ilRisk: p.ilRisk }))
      },

      find_single_sided_pools: async ({ token, chain, limit = 6 }) => {
        const pools = await poolsFetch()
        const sym = String(token).toUpperCase()
        return pools
          .filter(p => String(p.symbol ?? '').toUpperCase().includes(sym)
            && p.exposure === 'single' && p.ilRisk === 'no' && Number(p.tvlUsd ?? 0) > 500_000
            && (!chain || String(p.chain ?? '').toLowerCase() === String(chain).toLowerCase()))
          .sort((a, b) => Number(b.apyBase ?? 0) - Number(a.apyBase ?? 0))
          .slice(0, Number(limit))
          .map(p => ({ protocol: p.project, chain: p.chain, symbol: p.symbol, apyBase: `${Number(p.apyBase ?? 0).toFixed(2)}%`, tvl: `$${(Number(p.tvlUsd ?? 0) / 1e6).toFixed(0)}M` }))
      },

      get_pool_depth_analysis: async ({ token, limit = 5 }) => {
        const pools = await poolsFetch()
        const sym = String(token).toUpperCase()
        const relevant = pools
          .filter(p => String(p.symbol ?? '').toUpperCase().includes(sym) && Number(p.tvlUsd ?? 0) > 100_000)
          .sort((a, b) => Number(b.tvlUsd ?? 0) - Number(a.tvlUsd ?? 0))
          .slice(0, Number(limit))
        return relevant.map(p => ({
          protocol: p.project, chain: p.chain, symbol: p.symbol,
          tvl: `$${(Number(p.tvlUsd ?? 0) / 1e6).toFixed(1)}M`,
          vol24h: `$${(Number(p.volumeUsd1d ?? 0) / 1e6).toFixed(1)}M`,
          volTvlRatio: Number(p.tvlUsd ?? 0) > 0
            ? `${((Number(p.volumeUsd1d ?? 0) / Number(p.tvlUsd ?? 1)) * 100).toFixed(1)}%`
            : 'N/A',
          apyBase: `${Number(p.apyBase ?? 0).toFixed(2)}%`,
          ilRisk: p.ilRisk,
        }))
      },
    },
  })
}
