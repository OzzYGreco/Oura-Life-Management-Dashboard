import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import { db } from '../db'
import { trades } from '../db/schema'
import { eq, sql } from 'drizzle-orm'

/**
 * Logos for traded assets, fetched once and kept on disk.
 *   first:  TradingView's symbol search (the logo it shows on charts), looked up
 *           on Bybit for crypto, and by type for stocks and futures (CL = oil)
 *   then:   crypto from CoinGecko search (highest-ranked exact symbol),
 *           stocks from financialmodelingprep's public logo images
 *   else:   none; the client shows its letter badge
 * TradingView's endpoints are unofficial, so they can change; the fallbacks
 * keep logos coming if they do.
 * A miss is remembered for a day so a failing lookup isn't retried on every
 * page load. Only the ticker leaves the machine.
 */
const router = Router()
// v2: the cross-type matcher. Old lookups (some matched the wrong type) are dropped.
const dir = path.join(__dirname, '../../uploads/asset-icons/v2')
fs.mkdirSync(dir, { recursive: true })
const MISS_TTL = 86_400_000
const inflight = new Map<string, Promise<string | null>>()

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif' }

async function fetchJson(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json() as Promise<any>
}

const TV_HEADERS = { Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/', 'User-Agent': 'Mozilla/5.0' }

async function tvSearch(query: string): Promise<any[]> {
  const r = await fetch(`https://symbol-search.tradingview.com/symbol_search/v3/?${query}&hl=0&lang=en&domain=production`, {
    signal: AbortSignal.timeout(10_000), headers: TV_HEADERS,
  })
  if (!r.ok) throw new Error(`${r.status}`)
  const d: any = await r.json()
  return d.symbols ?? (Array.isArray(d) ? d : [])
}

/** Where a symbol's main listing trades: these win ties over regional copies. */
const PRIMARY = new Set(['CME', 'CME_MINI', 'CBOT', 'CBOT_MINI', 'COMEX', 'NYMEX', 'ICEUS', 'EUREX', 'NASDAQ', 'NYSE', 'AMEX', 'NYSE ARCA', 'CBOE', 'SP', 'TVC', 'BYBIT', 'BINANCE'])
const KIND_TYPES: Record<string, string[]> = {
  crypto: ['spot', 'swap', 'crypto', 'futures'],
  stocks: ['stock', 'dr', 'fund', 'etf'],
  futures: ['futures'],
}
const strip = (x: unknown) => String(x ?? '').replace(/<\/?em>/g, '').toUpperCase()

/**
 * TradingView's logo for a symbol. The instrument is a hint, not a filter:
 * the hinted search runs first (crypto on Bybit's own pairs, stocks and
 * futures by type), then a plain search across every type. Only exact
 * matches count (BTC = BTCUSDT / BTCUSDT.P, ES = ES or ES1!). The hinted type
 * must be a listing that counts (main exchange or top-ranked); failing that,
 * the logo is what the ticker mainly is (QQQ = Invesco's mountain, never the
 * Canadian miner), and NQ logged as crypto still gets the Nasdaq future.
 */
async function tradingViewLogo(kind: string, symbol: string): Promise<string | null> {
  const S = symbol.replace(/^1000+/, '')
  const enc = encodeURIComponent
  const hinted = kind === 'crypto'
    ? [`text=${enc(S)}USDT&exchange=BYBIT`, `text=${enc(S)}&search_type=crypto`]
    : kind === 'stocks' ? [`text=${enc(S)}&search_type=stocks`]
    : kind === 'futures' ? [`text=${enc(S)}&search_type=futures`]
    : []
  const plain = [`text=${enc(S)}`]

  const exact = (c: any) => {
    const sym = strip(c.symbol)
    const t = String(c.type ?? '')
    if (t === 'spot' || t === 'swap' || t === 'crypto' || (t === 'futures' && /USDT|USD|PERP/.test(sym) && sym.startsWith(S))) {
      return [`${S}USDT`, `${S}USDT.P`, `${S}USD`, `${S}USDC`, `${S}PERP`, `${S}USD.P`].includes(sym) || strip(c.base_currency) === S
    }
    return sym === S || sym === `${S}1!`
  }
  const logoOf = (c: any) => c.logo?.logoid ?? c.logoid ?? c.base_currency_logoid ?? null
  const primary = (c: any) => PRIMARY.has(strip(c.exchange)) || PRIMARY.has(strip(c.source_id))
  const flag = (c: any) => String(logoOf(c)).startsWith('country/')   // a flag, not the asset

  // Under the instrument you picked: only that type, on a main exchange. A
  // type-filtered search returns strays: "stocks" for QQQ gives Questcorp
  // Mining on the CSE, because Invesco's QQQ is listed as a fund.
  const pickHinted = (list: any[]) => list
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => exact(c) && logoOf(c) && KIND_TYPES[kind]?.includes(String(c.type)) && primary(c))
    .sort((a, b) => (Number(primary(b.c)) - Number(primary(a.c))) || (Number(flag(a.c)) - Number(flag(b.c))) || a.i - b.i)[0]?.c

  // Otherwise: what the ticker mainly is, whatever your switch says. TradingView's
  // own ranking, nudged towards main exchanges and away from flags.
  const pickPlain = (list: any[]) => list
    .map((c, i) => ({ c, i, s: (primary(c) ? 30 : 0) - (flag(c) ? 40 : 0) - i * 2 }))
    .filter(({ c }) => exact(c) && logoOf(c))
    .sort((a, b) => b.s - a.s)[0]?.c

  let best: any = null
  for (const q of hinted) { best = pickHinted(await tvSearch(q)); if (best) break }
  if (!best) best = pickPlain(await tvSearch(plain[0]))
  const logoid = best ? logoOf(best) : null
  return logoid ? `https://s3-symbol-logo.tradingview.com/${logoid}.svg` : null
}

