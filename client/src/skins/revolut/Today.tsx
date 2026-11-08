import { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { canMarkMissed, canTick, canUnmarkMissed, canUntick, duration, isDone, tickHint, useMarkMissed, useTick, useToday, type DayItem, type TodayView } from '../../core/today'
import { useOpenReview } from '../core'
import { PageLoader } from '../../components/ui/Spinner'

type Day = TodayView['day']
type Week = NonNullable<TodayView['week']>

const money = (n: number, cur: string) =>
  new Intl.NumberFormat(cur === 'USD' ? 'en-US' : 'en-GB', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(n)
const signedMoney = (n: number, cur: string) => (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n), cur)
const pt = (n: number) => String(Math.round(n * 100) / 100)
const fmtDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const clock = (m: number) => {
  const x = ((Math.round(m) % 1440) + 1440) % 1440
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`
}
const DAY_END = 28 * 60 // the day closes at 04:00 the next morning

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

// ─── The running score through the day ───────────────────────────────────────
// At minute t the score is (earned by items done by t) / (points of items opened by t).
// An item opens at its start; points land when it was ticked (completedAt).

type Pt = { t: number; s: number }

function scoreCurve(view: TodayView): { pts: Pt[]; end: number } {
  const { day, minuteOfDay } = view
  const gen = Date.parse(view.generatedAt)
  const end = Math.min(minuteOfDay, DAY_END)
  const doneAt = (i: DayItem) => i.completedAt ? minuteOfDay - (gen - Date.parse(i.completedAt)) / 60000 : (i.start ?? end)
  const ev: { t: number; p: number; e: number }[] = []
  for (const i of day.items) {
    if (isDone(i.status)) {
      const d = doneAt(i)
      ev.push({ t: i.start != null ? Math.min(i.start, d) : d, p: i.points, e: 0 })
      ev.push({ t: d, p: 0, e: i.earned })
    } else if (i.start != null && i.start <= end) {
      ev.push({ t: i.start, p: i.points, e: 0 })
    }
  }
  ev.sort((a, b) => a.t - b.t)
  const pts: Pt[] = []
  let P = 0, E = 0
  for (let k = 0; k < ev.length; k++) {
    P += ev[k].p; E += ev[k].e
    if (k + 1 < ev.length && ev[k + 1].t === ev[k].t) continue
    if (P > 0) pts.push({ t: ev[k].t, s: Math.round((E / P) * 100) })
  }
  return { pts, end }
}

const scoreAt = (pts: Pt[], t: number) => {
  let s: number | null = null
  for (const p of pts) { if (p.t <= t) s = p.s; else break }
  return s
}

const band = (s: number) => (s >= 75 ? 'var(--k-good)' : s >= 45 ? 'var(--k-warn)' : 'var(--k-bad)')

function DayChart({ view }: { view: TodayView }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const { day } = view
  const { pts, end } = scoreCurve(view)
  const H = Math.round(Math.min(300, Math.max(212, W * 0.14))), top = 40, bot = H - 40, padX = 26
  const starts = day.items.map(i => i.start).filter((s): s is number => s != null)
  const x0 = starts.length ? Math.floor(Math.min(...starts) / 60) * 60 : 240
  const span = DAY_END - x0
  const X = (t: number) => padX + ((Math.min(Math.max(t, x0), DAY_END) - x0) / span) * (W - padX * 2)
  const Y = (s: number) => bot - (s / 100) * (bot - top)
  const nowX = X(end)
  const cur = day.score ?? pts[pts.length - 1]?.s ?? null
  const color = cur == null ? 'var(--k-t2)' : band(cur)

  let line = ''
  if (pts.length) {
    line = `M${X(pts[0].t)},${Y(pts[0].s)}`
    for (let k = 1; k < pts.length; k++) line += ` H${X(pts[k].t)} V${Y(pts[k].s)}`
    line += ` H${nowX}`
  }
  const area = line && `${line} V${bot} H${X(pts[0].t)} Z`

  const ticks: number[] = []
  for (let m = Math.ceil(x0 / 180) * 180; m < DAY_END - 100; m += 180) ticks.push(m)

  const missed = day.items.filter(i => (i.status === 'missed' || i.status === 'overdue') && i.end != null && i.end <= end)
  const lastMissed = missed[missed.length - 1]
  const c = day.current
  const projected = c && day.possible > 0 ? Math.round(((day.earned + c.points) / day.possible) * 100) : null
  const ghost = day.ghost.score
  const best = day.bestThisMonth
  const nowLabelRight = nowX < W - 140

  return (
    <div ref={ref} className="rv-chart">
      {W > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`Day score through the day. Now ${cur ?? 'not started'}${ghost != null ? `, ${day.ghost.label} at this hour ${ghost}` : ''}.`}>
          <defs>
            <linearGradient id="rv-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity=".22" /><stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
            <radialGradient id="rv-halo"><stop offset="0" stopColor={color} stopOpacity=".3" /><stop offset="1" stopColor={color} stopOpacity="0" /></radialGradient>
          </defs>
          {best && (
            <g>
              <line x1={padX} x2={W - padX} y1={Y(best.score)} y2={Y(best.score)} stroke="#2a2a2f" strokeDasharray="2 5" />
              <text x={W - padX} y={Y(best.score) - 7} fill="#6a6a71" fontSize="12" textAnchor="end">Best this month · {best.score} on {fmtDate(best.date)}</text>
            </g>
          )}
          <line x1={padX} x2={W - padX} y1={bot + .5} y2={bot + .5} stroke="#1c1c20" />
          {ghost != null && (
            <g>
              <line x1={padX} x2={W - padX} y1={Y(ghost)} y2={Y(ghost)} stroke="#5c5c63" strokeWidth="1.6" strokeDasharray="1 5" strokeLinecap="round" />
              {(() => {
                // Keep the ghost's label clear of the Now label when the two lines sit close together.
                const near = cur != null && Math.abs(Y(ghost) - Y(cur)) < 26
                // Near the Now label: sit on the opposite side of the Now line, or at the far left.
                const [gx, anchor] = near
                  ? (nowLabelRight ? [nowX - 14, 'end'] : [padX + 4, 'start'])
                  : (nowX > W * 0.55 ? [padX + 4, 'start'] : [W - padX, 'end'])
                return <text x={gx} y={Y(ghost) - 10} fill="#7a7a81" fontSize="12" textAnchor={anchor as 'start' | 'end'}>{day.ghost.label} at this hour · {ghost}</text>
              })()}
            </g>
          )}
          <line x1={nowX} x2={nowX} y1={top} y2={bot} stroke="#2c2c31" />
          {area && <path d={area} fill="url(#rv-fill)" />}
          {line && <path d={line} fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />}
          {missed.map(i => {
            const s = scoreAt(pts, i.end!) ?? 0
            return <circle key={i.id} cx={X(i.end!)} cy={Y(s)} r="3.5" fill="#000" stroke="var(--k-bad)" strokeWidth="1.8"><title>{`${i.time} · ${i.label} missed its window`}</title></circle>
          })}
          {lastMissed && (() => {
            const lx = X(lastMissed.end!)
            const right = lx > 220
            // The projection owns the top row while a window is open; the miss drops to the row below.
            return <text x={right ? lx - 6 : lx + 6} y={c ? top + 4 : top - 14} fill="#ff7a70" fontSize="12" textAnchor={right ? 'end' : 'start'}>{lastMissed.time} · {lastMissed.label} missed</text>
          })()}
          {cur != null && pts.length > 0 && (
            <g>
              <circle cx={nowX} cy={Y(cur)} r="15" fill="url(#rv-halo)" />
              <circle cx={nowX} cy={Y(cur)} r="5.5" fill={color} stroke="#000" strokeWidth="2" />
              <text x={nowLabelRight ? nowX + 12 : nowX - 12} y={Y(cur) < bot - 30 ? Y(cur) + 25 : Y(cur) - 14} fill="#f5f5f7" fontSize="12.5" fontWeight="600" textAnchor={nowLabelRight ? 'start' : 'end'}>Now · {day.now}</text>
            </g>
          )}
          {c && projected != null && (
            <g>
              <circle cx={Math.min(nowX + 16, W - padX)} cy={Y(projected)} r="3" fill="none" stroke="var(--k-good)" strokeOpacity=".7" strokeWidth="1.5" strokeDasharray="2 2" />
              {(() => {
                const txt = `+${pt(c.points)} if ${c.label} on time → ${projected}`
                const fits = nowX + 24 + txt.length * 6.8 < W - padX
                return <text x={fits ? nowX + 24 : W - padX} y={top - 14} fill="var(--k-good)" fontSize="12" fontWeight="600" textAnchor={fits ? 'start' : 'end'}>{txt}</text>
              })()}
            </g>
          )}
          <g fill="#5d5d64" fontSize="12">
            {ticks.map(m => <text key={m} x={X(m)} y={H - 12} textAnchor="middle">{clock(m)}</text>)}
            <text x={W - padX + 4} y={H - 12} textAnchor="end">{day.closesAt} close</text>
          </g>
          {pts.length === 0 && <text x={W / 2} y={(top + bot) / 2} fill="#6a6a71" fontSize="13" textAnchor="middle">The line starts when your first window opens.</text>}
        </svg>
      )}
    </div>
  )
}

function WeekBars({ recent }: { recent: Day['recent'] }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const H = Math.round(Math.min(300, Math.max(212, W * 0.14))), top = 34, bot = H - 40
  const n = recent.length
  const slot = W / Math.max(1, n)
  const bw = Math.min(64, slot * 0.5)
  return (
    <div ref={ref} className="rv-chart">
      {W > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={recent.map(r => `${r.date}: ${r.score ?? 'no score'}`).join(', ')}>
          <line x1="0" x2={W} y1={bot + .5} y2={bot + .5} stroke="#1c1c20" />
          {recent.map((r, i) => {
            const cx = slot * i + slot / 2
            const today = i === n - 1
            const h = r.score == null ? 0 : Math.max(2, (r.score / 100) * (bot - top))
            const d = new Date(r.date + 'T12:00:00')
            return (
              <g key={r.date}>
                {r.score != null
                  ? <rect x={cx - bw / 2} y={bot - h} width={bw} height={h} rx="6" fill={today ? '#f5f5f7' : '#3a3a40'} />
                  : <line x1={cx - bw / 2} x2={cx + bw / 2} y1={bot - 1} y2={bot - 1} stroke="#2c2c31" strokeWidth="2" strokeDasharray="3 4" />}
                <text x={cx} y={bot - h - 9} textAnchor="middle" fontSize="13" fontWeight="700" fill={r.score == null ? '#55555c' : '#f5f5f7'} fontFamily="Manrope, Inter, sans-serif">{r.score ?? 'no score'}</text>
                <text x={cx} y={H - 12} textAnchor="middle" fontSize="12" fill={today ? '#f5f5f7' : '#5d5d64'}>{today ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}</text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function Hero({ view }: { view: TodayView }) {
  const day = view.day
  const [range, setRange] = useState<'today' | 'week'>('today')
  const diff = day.ghost.diff
  const ghost = day.ghost
  const [first, ...rest] = day.coach.split(/(?<=\.)\s+/)
  const now = new Date(day.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const delta = diff == null ? null
    : diff === 0 ? { t: `Level with ${ghost.label}`, c: 'var(--k-t1)' }
    : diff > 0 ? { t: `+${diff} vs ${ghost.label}`, c: 'var(--k-good)' }
    : { t: `−${-diff} vs ${ghost.label}`, c: 'var(--k-warn)' }
  const sub = [
    ghost.score != null ? `${ghost.label} at this hour: ${ghost.score}` : null,
    day.bestThisMonth ? `Best day this month: ${day.bestThisMonth.score}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <section className="rv-hero">
      <div className="rv-hhead">
        <div className="rv-label">Day score <small>{now} · <span className="num">{day.now}</span></small></div>
        <div className="rv-pills" role="tablist" aria-label="Chart range">
          <button role="tab" aria-selected={range === 'today'} className={range === 'today' ? 'on' : ''} onClick={() => setRange('today')}>Today</button>
          <button role="tab" aria-selected={range === 'week'} className={range === 'week' ? 'on' : ''} onClick={() => setRange('week')}>Week</button>
          <button role="tab" aria-selected={false} disabled title="Not available yet: only the last 7 days of scores are loaded">Month</button>
        </div>
      </div>
      <div className="rv-srow">
        <div className="rv-big num">{day.score ?? '–'}</div>
        <div className="rv-delta">
          {day.closed ? <div className="d" style={{ color: 'var(--k-t2)' }}>Final score</div>
            : delta && <div className="d num" style={{ color: delta.c }}>{delta.t}</div>}
          {sub && <div className="g">{sub}</div>}
        </div>
      </div>
      <div className="rv-coach">{first}{rest.length > 0 && <> <b>{rest.join(' ')}</b></>}</div>
      {range === 'today' ? <DayChart view={view} /> : <WeekBars recent={day.recent} />}
    </section>
  )
}

