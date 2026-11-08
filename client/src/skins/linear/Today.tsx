import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { canMarkMissed, canTick, canUnmarkMissed, canUntick, isDone, tickHint, useMarkMissed, useTick, useToday, type DayItem, type TodayView } from '../../core/today'
import { useOpenReview } from '../core'
import { PageLoader } from '../../components/ui/Spinner'
import { hm } from './Shell'

type Day = TodayView['day']
type Week = NonNullable<TodayView['week']>

const pt = (n: number) => String(Math.round(n * 100) / 100)
const signed = (n: number) => (n > 0 ? `+${pt(n)}` : n < 0 ? `−${pt(-n)}` : '0')
const clock = (m: number | null) => {
  if (m == null) return ''
  const x = ((m % 1440) + 1440) % 1440
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`
}
const iso = (s: string) => new Date(s + 'T12:00:00')
const fmtDay = (s: string) => iso(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const money = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n)

function range(a: string, b: string) {
  const x = iso(a), y = iso(b)
  return x.getMonth() === y.getMonth() ? `${x.getDate()} – ${fmtDay(b)}` : `${fmtDay(a)} – ${fmtDay(b)}`
}

function isoWeek(s: string) {
  const d = iso(s)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const w1 = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d.getTime() - w1.getTime()) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7)
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t) }, [])
  return now
}

// ─── Status glyphs ───────────────────────────────────────────────────────────

type GlyphKind = 'on_time' | 'late' | 'missed' | 'overdue' | 'open' | 'upcoming' | 'anytime' | 'done' | 'reached' | 'risk' | 'muted'

function Glyph({ kind, size = 14 }: { kind: GlyphKind; size?: number }) {
  const ring = (c: string, dash?: string) => <circle cx="7" cy="7" r="5.4" fill="none" stroke={c} strokeWidth="1.3" strokeDasharray={dash} />
  const inner = (() => {
    switch (kind) {
      case 'on_time': case 'reached': case 'done':
        return <><circle cx="7" cy="7" r="6" fill={kind === 'done' ? 'var(--k-t3)' : 'var(--k-good)'} /><path d="m4.4 7.1 1.8 1.8 3.4-3.6" fill="none" stroke="#0C0D0F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></>
      case 'late':
        return <>{ring('var(--k-warn)')}<path d="M7 4.3V7l1.9 1.2" fill="none" stroke="var(--k-warn)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></>
      case 'missed':
        return <><circle cx="7" cy="7" r="6" fill="var(--k-bad)" /><path d="m4.9 4.9 4.2 4.2M9.1 4.9 4.9 9.1" stroke="#0C0D0F" strokeWidth="1.5" strokeLinecap="round" /></>
      case 'overdue':
        return <>{ring('var(--k-warn)', '2.2 1.8')}<path d="M7 4.4v3.1" stroke="var(--k-warn)" strokeWidth="1.4" strokeLinecap="round" /><circle cx="7" cy="9.6" r=".8" fill="var(--k-warn)" /></>
      case 'open':
        return <>{ring('var(--k-acc2)')}<path d="M7 3.6a3.4 3.4 0 0 1 0 6.8z" fill="var(--k-acc2)" /></>
      case 'upcoming': return ring('var(--k-t3)')
      case 'risk': return <>{ring('var(--k-warn)')}<path d="M7 4.3V7l1.9 1.2" fill="none" stroke="var(--k-warn)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></>
      case 'anytime': case 'muted': return ring('var(--k-t4)', '2 2')
    }
  })()
  return <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>{inner}</svg>
}

// ─── Score ───────────────────────────────────────────────────────────────────

function Score({ day }: { day: Day }) {
  const score = day.score ?? 0
  const timed = day.items.filter(i => i.start != null)
  const closedN = timed.filter(i => ['on_time', 'late', 'missed', 'overdue'].includes(i.status)).length
  const diff = day.ghost.diff
  const ghostShort = iso(day.ghost.date).toLocaleDateString('en-GB', { weekday: 'short' })
  const ghostLong = iso(day.ghost.date).toLocaleDateString('en-GB', { weekday: 'long' })

  // Marker labels over the track; one that would collide with a shown label keeps its tick but drops the text.
  const marks: { v: number; label: React.ReactNode; title: string; cls: string }[] = [
    { v: score, label: <span className="me">{day.score ?? 0}</span>, title: `You: ${score}`, cls: 'me' },
  ]
  if (day.ghost.score != null) marks.push({ v: day.ghost.score, label: <><b>{day.ghost.score}</b> {ghostShort}</>, title: `${day.ghost.label} at this hour: ${day.ghost.score}`, cls: '' })
  if (day.bestThisMonth) marks.push({ v: day.bestThisMonth.score, label: <><b>{day.bestThisMonth.score}</b> Best</>, title: `Best this month: ${day.bestThisMonth.score} on ${fmtDay(day.bestThisMonth.date)}`, cls: 'best' })
  const shown: number[] = []
  const withLabel = marks.map(m => {
    const ok = shown.every(v => Math.abs(v - m.v) >= 10)
    if (ok) shown.push(m.v)
    return { ...m, show: ok }
  })
  const pos = (v: number) => (v <= 3 ? { left: `${v}%`, transform: 'none' } : v >= 97 ? { left: `${v}%`, transform: 'translateX(-100%)' } : { left: `${v}%` })

  const [first, ...rest] = day.coach.split(/(?<=\.)\s+/)

  return (
    <section className="ln-score">
      <div>
        <div className="ln-lbl">Day score</div>
        <div className="fig"><span className="ln-big num">{day.score ?? '–'}</span><span className="of num">/ 100</span></div>
        {diff != null && !day.closed && (
          <div className="ln-delta num" style={diff < 0 ? undefined : diff > 0 ? { color: 'var(--k-good)', background: 'rgba(76,183,130,.1)' } : { color: 'var(--k-t2)', background: 'var(--k-s2)' }}>
            {diff === 0 ? `Level with ${ghostLong}` : `${signed(diff)} vs ${ghostLong}`}
          </div>
        )}
        {day.closed && <div className="ln-delta num" style={{ color: 'var(--k-t2)', background: 'var(--k-s2)' }}>Final</div>}
      </div>
      <div className="ln-barwrap">
        <div className="meta num"><span>Earned in window only · late is half · missed is zero</span><span><b>{closedN} of {timed.length}</b> windows closed</span></div>
        <div className="ln-track" role="img" aria-label={`Day score ${score} of 100`}>
          <div className="fill" style={{ width: `${Math.min(100, score)}%` }} />
          {withLabel.filter(m => m.cls !== 'me').map(m => <div key={m.title} className={`gh ${m.cls}`} style={{ left: `${m.v}%` }} title={m.title} />)}
          {withLabel.map(m => m.show && <div key={`l${m.title}`} className="gl num" style={pos(m.v)} title={m.title}>{m.label}</div>)}
        </div>
        <div className="ln-ticks num" aria-hidden>
          <span style={{ left: 0, transform: 'none' }}>0</span><span style={{ left: '25%' }}>25</span><span style={{ left: '50%' }}>50</span><span style={{ left: '75%' }}>75</span><span style={{ right: 0, transform: 'none' }}>100</span>
        </div>
        <div className="ln-coachday">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M7 2.2v5.6M7 2.2 4.8 4.4M7 2.2l2.2 2.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M2.6 9.6h8.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity=".5" /><path d="M4.2 12h5.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity=".3" /></svg>
          <span>{first}{rest.length > 0 && <> <em>{rest.join(' ')}</em></>}</span>
        </div>
      </div>
    </section>
  )
}

// ─── Now ─────────────────────────────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) { return <kbd className="ln-kbd">{children}</kbd> }

function Now({ day, target, onTick, onMissed, busy }: { day: Day; target: DayItem | null; onTick: (id: number) => void; onMissed: (id: number) => void; busy: boolean }) {
  const openReview = useOpenReview()
  const next = day.next
  const nextRow = next && (
    <div className="nx num">
      <Glyph kind="upcoming" />
      <span>Next</span><b>{next.label}</b><span>{next.time}</span>
      <span className="r">in {hm(next.minutesUntil)}</span>
    </div>
  )

  if (day.closed) {
    return (
      <section className="ln-now quiet">
        <div className="hd">
          <Glyph kind="done" size={18} />
          <div className="tt"><div className="l1"><b>Day closed</b></div><div className="l2 num">Final score <b>{day.score ?? 0}</b>. Tomorrow starts at 04:00.</div></div>
        </div>
      </section>
    )
  }

  const c = day.current
  if (c) {
    const span = (c.end ?? 0) - (c.start ?? 0)
    const pct = span ? Math.min(100, Math.max(0, ((span - c.minutesLeft) / span) * 100)) : 0
    return (
      <section className="ln-now" aria-label="Current window">
        <div className="hd">
          <Glyph kind="open" size={18} />
          <div className="tt">
            <div className="l1"><b>{c.label}</b><span className="ln-tag acc">Now</span></div>
            <div className="l2 num">Open {clock(c.start)} – {clock(c.end)} · <b>{hm(c.minutesLeft)} left</b></div>
          </div>
          <div className="worth"><div className="v num">+{pt(c.points)}</div><div className="s">on time</div></div>
          <button className="ln-btn2 miss" disabled={busy} onClick={() => onMissed(c.id)} aria-label={`${c.label}: missed, it didn't happen`} title="It didn't happen: earns nothing and counts like any miss">Missed<Kbd>M</Kbd></button>
          <button className="ln-btn" disabled={busy} onClick={() => onTick(c.id)}>Done<Kbd>D</Kbd></button>
        </div>
        <div className="win"><i style={{ width: `${pct}%` }} /></div>
        <div className="winl num"><span>{clock(c.start)}</span><span>Half credit after {clock(c.end)}</span></div>
        {nextRow}
      </section>
    )
  }

  if (target && target.status === 'overdue') {
    const overdueN = day.items.filter(i => i.status === 'overdue').length
    return (
      <section className="ln-now warn" aria-label="Past its window">
        <div className="hd">
          <Glyph kind="overdue" size={18} />
          <div className="tt">
            <div className="l1"><b>{target.label}</b><span className="ln-tag warn">Past window</span></div>
            <div className="l2 num">Was due {clock(target.start)} – {clock(target.end)} · late still counts for half{overdueN > 1 ? ` · ${overdueN - 1} more past their window` : ''}</div>
          </div>
          <div className="worth"><div className="v num" style={{ color: 'var(--k-warn)' }}>+{pt(target.points / 2)}</div><div className="s">if done now</div></div>
          {!next && <button className="ln-btn2" onClick={openReview}>Close the day<Kbd>R</Kbd></button>}
          <button className="ln-btn2 miss" disabled={busy} onClick={() => onMissed(target.id)} aria-label={`${target.label}: missed, it didn't happen`} title="It didn't happen: earns nothing and counts like any miss">Missed<Kbd>M</Kbd></button>
          <button className="ln-btn" disabled={busy} onClick={() => onTick(target.id)}>Done late<Kbd>D</Kbd></button>
        </div>
        {nextRow}
      </section>
    )
  }

  return (
    <section className="ln-now quiet">
      <div className="hd">
        <Glyph kind={next ? 'upcoming' : 'done'} size={18} />
        <div className="tt">
          {next ? (
            <>
              <div className="l1"><b>{next.label}</b><span className="ln-tag">Between windows</span></div>
              <div className="l2 num">Opens at {next.time} · <b>in {hm(next.minutesUntil)}</b></div>
            </>
          ) : (
            <>
              <div className="l1"><b>All windows are behind you</b></div>
              <div className="l2">Give each miss a reason and lock the score.</div>
            </>
          )}
        </div>
        {next ? <div className="worth"><div className="v num">+{pt(next.points)}</div><div className="s">on time</div></div>
          : <button className="ln-btn" onClick={openReview}>Close the day<Kbd>R</Kbd></button>}
      </div>
    </section>
  )
}

