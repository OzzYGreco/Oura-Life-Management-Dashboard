/**
 * Bybit -> trade journal.
 *
 * The problem this solves: logging trades by hand fell months behind, and the
 * figures that were logged (size, fees, funding, times) drifted from what the
 * exchange actually did. Now every fill is pulled from Bybit, positions are
 * rebuilt from the fills, and each position is a trade in the journal: written
 * when it opens, filled in when it closes.
 *
 * Ownership: the sync owns the broker facts of a synced trade (times, prices,
 * size, entries and exits, fees, funding, P&L). The journal fields stay the
 * user's and are never touched: setup, notes, mistakes, tags, rules. Stop and
 * risk are filled from Bybit only when empty, because a logged stop is a plan.
 *
 * Gate: an account writes no trades until its review is applied (that sets
 * `bybit_sync_from`). Before then the sync only stores raw fills, so nothing
 * is duplicated before the logged trades are linked to their positions.
 *
 * All times are UTC.
 */
import { db } from '../../db'
import { tradingAccounts, trades, bybitExecutions, bybitOrders } from '../../db/schema'
import { and, eq, isNull, sql, inArray } from 'drizzle-orm'
import { bybitGet, bybitWindowed, credentialsFor, BybitError, type Credentials } from './client'
import { rebuildPositions, initialStop, firstStop, byOrder, assetOf, round, type Fill, type Order, type Position } from './positions'
import { computeTradeFields } from '../tradeMath'

type Account = typeof tradingAccounts.$inferSelect
type Trade = typeof trades.$inferSelect

const DAY = 24 * 3600 * 1000

/** Bumped whenever a sync changes a trade; the trading page polls it. */
let lastChangeAt = 0
export const getLastChangeAt = () => lastChangeAt

// ─── Time ────────────────────────────────────────────────────────────────────

export function utcDate(ms: number): string { return new Date(ms).toISOString().slice(0, 10) }
export function utcTime(ms: number): string { return new Date(ms).toISOString().slice(11, 16) }
export function tradeUtcMs(t: { date: string; time: string | null }): number {
  return Date.parse(`${t.date}T${t.time || '12:00'}:00Z`)
}

// ─── Pull from Bybit into the raw tables ─────────────────────────────────────

function num(v: unknown): number | null {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? n : null
}

function storeFills(accountId: number, list: any[]): number {
  let added = 0
  db.transaction(tx => {
    for (const x of list) {
      const r = tx.insert(bybitExecutions).values({
        execId: x.execId, accountId, symbol: x.symbol, side: x.side, execType: x.execType,
        orderId: x.orderId || null, orderType: x.orderType || null, stopOrderType: x.stopOrderType || null,
        execTime: Number(x.execTime), seq: x.seq != null ? Number(x.seq) : null,
        price: Number(x.execPrice), qty: Number(x.execQty), closedSize: Number(x.closedSize || 0),
        fee: Number(x.execFee || 0), isMaker: x.isMaker ? 1 : 0,
      }).onConflictDoNothing().run()
      added += r.changes
    }
  })
  return added
}

function storeOrders(accountId: number, list: any[]): void {
  db.transaction(tx => {
    for (const o of list) {
      const row = {
        accountId, symbol: o.symbol, side: o.side, orderType: o.orderType || null,
        stopOrderType: o.stopOrderType || null, status: o.orderStatus || null,
        positionIdx: o.positionIdx != null ? Number(o.positionIdx) : null,
        triggerPrice: num(o.triggerPrice), stopLoss: num(o.stopLoss), takeProfit: num(o.takeProfit),
        createdTime: Number(o.createdTime), updatedTime: Number(o.updatedTime || o.createdTime),
      }
      tx.insert(bybitOrders).values({ orderId: o.orderId, ...row })
        .onConflictDoUpdate({ target: [bybitOrders.accountId, bybitOrders.orderId], set: row }).run()
    }
  })
}

