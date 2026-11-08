import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import {
  canMarkMissed, canTick, canUnmarkMissed, canUntick, duration, isDone, tickHint,
  useCloseDay, useDayOneOffs, useMarkMissed, useReopenDay, useTick, useToday, useWeeklyTick,
  type DayItem, type TodayView,
} from '../../core/today'
import { onceDate, type Parsed } from '../../core/routine'
import { useOpenReview } from '../core'
import { PageLoader } from '../../components/ui/Spinner'
import { CurrencySelector } from '../../components/ui/CurrencySelector'
import { useFmtView, type FmtView } from '../../hooks/useFmtView'
import { QuickAdd, Streak } from './Routine'
import './routine-today.css'

const fmtDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const fmtDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const plusDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const ISO = /^\d{4}-\d{2}-\d{2}$/
const errText = (e: unknown) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not save that.'

/** A section title that opens its tab. */
function SectionLink({ to, children }: { to: string; children: React.ReactNode }) {
  const nav = useNavigate()
  return (
    <button className="rt-link" onClick={() => nav(to)} aria-label={`${children} (open the tab)`}>
      <span className="wh-h">{children}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M4.5 2.5L8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  )
}
const pt = (n: number) => String(Math.round(n * 100) / 100)

// ─── Dial ────────────────────────────────────────────────────────────────────

function polar(cx: number, cy: number, r: number, frac: number) {
  const a = frac * 2 * Math.PI - Math.PI / 2
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
}

function Dial({ day }: { day: TodayView['day'] }) {
  const score = day.score ?? 0
  const ticks = Array.from({ length: 50 }, (_, i) => {
    const major = i % 5 === 0
    const [x1, y1] = polar(150, 150, major ? 138 : 137, i / 50)
    const [x2, y2] = polar(150, 150, major ? 145 : 140, i / 50)
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={major ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.1)'} />
  })
  // Zone colours: the arc warms from red through amber to green with the score.
  const [c1, c2] = score >= 75 ? ['#B5D46A', '#6FD3A0'] : score >= 45 ? ['#E9B65E', '#B5D46A'] : ['#EC7C6E', '#E9B65E']
  const ghost = day.ghost.score
  const [gx, gy] = polar(150, 150, 122, (ghost ?? 0) / 100)
  const best = day.bestThisMonth?.score
  const [bx, by] = polar(150, 150, 122, (best ?? 0) / 100)
  const closedWindows = day.counts.onTime + day.counts.late + day.counts.missed

  return (
    <div className="wh-dial">
      <svg viewBox="0 0 300 300" width="300" height="300" aria-hidden>
        <defs>
          <linearGradient id="wh-dg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor={c1} /><stop offset="1" stopColor={c2} /></linearGradient>
        </defs>
        <g strokeWidth="1.4" strokeLinecap="round">{ticks}</g>
        <circle cx="150" cy="150" r="122" fill="none" stroke="rgba(255,255,255,.055)" strokeWidth="16" />
        {score > 0 && (
          <circle cx="150" cy="150" r="122" fill="none" stroke="url(#wh-dg)" strokeWidth="16" strokeLinecap="round"
            pathLength="100" strokeDasharray={`${score} 100`} transform="rotate(-90 150 150)" style={{ transition: 'stroke-dasharray .6s ease' }} />
        )}
        {ghost != null && <circle cx={gx} cy={gy} r="7" fill="#0B0E14" stroke="rgba(236,239,244,.75)" strokeWidth="2" strokeDasharray="2.4 2.2"><title>{`${day.ghost.label} at this hour: ${ghost}`}</title></circle>}
        {best != null && <circle cx={bx} cy={by} r="3" fill="rgba(236,239,244,.45)"><title>{`Best this month: ${best}`}</title></circle>}
      </svg>
      <div className="wh-dialc" role="img" aria-label={`Day score ${day.score ?? 'not started'}`}>
        <div className="l">Day score</div>
        <div className="n num">{day.score ?? '–'}</div>
        <div className="s">{day.closed ? 'final' : day.future ? 'not started' : `earned so far · ${closedWindows} window${closedWindows === 1 ? '' : 's'} closed`}</div>
      </div>
    </div>
  )
}

// ─── Hero text ───────────────────────────────────────────────────────────────

