/**
 * The Roadmap: yearly and 3-year goals as SMART milestones on lanes, one lane
 * per 3-year direction plus Foundation (habits). Milestones are reached or not,
 * never scored. Data: core/goals.ts (/api/milestones).
 */
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  useDirectionActions, useMilestoneActions, useMilestones,
  type Direction, type Measure, type Milestone, type MilestoneInput,
} from '../../core/goals'
import { useTraining } from '../../core/training'
import { MASK, usePrivacy } from '../../core/privacy'
import { api } from '../../lib/api'
import { PageLoader } from '../../components/ui/Spinner'
import './roadmap.css'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => iso(new Date())
const t = (s: string) => new Date(s + 'T12:00:00').getTime()
const fmtDate = (s: string, year = false) => new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) })
const endOfMonth = (o = 0) => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth() + 1 + o, 0)) }
const endOfYear = (o = 0) => `${new Date().getFullYear() + o}-12-31`
const errText = (e: unknown) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'That did not save. Try again.'
const round = (n: number) => Math.round(n * 100) / 100

/** A value in its unit: £2,113 for GBP, 86.7 kg, +3.2R, 44 weeks. Money hides in privacy mode. */
function useFmt() {
  const { hidden } = usePrivacy()
  return (v: number | null | undefined, unit: string | null, signed = false) => {
    if (v == null) return '–'
    const n = round(v)
    if (unit === 'GBP') return hidden ? `£${MASK}` : `${signed && n > 0 ? '+' : n < 0 ? '−' : ''}£${Math.abs(n).toLocaleString('en-GB', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 })}`
    const s = `${signed && n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`
    if (!unit) return s
    if (unit === 'R') return `${s}R`
    return `${s} ${unit}`
  }
}

const statusText = (m: Milestone) =>
  m.status === 'reached' ? `Reached ${m.reachedAt ? fmtDate(m.reachedAt) : ''}`.trim()
  : m.status === 'missed' ? 'Missed'
  : m.status === 'dropped' ? 'Dropped'
  : m.overdue ? `Past due, ${fmtDate(m.dueDate)}`
  : m.pace === 'behind' ? `Behind pace, ${m.daysLeft} days left`
  : m.pace === 'ahead' ? `Ahead of pace, ${m.daysLeft} days left`
  : m.pace === 'on' ? `On pace, ${m.daysLeft} days left`
  : `${m.daysLeft} days left`
const statusTone = (m: Milestone) => m.status === 'reached' ? 'good' : m.status !== 'open' ? 'mute' : m.overdue || m.pace === 'behind' ? 'warn' : m.pace ? 'good' : ''

// ─── Page ────────────────────────────────────────────────────────────────────

type SheetState = { kind: 'milestone'; m?: Milestone; directionId?: number | null; foundation?: boolean; due?: string } | { kind: 'direction'; d?: Direction } | null

