import { Router } from 'express'
import { db } from '../db'
import { tradingAccounts, bybitExecutions, trades } from '../db/schema'
import { and, eq, gt, sql } from 'drizzle-orm'
import { credentialsFor, keyInfo } from '../lib/bybit/client'
import { syncAccount, syncAll, buildReview, applyReview, getLastChangeAt, positionsFor } from '../lib/bybit/sync'
import { streamState } from '../lib/bybit/stream'

const router = Router()

const keyExpiry = new Map<number, { at: number; expiresAt: string | null }>()

// GET /status - per account: key present, live, last sync, error; plus the
// change stamp the trading page polls to know when to reload.
router.get('/status', async (_req, res, next) => {
  try {
    const accounts = db.select().from(tradingAccounts).all()
    const out = await Promise.all(accounts.map(async a => {
      const creds = credentialsFor(a.bybitKey)
      let expiresAt: string | null = null
      if (creds) {
        const cached = keyExpiry.get(a.id)
        if (cached && Date.now() - cached.at < 6 * 3600_000) expiresAt = cached.expiresAt
        else {
          try { expiresAt = (await keyInfo(creds)).expiresAt; keyExpiry.set(a.id, { at: Date.now(), expiresAt }) } catch { /* shown via lastError */ }
        }
      }
      return {
        accountId: a.id, name: a.name, configured: !!creds, reviewed: !!a.bybitSyncFrom, syncFrom: a.bybitSyncFrom,
        lastSyncAt: a.bybitLastSyncAt, lastError: a.bybitLastError, keyExpiresAt: expiresAt,
        live: streamState(a.id).connected,
      }
    }))
    res.json({ lastChangeAt: getLastChangeAt(), accounts: out })
  } catch (e) { next(e) }
})

// POST /sync - sync now (one account or all)
router.post('/sync', async (req, res, next) => {
  try {
    const id = req.body?.accountId ? Number(req.body.accountId) : null
    res.json(id ? [await syncAccount(id)] : await syncAll())
  } catch (e) { next(e) }
})

// GET /review/:accountId - logged trades against Bybit
router.get('/review/:accountId', (req, res, next) => {
  try { res.json(buildReview(Number(req.params.accountId))) } catch (e) { next(e) }
})

// POST /review/:accountId/apply { syncFrom: 'YYYY-MM-DD', deleteTradeIds: number[] }
router.post('/review/:accountId/apply', (req, res, next) => {
  try {
    const syncFrom = String(req.body?.syncFrom ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(syncFrom)) return res.status(400).json({ error: 'syncFrom must be a date' })
    const deleteTradeIds = Array.isArray(req.body?.deleteTradeIds) ? req.body.deleteTradeIds.map(Number) : []
    const moves = Array.isArray(req.body?.moves)
      ? req.body.moves.map((m: any) => ({ externalId: String(m.externalId), accountId: Number(m.accountId) }))
      : []
    res.json(applyReview(Number(req.params.accountId), { syncFrom, deleteTradeIds, moves }))
  } catch (e) { next(e) }
})

/**
 * One synced trade as Bybit saw it: every fill in and out, and the stop and
 * take-profit orders set while it was open (so a moved stop shows up).
 */
router.get('/trade/:tradeId', (req, res, next) => {
  try {
    const t = db.select().from(trades).where(eq(trades.id, Number(req.params.tradeId))).get()
    if (!t || t.source !== 'bybit' || !t.externalId || !t.bybitAccountId) return res.status(404).json({ error: 'Not a Bybit trade' })
    const { positions, orders: raw } = positionsFor(t.bybitAccountId)
    const orders = raw as (typeof raw[number] & { status?: string | null; takeProfit?: number | null })[]
    const p = positions.find(x => x.externalId === t.externalId)
    if (!p) return res.status(404).json({ error: 'Position not found in the stored fills' })
    const exitSide = p.direction === 'Long' ? 'Sell' : 'Buy'
    const until = p.closedAt ?? Date.now()
    const leg = (l: typeof p.entries[number]) => ({ time: new Date(l.time).toISOString(), price: l.price, qty: l.qty, fee: l.fee, orderType: l.orderType, stopOrderType: l.stopOrderType })
    const protective = orders
      .filter(o => o.symbol === p.symbol && o.side === exitSide && o.triggerPrice && /StopLoss|TakeProfit|Stop/.test(o.stopOrderType ?? '')
        && o.createdTime >= p.openedAt - 60_000 && o.createdTime <= until)
      .sort((a, b) => a.createdTime - b.createdTime)
      .map(o => ({ kind: /TakeProfit/.test(o.stopOrderType!) ? 'tp' : 'sl', price: o.triggerPrice!, at: new Date(o.createdTime).toISOString(), status: o.status }))
    const entryIds = new Set(p.entries.map(e => e.orderId))
    for (const o of orders) if (entryIds.has(o.orderId)) {
      if (o.stopLoss) protective.unshift({ kind: 'sl', price: o.stopLoss, at: new Date(o.createdTime).toISOString(), status: 'with entry' })
      if (o.takeProfit) protective.unshift({ kind: 'tp', price: o.takeProfit, at: new Date(o.createdTime).toISOString(), status: 'with entry' })
    }
    res.json({ symbol: p.symbol, direction: p.direction, entries: p.entries.map(leg), exits: p.exits.map(leg), funding: p.funding, protective })
  } catch (e) { next(e) }
})

/**
 * The fee rates Bybit actually charged each account over the last 90 days
 * (as %, median of fills), to check the calculator's settings against.
 */