// ─── Wins as insight cards ───────────────────────────────────────────────────

const WIN: Record<string, { bg: string; fg: string; icon: React.ReactNode }> = {
  business: { bg: 'rgba(58,214,127,.14)', fg: '#3ad67f', icon: <><path d="M3 14l5-5 3 3 6-6" /><path d="M12 6h5v5" /></> },
  training: { bg: 'rgba(255,174,61,.14)', fg: '#ffae3d', icon: <path d="M2.5 10h15M5 6.5v7M15 6.5v7M7.5 8v4M12.5 8v4" /> },
  week: { bg: 'rgba(59,123,255,.16)', fg: '#6b9bff', icon: <path d="M10 2.5l2.3 4.7 5.2.8-3.8 3.6.9 5.1L10 14.3l-4.6 2.4.9-5.1L2.5 8l5.2-.8z" /> },
}

function Wins({ wins }: { wins: TodayView['wins'] }) {
  if (!wins.length) {
    return (
      <section className="rv-wins">
        <div className="rv-card rv-win empty">
          <div><div className="v">No new bests this week yet</div><div className="c">Records, best weeks and all-time highs show up here when you earn them.</div></div>
        </div>
      </section>
    )
  }
  return (
    <section className="rv-wins" aria-label="Earned this week">
      {wins.map((w, i) => {
        const k = WIN[w.kind] ?? WIN.week
        // A short figure reads best as the headline; a sentence reads best as the caption.
        const figure = w.detail.length <= 14 && /\d/.test(w.detail)
        return (
          <div key={i} className="rv-card rv-win">
            <div className="rv-disc" style={{ background: k.bg }}>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke={k.fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{k.icon}</svg>
            </div>
            <div className="tx">
              <div className={`v ${figure ? 'num' : 'sm'}`}>{figure ? w.detail : w.title}</div>
              <div className="c">{figure ? w.title : w.detail}</div>
            </div>
          </div>
        )
      })}
    </section>
  )
}

// ─── Week as a portfolio card ────────────────────────────────────────────────

function Ladder({ week }: { week: Week }) {
  const rungs = week.ladder
  if (!rungs.length) return null
  const lo = Math.max(0, Math.min(Math.floor(week.score), rungs[0].at - 2))
  const stops = [lo, ...rungs.map(r => r.at)]
  // Milestones sit evenly along the track; the score is placed between the two it falls between.
  const posOf = (i: number) => (i === 0 ? 0 : rungs.length === 1 ? 100 : 20 + (80 * (i - 1)) / (rungs.length - 1))
  const place = (v: number) => {
    if (v <= stops[0]) return 0
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i]) return posOf(i - 1) + ((v - stops[i - 1]) / (stops[i] - stops[i - 1] || 1)) * (posOf(i) - posOf(i - 1))
    }
    return 100
  }
  const at = place(week.score)
  const last = week.lastWeek ? place(week.lastWeek.score) : null
  return (
    <div className="rv-ladder">
      <div className="track">
        <div className="fill" style={{ width: `${at}%` }} />
        {last != null && <div className="ghost" style={{ left: `${last}%` }} title={`Last week finished on ${pt(week.lastWeek!.score)}`} />}
        {rungs.map((r, i) => (
          <div key={r.at} className={`node ${r.reached ? 'got' : week.nextReward?.at === r.at ? 'next' : ''}`} style={{ left: `${posOf(i + 1)}%` }} />
        ))}
        <div className="me" style={{ left: `${at}%` }} />
      </div>
      <div className="labels">
        <span className="lb first" style={{ left: 0 }}>Now <span className="num">{pt(week.score)}</span></span>
        {rungs.map((r, i) => (
          <span key={r.at} className={`lb ${i === rungs.length - 1 ? 'last' : ''} ${r.reached ? 'got' : week.nextReward?.at === r.at ? 'next' : ''}`} style={{ left: `${posOf(i + 1)}%` }}>
            {r.reward} <em className="num">{pt(r.at)}</em>
          </span>
        ))}
      </div>
    </div>
  )
}

