/**
 * Today, the one-layout redesign (DESIGN.md). Same data and actions as every
 * skin (core/today.ts); one message per moment, rows instead of cards, and the
 * day score as the single bold element.
 */
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import {
  canMarkMissed, canTick, canUnmarkMissed, canUntick, duration, isDone, partOfDay, tickHint,
  useCloseDay, useDayOneOffs, useMarkMissed, useReopenDay, useTick, useToday, useWeeklyTick,
  type DayItem, type TodayView,
} from '../../core/today'
import { onceDate, type Parsed } from '../../core/routine'
import { useOpenReview } from '../core'
import { PageLoader } from '../../components/ui/Spinner'
import { useCurrencyRates } from '../../hooks/useCurrencyRates'
import { MASK, maskMoney, usePrivacy } from '../../core/privacy'
import { convertAmount, formatInCurrency } from '../../lib/utils'
import { QuickAdd, Streak } from '../whoop/Routine'
import '../whoop/routine-today.css'
import './next.css'

type Day = TodayView['day']
type Pulse = TodayView['pulse']

const fmtDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const fmtDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const longDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
const plusDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const ISO = /^\d{4}-\d{2}-\d{2}$/
const errText = (e: unknown) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not save that.'
const pt = (n: number) => String(Math.round(n * 100) / 100)
const clock = (m: number) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}` }
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/** Counts a number up to its new value; instant with reduced motion. */
function useCountUp(target: number, ms = 450) {
  const [v, setV] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    const start = from.current
    from.current = target
    if (start === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(target); return }
    let raf = 0
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3)
      setV(Math.round(start + (target - start) * e))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

/** A section heading that opens its tab. */
function Head({ to, children, aside }: { to?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  const nav = useNavigate()
  return (
    <div className="nx-head">
      {to
        ? <button className="nx-h" onClick={() => nav(to)} aria-label={`${children}, open the tab`}>{children}
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden><path d="M4.5 2.5L8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        : <h2 className="nx-h">{children}</h2>}
      {aside && <div className="nx-aside">{aside}</div>}
    </div>
  )
}

const Check = ({ size = 10 }: { size?: number }) => (
  <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden><path d="M2.5 6.3l2.2 2.1 4.8-4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

// ─── Date ────────────────────────────────────────────────────────────────────

/** Hides money amounts for screenshots. The H key does the same. */
function PrivacyButton() {
  const { hidden, toggle } = usePrivacy()
  return (
    <button className={`nx-link nx-priv ${hidden ? 'on' : ''}`} onClick={toggle} aria-pressed={hidden} aria-keyshortcuts="H"
      title={hidden ? 'Show money amounts (H)' : 'Hide money amounts for a screenshot (H)'}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
        {hidden ? <path d="M2.5 2.5l11 11" /> : <circle cx="8" cy="8" r="2" />}
      </svg>
      {hidden ? 'Amounts hidden' : 'Hide amounts'}<kbd>H</kbd>
    </button>
  )
}

function DateBar({ date, today, onGo, loading }: { date: string; today: string; onGo: (d: string) => void; loading: boolean }) {
  const rel = date === today ? 'Today' : date === plusDays(today, -1) ? 'Yesterday' : date === plusDays(today, 1) ? 'Tomorrow' : null
  return (
    <div className="nx-date" aria-busy={loading}>
      <button onClick={() => onGo(plusDays(date, -1))} aria-label="Previous day" title="Previous day (←)">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M8.5 3L4.5 7l4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <label className="nx-pick">
        {rel && <b>{rel}</b>}<span className="num">{fmtDay(date)}</span>
        <input type="date" value={date} aria-label="Pick a day" onChange={e => ISO.test(e.target.value) && onGo(e.target.value)} />
      </label>
      <button onClick={() => onGo(plusDays(date, 1))} aria-label="Next day" title="Next day (→)">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M5.5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {date !== today && <button className="nx-link" onClick={() => onGo(today)}>Back to today <kbd>T</kbd></button>}
      <PrivacyButton />
    </div>
  )
}

// ─── Hero: the score dial and the one thing to do, in one card ───────────────

/** The item the hero acts on: the open window, else the latest one past its window. */
function nowTarget(day: Day): DayItem | null {
  if (day.closed || day.future || day.isToday === false) return null
  return day.current ?? [...day.items].reverse().find(i => i.status === 'overdue') ?? null
}

function polar(c: number, r: number, frac: number) {
  const a = frac * 2 * Math.PI - Math.PI / 2
  return [c + r * Math.cos(a), c + r * Math.sin(a)] as const
}

/** Points still reachable today: open and upcoming at full value, overdue at half. */
function reachable(day: Day) {
  const left = day.items.reduce((s, i) =>
    s + (i.status === 'open' || i.status === 'upcoming' || i.status === 'anytime' ? i.points : i.status === 'overdue' ? i.points / 2 : 0), 0)
  return day.possible > 0 ? Math.min(100, Math.round(((day.earned + left) / day.possible) * 100)) : 0
}

function Dial({ day, live }: { day: Day; live: boolean }) {
  const score = day.score ?? 0
  const shown = useCountUp(score)
  const reach = live ? reachable(day) : score
  const ghost = day.ghost.score
  const best = day.bestThisMonth?.score
  const C = 110, R = 92
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const major = i % 5 === 0
    const [x1, y1] = polar(C, major ? 104 : 105, i / 60)
    const [x2, y2] = polar(C, 108, i / 60)
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" opacity={major ? 0.22 : 0.09} />
  })
  // Markers sit just outside the ring, so a full ring never hides them or looks broken.
  const [gx, gy] = polar(C, R + 9, (ghost ?? 0) / 100)
  const [gx2, gy2] = polar(C, R + 16, (ghost ?? 0) / 100)
  const [bx, by] = polar(C, R + 12, (best ?? 0) / 100)
  return (
    <div className="nx-dial">
      <svg viewBox="0 0 220 220" width="220" height="220" aria-hidden>
        <g strokeWidth="1.4" strokeLinecap="round" className="ticks">{ticks}</g>
        <circle cx={C} cy={C} r={R} fill="none" stroke="rgb(var(--k-fg) / .06)" strokeWidth="12" />
        {reach > score && <circle cx={C} cy={C} r={R} fill="none" stroke="var(--k-good)" strokeOpacity=".22" strokeWidth="12" strokeLinecap="round"
          pathLength="100" strokeDasharray={`${reach - score} 100`} strokeDashoffset={-score} transform={`rotate(-90 ${C} ${C})`} />}
        {score > 0 && <circle className="arc" cx={C} cy={C} r={R} fill="none" stroke="var(--k-good)" strokeWidth="12" strokeLinecap="round"
          pathLength="100" strokeDasharray={`${score} 100`} transform={`rotate(-90 ${C} ${C})`} />}
        {best != null && <circle cx={bx} cy={by} r="2.5" fill="var(--k-ink)" opacity=".5"><title>{`Best this month: ${best}`}</title></circle>}
        {ghost != null && <line x1={gx} y1={gy} x2={gx2} y2={gy2} stroke="var(--k-ink)" strokeWidth="2.5" strokeLinecap="round" opacity=".85"><title>{`${day.ghost.label}: ${ghost}`}</title></line>}
      </svg>
      <div className="nx-dial-c" role="img" aria-label={`Day score ${day.score ?? 'not started'}${live && reach > score ? `, up to ${reach} reachable` : ''}`}>
        <span className="n num">{day.score == null ? '–' : shown}</span>
        <span className="l">{day.closed ? 'final' : day.future ? 'not started' : live && reach > score ? <>up to <span className="num">{reach}</span></> : 'day score'}</span>
      </div>
    </div>
  )
}

/** Small, scannable facts under the hero; no sentences. */
function HeroFacts({ day }: { day: Day }) {
  const { onTime, late, missed } = day.counts
  const settled = onTime + late + missed
  const g = day.ghost
  const today = day.isToday !== false
  const best = day.bestThisMonth
  const newBest = !day.future && day.score != null && day.score > 0 && (!best || day.score > best.score)
  return (
    <div className="nx-facts">
      <div><span>On time</span><b className="num">{settled ? <>{onTime}<small>/{settled}</small></> : '–'}</b></div>
      <div><span>Late</span><b className={`num ${late ? 'warn' : ''}`}>{late}</b></div>
      <div><span>Missed</span><b className="num">{missed}</b></div>
      {g.score != null && (
        <div title={`${g.label}${today ? ' at this hour' : ''}: ${g.score}`}>
          <span><i className="ghost" />{g.label}</span>
          <b className={`num ${g.diff != null && g.diff > 0 ? 'good' : ''}`}>{g.diff == null || g.diff === 0 ? 'level' : g.diff > 0 ? `+${g.diff}` : `−${-g.diff}`}</b>
        </div>
      )}
      <div title={best ? `Best this month: ${best.score}, ${fmtDate(best.date)}` : undefined}>
        <span><i className="best" />Best this month</span>
        {newBest ? <b className="good">New best</b> : <b className="num">{best?.score ?? '–'}</b>}
      </div>
    </div>
  )
}

/** The last seven days of day scores: one labelled bar each, the shown day marked. */
function Days({ recent, date }: { recent: Day['recent']; date: string }) {
  return (
    <div className="nx-days" role="img" aria-label={`Last 7 days: ${recent.map(r => `${fmtDay(r.date)} ${r.score ?? 'no score'}`).join(', ')}`}>
      {recent.map(r => {
        const wd = new Date(r.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' })
        return (
          <div key={r.date} className={`nx-day ${r.date === date ? 'on' : ''}`} title={`${fmtDay(r.date)}: ${r.score ?? 'no score'}`}>
            <span className="v num">{r.score ?? ''}</span>
            <span className="bar"><i className={r.score == null ? 'none' : ''} style={{ height: `${r.score == null ? 0 : Math.max(4, r.score)}%`, opacity: r.score == null ? 1 : 0.45 + (r.score / 100) * 0.55 }} /></span>
            <span className="d">{wd.slice(0, 2)}</span>
          </div>
        )
      })}
    </div>
  )
}

function Chip({ tone, children }: { tone?: 'good' | 'warn'; children: React.ReactNode }) {
  return <span className={`nx-chip ${tone ?? ''}`}>{children}</span>
}

const DoneIcon = () => <Check size={13} />

/** Right half of the hero: one state line, one headline, chips, actions. */
function Action({ day, view, onTick, onMissed, onCorrect, onCloseAgain, busy }: {
  day: Day; view: string | null; onTick: (id: number) => void; onMissed: (id: number) => void
  onCorrect: () => void; onCloseAgain: () => void; busy: boolean
}) {
  const openReview = useOpenReview()
  const next = day.next
  const then = next && <p className="nx-then">Then <b>{next.label}</b> <span className="num">{next.time}</span></p>
  const missedBtn = (id: number) => (
    <button className="nx-btn ghost" disabled={busy} onClick={() => onMissed(id)} aria-keyshortcuts="M" title="It didn't happen: earns nothing and counts like any miss">Missed<kbd>M</kbd></button>
  )

  if (view) {
    if (day.future) return (
      <div className="nx-act">
        <p className="nx-state">Ahead</p>
        <h1>{longDay(day.date)}</h1>
        <div className="nx-chips"><Chip>{day.items.length ? plural(day.items.length, 'item') + ' planned' : 'Nothing planned yet'}</Chip></div>
      </div>
    )
    if (day.reopened) return (
      <div className="nx-act">
        <p className="nx-state warn">Open for corrections</p>
        <h1>{longDay(day.date)}</h1>
        <div className="nx-chips"><Chip tone="warn">Ticks count as late</Chip><Chip>Closes again at 04:00</Chip></div>
        <div className="nx-acts"><button className="nx-btn" disabled={busy} onClick={onCloseAgain}>Close it again</button></div>
      </div>
    )
    return (
      <div className="nx-act">
        <p className="nx-state">{day.items.length ? 'Closed' : 'Nothing recorded'}</p>
        <h1>{longDay(day.date)}</h1>
        {day.items.length > 0 && <div className="nx-acts"><button className="nx-btn ghost" disabled={busy} onClick={onCorrect}>Correct this day</button></div>}
      </div>
    )
  }

  if (day.closed) return (
    <div className="nx-act">
      <p className="nx-state">Score locked</p>
      <h1>Day closed</h1>
      <div className="nx-chips"><Chip>Tomorrow starts at 04:00</Chip></div>
      <div className="nx-acts"><button className="nx-btn ghost" disabled={busy} onClick={onCorrect}>Correct this day</button></div>
    </div>
  )

  const c = day.current
  if (c) {
    const span = (c.end ?? 0) - (c.start ?? 0)
    const pct = span ? Math.min(100, Math.max(0, ((span - c.minutesLeft) / span) * 100)) : 0
    return (
      <div className="nx-act">
        <p className="nx-state good">Now, <span className="num">{duration(c.minutesLeft)}</span> left</p>
        <h1>{c.label}</h1>
        <div className="nx-win" aria-hidden><b style={{ width: `${pct}%` }} /></div>
        <div className="nx-chips"><Chip tone="good">+{pt(c.points)} on time</Chip><Chip>until <span className="num">{clock(c.end ?? 0)}</span></Chip><Chip>late +{pt(c.points / 2)}</Chip></div>
        <div className="nx-acts">
          <button className="nx-btn" disabled={busy} onClick={() => onTick(c.id)} aria-keyshortcuts="D"><DoneIcon />Done<kbd>D</kbd></button>
          {missedBtn(c.id)}
        </div>
        {then}
      </div>
    )
  }

  const overdue = [...day.items].reverse().find(i => i.status === 'overdue')
  if (overdue) return (
    <div className="nx-act">
      <p className="nx-state warn">Past its window</p>
      <h1>{overdue.label}</h1>
      <div className="nx-chips"><Chip tone="warn">+{pt(overdue.points / 2)} if done now</Chip><Chip>was due <span className="num">{overdue.time}</span></Chip></div>
      <div className="nx-acts">
        <button className="nx-btn" disabled={busy} onClick={() => onTick(overdue.id)} aria-keyshortcuts="D"><DoneIcon />Done late<kbd>D</kbd></button>
        {missedBtn(overdue.id)}
      </div>
      {then}
    </div>
  )

  if (next) return (
    <div className="nx-act">
      <p className="nx-state">Next, in <span className="num">{duration(next.minutesUntil)}</span></p>
      <h1>{next.label}</h1>
      <div className="nx-chips"><Chip>at <span className="num">{next.time}</span></Chip><Chip tone="good">+{pt(next.points)} on time</Chip></div>
    </div>
  )

  return (
    <div className="nx-act">
      <p className="nx-state">{day.items.length ? 'Every window has closed' : 'Nothing planned today'}</p>
      <h1>{day.items.length ? 'Close the day' : 'A free day'}</h1>
      {day.items.length > 0
        ? <div className="nx-acts"><button className="nx-btn" onClick={openReview}>Review and close</button></div>
        : <div className="nx-chips"><Chip>Add a one-off below <kbd>N</kbd></Chip></div>}
    </div>
  )
}

function Hero(props: { day: Day; view: string | null; onTick: (id: number) => void; onMissed: (id: number) => void; onCorrect: () => void; onCloseAgain: () => void; busy: boolean }) {
  const { day, view } = props
  const live = !view && !day.closed && !day.future
  return (
    <section className="nx-hero" aria-label="Today">
      <div className="nx-hero-top">
        <Dial day={day} live={live} />
        <Action {...props} />
      </div>
      <div className="nx-hero-foot">
        <HeroFacts day={day} />
        <Days recent={day.recent} date={day.date} />
      </div>
    </section>
  )
}

// ─── Item menu (shared by every row) ─────────────────────────────────────────

type MenuAt = { id: number; x: number; y: number } | null
const menuAt = (el: HTMLElement, id: number) => { const r = el.getBoundingClientRect(); return { id, x: r.right - 110, y: r.bottom + 6 } }

function ItemMenu({ day, menu, minute, locked, onSet, onMissed, onClose }: {
  day: Day; menu: NonNullable<MenuAt>; minute: number; locked: boolean
  onSet: (id: number, done: boolean) => void; onMissed: (id: number, missed: boolean) => void; onClose: () => void
}) {
  useEffect(() => {
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.wh-stmenu, .nx-more')) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [onClose])
  const picked = day.items.find(i => i.id === menu.id)
  if (!picked) return null
  const act = (fn: () => void) => { fn(); onClose() }
  const pastDay = day.isToday === false
  return (
    <div className="wh wh-stmenu" role="menu" style={{ left: Math.max(12, Math.min(window.innerWidth - 232, menu.x - 110)), top: menu.y }}>
      <p><span className="num">{picked.time ?? 'Anytime'}</span>, {picked.label}</p>
      {canTick(picked, minute, locked) && (
        <button role="menuitem" onClick={() => act(() => onSet(picked.id, true))}>
          {picked.status === 'overdue' || pastDay ? `Done late, +${pt(picked.points / 2)}` : `Done, +${pt(picked.points)}`}
        </button>
      )}
      {canUntick(picked, locked) && <button role="menuitem" onClick={() => act(() => onSet(picked.id, false))}>Untick</button>}
      {canMarkMissed(picked, locked) && <button role="menuitem" className="bad" onClick={() => act(() => onMissed(picked.id, true))}>Missed<small>it didn't happen, earns nothing</small></button>}
      {canUnmarkMissed(picked, locked) && <button role="menuitem" onClick={() => act(() => onMissed(picked.id, false))}>Not missed after all<small>back on {pastDay ? "that day's" : "today's"} list</small></button>}
      {!canTick(picked, minute, locked) && !isDone(picked.status) && picked.status !== 'missed' && <p className="hint">{day.future ? 'This day has not started yet.' : tickHint(picked, minute, locked)}</p>}
    </div>
  )
}

// ─── Routine rows ────────────────────────────────────────────────────────────

const writeVal = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }
const HIDE_DONE = 'oura-today-hide-done'

function itemNote(i: DayItem, pastDay: boolean): [string, string] {
  switch (i.status) {
    case 'on_time': return [`on time +${pt(i.earned)}`, 'good']
    case 'late': return [`late +${pt(i.earned)}`, 'warn']
    case 'missed': return ['missed', 'mute']
    case 'overdue': return [`+${pt(i.points / 2)} if done`, 'bad']
    case 'open': return ['open now', 'good']
    case 'anytime': return [pastDay ? `+${pt(i.points / 2)} if done` : `+${pt(i.points)}`, 'mute']
    case 'upcoming': return [i.time ? `opens ${i.time}` : '', 'faint']
  }
}

const LANES = ['Morning', 'Afternoon', 'Tonight', 'Anytime'] as const

/**
 * The day laid out as the day: Morning, Afternoon, Tonight and Anytime lanes
 * side by side, plus this week's items. Only lanes with something in them show.
 */
function Lists({ day, upcoming, minute, locked, menu, onMenu, onSet, onWeekly, onAddOneOffs, onRemoveOneOff, busy, flash }: {
  day: Day; upcoming: Pulse['upcoming']; minute: number; locked: boolean; menu: MenuAt; onMenu: (m: MenuAt) => void
  onSet: (id: number, done: boolean) => void
  onWeekly: (id: number, done: boolean, label: string) => void
  onAddOneOffs: (ps: Parsed[]) => void
  onRemoveOneOff: (i: DayItem) => void
  busy: boolean
  flash: number | null
}) {
  const nav = useNavigate()
  const [hideDone, setHideDone] = useState<boolean>(() => { try { return localStorage.getItem(HIDE_DONE) === 'true' } catch { return false } })
  const toggleHide = () => setHideDone(h => { writeVal(HIDE_DONE, !h); return !h })

  const pastDay = day.isToday === false && !day.future
  const closed = day.closed
  const routines = day.routines ?? []
  const many = routines.filter(g => g.templateId != null).length > 1
  const weekly = day.weekly?.routines ?? []
  const weeklyItems = weekly.flatMap(w => w.items)
  const done = day.items.filter(i => isDone(i.status)).length
  const total = day.items.length
  const anyDone = done + weeklyItems.filter(i => i.done).length > 0

  const row = (i: DayItem) => {
    const isDoneNow = isDone(i.status)
    const able = isDoneNow ? canUntick(i, locked) : canTick(i, minute, locked)
    const [note, tone] = itemNote(i, pastDay)
    const hint = isDoneNow ? 'Click to untick.' : day.future ? 'This day has not started yet.' : tickHint(i, minute, locked)
    const oneOff = i.templateId == null
    const from = many && !oneOff ? routines.find(g => g.templateId === i.templateId)?.name : null
    return (
      <div key={i.id} className={`nx-row ${isDoneNow ? 'done' : ''} ${i.status === 'missed' ? 'missed' : ''} ${i.status === 'open' ? 'open' : ''} ${flash === i.id ? 'flash' : ''}`}>
        <button className={`nx-check ${isDoneNow ? 'on' : ''}`} disabled={!able || busy} aria-pressed={isDoneNow} title={hint}
          aria-label={isDoneNow ? `Untick ${i.label}` : `Tick ${i.label}`} onClick={() => onSet(i.id, !isDoneNow)}>
          {isDoneNow && <Check />}
        </button>
        <span className="tm num">{i.time ?? ''}</span>
        <span className="lb">{i.label}<Streak n={i.streak} />{oneOff && <small>one-off</small>}{from && <small>{from}</small>}</span>
        <span className={`nt num ${tone}`}>{note}</span>
        {oneOff && !closed
          ? <button className="nx-more" disabled={busy} onClick={() => onRemoveOneOff(i)} aria-label={`Delete ${i.label}`} title="Delete this one-off">×</button>
          : <button className="nx-more" disabled={closed || busy} aria-haspopup="menu" aria-expanded={menu?.id === i.id} aria-label={`More for ${i.label}`}
              onClick={e => onMenu(menu?.id === i.id ? null : menuAt(e.currentTarget as HTMLElement, i.id))}>⋯</button>}
      </div>
    )
  }

  const lanes = LANES.map(name => {
    const all = day.items.filter(i => partOfDay(i.start) === name)
    return { name, all, list: hideDone ? all.filter(i => !isDone(i.status)) : all }
  }).filter(l => l.all.length)

  return (
    <section className="nx-sec nx-routine">
      <Head to="/checklists" aside={<>
        {total > 0 && <span className="nx-count num"><b>{done}</b> of {total} done</span>}
        {anyDone && <button className="nx-link" onClick={toggleHide} aria-pressed={hideDone}>{hideDone ? 'Show done' : 'Hide done'}</button>}
      </>}>{day.isToday === false ? `Routine, ${fmtDay(day.date)}` : 'Your day'}</Head>

      {!closed && (
        <div className="nx-quick">
          <QuickAdd today={day.date} onAdd={onAddOneOffs} label="Add one-offs in one line, or paste a list"
            placeholder={day.future ? 'Add to this day: Call the bank 16:00 must' : 'Add to today: Call the bank 16:00 must, or paste a list   (N)'} />
        </div>
      )}

      {lanes.length === 0 && !weeklyItems.length && !upcoming?.length
        ? <p className="nx-answer">{day.future ? 'Nothing planned for this day yet.' : 'Nothing on this day.'}</p>
        : (
          <div className="nx-lanes" style={{ ['--lanes' as string]: Math.min(3, lanes.length + (weeklyItems.length ? 1 : 0) + (upcoming?.length ? 1 : 0)) }}>
            {lanes.map(l => {
              const d = l.all.filter(i => isDone(i.status)).length
              const hidden = l.all.length - l.list.length
              return (
                <div key={l.name} className="nx-lane">
                  <div className="nx-lane-h"><span>{l.name}</span><span className="num">{d}/{l.all.length}</span></div>
                  <div className="nx-rows">
                    {l.list.map(row)}
                    {hidden > 0 && <p className="nx-hidden">{hidden} done, hidden</p>}
                  </div>
                </div>
              )
            })}
            {weeklyItems.length > 0 && (() => {
              const list = hideDone ? weeklyItems.filter(i => !i.done) : weeklyItems
              const d = weeklyItems.filter(i => i.done).length
              return (
                <div className="nx-lane">
                  <div className="nx-lane-h"><span>This week{day.weekly ? <small>from {fmtDate(day.weekly.weekOf)}</small> : null}</span><span className="num">{d}/{weeklyItems.length}</span></div>
                  <div className="nx-rows">
                    {list.map(i => (
                      <div key={i.id} className={`nx-row ${i.done ? 'done' : ''}`}>
                        <button className={`nx-check ${i.done ? 'on' : ''}`} disabled={busy} aria-pressed={i.done}
                          aria-label={i.done ? `Untick ${i.label} for this week` : `Tick ${i.label} for this week`} onClick={() => onWeekly(i.id, !i.done, i.label)}>
                          {i.done && <Check />}
                        </button>
                        <span className="tm" />
                        <span className="lb">{i.label}<Streak n={i.streak} unit="week" /></span>
                        <span className={`nt ${i.done ? 'good' : 'mute'}`}>{i.done ? `done ${new Date(i.completedAt!).toLocaleDateString('en-GB', { weekday: 'short' })}` : 'this week'}</span>
                        <span />
                      </div>
                    ))}
                    {list.length !== weeklyItems.length && <p className="nx-hidden">{weeklyItems.length - list.length} done, hidden</p>}
                  </div>
                </div>
              )
            })()}
            {(upcoming?.length ?? 0) > 0 && (
              <div className="nx-lane">
                <div className="nx-lane-h"><span>Coming up</span><span className="num">{upcoming!.length}</span></div>
                <div className="nx-rows">
                  {upcoming!.map(e => (
                    <a key={e.id} className="nx-row ev" href="/calendar" onClick={ev => { ev.preventDefault(); nav('/calendar') }}>
                      <span className="nx-evdot" aria-hidden />
                      <span className="tm num">{!e.allDay && e.start.length > 10 ? e.start.slice(11, 16) : 'all day'}</span>
                      <span className="lb">{e.title}</span>
                      <span className="nt num mute">{fmtDay(e.start.slice(0, 10))}</span>
                      <span />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
    </section>
  )
}

/** Wins earned this week, shown inside the week section. */
function Earned({ wins }: { wins: TodayView['wins'] }) {
  const { hidden } = usePrivacy()
  return (
    <div className="nx-earned">
      <div className="nx-lane-h"><span>Earned this week</span></div>
      {wins.length === 0
        ? <p className="nx-hidden" style={{ margin: '4px 0 0' }}>No new bests yet this week.</p>
        : wins.map((w, i) => (
            <div key={i} className="nx-line"><span className="k"><i className="nx-dot good" />{w.title}</span><span className="v">{hidden ? maskMoney(w.detail) : w.detail}</span></div>
          ))}
    </div>
  )
}

// ─── Week ────────────────────────────────────────────────────────────────────

function WeekSec({ week, wins }: { week: TodayView['week']; wins: TodayView['wins'] }) {
  const nav = useNavigate()
  if (!week) {
    return (
      <section className="nx-sec">
        <Head to="/goals">This week</Head>
        <p className="nx-answer">No weekly goal is set yet. Set one and the score starts counting.</p>
        <button className="nx-btn ghost" onClick={() => nav('/goals')}>Set this week's goal</button>
        <Earned wins={wins} />
      </section>
    )
  }
  const frac = (x: number) => Math.min(100, Math.max(0, (x / week.max) * 100))
  const out = week.stakes?.includes('out of reach')
  // The coach names the task worth the most right now; mark that row instead of repeating it as prose.
  const lever = week.coach ? week.tasks.find(t => week.coach!.includes(t.title)) ?? null : null
  return (
    <section className="nx-sec">
      <Head to="/goals" aside={<span className="num">{fmtDate(week.from)} to {fmtDate(week.to)}</span>}>This week</Head>
      {week.focus && <p className="nx-focus">{week.focus}</p>}
      {week.coach && !lever && <p className="nx-togo">{week.coach.replace(/^Biggest lever: /, '')}</p>}
      <div className="nx-wk">
        <span className="nx-mid num">{pt(week.score)}</span><span className="nx-of num">of {pt(week.max)}</span>
        {week.lastWeek && <span className="nx-wk-last">Last week <span className="num">{pt(week.lastWeek.score)}</span>{week.lastWeek.reward ? `, ${week.lastWeek.reward}` : ''}</span>}
      </div>
      <div className="nx-wbar" aria-hidden>
        <span className="earned" style={{ width: `${frac(week.score)}%` }} />
        {week.ladder.map(r => <i key={r.at} className={r.reached ? 'got' : ''} style={{ left: `${frac(r.at)}%` }} />)}
        {week.lastWeek && <i className="ghost" style={{ left: `${frac(week.lastWeek.score)}%` }} />}
      </div>
      <div className="nx-ladder">
        {week.ladder.map(r => (
          <span key={r.at} className={r.reached ? 'got' : week.nextReward?.at === r.at ? 'next' : ''}>
            <span className="num">{pt(r.at)}</span> {r.reward}{r.reached && <Check size={9} />}
          </span>
        ))}
      </div>
      {week.nextReward && (
        <p className="nx-togo">{out
          ? <>{week.nextReward.reward} is out of reach</>
          : <><b className="num">{pt(Math.max(0, week.nextReward.at - week.score))}</b> to go for <b>{week.nextReward.reward}</b></>}</p>
      )}
      <div className="nx-rows">
        {(lever ? [lever, ...week.tasks.filter(t => t.id !== lever.id)] : week.tasks).map(t => {
          const isLever = lever?.id === t.id
          const note = t.note ? (t.source !== 'manual' ? `auto, ${t.note}` : t.note) : null
          return (
            <div key={t.id} className={`nx-task ${isLever ? 'lever' : ''}`}>
              <div className="nm">{t.title}
                {isLever
                  ? <small className="lv">Biggest lever, <span className="num">+{pt(t.max - t.earned)}</span> still open</small>
                  : note && <small className={/break|review/.test(note) && t.earned < t.max ? 'warn' : ''}>{note}</small>}
              </div>
              <div className="nx-mini" aria-hidden><b style={{ width: `${(t.earned / t.max) * 100}%` }} className={t.earned >= t.max ? 'full' : ''} /></div>
              <div className="v num">{pt(t.earned)}/{pt(t.max)}</div>
            </div>
          )
        })}
      </div>
      <Earned wins={wins} />
    </section>
  )
}

// ─── Pulse: Trading (USD), Business (GBP), Training ──────────────────────────
// Every panel has the same five layers (head, figure, visual, figures, foot),
// laid on a shared subgrid so each layer lines up across the row.

const tone = (n: number) => (n > 0 ? 'good' : n < 0 ? 'bad' : '')
const CURS = ['USD', 'GBP', 'EUR'] as const
type Cur = (typeof CURS)[number]
const SYM: Record<Cur, string> = { USD: '$', GBP: '£', EUR: '€' }

/**
 * A panel's display currency. It starts in the money's own currency, cycles
 * USD, GBP, EUR on a click, and is remembered per panel. Conversion is display only.
 */
function useMoney(key: string, native: Cur) {
  const { data: rates } = useCurrencyRates()
  const store = `oura-today-cur-${key}`
  const [cur, setCur] = useState<Cur>(() => { try { const v = localStorage.getItem(store); return (CURS as readonly string[]).includes(v ?? '') ? v as Cur : native } catch { return native } })
  const { hidden } = usePrivacy()
  const shown: Cur = rates ? cur : native
  const fmt = (n: number) => hidden ? `${SYM[shown]}${MASK}` : formatInCurrency(rates ? convertAmount(n, native, shown, rates) : n, shown)
  const signed = (n: number) => hidden ? fmt(n) : (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n))
  const pick = (c: Cur) => { setCur(c); try { localStorage.setItem(store, c) } catch { /* private mode */ } }
  const rate = rates && shown !== native ? `${SYM[native]}1 = ${SYM[shown]}${convertAmount(1, native, shown, rates).toFixed(3)}` : null
  const toggle = (
    <div className="nx-cur" role="radiogroup" aria-label="Show amounts in">
      {CURS.map(c => (
        <button key={c} role="radio" aria-checked={shown === c} aria-label={c} disabled={!rates && c !== native}
          className={shown === c ? 'on' : ''} onClick={() => pick(c)}
          title={c === native ? `${c}, the original currency` : rates ? `${c} at ${SYM[native]}1 = ${SYM[c]}${convertAmount(1, native, c, rates).toFixed(3)}` : c}>
          {SYM[c]}
        </button>
      ))}
    </div>
  )
  return { fmt, signed, toggle, rate }
}
const rr = (n: number | null) => (n == null ? '–' : `${n > 0 ? '+' : ''}${n.toFixed(2)}R`)

function Panel({ to, title, unit, figure, visual, figs, foot }: {
  to: string; title: string; unit: React.ReactNode
  figure: React.ReactNode; visual: React.ReactNode; figs: React.ReactNode; foot: React.ReactNode
}) {
  return (
    <section className="nx-panel">
      <Head to={to} aside={unit}>{title}</Head>
      <div className="nx-p-fig">{figure}</div>
      <div className="nx-p-vis">{visual}</div>
      <div className="nx-p-figs">{figs}</div>
      <div className="nx-p-foot">{foot}</div>
    </section>
  )
}

/** Seven days of P&L as bars on a zero line, stretched to the panel width. */
function PnlBars({ days, signedUsd }: { days: { date: string; label: string; pnl: number }[]; signedUsd: (n: number) => string }) {
  const max = Math.max(1, ...days.map(d => Math.abs(d.pnl)))
  return (
    <div className="nx-pnl" role="img" aria-label={`Last 7 days: ${days.map(d => `${d.label} ${signedUsd(d.pnl)}`).join(', ')}`}>
      {days.map(d => {
        const h = d.pnl === 0 ? 0 : Math.max(10, (Math.abs(d.pnl) / max) * 100)
        return (
          <div key={d.date} className="c" title={`${d.label}: ${signedUsd(d.pnl)}`}>
            <span className="up">{d.pnl > 0 && <i className="good" style={{ height: `${h}%` }} />}</span>
            <span className="dn">{d.pnl < 0 && <i className="bad" style={{ height: `${h}%` }} />}</span>
            <span className="d">{d.label.slice(0, 2)}</span>
          </div>
        )
      })}
    </div>
  )
}

function Trading({ pulse }: { pulse: Pulse }) {
  const nav = useNavigate()
  const d = pulse.tradingDay, m = pulse.tradingMonth
  const limits = pulse.trading.filter(a => a.limitLeft != null && a.limitLeft < (a.limitUnit === 'R' ? 2 : Infinity))
  const money = useMoney('trading', 'USD')
  const signedUsd = money.signed
  return (
    <Panel to="/trading" title="Trading" unit={money.toggle}
      figure={<>
        <b className={`num ${tone(m?.pnl ?? 0)}`}>{m ? signedUsd(m.pnl) : '–'}</b>
        <span>this month{m ? `, ${plural(m.count, 'trade')}` : ''}{money.rate && <em className="faint">, at {money.rate}</em>}</span>
      </>}
      visual={m ? <PnlBars days={m.last7} signedUsd={signedUsd} /> : <span className="nx-none">No trades this month</span>}
      figs={<>
        <div><span>Today</span><b className={`num ${tone(d?.pnl ?? 0)}`}>{d?.count ? signedUsd(d.pnl) : '–'}</b></div>
        <div><span>Win rate</span><b className="num">{m?.winRate == null ? '–' : `${m.winRate}%`}</b></div>
        <div><span>Average</span><b className={`num ${tone(m?.avgR ?? 0)}`}>{rr(m?.avgR ?? null)}</b></div>
      </>}
      foot={<>
        {d?.trades.map(t => (
          <button key={t.id} className="nx-line btn" onClick={() => nav(`/trading?trade=${t.id}`)} aria-label={`Open trade ${t.asset} ${t.direction}`}>
            <span className="k"><b>{t.asset}</b> {t.direction}</span>
            <span className="v num"><span className={tone(t.r ?? 0)}>{rr(t.r)}</span><span className={tone(t.pnl)}>{signedUsd(t.pnl)}</span></span>
          </button>
        ))}
        {limits.map(a => (
          <div key={a.id} className="nx-line">
            <span className="k">{a.name} <em className="mute">{plural(a.trades, 'trade')} today</em></span>
            <span className="v num">
              {a.netR != null && <span className={tone(a.net)}>{a.netR > 0 ? '+' : ''}{a.netR.toFixed(2)}R</span>}
              {a.limitLeft != null && a.limitLeft < 1 && <span className="warn">{a.limitUnit === 'R' ? `${a.limitLeft}R` : money.fmt(a.limitLeft)} to limit</span>}
            </span>
          </div>
        ))}
        <button className="nx-btn ghost sm" onClick={() => nav('/trading?new=1')}>Log a trade</button>
      </>} />
  )
}

function Business({ pulse }: { pulse: Pulse }) {
  const nav = useNavigate()
  const money = useMoney('business', 'GBP')
  const b = pulse.business
  if (!b) return null
  const gbp = money.fmt
  const due = b.nextDue
  const todayIso = new Date().toISOString().slice(0, 10)
  const daysLate = due ? Math.round((new Date(todayIso).getTime() - new Date(due.dueDate).getTime()) / 864e5) : 0
  const nn = b.netNewMrr ?? 0
  const rev = b.revenueMTD ?? 0
  const base = Math.max(b.mrr, rev + b.outstanding, 1)
  return (
    <Panel to="/business" title="Business" unit={money.toggle}
      figure={<>
        <b className="num">{gbp(b.mrr)}</b>
        <span>a month recurring{nn !== 0 && <>, <em className={nn > 0 ? 'good' : 'bad'}>{nn > 0 ? '+' : '−'}{gbp(Math.abs(nn))}</em> this month</>}{money.rate && <em className="faint">, at {money.rate}</em>}</span>
      </>}
      visual={
        <div className="nx-collect" role="img" aria-label={`This month: ${gbp(rev)} collected, ${gbp(b.outstanding)} owed, against ${gbp(b.mrr)} recurring`}>
          <div className="bar">
            <i className="got" style={{ width: `${(rev / base) * 100}%` }} />
            <i className="owed" style={{ width: `${(b.outstanding / base) * 100}%` }} />
            {b.mrr > 0 && <i className="mark" style={{ left: `${Math.min(100, (b.mrr / base) * 100)}%` }} />}
          </div>
          <div className="keys">
            <span><i className="got" /><b className="num">{gbp(rev)}</b> collected</span>
            {b.outstanding > 0 && <span><i className="owed" /><b className="num">{gbp(b.outstanding)}</b> owed</span>}
            <span className="mute">this month</span>
          </div>
        </div>
      }
      figs={<>
        <div><span>Margin</span><b className="num">{b.marginPct == null ? '–' : `${b.marginPct.toFixed(1)}%`}</b></div>
        <div><span>Clients</span><b className="num">{b.activeClients ?? '–'}</b></div>
        <div><span>Owed to you</span><b className={`num ${b.outstanding > 0 ? 'warn' : ''}`}>{gbp(b.outstanding)}</b></div>
      </>}
      foot={due
        ? <div className="nx-line">
            <span className="k">{due.clientName ?? due.invoiceNumber} <b className="num">{gbp(due.amount)}</b>
              <em className={daysLate > 0 ? 'bad' : 'mute'}>{daysLate > 0 ? `${plural(daysLate, 'day')} late` : `due ${fmtDay(due.dueDate)}`}</em></span>
            <span className="v"><button className="nx-btn ghost sm" onClick={() => nav('/business/invoices')}>Chase</button></span>
          </div>
        : <span className="nx-none">{b.activeClients ?? 0} clients, nothing overdue</span>} />
  )
}

function Training({ pulse }: { pulse: Pulse }) {
  const nav = useNavigate()
  const w = pulse.workouts, last = pulse.lastWorkout
  const left = Math.max(0, w.target - w.done)
  return (
    <Panel to="/training" title="Training" unit={<span className="nx-unit-text">This week</span>}
      figure={<>
        <b className={`num ${left === 0 ? 'good' : ''}`}>{w.done}<small> of {w.target}</small></b>
        <span>{left === 0 ? 'workouts, target hit' : `workouts, ${left} to go`}</span>
      </>}
      visual={<div className="nx-wsegs" aria-hidden>{Array.from({ length: w.target }, (_, i) => <i key={i} className={i < w.done ? 'f' : ''} />)}</div>}
      figs={last ? <>
        <div><span>Last workout</span><b>{last.name}</b></div>
        <div><span>When</span><b className="num">{fmtDay(last.date)}</b></div>
        <div><span>Duration</span><b className="num">{last.durationMinutes ? `${last.durationMinutes} min` : '–'}</b></div>
      </> : <div><span>Last workout</span><b>None yet</b></div>}
      foot={<button className="nx-btn ghost sm" onClick={() => nav('/training?log=next')}>Log a workout</button>} />
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

/** Listens for the page's single-key shortcuts with the latest handler. */
function Keys({ onKey }: { onKey: (e: KeyboardEvent) => void }) {
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])
  return null
}

export function NextToday() {
  const [params, setParams] = useSearchParams()
  const asked = params.get('date')
  const wanted = asked && ISO.test(asked) ? asked : null
  const { data, isPending, isPlaceholderData } = useToday(wanted)
  const tick = useTick()
  const missM = useMarkMissed()
  const reopen = useReopenDay()
  const closeM = useCloseDay()
  const weeklyM = useWeeklyTick()
  const one = useDayOneOffs()
  const [menu, setMenu] = useState<MenuAt>(null)
  const [flash, setFlash] = useState<number | null>(null)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = (text: string, undo?: () => void, ms = 4000) => {
    if (hide.current) clearTimeout(hide.current)
    setToast({ text, undo }); hide.current = setTimeout(() => setToast(null), ms)
  }

  if (isPending || !data) return <PageLoader />

  const today = data.today ?? data.day.date
  const date = data.day.date
  const view = date === today ? null : date
  const day = data.day
  const locked = day.closed || !!day.future
  const busy = tick.isPending || missM.isPending || reopen.isPending || closeM.isPending || weeklyM.isPending

  const go = (d: string) => {
    setMenu(null)
    setParams(p => { if (d === today) p.delete('date'); else p.set('date', d); return p }, { replace: true })
  }

  const setDone = (id: number, done: boolean) => tick.mutate({ id, done, date: view }, {
    onSuccess: v => {
      const it = v.day.items.find(i => i.id === id)
      if (!it) return
      if (done && isDone(it.status)) {
        setFlash(id); setTimeout(() => setFlash(f => (f === id ? null : f)), 700)
        show(`${it.label}: ${it.status === 'on_time' ? 'on time' : 'late'}, +${pt(it.earned)}`, () => setDone(id, false))
      } else if (!done) show(`${it.label}: unticked`)
    },
    onError: e => show(errText(e)),
  })
  const setMissed = (id: number, missed: boolean) => missM.mutate({ id, missed, date: view }, {
    onSuccess: v => {
      const it = v.day.items.find(i => i.id === id)
      if (it) show(missed ? `${it.label}: marked missed` : `${it.label}: back on the list`, missed ? () => setMissed(id, false) : undefined)
    },
    onError: e => show(errText(e)),
  })
  const setWeekly = (id: number, done: boolean, label: string) => weeklyM.mutate({ id, done, date: view }, {
    onSuccess: () => show(done ? `${label}: done this week` : `${label}: unticked`, () => setWeekly(id, !done, label)),
    onError: e => show(errText(e)),
  })
  const correct = () => reopen.mutate({ date, view }, {
    onSuccess: () => show(`${fmtDay(date)} is open. Ticks count as late; it closes again at 04:00.`, undefined, 6000),
    onError: e => show(errText(e)),
  })
  const closeAgain = () => closeM.mutate({ date }, {
    onSuccess: d => show(`${fmtDay(date)} closed again at ${d.view.day.score ?? 0}.`),
    onError: e => show(errText(e)),
  })
  const addOneOffs = (ps: Parsed[]) => {
    const byDate = new Map<string, Parsed[]>()
    for (const p of ps) { const d = onceDate(p.schedule ?? null) ?? date; byDate.set(d, [...(byDate.get(d) ?? []), p]) }
    for (const [d, list] of byDate) {
      one.add.mutate({ date: d, items: list.map(p => ({ label: p.label, time: p.time, importance: p.importance })) }, {
        onSuccess: () => show(list.length === 1 ? `Added ${list[0].label}${d !== date ? ` to ${fmtDay(d)}` : ''}` : `Added ${list.length} items${d !== date ? ` to ${fmtDay(d)}` : ''}`),
        onError: e => show(errText(e)),
      })
    }
  }
  const removeOneOff = (i: DayItem) => one.remove.mutate(i.id, {
    onSuccess: () => show(`${i.label}: deleted`, () => one.restore.mutate(i.id, { onError: e => show(errText(e)) })),
    onError: e => show(errText(e)),
  })

  const target = view ? null : nowTarget(day)
  // Keys: D done, M missed (the Now item), ← → step days, T today, N add a one-off. H (hide amounts) lives in the frame.
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('[role="dialog"]')) return
    const k = e.key.toLowerCase()
    if (k === 'arrowleft') { e.preventDefault(); go(plusDays(date, -1)) }
    else if (k === 'arrowright') { e.preventDefault(); go(plusDays(date, 1)) }
    else if (k === 't' && view) go(today)
    else if (k === 'n') { const t = document.querySelector<HTMLTextAreaElement>('.nx .nx-quick textarea'); if (t) { e.preventDefault(); t.focus() } }
    else if (k === 'd' && target && !busy) setDone(target.id, true)
    else if (k === 'm' && target && !busy) setMissed(target.id, true)
  }

  return (
    <div className="wh-page nx skin-enter">
      <Keys onKey={onKey} />
      <div className={`nx-wrap ${isPlaceholderData ? 'loading' : ''}`}>
        <DateBar date={wanted ?? date} today={today} onGo={go} loading={isPlaceholderData} />
        <div className="nx-top">
          <Hero day={day} view={view} onTick={id => setDone(id, true)} onMissed={id => setMissed(id, true)} onCorrect={correct} onCloseAgain={closeAgain} busy={busy} />
          <WeekSec week={data.week} wins={data.wins} />
        </div>
        <Lists day={day} upcoming={data.pulse.upcoming} minute={data.minuteOfDay} locked={locked} menu={menu} onMenu={setMenu} onSet={setDone}
          onWeekly={setWeekly} onAddOneOffs={addOneOffs} onRemoveOneOff={removeOneOff} busy={busy} flash={flash} />
        <div className="nx-pulse">
          <Trading pulse={data.pulse} />
          <Business pulse={data.pulse} />
          <Training pulse={data.pulse} />
        </div>
      </div>
      {menu && (
        <ItemMenu day={day} menu={menu} minute={data.minuteOfDay} locked={locked}
          onSet={setDone} onMissed={setMissed} onClose={() => setMenu(null)} />
      )}
      {toast && (
        <div className="wh wh-toast" role="status">
          {toast.text}
          {toast.undo && <button className="wh-undo" onClick={() => { toast.undo!(); setToast(null) }}>Undo</button>}
        </div>
      )}
    </div>
  )
}