async function pull(account: Account, creds: Credentials): Promise<number> {
  const [{ lastFill }] = db.select({ lastFill: sql<number | null>`max(${bybitExecutions.execTime})` })
    .from(bybitExecutions).where(eq(bybitExecutions.accountId, account.id)).all()
  const [{ lastOrder }] = db.select({ lastOrder: sql<number | null>`max(${bybitOrders.updatedTime})` })
    .from(bybitOrders).where(eq(bybitOrders.accountId, account.id)).all()
  // Two days of overlap: fills are keyed by id, so re-reading is harmless.
  const since = (t: number | null) => (t ? t - 2 * DAY : 0)

  const fills = await bybitWindowed(creds, '/v5/execution/list', { category: 'linear' }, since(lastFill))
  const added = storeFills(account.id, fills)

  storeOrders(account.id, await bybitWindowed(creds, '/v5/order/history', { category: 'linear' }, since(lastOrder)))
  // Live orders: the stop on a position that is still open.
  const live = await bybitGet(creds, '/v5/order/realtime', { category: 'linear', settleCoin: 'USDT', openOnly: 0, limit: 50 })
  storeOrders(account.id, live.list ?? [])
  return added
}

// ─── Positions -> trades ─────────────────────────────────────────────────────

function loadFills(accountId: number): Fill[] {
  return db.select().from(bybitExecutions).where(eq(bybitExecutions.accountId, accountId)).all()
    .map(r => ({ ...r, isMaker: undefined } as unknown as Fill))
}

function loadOrders(accountId: number): Order[] {
  return db.select().from(bybitOrders).where(eq(bybitOrders.accountId, accountId)).all()
}

export function positionsFor(accountId: number): { positions: Position[]; orders: Order[] } {
  return { positions: rebuildPositions(loadFills(accountId)), orders: loadOrders(accountId) }
}

/** The broker facts of a position, in the trade table's shape. */
export function brokerFields(p: Position, orders: Order[]) {
  const stopsByOrder = new Map(orders.filter(o => o.stopLoss).map(o => [o.orderId, o.stopLoss!]))
  const entryOrders = byOrder(p.entries)
  const exitOrders = byOrder(p.exits)
  const compounded = entryOrders.length > 1
  const closed = p.closedAt != null
  const lastExit = p.exits[p.exits.length - 1]

  return {
    date: utcDate(p.openedAt),
    time: utcTime(p.openedAt),
    durationMinutes: closed ? Math.round((p.closedAt! - p.openedAt) / 60_000) : null,
    closedAt: closed ? new Date(p.closedAt!).toISOString() : null,
    instrument: 'Crypto',
    asset: assetOf(p.symbol),
    direction: p.direction,
    orderType: p.entries[0]?.orderType ?? 'Market',
    exitOrderType: closed ? (lastExit?.orderType ?? null) : null,
    entryPrice: round(p.avgEntry, 8),
    exitPrice: closed && p.avgExit != null ? round(p.avgExit, 8) : null,
    size: round(p.size, 8),
    isCompounded: compounded ? 1 : 0,
    entries: compounded
      ? entryOrders.map(e => ({ price: round(e.price, 8), size: e.size, ...(e.orderId && stopsByOrder.get(e.orderId) ? { sl: stopsByOrder.get(e.orderId)! } : {}) }))
      : null,
    takeProfits: compounded || exitOrders.length > 1 ? exitOrders.map(e => ({ price: round(e.price, 8), size: e.size })) : null,
    entryFeeAmount: round(p.entryFee, 6),
    exitFeeAmount: closed ? round(p.exitFee, 6) : null,
    // Same sign as the other fee fields: positive = paid, negative = received.
    fundingFeeAmount: round(p.funding, 6),
    slippageAmount: closed ? 0 : null,
    realizedPnl: closed ? round(p.gross, 6) : null,
    netPnl: closed ? round(p.net, 6) : null,
    initialStop: initialStop(p, orders),
    stopPlacedAt: (() => { const s = firstStop(p, orders); return s ? new Date(s.at).toISOString() : null })(),
  }
}

