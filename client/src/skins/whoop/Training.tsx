import { useEffect, useMemo, useRef, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  CATEGORIES, catMeta, computeInsight, exVolume, exerciseSeries, kg, peakRpe, personalRecords, setLabel, startingSets, sundayOf, targetStreak,
  useAllWorkouts, useBodyMetrics, useDeleteBody, useDeleteTemplate, useDeleteWorkout, useLogBody, useLogWorkout, useSaveTemplate, useTraining, useUpdateBody,
  workoutVolume,
  type BodyMetric, type Lift, type LogExercise, type Template, type TrainingView, type Workout,
} from '../../core/training'
import { useWeek } from '../../core/week'
import { PageLoader } from '../../components/ui/Spinner'
import './training.css'

const e1 = (w: number, r: number) => (w > 0 && r > 0 && r <= 12 ? w * (1 + r / 30) : 0)
const fmtDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const fmtShort = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const fmtLong = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const r1 = (n: number) => Math.round(n * 10) / 10
const signed = (n: number, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(d)}`
const volLabel = (v: number) => (v >= 10000 ? `${(v / 1000).toFixed(1)} t` : `${Math.round(v).toLocaleString('en-GB')} kg`)
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 864e5)

/** What the logger opens with: a template by name, or an existing workout to edit. */
export type LogInit = { template: string } | { edit: Workout }

export function WhoopTraining() {
  const { data, isPending } = useTraining()
  const all = useAllWorkouts()
  const week = useWeek()
  const [logging, setLogging] = useState<LogInit | null>(() => {
    const t = new URLSearchParams(window.location.search).get('log')
    return t ? { template: t } : null
  })
  const [templates, setTemplates] = useState(false)
  if (isPending || !data) return <PageLoader />

  // The weekly target comes from a "workouts" task on this week's goals, else 4.
  const target = week.data?.current?.tasks.find(t => t.source === 'workouts')?.target ?? 4
  const workouts = all.data ?? []

  return (
    <div className="wh-page wh-train skin-enter">
      <div className="wh-grid">
        <div className="wh-left">
          <Hero data={data} workouts={workouts} target={target} />
          <Signal />
          <Start data={data} onStart={t => setLogging({ template: t })} onManage={() => setTemplates(true)} />
          <Lifts lifts={data.progress} />
          <Records workouts={workouts} />
          <Progress workouts={workouts} lifts={data.progress} />
        </div>
        <div className="wh-right">
          <Body today={data.today} />
          <Consistency data={data} workouts={workouts} target={target} />
          <History data={data} workouts={workouts} onEdit={w => setLogging({ edit: w })} />
        </div>
      </div>
      {logging && <Logger data={data} init={logging} onClose={() => setLogging(null)} />}
      {templates && <Templates data={data} onClose={() => setTemplates(false)} />}
    </div>
  )
}

// ─── The answer first ────────────────────────────────────────────────────────

function Hero({ data, workouts, target }: { data: TrainingView; workouts: Workout[]; target: number }) {
  const lifts = data.progress.filter(l => l.sessions >= 3)
  const up = lifts.filter(l => l.change > 0).sort((a, b) => b.change - a.change)
  const below = lifts.filter(l => l.current < l.best.e1rm)
  const atBest = lifts.filter(l => l.current >= l.best.e1rm)
  const thisWeek = data.weeks[data.weeks.length - 1]?.count ?? 0
  const last = data.recent[0]

  const wk = sundayOf(data.today)
  const volume = workouts.filter(w => sundayOf(w.date) === wk).reduce((s, w) => s + workoutVolume(w), 0)
  const timed = workouts.filter(w => w.durationMinutes)
  const avgMin = timed.length ? Math.round(timed.reduce((s, w) => s + (w.durationMinutes ?? 0), 0) / timed.length) : 0
  const streak = targetStreak(workouts, data.today, target)

  let kick: [string, string], h1: React.ReactNode, sub: string
  if (!lifts.length) {
    kick = ['Just starting', 'var(--k-mute)']; h1 = 'Log a few workouts and your progress shows up here.'; sub = ''
  } else if (atBest.length >= lifts.length / 2) {
    kick = ['Getting stronger', 'var(--k-good)']
    h1 = <>{atBest.length} of {lifts.length} lifts are at their best</>
    sub = up[0] ? `${up[0].name} is up ${kg(up[0].change)} in 8 weeks.` : ''
  } else if (up.length) {
    kick = ['Rebuilding', 'var(--k-warn)']
    h1 = <>{up[0].name} is up {kg(up[0].change)} in 8 weeks</>
    sub = `${below.length} of ${lifts.length} lifts are still below their best.`
  } else {
    kick = ['Stalled', 'var(--k-bad)']
    h1 = <>No lift has gone up in 8 weeks</>
    sub = `${below.length} of ${lifts.length} lifts are below their best.`
  }

  return (
    <section className="wh-rhero">
      <div className="wh-kick" style={{ color: kick[1] }}><i />{kick[0]}</div>
      <h1>{h1}{sub && <><br /><span>{sub}</span></>}</h1>
      <div className="wh-ghosts trn-ghosts">
        <div className="wh-g"><div className="k">This week</div><div className="v num" style={{ color: thisWeek >= target ? 'var(--k-good)' : undefined }}>{thisWeek}<small>of {target}</small></div></div>
        <div className="wh-g" title="Weeks in a row with the target hit. This week joins once it hits.">
          <div className="k">Weeks in a row</div>
          <div className="v num" style={{ color: streak.weeks > 0 ? 'var(--k-good)' : undefined }}>{streak.weeks}<small>{streak.weeks === 1 ? 'week' : 'weeks'} at {target}+</small></div>
        </div>
        <div className="wh-g"><div className="k">Volume this week</div><div className="v num">{volume > 0 ? volLabel(volume) : '–'}<small>{volume > 0 ? 'moved' : 'no weights yet'}</small></div></div>
        <div className="wh-g"><div className="k">Average session</div><div className="v num">{avgMin || '–'}<small>{avgMin ? 'min' : 'no lengths logged'}</small></div></div>
        <div className="wh-g"><div className="k">Last workout</div><div className="v trn-last">{last ? last.name : '–'}{last && <small>{fmtDay(last.date)}</small>}</div></div>
      </div>
    </section>
  )
}

// ─── Feedback: what your weight and your lifts say together ──────────────────

const TONE = { good: 'var(--k-good)', warn: 'var(--k-warn)', bad: 'var(--k-bad)' } as const
const TONE_BG = { good: 'var(--k-good-d)', warn: 'var(--k-warn-d)', bad: 'var(--k-bad-d)' } as const

export function Signal() {
  const metrics = useBodyMetrics()
  const workouts = useAllWorkouts()
  const insight = useMemo(() => computeInsight(metrics.data ?? [], workouts.data ?? []), [metrics.data, workouts.data])
  if (!insight) return null
  const c = TONE[insight.color]
  return (
    <section className="wh-card wh-signal" style={{ background: `linear-gradient(180deg, ${TONE_BG[insight.color]}, transparent 70%)`, borderColor: `color-mix(in srgb, ${c} 28%, transparent)` }}>
      <div className="top">
        <div>
          <div className="eyebrow" style={{ color: c }}>Body composition signal</div>
          <h2>{insight.pattern}</h2>
          <p className="what">{insight.what}</p>
        </div>
        <div className="nums">
          {insight.weightChange != null && <div><span>Weight</span><b className="num">{insight.weightChange > 0 ? '+' : ''}{insight.weightChange.toFixed(1)} kg</b></div>}
          {insight.liftPct != null && <div><span>Lifts, earlier vs recent</span><b className="num" style={{ color: insight.liftPct > 4 ? 'var(--k-good)' : insight.liftPct < -4 ? 'var(--k-bad)' : 'var(--k-ink)' }}>{insight.liftPct > 0 ? '+' : ''}{insight.liftPct.toFixed(1)}%</b></div>}
          <div><span>Lifts tracked</span><b className="num">{insight.trackedExercises}</b></div>
        </div>
      </div>
      <div className="cols">
        <div><span>Why it matters</span><p>{insight.why}</p></div>
        <div><span>What to do</span><p>{insight.action}</p></div>
      </div>
    </section>
  )
}

// ─── Body weight: one field, Enter; charts and every entry editable ──────────

const chartTip = {
  contentStyle: { background: 'var(--k-card2)', border: '1px solid var(--k-line2)', borderRadius: 12, fontSize: 12.5, padding: '6px 10px' },
  labelStyle: { color: 'var(--k-mute)', marginBottom: 2 },
  itemStyle: { color: 'var(--k-ink)', padding: 0 },
}
/** A y-axis range padded to round steps, so the ticks read as plain numbers. */
const niceDomain = (vals: number[], step: number): [number, number] => {
  const lo = Math.min(...vals), hi = Math.max(...vals)
  return [Math.max(0, Math.floor((lo - step / 2) / step) * step), Math.ceil((hi + step / 2) / step) * step]
}
const tick = { fill: 'var(--k-faint)', fontSize: 11, fontFamily: 'var(--k-font)' }

export function MetricChart({ rows, field, unit, label }: { rows: BodyMetric[]; field: 'weightKg' | 'bodyFatPct'; unit: string; label: string }) {
  const pts = rows.filter(r => r[field] != null)
  return (
    <div className="trn-mchart">
      <ResponsiveContainer width="100%" height={110}>
        <LineChart data={pts} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke="rgb(var(--k-fg) / .05)" />
          <XAxis dataKey="date" tick={tick} axisLine={false} tickLine={false} tickFormatter={fmtShort} minTickGap={28} />
          <YAxis tick={tick} axisLine={false} tickLine={false} domain={niceDomain(pts.map(p => p[field]!), 1)} tickFormatter={v => String(Math.round(v))} width={44} />
          <Tooltip {...chartTip} labelFormatter={l => fmtDay(String(l))} formatter={(v: any) => [`${v}${unit}`, label]} />
          <Line type="monotone" dataKey={field} stroke="var(--k-ink2)" strokeWidth={1.8} dot={pts.length <= 24 ? { r: 2.5, fill: 'var(--k-ink2)', strokeWidth: 0 } : false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function Body({ today }: { today: string }) {
  const metrics = useBodyMetrics()
  const log = useLogBody()
  const del = useDeleteBody()
  const [w, setW] = useState('')
  const [bf, setBf] = useState('')
  const [all, setAll] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const entries: BodyMetric[] = [...(metrics.data ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const rows = entries.filter(m => m.weightKg != null)
  const bfRows = entries.filter(m => m.bodyFatPct != null)
  const last = rows[rows.length - 1]
  const lastBf = bfRows[bfRows.length - 1]
  const monthAgo = new Date(today + 'T12:00:00'); monthAgo.setDate(monthAgo.getDate() - 28)
  const ref = [...rows].reverse().find(r => r.date <= monthAgo.toISOString().slice(0, 10)) ?? rows[0]
  const delta = last && ref && last !== ref ? last.weightKg! - ref.weightKg! : null
  const total = rows.length > 1 ? last.weightKg! - rows[0].weightKg! : null
  const bfTotal = bfRows.length > 1 ? lastBf.bodyFatPct! - bfRows[0].bodyFatPct! : null
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = parseFloat(w.replace(',', '.'))
    if (!(v > 20 && v < 400)) return
    const b = parseFloat(bf.replace(',', '.'))
    log.mutate({ date: today, weightKg: v, ...(b > 0 && b < 70 ? { bodyFatPct: b } : {}) }, { onSuccess: () => { setW(''); setBf('') } })
  }
  const loggedToday = last?.date === today

  return (
    <section className="wh-card wh-body">
      <div className="hd">
        <div className="wh-h">Body weight</div>
        {delta != null && <div className="wh-sub num">{signed(delta)} kg in 4 weeks</div>}
      </div>
      <div className="big">
        <b className="num">{last ? last.weightKg!.toFixed(1) : '–'}</b><span>kg</span>
        {lastBf && <span className="bf num">{lastBf.bodyFatPct}% body fat</span>}
        <small>{last ? (loggedToday ? 'logged today' : `last ${fmtDay(last.date)}`) : 'nothing logged yet'}</small>
      </div>
      <form className="log" onSubmit={submit}>
        <input className="num" inputMode="decimal" value={w} onChange={e => setW(e.target.value)} placeholder={loggedToday ? 'Correct today, e.g. 82.4' : "Today's weight, e.g. 82.4"} aria-label="Weight in kg" />
        <input className="num bfin" inputMode="decimal" value={bf} onChange={e => setBf(e.target.value)} placeholder="BF %" aria-label="Body fat percent (optional)" />
        <button className="wh-chase" type="submit" disabled={!w || log.isPending}>Log</button>
      </form>
      {rows.length > 1 && (
        <div className="trn-mblock">
          <div className="trn-mhd"><span>Weight</span><b className="num">{signed(total!)} kg since {fmtLong(rows[0].date)}</b></div>
          <MetricChart rows={entries} field="weightKg" unit=" kg" label="Weight" />
        </div>
      )}
      {bfRows.length > 1 && (
        <div className="trn-mblock">
          <div className="trn-mhd"><span>Body fat</span><b className="num">{signed(bfTotal!)} pts since {fmtLong(bfRows[0].date)}</b></div>
          <MetricChart rows={entries} field="bodyFatPct" unit="%" label="Body fat" />
        </div>
      )}
      {entries.length > 0 && (
        <>
          <button className="lnk" onClick={() => setAll(a => !a)} aria-expanded={all}>{all ? 'Hide entries' : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, click one to correct it`}</button>
          {all && (
            <ul className="list trn-blist">
              {[...entries].reverse().map(r => editing === r.id
                ? <BodyEdit key={r.id} row={r} onDone={() => setEditing(null)} />
                : (
                  <li key={r.id}>
                    <button className="trn-brow" onClick={() => setEditing(r.id)} aria-label={`Edit the entry for ${fmtDay(r.date)}`}>
                      <span className="num">{fmtDay(r.date)}</span>
                      <span className="num">{r.weightKg != null ? `${r.weightKg.toFixed(1)} kg` : '–'}{r.bodyFatPct != null ? ` · ${r.bodyFatPct}%` : ''}</span>
                      {r.notes && <small>{r.notes}</small>}
                    </button>
                    <button onClick={() => del.mutate(r.id)} aria-label={`Delete the entry for ${fmtDay(r.date)}`}>×</button>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

export function BodyEdit({ row, onDone }: { row: BodyMetric; onDone: () => void }) {
  const upd = useUpdateBody()
  const [date, setDate] = useState(row.date)
  const [w, setW] = useState(row.weightKg != null ? String(row.weightKg) : '')
  const [bf, setBf] = useState(row.bodyFatPct != null ? String(row.bodyFatPct) : '')
  const [notes, setNotes] = useState(row.notes ?? '')
  const [err, setErr] = useState<string | null>(null)
  const num = (s: string) => { const v = parseFloat(s.replace(',', '.')); return Number.isFinite(v) ? v : null }
  const save = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    upd.mutate({ id: row.id, date, weightKg: num(w), bodyFatPct: num(bf), notes: notes.trim() || null }, {
      onSuccess: onDone,
      onError: (x: any) => setErr(x?.response?.data?.error ?? 'Could not save that entry.'),
    })
  }
  return (
    <li className="trn-bedit">
      <form onSubmit={save} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onDone() } }}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Date" />
        <input className="num" inputMode="decimal" value={w} onChange={e => setW(e.target.value)} placeholder="kg" aria-label="Weight in kg" autoFocus />
        <input className="num" inputMode="decimal" value={bf} onChange={e => setBf(e.target.value)} placeholder="BF %" aria-label="Body fat percent" />
        <input className="nt" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Note" aria-label="Note" />
        <button type="submit" className="wh-chase" disabled={upd.isPending}>Save</button>
        <button type="button" className="wh-chase" onClick={onDone}>Cancel</button>
      </form>
      {err && <p className="err">{err}</p>}
    </li>
  )
}

// ─── Start a workout: one tap ────────────────────────────────────────────────

function Start({ data, onStart, onManage }: { data: TrainingView; onStart: (t: string) => void; onManage: () => void }) {
  const lastOf = (name: string) => data.recent.find(r => r.name === name)?.date
  return (
    <section className="wh-card wh-start trn-start">
      <div className="hd">
        <div>
          <div className="wh-h" style={{ fontSize: 17 }}>Start a workout</div>
          <div className="wh-sub">Every set starts from last time. Tap ✓ if it matched, or nudge it up.</div>
        </div>
        <button className="wh-chase" onClick={onManage} aria-label="Create, edit or delete templates">Templates</button>
      </div>
      <div className="tpls">
        {data.templates.map(t => {
          const d = lastOf(t.name)
          const c = catMeta(t.category)
          return (
            <button key={t.id} onClick={() => onStart(t.name)} aria-label={`Start ${t.name}`}>
              <b>{t.name}</b>
              <small title={c.label}><i className="trn-dot" style={{ background: c.color }} />{t.exercises.length} exercises{d ? ` · last ${fmtShort(d)}` : ''}</small>
            </button>
          )
        })}
        <button className="other" onClick={() => onStart('')} aria-label="Start an empty workout"><b>Something else</b><small>start empty</small></button>
      </div>
    </section>
  )
}

// ─── Lifts: estimated one-rep max over time ──────────────────────────────────

function Spark({ l }: { l: Lift }) {
  const W = 150, H = 34
  const vals = l.history.map(h => h.e1rm)
  const lo = Math.min(...vals, l.best.e1rm) * 0.95, hi = Math.max(...vals, l.best.e1rm) * 1.02
  const x = (i: number) => (vals.length === 1 ? W / 2 : (i / (vals.length - 1)) * (W - 6) + 3)
  const y = (v: number) => H - 3 - ((v - lo) / Math.max(1, hi - lo)) * (H - 6)
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  return (
    <svg width={W} height={H} aria-hidden>
      <line x1="0" x2={W} y1={y(l.best.e1rm)} y2={y(l.best.e1rm)} stroke="rgb(var(--k-fg) / .18)" strokeDasharray="2 3" />
      <polyline points={pts} fill="none" stroke="var(--k-ink2)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r="3" fill={l.current >= l.best.e1rm ? 'var(--k-good)' : l.stalled ? 'var(--k-warn)' : 'var(--k-ink2)'} />
    </svg>
  )
}

function Lifts({ lifts }: { lifts: Lift[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? lifts : lifts.slice(0, 8)
  return (
    <section className="wh-card wh-lifts">
      <div className="hd">
        <div>
          <div className="wh-h" style={{ fontSize: 17 }}>Are you getting stronger?</div>
          <div className="wh-sub">Estimated one-rep max per lift, from your best set each session. The dotted line is your best ever.</div>
        </div>
      </div>
      <div className="tbl">
        <div className="tr th"><span>Lift</span><span>Trend</span><span>Now</span><span>8 weeks</span><span>Best</span></div>
        {shown.map(l => (
          <div key={l.name} className="tr">
            <span className="n">{l.name}<small>{l.sessions} sessions · last {fmtDay(l.lastDate)}</small></span>
            <span><Spark l={l} /></span>
            <span className="num v">{kg(l.current)}</span>
            <span className="num" style={{ color: l.change > 0 ? 'var(--k-good)' : l.change < 0 ? 'var(--k-bad)' : 'var(--k-mute)' }}>{l.change > 0 ? '+' : ''}{kg(l.change)}</span>
            <span className="b">
              <span className="num">{kg(l.best.e1rm)}</span>
              <small>{l.current >= l.best.e1rm ? <b style={{ color: 'var(--k-good)' }}>at your best</b> : l.stalled ? <b style={{ color: 'var(--k-warn)' }}>stalled 3 sessions</b> : fmtDay(l.best.date)}</small>
            </span>
          </div>
        ))}
      </div>
      {lifts.length > 8 && <button className="wh-chase" style={{ marginTop: 12 }} onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `All ${lifts.length} lifts`}</button>}
    </section>
  )
}

// ─── Personal records: the heaviest set per exercise ─────────────────────────

function Records({ workouts }: { workouts: Workout[] }) {
  const [all, setAll] = useState(false)
  const prs = useMemo(() => personalRecords(workouts), [workouts])
  if (!prs.length) return null
  const newest = [...prs].sort((a, b) => b.date.localeCompare(a.date))[0]
  const shown = all ? prs : prs.slice(0, 10)
  return (
    <section className="wh-card trn-card">
      <div className="hd">
        <div>
          <div className="wh-h" style={{ fontSize: 17 }}>Personal records</div>
          <div className="wh-sub">Your heaviest set on {prs.length} exercise{prs.length === 1 ? '' : 's'}. Newest: {newest.name}, {newest.kg} kg × {newest.reps} on {fmtLong(newest.date)}.</div>
        </div>
      </div>
      <div className="trn-prs">
        {shown.map(p => (
          <div key={p.name} className="pr" title={`${p.name}: ${p.kg} kg × ${p.reps} on ${fmtLong(p.date)}`}>
            <span className="n">{p.name}</span>
            <b className="num">{p.kg}<small>kg × {p.reps}</small></b>
            <span className="d num">{fmtLong(p.date)}</span>
          </div>
        ))}
      </div>
      {prs.length > 10 && <button className="wh-chase" style={{ marginTop: 12 }} onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `All ${prs.length} records`}</button>}
    </section>
  )
}

// ─── One exercise over time ──────────────────────────────────────────────────

function Progress({ workouts, lifts }: { workouts: Workout[]; lifts: Lift[] }) {
  const names = useMemo(() => {
    const s = new Set<string>()
    for (const w of workouts) for (const e of w.exercises) if ((e.weight ?? []).some(x => x > 0)) s.add(e.exerciseName.trim())
    return [...s].sort()
  }, [workouts])
  const [pick, setPick] = useState('')
  const ex = pick && names.includes(pick) ? pick : (lifts.find(l => names.includes(l.name))?.name ?? names[0] ?? '')
  const series = useMemo(() => (ex ? exerciseSeries(workouts, ex) : []), [workouts, ex])
  if (!names.length) return null
  const first = series[0], last = series[series.length - 1]
  const best = series.reduce((m, s) => Math.max(m, s.maxKg), 0)
  const bestE1 = series.reduce((m, s) => Math.max(m, s.e1rm), 0)
  const change = first && last && series.length > 1 ? r1(last.e1rm - first.e1rm) : null

  return (
    <section className="wh-card trn-card">
      <div className="hd">
        <div>
          <div className="wh-h" style={{ fontSize: 17 }}>Exercise progress</div>
          <div className="wh-sub">
            {!series.length ? 'No sets with a weight on this one yet.'
              : series.length === 1 ? `One session so far: ${last.maxKg} kg on ${fmtLong(last.date)}. Log it again to see a trend.`
              : <>Heaviest {best} kg, best estimated 1RM {kg(bestE1)}. {change != null && <>Estimated 1RM <b className="num" style={{ color: change > 0 ? 'var(--k-good)' : change < 0 ? 'var(--k-bad)' : 'var(--k-ink2)' }}>{change > 0 ? '+' : ''}{kg(change)}</b> since {fmtLong(first.date)}.</>}</>}
          </div>
        </div>
        <select className="trn-select" value={ex} onChange={e => setPick(e.target.value)} aria-label="Pick an exercise">
          {names.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      {series.length > 1 && (
        <>
          <div className="trn-legend">
            <span><i style={{ background: 'var(--k-ink)' }} />Estimated 1RM</span>
            <span><i className="dash" />Heaviest weight</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} stroke="rgb(var(--k-fg) / .05)" />
              <XAxis dataKey="date" tick={tick} axisLine={false} tickLine={false} tickFormatter={fmtShort} minTickGap={30} />
              <YAxis tick={tick} axisLine={false} tickLine={false} domain={niceDomain(series.flatMap(s => [s.maxKg, s.e1rm]), 5)} tickFormatter={v => String(Math.round(v))} width={48} />
              <Tooltip {...chartTip} labelFormatter={l => fmtDay(String(l))} formatter={(v: any, n: any) => [`${v} kg`, n === 'e1rm' ? 'Estimated 1RM' : 'Heaviest weight']} />
              <Line type="monotone" dataKey="e1rm" stroke="var(--k-ink)" strokeWidth={2} dot={series.length <= 30 ? { r: 2.5, fill: 'var(--k-ink)', strokeWidth: 0 } : false} isAnimationActive={false} />
              <Line type="monotone" dataKey="maxKg" stroke="var(--k-mute)" strokeWidth={1.6} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </section>
  )
}

// ─── Consistency: weeks against the target, stacked by category ──────────────

function Consistency({ data, workouts, target }: { data: TrainingView; workouts: Workout[]; target: number }) {
  const H = 90
  const max = Math.max(target, ...data.weeks.map(w => w.count), 1)
  const past = data.weeks.slice(0, -1)
  const hit = past.filter(w => w.count >= target).length
  const avg = r1(past.reduce((s, w) => s + w.count, 0) / Math.max(1, past.length))
  const streak = targetStreak(workouts, data.today, target)
  const used = CATEGORIES.filter(c => data.weeks.some(w => (w.byCat?.[c.value] ?? 0) > 0))
  return (
    <section className="wh-card wh-hist">
      <div className="hd">
        <div className="wh-h">Workouts per week</div>
        <div className="wh-sub">{hit} of the last {past.length} weeks hit {target}</div>
      </div>
      <p className="trn-answer">
        {streak.weeks > 0 ? <><b style={{ color: 'var(--k-good)' }}>{streak.weeks} {streak.weeks === 1 ? 'week' : 'weeks'} in a row</b> at {target} or more. </> : <>No current run of weeks at {target}. </>}
        Average {avg} a week.
      </p>
      <div className="wh-cons" style={{ height: H + 22 }}>
        <div className="tgt" style={{ bottom: 22 + (target / max) * H }}><span>{target}</span></div>
        {data.weeks.map((w, i) => {
          const cur = i === data.weeks.length - 1
          const parts = CATEGORIES.map(c => ({ c, n: w.byCat?.[c.value] ?? 0 })).filter(p => p.n > 0)
          const other = w.count - parts.reduce((s, p) => s + p.n, 0)
          const tip = `Week of ${fmtDay(w.start)}: ${w.count}${parts.length ? ` (${parts.map(p => `${p.n} ${p.c.label.toLowerCase()}`).join(', ')})` : ''}`
          return (
            <div key={w.start} className="col" title={tip}>
              <div className={`trn-stack ${cur ? 'cur' : ''}`} style={{ height: Math.max(2, (w.count / max) * H) }}>
                {w.count === 0 && <i style={{ flex: 1, background: 'rgb(var(--k-fg) / .06)' }} />}
                {other > 0 && <i style={{ flex: other, background: 'rgb(var(--k-fg) / .22)' }} />}
                {[...parts].reverse().map(p => <i key={p.c.value} style={{ flex: p.n, background: p.c.color }} />)}
              </div>
              <span className="num" style={{ color: w.count >= target ? 'var(--k-good)' : undefined }}>{w.count}</span>
            </div>
          )
        })}
      </div>
      {used.length > 0 && (
        <div className="trn-legend" style={{ marginTop: 10 }}>
          {used.map(c => <span key={c.value}><i style={{ background: c.color }} />{c.label}</span>)}
          <span><i className="cur" />This week</span>
        </div>
      )}
      <p className="wh-sub" style={{ marginTop: 10 }}>Rest days never break anything here. Only the week counts.</p>
    </section>
  )
}

// ─── Every workout: filter, expand, edit, delete, keep as a template ─────────

function History({ data, workouts, onEdit }: { data: TrainingView; workouts: Workout[]; onEdit: (w: Workout) => void }) {
  const [cat, setCat] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<number | null>(null)
  const [limit, setLimit] = useState(15)
  const del = useDeleteWorkout()
  const sorted = useMemo(() => [...workouts].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id), [workouts])
  const list = cat ? sorted.filter(w => w.category === cat) : sorted
  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map(c => [c.value, workouts.filter(w => w.category === c.value).length])), [workouts])
  const last30 = workouts.filter(w => daysBetween(w.date, data.today) < 30 && w.date <= data.today).length
  const oldest = sorted[sorted.length - 1]

  return (
    <section className="wh-card wh-why trn-history">
      <div className="hd">
        <div className="wh-h">Workout history</div>
        <div className="wh-sub num">{workouts.length} total</div>
      </div>
      <p className="trn-answer">
        {workouts.length ? <>{workouts.length} workout{workouts.length === 1 ? '' : 's'} since {fmtLong(oldest.date)}, {last30} in the last 30 days.</> : 'Nothing logged yet. Start a workout and it lands here.'}
      </p>
      {workouts.length > 0 && (
        <div className="trn-filter" role="group" aria-label="Filter by category">
          <button className={!cat ? 'on' : ''} onClick={() => setCat('')} aria-pressed={!cat}>All</button>
          {CATEGORIES.filter(c => counts[c.value] > 0).map(c => (
            <button key={c.value} className={cat === c.value ? 'on' : ''} onClick={() => setCat(cat === c.value ? '' : c.value)} aria-pressed={cat === c.value}>
              <i className="trn-dot" style={{ background: c.color }} />{c.label}<small className="num">{counts[c.value]}</small>
            </button>
          ))}
        </div>
      )}
      {list.slice(0, limit).map(w => {
        const c = catMeta(w.category)
        const vol = workoutVolume(w)
        const peak = peakRpe(w)
        const isOpen = open === w.id
        return (
          <div key={w.id} className="wh-sess trn-sess">
            <button className="row" onClick={() => setOpen(isOpen ? null : w.id)} aria-expanded={isOpen} aria-label={`${w.name}, ${fmtDay(w.date)}. Show details`}>
              <span className="num d">{fmtDay(w.date)}</span>
              <span className="n"><i className="trn-dot" style={{ background: c.color }} />{w.name}</span>
              <span className="wh-sub meta num">
                {[w.durationMinutes ? `${w.durationMinutes} min` : '', vol > 0 ? volLabel(vol) : '', peak > 0 ? `RPE ${peak}` : ''].filter(Boolean).join(' · ') || `${w.exercises.length} exercises`}
              </span>
            </button>
            {isOpen && (
              <div className="trn-detail">
                <div className="trn-tags">
                  <span>{c.label}</span>
                  {w.durationMinutes ? <span className="num">{w.durationMinutes} min</span> : null}
                  {vol > 0 && <span className="num">{Math.round(vol).toLocaleString('en-GB')} kg volume</span>}
                  {peak > 0 && <span className="num">Peak RPE {peak}</span>}
                  {w.rpe ? <span className="num">Overall RPE {w.rpe}</span> : null}
                </div>
                {w.exercises.length > 0 && (
                  <table className="trn-table">
                    <thead><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>kg</th><th>Volume</th><th>RPE</th></tr></thead>
                    <tbody>
                      {w.exercises.map(e => {
                        const v = exVolume(e)
                        return (
                          <tr key={e.id}>
                            <td>{e.exerciseName}</td>
                            <td className="num">{e.sets ?? (e.reps ?? []).length}</td>
                            <td className="num">{(e.reps ?? []).join(', ') || '–'}</td>
                            <td className="num">{(e.weight ?? []).join(', ') || '–'}</td>
                            <td className="num">{v > 0 ? Math.round(v).toLocaleString('en-GB') : '–'}</td>
                            <td className="num">{e.rpe ?? '–'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
                {w.notes && <p className="trn-notes">{w.notes}</p>}
                <div className="trn-actions">
                  <button className="wh-chase" onClick={() => onEdit(w)} aria-label={`Edit ${w.name} on ${fmtDay(w.date)}`}>Edit</button>
                  <SaveAsTemplate data={data} name={w.name} category={w.category} exercises={w.exercises.map(e => ({ exerciseName: e.exerciseName, defaultSets: e.sets ?? (e.reps ?? []).length }))} />
                  {confirm === w.id
                    ? <span className="del"><span>Delete this workout?</span><button onClick={() => setConfirm(null)}>Keep</button><button className="bad" onClick={() => { del.mutate(w.id); setConfirm(null); setOpen(null) }}>Delete</button></span>
                    : <button className="wh-chase trn-delbtn" onClick={() => setConfirm(w.id)} aria-label={`Delete ${w.name} on ${fmtDay(w.date)}`}>Delete</button>}
                </div>
              </div>
            )}
          </div>
        )
      })}
      {list.length > limit && <button className="wh-chase" style={{ marginTop: 12 }} onClick={() => setLimit(l => l + 30)}>{list.length - limit > 30 ? `Show 30 more of ${list.length - limit}` : `Show the other ${list.length - limit}`}</button>}
    </section>
  )
}

/** One click: keeps a workout's shape as a template, or refreshes the template of the same name. */
export function SaveAsTemplate({ data, name, category, exercises }: { data: TrainingView; name: string; category: string; exercises: Template['exercises'] }) {
  const save = useSaveTemplate()
  const [done, setDone] = useState(false)
  const existing = data.templates.find(t => t.name.trim().toLowerCase() === name.trim().toLowerCase())
  const ok = name.trim() && exercises.some(e => e.exerciseName.trim())
  if (done) return <span className="trn-saved">{existing ? 'Template updated' : 'Saved as a template'}</span>
  return (
    <button type="button" className="wh-chase" disabled={!ok || save.isPending}
      title={!ok ? 'Needs a name and at least one exercise' : undefined}
      onClick={() => save.mutate({ id: existing?.id, name: name.trim(), category, exercises }, { onSuccess: () => setDone(true) })}>
      {existing ? `Update template "${existing.name}"` : 'Save as template'}
    </button>
  )
}

// ─── RPE: one tap, tap again to clear ────────────────────────────────────────

function RpePick({ value, onChange, label, title = 'RPE' }: { value: number | null; onChange: (v: number | null) => void; label: string; title?: string }) {
  return (
    <div className="trn-rpe" role="group" aria-label={label}>
      <span>{title}</span>
      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
        <button key={n} type="button" className={value === n ? 'on' : ''} aria-pressed={value === n} aria-label={`${label} ${n}`} onClick={() => onChange(value === n ? null : n)}>{n}</button>
      ))}
    </div>
  )
}

// ─── The logger: last time pre-filled, one tap per set ───────────────────────

type Ex = LogExercise & { key: string; skip: boolean; touched: boolean[] }

export function Logger({ data, init, onClose }: { data: TrainingView; init: LogInit; onClose: () => void }) {
  const log = useLogWorkout()
  const edit = 'edit' in init ? init.edit : null
  const tpl = 'template' in init ? data.templates.find(t => t.name === init.template) : undefined
  const [name, setName] = useState(edit?.name ?? tpl?.name ?? ('template' in init && init.template !== 'Workout' ? init.template : ''))
  const [category, setCategory] = useState(edit?.category ?? tpl?.category ?? 'strength')
  const [date, setDate] = useState(edit?.date ?? data.today)
  const [mins, setMins] = useState<number | null>(edit ? edit.durationMinutes : 60)
  const [rpe, setRpe] = useState<number | null>(edit?.rpe ?? null)
  const [notes, setNotes] = useState(edit?.notes ?? '')
  const [adding, setAdding] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [ex, setEx] = useState<Ex[]>(() => edit
    ? edit.exercises.map((e, i) => {
      const sets = (e.reps ?? []).map((r, j) => ({ reps: r, weight: (e.weight ?? [])[j] ?? 0 }))
      return { name: e.exerciseName, sets, rpe: e.rpe, key: `e${i}`, skip: false, touched: sets.map(() => true) }
    })
    : (tpl?.exercises ?? []).map((e, i) => {
      const sets = startingSets(data, e.exerciseName, e.defaultSets)
      return { name: e.exerciseName, sets, rpe: null, key: `${i}`, skip: false, touched: sets.map(() => false) }
    }))

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    if (!name) nameRef.current?.focus()
    return () => window.removeEventListener('keydown', esc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  const known = useMemo(() => Object.keys(data.last).sort(), [data.last])
  const patch = (k: string, f: (e: Ex) => Ex) => setEx(xs => xs.map(e => (e.key === k ? f(e) : e)))
  const setAt = (k: string, i: number, p: Partial<{ reps: number; weight: number }>) =>
    patch(k, e => ({ ...e, sets: e.sets.map((s, j) => (j === i ? { ...s, ...p } : s)), touched: e.touched.map((t, j) => (j === i ? true : t)) }))
  const mark = (k: string, i: number) => patch(k, e => ({ ...e, touched: e.touched.map((t, j) => (j === i ? !t : t)) }))
  const addEx = (n0: string) => {
    const n = n0.trim(); if (!n) return
    const sets = startingSets(data, n, 3)
    setEx(xs => [...xs, { name: n, sets, rpe: null, key: `a${xs.length}${Date.now()}`, skip: false, touched: sets.map(() => false) }]); setAdding('')
  }

  // New bests this session, worked out live (against history before this workout).
  const bests = ex.filter(e => !e.skip).map(e => {
    const best = data.progress.find(l => l.name === e.name)?.best.e1rm ?? 0
    const now = Math.max(0, ...e.sets.map(s => e1(s.weight, s.reps)))
    return now > best && best > 0 ? e.name : null
  }).filter(Boolean)

  const kept = ex.filter(e => !e.skip)
  const save = () => {
    setErr(null)
    if (!name.trim()) { setErr('Give the workout a name.'); nameRef.current?.focus(); return }
    log.mutate({ id: edit?.id, date, name: name.trim(), category, durationMinutes: mins, rpe, notes, exercises: kept }, {
      onSuccess: onClose,
      onError: (e: any) => setErr(e?.response?.data?.error ?? 'Could not save the workout.'),
    })
  }
  const minsOptions = [...new Set([30, 45, 60, 75, 90, 120, ...(mins ? [mins] : [])])].sort((a, b) => a - b)

  return (
    <div className="wh-sheet-bg" onMouseDown={onClose}>
      <div className="wh wh-sheet wh-logger trn-logger" role="dialog" aria-label={edit ? `Edit ${edit.name}` : 'Log a workout'} onMouseDown={e => e.stopPropagation()}>
        <div className="hd">
          <div className="trn-namewrap">
            <input ref={nameRef} className="trn-name" value={name} onChange={e => setName(e.target.value)} placeholder="Name it, e.g. 5K run" aria-label="Workout name" />
            <div className="wh-sub">{edit ? `Editing the workout from ${fmtDay(edit.date)}.` : 'Sets start from last time. ✓ when it matched, or change the numbers.'}</div>
          </div>
          <button className="wh-chase" onClick={onClose}>Close</button>
        </div>
        <div className="chips trn-cats" role="group" aria-label="Category">
          {CATEGORIES.map(c => (
            <button key={c.value} type="button" className={category === c.value ? 'on' : ''} aria-pressed={category === c.value} onClick={() => setCategory(c.value)}>
              <i className="trn-dot" style={{ background: c.color }} />{c.label}
            </button>
          ))}
        </div>
        <div className="meta">
          <label>Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label>Length
            <select value={mins ?? ''} onChange={e => setMins(e.target.value ? Number(e.target.value) : null)}>
              <option value="">not set</option>{minsOptions.map(m => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
          <RpePick value={rpe} onChange={setRpe} label="Overall RPE" title="Overall RPE" />
        </div>

        {ex.map(e => {
          const last = data.last[e.name]
          return (
            <div key={e.key} className={`exr ${e.skip ? 'skip' : ''}`}>
              <div className="eh">
                <b>{e.name}</b>
                {last && !edit && <span className="wh-sub">Last {fmtDay(last.date)}: {last.reps.map((r, i) => setLabel({ reps: r, weight: last.weight[i] ?? 0 })).join(' · ')}</span>}
                {last && !edit && <span className="beat">Beat it: {last.target}</span>}
                <button className="lnk" onClick={() => patch(e.key, x => ({ ...x, skip: !x.skip }))}>{e.skip ? 'Include' : edit ? 'Remove' : 'Skip'}</button>
              </div>
              {!e.skip && (
                <div className="sets">
                  {e.sets.map((s, i) => (
                    <div key={i} className={`set ${e.touched[i] ? 'ok' : ''}`}>
                      <span className="i num">{i + 1}</span>
                      <button className="chk" onClick={() => mark(e.key, i)} aria-pressed={e.touched[i]} aria-label={`Set ${i + 1} done as shown`}>✓</button>
                      <input className="num" type="number" step={0.5} min={0} value={s.weight} onChange={v => setAt(e.key, i, { weight: Number(v.target.value) })} aria-label="Weight in kg" /><span className="u">kg</span>
                      <input className="num" type="number" min={0} value={s.reps} onChange={v => setAt(e.key, i, { reps: Number(v.target.value) })} aria-label="Reps" /><span className="u">reps</span>
                      <button className="nudge" onClick={() => setAt(e.key, i, { reps: s.reps + 1 })}>+1 rep</button>
                      <button className="nudge" onClick={() => setAt(e.key, i, { weight: s.weight + 2.5 })}>+2.5 kg</button>
                      <button className="x" onClick={() => patch(e.key, x => ({ ...x, sets: x.sets.filter((_, j) => j !== i), touched: x.touched.filter((_, j) => j !== i) }))} aria-label="Remove set">×</button>
                    </div>
                  ))}
                  <div className="trn-exfoot">
                    <button className="lnk" onClick={() => patch(e.key, x => ({ ...x, sets: [...x.sets, { ...(x.sets[x.sets.length - 1] ?? { reps: 0, weight: 0 }) }], touched: [...x.touched, false] }))}>+ set</button>
                    <RpePick value={e.rpe ?? null} onChange={v => patch(e.key, x => ({ ...x, rpe: v }))} label={`RPE for ${e.name}`} />
                  </div>
                </div>
              )}
            </div>
          )
        })}

        <form className="add" onSubmit={e => { e.preventDefault(); addEx(adding) }}>
          <input list="wh-known-lifts" value={adding} onChange={e => setAdding(e.target.value)} placeholder="Add an exercise and press Enter" aria-label="Add exercise" />
          <datalist id="wh-known-lifts">{known.map(k => <option key={k} value={k} />)}</datalist>
        </form>

        <textarea className="trn-notesin" value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes: how it felt, anything to remember" aria-label="Workout notes" />

        <div className="foot">
          {bests.length > 0 && <span className="pr">New best on {bests.join(', ')}</span>}
          {err && <span style={{ color: 'var(--k-bad)', fontSize: 13 }}>{err}</span>}
          <SaveAsTemplate data={data} name={name} category={category} exercises={kept.map(e => ({ exerciseName: e.name, defaultSets: Math.max(1, e.sets.length) }))} />
          <button className="wh-btn" disabled={log.isPending} onClick={save}>{edit ? 'Save changes' : 'Save workout'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Templates: create, edit in place, delete ────────────────────────────────

export function Templates({ data, onClose }: { data: TrainingView; onClose: () => void }) {
  const [open, setOpen] = useState<number | 'new' | null>(data.templates.length ? null : 'new')
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="wh-sheet-bg" onMouseDown={onClose}>
      <div className="wh wh-sheet trn-tsheet" role="dialog" aria-label="Workout templates" onMouseDown={e => e.stopPropagation()}>
        <div className="hd">
          <div>
            <div className="wh-h" style={{ fontSize: 19 }}>Workout templates</div>
            <div className="wh-sub">{data.templates.length ? `${data.templates.length} template${data.templates.length === 1 ? '' : 's'}. Click one to change it.` : 'No templates yet. Make your first one below.'}</div>
          </div>
          <button className="wh-chase" onClick={onClose}>Close</button>
        </div>
        <div className="trn-tlist">
          {data.templates.map(t => open === t.id
            ? <TemplateEdit key={t.id} data={data} tpl={t} onDone={() => setOpen(null)} />
            : (
              <button key={t.id} className="trn-trow" onClick={() => setOpen(t.id)} aria-label={`Edit template ${t.name}`}>
                <span className="n"><i className="trn-dot" style={{ background: catMeta(t.category).color }} />{t.name}</span>
                <span className="wh-sub">{catMeta(t.category).label} · {t.exercises.length} exercises · {t.exercises.reduce((s, e) => s + (e.defaultSets ?? 0), 0)} sets</span>
              </button>
            ))}
          {open === 'new'
            ? <TemplateEdit data={data} onDone={() => setOpen(null)} />
            : <button className="wh-addrow" onClick={() => setOpen('new')}>+ New template</button>}
        </div>
      </div>
    </div>
  )
}

function TemplateEdit({ data, tpl, onDone }: { data: TrainingView; tpl?: Template; onDone: () => void }) {
  const save = useSaveTemplate()
  const del = useDeleteTemplate()
  const [name, setName] = useState(tpl?.name ?? '')
  const [category, setCategory] = useState(tpl?.category ?? 'strength')
  const [rows, setRows] = useState(tpl?.exercises.map(e => ({ ...e })) ?? [])
  const [adding, setAdding] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const known = useMemo(() => Object.keys(data.last).sort(), [data.last])
  const add = () => { const n = adding.trim(); if (!n) return; setRows(r => [...r, { exerciseName: n, defaultSets: 3 }]); setAdding('') }
  const submit = () => {
    setErr(null)
    if (!name.trim()) { setErr('Give the template a name.'); return }
    const pending = adding.trim() ? [...rows, { exerciseName: adding.trim(), defaultSets: 3 }] : rows
    save.mutate({ id: tpl?.id, name, category, exercises: pending }, {
      onSuccess: onDone,
      onError: (e: any) => setErr(e?.response?.data?.error ?? 'Could not save the template.'),
    })
  }
  return (
    <div className="trn-tedit" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onDone() } }}>
      <input className="in" value={name} onChange={e => setName(e.target.value)} placeholder="Template name, e.g. Push Day A" aria-label="Template name" autoFocus={!tpl} />
      <div className="chips" role="group" aria-label="Category">
        {CATEGORIES.map(c => (
          <button key={c.value} type="button" className={category === c.value ? 'on' : ''} aria-pressed={category === c.value} onClick={() => setCategory(c.value)}>
            <i className="trn-dot" style={{ background: c.color }} />{c.label}
          </button>
        ))}
      </div>
      <div className="trn-terows">
        {rows.map((r, i) => (
          <div key={i} className="r">
            <input value={r.exerciseName} onChange={e => setRows(rs => rs.map((x, j) => (j === i ? { ...x, exerciseName: e.target.value } : x)))} aria-label={`Exercise ${i + 1}`} />
            <div className="st">
              <button type="button" onClick={() => setRows(rs => rs.map((x, j) => (j === i ? { ...x, defaultSets: Math.max(1, x.defaultSets - 1) } : x)))} aria-label={`One set fewer for ${r.exerciseName}`}>−</button>
              <b className="num">{r.defaultSets}</b><span>sets</span>
              <button type="button" onClick={() => setRows(rs => rs.map((x, j) => (j === i ? { ...x, defaultSets: Math.min(20, x.defaultSets + 1) } : x)))} aria-label={`One set more for ${r.exerciseName}`}>+</button>
            </div>
            <button type="button" className="x" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} aria-label={`Remove ${r.exerciseName}`}>×</button>
          </div>
        ))}
        <form onSubmit={e => { e.preventDefault(); add() }}>
          <input className="in" list="wh-tpl-lifts" value={adding} onChange={e => setAdding(e.target.value)} placeholder="Add an exercise and press Enter" aria-label="Add exercise to template" />
          <datalist id="wh-tpl-lifts">{known.map(k => <option key={k} value={k} />)}</datalist>
        </form>
      </div>
      <div className="trn-tfoot">
        {tpl && (confirm
          ? <span className="del"><span>Delete this template?</span><button onClick={() => setConfirm(false)}>Keep</button><button className="bad" onClick={() => del.mutate(tpl.id, { onSuccess: onDone })}>Delete</button></span>
          : <button className="wh-chase trn-delbtn" onClick={() => setConfirm(true)}>Delete template</button>)}
        {err && <span style={{ color: 'var(--k-bad)', fontSize: 13 }}>{err}</span>}
        <button className="wh-chase" onClick={onDone}>Cancel</button>
        <button className="wh-btn" onClick={submit} disabled={save.isPending}>{tpl ? 'Save template' : 'Create template'}</button>
      </div>
    </div>
  )
}
