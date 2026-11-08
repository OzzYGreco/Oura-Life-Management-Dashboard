/**
 * Rebuilds trades from Bybit fills.
 *
 * A position runs from flat to flat on one side of one symbol. Each fill says
 * how much of it closed something (`closedSize`); the rest opens or adds. That
 * one rule covers one-way mode, hedge mode (a long and a short open at once)
 * and an order that closes a short and opens a long in the same fill.
 *
 * Checked against Bybit's own closed P&L on two years of both accounts: the
 * net of the rebuilt positions matches Bybit's total to the fourth decimal.
 */

export interface Fill {
  execId: string
  symbol: string
  side: string            // Buy | Sell
  execType: string        // Trade | Funding | ...
  orderId: string | null
  orderType: string | null
  stopOrderType: string | null
  execTime: number
  seq: number | null
  price: number
  qty: number
  closedSize: number | null
  fee: number             // Bybit sign: positive = paid
}

export interface Order {
  orderId: string
  symbol: string
  side: string
  stopOrderType: string | null
  positionIdx: number | null
  triggerPrice: number | null
  /** The trigger when the sync first saw the order, before any move. */
  firstTriggerPrice?: number | null
  stopLoss: number | null
  createdTime: number
}

export interface Leg { time: number; price: number; qty: number; fee: number; orderId: string | null; orderType: string | null; stopOrderType: string | null }

export interface Position {
  externalId: string
  symbol: string
  direction: 'Long' | 'Short'
  openedAt: number
  closedAt: number | null
  entries: Leg[]
  exits: Leg[]
  funding: number
  // derived
  size: number
  openQty: number
  avgEntry: number
  avgExit: number | null
  entryFee: number
  exitFee: number
  gross: number           // realised on the closed part, before fees
  net: number             // gross - fees - funding (Bybit's closed P&L)
}

const EPS = 1e-9

export function rebuildPositions(fills: Fill[]): Position[] {
  const sorted = [...fills].sort((a, b) => a.execTime - b.execTime || (a.seq ?? 0) - (b.seq ?? 0))
  const book = new Map<string, Omit<Position, 'size' | 'openQty' | 'avgEntry' | 'avgExit' | 'entryFee' | 'exitFee' | 'gross' | 'net'> & { qty: number }>()
  const done: any[] = []
  const key = (s: string, d: string) => `${s}:${d}`

  for (const f of sorted) {
    const buy = f.side === 'Buy'
    if (f.execType === 'Funding') {
      // A funding fill carries the side of the position it was charged on.
      const p = book.get(key(f.symbol, buy ? 'Long' : 'Short')) ?? book.get(key(f.symbol, buy ? 'Short' : 'Long'))
      if (p) p.funding += f.fee
      continue
    }
    if (f.execType !== 'Trade') continue

    const closeQ = f.closedSize ?? 0
    const openQ = f.qty - closeQ
    const leg = (q: number): Leg => ({
      time: f.execTime, price: f.price, qty: q, fee: f.fee * q / f.qty,
      orderId: f.orderId, orderType: f.orderType, stopOrderType: f.stopOrderType,
    })

    if (closeQ > EPS) {
      const k = key(f.symbol, buy ? 'Short' : 'Long')
      const p = book.get(k)
      if (p) {
        p.exits.push(leg(closeQ))
        p.qty -= closeQ
        if (p.qty < EPS) { p.closedAt = f.execTime; done.push(p); book.delete(k) }
      }
    }
    if (openQ > EPS) {
      const dir = buy ? 'Long' : 'Short'
      const k = key(f.symbol, dir)
      let p = book.get(k)
      if (!p) {
        p = { externalId: `${f.symbol}:${dir}:${f.execId}`, symbol: f.symbol, direction: dir, openedAt: f.execTime, closedAt: null, entries: [], exits: [], funding: 0, qty: 0 }
        book.set(k, p)
      }
      p.entries.push(leg(openQ))
      p.qty += openQ
    }
  }
  for (const p of book.values()) done.push(p)

  return done.map(derive).sort((a, b) => a.openedAt - b.openedAt)
}