/**
 * Bybit's taker fee for USDT perps at the base tier. A stop fills as a market
 * order, so it pays taker. Used only to estimate the exit fee at the stop.
 */
const TAKER_FEE = 0.00055

/** What the position would lose if stopped at `stop`: distance x size, plus
 *  the entry fees paid and the taker fee to exit at the stop. */
export function riskAtStop(p: Position, stop: number | null): number | null {
  if (stop == null) return null
  return round(Math.abs(p.avgEntry - stop) * p.size + p.entryFee + stop * p.size * TAKER_FEE, 2)
}

function writeTrade(bybitAccountId: number, journalAccountId: number, p: Position, orders: Order[], existing: Trade | null): boolean {
  const { initialStop: sl, ...broker } = brokerFields(p, orders)
  const stopLoss = existing?.stopLoss ?? sl
  const atStop = riskAtStop(p, sl ?? stopLoss)
  // Planned risk: the user's when they set one, otherwise what the stop risked.
  const userRisk = existing?.riskSource === 'user' && existing.riskDollars != null
  const riskDollars = userRisk ? existing!.riskDollars : atStop
  const riskSource = userRisk ? 'user' : riskDollars != null ? 'bybit' : null
  const { deviationPct, rrRatio } = computeTradeFields({ ...broker, riskDollars, netPnl: broker.netPnl })
  const values = { ...broker, stopLoss, riskDollars, riskAtStop: atStop, riskSource, deviationPct, rrRatio, source: 'bybit', externalId: p.externalId, bybitAccountId }

  if (!existing) {
    db.insert(trades).values({ ...values, accountId: journalAccountId }).run()
    return true
  }
  // The journal account is the user's: an existing trade stays where it is.
  // Write only what moved, so an idle sync leaves updated_at alone.
  const changed = Object.entries(values).some(([k, v]) => JSON.stringify((existing as any)[k] ?? null) !== JSON.stringify(v ?? null))
  if (!changed) return false
  db.update(trades).set({ ...values, updatedAt: new Date().toISOString() }).where(eq(trades.id, existing.id)).run()
  return true
}

/**
 * A trade typed in by hand before the sync saw it: same account, coin and
 * side, entry within 0.1%, dated inside the position's life (two days either
 * side). Linked only when exactly one fits, so a guess never merges two trades.
 */
function findHandLogged(accountId: number, p: Position, pool: Trade[]): Trade | null {
  const from = p.openedAt - 2 * DAY
  const to = (p.closedAt ?? Date.now()) + 2 * DAY
  const fits = pool.filter(t =>
    t.asset.toUpperCase() === assetOf(p.symbol).toUpperCase() && t.direction === p.direction
    && Math.abs(t.entryPrice - p.avgEntry) / p.avgEntry < 0.001
    && tradeUtcMs(t) >= from && tradeUtcMs(t) <= to)
  return fits.length === 1 ? fits[0] : null
}

/**
 * Writes every position of one Bybit account into the journal. `moves` sends
 * named positions to another journal account when they are first written
 * (from the review); a position already in the journal is found wherever it
 * lives and updated there. Positions before `bybit_sync_from` are left out
 * unless they are already in the journal or being moved.
 */
export function applyPositions(account: Account, moves: Map<string, number> = new Map()): { created: number; updated: number } {
  if (!account.bybitSyncFrom) return { created: 0, updated: 0 }
  const from = Date.parse(`${account.bybitSyncFrom}T00:00:00Z`)
  const { positions, orders } = positionsFor(account.id)
  const synced = db.select().from(trades).where(eq(trades.bybitAccountId, account.id)).all()
  const byExt = new Map(synced.filter(t => t.externalId).map(t => [t.externalId!, t]))
  const pool = db.select().from(trades)
    .where(and(eq(trades.accountId, account.id), isNull(trades.externalId), eq(trades.instrument, 'Crypto'))).all()

  let created = 0, updated = 0
  for (const p of positions) {
    let existing = byExt.get(p.externalId) ?? null
    const move = moves.get(p.externalId)
    if (!existing && move == null && p.openedAt < from) continue
    if (!existing && move == null) {
      const hand = findHandLogged(account.id, p, pool)
      if (hand) { existing = hand; pool.splice(pool.indexOf(hand), 1) }
    }
    if (writeTrade(account.id, move ?? account.id, p, orders, existing)) existing ? updated++ : created++
  }
  if (created || updated) lastChangeAt = Date.now()
  return { created, updated }
}

