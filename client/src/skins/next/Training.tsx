/**
 * Training, reworked 2026-11-16 so every number is one the owner typed.
 *
 * A lift is measured by its top set: the heaviest weight lifted that session,
 * ties going to more reps, shown as "65 kg × 8". There are no estimated maxes
 * on this page; comparisons name both sets and their dates.
 *
 * Rows, top to bottom:
 * 1. What's next: start a workout (an unsaved draft says so), the weigh-in line | this week against the Week goal and your usual week.
 * 2. Your workouts: each template's exercises with last time, aim and progress; the next one open, the rest folded; a row opens its chart | body weight, workouts per week.
 * 3. Workout history by week, full width (filter, open, edit, save as template, delete).
 *
 * The logger and the template sheet are shared from whoop/Training.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  CATEGORIES, catMeta, computeInsight, verdict, exVolume, kgs, peakRpe, setText, sundayOf, targetStreak, topOf,
  useAllWorkouts, useBodyMetrics, useDeleteBody, useDeleteWorkout, useLogBody, useTraining,
  type BodyMetric, type Lift, type TrainingView, type Verdict, type Workout,
} from '../../core/training'
import { useWeek } from '../../core/week'
import { PageLoader } from '../../components/ui/Spinner'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { BodyEdit, Logger, MetricChart, SaveAsTemplate, Templates, draftTime, type LogInit } from '../whoop/Training'
import './next.css'
import './training.css'

const fmtDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const fmtShort = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const fmtLong = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 864e5)
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const ago = (n: number) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${kgs(Math.abs(n))}`
/** The sets of one exercise as typed: "60 × 12, 65 × 8", or "12, 10 reps" without weight. */
const setsText = (reps: number[], weight: number[]) =>
  weight.some(w => w > 0) ? reps.map((r, i) => `${kgs(weight[i] ?? 0)} × ${r}`).join(', ') : `${reps.join(', ')} reps`