export function Roadmap() {
  const { data, isPending } = useMilestones()
  const [pick, setPick] = useState<number | null>(null)
  const [span, setSpan] = useState<'year' | 'all'>(() => { try { return localStorage.getItem('oura-roadmap-span') === 'year' ? 'year' : 'all' } catch { return 'all' } })
  const [sheet, setSheet] = useState<SheetState>(null)
  const chooseSpan = (s: 'year' | 'all') => { setSpan(s); try { localStorage.setItem('oura-roadmap-span', s) } catch { /* private mode */ } }

  if (isPending || !data) return <PageLoader />
  const live = data.milestones.filter(m => m.status !== 'dropped')
  // The milestone in focus: the one picked, else the next one due, else the latest reached.
  const nextOpen = live.filter(m => m.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
  const selected = live.find(m => m.id === pick) ?? nextOpen ?? live[live.length - 1] ?? null

  return (
    <>
      <div className="nr-bar">
        <span className="nw-seg" role="group" aria-label="Time span">
          <button className={span === 'year' ? 'on' : ''} aria-pressed={span === 'year'} onClick={() => chooseSpan('year')}>This year</button>
          <button className={span === 'all' ? 'on' : ''} aria-pressed={span === 'all'} onClick={() => chooseSpan('all')}>3 years</button>
        </span>
        <span className="nr-rule">{span === 'year'
          ? `Milestones due by 31 Dec ${new Date().getFullYear()}. Reached or not, never scored.`
          : 'Your directions and every milestone on the way. Reached or not, never scored.'}</span>
        <span className="nr-grow" />
        <button className="nx-btn ghost sm" onClick={() => setSheet({ kind: 'direction' })}><Plus size={13} aria-hidden />Direction</button>
        <button className="nx-btn sm" onClick={() => setSheet({ kind: 'milestone', directionId: data.directions[0]?.id ?? null, due: span === 'year' ? endOfYear() : endOfYear(1) })}><Plus size={13} aria-hidden />Milestone</button>
      </div>

      {span === 'year' && live.filter(m => m.dueDate <= endOfYear()).length === 0 ? (
        <EmptyYear hasDirections={data.directions.length > 0}
          onMilestone={() => setSheet({ kind: 'milestone', directionId: data.directions[0]?.id ?? null, due: endOfYear() })}
          onFoundation={() => setSheet({ kind: 'milestone', foundation: true, due: endOfYear() })}
          onThree={() => chooseSpan('all')} />
      ) : data.directions.length === 0 && live.length === 0 ? (
        <Empty onDirection={() => setSheet({ kind: 'direction' })} onFoundation={() => setSheet({ kind: 'milestone', foundation: true })} />
      ) : (
        <>
          <div className="nx-top">
            <RoadmapChart directions={data.directions} milestones={live} span={span} selected={selected?.id ?? null} onPick={setPick}
              onAdd={(directionId, foundation) => setSheet({ kind: 'milestone', directionId, foundation })} />
            {selected ? <Detail key={selected.id} m={selected} directions={data.directions} onEdit={() => setSheet({ kind: 'milestone', m: selected })} />
              : <section className="nx-sec nr-side"><p className="nx-answer">Add a milestone to see its review here.</p></section>}
          </div>
          <div className="nr-under">
            {selected ? <Trajectory m={selected} /> : <section className="nx-sec" />}
            <Directions directions={data.directions} milestones={live} onEdit={d => setSheet({ kind: 'direction', d })} onAdd={() => setSheet({ kind: 'direction' })} />
          </div>
        </>
      )}

      {sheet?.kind === 'milestone' && <MilestoneSheet init={sheet} directions={data.directions} onClose={() => setSheet(null)} onSaved={id => id && setPick(id)} />}
      {sheet?.kind === 'direction' && <DirectionSheet d={sheet.d} onClose={() => setSheet(null)} />}
    </>
  )
}

/** The first step, in place: name a direction and its date, then Add. Suggestions only fill the field. */
function Empty({ onFoundation }: { onDirection: () => void; onFoundation: () => void }) {
  const act = useDirectionActions()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(endOfYear(3))
  const [err, setErr] = useState<string | null>(null)
  const ideas = ['Zavabuild at £10k MRR', 'Trade for a living', 'Strong and lean: bench 120 kg']
  const add = () => title.trim() && act.create.mutate({ title: title.trim(), targetDate: date }, { onSuccess: () => setTitle(''), onError: e => setErr(errText(e)) })
  return (
    <section className="nx-hero nr-empty">
      <div>
        <p className="nx-state">Your roadmap</p>
        <h1 className="nw-focus">Where do you want to be in three years?</h1>
        <p className="nr-lede">Start with 1 to 3 directions. Each becomes a lane; the milestones on it lead there, each SMART. Your monthly and weekly goals will link to them, so the small stuff always serves the big stuff.</p>
        <div className="nx-acts" style={{ marginTop: 18 }}><button className="nx-btn ghost sm" onClick={onFoundation}>Or start with a Foundation habit</button></div>
      </div>
      <form className="nr-first" onSubmit={e => { e.preventDefault(); add() }}>
        <label className="f"><span>Direction</span><input className="nr-in" value={title} onChange={e => setTitle(e.target.value)} placeholder="Where you want to be" aria-label="Direction" /></label>
        <div className="nr-ideas">{ideas.map(i => <button type="button" key={i} className="nx-chip" onClick={() => setTitle(i)}>{i}</button>)}</div>
        <label className="f"><span>By</span><input className="nr-in num" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="By" /></label>
        {err && <p className="nr-err" role="alert">{err}</p>}
        <button className="nx-btn" disabled={!title.trim() || act.create.isPending}>Add direction</button>
      </form>
    </section>
  )
}

/** This year, nothing due yet: what will you reach by 31 December? */
function EmptyYear({ hasDirections, onMilestone, onFoundation, onThree }: { hasDirections: boolean; onMilestone: () => void; onFoundation: () => void; onThree: () => void }) {
  const y = new Date().getFullYear()
  const left = Math.max(0, Math.round((t(endOfYear()) - t(today())) / 864e5))
  return (
    <section className="nx-hero nr-empty">
      <div>
        <p className="nx-state">{y}, {left} days left</p>
        <h1 className="nw-focus">What will you reach by 31 December?</h1>
        <p className="nr-lede">This year's milestones are the checkpoints toward your 3-year directions. Each is SMART, measured where it can be from your own data, and your monthly goals will feed it.{hasDirections ? '' : ' Set a direction first, so every milestone has a reason.'}</p>
      </div>
      <div className="nr-first">
        <p className="nr-cap" style={{ marginTop: 0 }}>Due 31 Dec {y}, measured live from Business, Trading, Training or your Routine, or typed by hand.</p>
        <button className="nx-btn" onClick={onMilestone}>Add a {y} milestone</button>
        <button className="nx-btn ghost" onClick={onFoundation}>Add a Foundation habit</button>
        {!hasDirections && <button className="nr-lnk" style={{ alignSelf: 'flex-start' }} onClick={onThree}>Set your 3-year directions first</button>}
      </div>
    </section>
  )
}

// ─── The roadmap chart ───────────────────────────────────────────────────────

type Lane = { key: string; title: string; sub: string | null; directionId: number | null; foundation: boolean; end: string | null; items: Milestone[] }

function RoadmapChart({ directions, milestones, span, selected, onPick, onAdd }: {
  directions: Direction[]; milestones: Milestone[]; span: 'year' | 'all'; selected: number | null
  onPick: (id: number) => void; onAdd: (directionId: number | null, foundation: boolean) => void
}) {
  const fmt = useFmt()
  const y = new Date().getFullYear()
  const from = `${y}-01-01`
  const lastYear = span === 'year' ? y : Math.max(y, ...milestones.map(m => Number(m.dueDate.slice(0, 4))), ...directions.map(d => Number((d.targetDate ?? `${y}`).slice(0, 4))))
  const to = `${lastYear}-12-31`
  const x = (d: string) => Math.max(0, Math.min(100, ((t(d) - t(from)) / (t(to) - t(from))) * 100))
  const inSpan = (m: Milestone) => m.dueDate >= from && m.dueDate <= to

  const lanes: Lane[] = [
    ...directions.map(d => ({ key: `d${d.id}`, title: d.title, sub: d.targetDate ? `by ${fmtDate(d.targetDate, true)}` : null, directionId: d.id, foundation: false, end: d.targetDate, items: milestones.filter(m => m.kind !== 'foundation' && m.directionId === d.id) })),
  ]
  const orphans = milestones.filter(m => m.kind !== 'foundation' && (m.directionId == null || !directions.some(d => d.id === m.directionId)))
  if (orphans.length) lanes.push({ key: 'none', title: 'No direction yet', sub: 'link these to a direction', directionId: null, foundation: false, end: null, items: orphans })
  lanes.push({ key: 'foundation', title: 'Foundation', sub: 'habits that hold it up', directionId: null, foundation: true, end: null, items: milestones.filter(m => m.kind === 'foundation') })

  const ticks = span === 'year'
    ? Array.from({ length: 12 }, (_, i) => ({ at: x(`${y}-${String(i + 1).padStart(2, '0')}-01`), label: new Date(y, i, 1).toLocaleDateString('en-GB', { month: 'short' }) }))
    : Array.from({ length: lastYear - y + 1 }, (_, i) => ({ at: x(`${y + i}-01-01`), label: String(y + i) }))
  const now = x(today())
  const shown = milestones.filter(inSpan)
  const reached = shown.filter(m => m.status === 'reached').length
  const onWay = shown.filter(m => m.status === 'open').length
  const next = shown.filter(m => m.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]

  return (
    <section className="nx-hero nr-hero" aria-label="Roadmap">
      <div className="nr-chart">
        <div className="nr-axis">
          {ticks.map(k => <span key={k.label} style={{ left: `${k.at}%` }}>{k.label}</span>)}
        </div>
        {lanes.map(l => {
          const items = l.items.filter(inSpan).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          let last = -100, flip = false
          return (
            <div key={l.key} className={`nr-lane ${l.foundation ? 'found' : ''}`}>
              <div className="nr-lh"><b>{l.title}</b>{l.sub && <span>{l.sub}</span>}</div>
              <div className="nr-track">
                {ticks.map(k => <i key={k.label} className="grid" style={{ left: `${k.at}%` }} />)}
                {now > 0 && now < 100 && <i className="today" style={{ left: `${now}%` }} />}
                <i className="line" />
                {items.length === 0 && (
                  <button className="nr-addin" onClick={() => onAdd(l.directionId, l.foundation)}><Plus size={13} aria-hidden />Add {l.foundation ? 'a Foundation habit' : 'a milestone'}</button>
                )}
                {items.map(m => {
                  const at = x(m.dueDate)
                  flip = at - last < 22 ? !flip : false
                  last = at
                  const pct = m.status === 'reached' ? 100 : Math.round((m.progress ?? 0) * 100)
                  const tone = m.status === 'reached' ? 'good' : m.overdue || m.pace === 'behind' ? 'warn' : 'good'
                  return (
                    <button key={m.id} className={`nr-m ${m.status} ${selected === m.id ? 'on' : ''} ${flip ? 'flip' : ''}`} style={{ left: `${at}%` }}
                      onClick={() => onPick(m.id)} aria-pressed={selected === m.id}
                      aria-label={`${m.title}, due ${fmtDate(m.dueDate, true)}, ${statusText(m)}`}
                      title={`${m.title}: ${fmt(m.current, m.unit)} of ${fmt(m.target, m.unit)}`}>
                      <span className="lbl">
                        <span className="t">{m.title}</span>
                        <span className={`s ${statusTone(m)}`}>{m.status === 'reached' ? `reached ${m.reachedAt ? fmtDate(m.reachedAt) : ''}` : `${fmtDate(m.dueDate, span === 'all')}${m.pace === 'behind' || m.overdue ? ', behind' : ''}`}</span>
                      </span>
                      <span className={`dot ${tone}`} style={{ ['--p' as string]: `${pct}%` }} />
                    </button>
                  )
                })}
                {l.end && l.end <= to && <span className="nr-end" style={{ left: `${x(l.end)}%` }} title={`${l.title}, ${fmtDate(l.end, true)}`} />}
              </div>
            </div>
          )
        })}
        {now > 0 && now < 100 && <div className="nr-axis bottom"><span className="now" style={{ left: `${now}%` }}>Today</span></div>}
      </div>
      <div className="nr-foot">
        <div><span>Reached</span><b className={reached ? 'good' : ''}>{reached}</b></div>
        <div><span>On the way</span><b>{onWay}</b></div>
        <div><span>Next to reach</span><b className={next && (next.pace === 'behind' || next.overdue) ? 'warn' : ''}>{next ? next.title : '–'}{next && <small> {next.daysLeft} days</small>}</b></div>
        <span className="nr-hint">Click a milestone to open it.</span>
      </div>
    </section>
  )
}

// ─── The milestone, opened ───────────────────────────────────────────────────

const MEASURE_LABEL: Record<Measure, string> = {
  manual: 'Typed by hand', steps: 'Steps ticked off', business_mrr: 'Business MRR', business_clients: 'Active clients',
  routine_avg: 'Average day score, last 30 days', trading_net_r: 'Trading net R', training_workouts: 'Workouts logged',
  training_lift: 'Estimated max', weeks_beaten: 'Weeks beaten',
}

function Detail({ m, directions, onEdit }: { m: Milestone; directions: Direction[]; onEdit: () => void }) {
  const fmt = useFmt()
  const act = useMilestoneActions()
  const [typed, setTyped] = useState('')
  const [step, setStep] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const dir = directions.find(d => d.id === m.directionId)
  const auto = m.measure !== 'manual' && m.measure !== 'steps'
  const onError = (e: unknown) => setErr(errText(e))
  const saveTyped = () => {
    const v = Number(typed.replace(',', '.'))
    if (typed.trim() === '' || !Number.isFinite(v)) return
    act.update.mutate({ id: m.id, manualValue: v }, { onSuccess: () => setTyped(''), onError })
  }

  return (
    <section className="nx-sec nr-side" aria-label={`Milestone ${m.title}`}>
      <p className={`nx-state ${statusTone(m)}`}>{m.kind === 'foundation' ? 'Foundation, ' : ''}{statusText(m)}</p>
      <h2 className="nr-title">{m.title}</h2>
      <div className="nr-now">
        <span className="nw-big num">{m.measure === 'steps' ? `${m.current ?? 0}` : fmt(m.current, m.unit)}</span>
        <span className="nw-of num"> of {m.measure === 'steps' ? `${m.target ?? 0} steps` : fmt(m.target, m.unit)}</span>
      </div>
      <div className="nr-bar2" aria-hidden><b className={statusTone(m)} style={{ width: `${Math.round((m.status === 'reached' ? 1 : m.progress ?? 0) * 100)}%` }} /><i style={{ left: `${Math.round(m.elapsed * 100)}%` }} /></div>
      <p className="nr-cap">
        {m.status === 'open' && m.projected != null && m.measure !== 'steps' && <>At this pace: <b className={m.pace === 'behind' ? 'warn' : ''}>{fmt(m.projected, m.unit)}</b> on {fmtDate(m.dueDate)}. </>}
        {m.status === 'open' && m.neededPerMonth != null && m.neededPerMonth > 0 && m.measure !== 'steps' && <>Needs {fmt(m.neededPerMonth, m.unit, true)} a month.</>}
        {m.status === 'open' && m.measure === 'steps' && <>{(m.target ?? 0) - (m.current ?? 0)} steps left, {m.daysLeft} days.</>}
      </p>

      {m.measure === 'steps' && (
        <div className="nr-steps">
          {m.steps.map(s => (
            <label key={s.id} className={s.doneAt ? 'done' : ''}>
              <input type="checkbox" checked={!!s.doneAt} onChange={e => act.setStep.mutate({ id: s.id, done: e.target.checked }, { onError })} />
              <span>{s.title}</span>{s.doneAt && <em>{fmtDate(s.doneAt)}</em>}
            </label>
          ))}
          <form onSubmit={e => { e.preventDefault(); if (step.trim()) act.addStep.mutate({ id: m.id, title: step.trim() }, { onSuccess: () => setStep(''), onError }) }}>
            <input className="nr-in" value={step} onChange={e => setStep(e.target.value)} placeholder="Add a step, Enter" aria-label="Add a step" />
          </form>
        </div>
      )}
      {m.measure === 'manual' && m.status === 'open' && (
        <form className="nr-typed" onSubmit={e => { e.preventDefault(); saveTyped() }}>
          <input className="nr-in num" value={typed} onChange={e => setTyped(e.target.value)} inputMode="decimal" placeholder={`Where are you now${m.unit ? `, in ${m.unit}` : ''}?`} aria-label="Current value" />
          <button className="nx-btn ghost sm" disabled={!typed.trim()}>Update</button>
        </form>
      )}

      <div className="nr-smart">
        <div><b>S</b><span><b>Specific</b>{m.doneMeans || <em>Add what "reached" means, in words.</em>}</span></div>
        <div><b>M</b><span><b>Measurable</b>{MEASURE_LABEL[m.measure]}{m.measureParam ? `: ${m.measureParam}` : ''}{auto && <> · <button className="nr-lnk" onClick={() => act.unlink.mutate({ id: m.id, current: m.current }, { onError })}>unlink, type it by hand</button></>}</span></div>
        <div><b>A</b><span><b>Achievable</b>{m.status !== 'open' ? 'Settled.' : m.pace === 'behind' || m.overdue ? <span className="warn">Behind the line to its date. Raise the pace, or move the date.</span> : m.pace ? 'On the line to its date.' : 'Too early to judge.'}</span></div>
        <div><b>R</b><span><b>Relevant</b>{m.kind === 'foundation' ? 'Foundation: the habits that hold every direction up.' : dir ? <>Serves "{dir.title}".</> : <span className="warn">No direction yet. Edit to link one.</span>}</span></div>
        <div><b>T</b><span><b>Time-bound</b>{fmtDate(m.startDate, true)} to {fmtDate(m.dueDate, true)}</span></div>
      </div>

      <div className="nr-fed">
        <div className="nw-sub"><span>Fed by</span><em>monthly and weekly goals</em></div>
        {m.fedBy.length ? m.fedBy.map(f => <div key={f.taskId} className="nx-line"><span className="k">{f.title}</span></div>)
          : <p className="nr-cap" style={{ marginTop: 6 }}>Nothing links here yet. Link goals to it when you plan a month or a week.</p>}
      </div>

      {err && <p className="nr-err" role="alert">{err}</p>}
      <div className="nx-acts nr-acts">
        {m.status === 'open'
          ? <button className="nx-btn sm" onClick={() => act.setStatus.mutate({ id: m.id, status: 'reached' }, { onError })}>Mark reached</button>
          : <button className="nx-btn ghost sm" onClick={() => act.setStatus.mutate({ id: m.id, status: 'open' }, { onError })}>Open again</button>}
        <button className="nx-btn ghost sm" onClick={onEdit}>Edit</button>
        {m.status === 'open' && <button className="nr-quiet" onClick={() => act.setStatus.mutate({ id: m.id, status: 'dropped' }, { onError })}>Drop</button>}
      </div>
    </section>
  )
}

/** Where it started, where it is, and where this pace lands, against the straight line to the target. */
function Trajectory({ m }: { m: Milestone }) {
  const fmt = useFmt()
  if (m.measure === 'steps' || m.target == null || m.start == null || m.current == null) {
    return (
      <section className="nx-sec">
        <div className="nx-head"><h2 className="nx-h">Trajectory</h2></div>
        <p className="nx-answer">{m.measure === 'steps' ? 'A milestone made of steps has no line to draw; its steps are in the review.' : 'Needs a start, a target and a reading to draw.'}</p>
      </section>
    )
  }
  const W = 640, H = 170, P = 34
  const t0 = t(m.startDate), t1 = t(m.dueDate), tn = Math.min(t1, Math.max(t0, t(today())))
  const lo = Math.min(m.start, m.target, m.current, m.projected ?? m.current), hi = Math.max(m.start, m.target, m.current, m.projected ?? m.current)
  const pad = (hi - lo) * 0.08 || 1
  const X = (ts: number) => P + ((ts - t0) / Math.max(1, t1 - t0)) * (W - P * 2)
  const Y = (v: number) => H - 24 - ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * (H - 44)
  const behind = m.pace === 'behind' || m.overdue
  return (
    <section className="nx-sec">
      <div className="nx-head"><h2 className="nx-h">Trajectory</h2><div className="nx-aside">{fmtDate(m.startDate, true)} to {fmtDate(m.dueDate, true)}</div></div>
      <svg className="nr-traj" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`From ${fmt(m.start, m.unit)} to ${fmt(m.current, m.unit)} now; the line to ${fmt(m.target, m.unit)}; at this pace ${fmt(m.projected, m.unit)}`}>
        <line x1={P} x2={W - P} y1={Y(m.target)} y2={Y(m.target)} className="tgt" />
        <text x={W - P + 4} y={Y(m.target) + 4} className="lbl">{fmt(m.target, m.unit)}</text>
        <line x1={X(t0)} y1={Y(m.start)} x2={X(t1)} y2={Y(m.target)} className="need" />
        <line x1={X(t0)} y1={Y(m.start)} x2={X(tn)} y2={Y(m.current)} className="act" />
        {m.projected != null && m.status === 'open' && <line x1={X(tn)} y1={Y(m.current)} x2={X(t1)} y2={Y(m.projected)} className={`proj ${behind ? 'w' : ''}`} />}
        <circle cx={X(tn)} cy={Y(m.current)} r="5" className="now" />
        <text x={X(t0)} y={H - 6} className="lbl">{fmtDate(m.startDate)}</text>
        <text x={X(tn)} y={H - 6} className="lbl" textAnchor="middle">Today</text>
        <text x={X(t1)} y={H - 6} className="lbl" textAnchor="end">{fmtDate(m.dueDate)}</text>
      </svg>
      <div className="nr-legend"><span><i className="act" />Start to now</span><span><i className="need" />The line to the target</span><span><i className={`proj ${behind ? 'w' : ''}`} />Where this pace lands</span></div>
    </section>
  )
}