// ─── One account, end to end ─────────────────────────────────────────────────

export interface AccountSyncResult { accountId: number; name: string; ok: boolean; newFills: number; created: number; updated: number; message: string }

const running = new Map<number, Promise<AccountSyncResult>>()

/** Serialised per account: a burst of fills runs one sync, not ten. */
export function syncAccount(accountId: number): Promise<AccountSyncResult> {
  const prev = running.get(accountId)
  if (prev) return prev
  const p = runSync(accountId).finally(() => running.delete(accountId))
  running.set(accountId, p)
  return p
}

async function runSync(accountId: number): Promise<AccountSyncResult> {
  const [account] = db.select().from(tradingAccounts).where(eq(tradingAccounts.id, accountId)).all()
  const base = { accountId, name: account?.name ?? '?', newFills: 0, created: 0, updated: 0 }
  const creds = credentialsFor(account?.bybitKey)
  if (!account || !creds) return { ...base, ok: false, message: 'No Bybit key for this account in server/.env' }
  try {
    const newFills = await pull(account, creds)
    const { created, updated } = applyPositions(account)
    db.update(tradingAccounts).set({ bybitLastSyncAt: new Date().toISOString(), bybitLastError: null })
      .where(eq(tradingAccounts.id, accountId)).run()
    const gated = !account.bybitSyncFrom ? ' (waiting for the review before writing trades)' : ''
    return { ...base, ok: true, newFills, created, updated, message: `${newFills} new fills, ${created} trades added, ${updated} updated${gated}` }
  } catch (e) {
    const message = e instanceof BybitError ? e.message : `Sync failed: ${(e as Error).message}`
    db.update(tradingAccounts).set({ bybitLastError: message }).where(eq(tradingAccounts.id, accountId)).run()
    return { ...base, ok: false, message }
  }
}

export function syncedAccounts(): Account[] {
  return db.select().from(tradingAccounts).all().filter(a => credentialsFor(a.bybitKey))
}

export async function syncAll(): Promise<AccountSyncResult[]> {
  return Promise.all(syncedAccounts().map(a => syncAccount(a.id)))
}

// ─── Review: logged trades against Bybit ─────────────────────────────────────

export interface FieldDiff { field: string; logged: unknown; bybit: unknown }
export interface ReviewMatch { tradeId: number; externalId: string; symbol: string; direction: string; openedAt: string; diffs: FieldDiff[] }
export interface ReviewMissing { externalId: string; symbol: string; direction: string; openedAt: string; closedAt: string | null; size: number; avgEntry: number; avgExit: number | null; net: number | null; risk: number | null; suggestAccountId: number | null }
export interface ReviewUnmatched { tradeId: number; date: string; time: string | null; instrument: string; asset: string; direction: string; entryPrice: number; size: number | null; netPnl: number | null; samePositionAs: number | null }
export interface Review {
  accountId: number
  name: string
  applied: boolean
  syncFrom: string | null
  firstPositionAt: string | null
  /** Other synced accounts, with the day each started trading on Bybit. */
  otherAccounts: { accountId: number; name: string; firstFillAt: string | null }[]
  matches: ReviewMatch[]
  missing: ReviewMissing[]
  unmatched: ReviewUnmatched[]
  notOnBybit: ReviewUnmatched[]   // other brokers or instruments: left alone
}

const rel = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? Infinity : Math.abs(a - b) / Math.max(Math.abs(b), 1e-9)