function listOf(names: string[]) {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function Narrative({ items }: { items: DayItem[] }) {
  const onTime = items.filter(i => i.status === 'on_time').map(i => i.label)
  const late = items.filter(i => i.status === 'late').map(i => i.label)
  const missed = items.filter(i => i.status === 'overdue' || i.status === 'missed').map(i => i.label)
  const ahead = items.filter(i => i.status === 'upcoming' || i.status === 'open').length
  const parts: string[] = []
  if (onTime.length) parts.push(`${listOf(onTime.slice(0, 3))}${onTime.length > 3 ? ` and ${onTime.length - 3} more` : ''} landed in ${onTime.length === 1 ? 'its window' : 'their windows'}.`)
  if (late.length) parts.push(`${listOf(late.slice(0, 2))} came in late.`)
  if (missed.length) parts.push(`${listOf(missed.slice(0, 2))}${missed.length > 2 ? ` and ${missed.length - 2} more` : ''} slipped past ${missed.length === 1 ? 'its window' : 'their windows'}${missed.length > 2 ? '' : ', and that is the gap'}.`)
  if (ahead) parts.push(ahead === 1 ? 'One window is still ahead.' : `${ahead} windows are still ahead.`)
  if (!parts.length) return null
  return <p>{parts.join(' ')}</p>
}

function Sparkline({ recent }: { recent: TodayView['day']['recent'] }) {
  const pts = recent.map((r, i) => ({ x: 4 + i * (128 / 6), y: r.score == null ? null : 32 - (r.score / 100) * 28 }))
  const line = pts.filter(p => p.y != null).map(p => `${p.x},${p.y}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg width="140" height="36" viewBox="0 0 140 36" style={{ marginTop: 4 }} role="img"
      aria-label={recent.map(r => `${r.date}: ${r.score ?? 'no data'}`).join(', ')}>
      <line x1="4" x2="132" y1="32" y2="32" stroke="rgba(255,255,255,.08)" />
      {line && <polyline points={line} fill="none" stroke="#B4BCC9" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />}
      {pts.map((p, i) => p.y != null && <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 3 : 1.8} fill={i === pts.length - 1 ? '#E9B65E' : '#B4BCC9'} />)}
      {last.y == null && <circle cx={last.x} cy={32} r="2" fill="rgba(255,255,255,.2)" />}
    </svg>
  )
}

function Hero({ day }: { day: TodayView['day'] }) {
  const diff = day.ghost.diff
  const today = day.isToday !== false
  const [kickText, kickColor] = day.future ? ['Planned', 'var(--k-mute)']
    : day.reopened ? ['Open for corrections', 'var(--k-warn)']
    : !today ? [day.closed ? 'Day closed' : 'Past day', 'var(--k-mute)']
    : diff == null
    ? [day.closed ? 'Day closed' : 'Your day so far', 'var(--k-mute)']
    : diff < 0 ? ['Behind your pace', 'var(--k-warn)'] : diff > 0 ? ['Ahead of your pace', 'var(--k-good)'] : ['On your pace', 'var(--k-good)']
  const [first, ...rest] = day.coach.split(/(?<=\.)\s+/)
  return (
    <section className="wh-hero">
      <Dial day={day} />
      <div className="wh-htext">
        <div className="wh-kick" style={{ color: kickColor }}><i />{kickText}</div>
        <h1>{first}{rest.length > 0 && <><br /><span>{rest.join(' ')}</span></>}</h1>
        <Narrative items={day.items} />
        <div className="wh-ghosts">
          <div className="wh-g">
            <div className="k">{day.ghost.label}{today ? ' at this hour' : ''}</div>
            <div className="v num">{day.ghost.score ?? '–'}
              {diff != null && diff !== 0 && <small>{diff < 0 ? `${-diff} ahead of you` : `${diff} behind you`}</small>}
            </div>
          </div>
          <div className="wh-g">
            <div className="k">Best day this month</div>
            <div className="v num">{day.bestThisMonth?.score ?? '–'}{day.bestThisMonth && <small>{fmtDate(day.bestThisMonth.date)}</small>}</div>
          </div>
          <div className="wh-g">
            <div className="k">Last 7 days</div>
            <Sparkline recent={day.recent} />
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Now ─────────────────────────────────────────────────────────────────────

function Now({ day, onTick, onMissed, onCorrect, busy }: { day: TodayView['day']; onTick: (id: number) => void; onMissed: (id: number) => void; onCorrect: () => void; busy: boolean }) {
  const openReview = useOpenReview()
  const overdue = [...day.items].reverse().find(i => i.status === 'overdue')   // most recent miss first
  const next = day.next

  if (day.closed) {
    return (
      <section className="wh-card wh-now">
        <div className="wh-live" style={{ color: 'var(--k-mute)' }}><i />Day closed</div>
        <h2>Final score {day.score ?? 0}</h2>
        <div className="foot"><span>Tomorrow starts at 04:00.</span><button className="wh-chase" disabled={busy} onClick={onCorrect}>Correct this day</button></div>
      </section>
    )
  }

  const c = day.current
  if (c) {
    const span = (c.end ?? 0) - (c.start ?? 0)
    const pct = span ? Math.min(100, Math.max(0, ((span - c.minutesLeft) / span) * 100)) : 0
    return (
      <section className="wh-card wh-now">
        <div className="r1">
          <div className="wh-live" style={{ color: 'var(--k-good)' }}><i />Now · window open</div>
          <div className="wh-pts num" style={{ color: 'var(--k-good)', background: 'var(--k-good-d)' }}>+{pt(c.points)} on time</div>
        </div>
        <h2>{c.label} <span>open until <span className="num">{endClock(c)}</span></span></h2>
        <div className="wh-win">
          <div className="wh-bar"><b style={{ width: `${pct}%`, background: 'var(--k-good)' }} /></div>
          <div className="num" style={{ fontSize: 13, color: 'var(--k-ink2)', whiteSpace: 'nowrap' }}>{duration(c.minutesLeft)} left</div>
          <button className="wh-btn ghost" disabled={busy} onClick={() => onMissed(c.id)} title="It didn't happen: earns nothing and counts like any miss">Missed</button>
          <button className="wh-btn" disabled={busy} onClick={() => onTick(c.id)}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3L13 4.5" /></svg>
            Done
          </button>
        </div>
        <div className="foot">
          <span>Late after <span className="num">{endClock(c)}</span> is half credit, +{pt(c.points / 2)}</span>
          {next && <span>Next up · <b>{next.label}</b> at <span className="num">{next.time}</span></span>}
        </div>
      </section>
    )
  }

  if (overdue) {
    return (
      <section className="wh-card wh-now">
        <div className="r1">
          <div className="wh-live" style={{ color: 'var(--k-warn)' }}><i />Past its window</div>
          <div className="wh-pts num" style={{ color: 'var(--k-warn)', background: 'var(--k-warn-d)' }}>+{pt(overdue.points / 2)} if done now</div>
        </div>
        <h2>{overdue.label} <span>was due at <span className="num">{overdue.time}</span></span></h2>
        <div className="wh-win">
          <div style={{ flex: 1, fontSize: 13, color: 'var(--k-ink2)' }}>Late still counts for half. Missed counts for nothing.</div>
          <button className="wh-btn ghost" disabled={busy} onClick={() => onMissed(overdue.id)} title="It didn't happen: earns nothing and counts like any miss">Missed</button>
          <button className="wh-btn" disabled={busy} onClick={() => onTick(overdue.id)}>Done late</button>
        </div>
        <div className="foot">
          <span>{day.counts.missed} past {day.counts.missed === 1 ? 'its window' : 'their windows'} today</span>
          {next ? <span>Next up · <b>{next.label}</b> at <span className="num">{next.time}</span></span>
            : <button className="wh-chase" onClick={openReview}>Close the day</button>}
        </div>
      </section>
    )
  }

  return (
    <section className="wh-card wh-now">
      <div className="wh-live" style={{ color: 'var(--k-mute)' }}><i />{next ? 'Between windows' : 'Nothing left today'}</div>
      <h2>{next ? <>{next.label} <span>opens in <span className="num">{duration(next.minutesUntil)}</span></span></> : 'All windows are behind you'}</h2>
      <div className="foot">
        {next ? <span>At <span className="num">{next.time}</span>, worth +{pt(next.points)} on time</span> : <span>Give each miss a reason and lock the score.</span>}
        {!next && <button className="wh-chase" onClick={openReview}>Close the day</button>}
      </div>
    </section>
  )
}

const endClock = (i: DayItem) => {
  const m = (i.end ?? 0) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** In place of "Now" when another day is on screen: what state it is in and the one thing to do with it. */
function DayStatus({ day, onCorrect, onCloseAgain, busy }: { day: TodayView['day']; onCorrect: () => void; onCloseAgain: () => void; busy: boolean }) {
  const name = new Date(day.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  if (day.future) {
    return (
      <section className="wh-card wh-now">
        <div className="wh-live" style={{ color: 'var(--k-mute)' }}><i />Ahead · {name}</div>
        <h2>{day.items.length ? `${day.items.length} item${day.items.length === 1 ? '' : 's'} planned` : 'Nothing planned yet'}</h2>
        <div className="foot"><span>Add one-offs for this day below. Items can be ticked once the day starts.</span></div>
      </section>
    )
  }
  if (day.reopened) {
    return (
      <section className="wh-card wh-now">
        <div className="r1">
          <div className="wh-live" style={{ color: 'var(--k-warn)' }}><i />Open for corrections · {name}</div>
          <div className="wh-pts num" style={{ color: 'var(--k-warn)', background: 'var(--k-warn-d)' }}>ticks count as late</div>
        </div>
        <h2>Score now {day.score ?? 0}</h2>
        <div className="foot">
          <span>Tick or untick below. It closes again by itself at 04:00.</span>
          <button className="wh-chase" disabled={busy} onClick={onCloseAgain}>Close it again</button>
        </div>
      </section>
    )
  }
  return (
    <section className="wh-card wh-now">
      <div className="wh-live" style={{ color: 'var(--k-mute)' }}><i />Closed · {name}</div>
      <h2>{day.items.length ? <>Final score {day.score ?? 0}</> : 'Nothing recorded'}</h2>
      <div className="foot">
        <span>{day.items.length ? 'Something wrong? Reopen it, fix the ticks, and it closes again.' : 'No routine ran on this day.'}</span>
        {day.items.length > 0 && <button className="wh-chase" disabled={busy} onClick={onCorrect}>Correct this day</button>}
      </div>
    </section>
  )
}

function Discipline({ day }: { day: TodayView['day'] }) {
  const { onTime, late, missed } = day.counts
  const closed = onTime + late + missed
  const pct = closed ? Math.round((onTime / closed) * 100) : 0
  const color = !closed ? 'rgba(255,255,255,.2)' : pct >= 75 ? '#6FD3A0' : pct >= 45 ? '#E9B65E' : '#EC7C6E'
  return (
    <section className="wh-card wh-disc">
      <svg width="92" height="92" viewBox="0 0 92 92" aria-hidden>
        <circle cx="46" cy="46" r="38" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="8" />
        {closed > 0 && <circle cx="46" cy="46" r="38" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" pathLength="100" strokeDasharray={`${pct} 100`} transform="rotate(-90 46 46)" />}
        <text x="46" y="52" textAnchor="middle" fontFamily="Inter" fontWeight="300" fontSize="21" fill="#ECEFF4">{closed ? `${pct}%` : '–'}</text>
      </svg>
      <div>
        <div className="wh-h">Discipline</div>
        <p>{closed
          ? <><b>{onTime} of {closed}</b> windows on time today.{late ? ` ${late} late.` : ''}{missed ? ` ${missed} missed.` : ''}</>
          : 'No windows have closed yet today.'}</p>
      </div>
    </section>
  )
}

// ─── Timeline ────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  on_time: 'var(--k-good)', late: 'var(--k-warn)', missed: 'var(--k-bad)', overdue: 'var(--k-bad)',
}

type MenuAt = { id: number; x: number; y: number } | null

/** Where to drop the item menu under the element that opened it. */
const menuAt = (el: HTMLElement, id: number) => { const r = el.getBoundingClientRect(); return { id, x: r.left + r.width / 2, y: r.bottom + 6 } }

function Timeline({ day, minute, locked, menu, onMenu, busy }: {
  day: TodayView['day']; minute: number; locked: boolean; menu: MenuAt; onMenu: (m: MenuAt) => void; busy: boolean
}) {
  const items = day.items
  const curIdx = items.findIndex(i => i.status === 'open')
  const firstAhead = items.findIndex(i => i.status === 'upcoming' || i.status === 'open')
  const n = items.length
  const solidTo = firstAhead === -1 ? 100 : n ? ((firstAhead + 0.5) / n) * 100 : 0
  return (
    <section className="wh-card wh-tl">
      <div className="hd">
        <div className="wh-h">Your day</div>
        <div className="wh-sub">{locked ? (day.future ? 'Planned for this day' : 'Closed, read only') : <>Tap a stop to mark it done or missed · closes at <span className="num">{day.closesAt}</span></>}</div>
      </div>
      {n === 0 ? <p className="wh-sub" style={{ marginTop: 14 }}>{day.isToday === false ? 'Nothing on this day.' : 'No routine set for today. Add items in Routine.'}</p> : (
        <div className="wh-strip" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          <div className="line" style={{ left: `${50 / n}%`, width: `${Math.max(0, solidTo - 50 / n)}%`, background: 'rgba(255,255,255,.16)' }} />
          <div className="line" style={{ left: `${solidTo}%`, right: `${50 / n}%`, background: 'repeating-linear-gradient(90deg, rgba(255,255,255,.13) 0 4px, transparent 4px 9px)' }} />
          {items.map((i, idx) => {
            const cls = idx === curIdx ? 'cur' : i.status === 'upcoming' || i.status === 'anytime' ? 'up' : ''
            const color = STATUS_COLOR[i.status]
            const rs = i.status === 'on_time' ? `+${pt(i.earned)}` : i.status === 'late' ? `+${pt(i.earned)} late`
              : i.status === 'overdue' || i.status === 'missed' ? 'missed' : i.status === 'open' ? 'now'
              : idx === firstAhead ? 'next' : ''
            const done = isDone(i.status)
            const able = !locked && (canUntick(i, locked) || canTick(i, minute, locked) || canMarkMissed(i, locked) || canUnmarkMissed(i, locked))
            return (
              <button key={i.id} className={`wh-st ${cls} ${able ? 'able' : ''} ${done ? 'done' : ''}`} disabled={!able || busy}
                onClick={e => onMenu(menu?.id === i.id ? null : menuAt(e.currentTarget as HTMLElement, i.id))}
                title={`${i.time ?? 'Anytime'} · ${i.label}`}
                aria-haspopup="menu" aria-expanded={menu?.id === i.id}
                aria-label={`${i.label}, ${i.time ?? 'anytime'}, ${done ? 'done' : i.status}. Open options.`}>
                <div className="tm">{i.time ?? '··'}</div>
                <div className="dot" style={cls ? undefined : { background: color }}>
                  {done && <svg viewBox="0 0 12 12" width="8" height="8" aria-hidden><path d="M2.5 6.3l2.2 2.1 4.8-4.8" fill="none" stroke="#0B0E14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
                <div className="lb">{i.label}</div>
                <div className="rs num" style={{ color: color ?? (i.status === 'open' ? 'var(--k-good)' : 'var(--k-mute)') }}>{rs || ' '}</div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** The item menu, shared by the strip and the lists: done, untick, missed, not missed. */
function ItemMenu({ day, menu, minute, locked, onSet, onMissed, onClose }: {
  day: TodayView['day']; menu: NonNullable<MenuAt>; minute: number; locked: boolean
  onSet: (id: number, done: boolean) => void; onMissed: (id: number, missed: boolean) => void; onClose: () => void
}) {
  useEffect(() => {
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.wh-stmenu, .wh-st, .rt-more')) onClose() }
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
      <p><span className="num">{picked.time ?? 'Anytime'}</span> · {picked.label}</p>
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

// ─── Any day: the date stepper ───────────────────────────────────────────────

function DateBar({ date, today, onGo, loading }: { date: string; today: string; onGo: (d: string) => void; loading: boolean }) {
  const isToday = date === today
  const rel = date === today ? 'Today' : date === plusDays(today, -1) ? 'Yesterday' : date === plusDays(today, 1) ? 'Tomorrow' : null
  return (
    <div className="rt-datebar" aria-busy={loading}>
      <div className="rt-step">
        <button onClick={() => onGo(plusDays(date, -1))} aria-label="Previous day">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M8.5 3L4.5 7l4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <label className="rt-pick">
          <span className="num">{fmtDay(date)}</span>{rel && <small>{rel}</small>}
          <input type="date" value={date} aria-label="Pick a day" onChange={e => ISO.test(e.target.value) && onGo(e.target.value)} />
        </label>
        <button onClick={() => onGo(plusDays(date, 1))} aria-label="Next day">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M5.5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      {!isToday && <button className="wh-chase" onClick={() => onGo(today)}>Back to today</button>}
    </div>
  )
}

// ─── The lists: each routine, this week, and one-offs ───────────────────────

const readSet = (k: string): string[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
const writeVal = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }
const COLLAPSED = 'oura-today-collapsed'
const HIDE_DONE = 'oura-today-hide-done'

function itemNote(i: DayItem, pastDay: boolean): [string, string] {
  switch (i.status) {
    case 'on_time': return [`on time +${pt(i.earned)}`, 'var(--k-good)']
    case 'late': return [`late +${pt(i.earned)}`, 'var(--k-warn)']
    case 'missed': return ['missed', 'var(--k-bad)']
    case 'overdue': return [pastDay ? `+${pt(i.points / 2)} if done` : 'past window', 'var(--k-bad)']
    case 'open': return ['now', 'var(--k-good)']
    case 'anytime': return [pastDay ? `+${pt(i.points / 2)} if done` : 'anytime', 'var(--k-mute)']
    case 'upcoming': return [i.time ? `opens ${i.time}` : '', 'var(--k-faint)']
  }
}

function Lists({ day, minute, locked, menu, onMenu, onSet, onWeekly, onAddOneOffs, onRemoveOneOff, busy }: {
  day: TodayView['day']; minute: number; locked: boolean; menu: MenuAt; onMenu: (m: MenuAt) => void
  onSet: (id: number, done: boolean) => void
  onWeekly: (id: number, done: boolean, label: string) => void
  onAddOneOffs: (ps: Parsed[]) => void
  onRemoveOneOff: (i: DayItem) => void
  busy: boolean
}) {
  const [collapsed, setCollapsed] = useState<string[]>(() => readSet(COLLAPSED))
  const [hideDone, setHideDone] = useState<boolean>(() => { try { return localStorage.getItem(HIDE_DONE) === 'true' } catch { return false } })
  const flip = (k: string) => setCollapsed(c => { const n = c.includes(k) ? c.filter(x => x !== k) : [...c, k]; writeVal(COLLAPSED, n); return n })
  const toggleHide = () => setHideDone(h => { writeVal(HIDE_DONE, !h); return !h })

  const pastDay = day.isToday === false && !day.future
  const closed = day.closed
  const groups = day.routines ?? []
  const routineGroups = groups.filter(g => g.templateId != null)
  const oneGroup = groups.find(g => g.templateId == null)
  const weekly = day.weekly?.routines ?? []
  const doneCount = day.items.filter(i => isDone(i.status)).length + weekly.reduce((s, r) => s + r.items.filter(i => i.done).length, 0)
  const total = day.items.length
  const left = day.items.filter(i => !isDone(i.status) && i.status !== 'missed').length
  const oneLabel = day.isToday === false ? `Just for ${fmtDay(day.date)}` : 'Just for today'

  const row = (i: DayItem) => {
    const done = isDone(i.status)
    const able = done ? canUntick(i, locked) : canTick(i, minute, locked)
    const [note, color] = itemNote(i, pastDay)
    const hint = done ? 'Click to untick.' : day.future ? 'This day has not started yet.' : tickHint(i, minute, locked)
    const oneOff = i.templateId == null
    return (
      <div key={i.id} className={`rt-row ${done ? 'done' : ''} ${i.status === 'missed' ? 'missed' : ''}`}>
        <button className={`rt-check ${done ? 'on' : ''}`} disabled={!able || busy} aria-pressed={done} title={hint}
          aria-label={done ? `Untick ${i.label}` : `Tick ${i.label}`} onClick={() => onSet(i.id, !done)}>
          {done && <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden><path d="M2.5 6.3l2.2 2.1 4.8-4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </button>
        <span className="tm num">{i.time ?? '··'}</span>
        <span className="lb">{i.label}<Streak n={i.streak} /></span>
        <span className="nt num" style={{ color }}>{note}</span>
        {oneOff && !closed
          ? <button className="rt-x" disabled={busy} onClick={() => onRemoveOneOff(i)} aria-label={`Delete ${i.label}`} title="Delete this one-off">×</button>
          : <button className="rt-more" disabled={closed || busy} aria-haspopup="menu" aria-expanded={menu?.id === i.id} aria-label={`More for ${i.label}`}
              onClick={e => onMenu(menu?.id === i.id ? null : menuAt(e.currentTarget as HTMLElement, i.id))}>⋯</button>}
      </div>
    )
  }

  const group = (key: string, name: string, note: string, prog: { done: number; total: number }, body: React.ReactNode, sub?: string) => {
    const shut = collapsed.includes(key)
    return (
      <div key={key} className="rt-grp">
        <button className="rt-gh" aria-expanded={!shut} onClick={() => flip(key)}>
          <svg className={shut ? '' : 'open'} width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="nm">{name}{sub && <small>{sub}</small>}</span>
          <span className="ct num">{note}</span>
          <span className="wh-bar"><b style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%`, background: prog.total && prog.done === prog.total ? 'var(--k-good)' : 'var(--k-ink2)' }} /></span>
        </button>
        {!shut && body}
      </div>
    )
  }
  const visible = (list: DayItem[]) => (hideDone ? list.filter(i => !isDone(i.status)) : list)
  const hiddenNote = (list: DayItem[]) => {
    const n = hideDone ? list.filter(i => isDone(i.status)).length : 0
    return n ? <p className="rt-hidden">{n} done, hidden</p> : null
  }

  return (
    <section className="wh-card rt-lists">
      <div className="hd">
        <div>
          <SectionLink to="/checklists">Routine</SectionLink>
          <p className="rt-answer">
            {total === 0 && !weekly.length ? (day.future ? 'Nothing planned for this day yet.' : 'Nothing on this day.')
              : left === 0 && total > 0 ? `All ${total} done or settled${day.counts.missed ? `, ${day.counts.missed} missed` : ''}.`
              : <><b className="num">{day.items.filter(i => isDone(i.status)).length}</b> of {total} done, <b className="num">{left}</b> left{day.counts.missed ? `, ${day.counts.missed} missed` : ''}.</>}
          </p>
        </div>
        {doneCount > 0 && <button className="wh-chase" onClick={toggleHide} aria-pressed={hideDone}>{hideDone ? 'Show done' : 'Hide done'}</button>}
      </div>

      {routineGroups.map(g => {
        const list = day.items.filter(i => i.templateId === g.templateId)
        return group(g.key, g.name, `${g.done} done · ${g.left} left${g.missed ? ` · ${g.missed} missed` : ''}`, { done: g.done, total: g.total },
          <div className="rt-rows">{visible(list).map(row)}{hiddenNote(list)}</div>)
      })}

      {weekly.map(w => {
        const d = w.items.filter(i => i.done).length
        const list = hideDone ? w.items.filter(i => !i.done) : w.items
        return group(`w${w.templateId}`, 'This week', `${d} done · ${w.items.length - d} left`, { done: d, total: w.items.length },
          <div className="rt-rows">
            {list.map(i => (
              <div key={i.id} className={`rt-row wk ${i.done ? 'done' : ''}`}>
                <button className={`rt-check ${i.done ? 'on' : ''}`} disabled={busy} aria-pressed={i.done}
                  aria-label={i.done ? `Untick ${i.label} for this week` : `Tick ${i.label} for this week`} onClick={() => onWeekly(i.id, !i.done, i.label)}>
                  {i.done && <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden><path d="M2.5 6.3l2.2 2.1 4.8-4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </button>
                <span className="lb">{i.label}<Streak n={i.streak} unit="week" /></span>
                <span className="nt" style={{ color: i.done ? 'var(--k-good)' : 'var(--k-mute)' }}>{i.done ? `done ${new Date(i.completedAt!).toLocaleDateString('en-GB', { weekday: 'short' })}` : 'this week'}</span>
              </div>
            ))}
            {hideDone && w.items.length !== list.length && <p className="rt-hidden">{w.items.length - list.length} done, hidden</p>}
          </div>, `${w.name} · week of ${fmtDate(day.weekly!.weekOf)}`)
      })}

      {group('oneoffs', oneLabel, oneGroup ? `${oneGroup.done} done · ${oneGroup.left} left` : 'none yet', { done: oneGroup?.done ?? 0, total: oneGroup?.total ?? 0 },
        <div className="rt-rows">
          {(() => { const list = day.items.filter(i => i.templateId == null); return <>{visible(list).map(row)}{hiddenNote(list)}</> })()}
          {!closed && (
            <QuickAdd today={day.date} onAdd={onAddOneOffs} label="Add one-offs in one line, or paste a list"
              placeholder={day.future ? 'Add to this day: Call the bank 16:00 must' : 'Add one: Call the bank 16:00 must · or paste a list'} />
          )}
        </div>)}
    </section>
  )
}

