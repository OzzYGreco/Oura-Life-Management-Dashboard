/**
 * Training, the one-layout redesign (approved 2026-11-08). The hero answers
 * "am I getting stronger?" and starts a workout in one tap, with the template
 * that is next in rotation marked. The side shows this week against the
 * target and 12 weeks of consistency. Lifts carry their own progress chart,
 * body weight logs on any date with a note, and history keeps every action
 * (edit, save as template, delete with a confirm). The logger and the
 * template sheet are shared with the Whoop page.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  CATEGORIES, catMeta, computeInsight, exVolume, exerciseSeries, kg, peakRpe, personalRecords, sundayOf, targetStreak,
  useAllWorkouts, useBodyMetrics, useDeleteBody, useDeleteWorkout, useLogBody, useTraining, workoutVolume,
  type BodyMetric, type Lift, type TrainingView, type Workout,
} from '../../core/training'
import { useWeek } from '../../core/week'
import { PageLoader } from '../../components/ui/Spinner'
import { BodyEdit, Logger, MetricChart, SaveAsTemplate, Templates, type LogInit } from '../whoop/Training'
import './next.css'
import './training.css'

const fmtDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const fmtShort = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const fmtLong = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const r1 = (n: number) => Math.round(n * 10) / 10
const signed = (n: number, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(d)}`
const volLabel = (v: number) => (v >= 10000 ? `${(v / 1000).toFixed(1)} t` : `${Math.round(v).toLocaleString('en-GB')} kg`)
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 864e5)
/** A template not trained for this many days is called out. */
const STALE = 10
/** RPE 9 and 10 are near the limit: worth noticing, so they read amber. */
const rpeTone = (n: number) => (n >= 9 ? 'warn' : '')

function Head({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return <div className="nx-head"><h2 className="nx-h">{children}</h2>{aside && <div className="nx-aside">{aside}</div>}</div>
}

/**
 * The template that is next in rotation: of the templates trained before, the
 * one done longest ago. A template never done stays out of the rotation.
 */
function rotation(data: TrainingView) {
  const last = new Map<string, string>()
  for (const r of data.recent) if (!last.has(r.name)) last.set(r.name, r.date)
  const done = data.templates.filter(t => last.has(t.name)).sort((a, b) => last.get(a.name)!.localeCompare(last.get(b.name)!))
  return { last, next: done.length > 1 ? done[0].name : null }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function NextTraining() {
  const { data, isPending } = useTraining()
  const all = useAllWorkouts()
  const week = useWeek()
  const [logParam] = useState(() => new URLSearchParams(window.location.search).get('log'))
  const [logging, setLogging] = useState<LogInit | null>(null)
  const [templates, setTemplates] = useState(false)
  const opened = useRef(false)

  // ?log=<template> opens the logger; ?log=next opens whatever is next in rotation.
  useEffect(() => {
    if (!data || !logParam || opened.current) return
    opened.current = true
    const t = logParam === 'next' ? (rotation(data).next ?? '') : logParam
    setLogging({ template: t })
  }, [data, logParam])

  if (isPending || !data) return <PageLoader />
  const target = week.data?.current?.tasks.find(t => t.source === 'workouts')?.target ?? 4
  const workouts = all.data ?? []
  const start = (t: string) => setLogging({ template: t })

  return (
    <div className="wh-page wh-train nx ntr skin-enter">
      <div className="nx-wrap">
        <div className="nx-top">
          <Hero data={data} workouts={workouts} onStart={start} onManage={() => setTemplates(true)} />
          <div className="ntr-side">
            <ThisWeek data={data} workouts={workouts} target={target} />
            <Consistency data={data} target={target} />
          </div>
        </div>
        <div className="ntr-row">
          <div className="ntr-main">
            <Lifts workouts={workouts} lifts={data.progress} />
            <History data={data} workouts={workouts} onEdit={w => setLogging({ edit: w })} />
          </div>
          <div className="ntr-aside">
            <Body today={data.today} />
            <Records workouts={workouts} />
          </div>
        </div>
      </div>
      {!logging && !templates && <Keys data={data} onStart={start} />}
      {logging && <Logger data={data} init={logging} onClose={() => setLogging(null)} />}
      {templates && <Templates data={data} onClose={() => setTemplates(false)} />}
    </div>
  )
}

/** 1 to 9 start a template, N starts an empty workout, W jumps to the weight field. */
function Keys({ data, onStart }: { data: TrainingView; onStart: (t: string) => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest('input, textarea, select, [contenteditable="true"]')) return
      const n = Number(e.key)
      if (n >= 1 && n <= data.templates.length) { e.preventDefault(); onStart(data.templates[n - 1].name) }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); onStart('') }
      else if (e.key === 'w' || e.key === 'W') { e.preventDefault(); document.getElementById('ntr-weight')?.focus() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [data, onStart])
  return null
}