function diffTrade(t: Trade, p: Position, orders: Order[]): FieldDiff[] {
  const b = brokerFields(p, orders)
  const out: FieldDiff[] = []
  const push = (field: string, logged: unknown, bybit: unknown) => out.push({ field, logged, bybit })
  const loggedAt = `${t.date} ${t.time ?? ''}`.trim()
  const realAt = `${b.date} ${b.time}`
  if (t.date !== b.date || !t.time || Math.abs(tradeUtcMs(t) - p.openedAt) > 3 * 60_000) push('opened (UTC)', loggedAt, realAt)
  if (rel(t.entryPrice, b.entryPrice) > 0.0005) push('entry', t.entryPrice, b.entryPrice)
  if (b.exitPrice != null && rel(t.exitPrice, b.exitPrice) > 0.0005) push('exit', t.exitPrice, b.exitPrice)
  if (rel(t.size, b.size) > 0.001) push('size', t.size, b.size)
  const money = (field: string, logged: number | null, bybit: number | null) => {
    if (bybit == null) return
    if (logged == null || Math.abs(logged - bybit) > 0.015) push(field, logged, round(bybit, 4))
  }
  money('entry fee', t.entryFeeAmount, b.entryFeeAmount)
  money('exit fee', t.exitFeeAmount, b.exitFeeAmount)
  money('funding', t.fundingFeeAmount, b.fundingFeeAmount)
  money('net P&L', t.netPnl, b.netPnl)
  if (b.closedAt && t.exitPrice == null) push('status', 'open', 'closed')
  return out
}

export function buildReview(accountId: number): Review {
  const [account] = db.select().from(tradingAccounts).where(eq(tradingAccounts.id, accountId)).all()
  const { positions, orders } = positionsFor(accountId)
  const all = db.select().from(trades).where(eq(trades.accountId, accountId)).all()
  const linked = new Set(db.select({ e: trades.externalId }).from(trades).where(eq(trades.bybitAccountId, accountId)).all().map(t => t.e).filter(Boolean))
  const free = positions.filter(p => !linked.has(p.externalId))
  const crypto = all.filter(t => !t.externalId && t.instrument === 'Crypto')
  const other = all.filter(t => !t.externalId && t.instrument !== 'Crypto')

  // Score every plausible pair; entry price decides, timing breaks ties. A
  // trade logged at its exit (swing trades often are) still sits inside the
  // position's life, so time counts only outside open..close.
  const pairs: [number, Position, Trade][] = []
  for (const p of free) for (const t of crypto) {
    if (t.asset.toUpperCase() !== assetOf(p.symbol).toUpperCase() || t.direction !== p.direction) continue
    const at = tradeUtcMs(t)
    const close = p.closedAt ?? Date.now()
    const gapH = Math.max(p.openedAt - at, at - close, 0) / 3600_000
    if (gapH > 36) continue
    const px = rel(t.entryPrice, p.avgEntry)
    pairs.push([px * 20000 + gapH + Math.abs(p.openedAt - at) / 3600_000 * 0.05, p, t])
  }
  pairs.sort((a, b) => a[0] - b[0])
  const usedP = new Map<string, Trade>(), usedT = new Set<number>()
  const matches: ReviewMatch[] = []
  for (const [, p, t] of pairs) {
    if (usedP.has(p.externalId) || usedT.has(t.id)) continue
    usedP.set(p.externalId, t); usedT.add(t.id)
    matches.push({ tradeId: t.id, externalId: p.externalId, symbol: p.symbol, direction: p.direction, openedAt: new Date(p.openedAt).toISOString(), diffs: diffTrade(t, p, orders) })
  }

  const asUnmatched = (t: Trade): ReviewUnmatched => {
    // A second log of one position (a partial close logged as its own trade)
    const twin = pairs.find(([, p, tt]) => tt.id === t.id && usedP.has(p.externalId) && rel(t.entryPrice, p.avgEntry) < 0.001)
    return {
      tradeId: t.id, date: t.date, time: t.time, instrument: t.instrument, asset: t.asset, direction: t.direction,
      entryPrice: t.entryPrice, size: t.size, netPnl: t.netPnl, samePositionAs: twin ? usedP.get(twin[1].externalId)!.id : null,
    }
  }

  // Real trades were taken here before another account existed on Bybit. A
  // position from then, risking $20 or more, is suggested for that account.
  const otherAccounts = db.select().from(tradingAccounts).all().filter(a => a.bybitKey && a.id !== accountId).map(a => {
    const [{ first }] = db.select({ first: sql<number | null>`min(${bybitExecutions.execTime})` })
      .from(bybitExecutions).where(eq(bybitExecutions.accountId, a.id)).all()
    return { accountId: a.id, name: a.name, firstFillAt: first ? new Date(first).toISOString() : null, first }
  })
  const riskOf = (p: Position) => {
    const sl = initialStop(p, orders)
    return sl != null ? round(Math.abs(p.avgEntry - sl) * p.size, 2) : null
  }
  const suggest = (p: Position, risk: number | null) =>
    risk != null && risk >= 20 ? otherAccounts.find(o => o.first != null && p.openedAt < o.first)?.accountId ?? null : null

  return {
    accountId, name: account.name, applied: !!account.bybitSyncFrom, syncFrom: account.bybitSyncFrom,
    firstPositionAt: positions[0] ? new Date(positions[0].openedAt).toISOString() : null,
    otherAccounts: otherAccounts.map(({ first, ...o }) => o),
    matches: matches.sort((a, b) => a.openedAt.localeCompare(b.openedAt)),
    missing: free.filter(p => !usedP.has(p.externalId)).map(p => ({ ...(() => { const risk = riskOf(p); return { risk, suggestAccountId: suggest(p, risk) } })(),
      externalId: p.externalId, symbol: p.symbol, direction: p.direction,
      openedAt: new Date(p.openedAt).toISOString(), closedAt: p.closedAt ? new Date(p.closedAt).toISOString() : null,
      size: round(p.size, 8), avgEntry: round(p.avgEntry, 8), avgExit: p.avgExit != null ? round(p.avgExit, 8) : null,
      net: p.closedAt ? round(p.net, 4) : null,
    })),
    unmatched: crypto.filter(t => !usedT.has(t.id)).map(asUnmatched),
    notOnBybit: other.map(t => ({ ...asUnmatched(t), samePositionAs: null })),
  }
}