// ─── Day list ────────────────────────────────────────────────────────────────

function Row({ i, day, minute, firstAhead, onSet, onMissed, busy }: { i: DayItem; day: Day; minute: number; firstAhead: boolean; onSet: (id: number, done: boolean) => void; onMissed: (id: number, missed: boolean) => void; busy: boolean }) {
  const until = i.start != null ? i.start - minute : null
  let st: React.ReactNode = null, p: React.ReactNode = null, cls = ''
  switch (i.status) {
    case 'on_time': st = 'On time'; p = <span className="g">+{pt(i.earned)}</span>; cls = 'past'; break
    case 'late': st = <span className="a">Late · half credit</span>; p = <span className="a">+{pt(i.earned)}</span>; cls = 'past'; break
    case 'missed': st = <span className="r_">Missed{i.reason ? ` · ${i.reason}` : ''}</span>; p = <span className="r_">0</span>; cls = 'past'; break
    case 'overdue': st = <span className="a">Past window</span>; p = <span className="a dim">+{pt(i.points / 2)}</span>; cls = 'past'; break
    case 'open': {
      const left = day.current?.id === i.id ? day.current.minutesLeft : null
      st = <span style={{ color: 'var(--k-acc2)' }}>Now{left != null ? ` · ${hm(left)} left` : ''}</span>; p = <span className="t3">+{pt(i.points)}</span>; cls = 'sel'; break
    }
    case 'upcoming': st = until != null && until > 0 ? `in ${hm(until)}` : firstAhead ? 'Next' : ''; p = <span className="d">+{pt(i.points)}</span>; break
    case 'anytime': st = 'Anytime'; p = <span className="d">+{pt(i.points)}</span>; break
  }
  const undo = canUntick(i, day.closed)
  const able = canTick(i, minute, day.closed)
  const late = i.status === 'overdue'
  const miss = canMarkMissed(i, day.closed)
  const unmiss = canUnmarkMissed(i, day.closed)
  return (
    <li className={`ln-row ${cls}`} title={!undo && !able && !day.closed && !isDone(i.status) && i.status !== 'missed' ? tickHint(i, minute, day.closed) : undefined}>
      <Glyph kind={i.status} />
      <span className="t">{i.time ?? '··'}</span>
      <span className="n2" title={i.label}>{i.label}</span>
      <span className="st">
        {(undo || able || miss || unmiss) && (
          <span className="ln-rowacts">
            {undo && (
              <button className="ln-rowbtn undo" disabled={busy} onClick={() => onSet(i.id, false)} aria-label={`${i.label}: untick, mark as not done`} title="Untick: mark as not done">
                Undo
              </button>
            )}
            {unmiss && (
              <button className="ln-rowbtn undo" disabled={busy} onClick={() => onMissed(i.id, false)} aria-label={`${i.label}: not missed after all`} title="Not missed after all: back on today's list">
                Not missed
              </button>
            )}
            {miss && (
              <button className="ln-rowbtn miss" disabled={busy} onClick={() => onMissed(i.id, true)} aria-label={`${i.label}: missed, it didn't happen`} title="It didn't happen: earns nothing and counts like any miss">
                Missed
              </button>
            )}
            {able && (
              <button className="ln-rowbtn" disabled={busy} onClick={() => onSet(i.id, true)} aria-label={`${i.label}: ${late ? 'done late' : 'done'}`} title={tickHint(i, minute, day.closed)}>
                {late ? 'Done late' : 'Done'}
              </button>
            )}
          </span>
        )}
        <span className="stx">{st}</span>
      </span>
      <span className="p">{p}</span>
    </li>
  )
}