/** A template not trained for this many days is called out. */
const STALE = 10
/** Effort 9 and 10 are near the limit: worth noticing, so they read amber. */
const effortTone = (n: number) => (n >= 9 ? 'warn' : '')
/** The weight and strength read needs this much weigh-in history to mean anything. */
const READ_MIN_ENTRIES = 4
const READ_MIN_DAYS = 21

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
  const [pick, setPick] = useState('')
  const opened = useRef(false)

  // ?log=<template> opens the logger; ?log=next opens whatever is next in rotation.
  useEffect(() => {
    if (!data || !logParam || opened.current) return
    opened.current = true
    const t = logParam === 'next' ? (rotation(data).next ?? '') : logParam
    setLogging({ template: t })
  }, [data, logParam])

  if (isPending || !data) return <PageLoader />
  const goal = weekGoal(week.data?.current?.tasks ?? [])
  const workouts = all.data ?? []
  const start = (t: string) => setLogging({ template: t })

  return (
    <div className="wh-page wh-train nx ntr skin-enter">
      <div className="nx-wrap">
        <div className="nx-top">
          <Hero data={data} onStart={start} onManage={() => setTemplates(true)} />
          <div className="ntr-side">
            <ThisWeek data={data} workouts={workouts} goal={goal} />
          </div>
        </div>
        <div className="ntr-row">
          <div className="ntr-main"><Lifts data={data} workouts={workouts} pick={pick} setPick={setPick} /></div>
          <div className="ntr-aside"><Body today={data.today} lifts={data.progress} /><Consistency data={data} target={goal?.n ?? null} /></div>
        </div>
        <div className="ntr-row full">
          <History data={data} workouts={workouts} goal={goal} onEdit={w => setLogging({ edit: w })} />
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

// ─── Hero: what's next, one tap to start, last time and the aim ──────────────

function Hero({ data, onStart, onManage }: { data: TrainingView; onStart: (t: string) => void; onManage: () => void }) {
  const rot = rotation(data)
  const last = data.recent[0]
  const nextDate = rot.next ? rot.last.get(rot.next) : undefined

  return (
    <section className="nx-hero ntr-hero" aria-label="Next workout">
      <div className="ntr-top">
        <div className="ntr-hd">
          <p className="nx-state">{rot.next ? 'Next up: the workout you did longest ago' : last ? `Last workout ${fmtDay(last.date)}` : 'Training'}</p>
          <button className="nx-btn ghost sm" onClick={onManage} aria-label="Create, edit or delete templates">Templates</button>
        </div>
        <h1 className="ntr-h1">
          {rot.next ? rot.next : last ? `${last.name}, ${ago(daysBetween(last.date, data.today))}` : 'Log your first workout'}
          {rot.next && nextDate && <span> Last done {fmtShort(nextDate)}, {ago(daysBetween(nextDate, data.today))}.</span>}
        </h1>
        <div className="ntr-starts" role="group" aria-label="Start a workout">
          {data.templates.map((t, i) => {
            const d = rot.last.get(t.name)
            const n = d ? daysBetween(d, data.today) : null
            const isNext = rot.next === t.name
            const stale = n != null && n >= STALE
            const draft = draftTime(t.name)
            return (
              <button key={t.id} className={`ntr-start ${isNext ? 'next' : ''}`} onClick={() => onStart(t.name)} aria-label={`Start ${t.name}`}>
                <span className="t"><i className="nx-dot" style={{ color: catMeta(t.category).color }} />{t.name}{i < 9 && <kbd>{i + 1}</kbd>}</span>
                <span className={`s ${stale && !draft ? 'warn' : ''}`} title={d ? `Last done ${fmtDay(d)}` : undefined}>
                  {draft ? <b>Resume, unsaved from {new Date(draft).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</b>
                    : n == null ? `${plural(t.exercises.length, 'exercise')}, not done yet` : `Done ${ago(n)}`}
                </span>
              </button>
            )
          })}
          <button className="ntr-start other" onClick={() => onStart('')} aria-label="Start an empty workout">
            <span className="t">Something else<kbd>N</kbd></span>
            <span className="s">{draftTime('') ? <b>Resume unsaved workout</b> : 'Start empty'}</span>
          </button>
        </div>
        <WeighIn today={data.today} />
      </div>
    </section>
  )
}

/**
 * A one-line weigh-in reminder under the start buttons. It jumps to the one weight
 * field (W does the same) rather than adding a second one.
 */
function WeighIn({ today }: { today: string }) {
  const metrics = useBodyMetrics()
  const rows = (metrics.data ?? []).filter(m => m.weightKg != null).sort((a, b) => a.date.localeCompare(b.date))
  const last = rows[rows.length - 1]
  if (metrics.isPending) return null
  const thisWeek = last && sundayOf(last.date) === sundayOf(today)
  const span = rows.length > 1 ? daysBetween(rows[0].date, last.date) : 0
  const need = Math.max(0, READ_MIN_ENTRIES - rows.length)
  const why = need > 0 ? ` ${plural(need, 'more weigh-in')} and weight joins the strength read.` : span < READ_MIN_DAYS ? ` Weight joins the strength read once your weigh-ins span ${READ_MIN_DAYS} days.` : ''
  const go = () => { const el = document.getElementById('ntr-weight'); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus({ preventScroll: true }) }
  return (
    <p className={`ntr-weigh ${thisWeek ? '' : 'due'}`}>
      {thisWeek ? <>Weighed {last.date === today ? 'today' : fmtDay(last.date)}, {kgs(last.weightKg!)} kg.</> : <>Not weighed this week{last ? `; last ${fmtDay(last.date)}` : ''}.{why}</>}
      {' '}<Button variant="secondary" size="sm" onClick={go}>{thisWeek ? 'Log again' : 'Log weight'}<kbd>W</kbd></Button>
    </p>
  )
}

// ─── Side: this week, then the last 12 ───────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * The week's workout goal, and where it came from. A Week goal scored from
 * workouts gives its target. A goal typed by hand ("Workout for at least 4 days")
 * gives the number in its words. With neither there is no target, never a default.
 */
type Goal = { n: number; from: string; detail: string }
function weekGoal(tasks: { title: string; source: string; target: number | null }[]): Goal | null {
  const linked = tasks.find(t => t.source === 'workouts')
  if (linked) return { n: linked.target ?? 4, from: 'Goal from Week', detail: `"${linked.title}", counted from your logged workouts` }
  // Only a count of days or sessions, 1 to 14: "45 min" or "5 km" is not a number of workouts.
  const count = (title: string) => {
    const m = title.match(/(\d+)\s*(?:x\b|times?|days?|sessions?|workouts?|a week|per week|\/\s*week)/i) ?? title.match(/at least (\d+)(?!\s*(?:min|h|hours?|km|kg|m\b))/i)
    const n = m ? Number(m[1]) : NaN
    return n >= 1 && n <= 14 ? n : null
  }
  const named = tasks.find(t => /work ?out|training|gym|lift/i.test(t.title) && count(t.title) != null)
  if (named) return { n: count(named.title)!, from: 'Goal from Week', detail: `The number in your Week goal "${named.title}"` }
  return null
}

/** The middle of a list of counts: a usual week that one big week can't drag up. */
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }

function ThisWeek({ data, workouts, goal }: { data: TrainingView; workouts: Workout[]; goal: Goal | null }) {
  const wk = sundayOf(data.today)
  const mine = workouts.filter(w => sundayOf(w.date) === wk)
  const lastWk = workouts.filter(w => sundayOf(w.date) === addDays(wk, -7))
  const n = mine.length
  const target = goal?.n ?? 0
  const streak = goal ? targetStreak(workouts, data.today, target) : { weeks: 0 }
  const left = Math.max(0, target - n)
  const todayIdx = new Date(data.today + 'T12:00:00').getDay()
  const daysLeft = 7 - todayIdx
  const mins = mine.reduce((s, w) => s + (w.durationMinutes ?? 0), 0)
  const timed = [...workouts].filter(w => w.durationMinutes).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10)
  const avg = timed.length ? Math.round(timed.reduce((s, w) => s + w.durationMinutes!, 0) / timed.length) : 0
  const usual = median(data.weeks.slice(0, -1).map(w => w.count))
  return (
    <section className="nx-sec">
      <Head aside={<span title={goal?.detail}>{goal?.from ?? 'No workout goal in Week'}</span>}>This week</Head>
      <div className="nx-split ntr-wk">
        <div className="nx-wk">
          <span className={`nx-mid num ${goal && n >= target ? 'good' : ''}`}>{n}</span>
          <span className="nx-of">{goal ? `of ${target} workouts` : plural(n, 'workout')}</span>
        </div>
      </div>
      <div className="ntr-days" role="list" aria-label="Days this week">
        {DAYS.map((d, i) => {
          const date = addDays(wk, i)
          const did = mine.filter(w => w.date === date)
          const state = did.length ? 'done' : i === todayIdx ? 'today' : i < todayIdx ? 'past' : ''
          return (
            <div key={d} role="listitem" className={`d ${state}`} title={did.length ? `${fmtDay(date)}: ${did.map(w => w.name).join(', ')}` : fmtDay(date)}>
              <i aria-hidden />
              <span>{d}</span>
              <span className="sr-only">{did.length ? did.map(w => w.name).join(', ') : 'no workout'}</span>
            </div>
          )
        })}
      </div>
      <p className="ntr-cap">
        {!goal ? `${plural(daysLeft, 'day')} left.`
          : n >= target ? 'Goal hit.'
          : left > daysLeft ? `${left} to go, ${plural(daysLeft, 'day')} left: out of reach.` : `${left} to go, ${plural(daysLeft, 'day')} left.`}
        {' '}{n > usual ? <b className="good">Already above your usual week.</b> : n === usual && n > 0 ? 'Level with your usual week.' : ''}
        {' '}{streak.weeks > 0 ? <><b className="good">{plural(streak.weeks, 'week')} in a row</b> at {target} or more.</> : ''}
      </p>
      <div className="nx-figs ntr-wkfigs">
        <div><span>Last week</span><b className="num">{lastWk.length}</b></div>
        <div><span>Your usual week</span><b className="num">{usual}</b></div>
        <div><span>Time this week</span><b className="num">{mins} min</b>{avg > 0 && <small>sessions usually {avg} min</small>}</div>
      </div>
    </section>
  )
}

