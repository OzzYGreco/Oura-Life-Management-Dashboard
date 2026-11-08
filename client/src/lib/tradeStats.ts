import type { Trade } from '../hooks/useTrades'

/** Inside ±0.1R a trade is a scratch: fees decided it, not the setup. */
export const BE_R = 0.1

export const pnlOf = (t: Trade) => t.netPnl ?? t.realizedPnl ?? null

/** Closed = it has a result. Open Bybit positions have neither exit nor P&L. */
export const isClosed = (t: Trade) => pnlOf(t) != null && (t.exitPrice != null || t.source !== 'bybit')

export type Outcome = 'win' | 'loss' | 'be'

/** Judged in R when the trade has one, in dollars otherwise. */
export function outcomeOf(t: Trade): Outcome | null {
  if (!isClosed(t)) return null
  if (t.rrRatio != null) return t.rrRatio >= BE_R ? 'win' : t.rrRatio <= -BE_R ? 'loss' : 'be'
  const p = pnlOf(t)!
  return p > 0 ? 'win' : p < 0 ? 'loss' : 'be'
}

export const tradeTime = (t: Trade) => `${t.date}T${t.time ?? '00:00'}`
export const byTime = (a: Trade, b: Trade) => tradeTime(a).localeCompare(tradeTime(b))

/** Opened at, as UTC epoch ms (journal times are UTC). */
export const openedMs = (t: Trade) => Date.parse(`${t.date}T${t.time ?? '00:00'}:00Z`)

/**
 * How the stop came about: with the entry, added later (minutes after the
 * open), or never. A stop added after the open makes "risk at the stop" a
 * poor guide to what the trade was meant to risk.
 */
export function stopTiming(t: Trade): { kind: 'with-entry' | 'later' | 'none' | 'unknown'; minutes?: number } {
  if (t.stopLoss == null && t.riskAtStop == null) return { kind: t.source === 'bybit' ? 'none' : 'unknown' }
  if (!t.stopPlacedAt) return { kind: 'unknown' }
  const mins = (Date.parse(t.stopPlacedAt) - openedMs(t)) / 60_000
  return mins <= 2 ? { kind: 'with-entry' } : { kind: 'later', minutes: Math.round(mins) }
}

export const fmtMinutes = (m: number) =>
  m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${Math.round(m / 1440)}d`

export const fmtR = (r: number | null | undefined, dp = 2) =>
  r == null ? '—' : `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(dp)}R`

export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
export const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
export function median(xs: number[]) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