router.get('/fee-rates', (_req, res, next) => {
  try {
    const since = Date.now() - 90 * 86_400_000
    const out = db.select().from(tradingAccounts).all().filter(a => a.bybitKey).map(a => {
      const fills = db.select({ fee: bybitExecutions.fee, price: bybitExecutions.price, qty: bybitExecutions.qty, isMaker: bybitExecutions.isMaker })
        .from(bybitExecutions)
        .where(and(eq(bybitExecutions.accountId, a.id), eq(bybitExecutions.execType, 'Trade'), gt(bybitExecutions.execTime, since), sql`${bybitExecutions.qty} > 0`))
        .all()
      const med = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
      const rate = (maker: number) => med(fills.filter(f => f.isMaker === maker).map(f => f.fee / (f.price * f.qty) * 100))
      return { accountId: a.id, name: a.name, makerPct: rate(1), takerPct: rate(0), fills: fills.length, ...fillHabits(a.id) }
    })
    res.json(out)
  } catch (e) { next(e) }
})

/**
 * How this account's orders really fill, for the size calculator. It learns as
 * you trade: every stop-out counts, but each one's weight halves with every
 * HALF_LIFE newer stop-outs on the same coin, so the estimate follows how your
 * fills are going now, better or worse, without jumping on one bad fill.
 *
 * Slippage: how far each stop-out filled past its trigger, as % of price (a
 * fill better than the trigger counts as 0). Per coin, with weighted
 * percentiles: p50 = typical, p90 = 9 stop-outs in 10.
 * A coin with little history on this account leans on the same coin on your
 * other accounts, and failing that on every coin, until it has enough of its
 * own (PRIOR effective stop-outs of pull).
 * Trend: the weighted typical fill over the last RECENT stop-outs against the
 * ones before them.
 * Entries: how often an entry paid the taker fee, weighted the same way.
 */
const HALF_LIFE = 20
const PRIOR = 5
const RECENT = 10

type Pt = { v: number; w: number }
const decay = (i: number) => 0.5 ** (i / HALF_LIFE)
function wq(pts: Pt[], q: number): number {
  const s = [...pts].sort((a, b) => a.v - b.v), total = s.reduce((t, p) => t + p.w, 0)
  let acc = 0
  for (const p of s) { acc += p.w; if (acc >= q * total - 1e-12) return p.v }
  return s[s.length - 1]?.v ?? 0
}
const nEff = (pts: Pt[]) => { const a = pts.reduce((t, p) => t + p.w, 0), b = pts.reduce((t, p) => t + p.w * p.w, 0); return b ? (a * a) / b : 0 }

function fillHabits(accountId: number) {
  const rows = db.all<{ acct: number; symbol: string; side: string; trig: number; avgp: number; t: number }>(sql`
    with f as (
      select account_id, order_id, sum(price * qty) / sum(qty) avgp, min(exec_time) t from bybit_executions
      where exec_type = 'Trade' and qty > 0 group by account_id, order_id)
    select o.account_id acct, o.symbol, o.side, o.trigger_price trig, f.avgp, f.t from bybit_orders o
    join f on f.account_id = o.account_id and f.order_id = o.order_id
    where o.trigger_price > 0 and o.stop_order_type in ('StopLoss', 'PartialStopLoss', 'Stop')
    order by f.t desc`)
  type Row = typeof rows[number]
  const slipOf = (r: Row) => Math.max(0, (r.side === 'Sell' ? r.trig - r.avgp : r.avgp - r.trig) / r.trig * 100)
  const pts = (rs: Row[]): Pt[] => rs.map((r, i) => ({ v: slipOf(r), w: decay(i) }))
  const blend = (own: Pt[], prior: number, q: number) => {
    const n = nEff(own)
    return own.length ? (n * wq(own, q) + PRIOR * prior) / (n + PRIOR) : prior
  }

  // Priors, newest first: every coin on every account, then each coin on every account.
  const everything = pts(rows)
  const coinAll = (sym: string, q: number) => blend(pts(rows.filter(r => r.symbol === sym)), everything.length ? wq(everything, q) : 0, q)

  const mine = rows.filter(r => r.acct === accountId)
  const pooled = pts(mine)
  const symbols = [...new Set(mine.map(r => r.symbol))]
  const slippage = symbols.map(symbol => {
    const own = mine.filter(r => r.symbol === symbol), p = pts(own)
    const recent = p.slice(0, RECENT), before = p.slice(RECENT, RECENT + 3 * HALF_LIFE)
    return {
      symbol, n: p.length, nEff: +nEff(p).toFixed(1), lastPrice: own[0].avgp, lastAt: new Date(own[0].t).toISOString(),
      p50: blend(p, coinAll(symbol, 0.5), 0.5), p90: blend(p, coinAll(symbol, 0.9), 0.9), max: Math.max(...p.map(x => x.v)),
      trend: recent.length >= 5 && before.length >= 5 ? { recent: wq(recent, 0.5), before: wq(before, 0.5) } : null,
    }
  })
  const all = pooled.length ? { n: pooled.length, p50: wq(pooled, 0.5), p90: wq(pooled, 0.9) } : null

  const entryRows = db.all<{ taker: number }>(sql`
    select max(case when is_maker = 0 then 1 else 0 end) taker, min(exec_time) t from bybit_executions
    where account_id = ${accountId} and exec_type = 'Trade' and qty > 0 and coalesce(closed_size, 0) = 0
    group by order_id order by t desc`)
  const ew = entryRows.map((r, i) => ({ v: r.taker, w: decay(i) }))
  const wsum = ew.reduce((t, p) => t + p.w, 0)
  return {
    slippage, all, halfLife: HALF_LIFE,
    entries: { n: entryRows.length, takerShare: wsum ? ew.reduce((t, p) => t + p.v * p.w, 0) / wsum : null },
  }
}

export default router
