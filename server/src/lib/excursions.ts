import { db } from '../db'
import { trades, tradeExcursions } from '../db/schema'
import { eq } from 'drizzle-orm'

/**
 * MFE / MAE: how far a trade went in its favour and against it while open,
 * from Bybit's public USDT-perp candles (no key needed). In R, where 1R is
 * the price distance to the stop, or the planned risk spread over the size
 * when there was no stop.
 *
 * Candles are coarse at the edges: the candle a trade opened in also holds
 * prices from before the entry, and the closing candle prices from after the
 * exit. So the first and last candles only count the entry and exit prices;
 * full highs and lows are used for the candles in between. A trade over
 * within one candle gets its MFE/MAE from entry and exit alone.
 */

type Trade = typeof trades.$inferSelect
const INTERVALS = [1, 3, 5, 15, 30, 60, 120, 240, 720]
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function symbolOf(t: Trade) {
  if (t.externalId) return t.externalId.split(':')[0]
  return `${t.asset.toUpperCase()}USDT`
}

const openMs = (t: Trade) => Date.parse(`${t.date}T${t.time ?? '00:00'}:00Z`)
const closeMs = (t: Trade) => (t.closedAt ? Date.parse(t.closedAt) : openMs(t) + (t.durationMinutes ?? 0) * 60_000)

function rUnit(t: Trade): number | null {
  if (t.stopLoss != null && Math.abs(t.entryPrice - t.stopLoss) > 0) return Math.abs(t.entryPrice - t.stopLoss)
  if (t.riskDollars && t.size) return t.riskDollars / t.size
  return null
}

const basisOf = (t: Trade) => [t.entryPrice, t.exitPrice, t.date, t.time, t.closedAt, t.durationMinutes, t.stopLoss, t.riskDollars, t.size].join('|')

/** Candles as [start, open, high, low, close], oldest first. */
async function candles(symbol: string, start: number, end: number, interval: number): Promise<number[][]> {
  const out: number[][] = []
  let cursor = start
  while (cursor < end) {
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&start=${cursor}&end=${end}&limit=1000`
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!r.ok) throw new Error(`${r.status}`)
    const d: any = await r.json()
    if (d.retCode !== 0) throw new Error(d.retMsg)
    const rows = (d.result?.list ?? []).map((x: string[]) => x.slice(0, 5).map(Number)).reverse()
    if (!rows.length) break
    out.push(...rows.filter((x: number[]) => !out.length || x[0] > out[out.length - 1][0]))
    const last = rows[rows.length - 1][0]
    if (rows.length < 1000 || last + interval * 60_000 >= end) break
    cursor = last + interval * 60_000
  }
  return out
}

export async function computeExcursion(t: Trade) {
  const unit = rUnit(t)
  const basis = basisOf(t)
  const save = (v: Partial<typeof tradeExcursions.$inferInsert>) => {
    const row = { tradeId: t.id, basis, status: 'ok', computedAt: new Date().toISOString(), ...v }
    db.insert(tradeExcursions).values(row).onConflictDoUpdate({ target: tradeExcursions.tradeId, set: row }).run()
  }
  if (!unit || t.exitPrice == null) return save({ status: 'no-risk' })

  const a = openMs(t), b = closeMs(t)
  const minutes = Math.max(1, (b - a) / 60_000)
  const interval = INTERVALS.find(i => minutes / i <= 1000) ?? 720
  const step = interval * 60_000
  const bars = await candles(symbolOf(t), Math.floor(a / step) * step, b, interval)
  if (!bars.length) return save({ status: 'no-data', intervalMin: interval })

  const long = t.direction === 'Long'
  let hi = Math.max(t.entryPrice, t.exitPrice), lo = Math.min(t.entryPrice, t.exitPrice)
  for (const [start, , high, low] of bars) {
    const first = start <= a && a < start + step
    const last = start <= b && b < start + step
    if (first || last) continue      // edge candles: only the entry and exit prices count
    if (start >= a && start + step <= b + step) { hi = Math.max(hi, high); lo = Math.min(lo, low) }
  }
  const mfePrice = long ? hi : lo
  const maePrice = long ? lo : hi
  const fav = long ? hi - t.entryPrice : t.entryPrice - lo
  const adv = long ? t.entryPrice - lo : hi - t.entryPrice
  save({ mfePrice, maePrice, mfeR: Math.max(0, fav) / unit, maeR: -Math.max(0, adv) / unit, rUnit: unit, intervalMin: interval })
}

let running: Promise<void> | null = null

/** Trades still needing MFE/MAE: closed crypto trades with no row, or a row from older data. */
export function pendingExcursions(accountId?: number) {
  const done = new Map(db.select().from(tradeExcursions).all().map(r => [r.tradeId, r]))
  return db.select().from(trades).where(eq(trades.instrument, 'Crypto')).all()
    .filter(t => (accountId == null || t.accountId === accountId) && t.exitPrice != null)
    .filter(t => { const r = done.get(t.id); return !r || r.basis !== basisOf(t) || r.status === 'error' })
}

/** Works through what's missing in the background, gently (Bybit rate limits). */
export function fillExcursions() {
  if (running) return running
  running = (async () => {
    for (const t of pendingExcursions()) {
      try { await computeExcursion(t) } catch (e: any) {
        db.insert(tradeExcursions).values({ tradeId: t.id, basis: basisOf(t), status: 'error' })
          .onConflictDoUpdate({ target: tradeExcursions.tradeId, set: { basis: basisOf(t), status: 'error', computedAt: new Date().toISOString() } }).run()
        if (/403|country|ip/i.test(e?.message ?? '')) break
      }
      await sleep(150)
    }
  })().finally(() => { running = null })
  return running
}

export const excursionsRunning = () => running != null