// ─── Wins ────────────────────────────────────────────────────────────────────

const WIN_ICON: Record<string, React.ReactNode> = {
  business: <path d="M2 11l4-4 3 3 5-6M10 4h4v4" />,
  training: <path d="M1.5 8h13M4 5v6M12 5v6M2 6.5v3M14 6.5v3" />,
  week: <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />,
}

function Wins({ wins }: { wins: TodayView['wins'] }) {
  if (!wins.length) {
    return (
      <section className="wh-wins">
        <div className="wh-wn" style={{ paddingLeft: 18 }}>
          <div className="a">No new bests this week yet</div>
          <div className="b">Records, best weeks and all-time highs show up here when you earn them.</div>
        </div>
      </section>
    )
  }
  return (
    <section className="wh-wins" aria-label="Earned this week">
      {wins.map((w, i) => (
        <div key={i} className="wh-wn">
          <div className="wh-badge"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{WIN_ICON[w.kind] ?? WIN_ICON.week}</svg></div>
          <div className="a">{w.title}</div>
          <div className="b">{w.detail}</div>
        </div>
      ))}
    </section>
  )
}

// ─── Week ────────────────────────────────────────────────────────────────────

function Gauge({ week }: { week: NonNullable<TodayView['week']> }) {
  const frac = (x: number) => Math.min(1, Math.max(0, x / week.max))
  // Semicircle from 180° (left) to 0° (right), centre (160,150), r 118.
  const at = (f: number, r: number) => {
    const a = Math.PI - f * Math.PI
    return [160 + r * Math.cos(a), 150 - r * Math.sin(a)] as const
  }
  const lastF = week.lastWeek ? frac(week.lastWeek.score) : null
  return (
    <div className="wh-gauge">
      <svg width="320" height="168" viewBox="0 0 320 168" aria-hidden>
        <path d="M42 150 A118 118 0 0 1 278 150" fill="none" stroke="rgba(255,255,255,.055)" strokeWidth="12" strokeLinecap="round" />
        {week.score > 0 && <path d="M42 150 A118 118 0 0 1 278 150" fill="none" stroke="#E9B65E" strokeWidth="12" strokeLinecap="round" pathLength="100" strokeDasharray={`${frac(week.score) * 100} 100`} style={{ transition: 'stroke-dasharray .6s ease' }} />}
        {week.ladder.map(r => {
          const [x1, y1] = at(frac(r.at), 110), [x2, y2] = at(frac(r.at), 128), [tx, ty] = at(frac(r.at), 146)
          return (
            <g key={r.at}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0B0E14" strokeWidth="2.5" />
              <text x={tx} y={ty + 4} fontFamily="Inter" fontSize="11" fill="#7F8899" textAnchor="middle">{pt(r.at)}</text>
            </g>
          )
        })}
        {lastF != null && (() => { const [x, y] = at(lastF, 118); return <circle cx={x} cy={y} r="6" fill="#0B0E14" stroke="rgba(236,239,244,.75)" strokeWidth="1.8" strokeDasharray="2.2 2"><title>{`Last week: ${week.lastWeek!.score}`}</title></circle> })()}
      </svg>
      <div className="c">
        <div className="n num">{pt(week.score)}<small> / {pt(week.max)}</small></div>
        {week.lastWeek && <div className="wh-sub" style={{ marginTop: 4 }}>Last week: <span className="num" style={{ color: 'var(--k-ink2)' }}>{pt(week.lastWeek.score)}</span>{week.lastWeek.reward ? ` · ${week.lastWeek.reward}` : ''}</div>}
      </div>
    </div>
  )
}

