/**
 * server/subagents/tokenAnalyst.ts
 *
 * Token price, market data, and on-chain metrics.
 * Uses CoinGecko free API (no key for basic endpoints).
 */

import { runSubAgent, SubAgentRunInput } from '../agent/executor'
import type { LLMTool } from '../llm'

const CG_BASE = 'https://api.coingecko.com/api/v3'

// ── TTL cache (3 min for prices) ─────────────────────────────────────────────
const cache = new Map<string, { value: unknown; expiresAt: number }>()
function cGet<T>(k: string): T | null {
  const e = cache.get(k)
  if (!e || Date.now() > e.expiresAt) { cache.delete(k); return null }
  return e.value as T
}
function cSet(k: string, v: unknown, ttl = 3 * 60_000) { cache.set(k, { value: v, expiresAt: Date.now() + ttl }) }

async function cgFetch<T>(path: string): Promise<T> {
  const cached = cGet<T>(path)
  if (cached) return cached
  const res = await fetch(`${CG_BASE}${path}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (res.status === 429) throw new Error('CoinGecko rate limit — retry shortly')
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
  const data = await res.json() as T
  cSet(path, data)
  return data
}

const TOOLS: LLMTool[] = [
  {
    name: 'get_token_price',
    description: 'Get current price, market cap, 24h change for one or more tokens',
    parameters: {
      type: 'object',
      properties: {
        tokens: { type: 'string', description: 'Comma-separated CoinGecko IDs e.g. "ethereum,usd-coin,dai"' },
      },
      required: ['tokens'],
    },
  },
  {
    name: 'get_token_market_data',
    description: 'Get detailed market data for a token: price history, ATH, volume, supply',
    parameters: {
      type: 'object',
      properties: {
        tokenId: { type: 'string', description: 'CoinGecko token ID e.g. "ethereum", "usd-coin"' },
      },
      required: ['tokenId'],
    },
  },
  {
    name: 'get_trending_tokens',
    description: 'Get trending tokens on CoinGecko in the last 24h',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_defi_market_overview',
    description: 'Get global DeFi market stats: total TVL, dominance, top protocols',
    parameters: { type: 'object', properties: {}, required: [] },
  },
]

export async function runTokenAnalyst(input: Omit<SubAgentRunInput, 'tools' | 'toolHandlers'>) {
  return runSubAgent({
    ...input,
    tools: TOOLS,
    toolHandlers: {
      get_token_price: async ({ tokens }) => {
        const ids = String(tokens).replace(/\s/g, '')
        type PriceData = { usd: number; usd_market_cap: number; usd_24h_change: number; usd_24h_vol: number }
        const data = await cgFetch<Record<string, PriceData>>(
          `/simple/price?ids=${ids}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true&include_24hr_vol=true`
        )
        return Object.entries(data).map(([id, d]) => ({
          id,
          price: `$${d.usd?.toLocaleString()}`,
          marketCap: d.usd_market_cap ? `$${(d.usd_market_cap / 1e9).toFixed(2)}B` : 'N/A',
          change24h: d.usd_24h_change ? `${d.usd_24h_change.toFixed(2)}%` : 'N/A',
          vol24h: d.usd_24h_vol ? `$${(d.usd_24h_vol / 1e6).toFixed(0)}M` : 'N/A',
        }))
      },

      get_token_market_data: async ({ tokenId }) => {
        const data = await cgFetch<{
          name: string; symbol: string
          market_data: {
            current_price: { usd: number }
            ath: { usd: number }; ath_change_percentage: { usd: number }
            total_volume: { usd: number }; market_cap: { usd: number }
            price_change_percentage_7d: number; price_change_percentage_30d: number
            circulating_supply: number; total_supply: number
          }
        }>(`/coins/${tokenId}?localization=false&tickers=false&community_data=false&developer_data=false`)
        const md = data.market_data
        return {
          name: data.name, symbol: data.symbol.toUpperCase(),
          price: `$${md.current_price.usd.toLocaleString()}`,
          ath: `$${md.ath.usd.toLocaleString()} (${md.ath_change_percentage.usd.toFixed(1)}% from ATH)`,
          volume24h: `$${(md.total_volume.usd / 1e6).toFixed(0)}M`,
          marketCap: `$${(md.market_cap.usd / 1e9).toFixed(2)}B`,
          change7d: `${md.price_change_percentage_7d?.toFixed(2)}%`,
          change30d: `${md.price_change_percentage_30d?.toFixed(2)}%`,
          circulatingSupply: md.circulating_supply?.toLocaleString(),
        }
      },

      get_trending_tokens: async () => {
        const data = await cgFetch<{ coins: Array<{ item: { id: string; name: string; symbol: string; market_cap_rank: number; price_btc: number } }> }>('/search/trending')
        return data.coins.slice(0, 7).map(c => ({
          id: c.item.id, name: c.item.name, symbol: c.item.symbol, rank: c.item.market_cap_rank,
        }))
      },

      get_defi_market_overview: async () => {
        const data = await cgFetch<{ data: { defi_market_cap: string; eth_market_cap: string; defi_dominance: string; top_coin_name: string; top_coin_defi_dominance: number } }>('/global/decentralized_finance_defi')
        const d = data.data
        return {
          defiMarketCap: `$${(parseFloat(d.defi_market_cap) / 1e9).toFixed(2)}B`,
          defiDominance: `${parseFloat(d.defi_dominance).toFixed(2)}%`,
          topProtocol: d.top_coin_name,
          topProtocolDominance: `${d.top_coin_defi_dominance.toFixed(2)}%`,
        }
      },
    },
  })
}
