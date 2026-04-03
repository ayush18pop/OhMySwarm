/**
 * server/integrations/defillama.ts
 *
 * DefiLlama yield/protocol data. No API key required.
 * Base: https://yields.llama.fi  and  https://api.llama.fi
 */

import 'dotenv/config'

const YIELDS_BASE   = process.env.DEFILLAMA_BASE_URL  ?? 'https://yields.llama.fi'
const PROTOCOL_BASE = 'https://api.llama.fi'
const TIMEOUT_MS    = parseInt(process.env.PARTNER_TIMEOUT_MS ?? '8000')
const FALLBACK_MODE = process.env.PARTNER_FALLBACK_MODE === 'cached'

// ── In-memory TTL cache ───────────────────────────────────────────────────────
const cache = new Map<string, { value: unknown; expiresAt: number }>()

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null }
  return entry.value as T
}

function cacheSet(key: string, value: unknown, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface YieldPool {
  pool:        string
  chain:       string
  project:     string
  symbol:      string
  tvlUsd:      number
  apy:         number
  apyBase:     number
  apyReward:   number
  il7d:        number
  volumeUsd1d: number
  stablecoin:  boolean
  ilRisk:      'no' | 'low' | 'high'
  exposure:    'single' | 'multi'
}

export interface YieldFilters {
  chains?:         string[]
  projects?:       string[]
  minTvlUsd?:      number
  minApy?:         number
  maxApy?:         number
  stablecoinOnly?: boolean
  noIlRisk?:       boolean
}

export interface ProtocolInfo {
  name:         string
  tvl:          number
  tvl7dChange:  number
  tvl30dChange: number
  audits:       number
  category:     string
}

// ── Fallback data (for demo / offline) ──────────────────────────────────────

const FALLBACK_POOLS: YieldPool[] = [
  { pool: 'aave-v3-usdc-base', chain: 'Base', project: 'aave-v3', symbol: 'USDC', tvlUsd: 890_000_000, apy: 5.2, apyBase: 5.2, apyReward: 0, il7d: 0, volumeUsd1d: 0, stablecoin: true, ilRisk: 'no', exposure: 'single' },
  { pool: 'pendle-usde-eth',   chain: 'Ethereum', project: 'pendle', symbol: 'USDe', tvlUsd: 430_000_000, apy: 18.4, apyBase: 18.4, apyReward: 0, il7d: 0, volumeUsd1d: 0, stablecoin: true, ilRisk: 'no', exposure: 'single' },
  { pool: 'curve-3pool',       chain: 'Ethereum', project: 'curve', symbol: 'USDC+USDT+DAI', tvlUsd: 310_000_000, apy: 3.8, apyBase: 3.8, apyReward: 0, il7d: 0.01, volumeUsd1d: 22_000_000, stablecoin: true, ilRisk: 'low', exposure: 'multi' },
  { pool: 'aave-v3-weth-arb',  chain: 'Arbitrum', project: 'aave-v3', symbol: 'WETH', tvlUsd: 280_000_000, apy: 2.1, apyBase: 2.1, apyReward: 0, il7d: 0, volumeUsd1d: 0, stablecoin: false, ilRisk: 'no', exposure: 'single' },
  { pool: 'compound-v3-usdc',  chain: 'Base', project: 'compound', symbol: 'USDC', tvlUsd: 145_000_000, apy: 4.9, apyBase: 4.9, apyReward: 0, il7d: 0, volumeUsd1d: 0, stablecoin: true, ilRisk: 'no', exposure: 'single' },
]

// ── Internal ──────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** GET /pools — fetch all pools, filter client-side. Cached 5 min. */
export async function getYieldPools(filters: YieldFilters): Promise<YieldPool[]> {
  let pools: YieldPool[]

  if (FALLBACK_MODE) {
    pools = FALLBACK_POOLS
  } else {
    const cached = cacheGet<YieldPool[]>('pools')
    if (cached) {
      pools = cached
    } else {
      try {
        const res  = await fetchWithTimeout(`${YIELDS_BASE}/pools`)
        const data = await res.json() as { data: Array<Record<string, unknown>> }
        pools = data.data.map(normalizePool)
        cacheSet('pools', pools, 5 * 60_000)
      } catch (err) {
        console.warn('[defillama] API unavailable, using fallback data:', err)
        pools = FALLBACK_POOLS
      }
    }
  }

  return applyFilters(pools, filters)
}

/** GET /chart/{poolId} — historical APY/TVL. Cached 10 min. */
export async function getPoolHistory(
  poolId: string,
  days   = 30,
): Promise<Array<{ date: string; apy: number; tvlUsd: number }>> {
  if (FALLBACK_MODE) return generateMockHistory(days)
  const key = `chart:${poolId}`
  const cached = cacheGet<Array<{ date: string; apy: number; tvlUsd: number }>>(key)
  if (cached) return cached.slice(-days)
  try {
    const res  = await fetchWithTimeout(`${YIELDS_BASE}/chart/${poolId}`)
    const data = await res.json() as { data: Array<{ timestamp: string; apy: number; tvlUsd: number }> }
    const result = data.data.map(d => ({ date: d.timestamp, apy: d.apy, tvlUsd: d.tvlUsd }))
    cacheSet(key, result, 10 * 60_000)
    return result.slice(-days)
  } catch {
    return generateMockHistory(days)
  }
}

/** GET /protocol/{protocol} — protocol TVL stats. Cached 10 min. */
export async function getProtocolInfo(protocol: string): Promise<ProtocolInfo> {
  const key = `proto:${protocol}`
  const cached = cacheGet<ProtocolInfo>(key)
  if (cached) return cached
  try {
    const res  = await fetchWithTimeout(`${PROTOCOL_BASE}/protocol/${protocol}`)
    const data = await res.json() as {
      name: string; tvl: number; change_7d: number; change_1m: number
      audits: number; category: string
    }
    const result: ProtocolInfo = {
      name:         data.name ?? protocol,
      tvl:          data.tvl ?? 0,
      tvl7dChange:  data.change_7d ?? 0,
      tvl30dChange: data.change_1m ?? 0,
      audits:       data.audits ?? 0,
      category:     data.category ?? 'Unknown',
    }
    cacheSet(key, result, 10 * 60_000)
    return result
  } catch {
    return { name: protocol, tvl: 0, tvl7dChange: 0, tvl30dChange: 0, audits: 0, category: 'Unknown' }
  }
}

/** Top N pools by base APY (excludes inflationary rewards). */
export async function getTopPools(
  filters: YieldFilters,
  limit   = 5,
): Promise<YieldPool[]> {
  const pools = await getYieldPools(filters)
  return pools
    .sort((a, b) => b.apyBase - a.apyBase)
    .slice(0, limit)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function applyFilters(pools: YieldPool[], f: YieldFilters): YieldPool[] {
  return pools.filter(p => {
    if (f.chains?.length         && !f.chains.some(c => c.toLowerCase() === p.chain.toLowerCase())) return false
    if (f.projects?.length       && !f.projects.includes(p.project)) return false
    if (f.minTvlUsd !== undefined && p.tvlUsd  < f.minTvlUsd) return false
    if (f.minApy    !== undefined && p.apy     < f.minApy)    return false
    if (f.maxApy    !== undefined && p.apy     > f.maxApy)    return false
    if (f.stablecoinOnly         && !p.stablecoin)            return false
    if (f.noIlRisk               && p.ilRisk !== 'no')        return false
    return true
  })
}

function normalizePool(raw: Record<string, unknown>): YieldPool {
  return {
    pool:        String(raw.pool       ?? ''),
    chain:       String(raw.chain      ?? ''),
    project:     String(raw.project    ?? ''),
    symbol:      String(raw.symbol     ?? ''),
    tvlUsd:      Number(raw.tvlUsd     ?? 0),
    apy:         Number(raw.apy        ?? 0),
    apyBase:     Number(raw.apyBase    ?? 0),
    apyReward:   Number(raw.apyReward  ?? 0),
    il7d:        Number(raw.il7d       ?? 0),
    volumeUsd1d: Number(raw.volumeUsd1d ?? 0),
    stablecoin:  Boolean(raw.stablecoin),
    ilRisk:      (raw.ilRisk as 'no' | 'low' | 'high') ?? 'no',
    exposure:    (raw.exposure as 'single' | 'multi')  ?? 'single',
  }
}

function generateMockHistory(days: number): Array<{ date: string; apy: number; tvlUsd: number }> {
  const result = []
  const now = Date.now()
  for (let i = days; i >= 0; i--) {
    const date = new Date(now - i * 86_400_000).toISOString().split('T')[0]
    result.push({ date, apy: 4.5 + Math.random() * 2, tvlUsd: 500_000_000 + Math.random() * 50_000_000 })
  }
  return result
}