function Consistency({ data, target }: { data: TrainingView; target: number | null }) {
  const H = 120
  const max = Math.max(target ?? 0, ...data.weeks.map(w => w.count), 1)
  const usual = median(data.weeks.slice(0, -1).map(w => w.count))
  const met = (n: number) => target != null && n >= target
  const past = data.weeks.slice(0, -1)
  const hit = past.filter(w => met(w.count)).length
  const avg = Math.round((past.reduce((s, w) => s + w.count, 0) / Math.max(1, past.length)) * 10) / 10
  const used = CATEGORIES.filter(c => data.weeks.some(w => (w.byCat?.[c.value] ?? 0) > 0))
  const mixed = used.length > 1
  return (
    <section className="nx-sec ntr-cons-sec">
      <Head aside={`Last ${data.weeks.length} weeks`}>Workouts per week</Head>
      <div className="ntr-cons" style={{ height: H + 20 }}>
        {target != null && <div className="tgt" style={{ bottom: 20 + (target / max) * H }}><span className="num">goal {target}</span></div>}
        {data.weeks.map((w, i) => {
          const cur = i === data.weeks.length - 1
          const parts = CATEGORIES.map(c => ({ c, n: w.byCat?.[c.value] ?? 0 })).filter(p => p.n > 0)
          const other = w.count - parts.reduce((s, p) => s + p.n, 0)
          const tip = `Week of ${fmtDay(w.start)}: ${w.count}${mixed && parts.length ? ` (${parts.map(p => `${p.n} ${p.c.label.toLowerCase()}`).join(', ')})` : ''}`
          return (
            <div key={w.start} className="col" title={tip}>
              <div className={`stk ${cur ? 'cur' : ''}`} style={{ height: Math.max(2, (w.count / max) * H) }}>
                {w.count === 0 && <i style={{ flex: 1, background: 'rgb(var(--k-fg) / .06)' }} />}
                {!mixed && w.count > 0 && <i style={{ flex: 1, background: met(w.count) ? 'var(--k-good)' : 'rgb(var(--k-fg) / .3)' }} />}
                {mixed && other > 0 && <i style={{ flex: other, background: 'rgb(var(--k-fg) / .22)' }} />}
                {mixed && [...parts].reverse().map(p => <i key={p.c.value} style={{ flex: p.n, background: p.c.color }} />)}
              </div>
              <span className={`num ${met(w.count) ? 'good' : ''}`}>{w.count}</span>
            </div>
          )
        })}
      </div>
      {mixed && (
        <div className="trn-legend">
          {used.map(c => <span key={c.value}><i style={{ background: c.color }} />{c.label}</span>)}
          <span><i className="cur" />This week</span>
        </div>
      )}
      <p className="ntr-cap">{target != null ? `Goal hit in ${hit} of the last ${past.length} weeks. ` : ''}Usually {usual} a week (average {avg}).</p>
    </section>
  )
}