function Week({ week }: { week: TodayView['week'] }) {
  const nav = useNavigate()
  if (!week) {
    return (
      <section className="wh-card wh-week">
        <SectionLink to="/goals">This week</SectionLink>
        <p className="wh-sub" style={{ marginTop: 8 }}>No weekly goal is set. Set one up in Week and the score starts counting.</p>
        <button className="wh-chase" style={{ marginTop: 12 }} onClick={() => nav('/goals')}>Open Week</button>
      </section>
    )
  }
  return (
    <section className="wh-card wh-week">
      <div className="hd">
        <SectionLink to="/goals">This week</SectionLink>
        <div className="wh-sub">{fmtDate(week.from)} to {fmtDate(week.to)}</div>
      </div>
      {week.focus && <p className="rt-focus"><span>Focus</span>{week.focus}</p>}
      <Gauge week={week} />
      <div className="wh-ladder">
        {week.ladder.map(r => (
          <div key={r.at} className={`wh-rung ${r.reached ? 'got' : week.nextReward?.at === r.at ? 'next' : ''}`}>
            <div className="p num">at {pt(r.at)}</div>
            <div className="r">{r.reward}</div>
          </div>
        ))}
      </div>
      <div className="wh-tasks">
        {week.tasks.map(t => (
          <div key={t.id} className="wh-tk">
            <div className="nm">{t.title}{t.note && <small className={/break|review/.test(t.note) && t.earned < t.max ? 'bad' : ''}>{t.source !== 'manual' ? `auto · ${t.note}` : t.note}</small>}</div>
            <div className="wh-bar"><b style={{ width: `${(t.earned / t.max) * 100}%`, background: 'var(--k-good)' }} /></div>
            <div className="v num">{pt(t.earned)}/{pt(t.max)}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Stakes({ week }: { week: NonNullable<TodayView['week']> }) {
  if (!week.stakes && !week.coach) return null
  const out = week.stakes?.includes('out of reach')
  return (
    <section className="wh-card wh-stakes">
      {week.nextReward && (
        <div className="t">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 1.8L15 14H1z" /><path d="M8 6.5v3.2M8 11.8v.1" /></svg>
          {out ? `${week.nextReward.reward} is out of reach` : `${week.nextReward.reward} at ${pt(week.nextReward.at)}`}
        </div>
      )}
      {week.stakes && <p>{week.stakes}</p>}
      {week.coach && <div className="lever"><b>The one thing:</b> {week.coach.replace(/^Biggest lever: /, '')}</div>}
    </section>
  )
}

// ─── Money, training and calendar ────────────────────────────────────────────

const tone = (n: number) => (n > 0 ? 'var(--k-good)' : n < 0 ? 'var(--k-bad)' : 'var(--k-ink2)')
const signed = (fmt: FmtView, n: number, cur?: string) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n), cur)
const rr = (n: number | null) => (n == null ? '–' : `${n > 0 ? '+' : ''}${n.toFixed(2)}R`)

/** Seven days of P&L as bars on a zero line. */
function WeekBars({ days, fmt }: { days: { date: string; label: string; pnl: number }[]; fmt: FmtView }) {
  const max = Math.max(1, ...days.map(d => Math.abs(d.pnl)))
  const H = 26, W = 22, G = 8
  return (
    <svg className="rt-bars" width={days.length * (W + G) - G} height={H * 2 + 16} role="img"
      aria-label={`Last 7 days: ${days.map(d => `${d.label} ${signed(fmt, d.pnl, 'USD')}`).join(', ')}`}>
      <line x1="0" x2={days.length * (W + G) - G} y1={H} y2={H} stroke="rgba(255,255,255,.12)" />
      {days.map((d, i) => {
        const h = d.pnl === 0 ? 0 : Math.max(2, (Math.abs(d.pnl) / max) * (H - 2))
        return (
          <g key={d.date}>
            <title>{`${d.label}: ${signed(fmt, d.pnl, 'USD')}`}</title>
            {h > 0 && <rect x={i * (W + G)} y={d.pnl > 0 ? H - h : H + 1} width={W} height={h} rx="2" fill={d.pnl > 0 ? 'var(--k-good)' : 'var(--k-bad)'} />}
            <text x={i * (W + G) + W / 2} y={H * 2 + 13} textAnchor="middle" fontSize="10" fill="var(--k-faint)">{d.label.slice(0, 2)}</text>
          </g>
        )
      })}
    </svg>
  )
}

function Trading({ pulse, fmt }: { pulse: TodayView['pulse']; fmt: FmtView }) {
  const nav = useNavigate()
  const d = pulse.tradingDay, m = pulse.tradingMonth
  const limits = pulse.trading.filter(a => a.limitLeft != null && a.limitLeft < (a.limitUnit === 'R' ? 2 : Infinity))
  return (
    <section className="wh-card rt-card">
      <div className="hd">
        <SectionLink to="/trading">Trading</SectionLink>
        <CurrencySelector pageKey="dashboard" defaultCurrency="USD" />
      </div>
      <p className="rt-answer">
        {d && d.count
          ? <>{d.pnl < 0 ? 'Down' : d.pnl > 0 ? 'Up' : 'Flat'} <b className="num" style={{ color: tone(d.pnl) }}>{fmt(Math.abs(d.pnl), 'USD')}</b> today across {d.count} trade{d.count === 1 ? '' : 's'}</>
          : 'No trades today'}
        {m ? <>; the month is <b className="num" style={{ color: tone(m.pnl) }}>{signed(fmt, m.pnl, 'USD')}</b>.</> : '.'}
      </p>
      <div className="rt-tgrid">
        <div className="rt-fig">
          <span>Today</span>
          <b className="num" style={{ color: d?.count ? tone(d.pnl) : 'var(--k-faint)' }}>{d?.count ? signed(fmt, d.pnl, 'USD') : '–'}</b>
          <small>{d?.count ? <>{d.count} trade{d.count === 1 ? '' : 's'} · avg <span className="num">{rr(d.avgR)}</span></> : 'no trades yet'}</small>
        </div>
        {m && <WeekBars days={m.last7} fmt={fmt} />}
      </div>
      {m && (
        <div className="rt-stats">
          <div><span>This month</span><b className="num" style={{ color: tone(m.pnl) }}>{signed(fmt, m.pnl, 'USD')}</b></div>
          <div><span>Trades</span><b className="num">{m.count}</b></div>
          <div><span>Win rate</span><b className="num">{m.winRate == null ? '–' : `${m.winRate}%`}</b></div>
          <div><span>Average</span><b className="num" style={{ color: tone(m.avgR ?? 0) }}>{rr(m.avgR)}</b></div>
        </div>
      )}
      {d && d.trades.length > 0 && (
        <div className="rt-trades">
          {d.trades.map(t => (
            <button key={t.id} className="rt-trade" onClick={() => nav(`/trading?trade=${t.id}`)} aria-label={`Open trade ${t.asset} ${t.direction}`}>
              <b>{t.asset}</b><span>{t.direction}</span><i />
              <span className="num" style={{ color: tone(t.r ?? 0) }}>{rr(t.r)}</span>
              <span className="num" style={{ color: tone(t.pnl) }}>{signed(fmt, t.pnl, 'USD')}</span>
            </button>
          ))}
        </div>
      )}
      {limits.map(a => (
        <div key={a.id} className="wh-mrow">
          <div className="k">{a.name} <span className="num">{a.trades} trade{a.trades === 1 ? '' : 's'} today</span></div>
          <div className="r">
            {a.netR != null && <span className="num" style={{ color: tone(a.net) }}>{a.netR > 0 ? '+' : ''}{a.netR.toFixed(2)}R</span>}
            {a.limitLeft != null && a.limitLeft < 1 && <span style={{ color: 'var(--k-warn)' }}><span className="num">{a.limitLeft}{a.limitUnit === 'R' ? 'R' : ' $'}</span> to loss limit</span>}
          </div>
        </div>
      ))}
    </section>
  )
}

function Business({ pulse, fmt }: { pulse: TodayView['pulse']; fmt: FmtView }) {
  const nav = useNavigate()
  const b = pulse.business
  if (!b) return null
  const due = b.nextDue
  const today = new Date().toISOString().slice(0, 10)
  const daysLate = due ? Math.round((new Date(today).getTime() - new Date(due.dueDate).getTime()) / 864e5) : 0
  return (
    <section className="wh-card rt-card">
      <div className="hd"><SectionLink to="/business">Business</SectionLink></div>
      <p className="rt-answer">
        Recurring revenue is <b className="num">{fmt(b.mrr, 'GBP')}</b> a month
        {(b.netNewMrr ?? 0) > 0 ? <>, up <b className="num" style={{ color: 'var(--k-good)' }}>{fmt(b.netNewMrr!, 'GBP')}</b> this month</>
          : (b.netNewMrr ?? 0) < 0 ? <>, down <b className="num" style={{ color: 'var(--k-bad)' }}>{fmt(-b.netNewMrr!, 'GBP')}</b> this month</> : ''}.
      </p>
      <div className="rt-stats">
        <div><span>Revenue this month</span><b className="num">{fmt(b.revenueMTD ?? 0, 'GBP')}</b></div>
        <div><span>Margin</span><b className="num">{b.marginPct == null ? '–' : `${b.marginPct.toFixed(1)}%`}</b></div>
        <div><span>Active clients</span><b className="num">{b.activeClients ?? '–'}</b></div>
        <div><span>Owed to you</span><b className="num" style={{ color: b.outstanding > 0 ? 'var(--k-warn)' : undefined }}>{fmt(b.outstanding, 'GBP')}</b></div>
      </div>
      {due && (
        <div className="wh-mrow rt-due">
          <div className="k">{due.clientName ?? due.invoiceNumber} owes <b className="num">{fmt(due.amount, 'GBP')}</b>
            <span style={{ color: daysLate > 0 ? 'var(--k-bad)' : undefined }}>
              {due.invoiceNumber} · {daysLate > 0 ? `${daysLate} day${daysLate === 1 ? '' : 's'} overdue` : `due ${fmtDay(due.dueDate)}`}
            </span>
          </div>
          <div className="r"><button className="wh-chase" onClick={() => nav('/business/invoices')}>Chase</button></div>
        </div>
      )}
    </section>
  )
}

function Training({ pulse }: { pulse: TodayView['pulse'] }) {
  const w = pulse.workouts, last = pulse.lastWorkout
  return (
    <section className="wh-card rt-card">
      <div className="hd"><SectionLink to="/training">Training</SectionLink></div>
      <p className="rt-answer">
        <b className="num">{w.done}</b> of {w.target} workouts this week{w.done >= w.target ? ', target hit.' : '.'}
        {last && <> Last: <b>{last.name}</b>, {fmtDay(last.date)}{last.durationMinutes ? <>, <span className="num">{last.durationMinutes}</span> min</> : ''}.</>}
      </p>
      <div className="wh-segs rt-segs" aria-hidden>{Array.from({ length: w.target }, (_, i) => <i key={i} className={i < w.done ? 'f' : ''} />)}</div>
    </section>
  )
}

function ComingUp({ pulse }: { pulse: TodayView['pulse'] }) {
  const list = pulse.upcoming ?? []
  return (
    <section className="wh-card rt-card">
      <div className="hd"><SectionLink to="/calendar">Coming up</SectionLink></div>
      {list.length === 0 ? <p className="rt-answer">Nothing on the calendar ahead.</p> : (
        <>
          <p className="rt-answer">Next: <b>{list[0].title}</b>, {fmtDay(list[0].start.slice(0, 10))}{!list[0].allDay && list[0].start.length > 10 ? <> at <span className="num">{list[0].start.slice(11, 16)}</span></> : ''}.</p>
          {list.slice(1).map(e => (
            <div key={e.id} className="wh-mrow">
              <div className="k">{e.title}</div>
              <div className="r num" style={{ color: 'var(--k-mute)' }}>{fmtDay(e.start.slice(0, 10))}{!e.allDay && e.start.length > 10 ? ` · ${e.start.slice(11, 16)}` : ''}</div>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function WhoopToday() {
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
  const { fmtView } = useFmtView('USD', 'dashboard')
  const [menu, setMenu] = useState<MenuAt>(null)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = (text: string, undo?: () => void, ms = 4000) => {
    if (hide.current) clearTimeout(hide.current)
    setToast({ text, undo }); hide.current = setTimeout(() => setToast(null), ms)
  }

  if (isPending || !data) return <PageLoader />

  const today = data.today ?? data.day.date
  const date = data.day.date
  const view = date === today ? null : date            // null = today, the default view
  const day = data.day
  const locked = day.closed || !!day.future
  const busy = tick.isPending || missM.isPending || reopen.isPending || closeM.isPending || weeklyM.isPending

  const go = (d: string) => {
    setMenu(null)
    setParams(p => { if (d === today) p.delete('date'); else p.set('date', d); return p }, { replace: true })
  }

  /** Ticks or unticks an item; every tick can be undone from the toast. */
  const setDone = (id: number, done: boolean) => tick.mutate({ id, done, date: view }, {
    onSuccess: v => {
      const it = v.day.items.find(i => i.id === id)
      if (!it) return
      if (done && isDone(it.status)) show(`${it.label}: ${it.status === 'on_time' ? 'on time' : 'late'}, +${pt(it.earned)}`, () => setDone(id, false))
      else if (!done) show(`${it.label}: unticked`)
    },
    onError: e => show(errText(e)),
  })
  const onTick = (id: number) => setDone(id, true)
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
  // A line with "tomorrow" or a date goes to that day; the rest to the day on screen.
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

  return (
    <div className="wh-page skin-enter">
      <div className="wh-grid">
        <div className={`wh-left ${isPlaceholderData ? 'rt-loading' : ''}`}>
          <DateBar date={wanted ?? date} today={today} onGo={go} loading={isPlaceholderData} />
          <Hero day={day} />
          <div className="wh-row2">
            {view
              ? <DayStatus day={day} onCorrect={correct} onCloseAgain={closeAgain} busy={busy} />
              : <Now day={day} onTick={onTick} onMissed={id => setMissed(id, true)} onCorrect={correct} busy={busy} />}
            <Discipline day={day} />
          </div>
          <Timeline day={day} minute={data.minuteOfDay} locked={locked} menu={menu} onMenu={setMenu} busy={busy} />
          <Lists day={day} minute={data.minuteOfDay} locked={locked} menu={menu} onMenu={setMenu} onSet={setDone}
            onWeekly={setWeekly} onAddOneOffs={addOneOffs} onRemoveOneOff={removeOneOff} busy={busy} />
          <Wins wins={data.wins} />
        </div>
        <div className="wh-right">
          <Week week={data.week} />
          {data.week && <Stakes week={data.week} />}
          <Trading pulse={data.pulse} fmt={fmtView} />
          <Business pulse={data.pulse} fmt={fmtView} />
          <Training pulse={data.pulse} />
          <ComingUp pulse={data.pulse} />
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
