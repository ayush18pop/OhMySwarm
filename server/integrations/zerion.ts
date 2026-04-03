/**
 * server/integrations/zerion.ts
 *
 * Zerion REST API v1.
 * Auth: Basic base64(apiKey:) — note trailing colon.
 * Docs: https://developers.zerion.io/
 */

import 'dotenv/config'

const ZERION_BASE    = 'https://api.zerion.io/v1'
const ZERION_API_KEY = process.env.ZERION_API_KEY ?? ''
const TIMEOUT_MS     = parseInt(process.env.PARTNER_TIMEOUT_MS ?? '8000')
const FALLBACK_MODE  = process.env.PARTNER_FALLBACK_MODE === 'cached'

// ── TTL cache (2 min for wallet data) ────────────────────────────────────────
const zCache = new Map<string, { value: unknown; expiresAt: number }>()
function zGet<T>(key: string): T | null {
  const e = zCache.get(key)
  if (!e) return null
  if (Date.now() > e.expiresAt) { zCache.delete(key); return null }
  return e.value as T
}
function zSet(key: string, value: unknown, ttlMs = 2 * 60_000): void {
  zCache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface TokenPosition {
  name:            string
  symbol:          string
  chain:           string
  balance:         number
  balanceUsd:      number
  priceUsd:        number
  contractAddress: string
}

export interface DeFiPosition {
  protocol:  string
  chain:     string
  type:      'lending' | 'borrowing' | 'lp' | 'staking' | 'farming'
  valueUsd:  number
  apy?:      number
  tokens:    string[]
}

export interface Portfolio {
  totalValueUsd:  number
  totalPositions: number
  chains:         string[]
  tokens:         TokenPosition[]
  defiPositions:  DeFiPosition[]
}

// ── Fallback data ─────────────────────────────────────────────────────────────

const FALLBACK_PORTFOLIO: Portfolio = {
  totalValueUsd:  5_200.00,
  totalPositions: 4,
  chains:         ['ethereum', 'base'],
  tokens: [
    { name: 'USD Coin', symbol: 'USDC', chain: 'base',     balance: 5000, balanceUsd: 5000, priceUsd: 1,    contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
    { name: 'Ethereum', symbol: 'ETH',  chain: 'ethereum', balance: 0.05, balanceUsd: 200,  priceUsd: 4000, contractAddress: '0x0000000000000000000000000000000000000000' },
  ],
  defiPositions: [],
}

// ── Internal ──────────────────────────────────────────────────────────────────

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const SOL_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const warnedInvalidAddresses = new Set<string>()

export function isValidWalletAddress(address: string): boolean {
  const trimmed = address.trim()
  return EVM_ADDRESS_RE.test(trimmed) || SOL_ADDRESS_RE.test(trimmed)
}

function warnInvalidAddress(address: string): void {
  if (!address) return
  if (warnedInvalidAddresses.has(address)) return
  warnedInvalidAddresses.add(address)
  console.warn('[zerion] Invalid wallet address; using fallback data:', address)
}

function authHeader(): string {
  const encoded = Buffer.from(`${ZERION_API_KEY}:`).toString('base64')
  return `Basic ${encoded}`
}

async function zerionFetch<T>(path: string): Promise<T> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${ZERION_BASE}${path}`, {
      headers: { Authorization: authHeader() },
      signal:  controller.signal,
    })
    if (!res.ok) throw new Error(`Zerion ${res.status}: ${await res.text()}`)
    const json = await res.json() as { data: T }
    return json.data
  } finally {
    clearTimeout(id)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** GET /v1/wallets/{address}/portfolio — cached 2 min */
export async function getPortfolio(address: string): Promise<Portfolio> {
  if (FALLBACK_MODE || !ZERION_API_KEY) return FALLBACK_PORTFOLIO
  if (!isValidWalletAddress(address)) { warnInvalidAddress(address); return FALLBACK_PORTFOLIO }

  const key = `portfolio:${address}`
  const cached = zGet<Portfolio>(key)
  if (cached) return cached

  try {
    const raw = await zerionFetch<{
      attributes: {
        total: { positions: number }
        positions_distribution_by_chain: Record<string, number>
        changes: unknown
      }
    }>(`/wallets/${address}/portfolio`)

    const [tokens, defi] = await Promise.all([getTokenPositions(address), getDeFiPositions(address)])
    const totalValueUsd = tokens.reduce((s, t) => s + t.balanceUsd, 0)
      + defi.reduce((s, d) => s + d.valueUsd, 0)

    const result: Portfolio = {
      totalValueUsd,
      totalPositions: raw.attributes.total.positions,
      chains: Object.keys(raw.attributes.positions_distribution_by_chain),
      tokens,
      defiPositions: defi,
    }
    zSet(key, result)
    return result
  } catch (err) {
    console.warn('[zerion] getPortfolio fallback:', err)
    return FALLBACK_PORTFOLIO
  }
}

/** GET /v1/wallets/{address}/positions?filter[position_types]=wallet — cached 2 min */
export async function getTokenPositions(address: string): Promise<TokenPosition[]> {
  if (FALLBACK_MODE || !ZERION_API_KEY) return FALLBACK_PORTFOLIO.tokens
  if (!isValidWalletAddress(address)) { warnInvalidAddress(address); return FALLBACK_PORTFOLIO.tokens }

  const key = `tokens:${address}`
  const cached = zGet<TokenPosition[]>(key)
  if (cached) return cached

  try {
    const raw = await zerionFetch<Array<{
      attributes: {
        name: string; symbol: string; quantity: { float: number }
        value: number; price: number
        fungible_info: { implementations: Array<{ address: string; chain_id: string }> }
      }
    }>>(`/wallets/${address}/positions?filter[position_types]=wallet`)

    const result = raw.map(p => ({
      name:            p.attributes.name,
      symbol:          p.attributes.symbol,
      chain:           p.attributes.fungible_info.implementations[0]?.chain_id ?? 'unknown',
      balance:         p.attributes.quantity.float,
      balanceUsd:      p.attributes.value,
      priceUsd:        p.attributes.price,
      contractAddress: p.attributes.fungible_info.implementations[0]?.address ?? '',
    }))
    zSet(key, result)
    return result
  } catch (err) {
    console.warn('[zerion] getTokenPositions fallback:', err)
    return FALLBACK_PORTFOLIO.tokens
  }
}

/** GET /v1/wallets/{address}/positions — cached 2 min */
export async function getDeFiPositions(address: string): Promise<DeFiPosition[]> {
  if (FALLBACK_MODE || !ZERION_API_KEY) return FALLBACK_PORTFOLIO.defiPositions
  if (!isValidWalletAddress(address)) { warnInvalidAddress(address); return FALLBACK_PORTFOLIO.defiPositions }

  const key = `defi:${address}`
  const cached = zGet<DeFiPosition[]>(key)
  if (cached) return cached

  try {
    const raw = await zerionFetch<Array<{
      attributes: {
        protocol: string; position_type: string; value: number; apy?: number
        fungible_info?: { symbol: string }
      }
      relationships?: { chain?: { data?: { id: string } } }
    }>>(`/wallets/${address}/positions?filter[position_types]=deposit,staked,locked,loan`)

    const result = raw.map(p => ({
      protocol:  p.attributes.protocol ?? 'unknown',
      chain:     p.relationships?.chain?.data?.id ?? 'unknown',
      type:      mapPositionType(p.attributes.position_type),
      valueUsd:  p.attributes.value,
      apy:       p.attributes.apy,
      tokens:    [p.attributes.fungible_info?.symbol ?? ''].filter(Boolean),
    }))
    zSet(key, result)
    return result
  } catch (err) {
    console.warn('[zerion] getDeFiPositions fallback:', err)
    return FALLBACK_PORTFOLIO.defiPositions
  }
}

/** Human-readable portfolio summary formatted for agent context. */
export async function getPortfolioSummary(address: string): Promise<string> {
  const portfolio = await getPortfolio(address)
  const lines: string[] = [
    `Portfolio for ${address}`,
    `Total Value: $${portfolio.totalValueUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    `Chains: ${portfolio.chains.join(', ')}`,
    '',
    'Token Holdings:',
  ]
  for (const t of portfolio.tokens) {
    lines.push(`  ${t.symbol} (${t.chain}): ${t.balance.toFixed(4)} = $${t.balanceUsd.toFixed(2)}`)
  }
  if (portfolio.defiPositions.length > 0) {
    lines.push('', 'DeFi Positions:')
    for (const d of portfolio.defiPositions) {
      const apyStr = d.apy ? ` @ ${d.apy.toFixed(2)}% APY` : ''
      lines.push(`  ${d.protocol} (${d.chain}) ${d.type}: $${d.valueUsd.toFixed(2)}${apyStr}`)
    }
  } else {
    lines.push('', 'No active DeFi positions.')
  }
  return lines.join('\n')
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapPositionType(raw: string): DeFiPosition['type'] {
  const map: Record<string, DeFiPosition['type']> = {
    deposited: 'lending',
    staked:    'staking',
    locked:    'staking',
    borrowed:  'borrowing',
    provided:  'lp',
  }
  return map[raw] ?? 'lending'
}