async function fallbackUrl(kind: string, symbol: string): Promise<string | null> {
  if (kind === 'crypto') {
    const q = symbol.replace(/^1000+/, '')
    const d = await fetchJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`)
    const coins = (d.coins ?? []).filter((c: any) => String(c.symbol).toUpperCase() === q)
      .sort((a: any, b: any) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9))
    return coins[0]?.large ?? null
  }
  if (kind === 'stocks') return `https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol)}.png`
  return null
}

async function download(url: string): Promise<{ buf: Buffer; ext: string } | null> {
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  const type = (r.headers.get('content-type') ?? '').split(';')[0]
  const ext = Object.entries(TYPES).find(([, t]) => t === type)?.[0]
  if (!r.ok || !ext) return null
  const buf = Buffer.from(await r.arrayBuffer())
  return buf.length >= 100 ? { buf, ext } : null
}

async function resolve(kind: string, symbol: string): Promise<string | null> {
  const base = `${kind}-${symbol}`
  const hit = fs.readdirSync(dir).find(f => f.startsWith(`${base}.`) && !f.endsWith('.none'))
  if (hit) return path.join(dir, hit)
  const miss = path.join(dir, `${base}.none`)
  if (fs.existsSync(miss) && Date.now() - fs.statSync(miss).mtimeMs < MISS_TTL) return null

  try {
    let img: { buf: Buffer; ext: string } | null = null
    try { const tv = await tradingViewLogo(kind, symbol); if (tv) img = await download(tv) } catch { /* try the fallback */ }
    if (!img) { const fb = await fallbackUrl(kind, symbol); if (fb) img = await download(fb) }
    if (!img) throw new Error('no logo')
    const file = path.join(dir, `${base}.${img.ext}`)
    fs.writeFileSync(file, img.buf)
    if (fs.existsSync(miss)) fs.unlinkSync(miss)
    return file
  } catch (e: any) {
    // Rate limits and timeouts are worth retrying soon; a real miss is not.
    const transient = /^(429|5\d\d)$/.test(e?.message) || e?.name === 'TimeoutError' || e?.name === 'AbortError'
    if (!transient) fs.writeFileSync(miss, '')
    return null
  }
}

const FUTURES_EXCHANGES = new Set(['CME', 'CME_MINI', 'CBOT', 'CBOT_MINI', 'NYMEX', 'COMEX', 'ICEUS', 'EUREX'])
const STOCK_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'NYSE ARCA', 'CBOE', 'ARCA'])
type Instrument = 'Crypto' | 'Stocks' | 'Futures'
interface Identity { instrument: Instrument | null; name: string | null; exchange: string | null; why: string }

/**
 * What a ticker is, for the trade form's instrument switch:
 *  1. how this journal has logged it before (BTC stays Crypto even though CME lists BTC futures)
 *  2. a future on a major US exchange that TradingView ranks near the top (ES, NQ, CL, GC)
 *  3. a stock or fund on a main US exchange that TradingView ranks near the top (NVDA, SPY)
 *  4. a pair on Bybit (HYPE, TAO, PEPE: plain search ranks a foreign fund or stock first)
 *  5. a US stock further down the results
 *  6. otherwise the first exact match of a type the journal knows
 */
async function identify(symbol: string): Promise<Identity> {
  const S = symbol.replace(/^1000+/, '')
  const past = db.select({ instrument: trades.instrument, n: sql<number>`count(*)` }).from(trades)
    .where(eq(sql`upper(${trades.asset})`, symbol)).groupBy(trades.instrument).all().sort((a, b) => b.n - a.n)[0]
  if (past) return { instrument: past.instrument as Instrument, name: null, exchange: null, why: `you've logged ${symbol} as ${past.instrument.toLowerCase()} before` }

  const plain = (await tvSearch(`text=${encodeURIComponent(S)}`)).map(c => ({ ...c, sym: strip(c.symbol), ex: strip(c.exchange) }))
  const desc = (c: any) => String(c.description ?? '').replace(/<\/?em>/g, '') || null
  const fut = plain.slice(0, 3).find(c => c.type === 'futures' && (c.sym === S || c.sym === `${S}1!`) && FUTURES_EXCHANGES.has(c.ex))
  if (fut) return { instrument: 'Futures', name: desc(fut), exchange: fut.exchange, why: 'TradingView' }

  // A US stock TradingView ranks near the top beats Bybit's tokenised copy (NVDAUSDT, SPYUSDT).
  const isStock = (c: any) => ['stock', 'fund', 'dr', 'etf'].includes(c.type) && c.sym === S && STOCK_EXCHANGES.has(c.ex)
  const topStock = plain.slice(0, 3).find(isStock)
  if (topStock) return { instrument: 'Stocks', name: desc(topStock), exchange: topStock.exchange, why: 'TradingView' }

  const bybit = (await tvSearch(`text=${encodeURIComponent(S)}USDT&exchange=BYBIT`)).find(c => [`${S}USDT`, `${S}USDT.P`].includes(strip(c.symbol)))
  if (bybit) return { instrument: 'Crypto', name: desc(bybit), exchange: 'Bybit', why: 'TradingView' }

  const stock = plain.find(isStock)
  if (stock) return { instrument: 'Stocks', name: desc(stock), exchange: stock.exchange, why: 'TradingView' }

  const any = plain.find(c => (c.sym === S || c.sym === `${S}1!` || c.sym === `${S}USDT` || c.sym === `${S}USD`) && ['futures', 'stock', 'fund', 'dr', 'spot', 'swap'].includes(c.type))
  if (any) {
    const instrument: Instrument = any.type === 'futures' && !/USD/.test(any.sym) ? 'Futures' : ['spot', 'swap'].includes(any.type) || /USD/.test(any.sym) ? 'Crypto' : 'Stocks'
    return { instrument, name: desc(any), exchange: any.exchange, why: 'TradingView' }
  }
  return { instrument: null, name: null, exchange: null, why: 'not found' }
}