// ─── Hero: the answer, the signal, one tap to start ──────────────────────────

function Hero({ data, workouts, onStart, onManage }: { data: TrainingView; workouts: Workout[]; onStart: (t: string) => void; onManage: () => void }) {
  const lifts = data.progress.filter(l => l.sessions >= 3)
  const up = lifts.filter(l => l.change > 0).sort((a, b) => b.change - a.change)
  const below = lifts.filter(l => l.current < l.best.e1rm)
  const atBest = lifts.filter(l => l.current >= l.best.e1rm)
  const last = data.recent[0]
  const wk = sundayOf(data.today)
  const volume = workouts.filter(w => sundayOf(w.date) === wk).reduce((s, w) => s + workoutVolume(w), 0)
  const timed = workouts.filter(w => w.durationMinutes)
  const avgMin = timed.length ? Math.round(timed.reduce((s, w) => s + (w.durationMinutes ?? 0), 0) / timed.length) : 0
  const rot = rotation(data)

  let kick: [string, string], h1: React.ReactNode, sub = ''
  if (!lifts.length) { kick = ['Just starting', '']; h1 = 'Log a few workouts and your progress shows up here.' }
  else if (atBest.length >= lifts.length / 2) {
    kick = ['Getting stronger', 'good']; h1 = <>{atBest.length} of {lifts.length} lifts are at their best</>
    sub = up[0] ? `${up[0].name} is up ${kg(up[0].change)} in 8 weeks.` : ''
  } else if (up.length) {
    kick = ['Rebuilding', 'warn']; h1 = <>{up[0].name} is up {kg(up[0].change)} in 8 weeks</>
    sub = `${below.length} of ${lifts.length} lifts are still below their best.`
  } else {
    kick = ['Stalled', 'bad']; h1 = 'No lift has gone up in 8 weeks'
    sub = `${below.length} of ${lifts.length} lifts are below their best.`
  }

  return (
    <section className="nx-hero ntr-hero" aria-label="Training">
      <div className="ntr-top">
        <p className={`nx-state ${kick[1]}`}>{kick[0]}</p>
        <h1 className="ntr-h1">{h1}{sub && <span> {sub}</span>}</h1>
        <SignalLine />
        <div className="ntr-starts" role="group" aria-label="Start a workout">
          {data.templates.map((t, i) => {
            const d = rot.last.get(t.name)
            const ago = d ? daysBetween(d, data.today) : null
            const isNext = rot.next === t.name
            const stale = ago != null && ago >= STALE
            return (
              <button key={t.id} className={`ntr-start ${isNext ? 'next' : ''}`} onClick={() => onStart(t.name)} aria-label={`Start ${t.name}`}>
                <span className="t"><i className="nx-dot" style={{ color: catMeta(t.category).color }} />{t.name}{i < 9 && <kbd>{i + 1}</kbd>}</span>
                <span className={`s ${stale ? 'warn' : ''}`}>
                  {isNext && <b>Next up · </b>}
                  {ago == null ? `${t.exercises.length} exercises, not done yet` : ago === 0 ? 'done today' : stale ? `${ago} days since` : `last ${fmtShort(d!)}`}
                </span>
              </button>
            )
          })}
          <button className="ntr-start other" onClick={() => onStart('')} aria-label="Start an empty workout">
            <span className="t">Something else<kbd>N</kbd></span>
            <span className="s">start empty</span>
          </button>
        </div>
        <BeatIt data={data} name={rot.next ?? data.recent.find(r => data.templates.some(t => t.name === r.name))?.name ?? null} />
      </div>
      <div className="ntr-facts">
        <div><span>Volume this week</span><b className="num">{volume > 0 ? volLabel(volume) : '–'}</b></div>
        <div><span>Average session</span><b className="num">{avgMin || '–'}{avgMin ? <small> min</small> : null}</b></div>
        <div><span>Last workout</span><b>{last ? last.name : '–'}{last && <small> {fmtShort(last.date)}</small>}</b></div>
        <div><span>Lifts tracked</span><b className="num">{data.progress.length}</b></div>
        <button className="nx-btn ghost sm" onClick={onManage} aria-label="Create, edit or delete templates">Templates</button>
      </div>
    </section>
  )
}