function Group({ title, glyph, n, right, children, collapsible }: { title: string; glyph: React.ReactNode; n: number; right: React.ReactNode; children: React.ReactNode; collapsible?: boolean }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="ln-group">
      <button className="ln-gh" onClick={() => collapsible && setOpen(o => !o)} aria-expanded={open} disabled={!collapsible}>
        {glyph}{title}<span className="n num">{n}</span><span className="r num">{right}</span>
      </button>
      {open && <ul>{children}</ul>}
    </div>
  )
}

function DayList({ day, minute, onSet, onMissed, busy }: { day: Day; minute: number; onSet: (id: number, done: boolean) => void; onMissed: (id: number, missed: boolean) => void; busy: boolean }) {
  const nav = useNavigate()
  const items = day.items
  if (!items.length) {
    return (
      <div className="ln-empty">
        No routine set for today. <button className="ln-link" onClick={() => nav('/checklists')}>Add items in Routine</button>
      </div>
    )
  }
  const earlier = items.filter(i => ['on_time', 'late', 'missed', 'overdue'].includes(i.status))
  const ahead = items.filter(i => i.status === 'open' || i.status === 'upcoming')
  const anytime = items.filter(i => i.status === 'anytime')
  const c = (s: string) => earlier.filter(i => i.status === s).length
  const summary = [
    c('on_time') && `${c('on_time')} on time`, c('late') && `${c('late')} late`,
    c('overdue') && `${c('overdue')} past window`, c('missed') && `${c('missed')} missed`,
  ].filter(Boolean).join(' · ')
  const doneShare = earlier.length ? (c('on_time') + c('late')) / earlier.length : 0
  const firstAheadId = ahead.find(i => i.status === 'upcoming')?.id

  return (
    <div className="ln-list num">
      {earlier.length > 0 && (
        <Group title="Earlier" n={earlier.length} right={summary} collapsible
          glyph={<Glyph kind={doneShare >= .5 ? 'on_time' : c('overdue') ? 'overdue' : 'missed'} />}>
          {earlier.map(i => <Row key={i.id} i={i} day={day} minute={minute} firstAhead={false} onSet={onSet} onMissed={onMissed} busy={busy} />)}
        </Group>
      )}
      {ahead.length > 0 && (
        <Group title="Ahead" n={ahead.length} right={`until ${day.closesAt}`} glyph={<Glyph kind="open" />}>
          {ahead.map(i => <Row key={i.id} i={i} day={day} minute={minute} firstAhead={i.id === firstAheadId} onSet={onSet} onMissed={onMissed} busy={busy} />)}
        </Group>
      )}
      {anytime.length > 0 && (
        <Group title="Anytime" n={anytime.length} right="no window" glyph={<Glyph kind="anytime" />}>
          {anytime.map(i => <Row key={i.id} i={i} day={day} minute={minute} firstAhead={false} onSet={onSet} onMissed={onMissed} busy={busy} />)}
        </Group>
      )}
    </div>
  )
}