// ─── Lifts: grouped by workout, one plain answer per lift ────────────────────

const chartTip = {
  contentStyle: { background: 'var(--k-card2)', border: '1px solid var(--k-line2)', borderRadius: 12, fontSize: 12.5, padding: '6px 10px' },
  labelStyle: { color: 'var(--k-mute)', marginBottom: 2 },
  itemStyle: { color: 'var(--k-ink)', padding: 0 },
}
const tick = { fill: 'var(--k-faint)', fontSize: 11, fontFamily: 'var(--k-font)' }
/** Y-axis ticks at round steps (5, 10 or 20 kg) that cover the values with a little room. */
const roundTicks = (vals: number[]) => {
  if (!vals.length) return [0, 5]
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const step = hi - lo > 60 ? 20 : hi - lo > 25 ? 10 : 5
  const a = Math.max(0, Math.floor((lo - step / 4) / step) * step), b = Math.ceil((hi + step / 4) / step) * step
  const out: number[] = []
  for (let v = a; v <= b; v += step) out.push(v)
  return out
}

/** One lift's sessions: the top set of each, with every set kept. */
function liftSessions(workouts: Workout[], name: string) {
  const out: { date: string; kg: number; reps: number; sets: string }[] = []
  for (const w of [...workouts].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
    for (const e of w.exercises) {
      if (e.exerciseName.trim() !== name) continue
      const top = topOf(e.reps ?? [], e.weight ?? [])
      if (top) out.push({ date: w.date, ...top, sets: setsText(e.reps ?? [], e.weight ?? []) })
    }
  }
  return out
}

/** One exercise as it sits in a workout: its lift numbers when weighted, and last time with the aim. */
type PlanRow = { name: string; lift?: Lift; last?: TrainingView['last'][string] }

