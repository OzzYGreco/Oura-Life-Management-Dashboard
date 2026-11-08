import type { Trade } from '../../../hooks/useTrades'
import { byTime, mean, openedMs, sum } from '../../../lib/tradeStats'
import { loadSessions, sessionAt, hoursIn } from '../../../lib/sessions'

/**
 * The ways trades can be cut, used by both "biggest levers" and the table
 * with a dimension switch. Each dimension buckets a trade (null = leave out)
 * and says how its buckets are ordered.
 */

export interface Dimension {
  key: string
  label: string
  /** How a finding reads: "Trades held under 15 min", "Trades on Mondays" */
  phrase: (bucket: string) => string
  bucket: (t: Trade) => string | null
  order?: string[]
}

const HOLD = [
  { max: 15, label: 'under 15 min' },
  { max: 60, label: '15–60 min' },
  { max: 240, label: '1–4 h' },
  { max: 1440, label: '4–24 h' },
  { max: Infinity, label: 'over 1 day' },
]
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_NAMES: Record<string, string> = { Mon: 'Mondays', Tue: 'Tuesdays', Wed: 'Wednesdays', Thu: 'Thursdays', Fri: 'Fridays', Sat: 'Saturdays', Sun: 'Sundays' }

/** Builds the dimensions for a set of closed trades (some need the whole sequence). */
export function dimensions(closed: Trade[]): Dimension[] {
  // Which trade of the day each was, and what the trade before it (same account, same day) did.
  const nth = new Map<number, number>()
  const after = new Map<number, string>()
  const byAcctDay = new Map<string, Trade[]>()
  for (const t of [...closed].sort(byTime)) {
    const k = `${t.accountId}|${t.date}`
    const list = byAcctDay.get(k) ?? []
    const prev = list[list.length - 1]
    nth.set(t.id, list.length + 1)
    after.set(t.id, !prev ? 'first of the day' : prev.rrRatio != null && prev.rrRatio <= -0.1 ? 'after a loss' : prev.rrRatio != null && prev.rrRatio >= 0.1 ? 'after a win' : 'after a scratch')
    list.push(t); byAcctDay.set(k, list)
  }
  const sessions = loadSessions().filter(s => s.enabled)

  return [
    {
      key: 'hold', label: 'Hold time', phrase: b => `Trades held ${b}`,
      bucket: t => (t.durationMinutes == null ? null : HOLD.find(h => t.durationMinutes! < h.max)!.label),
      order: HOLD.map(h => h.label),
    },
    {
      key: 'session', label: 'Session', phrase: b => (b === 'Outside sessions' ? 'Trades outside your sessions' : `Trades in ${b.split(' (')[0]}`),
      bucket: t => {
        if (!t.time) return null
        const s = sessionAt(sessions, openedMs(t))
        return s ? `${s.name} (${hoursIn(s, 'UTC')} UTC now)` : 'Outside sessions'
      },
      order: [...sessions.map(s => `${s.name} (${hoursIn(s, 'UTC')} UTC now)`), 'Outside sessions'],
    },
    { key: 'setup', label: 'Setup', phrase: b => (b === 'No setup' ? 'Trades with no setup' : `${b} trades`), bucket: t => t.setupLabel?.trim() || 'No setup' },
    { key: 'coin', label: 'Coin', phrase: b => `${b} trades`, bucket: t => t.asset },
    {
      key: 'weekday', label: 'Weekday', phrase: b => `Trades on ${DAY_NAMES[b] ?? b}`,
      bucket: t => DAYS[(new Date(`${t.date}T12:00:00Z`).getUTCDay() + 6) % 7], order: DAYS,
    },
    { key: 'direction', label: 'Direction', phrase: b => `${b}s`, bucket: t => t.direction, order: ['Long', 'Short'] },
    {
      key: 'nth', label: 'Trade # of day', phrase: b => `Your ${b} trade of the day`,
      bucket: t => { const n = nth.get(t.id) ?? 1; return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : '4th+' },
      order: ['1st', '2nd', '3rd', '4th+'],
    },
    {
      key: 'after', label: 'After', phrase: b => `Trades taken ${b}`,
      bucket: t => after.get(t.id) ?? null, order: ['first of the day', 'after a win', 'after a loss', 'after a scratch'],
    },
  ]
}

export interface Lever {
  dim: Dimension
  bucket: string
  n: number
  avgR: number
  netR: number
  restAvg: number | null
  /** R this slice costs (negative) or adds (positive) against the rest of your trades */
  impact: number
}

/**
 * The slices that move your results most: big enough to trust (15+ trades
 * and 8% of the sample), ranked by how much R they cost or add compared
 * with trading like the rest of your trades.
 */
export function levers(closed: Trade[], dims: Dimension[]): Lever[] {
  const withR = closed.filter(t => t.rrRatio != null)
  const minN = Math.max(15, Math.ceil(withR.length * 0.08))
  const out: Lever[] = []
  for (const dim of dims) {
    const groups = new Map<string, Trade[]>()
    for (const t of withR) { const b = dim.bucket(t); if (b) groups.set(b, [...(groups.get(b) ?? []), t]) }
    for (const [bucket, ts] of groups) {
      if (ts.length < minN || ts.length > withR.length - minN) continue
      const rest = withR.filter(t => !ts.includes(t))
      const avg = mean(ts.map(t => t.rrRatio!))!
      const restAvg = mean(rest.map(t => t.rrRatio!))
      const impact = (avg - (restAvg ?? 0)) * ts.length
      out.push({ dim, bucket, n: ts.length, avgR: avg, netR: sum(ts.map(t => t.rrRatio!)), restAvg, impact })
    }
  }
  // Strongest first; one finding per dimension so the list isn't five versions of the same thing.
  const seen = new Set<string>()
  return out.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).filter(l => !seen.has(l.dim.key) && seen.add(l.dim.key))
}