function Directions({ directions, milestones, onEdit, onAdd }: { directions: Direction[]; milestones: Milestone[]; onEdit: (d: Direction) => void; onAdd: () => void }) {
  return (
    <section className="nx-sec">
      <div className="nx-head"><h2 className="nx-h">Directions</h2><div className="nx-aside"><button className="nx-link" onClick={onAdd}><Plus size={13} aria-hidden />Add</button></div></div>
      {directions.length === 0 ? <p className="nx-answer">No directions yet. A direction is where you want to be in three years.</p>
        : directions.map(d => {
          const own = milestones.filter(m => m.directionId === d.id)
          return (
            <button key={d.id} className="nx-line btn nr-dir" onClick={() => onEdit(d)}>
              <span className="k">{d.title}{d.why && <em>{d.why}</em>}</span>
              <span className="v num">{own.filter(m => m.status === 'reached').length} of {own.length} reached</span>
            </button>
          )
        })}
    </section>
  )
}

// ─── Sheets ──────────────────────────────────────────────────────────────────

function Sheet({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="nr-sheet-bg" onMouseDown={onClose}>
      <div className="nr-sheet" role="dialog" aria-label={title} onMouseDown={e => e.stopPropagation()}>
        <div className="hd"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div><button className="nx-btn ghost sm" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  )
}

