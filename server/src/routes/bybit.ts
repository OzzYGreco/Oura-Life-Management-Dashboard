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
      return { accountId: a.id, name: a.name, makerPct: rate(1), takerPct: rate(0), fills: fills.length }
    })
    res.json(out)
  } catch (e) { next(e) }
})

export default router
