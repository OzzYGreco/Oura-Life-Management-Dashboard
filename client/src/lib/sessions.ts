/**
 * Trading sessions, defined once in each exchange's own time zone and
 * converted per day, so daylight saving is never set by hand:
 *   NYSE   09:30–16:00 New York time  (13:30–20:00 UTC in summer, 14:30–21:00 in winter)
 *   London 08:00–16:30 London time
 *   Asia   09:00–18:00 Tokyo time     (no DST)
 * Europe and the US change clocks on different weekends (US: 2nd Sunday of
 * March / 1st Sunday of November; EU: last Sundays of March / October), so
 * for a few weeks a year the gap between London and New York is an hour
 * shorter. Converting each session from its own zone gets those weeks right.
 *
 * One list, shared by the Calendar's session bands, the trading page's
 * session strip and Analytics. Stored in this browser (localStorage).
 */

export interface TradingSession {
  id: string
  name: string
  /** IANA zone the hours are in: the exchange's own clock */
  tz: string
  open: string    // "HH:MM" in tz
  close: string   // "HH:MM" in tz; earlier than open = runs past midnight
  color: string
  enabled: boolean
}

export const SESSION_ZONES: { tz: string; label: string }[] = [
  { tz: 'America/New_York', label: 'New York' },
  { tz: 'America/Chicago', label: 'Chicago' },
  { tz: 'Europe/London', label: 'London' },
  { tz: 'Europe/Frankfurt', label: 'Frankfurt' },
  { tz: 'Asia/Tokyo', label: 'Tokyo' },
  { tz: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { tz: 'Australia/Sydney', label: 'Sydney' },
  { tz: 'UTC', label: 'UTC' },
]
export const zoneLabel = (tz: string) => SESSION_ZONES.find(z => z.tz === tz)?.label ?? tz.split('/').pop()!.replace(/_/g, ' ')

export const DEFAULT_SESSIONS: TradingSession[] = [
  { id: 'asia', name: 'Asia', tz: 'Asia/Tokyo', open: '09:00', close: '18:00', color: '#fbbf24', enabled: true },
  { id: 'london', name: 'London', tz: 'Europe/London', open: '08:00', close: '16:30', color: '#34d399', enabled: true },
  { id: 'nyse', name: 'NYSE', tz: 'America/New_York', open: '09:30', close: '16:00', color: '#818cf8', enabled: true },
]

// v3: v2 converted the old hand-set times as Athens time, which shifted them; it's ignored.
const KEY = 'trading-sessions-v3'
const OLD_KEY = 'cal-trading-sessions'   // the old Calendar setting: only its colours are kept

// ─── Time zone maths (Intl only; no library) ─────────────────────────────────

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function parts(tz: string, ms: number) {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    fmtCache.set(tz, f)
  }
  const o: Record<string, number> = {}
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number }
}

/** Minutes the zone is ahead of UTC at that instant (DST included). */
export function tzOffsetMin(tz: string, ms: number) {
  const p = parts(tz, ms)
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60_000
}

/** The instant a wall-clock time happens in a zone, e.g. 09:30 New York on 2026-03-10. */
export function zonedToUtc(date: string, hhmm: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  const o1 = tzOffsetMin(tz, guess - 0)
  let utc = guess - o1 * 60_000
  const o2 = tzOffsetMin(tz, utc)
  if (o2 !== o1) utc = guess - o2 * 60_000
  return utc
}

/** "HH:MM" of an instant in a zone. */
export function clockIn(tz: string, ms: number) {
  const p = parts(tz, ms)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/** Calendar date (YYYY-MM-DD) of an instant in a zone. */
export function dateIn(tz: string, ms: number) {
  const p = parts(tz, ms)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone

// ─── Storage ─────────────────────────────────────────────────────────────────

/**
 * The sessions, from this browser. The first time, every session starts from
 * its exchange's real hours and switched on; only the colours are kept from
 * the old Calendar setting, whose clock times can't be trusted (it never said
 * which time zone or which side of DST they were set in).
 */
export function loadSessions(): TradingSession[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const saved = JSON.parse(raw) as TradingSession[]
      const ids = new Set(saved.map(s => s.id))
      return [...saved, ...DEFAULT_SESSIONS.filter(d => !ids.has(d.id))]
    }
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? 'null') as { id: string; color?: string }[] | null
    const fresh = DEFAULT_SESSIONS.map(def => ({ ...def, color: old?.find(o => o.id === def.id)?.color || def.color }))
    saveSessions(fresh)
    return fresh
  } catch {
    return DEFAULT_SESSIONS
  }
}

export function saveSessions(s: TradingSession[]) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private window */ }
}

// ─── Per day ─────────────────────────────────────────────────────────────────

export interface SessionWindow { session: TradingSession; start: number; end: number }

/**
 * Each enabled session's real start and end (UTC ms) for the sessions that
 * open on `date` in their own zone. Weekend days are skipped per exchange.
 */
export function windowsForDate(sessions: TradingSession[], date: string, weekends = false): SessionWindow[] {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay()
  if (!weekends && (dow === 0 || dow === 6)) return []   // exchanges are shut at the weekend
  return sessions.filter(s => s.enabled).flatMap(s => {
    const start = zonedToUtc(date, s.open, s.tz)
    let end = zonedToUtc(date, s.close, s.tz)
    if (end <= start) {
      const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1)
      end = zonedToUtc(next.toISOString().slice(0, 10), s.close, s.tz)
    }
    return [{ session: s, start, end }]
  })
}

/** All session windows that touch [from, to) (UTC ms), whichever day they opened. */
export function windowsBetween(sessions: TradingSession[], from: number, to: number): SessionWindow[] {
  const out: SessionWindow[] = []
  for (let t = from - 86_400_000; t < to + 86_400_000; t += 86_400_000) {
    for (const s of sessions.filter(x => x.enabled)) {
      const day = dateIn(s.tz, t)
      for (const w of windowsForDate([s], day)) {
        if (w.end > from && w.start < to && !out.some(o => o.session.id === w.session.id && o.start === w.start)) out.push(w)
      }
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/**
 * The session a trade opened in. When two overlap (London and New York in
 * the afternoon), the one that opened last wins: it's the market that just
 * came in. Outside every session: null.
 */
export function sessionAt(sessions: TradingSession[], ms: number): TradingSession | null {
  const hits = windowsBetween(sessions, ms, ms + 1).filter(w => w.start <= ms && ms < w.end)
  return hits.sort((a, b) => b.start - a.start)[0]?.session ?? null
}

/** How a session reads in another zone today, e.g. "16:30–23:00". */
export function hoursIn(s: TradingSession, tz: string, date = dateIn(s.tz, Date.now())) {
  // The hours as they'd be on that date, weekend or not (the clock still applies).
  const w = windowsForDate([{ ...s, enabled: true }], date, true)[0]
  return `${clockIn(tz, w.start)}–${clockIn(tz, w.end)}`
}