// ─── Week panel ──────────────────────────────────────────────────────────────

function WeekTrack({ week }: { week: Week }) {
  const segs = Math.max(1, Math.min(24, Math.round(week.max)))
  const unit = week.max / segs
  const pct = (v: number) => Math.min(100, Math.max(0, (v / week.max) * 100))
  const out = !!week.stakes?.includes('out of reach')
  const rungAt = new Set(week.ladder.map(r => Math.round(r.at / unit)))
  const tickVals = Array.from(new Set([0, ...week.ladder.map(r => r.at), week.max]))
  const lw = week.lastWeek
  return (
    <div className="ln-wtrack">
      {lw && <div className="lwl num" style={pct(lw.score) >= 88 ? { right: `${100 - pct(lw.score)}%` } : { left: `${pct(lw.score)}%`, transform: 'translateX(-50%)' }}>{pt(lw.score)} last wk</div>}
      <div className="ln-seg" style={{ gridTemplateColumns: `repeat(${segs}, minmax(0, 1fr))` }} role="img" aria-label={`Week score ${pt(week.score)} of ${pt(week.max)}`}>
        {Array.from({ length: segs }, (_, k) => {
          const lo = k * unit, f = Math.min(1, Math.max(0, (week.score - lo) / unit))
          const isRung = rungAt.has(k + 1)
          const risk = out && week.nextReward && Math.round(week.nextReward.at / unit) === k + 1
          return <i key={k} className={f >= 1 ? 'f' : risk ? 'risk' : isRung ? 'rw' : ''}>{f > 0 && f < 1 && <b style={{ width: `${f * 100}%` }} />}</i>
        })}
        {lw && <div className="gm" style={{ left: `${pct(lw.score)}%` }} title={`Last week: ${pt(lw.score)}`} />}
      </div>
      <div className="ln-ticks num" aria-hidden>
        {tickVals.map(v => {
          const p = pct(v)
          return <span key={v} style={p === 0 ? { left: 0, transform: 'none' } : p === 100 ? { right: 0, transform: 'none' } : { left: `${p}%` }}>{pt(v)}</span>
        })}
      </div>
    </div>
  )
}