const MEASURE_OPTIONS: { value: Measure; label: string; unit: string | null }[] = [
  { value: 'business_mrr', label: 'Business MRR', unit: 'GBP' },
  { value: 'business_clients', label: 'Active clients', unit: 'clients' },
  { value: 'trading_net_r', label: 'Trading net R since the start', unit: 'R' },
  { value: 'training_lift', label: 'A lift\'s estimated max', unit: 'kg' },
  { value: 'training_workouts', label: 'Workouts logged since the start', unit: 'workouts' },
  { value: 'routine_avg', label: 'Average day score (30 days)', unit: 'points' },
  { value: 'weeks_beaten', label: 'Weeks beaten since the start', unit: 'weeks' },
  { value: 'manual', label: 'A number I type myself', unit: null },
  { value: 'steps', label: 'A list of steps', unit: null },
]

function MilestoneSheet({ init, directions, onClose, onSaved }: {
  init: Extract<SheetState, { kind: 'milestone' }>; directions: Direction[]; onClose: () => void; onSaved: (id: number | null) => void
}) {
  const act = useMilestoneActions()
  const training = useTraining()
  const m = init.m
  const fmt = useFmt()
  const [kind, setKind] = useState<'milestone' | 'foundation'>(m?.kind ?? (init.foundation ? 'foundation' : 'milestone'))
  const [title, setTitle] = useState(m?.title ?? '')
  const [doneMeans, setDoneMeans] = useState(m?.doneMeans ?? '')
  const [measure, setMeasure] = useState<Measure>(m?.measure ?? (init.foundation ? 'routine_avg' : 'business_mrr'))
  const [param, setParam] = useState(m?.measureParam ?? '')
  const [unit, setUnit] = useState(m?.unit ?? (init.foundation ? 'points' : 'GBP'))
  const [start, setStart] = useState(m?.startValue != null ? String(m.startValue) : '')
  const [target, setTarget] = useState(m?.targetValue != null ? String(m.targetValue) : '')
  const [up, setUp] = useState(m?.higherIsBetter ?? true)
  const [startDate, setStartDate] = useState(m?.startDate ?? today())
  const [dueDate, setDueDate] = useState(m?.dueDate ?? init.due ?? endOfYear())
  const [directionId, setDirectionId] = useState<number | null>(m ? m.directionId : init.directionId ?? null)
  const [steps, setSteps] = useState('')
  const [reading, setReading] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const lifts = useMemo(() => (training.data?.progress ?? []).map(p => p.name), [training.data])

  // Starting from where you are: read the measure now, and use it as the start of a new milestone.
  const canPreview = !(measure === 'manual' || measure === 'steps' || (measure === 'training_lift' && !param))
  useEffect(() => {
    let off = false
    if (!canPreview) return
    api.get<{ current: number | null }>('/api/milestones/preview', { params: { measure, param: param || undefined, from: startDate } })
      .then(r => { if (off) return; setReading(r.data.current); if (!m && r.data.current != null && measure !== 'trading_net_r' && measure !== 'training_workouts' && measure !== 'weeks_beaten') setStart(String(r.data.current)) })
      .catch(() => { if (!off) setReading(null) })
    return () => { off = true }
  }, [measure, param, startDate, canPreview]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickMeasure = (v: Measure) => {
    setMeasure(v)
    const u = MEASURE_OPTIONS.find(o => o.value === v)?.unit
    if (u !== undefined && (v !== 'manual')) setUnit(u ?? '')
    // Counts that start at zero from the start date.
    if (!m && ['trading_net_r', 'training_workouts', 'weeks_beaten'].includes(v)) setStart('0')
  }

  const s = Number(start), tg = Number(target)
  const days = Math.max(1, Math.round((t(dueDate) - t(today())) / 864e5))
  const shownReading = canPreview ? reading : null
  const cur = shownReading ?? (Number.isFinite(s) ? s : null)
  const needed = measure !== 'steps' && target !== '' && cur != null && Number.isFinite(tg) ? round(((tg - cur) / days) * 30) : null
  const u = unit || null

  const submit = () => {
    setErr(null)
    const body: MilestoneInput = {
      kind, title, doneMeans: doneMeans || null, measure, measureParam: param || null, unit: u,
      startValue: measure === 'steps' ? 0 : start === '' ? null : Number(start),
      targetValue: measure === 'steps' ? null : target === '' ? null : Number(target),
      higherIsBetter: up, startDate, dueDate, directionId: kind === 'foundation' ? null : directionId,
      ...(m ? {} : { steps: measure === 'steps' ? steps.split('\n').map(x => x.trim()).filter(Boolean) : [] }),
    }
    const onError = (e: unknown) => setErr(errText(e))
    if (m) act.update.mutate({ id: m.id, ...body }, { onSuccess: () => onClose(), onError })
    else act.create.mutate(body, { onSuccess: (r: { id: number }) => { onSaved(r.id); onClose() }, onError })
  }

  return (
    <Sheet title={m ? 'Edit milestone' : kind === 'foundation' ? 'New Foundation habit' : 'New milestone'} sub="SMART: specific, measurable, achievable, relevant, time-bound." onClose={onClose}>
      <div className="nr-form">
        <div className="nr-kind nw-seg" role="group" aria-label="Kind">
          <button className={kind === 'milestone' ? 'on' : ''} onClick={() => setKind('milestone')}>Milestone</button>
          <button className={kind === 'foundation' ? 'on' : ''} onClick={() => setKind('foundation')}>Foundation habit</button>
        </div>

        <label className="f"><span><b>S</b> What is it?</span>
          <input className="nr-in" autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder={kind === 'foundation' ? 'Average day score 60+' : 'MRR £3,000'} /></label>
        <label className="f"><span>Reached means</span>
          <input className="nr-in" value={doneMeans} onChange={e => setDoneMeans(e.target.value)} placeholder="Recurring revenue from retainers reaches £3,000 a month" /></label>

        <label className="f"><span><b>M</b> Measured by</span>
          <select className="nr-in" value={measure} onChange={e => pickMeasure(e.target.value as Measure)}>
            {MEASURE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select></label>
        {measure === 'training_lift' && (
          <label className="f"><span>Which lift</span>
            <select className="nr-in" value={param} onChange={e => setParam(e.target.value)}>
              <option value="">Pick a lift</option>
              {lifts.map(l => <option key={l} value={l}>{l}</option>)}
            </select></label>
        )}
        {measure === 'steps' ? (
          !m && <label className="f"><span>Steps, one per line</span>
            <textarea className="nr-in" rows={4} value={steps} onChange={e => setSteps(e.target.value)} placeholder={'Design\nBuild\nLaunch'} /></label>
        ) : (
          <div className="nr-row3">
            <label className="f"><span>Start</span><input className="nr-in num" value={start} onChange={e => setStart(e.target.value)} inputMode="decimal" /></label>
            <label className="f"><span>Target</span><input className="nr-in num" value={target} onChange={e => setTarget(e.target.value)} inputMode="decimal" /></label>
            <label className="f"><span>Unit</span><input className="nr-in" value={unit} onChange={e => setUnit(e.target.value)} placeholder="GBP, kg, R…" /></label>
          </div>
        )}
        {measure !== 'steps' && (
          <div className="nr-hintline">
            {shownReading != null && <span>Now: <b>{fmt(shownReading, u)}</b></span>}
            <label className="nr-check"><input type="checkbox" checked={!up} onChange={e => setUp(!e.target.checked)} /> Lower is better</label>
          </div>
        )}

        <div className="f"><span><b>T</b> Due</span>
          <div className="nr-dates">
            <input className="nr-in num" type="date" value={dueDate} min={startDate} onChange={e => setDueDate(e.target.value)} aria-label="Due date" />
            <button className={`nx-chip ${dueDate === endOfMonth() ? 'on' : ''}`} onClick={() => setDueDate(endOfMonth())}>This month</button>
            <button className={`nx-chip ${dueDate === endOfYear() ? 'on' : ''}`} onClick={() => setDueDate(endOfYear())}>This year</button>
            <button className={`nx-chip ${dueDate === endOfYear(1) ? 'on' : ''}`} onClick={() => setDueDate(endOfYear(1))}>Next year</button>
          </div>
          <label className="nr-small">Started <input className="nr-in num" type="date" value={startDate} max={dueDate} onChange={e => setStartDate(e.target.value)} aria-label="Start date" /></label>
        </div>

        {kind === 'milestone' && (
          <label className="f"><span><b>R</b> Serves</span>
            <select className="nr-in" value={directionId ?? ''} onChange={e => setDirectionId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">No direction yet</option>
              {directions.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select></label>
        )}

        <div className="nr-achieve">
          <b>A</b>
          <span>{measure === 'steps' ? `${steps.split('\n').filter(x => x.trim()).length || (m?.steps.length ?? 0)} steps in ${days} days.`
            : needed == null ? 'Set a target to see what it asks of you.'
            : <>Needs <b>{fmt(needed, u, true)}</b> a month for {Math.round(days / 30.4 * 10) / 10} months. Is that a pace you've held before?</>}</span>
        </div>

        {err && <p className="nr-err" role="alert">{err}</p>}
        <div className="nr-foot2">
          {m && <button className="nr-quiet" onClick={() => act.remove.mutate(m.id, { onSuccess: () => onClose(), onError: e => setErr(errText(e)) })}>Delete</button>}
          <span className="nr-grow" />
          <button className="nx-btn" disabled={!title.trim() || act.create.isPending || act.update.isPending} onClick={submit}>{m ? 'Save' : 'Add milestone'}</button>
        </div>
      </div>
    </Sheet>
  )
}

function DirectionSheet({ d, onClose }: { d?: Direction; onClose: () => void }) {
  const act = useDirectionActions()
  const [title, setTitle] = useState(d?.title ?? '')
  const [why, setWhy] = useState(d?.why ?? '')
  const [date, setDate] = useState(d?.targetDate ?? endOfYear(3))
  const [err, setErr] = useState<string | null>(null)
  const onError = (e: unknown) => setErr(errText(e))
  const submit = () => d
    ? act.update.mutate({ id: d.id, title, why, targetDate: date }, { onSuccess: onClose, onError })
    : act.create.mutate({ title, why, targetDate: date }, { onSuccess: onClose, onError })
  return (
    <Sheet title={d ? 'Edit direction' : 'New direction'} sub="Where you want to be in about three years. Milestones on its lane lead there." onClose={onClose}>
      <div className="nr-form">
        <label className="f"><span>Direction</span><input className="nr-in" autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Zavabuild at £10k MRR" /></label>
        <label className="f"><span>Why it matters</span><input className="nr-in" value={why} onChange={e => setWhy(e.target.value)} placeholder="Freedom to choose my work" /></label>
        <label className="f"><span>By</span><input className="nr-in num" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        {err && <p className="nr-err" role="alert">{err}</p>}
        <div className="nr-foot2">
          {d && <button className="nr-quiet" onClick={() => act.archive.mutate(d.id, { onSuccess: onClose, onError })}>Archive</button>}
          <span className="nr-grow" />
          <button className="nx-btn" disabled={!title.trim() || act.create.isPending || act.update.isPending} onClick={submit}>{d ? 'Save' : 'Add direction'}</button>
        </div>
      </div>
    </Sheet>
  )
}