/**
 * Applies a review: links each matched trade to its position (the sync then
 * overwrites its broker facts), removes the trades chosen for removal, and
 * sets the date the account syncs from, which also adds the missing trades.
 */
export function applyReview(accountId: number, opts: { syncFrom: string; deleteTradeIds: number[]; moves?: { externalId: string; accountId: number }[] }) {
  const review = buildReview(accountId)
  db.transaction(tx => {
    for (const m of review.matches) {
      tx.update(trades).set({ externalId: m.externalId, source: 'bybit', bybitAccountId: accountId }).where(eq(trades.id, m.tradeId)).run()
    }
    const removable = new Set(review.unmatched.map(u => u.tradeId))
    const del = opts.deleteTradeIds.filter(id => removable.has(id))
    if (del.length) tx.delete(trades).where(and(eq(trades.accountId, accountId), inArray(trades.id, del), isNull(trades.externalId))).run()
    tx.update(tradingAccounts).set({ bybitSyncFrom: opts.syncFrom }).where(eq(tradingAccounts.id, accountId)).run()
  })
  const [account] = db.select().from(tradingAccounts).where(eq(tradingAccounts.id, accountId)).all()
  const missing = new Set(review.missing.map(p => p.externalId))
  const valid = new Set(db.select({ id: tradingAccounts.id }).from(tradingAccounts).all().map(a => a.id))
  const moves = new Map((opts.moves ?? []).filter(m => missing.has(m.externalId) && valid.has(m.accountId) && m.accountId !== accountId).map(m => [m.externalId, m.accountId]))
  return applyPositions(account, moves)
}