function WeekPanel({ week }: { week: TodayView['week'] }) {
  const nav = useNavigate()
  if (!week) {
    return (
      <section className="ln-sect">
        <div className="ln-ph"><span className="h">This week</span></div>
        <p className="ln-mut" style={{ marginTop: 10 }}>No weekly goal is set. Set one up in Week and the score starts counting.</p>
        <button className="ln-chip" style={{ marginTop: 12 }} onClick={() => nav('/goals')}>Open Week<Kbd>W</Kbd></button>
      </section>
    )
  }
  const out = !!week.stakes?.includes('out of reach')
  return (
    <section className="ln-sect">
      <div className="ln-ph"><span className="h">This week</span><span className="m num">Week {isoWeek(week.from)} · {range(week.from, week.to)}</span></div>
      <div className="ln-wk num">
        <span className="ln-big">{pt(week.score)}</span><span className="of">/ {pt(week.max)}</span>
        {week.lastWeek && <div className="last">Last week <b>{pt(week.lastWeek.score)}</b>{week.lastWeek.reward && <><br />earned {week.lastWeek.reward}</>}</div>}
      </div>
      <WeekTrack week={week} />
      <ul className="ln-ladder num">
        {week.ladder.map(r => {
          const isNext = week.nextReward?.at === r.at
          const risk = isNext && out
          const togo = r.at - week.score
          return (
            <li key={r.at} className="lr">
              <Glyph kind={r.reached ? 'reached' : risk ? 'risk' : isNext ? 'open' : 'upcoming'} />
              <span className="nm">{r.reward}</span>
              <span className={`to ${r.reached ? 'g' : risk ? 'a' : ''}`}>
                {r.reached ? 'Earned' : risk ? `Out of reach · ${pt(togo)} to go` : `${pt(togo)} to go`}
                {!r.reached && week.lastWeek?.reward === r.reward && !risk ? ' · earned last week' : ''}
              </span>
              <span className="th">{pt(r.at)}</span>
            </li>
          )
        })}
      </ul>
      {week.stakes && (
        <div className={`ln-stakes ${out ? 'warn' : ''}`}>
          {out
            ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M7 1.8 12.6 11.6H1.4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M7 5.6v2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><circle cx="7" cy="10" r=".75" fill="currentColor" /></svg>
            : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><circle cx="7" cy="7" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.3" /><circle cx="7" cy="7" r="2.2" fill="currentColor" /></svg>}
          <span>{out && week.nextReward ? <><b>{week.nextReward.reward} is out of reach.</b> </> : null}{week.stakes}</span>
        </div>
      )}
      <ul className="ln-tasks num">
        {week.tasks.map(t => {
          const f = t.max ? t.earned / t.max : 0
          const bad = !!t.note && /break|review/.test(t.note) && t.earned < t.max
          const note = t.source !== 'manual' ? (t.note ? `auto · ${t.note}` : 'auto') : t.note
          return (
            <li key={t.id} className="tk">
              <span className="nm" title={`${t.title}${note ? ` (${note})` : ''}`}>{t.title}{note && <span className={bad ? 'r_' : ''}>{note}</span>}</span>
              <div className="ln-mini"><i style={{ width: `${f * 100}%`, background: f >= 1 ? 'var(--k-good)' : undefined }} /></div>
              <span className="v">{pt(t.earned)}<span>/{pt(t.max)}</span></span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Coach({ week, day }: { week: TodayView['week']; day: Day }) {
  const text = week?.coach ?? null
  if (!text) return null
  const [first, ...rest] = text.split(/(?<=\.)\s+/)
  return (
    <section className="ln-sect ln-inbox" aria-label="Coach">
      <div className="ic"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M6 1.2 7.2 4.8 10.8 6 7.2 7.2 6 10.8 4.8 7.2 1.2 6 4.8 4.8z" fill="currentColor" /></svg></div>
      <div>
        <div className="l1"><b>Coach</b><span>· The one thing this week</span>{!day.closed && <span className="dot" aria-hidden />}</div>
        <p>{first}{rest.length > 0 && <> <em>{rest.join(' ')}</em></>}</p>
      </div>
    </section>
  )
}

function Earned({ wins }: { wins: TodayView['wins'] }) {
  return (
    <section className="ln-sect">
      <div className="ln-ph"><span className="h">Earned</span><span className="m">{wins.length ? `${wins.length} this week` : 'none yet'}</span></div>
      {wins.length ? (
        <ul className="ln-wins num">
          {wins.map((w, i) => (
            <li key={i} className="wn">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M6 1 7 5 11 6 7 7 6 11 5 7 1 6 5 5z" fill="currentColor" /></svg>
              <span>{w.title}{w.detail && <>: <em>{w.detail}</em></>}</span>
            </li>
          ))}
        </ul>
      ) : <p className="ln-mut" style={{ marginTop: 8 }}>No new bests this week yet. Records, best weeks and all-time highs show up here when you earn them.</p>}
    </section>
  )
}

function Pulse({ pulse }: { pulse: TodayView['pulse'] }) {
  const nav = useNavigate()
  const due = pulse.business?.nextDue
  const todayIso = new Date().toISOString().slice(0, 10)
  const daysLate = due ? Math.round((iso(todayIso).getTime() - iso(due.dueDate).getTime()) / 864e5) : 0
  return (
    <section className="ln-sect">
      <div className="ln-ph"><span className="h">Pulse</span></div>
      <ul className="ln-money num">
        {pulse.trading.map(a => (
          <li key={a.id} className="mr">
            <span className="nm">{a.name}<span>{a.trades} trade{a.trades === 1 ? '' : 's'} today</span></span>
            <span className="v">
              {a.limitLeft != null && a.limitLeft < 1 && <span className="a" style={{ fontWeight: 400, fontSize: 12 }}>{pt(a.limitLeft)}{a.limitUnit === 'R' ? 'R' : ' $'} to loss limit</span>}
              {a.netR != null && a.trades > 0 && <span className={a.net < 0 ? 'r_' : a.net > 0 ? 'g' : ''}>{a.netR > 0 ? '+' : a.netR < 0 ? '−' : ''}{Math.abs(a.netR).toFixed(2)}R</span>}
            </span>
          </li>
        ))}
        {due && (
          <li className="mr">
            <span className="nm">{due.clientName ?? due.invoiceNumber} owes<span style={{ color: 'var(--k-t1)', fontSize: 13 }}>{money(due.amount)}</span>{daysLate > 0 && <span className="r_">{daysLate} day{daysLate === 1 ? '' : 's'} overdue</span>}</span>
            <span className="v"><button className="ln-chip" onClick={() => nav('/business/invoices')}>Chase</button></span>
          </li>
        )}
        <li className="mr">
          <span className="nm">Workouts this week<span>{pulse.workouts.done} of {pulse.workouts.target}</span></span>
          <span className="v"><span className="ln-pips" aria-hidden>{Array.from({ length: pulse.workouts.target }, (_, i) => <i key={i} className={i < pulse.workouts.done ? 'f' : ''} />)}</span></span>
        </li>
      </ul>
    </section>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function LinearToday() {
  const { data, isPending } = useToday()
  const tick = useTick()
  const missM = useMarkMissed()
  const nav = useNavigate()
  const openReview = useOpenReview()
  const [params] = useSearchParams()
  const now = useClock()
  const [toast, setToast] = useState<{ text: string; bad?: boolean; undo?: () => void } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const show = (text: string, bad = false, ms = 2600, undo?: () => void) => {
    setToast({ text, bad, undo }); window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), ms)
  }
  /** Ticks or unticks an item; every tick can be undone from the toast. */
  const setDone = (id: number, done: boolean) => tick.mutate({ id, done }, {
    onSuccess: v => {
      const it = v.day.items.find(i => i.id === id)
      if (!it) return
      if (done && isDone(it.status)) show(`${it.label}: ${it.status === 'on_time' ? 'on time' : 'late'}, +${pt(it.earned)}`, false, 4000, () => setDone(id, false))
      else if (!done) show(`${it.label}: unticked`)
    },
    onError: (e: any) => show(e?.response?.data?.error ?? 'Could not save that.', true, 3400),
  })
  const onTick = (id: number) => setDone(id, true)
  /** Marks an item missed or takes it back; a miss can be undone from the toast. It never earns. */
  const setMissed = (id: number, missed: boolean) => missM.mutate({ id, missed }, {
    onSuccess: v => {
      const it = v.day.items.find(i => i.id === id)
      if (!it) return
      if (missed) show(`${it.label}: marked missed`, true, 4000, () => setMissed(id, false))
      else show(`${it.label}: back on today's list`)
    },
    onError: (e: any) => show(e?.response?.data?.error ?? 'Could not save that.', true, 3400),
  })
  const onMissed = (id: number) => setMissed(id, true)
  const busy = tick.isPending || missM.isPending

  const day = data?.day
  // D and M act on the open window first, then the earliest item past its window.
  const target = !day || day.closed ? null : day.current ?? [...day.items].reverse().find(i => i.status === 'overdue') ?? null

  // Keyboard: D done, M missed, R review, W week. Ignored while typing or with a sheet open.
  const latest = useRef({ target, onTick, onMissed, busy, openReview, nav, reviewOpen: params.get('review') === '1' })
  latest.current = { target, onTick, onMissed, busy, openReview, nav, reviewOpen: params.get('review') === '1' }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (document.querySelector('[role="dialog"]')) return
      const l = latest.current
      if (l.reviewOpen) return
      const k = e.key.toLowerCase()
      if (k === 'd' && l.target && !l.busy) { e.preventDefault(); l.onTick(l.target.id) }
      else if (k === 'm' && l.target && !l.busy) { e.preventDefault(); l.onMissed(l.target.id) }
      else if (k === 'r') { e.preventDefault(); l.openReview() }
      else if (k === 'w') { e.preventDefault(); l.nav('/goals') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (isPending || !data || !day) return <PageLoader />

  // Minutes-from-midnight on the day's own clock, kept fresh between refetches.
  const drift = Math.max(0, Math.floor((now.getTime() - new Date(data.generatedAt).getTime()) / 60000))
  const overdueN = day.items.filter(i => i.status === 'overdue').length

  return (
    <div className="ln-today skin-enter">
      <header className="ln-top">
        <h1>Today</h1>
        <div className="crumb num"><i />{iso(day.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}<span style={{ color: 'var(--k-t4)' }}>·</span>{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
        <div className="ln-hints" aria-label="Keyboard shortcuts">
          {target && <button onClick={() => onTick(target.id)} disabled={busy} title={target.status === 'overdue' ? `Done late: ${target.label}` : `Done: ${target.label}`}><Kbd>D</Kbd>{target.status === 'overdue' ? 'Done late' : 'Done'}</button>}
          {target && <button onClick={() => onMissed(target.id)} disabled={busy} title={`Missed: ${target.label}. Earns nothing and counts like any miss`}><Kbd>M</Kbd>Missed</button>}
          <button onClick={openReview} title={day.closed ? 'See the closed day' : 'Close the day'} className={!day.closed && (!day.next && !day.current || overdueN > 0) ? 'hot' : ''}><Kbd>R</Kbd>{day.closed ? 'Review' : 'Close the day'}</button>
          <button onClick={() => nav('/goals')}><Kbd>W</Kbd>Week</button>
        </div>
      </header>
      <div className="ln-body">
        <section className="ln-col">
          <div className="ln-colgrid">
            <div className="ln-colmain">
              <Score day={day} />
              <Now day={day} target={target} onTick={onTick} onMissed={onMissed} busy={busy} />
            </div>
            <DayList day={day} minute={data.minuteOfDay + drift} onSet={setDone} onMissed={setMissed} busy={busy} />
          </div>
        </section>
        <aside className="ln-panel" aria-label="This week">
          <WeekPanel week={data.week} />
          <div className="ln-div" />
          <Coach week={data.week} day={day} />
          {data.week?.coach && <div className="ln-div" />}
          <Earned wins={data.wins} />
          <div className="ln-div" />
          <Pulse pulse={data.pulse} />
        </aside>
      </div>
      {toast && (
        <div className={`ln ln-toast ${toast.bad ? 'bad' : ''}`} role="status">
          {toast.text}
          {toast.undo && <button className="ln-undo" onClick={() => { toast.undo!(); setToast(null) }}>Undo</button>}
        </div>
      )}
    </div>
  )
}
