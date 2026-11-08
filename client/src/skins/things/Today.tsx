import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { canMarkMissed, canTick, canUnmarkMissed, canUntick, duration, isDone, partOfDay, tickHint, useMarkMissed, useTick, useToday, type DayItem, type TodayView } from '../../core/today'
import { useOpenReview } from '../core'
import { PageLoader } from '../../components/ui/Spinner'
import { Star } from './Shell'

type Day = TodayView['day']
type Week = NonNullable<TodayView['week']>

const EARLY_MIN = 120   // the server lets an item be ticked up to 2 hours before it opens
const pt = (n: number) => String(Math.round(n * 100) / 100)
const money = (n: number, cur = 'GBP') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(n)
const hhmm = (mins: number) => {
  const m = ((mins % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', opts)

const Check = ({ size = 10 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden><path d="M2.2 5.3l1.9 1.9 3.8-4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

// ─── Header: title, date, day-score ring ────────────────────────────────────

function Ring({ day }: { day: Day }) {
  const score = day.score ?? 0
  const ghost = day.ghost.score
  return (
    <div className="th-ring">
      <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden>
        <circle cx="42" cy="42" r="36" fill="none" stroke="#EEF0F3" strokeWidth="7" />
        {score > 0 && <circle cx="42" cy="42" r="36" fill="none" stroke="var(--k-blue)" strokeWidth="7" strokeLinecap="round"
          pathLength="100" strokeDasharray={`${Math.min(100, score)} 100`} transform="rotate(-90 42 42)" style={{ transition: 'stroke-dasharray .6s ease' }} />}
        {ghost != null && (
          <g transform={`rotate(${(ghost / 100) * 360} 42 42)`}>
            <line x1="42" y1="2.5" x2="42" y2="11.5" stroke="#9AA3B0" strokeWidth="2" strokeLinecap="round" />
            <title>{`${day.ghost.label} at this hour: ${ghost}`}</title>
          </g>
        )}
      </svg>
      <div className="c" role="img" aria-label={`Day score ${day.score ?? 'not started'}`}>
        <b className="num">{day.score ?? '–'}</b><span>{day.closed ? 'final score' : 'day score'}</span>
      </div>
    </div>
  )
}

function Head({ day, left }: { day: Day; left: number }) {
  const [first, ...rest] = day.coach.split(/(?<=\.)\s+/)
  const best = day.bestThisMonth
  return (
    <>
      <header className="th-head">
        <div className="th-title"><Star size={27} /><h1>Today</h1></div>
        <div className="th-sub">
          <b>{fmtDate(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}</b>
          {day.closed
            ? <> · day closed with a score of <span className="num">{day.score ?? 0}</span></>
            : <> · <span className="num">{day.now}</span> · {left ? `${left} left before the day closes at ${day.closesAt}` : `nothing left before ${day.closesAt}`}</>}
        </div>
      </header>
      <div className="th-score">
        <Ring day={day} />
        <div className="txt">
          <div className="ghosts">
            {day.ghost.score != null && <span><i />{day.ghost.label} at this hour: <span className="num">{day.ghost.score}</span></span>}
            {best && <span>Best this month: <span className="num">{best.score}</span></span>}
          </div>
          <div className="coach"><b>{first}</b>{rest.length > 0 && ` ${rest.join(' ')}`}</div>
        </div>
      </div>
    </>
  )
}

// ─── The day, grouped Things-style ───────────────────────────────────────────

const GROUP_COLOR: Record<string, string> = { Morning: '#5E6B80', Afternoon: '#1F8F86', Tonight: '#5A55C9', Anytime: 'var(--k-mute)' }

type TickFn = (id: number) => void
type SetFn = (id: number, done: boolean) => void
type MissFn = (id: number, missed: boolean) => void

const MISS_TITLE = "It didn't happen: earns nothing and counts like any miss"

function Result({ i, isNext, minsUntil }: { i: DayItem; isNext: boolean; minsUntil: number | null }) {
  switch (i.status) {
    case 'on_time': return <span className="th-res">on time<span className="pts num">+{pt(i.earned)}</span></span>
    case 'late': return <span className="th-res"><span className="th-pill late num">Late +{pt(i.earned)}</span></span>
    case 'overdue': return <span className="th-res"><span className="th-pill late">Late, <span className="num">+{pt(i.points / 2)}</span> if done now</span></span>
    case 'missed': return <span className="th-res"><span className="th-pill miss">Missed</span></span>
    case 'open': return <span className="th-res"><span className="th-pill next">Open now</span></span>
    case 'anytime': return <span className="th-res">anytime</span>
    case 'upcoming': return <span className="th-res">{isNext && minsUntil != null ? <span className="th-pill next">Next · {duration(minsUntil)}</span> : <span className="num">+{pt(i.points)}</span>}</span>
  }
}

function Row({ i, day, minute, isNext, onSet, onMissed, busy }: { i: DayItem; day: Day; minute: number; isNext: boolean; onSet: SetFn; onMissed: MissFn; busy: boolean }) {
  const done = isDone(i.status)
  const minsUntil = i.start != null ? i.start - minute : null
  const far = i.status === 'upcoming' && minsUntil != null && minsUntil > EARLY_MIN
  const tickable = canTick(i, minute, day.closed)
  const untickable = canUntick(i, day.closed)
  const hint = tickHint(i, minute, day.closed)
  const missable = canMarkMissed(i, day.closed)
  const unmissable = canUnmarkMissed(i, day.closed)
  const why = far && i.start != null ? `Opens at ${hhmm(i.start)}. You can tick it from ${hhmm(i.start - EARLY_MIN)}.` : null
  const past = done || i.status === 'missed' || i.status === 'overdue'
  const cbClass = i.status === 'on_time' ? 'done' : i.status === 'late' ? 'done late' : i.status === 'missed' ? 'miss' : ''

  return (
    <div className={`th-row${past ? ' past' : ''}${far ? ' far' : ''}`}>
      <span className="t num">{i.time ?? '··'}</span>
      {untickable ? (
        <button className={`th-cb ${cbClass}`} disabled={busy} onClick={() => onSet(i.id, false)} title="Untick: mark as not done"
          aria-label={`${i.label}: done ${i.status === 'late' ? 'late' : 'on time'}. Untick, mark it not done`}>
          <Check />
        </button>
      ) : tickable ? (
        <button className="th-cb" disabled={busy} onClick={() => onSet(i.id, true)} title={hint}
          aria-label={i.status === 'overdue' ? `Mark ${i.label} done late` : `Mark ${i.label} done`}>
          <Check />
        </button>
      ) : (
        <span className={`th-cb ${cbClass}`} role="img" title={why ? undefined : hint}
          aria-label={done ? `${i.label}: done` : i.status === 'missed' ? `${i.label}: missed` : `${i.label}. ${hint}`}>
          {done && <Check />}
        </span>
      )}
      <span className="name">{i.label}</span>
      {missable && (
        <button className="th-misslink" disabled={busy} onClick={() => onMissed(i.id, true)} aria-label={`${i.label}: missed, it didn't happen`} title={MISS_TITLE}>Missed</button>
      )}
      {unmissable && (
        <button className="th-misslink back" disabled={busy} onClick={() => onMissed(i.id, false)} aria-label={`${i.label}: not missed after all, back on today's list`} title="Not missed after all: back on today's list">Not missed</button>
      )}
      <Result i={i} isNext={isNext} minsUntil={minsUntil} />
      {why && <span className="th-tip" role="tooltip">{why}</span>}
    </div>
  )
}

/** The highlighted row: the open window, or the latest overdue item when nothing is open. */
function Focus({ i, mode, onTick, onMissed, busy }: { i: DayItem & { minutesLeft?: number }; mode: 'open' | 'overdue'; onTick: TickFn; onMissed: MissFn; busy: boolean }) {
  const span = (i.end ?? 0) - (i.start ?? 0)
  const frac = mode === 'open' && span && i.minutesLeft != null ? Math.min(1, Math.max(0, (span - i.minutesLeft) / span)) : 0
  return (
    <div className={`th-now ${mode}`}>
      <span className="t num">{i.time}</span>
      <button className="th-ringcb" disabled={busy} onClick={() => onTick(i.id)} aria-label={`Mark ${i.label} done`}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <circle cx="9" cy="9" r="8" fill="#fff" stroke={mode === 'open' ? '#BFD5F8' : '#EBCB94'} strokeWidth="1.5" />
          {mode === 'open' && frac > 0 && <circle cx="9" cy="9" r="8" fill="none" stroke="var(--k-blue)" strokeWidth="1.5" pathLength="100" strokeDasharray={`${frac * 100} 100`} transform="rotate(-90 9 9)" strokeLinecap="round" />}
        </svg>
      </button>
      <div className="name">
        <b>{i.label}</b>
        {mode === 'open'
          ? <span>Open until <span className="num">{hhmm(i.end ?? 0)}</span> · {duration(i.minutesLeft ?? 0)} left</span>
          : <span>Was due at <span className="num">{i.time}</span>. Late still counts for half.</span>}
      </div>
      {mode === 'open'
        ? <span className="worth"><b className="num">+{pt(i.points)}</b> on time</span>
        : <span className="worth late"><b className="num">+{pt(i.points / 2)}</b> if done now</span>}
      <button className="th-btn2 miss" disabled={busy} onClick={() => onMissed(i.id, true)} aria-label={`${i.label}: missed, it didn't happen`} title={MISS_TITLE}>Missed</button>
      <button className="th-btn" disabled={busy} onClick={() => onTick(i.id)}>
        <Check size={13} />{mode === 'open' ? 'Done' : 'Done late'}
      </button>
    </div>
  )
}

function DayList({ data, onTick, onSet, onMissed, busy }: { data: TodayView; onTick: TickFn; onSet: SetFn; onMissed: MissFn; busy: boolean }) {
  const nav = useNavigate()
  const openReview = useOpenReview()
  const day = data.day
  const items = day.items

  if (!items.length) {
    return (
      <section className="th-list">
        <div className="th-empty">
          No routine set for today. <button className="th-link" onClick={() => nav('/checklists')}>Add items in Routine</button>
        </div>
      </section>
    )
  }

  const current = !day.closed ? day.current : null
  const overdue = items.filter(i => i.status === 'overdue')
  const focusOverdue = !day.closed && !current && overdue.length ? overdue[overdue.length - 1] : null
  const focusId = current?.id ?? focusOverdue?.id ?? null
  const nextId = day.next?.id ?? null
  const showClose = !day.closed && ((!day.current && !day.next) || overdue.length > 0)

  const groups: { name: string; items: DayItem[] }[] = []
  for (const i of items) {
    const g = partOfDay(i.start)
    const last = groups[groups.length - 1]
    if (last && last.name === g) last.items.push(i)
    else groups.push({ name: g, items: [i] })
  }

  return (
    <section className="th-list" aria-label="Today's routine">
      {groups.map(g => {
        const done = g.items.filter(i => isDone(i.status)).length
        const settled = g.items.filter(i => i.status !== 'upcoming' && i.status !== 'open' && i.status !== 'anytime').length
        const ahead = g.items.length - settled
        const earned = g.items.reduce((s, i) => s + i.earned, 0)
        return (
          <div key={g.name} className="th-group">
            <div className="th-sec">
              <h3 style={{ color: GROUP_COLOR[g.name] }}>{g.name}</h3>
              <span className="meta">{settled ? `${done} of ${g.items.length} done` : `${ahead} ahead`}{settled > 0 && ahead > 0 ? ` · ${ahead} ahead` : ''}</span>
              {earned > 0 && <span className="meta r num">+{pt(earned)} earned</span>}
            </div>
            {g.items.map(i => i.id === focusId
              ? <Focus key={i.id} i={current ?? i} mode={current ? 'open' : 'overdue'} onTick={onTick} onMissed={onMissed} busy={busy} />
              : <Row key={i.id} i={i} day={day} minute={data.minuteOfDay} isNext={i.id === nextId} onSet={onSet} onMissed={onMissed} busy={busy} />)}
          </div>
        )
      })}
      <div className="th-close">
        <span className="num">{day.closed ? 'Day closed' : `${day.closesAt} · day closes`}</span>
        <span className="ln" />
        {showClose && <button className="th-soft" onClick={openReview}>Close the day</button>}
      </div>
    </section>
  )
}

// ─── Money strip ─────────────────────────────────────────────────────────────

function MoneyStrip({ data }: { data: TodayView }) {
  const nav = useNavigate()
  const { pulse } = data
  const accounts = pulse.trading.filter(a => a.trades > 0 || (a.limitLeft != null && a.limitLeft < 1))
  const due = pulse.business?.nextDue
  const daysLate = due ? Math.round((new Date(data.day.date + 'T12:00:00').getTime() - new Date(due.dueDate + 'T12:00:00').getTime()) / 864e5) : 0
  const workoutLeft = data.day.items.some(i => /workout/i.test(i.label) && !isDone(i.status) && i.status !== 'missed')
  const w = pulse.workouts

  return (
    <section className="th-strip" aria-label="Money and training">
      {accounts.map(a => {
        const usedRaw = a.limitUnit === 'R' ? -(a.netR ?? 0) : -a.net
        const used = Math.max(0, usedRaw)
        const total = a.limitLeft != null ? used + a.limitLeft : null
        const pct = total ? Math.min(100, (used / total) * 100) : 0
        const unit = a.limitUnit === 'R' ? 'R' : ''
        return (
          <div key={a.id} className="cell">
            <div className="k">Trading · {a.name}</div>
            <div className="v">
              {a.netR != null
                ? <b className={`num ${a.net < 0 ? 'neg' : a.net > 0 ? 'pos' : ''}`}>{a.netR > 0 ? '+' : ''}{a.netR.toFixed(2)}R</b>
                : <b className="num">{a.trades}</b>}
              <span>today · {a.trades} trade{a.trades === 1 ? '' : 's'}</span>
            </div>
            {a.limitLeft != null && (
              <div className="lim">
                {total ? <span className="track" aria-hidden><i style={{ width: `${pct}%` }} /></span> : null}
                <span className={a.limitLeft < 1 ? 'warn' : 'mute'}><span className="num">{pt(a.limitLeft)}{unit}</span> left before the loss limit</span>
              </div>
            )}
          </div>
        )
      })}
      <div className="cell">
        <div className="k">Business</div>
        {due ? (
          <>
            <div className="v"><span>{due.clientName ?? due.invoiceNumber} owes <b className="num">{money(due.amount)}</b></span></div>
            <div className="lim">
              {daysLate > 0 ? <span className="neg">{daysLate} day{daysLate === 1 ? '' : 's'} overdue</span>
                : <span className="mute">due {fmtDate(due.dueDate, { day: 'numeric', month: 'short' })}</span>}
              <button className="th-chase" onClick={() => nav('/business/invoices')}>Chase</button>
            </div>
          </>
        ) : pulse.business ? (
          <>
            <div className="v"><b className="num">{money(pulse.business.mrr)}</b><span>a month recurring</span></div>
            <div className="lim"><span className="mute">No invoice due</span></div>
          </>
        ) : <div className="v"><span>Nothing to show yet</span></div>}
      </div>
      {w.target > 0 && (
        <div className="cell">
          <div className="k">Workouts this week</div>
          <div className="v"><b className="num">{w.done} of {w.target}</b></div>
          <div className="lim">
            <span className="th-dots" aria-hidden>{Array.from({ length: w.target }, (_, i) => <i key={i} className={i < w.done ? 'f' : ''} />)}</span>
            {workoutLeft && w.done < w.target && <span className="mute">A workout today makes {w.done + 1}</span>}
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Week card ───────────────────────────────────────────────────────────────

/** Rungs sit evenly along the track; the score moves piecewise between them. */
function makePos(week: Week) {
  const stops = [0, ...week.ladder.map(r => r.at)]
  if (stops[stops.length - 1] < week.max) stops.push(week.max)
  const n = stops.length - 1
  return (x: number) => {
    if (n <= 0) return 0
    if (x <= 0) return 0
    for (let s = 0; s < n; s++) {
      const a = stops[s], b = stops[s + 1]
      if (x <= b) return ((s + (b > a ? (x - a) / (b - a) : 1)) / n) * 100
    }
    return 100
  }
}

function Ladder({ week }: { week: Week }) {
  const pos = makePos(week)
  const me = pos(week.score)
  const out = !!week.stakes?.includes('out of reach')
  const lw = week.lastWeek ? pos(week.lastWeek.score) : null
  return (
    <div className="th-ladder" aria-label={`Week score ${pt(week.score)} of ${pt(week.max)}`}>
      <div className="in">
        <div className="track"><i style={{ width: `${me}%` }} /></div>
        {lw != null && (
          <div className={`lw ${lw > 60 ? 'end' : ''}`} style={{ left: `${lw}%` }}>
            <span>last week here: <span className="num">{pt(week.lastWeek!.score)}</span></span>
          </div>
        )}
        {week.ladder.map((r, idx) => {
          const isNext = week.nextReward?.at === r.at
          const cls = r.reached ? 'got' : isNext && out ? 'out' : isNext ? 'next' : ''
          const last = idx === week.ladder.length - 1 && pos(r.at) >= 99
          return (
            <div key={r.at} className={`rung ${cls}${last ? ' end' : ''}`} style={{ left: `${pos(r.at)}%` }}>
              <i>{r.reached && <Check size={8} />}</i>
              <b>{r.reward}</b>
              <small className="num">{pt(r.at)}{cls === 'out' ? ' · out of reach' : ''}</small>
            </div>
          )
        })}
        <div className="me" style={{ left: `${me}%` }}><span className="num">{pt(week.score)}</span><i /></div>
      </div>
    </div>
  )
}

function WeekCard({ week }: { week: TodayView['week'] }) {
  const nav = useNavigate()
  if (!week) {
    return (
      <section className="th-week">
        <div className="top"><h2>This week</h2></div>
        <p className="th-mutep">No weekly goal is set. Set one up in Week and the score starts counting.</p>
        <button className="th-soft" style={{ marginTop: 12 }} onClick={() => nav('/goals')}>Open Week</button>
      </section>
    )
  }
  const out = !!week.stakes?.includes('out of reach')
  return (
    <section className="th-week">
      <div className="top">
        <h2>This week <small>{fmtDate(week.from, { day: 'numeric', month: 'short' })} to {fmtDate(week.to, { day: 'numeric', month: 'short' })}</small></h2>
        <span className="proj"><b className="num">{pt(week.score)}</b> / {pt(week.max)} so far</span>
      </div>
      {week.ladder.length > 0 && <Ladder week={week} />}
      {(week.stakes || week.lastWeek) && (
        <div className={`th-stakes${out ? ' out' : ''}`}>
          {out ? (
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden><path d="M8 2.2l6.2 11H1.8z" fill="var(--k-warn-soft)" stroke="var(--k-warn)" strokeWidth="1.4" strokeLinejoin="round" /><path d="M8 6.6v3" stroke="var(--k-warn)" strokeWidth="1.5" strokeLinecap="round" /><circle cx="8" cy="11.3" r=".8" fill="var(--k-warn)" /></svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--k-ink2)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3.5 14V2.5M3.5 3h8.5l-2 3 2 3H3.5" /></svg>
          )}
          <span>
            {out && week.nextReward ? <b>{week.nextReward.reward} is out of reach. </b> : null}
            {week.stakes && !out ? week.stakes : null}
            {week.lastWeek && <> Last week you scored <span className="num">{pt(week.lastWeek.score)}</span>{week.lastWeek.reward ? ` and earned ${week.lastWeek.reward}` : ''}.</>}
          </span>
        </div>
      )}
      {week.tasks.length > 0 && (
        <div className="th-tasks">
          {week.tasks.map(t => {
            const full = t.earned >= t.max
            const warn = !!t.note && /break|review/.test(t.note) && !full
            return (
              <div key={t.id} className="th-task">
                <span className="nm" title={t.title}>{t.title}{t.note && <small className={warn ? 'w' : ''}>{t.source !== 'manual' ? `auto · ${t.note}` : t.note}</small>}</span>
                <span className="bar" aria-hidden><i style={{ width: `${Math.min(100, (t.earned / t.max) * 100)}%`, background: full ? 'var(--k-good)' : undefined }} /></span>
                <span className="p num">{pt(t.earned)}<span>/{pt(t.max)}</span></span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Coach({ week }: { week: TodayView['week'] }) {
  if (!week?.coach) return null
  const text = week.coach.replace(/^Biggest lever:\s*/, '')
  const [first, ...rest] = text.split(/(?<=\.)\s+/)
  return (
    <aside className="th-note">
      <div className="who">
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden><path d="M7 1.5v1.6M2.6 3.3l1.1 1.1M11.4 3.3l-1.1 1.1M5 11.2h4M5.6 12.8h2.8" stroke="#B48A12" strokeWidth="1.4" strokeLinecap="round" /><path d="M4.4 8.2a3 3 0 1 1 5.2 0c-.5.6-.9 1.1-.9 1.8H5.3c0-.7-.4-1.2-.9-1.8z" fill="#FBE7A1" stroke="#B48A12" strokeWidth="1.3" strokeLinejoin="round" /></svg>
        The one thing this week
      </div>
      {first}{rest.length > 0 && <> <b>{rest.join(' ')}</b></>}
    </aside>
  )
}

// ─── Earned lately ───────────────────────────────────────────────────────────

const SPARK: Record<string, string> = { business: '#F5B90A', training: '#8FB8F8', week: '#E8A9C9' }

function Wins({ wins }: { wins: TodayView['wins'] }) {
  return (
    <section className="th-wins" aria-label="Earned lately">
      <div className="lh">Earned lately
        <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden><path d="M6 1.5l1 3.2 3.2 1-3.2 1L6 10l-1-3.3-3.2-1 3.2-1z" fill="#F5B90A" /><path d="M13.5 7l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6z" fill="#8FB8F8" /><circle cx="12.5" cy="2.5" r="1.1" fill="#E8A9C9" /><circle cx="3" cy="13" r=".9" fill="#9AD3B0" /></svg>
      </div>
      {wins.length === 0
        ? <p className="th-mutep">Nothing new this week yet. Records, best weeks and all-time highs show up here when you earn them.</p>
        : wins.map((w, i) => (
          <div key={i} className="th-win">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M6 .8l1.2 4 4 1.2-4 1.2L6 11.2 4.8 7.2.8 6l4-1.2z" fill={SPARK[w.kind] ?? '#F5B90A'} /></svg>
            <span>{w.title}: <b className="num">{w.detail}</b></span>
          </div>
        ))}
    </section>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function ThingsToday() {
  const { data, isPending } = useToday()
  const tick = useTick()
  const missM = useMarkMissed()
  const [toast, setToast] = useState<{ text: string; bad?: boolean; undo?: () => void } | null>(null)
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (isPending || !data) return <PageLoader />

  const flash = (text: string, bad = false, undo?: () => void) => {
    if (hide.current) clearTimeout(hide.current)
    setToast({ text, bad, undo }); hide.current = setTimeout(() => setToast(null), bad ? 3600 : undo ? 4000 : 2600)
  }
  /** Ticks or unticks an item; every tick can be undone from the toast. */
  const setDone: SetFn = (id, done) => tick.mutate({ id, done }, {
    onSuccess: v => {
      const it = v.day.items.find(i => i.id === id)
      if (!it) return
      if (done && isDone(it.status)) flash(`${it.label}: ${it.status === 'on_time' ? 'on time' : 'late'}, +${pt(it.earned)}`, false, () => setDone(id, false))
      else if (!done) flash(`${it.label}: unticked`)
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      flash(msg ?? 'Could not save that.', true)
    },
  })
  const onTick: TickFn = id => setDone(id, true)
  /** Marks an item missed or takes it back; a miss can be undone from the toast. It never earns. */
  const setMissed: MissFn = (id, missed) => missM.mutate({ id, missed }, {
    onSuccess: v => {
      const it = v.day.items.find(i => i.id === id)
      if (!it) return
      if (missed) flash(`${it.label}: marked missed`, true, () => setMissed(id, false))
      else flash(`${it.label}: back on today's list`)
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      flash(msg ?? 'Could not save that.', true)
    },
  })

  const left = data.day.closed ? 0 : data.day.items.filter(i => !isDone(i.status) && i.status !== 'missed').length

  return (
    <div className="th-page skin-enter">
      <div className="th-grid">
        <Head day={data.day} left={left} />
        <div className="th-left">
          <DayList data={data} onTick={onTick} onSet={setDone} onMissed={setMissed} busy={tick.isPending || missM.isPending} />
          <MoneyStrip data={data} />
        </div>
        <div className="th-right">
          <WeekCard week={data.week} />
          <Coach week={data.week} />
          <Wins wins={data.wins} />
        </div>
      </div>
      {toast && (
        <div className={`th th-toast${toast.bad ? ' bad' : ''}`} role="status">
          {toast.text}
          {toast.undo && <button className="th-undo" onClick={() => { toast.undo!(); setToast(null) }}>Undo</button>}
        </div>
      )}
    </div>
  )
}