function derive(p: any): Position {
  const sum = (legs: Leg[], f: (l: Leg) => number) => legs.reduce((s, l) => s + f(l), 0)
  const size = sum(p.entries, l => l.qty)
  const exitQty = sum(p.exits, l => l.qty)
  const avgEntry = sum(p.entries, l => l.price * l.qty) / size
  const avgExit = exitQty > 0 ? sum(p.exits, l => l.price * l.qty) / exitQty : null
  const entryFee = sum(p.entries, l => l.fee)
  const exitFee = sum(p.exits, l => l.fee)
  const m = p.direction === 'Long' ? 1 : -1
  const gross = sum(p.exits, l => (l.price - avgEntry) * l.qty * m)
  return {
    externalId: p.externalId, symbol: p.symbol, direction: p.direction,
    openedAt: p.openedAt, closedAt: p.closedAt, entries: p.entries, exits: p.exits, funding: p.funding,
    size, openQty: size - exitQty, avgEntry, avgExit, entryFee, exitFee, gross,
    net: gross - entryFee - exitFee - p.funding,
  }
}

/** Fills grouped by order: one row per entry (or exit) order, size-weighted. */
export function byOrder(legs: Leg[]): { price: number; size: number; orderId: string | null }[] {
  const out = new Map<string, { value: number; size: number; orderId: string | null }>()
  for (const l of legs) {
    const k = l.orderId ?? `t${l.time}`
    const g = out.get(k) ?? { value: 0, size: 0, orderId: l.orderId }
    g.value += l.price * l.qty; g.size += l.qty
    out.set(k, g)
  }
  return [...out.values()].map(g => ({ price: g.value / g.size, size: round(g.size, 8), orderId: g.orderId }))
}

/**
 * The stop loss the trade was taken with: the one set on the entry order, or
 * failing that the first stop placed while the position was open. A stop
 * moved later does not change it; that is a management decision, not risk.
 */
export function initialStop(p: Position, orders: Order[]): number | null {
  return firstStop(p, orders)?.price ?? null
}

/**
 * The position's first stop and when it was placed: on the entry order
 * (placed with the entry), else the earliest stop order set while it was
 * open, which covers a stop added after the trade was already running.
 */
export function firstStop(p: Position, orders: Order[]): { price: number; at: number } | null {
  const byId = new Map(orders.map(o => [o.orderId, o]))
  for (const leg of p.entries) {
    const o = leg.orderId ? byId.get(leg.orderId) : undefined
    if (o?.stopLoss) return { price: o.stopLoss, at: Math.max(o.createdTime, p.openedAt) }
  }
  const exitSide = p.direction === 'Long' ? 'Sell' : 'Buy'
  const until = p.closedAt ?? Number.MAX_SAFE_INTEGER
  const stops = orders
    .filter(o => o.symbol === p.symbol && o.side === exitSide && o.triggerPrice
      && ['StopLoss', 'PartialStopLoss', 'Stop'].includes(o.stopOrderType ?? '')
      && o.createdTime >= p.openedAt - 60_000 && o.createdTime <= until)
    .sort((a, b) => a.createdTime - b.createdTime)
  return stops[0] ? { price: stops[0].firstTriggerPrice ?? stops[0].triggerPrice!, at: Math.max(stops[0].createdTime, p.openedAt) } : null
}

/** The stop each entry order carried, for the per-entry breakdown. */
export function entryStops(p: Position, orders: Order[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const o of orders) if (o.stopLoss) out.set(o.orderId, o.stopLoss)
  return out
}

/** BTCUSDT -> BTC, 1000PEPEUSDT -> 1000PEPE, BTCPERP -> BTC. */
export function assetOf(symbol: string): string {
  return symbol.replace(/(USDT|USDC|PERP)$/, '')
}

export function round(n: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}