function WeekCard({ week }: { week: TodayView['week'] }) {
  const nav = useNavigate()
  if (!week) {
    return (
      <section className="rv-card rv-week">
        <div className="rv-label">This week</div>
        <p className="rv-muted" style={{ marginTop: 10 }}>No weekly goal is set. Set one up in Week and the score starts counting.</p>
        <button className="rv-chip" style={{ marginTop: 14 }} onClick={() => nav('/goals')}>Open Week</button>
      </section>
    )
  }
  const warn = !!week.stakes && /out of reach|risk/i.test(week.stakes)
  return (
    <section className="rv-card rv-week">
      <div className="rv-wkhead">
        <div>
          <div className="rv-label">This week <small>{fmtDate(week.from)} to {fmtDate(week.to)}</small></div>
          <div className="rv-wknum"><span className="n num">{pt(week.score)}</span><span className="o">/ {pt(week.max)}</span></div>
        </div>
        {week.lastWeek && (
          <div className="rv-last">
            <div className="l1">Last week</div>
            <div className="l2 num">{pt(week.lastWeek.score)}{week.lastWeek.reward && <span>{week.lastWeek.reward} earned</span>}</div>
          </div>
        )}
      </div>
      <Ladder week={week} />
      {(week.stakes || week.coach) && (
        <div className="rv-stake">
          {warn
            ? <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden><path d="M8 1.8l6.6 11.6H1.4z" fill="none" stroke="#ffae3d" strokeWidth="1.6" strokeLinejoin="round" /><path d="M8 6.3v3.3" stroke="#ffae3d" strokeWidth="1.6" strokeLinecap="round" /><circle cx="8" cy="11.5" r=".9" fill="#ffae3d" /></svg>
            : <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#8d8d94" strokeWidth="1.6" strokeLinecap="round" aria-hidden><circle cx="8" cy="8" r="6.2" /><path d="M8 7.2v4M8 4.9v.1" /></svg>}
          <span>{week.stakes && <span className={warn ? 'warn' : 'hl'}>{week.stakes}</span>}{week.stakes && week.coach ? ' ' : ''}{week.coach}</span>
        </div>
      )}
      <div className="rv-tasks">
        {week.tasks.map(t => {
          const full = t.earned >= t.max
          const broke = !!t.note && /break/.test(t.note) && !full
          return (
            <div key={t.id} className="rv-task">
              <span className="nm" title={t.title}>{t.title}{t.note && t.note !== 'not scored yet' && <em>{t.note}</em>}</span>
              <span className="bar"><i style={{ width: `${Math.min(100, (t.earned / t.max) * 100)}%`, background: full ? 'var(--k-good)' : broke ? 'var(--k-warn)' : 'var(--k-t1)' }} /></span>
              <span className="p num" style={full ? { color: 'var(--k-good)' } : undefined}>{pt(t.earned)}/{pt(t.max)}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── Money pulse ─────────────────────────────────────────────────────────────

function Money({ pulse, day }: { pulse: TodayView['pulse']; day: Day }) {
  const nav = useNavigate()
  const due = pulse.business?.nextDue
  const daysLate = due ? Math.round((new Date(day.date + 'T12:00:00').getTime() - new Date(due.dueDate + 'T12:00:00').getTime()) / 864e5) : 0
  const workout = day.items.find(i => /workout/i.test(i.label) && (i.status === 'open' || i.status === 'upcoming'))
  const left = pulse.workouts.target - pulse.workouts.done
  const rows: React.ReactNode[] = []

  for (const a of pulse.trading) {
    const unit = a.limitUnit === 'R' ? 'R' : '$'
    const used = a.limitUnit === 'R' ? (a.netR != null ? Math.max(0, -a.netR) : null) : Math.max(0, -a.net)
    const limit = a.limitLeft != null && used != null ? a.limitLeft + used : null
    const fmtU = (v: number) => (unit === 'R' ? `${pt(v)}R` : money(v, 'USD'))
    const tone = a.net < 0 ? 'var(--k-bad)' : a.net > 0 ? 'var(--k-good)' : 'var(--k-t1)'
    rows.push(
      <div key={`t${a.id}`} className="rv-mblock">
        <div className="rv-mrow">
          <div className="rv-disc sm" style={{ background: a.net < 0 ? 'rgba(255,91,79,.13)' : a.net > 0 ? 'rgba(58,214,127,.13)' : 'rgba(255,255,255,.07)' }}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={a.net < 0 ? '#ff5b4f' : a.net > 0 ? '#3ad67f' : '#c9c9cf'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {a.net < 0 ? <><path d="M3 6l5 5 3-3 6 6" /><path d="M12 14h5V9" /></> : <><path d="M3 14l5-5 3 3 6-6" /><path d="M12 6h5v5" /></>}
            </svg>
          </div>
          <div className="tx">
            <div className="t">{a.name}</div>
            <div className="s">{a.trades} trade{a.trades === 1 ? '' : 's'} today{a.netR != null && a.trades > 0 && <> · <span className="num" style={{ color: tone }}>{a.netR > 0 ? '+' : a.netR < 0 ? '−' : ''}{pt(Math.abs(a.netR))}R</span></>}</div>
          </div>
          <div className="r"><div className="f num" style={{ color: a.trades ? tone : 'var(--k-t1)' }}>{signedMoney(a.net, 'USD')}</div><div className="u">net today</div></div>
        </div>
        {limit != null && limit > 0 && a.limitLeft != null && (
          <div className="rv-limit">
            <div className="track"><i style={{ width: `${Math.min(100, ((used ?? 0) / limit) * 100)}%`, background: a.limitLeft <= 0 ? 'var(--k-bad)' : 'var(--k-warn)' }} /></div>
            <div className="lt">
              <span style={{ color: a.limitLeft <= 0 ? 'var(--k-bad)' : (used ?? 0) > 0 ? 'var(--k-warn)' : 'var(--k-t2)' }}>
                {a.limitLeft <= 0 ? "Today's loss limit is reached" : `${fmtU(a.limitLeft)} left before today's loss limit`}
              </span>
              <span className="num">{fmtU(limit)}</span>
            </div>
          </div>
        )}
      </div>,
    )
  }

  if (due) {
    rows.push(
      <div key="due" className="rv-mrow">
        <div className="rv-disc sm" style={{ background: daysLate > 0 ? 'rgba(255,174,61,.13)' : 'rgba(255,255,255,.07)' }}>
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={daysLate > 0 ? '#ffae3d' : '#c9c9cf'} strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" /></svg>
        </div>
        <div className="tx">
          <div className="t">{due.clientName ?? due.invoiceNumber}</div>
          <div className="s">{daysLate > 0 ? <span style={{ color: 'var(--k-warn)' }}>{daysLate} day{daysLate === 1 ? '' : 's'} overdue</span> : `Due ${fmtDate(due.dueDate)}`}</div>
        </div>
        <div className="r"><div className="f num">{money(due.amount, 'GBP')}</div><button className="rv-chase" onClick={() => nav('/business/invoices')}>Chase</button></div>
      </div>,
    )
  } else if (pulse.business) {
    rows.push(
      <div key="mrr" className="rv-mrow">
        <div className="rv-disc sm" style={{ background: 'rgba(255,255,255,.07)' }}>
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="#c9c9cf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 10a6 6 0 0 1 10.4-4M16 10a6 6 0 0 1-10.4 4M14 2.5V6h-3.5M6 17.5V14h3.5" /></svg>
        </div>
        <div className="tx"><div className="t">Recurring revenue</div><div className="s">No invoice due</div></div>
        <div className="r"><div className="f num">{money(pulse.business.mrr, 'GBP')}<small>/mo</small></div></div>
      </div>,
    )
  }

  rows.push(
    <div key="wk" className="rv-mrow">
      <div className="rv-disc sm" style={{ background: 'rgba(255,255,255,.07)' }}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#c9c9cf" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M2.5 10h15M5 6.5v7M15 6.5v7" /></svg>
      </div>
      <div className="tx">
        <div className="t">Workouts this week</div>
        <div className="s">{workout ? `Next: ${workout.status === 'open' ? 'now' : `today ${workout.time}`}` : left > 0 ? `${left} to go` : 'Target met'}</div>
      </div>
      <div className="r"><div className="f num" style={left <= 0 ? { color: 'var(--k-good)' } : undefined}>{pulse.workouts.done}<span className="of"> / {pulse.workouts.target}</span></div></div>
    </div>,
  )

  return (
    <section className="rv-card rv-money">
      <div className="rv-label" style={{ marginBottom: 16 }}>Money pulse</div>
      {rows.map((r, i) => <div key={i}>{i > 0 && <div className="rv-sep" />}{r}</div>)}
    </section>
  )
}

// ─── Now card ────────────────────────────────────────────────────────────────

const endClock = (i: DayItem) => clock(i.end ?? 0)
const Check = ({ c = 'currentColor' }: { c?: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 8.5l3.2 3L13 4.5" /></svg>
)

const MISS_TITLE = "It didn't happen: earns nothing and counts like any miss"

function Now({ day, onTick, onMissed, busy }: { day: Day; onTick: (id: number) => void; onMissed: (id: number) => void; busy: boolean }) {
  const openReview = useOpenReview()
  const overdue = day.items.find(i => i.status === 'overdue')
  const next = day.next
  const c = day.current
  const NextUp = next ? <div className="next">Next up at <span className="num">{next.time}</span><b>{next.label}</b></div> : null

  if (day.closed) {
    return (
      <section className="rv-card rv-now quiet">
        <div className="top"><span className="live"><i />Day closed</span></div>
        <h2>Final score <span className="num">{day.score ?? 0}</span></h2>
        <div className="meta"><span>Tomorrow starts at 04:00.</span></div>
      </section>
    )
  }

  if (c) {
    const span = (c.end ?? 0) - (c.start ?? 0)
    const pct = span ? Math.min(100, Math.max(0, ((span - c.minutesLeft) / span) * 100)) : 0
    return (
      <section className="rv-now blue">
        <div className="top"><span className="live"><i />Now</span><span>Open until <span className="num">{endClock(c)}</span></span></div>
        <h2>{c.label}</h2>
        <div className="meta"><span><b className="num">{duration(c.minutesLeft)}</b> left</span><span><b className="num">+{pt(c.points)}</b> on time</span><span className="num">+{pt(c.points / 2)} if late</span></div>
        <div className="wbar"><i style={{ width: `${pct}%` }} /></div>
        <div className="foot">
          <div className="acts">
            <button className="rv-done" disabled={busy} onClick={() => onTick(c.id)}><Check />Done</button>
            <button className="rv-missbtn" disabled={busy} onClick={() => onMissed(c.id)} aria-label={`${c.label}: missed, it didn't happen`} title={MISS_TITLE}>Missed</button>
          </div>
          {NextUp}
        </div>
      </section>
    )
  }

  if (overdue) {
    return (
      <section className="rv-now blue">
        <div className="top"><span className="live warn"><i />Past its window</span><span>Was due at <span className="num">{overdue.time}</span></span></div>
        <h2>{overdue.label}</h2>
        <div className="meta"><span><b className="num">+{pt(overdue.points / 2)}</b> if done now</span><span>Missed counts for nothing</span></div>
        <div className="foot">
          <div className="acts">
            <button className="rv-done" disabled={busy} onClick={() => onTick(overdue.id)}><Check />Done late</button>
            <button className="rv-missbtn" disabled={busy} onClick={() => onMissed(overdue.id)} aria-label={`${overdue.label}: missed, it didn't happen`} title={MISS_TITLE}>Missed</button>
          </div>
          {NextUp ?? <button className="rv-ghostbtn" onClick={openReview}>Close the day</button>}
        </div>
      </section>
    )
  }

  return (
    <section className="rv-card rv-now quiet">
      <div className="top"><span className="live"><i />{next ? 'Between windows' : 'Nothing left today'}</span>{next && <span>Opens at <span className="num">{next.time}</span></span>}</div>
      <h2>{next ? next.label : 'All windows are behind you'}</h2>
      <div className="meta">
        {next ? <><span>Opens in <b className="num">{duration(next.minutesUntil)}</b></span><span><b className="num">+{pt(next.points)}</b> on time</span></>
          : <span>Give each miss a reason and lock the score.</span>}
      </div>
      {!next && <div className="foot"><button className="rv-done" onClick={openReview}>Close the day</button></div>}
    </section>
  )
}

// ─── The day list ────────────────────────────────────────────────────────────

const ICON: Record<string, React.ReactNode> = {
  on_time: <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#3ad67f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.3l2.3 2.2L9.5 3.8" /></svg>,
  late: <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#ffae3d" strokeWidth="1.8" strokeLinecap="round"><circle cx="6" cy="6" r="4.2" /><path d="M6 3.8V6l1.5 1" /></svg>,
  missed: <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#ff5b4f" strokeWidth="2" strokeLinecap="round"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" /></svg>,
}

function DayList({ day, minute, onSet, onMissed, busy }: { day: Day; minute: number; onSet: (id: number, done: boolean) => void; onMissed: (id: number, missed: boolean) => void; busy: boolean }) {
  const openReview = useOpenReview()
  const { onTime, late, missed } = day.counts
  const closedN = onTime + late + missed
  const firstAhead = day.items.findIndex(i => i.status === 'upcoming')
  const hasOverdue = day.items.some(i => i.status === 'overdue')
  const showClose = !day.closed && (hasOverdue || (!day.current && !day.next))
  return (
    <section className="rv-card rv-tl">
      <div className="hd">
        <span className="rv-label">The day</span>
        <span className="c">{closedN > 0 ? `${onTime} of ${closedN} on time · ` : ''}<span className="num">{pt(day.earned)}</span> pts banked</span>
      </div>
      {day.items.length === 0 ? <p className="rv-muted" style={{ padding: '8px 4px 14px' }}>No routine set for today. Add items in Routine.</p> : (
        <ul>
          {day.items.map((i, idx) => {
            const now = i.status === 'open'
            const up = i.status === 'upcoming' || i.status === 'anytime'
            const undo = canUntick(i, day.closed)
            const able = canTick(i, minute, day.closed)
            const hint = tickHint(i, minute, day.closed)
            const miss = canMarkMissed(i, day.closed)
            const unmiss = canUnmarkMissed(i, day.closed)
            // Resting result; on hover or focus it swaps to the action the row offers.
            const rest = (
              <>
                {i.status === 'on_time' && <span className="g">+{pt(i.earned)}</span>}
                {i.status === 'late' && <span className="a">Late +{pt(i.earned)}</span>}
                {i.status === 'open' && <span className="b">Now · {duration(day.current?.id === i.id ? day.current.minutesLeft : 0)}</span>}
                {up && idx === firstAhead ? <span className="m">Next</span> : (up && <span className="m">+{pt(i.points)}</span>)}
              </>
            )
            return (
              <li key={i.id} className={`rv-row ${now ? 'now' : ''} ${up ? 'up' : ''}`} title={!undo && !able && up && !day.closed ? hint : undefined}>
                <span className="tm num">{i.time ?? 'Any'}</span>
                <span className={`ic ${i.status === 'on_time' ? 'ok' : i.status === 'late' ? 'lt' : i.status === 'missed' || i.status === 'overdue' ? 'ms' : ''}`}>
                  {now ? <i /> : ICON[i.status === 'overdue' ? 'missed' : i.status] ?? null}
                </span>
                <span className="nm" title={i.label}>{i.label}</span>
                <span className="rs num">
                  {miss && (
                    <button className="rv-rowmiss" disabled={busy} onClick={() => onMissed(i.id, true)} aria-label={`${i.label}: missed, it didn't happen`} title={MISS_TITLE}>Missed</button>
                  )}
                  {i.status === 'missed' && (unmiss ? (
                    <button className="rv-sw undo" disabled={busy} onClick={() => onMissed(i.id, false)} aria-label={`${i.label}: not missed after all, back on today's list`} title="Not missed after all: back on today's list">
                      <span className="x"><span className="rd">Missed 0</span></span><span className="y">Not missed</span>
                    </button>
                  ) : <span className="rd">Missed 0</span>)}
                  {i.status === 'overdue' && (
                    <button className="rv-late" disabled={busy || !able} onClick={() => onSet(i.id, true)} aria-label={`Mark ${i.label} done late, plus ${pt(i.points / 2)}`} title={hint}>
                      <span className="x">Missed</span><span className="y">Done late +{pt(i.points / 2)}</span>
                    </button>
                  )}
                  {undo && (
                    <button className="rv-sw undo" disabled={busy} onClick={() => onSet(i.id, false)} aria-label={`Untick ${i.label}, mark it not done`} title="Untick: mark as not done">
                      <span className="x">{rest}</span><span className="y">Undo</span>
                    </button>
                  )}
                  {able && i.status !== 'overdue' && (
                    <button className="rv-sw" disabled={busy} onClick={() => onSet(i.id, true)} aria-label={`Mark ${i.label} done, plus ${pt(i.points)}`} title={hint}>
                      <span className="x">{rest}</span><span className="y">Done +{pt(i.points)}</span>
                    </button>
                  )}
                  {!undo && !able && i.status !== 'overdue' && rest}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <div className="ft">
        <span>Day closes at <span className="num">{day.closesAt}</span></span>
        {showClose ? <button className="rv-chip" onClick={openReview}>Close the day</button>
          : <span className="num">{duration(day.minutesToClose)} left</span>}
      </div>
    </section>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function RevolutToday() {
  const { data, isPending } = useToday()
  const tick = useTick()
  const missM = useMarkMissed()
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = (text: string, undo?: () => void, ms = 4000) => {
    if (hide.current) clearTimeout(hide.current)
    setToast({ text, undo }); hide.current = setTimeout(() => setToast(null), ms)
  }

  if (isPending || !data) return <PageLoader />
  /** Ticks or unticks an item; every tick can be undone from the toast. */
  const setDone = (id: number, done: boolean) => tick.mutate({ id, done }, {
    onSuccess: v => {
      const it = v.day.items.find(i => i.id === id)
      if (!it) return
      if (done && isDone(it.status)) show(`${it.label}: ${it.status === 'on_time' ? 'on time' : 'late'}, +${pt(it.earned)}`, () => setDone(id, false))
      else if (!done) show(`${it.label}: unticked`)
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => show(e?.response?.data?.error ?? 'Could not save that.'),
  })
  const onTick = (id: number) => setDone(id, true)
  /** Marks an item missed or takes it back; a miss can be undone from the toast. It never earns. */
  const setMissed = (id: number, missed: boolean) => missM.mutate({ id, missed }, {
    onSuccess: v => {
      const it = v.day.items.find(i => i.id === id)
      if (it) show(missed ? `${it.label}: marked missed` : `${it.label}: back on today's list`, missed ? () => setMissed(id, false) : undefined)
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => show(e?.response?.data?.error ?? 'Could not save that.'),
  })
  const busy = tick.isPending || missM.isPending

  return (
    <div className="rv rv-page skin-enter">
      <div className="rv-grid">
        <div className="rv-left">
          <Hero view={data} />
          <Wins wins={data.wins} />
          <div className="rv-bottom">
            <WeekCard week={data.week} />
            <Money pulse={data.pulse} day={data.day} />
          </div>
        </div>
        <aside className="rv-right">
          <Now day={data.day} onTick={onTick} onMissed={id => setMissed(id, true)} busy={busy} />
          <DayList day={data.day} minute={data.minuteOfDay} onSet={setDone} onMissed={setMissed} busy={busy} />
        </aside>
      </div>
      {toast && (
        <div className="rv rv-toast" role="status">
          {toast.text}
          {toast.undo && <button className="rv-undo" onClick={() => { toast.undo!(); setToast(null) }}>Undo</button>}
        </div>
      )}
    </div>
  )
}