const identified = new Map<string, { at: number; v: Identity }>()
router.get('/identify/:symbol', async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase()
    if (!/^[A-Z0-9.!]{1,20}$/.test(symbol)) return res.status(400).end()
    const hit = identified.get(symbol)
    if (hit && Date.now() - hit.at < 3_600_000) return res.json(hit.v)
    const v = await identify(symbol)
    if (v.why !== 'not found' && !v.why.startsWith('you')) identified.set(symbol, { at: Date.now(), v })
    res.json(v)
  } catch (e) { next(e) }
})

router.get('/:kind/:symbol', async (req, res, next) => {
  try {
    const kind = req.params.kind.toLowerCase()
    const symbol = req.params.symbol.toUpperCase()
    if (!/^[a-z]+$/.test(kind) || !/^[A-Z0-9.]{1,20}$/.test(symbol)) return res.status(400).end()
    const key = `${kind}-${symbol}`
    if (!inflight.has(key)) inflight.set(key, resolve(kind, symbol).finally(() => inflight.delete(key)))
    const file = await inflight.get(key)!
    if (!file) return res.status(404).set('Cache-Control', 'public, max-age=86400').end()
    res.set('Cache-Control', 'public, max-age=604800').sendFile(file)
  } catch (e) { next(e) }
})

export default router