function Lifts({ data, workouts, pick, setPick }: { data: TrainingView; workouts: Workout[]; pick: string; setPick: (n: string) => void }) {
  const lifts = data.progress
  // Only the next workout opens by default; the rest fold to a one-line summary.
  const [opened, setOpened] = useState<Set<string> | null>(null)
  const since = addDays(data.today, -30)
  const newBests = lifts.reduce((s, l) => s + l.bests.filter(b => b.date >= since).length, 0)
  const verdicts = useMemo(() => new Map(lifts.map(l => [l.name, verdict(l)])), [lifts])
  const count = (k: Verdict['kind']) => lifts.filter(l => verdicts.get(l.name)!.kind === k).length
  const rot = rotation(data)

  // One group per workout, next up first, then the one done longest ago; an exercise
  // in two workouts shows in both. Lifts in no workout go last, folded.
  const groups = useMemo(() => {
    const row = (name: string): PlanRow => ({ name, lift: lifts.find(l => l.name === name), last: data.last[name] })
    const order = [...data.templates].sort((a, b) => {
      const da = rot.last.get(a.name), db = rot.last.get(b.name)
      if (a.name === rot.next) return -1
      if (b.name === rot.next) return 1
      if (!da || !db) return da ? -1 : db ? 1 : 0
      return da.localeCompare(db)
    })
    const inTpl = new Set(data.templates.flatMap(t => t.exercises.map(e => e.exerciseName.trim())))
    const out: { name: string; color?: string; done?: string; next?: boolean; rows: PlanRow[] }[] = order.map(t => ({
      name: t.name, color: catMeta(t.category).color, done: rot.last.get(t.name), next: t.name === rot.next,
      rows: t.exercises.map(e => row(e.exerciseName.trim())),
    }))
    const rest = lifts.filter(l => !inTpl.has(l.name)).map(l => row(l.name))
    if (rest.length) out.push({ name: out.length ? 'Other lifts' : 'Lifts', rows: rest })
    return out
  }, [data, lifts, rot.next, rot.last])
  const firstOpen = groups.find(g => (opened ?? new Set([groups[0]?.name])).has(g.name))?.name

  return (
    <section className="nx-sec ntr-lifts" id="ntr-lifts">
      <Head aside={lifts.length ? <span className="num">{plural(newBests, 'new best')} in 30 days</span> : undefined}>Your workouts</Head>
      {!groups.length ? <p className="nx-answer">Make a template or log a workout, and its exercises show here with what to aim for.</p> : (
        <>
          {lifts.length > 0 && (
            <div className="ntr-tally">
              <div><b className="num good">{count('best')}</b><span>lifts at your best</span></div>
              <div><b className="num good">{count('up')}</b><span>up on 8 weeks ago</span></div>
              <div><b className="num">{count('below')}</b><span>below your best</span></div>
            </div>
          )}
          <p className="ntr-cap ntr-def">Aim is one more rep on your heaviest set; at 10 reps, the next weight you have used (or 2.5 kg more) for 2 fewer.</p>
          {groups.map(g => {
            const isOpen = (opened ?? new Set([groups[0].name])).has(g.name)
            const toggle = () => setOpened(o => { const n = new Set(o ?? [groups[0].name]); if (isOpen) n.delete(g.name); else n.add(g.name); return n })
            const vs = g.rows.map(r => (r.lift ? verdicts.get(r.lift.name)!.kind : null))
            const nb = vs.filter(k => k === 'best' || k === 'up').length, nd = vs.filter(k => k === 'below').length
            const summary = !g.color
              ? `${g.rows.slice(0, 3).map(r => r.name).join(', ')}${g.rows.length > 3 ? ` and ${g.rows.length - 3} more` : ''}`
              : [nb ? `${nb} at best or up` : '', nd ? `${nd} below best` : ''].filter(Boolean).join(', ')
            return (
              <div key={g.name} className={`ntr-lg ${isOpen ? 'open' : ''}`}>
                <button className="ntr-lg-h" onClick={toggle} aria-expanded={isOpen} aria-label={`${g.name}, ${plural(g.rows.length, 'exercise')}. ${isOpen ? 'Fold' : 'Open'}`}>
                  {g.color && <i className="nx-dot" style={{ color: g.color }} />}
                  <span className="t">{g.name}</span>
                  {g.next && <span className="nxt">Next up</span>}
                  {g.done && <span className="dn">Last {fmtShort(g.done)}</span>}
                  {!isOpen && summary && <span className="sm">{summary}</span>}
                  <span className="chev" aria-hidden>{!isOpen && <span className="num">{g.rows.length}</span>}<ChevronDown size={15} className={isOpen ? 'up' : ''} /></span>
                </button>
                {isOpen && g.name === firstOpen && <div className="ntr-lh" aria-hidden><span>Exercise</span><span>Last time</span><span>Aim</span><span>Progress</span></div>}
                {isOpen && g.rows.map(r => (
                  <LiftRow key={r.name} r={r} v={r.lift ? verdicts.get(r.lift.name) : undefined} open={pick === r.name}
                    onToggle={() => setPick(pick === r.name ? '' : r.name)} workouts={workouts} />
                ))}
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}

function LiftRow({ r, v, open, onToggle, workouts }: { r: PlanRow; v?: Verdict; open: boolean; onToggle: () => void; workouts: Workout[] }) {
  const tone = v && (v.kind === 'best' || v.kind === 'up') ? 'good' : ''
  const lastSet = r.lift ? setText(r.lift.last) : r.last ? `${Math.max(...r.last.reps)} reps` : '–'
  const lastDate = r.lift?.last.date ?? r.last?.date
  const cells = (
    <>
      <span className="n">{r.name}<small>{lastDate ? `Last ${fmtShort(lastDate)}` : 'Not done yet'}</small></span>
      <span className="num s">{lastSet}</span>
      <b className="num a">{r.last?.target ?? '–'}</b>
      <span className="v">{v ? <><span className={tone}>{v.text}</span>{v.sub && <small className="num">{v.sub}</small>}</> : <small>{r.last ? 'No weight logged' : ''}</small>}</span>
    </>
  )
  if (!r.lift) return <div className="ntr-lift"><div className="row">{cells}<span /></div></div>
  return (
    <div className={`ntr-lift ${open ? 'open' : ''}`}>
      <button className="row" onClick={onToggle} aria-expanded={open} aria-label={`${r.name}: ${lastSet} last time, aim ${r.last?.target ?? 'none'}, ${v?.text ?? ''}. ${open ? 'Hide' : 'Show'} history`}>
        {cells}<span className="chev" aria-hidden><ChevronDown size={15} className={open ? 'up' : ''} /></span>
      </button>
      {open && <LiftDetail l={r.lift} workouts={workouts} />}
    </div>
  )
}

function LiftDetail({ l, workouts }: { l: Lift; workouts: Workout[] }) {
  const series = useMemo(() => liftSessions(workouts, l.name), [workouts, l.name])
  const ticks = roundTicks([...series.map(s => s.kg), l.best.kg])
  const sinceBest = l.history.filter(h => h.date > l.best.date).length
  return (
    <div className="ntr-lift-d">
      <div className="nx-figs">
        <div><span>Best</span><b className="num">{setText(l.best)}</b><small>{fmtLong(l.best.date)}</small></div>
        <div><span>8+ weeks ago</span><b className="num">{l.before ? setText(l.before) : '–'}</b><small>{l.before ? fmtLong(l.before.date) : 'Started since'}</small></div>
        <div><span>Since your best</span><b className="num">{plural(sinceBest, 'session')}</b><small>{plural(l.sessions, 'session')} in all</small></div>
      </div>
      {series.length > 1 && (
        <>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} stroke="rgb(var(--k-fg) / .05)" />
              <XAxis dataKey="date" tick={tick} axisLine={false} tickLine={false} tickFormatter={fmtShort} minTickGap={30} />
              <YAxis tick={tick} axisLine={false} tickLine={false} domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} width={40} />
              <ReferenceLine y={l.best.kg} stroke="rgb(var(--k-fg) / .22)" strokeDasharray="3 4" />
              <Tooltip {...chartTip} labelFormatter={x => fmtDay(String(x))} formatter={(_v, _n, p) => [`${(p.payload as { sets: string }).sets}`, 'Sets']} />
              <Line type="linear" dataKey="kg" stroke="var(--k-ink)" strokeWidth={2} dot={series.length <= 30 ? { r: 2.5, fill: 'var(--k-ink)', strokeWidth: 0 } : false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="trn-legend"><span><i style={{ background: 'var(--k-ink)' }} />Heaviest weight each session, kg</span><span><i className="dash" />Your best</span></div>
        </>
      )}
      <ul className="ntr-lift-s" aria-label="Recent sessions">
        {[...series].reverse().slice(0, 4).map(s => <li key={s.date}><span className="num">{fmtDay(s.date)}</span><span className="num">{s.sets}</span></li>)}
      </ul>
    </div>
  )
}

// ─── Body weight: one field and Enter; another day or a note when needed ─────

function Body({ today, lifts }: { today: string; lifts: Lift[] }) {
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
  // Compare with the last entry from four weeks ago or earlier; failing that, the first entry. The date is always named.
  const ref = rows.length > 1 ? ([...rows].reverse().find(r => r.date <= addDays(today, -28)) ?? rows[0]) : null
  const delta = last && ref ? last.weightKg! - ref.weightKg! : null
  const bfFirst = bfRows[0]
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
      <Head aside={last ? (last.date === today ? 'Logged today' : `Last logged ${fmtDay(last.date)}`) : undefined}>Body weight</Head>
      <div className="ntr-big">
        <b className="num">{last ? kgs(last.weightKg!) : '–'}</b><span>kg</span>
        {lastBf && <span className="bf num">{kgs(lastBf.bodyFatPct!)}% body fat</span>}
      </div>
      <p className="ntr-cap">
        {!last ? 'Nothing logged yet. Type your weight below and press Enter.'
          : delta == null ? 'One entry so far. The change shows from the second.'
          : <><b className="num">{signed(delta)} kg</b> since {fmtDay(ref!.date)} ({kgs(ref!.weightKg!)} kg).</>}
      </p>
      <form className="ntr-log" onSubmit={submit}>
        <input id="ntr-weight" className="num" inputMode="decimal" value={w} onChange={e => setW(e.target.value)}
          placeholder={exists ? 'Correct it, e.g. 82.4' : more ? 'Weight, e.g. 82.4' : "Today's weight, e.g. 82.4"} aria-label="Weight in kg" />
        <input className="num bfin" inputMode="decimal" value={bf} onChange={e => setBf(e.target.value)} placeholder="Fat %" aria-label="Body fat percent (optional)" />
        <button className="nx-btn sm" type="submit" disabled={!w || log.isPending}>Log</button>
      </form>
      {more ? (
        <div className="ntr-more-in">
          <input type="date" value={date} max={today} onChange={e => setDate(e.target.value || today)} aria-label="Date" />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note, e.g. after a late dinner" aria-label="Note" />
          <Button type="button" variant="secondary" size="sm" onClick={() => { setMore(false); setDate(today); setNote('') }}>Back to today</Button>
        </div>
      ) : (
        <div className="ntr-acts">
          <Button type="button" variant="secondary" size="sm" onClick={() => setMore(true)}><CalendarDays size={14} aria-hidden />Pick a day or add a note</Button>
        </div>
      )}

      {rows.length > 1 && (
        <div className="trn-mblock">
          <MetricChart rows={entries} field="weightKg" unit=" kg" label="Weight" />
        </div>
      )}
      {bfRows.length > 1 && (
        <div className="trn-mblock">
          <div className="trn-mhd"><span>Body fat</span><b className="num">{signed(lastBf.bodyFatPct! - bfFirst.bodyFatPct!)} points since {fmtShort(bfFirst.date)}</b></div>
          <MetricChart rows={entries} field="bodyFatPct" unit="%" label="Body fat" />
        </div>
      )}
      <Read rows={rows} metrics={entries} lifts={lifts} />
      {entries.length > 0 && (
        <>
          <div className="ntr-acts ntr-acts-end">
            <Button variant="secondary" size="sm" onClick={() => setAll(a => !a)} aria-expanded={all}>
              {all ? 'Hide entries' : <>Correct an entry <span className="num mute">{entries.length}</span></>}
              <ChevronDown size={14} className={all ? 'up' : ''} aria-hidden />
            </Button>
          </div>
          {all && (
            <ul className="ntr-blist">
              {[...entries].reverse().map(r => editing === r.id
                ? <BodyEdit key={r.id} row={r} onDone={() => setEditing(null)} />
                : (
                  <li key={r.id}>
                    <button className="row" onClick={() => setEditing(r.id)} aria-label={`Edit the entry for ${fmtDay(r.date)}`}>
                      <span className="num d">{fmtDay(r.date)}</span>
                      <span className="num">{r.weightKg != null ? `${kgs(r.weightKg)} kg` : '–'}{r.bodyFatPct != null ? `, ${kgs(r.bodyFatPct)}%` : ''}</span>
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

/**
 * Weight and strength together. Strength is the list's own verdicts (at your
 * best, up on 8 weeks ago, below). Weight joins once there are enough
 * weigh-ins over enough days to be a trend; until then this says only what it
 * is waiting for, since the lift tally above already answers the rest.
 */
function Read({ rows, metrics, lifts }: { rows: BodyMetric[]; metrics: BodyMetric[]; lifts: Lift[] }) {
  const [open, setOpen] = useState(false)
  const span = rows.length > 1 ? daysBetween(rows[0].date, rows[rows.length - 1].date) : 0
  const enough = rows.length >= READ_MIN_ENTRIES && span >= READ_MIN_DAYS
  const insight = useMemo(() => (enough ? computeInsight(metrics, lifts) : null), [enough, metrics, lifts])
  if (!enough) {
    return (
      <div className="ntr-read">
        <p className="ntr-read-h">Weight and strength together</p>
        <p className="ntr-cap">Reads whether you are building muscle or gaining fat after {READ_MIN_ENTRIES} weigh-ins over {READ_MIN_DAYS} days. So far: {plural(rows.length, 'weigh-in')}{rows.length > 1 ? ` over ${plural(span, 'day')}` : ''}.</p>
      </div>
    )
  }
  if (!insight) return null
  const wt = insight.weight
  const range = (a: { from: string; to: string; n: number }) => a.from === a.to ? fmtShort(a.from) : `${fmtShort(a.from)} to ${fmtShort(a.to)}`
  return (
    <div className="ntr-read">
      <p className="ntr-read-h">Weight and strength together</p>
      <p>
        <i className={`nx-dot ${insight.color}`} />
        <b>{insight.pattern}.</b> {insight.what}
      </p>
      <div className="ntr-acts">
        <Button variant="secondary" size="sm" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          {open ? 'Hide why' : 'Why, and what to do'}<ChevronDown size={14} className={open ? 'up' : ''} aria-hidden />
        </Button>
      </div>
      {open && (
        <div className="ntr-why">
          <p>{insight.why}</p>
          <p><b>{insight.action}</b></p>
          <div className="nx-figs">
            {wt && (
              <div>
                <span>Weight</span>
                <b className="num">{signed(wt.change)} kg</b>
                <small className="num">{kgs(wt.early.kg)} kg ({range(wt.early)}) to {kgs(wt.late.kg)} kg ({range(wt.late)}), average of each week</small>
              </div>
            )}
            {insight.fat && (
              <div>
                <span>Body fat</span>
                <b className="num">{signed(Math.round((insight.fat.last.pct - insight.fat.first.pct) * 10) / 10)} points</b>
                <small className="num">{kgs(insight.fat.first.pct)}% on {fmtShort(insight.fat.first.date)} to {kgs(insight.fat.last.pct)}% on {fmtShort(insight.fat.last.date)}</small>
              </div>
            )}
            <div>
              <span>Lifts at best or up</span>
              <b className="num">{insight.lifts.good} of {insight.lifts.total}</b>
              <small>the same count as Your workouts</small>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── History: every workout, filter, expand, edit, delete ────────────────────

function History({ data, workouts, goal, onEdit }: { data: TrainingView; workouts: Workout[]; goal: Goal | null; onEdit: (w: Workout) => void }) {
  const [cat, setCat] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<number | null>(null)
  const [limit, setLimit] = useState(10)
  const del = useDeleteWorkout()
  useEffect(() => {
    if (open == null) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.wh-sheet-bg') && !(e.target instanceof Element && e.target.closest('input, textarea'))) setOpen(null) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])
  const sorted = useMemo(() => [...workouts].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id), [workouts])
  const list = cat ? sorted.filter(w => w.category === cat) : sorted
  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map(c => [c.value, workouts.filter(w => w.category === c.value).length])), [workouts])
  const usedCats = CATEGORIES.filter(c => counts[c.value] > 0)
  const last30 = workouts.filter(w => daysBetween(w.date, data.today) < 30 && w.date <= data.today).length
  const oldest = sorted[sorted.length - 1]

  return (
    <section className="nx-sec ntr-hist">
      <Head aside={workouts.length ? <span className="num">{last30} in the last 30 days, {workouts.length} since {fmtLong(oldest.date)}</span> : undefined}>Workout history</Head>
      {!workouts.length && <p className="nx-answer">Nothing logged yet. Start a workout and it lands here.</p>}
      {usedCats.length > 1 && (
        <div className="tr-seg sm ntr-filter" role="group" aria-label="Filter by category">
          <button className={!cat ? 'on' : ''} onClick={() => setCat('')} aria-pressed={!cat}>All</button>
          {usedCats.map(c => (
            <button key={c.value} className={cat === c.value ? 'on' : ''} onClick={() => setCat(cat === c.value ? '' : c.value)} aria-pressed={cat === c.value}>
              <i className="nx-dot" style={{ color: c.color, marginRight: 0 }} />{c.label}<span className="num mute">{counts[c.value]}</span>
            </button>
          ))}
        </div>
      )}
      <div className="ntr-sessions">
        {list.slice(0, limit).map((w, i, shown) => {
          const wk = sundayOf(w.date)
          const head = i === 0 || sundayOf(shown[i - 1].date) !== wk
          const inWk = head ? list.filter(x => sundayOf(x.date) === wk) : []
          const wkMins = inWk.reduce((s, x) => s + (x.durationMinutes ?? 0), 0)
          const c = catMeta(w.category)
          const vol = w.exercises.reduce((s, e) => s + exVolume(e), 0)
          const peak = peakRpe(w)
          const sets = w.exercises.reduce((s, e) => s + (e.reps ?? []).length, 0)
          const isOpen = open === w.id
          return (
            <div key={w.id} className="ntr-sess-w">
            {head && (
              <div className="ntr-wkh">
                <span className="t">{wk === sundayOf(data.today) ? 'This week' : wk === addDays(sundayOf(data.today), -7) ? 'Last week' : `Week of ${fmtShort(wk)}`}</span>
                <span className={`num ${goal && !cat && inWk.length >= goal.n ? 'good' : ''}`}>{plural(inWk.length, cat ? `${catMeta(cat).label.toLowerCase()} workout` : 'workout')}{goal && !cat ? ` of ${goal.n}` : ''}</span>
                {wkMins > 0 && <span className="num m">{wkMins} min</span>}
              </div>
            )}
            <div className={`ntr-sess ${isOpen ? 'open' : ''}`}>
              <button className="row" onClick={() => setOpen(isOpen ? null : w.id)} aria-expanded={isOpen} aria-label={`${w.name}, ${fmtDay(w.date)}. ${isOpen ? 'Hide' : 'Show'} details`}>
                <span className="num d">{fmtDay(w.date)}</span>
                <span className="n"><i className="nx-dot" style={{ color: c.color }} />{w.name}</span>
                <span className="m num">{[plural(w.exercises.length, 'exercise'), plural(sets, 'set'), w.durationMinutes ? `${w.durationMinutes} min` : ''].filter(Boolean).join(', ')}</span>
                <span className={`r num ${effortTone(w.rpe || peak)}`} title={w.rpe ? 'Overall effort for the workout, 1 to 10' : peak ? 'No overall effort logged: the hardest exercise, 1 to 10' : undefined}>{w.rpe || peak ? `Effort ${w.rpe || peak}` : ''}</span>
                <span className="chev" aria-hidden><ChevronDown size={15} className={isOpen ? 'up' : ''} /></span>
              </button>
              {isOpen && (
                <div className="ntr-detail">
                  <p className="ntr-cap">
                    {c.label}{w.durationMinutes ? `, ${w.durationMinutes} min` : ', length not set'}
                    {w.rpe ? <>, overall effort <span className={effortTone(w.rpe)}>{w.rpe} of 10</span></> : null}
                    {peak > (w.rpe ?? 0) && <>, hardest exercise <span className={effortTone(peak)}>{peak} of 10</span></>}
                    {vol > 0 && <>. {Math.round(vol).toLocaleString('en-GB')} kg lifted in total (each set's weight × reps, added up)</>}.
                  </p>
                  {w.exercises.length > 0 && (
                    <table className="ntr-table">
                      <thead><tr><th>Exercise</th><th>Sets (kg × reps)</th><th>Heaviest set</th><th>Effort</th></tr></thead>
                      <tbody>
                        {w.exercises.map(e => {
                          const top = topOf(e.reps ?? [], e.weight ?? [])
                          return (
                            <tr key={e.id}>
                              <td>{e.exerciseName}</td>
                              <td className="num">{(e.reps ?? []).length ? setsText(e.reps ?? [], e.weight ?? []) : '–'}</td>
                              <td className="num">{top ? setText(top) : '–'}</td>
                              <td className={`num ${e.rpe ? effortTone(e.rpe) : ''}`}>{e.rpe ?? '–'}</td>
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
            </div>
          )
        })}
      </div>
      {list.length > limit && <button className="nx-btn ghost sm ntr-more" onClick={() => setLimit(l => l + 30)}>{list.length - limit > 30 ? `Show 30 more of ${list.length - limit}` : `Show the other ${list.length - limit}`}</button>}
    </section>
  )
}