/** What to beat in the workout that is next: last time and the target, per exercise. */
function BeatIt({ data, name }: { data: TrainingView; name: string | null }) {
  const tpl = data.templates.find(t => t.name === name)
  const rows = (tpl?.exercises ?? []).map(e => ({ name: e.exerciseName, last: data.last[e.exerciseName] })).filter(r => r.last)
  if (!tpl || !rows.length) return null
  return (
    <div className="ntr-beat">
      <p className="ntr-beat-h">To beat in <b>{tpl.name}</b>, from {fmtShort(rows[0].last.date)}</p>
      <div className="ntr-beat-g">
        {rows.slice(0, 6).map(r => (
          <div key={r.name}>
            <span>{r.name}</span>
            <b className="num">{r.last.target}</b>
            <small className="num">last {r.last.reps.map((n, i) => (r.last.weight[i] ? `${r.last.weight[i]}×${n}` : `${n}`)).join(', ')}</small>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The body composition signal as one caption; the reasoning opens beneath it. */
function SignalLine() {
  const metrics = useBodyMetrics()
  const workouts = useAllWorkouts()
  const insight = useMemo(() => computeInsight(metrics.data ?? [], workouts.data ?? []), [metrics.data, workouts.data])
  const [open, setOpen] = useState(false)
  if (!insight) return null
  return (
    <div className="ntr-signal">
      <p>
        <i className={`nx-dot ${insight.color}`} />
        <b>{insight.pattern}.</b> {insight.action}{' '}
        <button className="ntr-lnk" onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? 'Less' : 'Why'}</button>
      </p>
      {open && (
        <div className="ntr-why">
          <p>{insight.what}</p>
          <p>{insight.why}</p>
          <div className="nx-figs">
            {insight.weightChange != null && <div><span>Weight</span><b className="num">{signed(insight.weightChange)} kg</b></div>}
            {insight.liftPct != null && <div><span>Lifts, earlier vs recent</span><b className={`num ${insight.liftPct > 4 ? 'good' : insight.liftPct < -4 ? 'bad' : ''}`}>{insight.liftPct > 0 ? '+' : ''}{insight.liftPct.toFixed(1)}%</b></div>}
            <div><span>Lifts tracked</span><b className="num">{insight.trackedExercises}</b></div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Side: this week, then the last 12 ───────────────────────────────────────

function ThisWeek({ data, workouts, target }: { data: TrainingView; workouts: Workout[]; target: number }) {
  const n = data.weeks[data.weeks.length - 1]?.count ?? 0
  const streak = targetStreak(workouts, data.today, target)
  const left = Math.max(0, target - n)
  const daysLeft = 6 - new Date(data.today + 'T12:00:00').getDay()
  return (
    <section className="nx-sec">
      <Head aside="Target from your week">This week</Head>
      <div className="nx-split ntr-wk">
        <div className="nx-wk">
          <span className={`nx-mid num ${n >= target ? 'good' : ''}`}>{n}</span>
          <span className="nx-of">of {target}</span>
        </div>
        <div className="nx-segs" aria-hidden>{Array.from({ length: Math.max(target, n) }, (_, i) => <i key={i} className={i < n ? 'f' : ''} />)}</div>
      </div>
      <p className="ntr-cap">
        {n >= target ? 'Target hit.' : left > daysLeft + 1 ? `${left} to go with ${daysLeft + 1} day${daysLeft ? 's' : ''} left: out of reach this week.` : `${left} to go, ${daysLeft + 1} day${daysLeft ? 's' : ''} left.`}
        {' '}{streak.weeks > 0 ? <><b className="good">{streak.weeks} {streak.weeks === 1 ? 'week' : 'weeks'} in a row</b> at {target}+.</> : `No current run at ${target}+.`}
      </p>
    </section>
  )
}

function Consistency({ data, target }: { data: TrainingView; target: number }) {
  const H = 150
  const max = Math.max(target, ...data.weeks.map(w => w.count), 1)
  const past = data.weeks.slice(0, -1)
  const hit = past.filter(w => w.count >= target).length
  const avg = r1(past.reduce((s, w) => s + w.count, 0) / Math.max(1, past.length))
  const used = CATEGORIES.filter(c => data.weeks.some(w => (w.byCat?.[c.value] ?? 0) > 0))
  return (
    <section className="nx-sec ntr-cons-sec">
      <Head aside={<span className="num">{hit} of {past.length} hit</span>}>Workouts per week</Head>
      <div className="ntr-cons" style={{ height: H + 20 }}>
        <div className="tgt" style={{ bottom: 20 + (target / max) * H }}><span className="num">{target}</span></div>
        {data.weeks.map((w, i) => {
          const cur = i === data.weeks.length - 1
          const parts = CATEGORIES.map(c => ({ c, n: w.byCat?.[c.value] ?? 0 })).filter(p => p.n > 0)
          const other = w.count - parts.reduce((s, p) => s + p.n, 0)
          const tip = `Week of ${fmtDay(w.start)}: ${w.count}${parts.length ? ` (${parts.map(p => `${p.n} ${p.c.label.toLowerCase()}`).join(', ')})` : ''}`
          return (
            <div key={w.start} className="col" title={tip}>
              <div className={`stk ${cur ? 'cur' : ''}`} style={{ height: Math.max(2, (w.count / max) * H) }}>
                {w.count === 0 && <i style={{ flex: 1, background: 'rgb(var(--k-fg) / .06)' }} />}
                {other > 0 && <i style={{ flex: other, background: 'rgb(var(--k-fg) / .22)' }} />}
                {[...parts].reverse().map(p => <i key={p.c.value} style={{ flex: p.n, background: p.c.color }} />)}
              </div>
              <span className={`num ${w.count >= target ? 'good' : ''}`}>{w.count}</span>
            </div>
          )
        })}
      </div>
      {used.length > 0 && (
        <div className="trn-legend">
          {used.map(c => <span key={c.value}><i style={{ background: c.color }} />{c.label}</span>)}
          <span><i className="cur" />This week</span>
        </div>
      )}
      <p className="ntr-cap">Average {avg} a week. Rest days never break anything here; only the week counts.</p>
    </section>
  )
}

// ─── Lifts: the chart for the one you pick, the table for all ────────────────

const chartTip = {
  contentStyle: { background: 'var(--k-card2)', border: '1px solid var(--k-line2)', borderRadius: 12, fontSize: 12.5, padding: '6px 10px' },
  labelStyle: { color: 'var(--k-mute)', marginBottom: 2 },
  itemStyle: { color: 'var(--k-ink)', padding: 0 },
}
const tick = { fill: 'var(--k-faint)', fontSize: 11, fontFamily: 'var(--k-font)' }
const niceDomain = (vals: number[], step: number): [number, number] => {
  const lo = Math.min(...vals), hi = Math.max(...vals)
  return [Math.max(0, Math.floor((lo - step / 2) / step) * step), Math.ceil((hi + step / 2) / step) * step]
}

function Spark({ l }: { l: Lift }) {
  const W = 120, H = 28
  const vals = l.history.map(h => h.e1rm)
  const lo = Math.min(...vals, l.best.e1rm) * 0.95, hi = Math.max(...vals, l.best.e1rm) * 1.02
  const x = (i: number) => (vals.length === 1 ? W / 2 : (i / (vals.length - 1)) * (W - 6) + 3)
  const y = (v: number) => H - 3 - ((v - lo) / Math.max(1, hi - lo)) * (H - 6)
  return (
    <svg width={W} height={H} aria-hidden>
      <line x1="0" x2={W} y1={y(l.best.e1rm)} y2={y(l.best.e1rm)} stroke="rgb(var(--k-fg) / .16)" strokeDasharray="2 3" />
      <polyline points={vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="var(--k-ink2)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r="3" fill={l.current >= l.best.e1rm ? 'var(--k-good)' : l.stalled ? 'var(--k-warn)' : 'var(--k-ink2)'} />
    </svg>
  )
}

function Lifts({ workouts, lifts }: { workouts: Workout[]; lifts: Lift[] }) {
  const [all, setAll] = useState(false)
  const names = useMemo(() => {
    const s = new Set<string>()
    for (const w of workouts) for (const e of w.exercises) if ((e.weight ?? []).some(x => x > 0)) s.add(e.exerciseName.trim())
    return [...s].sort()
  }, [workouts])
  const [pick, setPick] = useState('')
  const ex = pick && names.includes(pick) ? pick : (lifts.find(l => names.includes(l.name))?.name ?? names[0] ?? '')
  const series = useMemo(() => (ex ? exerciseSeries(workouts, ex) : []), [workouts, ex])
  const shown = all ? lifts : lifts.slice(0, 8)
  const first = series[0], last = series[series.length - 1]
  const best = series.reduce((m, s) => Math.max(m, s.maxKg), 0)
  const change = first && last && series.length > 1 ? r1(last.e1rm - first.e1rm) : null

  return (
    <section className="nx-sec ntr-lifts">
      <Head aside="Estimated one-rep max from your best set each session">Are you getting stronger?</Head>
      {names.length > 0 && (
        <div className="ntr-prog">
          <div className="ntr-prog-hd">
            <select className="ntr-select" value={ex} onChange={e => setPick(e.target.value)} aria-label="Pick an exercise">
              {names.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <p>
              {!series.length ? 'No sets with a weight on this one yet.'
                : series.length === 1 ? `One session so far: ${last.maxKg} kg on ${fmtLong(last.date)}.`
                : <>Heaviest <b className="num">{best} kg</b>{change != null && <>, estimated 1RM <b className={`num ${change > 0 ? 'good' : change < 0 ? 'bad' : ''}`}>{change > 0 ? '+' : ''}{kg(change)}</b> since {fmtShort(first.date)}</>}</>}
            </p>
            <div className="trn-legend"><span><i style={{ background: 'var(--k-ink)' }} />Estimated 1RM</span><span><i className="dash" />Heaviest weight</span></div>
          </div>
          {series.length > 1 && (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke="rgb(var(--k-fg) / .05)" />
                <XAxis dataKey="date" tick={tick} axisLine={false} tickLine={false} tickFormatter={fmtShort} minTickGap={30} />
                <YAxis tick={tick} axisLine={false} tickLine={false} domain={niceDomain(series.flatMap(s => [s.maxKg, s.e1rm]), 5)} tickFormatter={v => String(Math.round(v))} width={48} />
                <Tooltip {...chartTip} labelFormatter={l => fmtDay(String(l))} formatter={(v, n) => [`${v} kg`, n === 'e1rm' ? 'Estimated 1RM' : 'Heaviest weight']} />
                <Line type="monotone" dataKey="e1rm" stroke="var(--k-ink)" strokeWidth={2} dot={series.length <= 30 ? { r: 2.5, fill: 'var(--k-ink)', strokeWidth: 0 } : false} isAnimationActive={false} />
                <Line type="monotone" dataKey="maxKg" stroke="var(--k-mute)" strokeWidth={1.6} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
      {lifts.length > 0 ? (
        <div className="ntr-tbl" role="table" aria-label="Lifts">
          <div className="tr th" role="row"><span>Lift</span><span>Trend</span><span>Now</span><span>8 weeks</span><span>Best</span></div>
          {shown.map(l => (
            <button key={l.name} className={`tr ${l.name === ex ? 'on' : ''}`} role="row" onClick={() => setPick(l.name)} aria-pressed={l.name === ex} aria-label={`Show ${l.name} on the chart`}>
              <span className="n">{l.name}<small>{l.sessions} sessions · last {fmtShort(l.lastDate)}</small></span>
              <span><Spark l={l} /></span>
              <span className="num v">{kg(l.current)}</span>
              <span className={`num ${l.change > 0 ? 'good' : l.change < 0 ? 'bad' : 'mute'}`}>{l.change > 0 ? '+' : ''}{kg(l.change)}</span>
              <span className="b">
                <span className="num">{kg(l.best.e1rm)}</span>
                <small className={l.current >= l.best.e1rm ? 'good' : l.stalled ? 'warn' : ''}>{l.current >= l.best.e1rm ? 'at your best' : l.stalled ? 'stalled 3 sessions' : fmtShort(l.best.date)}</small>
              </span>
            </button>
          ))}
        </div>
      ) : <p className="nx-answer">Lifts appear once a weighted exercise has been logged.</p>}
      {lifts.length > 8 && <button className="nx-btn ghost sm ntr-more" onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `All ${lifts.length} lifts`}</button>}
    </section>
  )
}

// ─── Body weight: one field and Enter; another day or a note when needed ─────

function Body({ today }: { today: string }) {
  const metrics = useBodyMetrics()
  const log = useLogBody()
  const del = useDeleteBody()
  const [w, setW] = useState('')
  const [bf, setBf] = useState('')
  const [more, setMore] = useState(false)
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [all, setAll] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<number | null>(null)
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
  const loggedToday = last?.date === today
  const on = more ? date : today
  const exists = entries.some(e => e.date === on)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = parseFloat(w.replace(',', '.'))
    if (!(v > 20 && v < 400)) return
    const b = parseFloat(bf.replace(',', '.'))
    log.mutate({ date: on, weightKg: v, ...(b > 0 && b < 70 ? { bodyFatPct: b } : {}), ...(more && note.trim() ? { notes: note.trim() } : {}) },
      { onSuccess: () => { setW(''); setBf(''); setNote(''); setMore(false); setDate(today) } })
  }

  return (
    <section className="nx-sec ntr-body">
      <Head aside={delta != null ? <span className="num">{signed(delta)} kg in 4 weeks</span> : undefined}>Body weight</Head>
      <div className="ntr-big">
        <b className="num">{last ? last.weightKg!.toFixed(1) : '–'}</b><span>kg</span>
        {lastBf && <span className="bf num">{lastBf.bodyFatPct}% body fat</span>}
      </div>
      <p className="ntr-cap">{last ? (loggedToday ? 'Logged today.' : `Last logged ${fmtDay(last.date)}.`) : 'Nothing logged yet.'}</p>
      <form className="ntr-log" onSubmit={submit}>
        <input id="ntr-weight" className="num" inputMode="decimal" value={w} onChange={e => setW(e.target.value)}
          placeholder={exists ? 'Correct it, e.g. 82.4' : more ? 'Weight, e.g. 82.4' : "Today's weight, e.g. 82.4"} aria-label="Weight in kg" />
        <input className="num bfin" inputMode="decimal" value={bf} onChange={e => setBf(e.target.value)} placeholder="BF %" aria-label="Body fat percent (optional)" />
        <button className="nx-btn sm" type="submit" disabled={!w || log.isPending}>Log</button>
      </form>
      {more ? (
        <div className="ntr-more-in">
          <input type="date" value={date} max={today} onChange={e => setDate(e.target.value || today)} aria-label="Date" />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note, e.g. after a late dinner" aria-label="Note" />
          <button type="button" className="ntr-lnk" onClick={() => { setMore(false); setDate(today); setNote('') }}>Today</button>
        </div>
      ) : <button type="button" className="ntr-lnk ntr-other" onClick={() => setMore(true)}>Another day or a note</button>}

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
          <button className="ntr-lnk ntr-other" onClick={() => setAll(a => !a)} aria-expanded={all}>{all ? 'Hide entries' : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, open one to correct it`}</button>
          {all && (
            <ul className="ntr-blist">
              {[...entries].reverse().map(r => editing === r.id
                ? <BodyEdit key={r.id} row={r} onDone={() => setEditing(null)} />
                : (
                  <li key={r.id}>
                    <button className="row" onClick={() => setEditing(r.id)} aria-label={`Edit the entry for ${fmtDay(r.date)}`}>
                      <span className="num d">{fmtDay(r.date)}</span>
                      <span className="num">{r.weightKg != null ? `${r.weightKg.toFixed(1)} kg` : '–'}{r.bodyFatPct != null ? `, ${r.bodyFatPct}%` : ''}</span>
                      {r.notes && <small>{r.notes}</small>}
                    </button>
                    {confirm === r.id
                      ? <span className="del"><button onClick={() => setConfirm(null)}>Keep</button><button className="bad" onClick={() => { del.mutate(r.id); setConfirm(null) }}>Delete</button></span>
                      : <button className="x" onClick={() => setConfirm(r.id)} aria-label={`Delete the entry for ${fmtDay(r.date)}`}>×</button>}
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

// ─── History: every workout, filter, expand, edit, delete ────────────────────

function History({ data, workouts, onEdit }: { data: TrainingView; workouts: Workout[]; onEdit: (w: Workout) => void }) {
  const [cat, setCat] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<number | null>(null)
  const [limit, setLimit] = useState(12)
  const del = useDeleteWorkout()
  const sorted = useMemo(() => [...workouts].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id), [workouts])
  const list = cat ? sorted.filter(w => w.category === cat) : sorted
  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map(c => [c.value, workouts.filter(w => w.category === c.value).length])), [workouts])
  const last30 = workouts.filter(w => daysBetween(w.date, data.today) < 30 && w.date <= data.today).length
  const oldest = sorted[sorted.length - 1]

  return (
    <section className="nx-sec ntr-hist">
      <Head aside={workouts.length ? <span className="num">{workouts.length} since {fmtLong(oldest.date)}, {last30} in 30 days</span> : undefined}>Workout history</Head>
      {!workouts.length && <p className="nx-answer">Nothing logged yet. Start a workout and it lands here.</p>}
      {workouts.length > 0 && (
        <div className="tr-seg sm ntr-filter" role="group" aria-label="Filter by category">
          <button className={!cat ? 'on' : ''} onClick={() => setCat('')} aria-pressed={!cat}>All</button>
          {CATEGORIES.filter(c => counts[c.value] > 0).map(c => (
            <button key={c.value} className={cat === c.value ? 'on' : ''} onClick={() => setCat(cat === c.value ? '' : c.value)} aria-pressed={cat === c.value}>
              <i className="nx-dot" style={{ color: c.color, marginRight: 0 }} />{c.label}<span className="num mute">{counts[c.value]}</span>
            </button>
          ))}
        </div>
      )}
      <div className="ntr-sessions">
        {list.slice(0, limit).map(w => {
          const c = catMeta(w.category)
          const vol = workoutVolume(w)
          const peak = peakRpe(w)
          const isOpen = open === w.id
          return (
            <div key={w.id} className={`ntr-sess ${isOpen ? 'open' : ''}`}>
              <button className="row" onClick={() => setOpen(isOpen ? null : w.id)} aria-expanded={isOpen} aria-label={`${w.name}, ${fmtDay(w.date)}. Show details`}>
                <span className="num d">{fmtDay(w.date)}</span>
                <span className="n"><i className="nx-dot" style={{ color: c.color }} />{w.name}</span>
                <span className="m num">{[w.durationMinutes ? `${w.durationMinutes} min` : '', vol > 0 ? volLabel(vol) : ''].filter(Boolean).join(' · ') || `${w.exercises.length} exercises`}</span>
                <span className={`r num ${rpeTone(peak)}`}>{peak > 0 ? `RPE ${peak}` : ''}</span>
              </button>
              {isOpen && (
                <div className="ntr-detail">
                  <p className="ntr-cap">
                    {c.label}{w.durationMinutes ? `, ${w.durationMinutes} min` : ''}{vol > 0 ? `, ${Math.round(vol).toLocaleString('en-GB')} kg volume` : ''}
                    {peak > 0 && <>, peak <span className={rpeTone(peak)}>RPE {peak}</span></>}{w.rpe ? <>, overall <span className={rpeTone(w.rpe)}>RPE {w.rpe}</span></> : null}
                  </p>
                  {w.exercises.length > 0 && (
                    <table className="ntr-table">
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
                              <td className={`num ${e.rpe ? rpeTone(e.rpe) : ''}`}>{e.rpe ?? '–'}</td>
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
      </div>
      {list.length > limit && <button className="nx-btn ghost sm ntr-more" onClick={() => setLimit(l => l + 30)}>{list.length - limit > 30 ? `Show 30 more of ${list.length - limit}` : `Show the other ${list.length - limit}`}</button>}
    </section>
  )
}

// ─── Personal records: the heaviest set per exercise ─────────────────────────

function Records({ workouts }: { workouts: Workout[] }) {
  const [all, setAll] = useState(false)
  const prs = useMemo(() => personalRecords(workouts), [workouts])
  const newest = [...prs].sort((a, b) => b.date.localeCompare(a.date))[0]
  const shown = all || prs.length <= 24 ? prs : prs.slice(0, 20)
  return (
    <section className="nx-sec ntr-prs">
      <Head aside={prs.length ? <span className="num">{prs.length} exercises</span> : undefined}>Personal records</Head>
      {!prs.length ? <p className="nx-answer">Your heaviest set per exercise shows here once you log weights.</p> : (
        <>
          <p className="ntr-cap">Newest: <b>{newest.name}</b>, {newest.kg} kg × {newest.reps} on {fmtShort(newest.date)}.</p>
          <div className="nx-rows">
            {shown.map(p => (
              <div key={p.name} className="nx-line" title={`${p.name}: ${p.kg} kg × ${p.reps} on ${fmtLong(p.date)}`}>
                <span className="k">{p.name}<small className="ntr-sub">{fmtLong(p.date)}</small></span>
                <span className="v"><b className="num">{p.kg} kg</b><span className="num">× {p.reps}</span></span>
              </div>
            ))}
          </div>
          {prs.length > 24 && <button className="nx-btn ghost sm ntr-more" onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `All ${prs.length} records`}</button>}
        </>
      )}
    </section>
  )
}
