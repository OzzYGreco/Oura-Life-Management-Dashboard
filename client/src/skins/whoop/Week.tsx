import { useEffect, useRef, useState } from 'react'
import { HORIZONS, SOURCES, fmtRange, periodEnd, periodLabel, periodName, pts, useCreateCurrent, usePlanNextWeek, useSaveWeek, type GoalsSettings, type Horizon, type HorizonInfo, type HorizonRules, type HistoryItem, type Source, type WeekGoal, type WeekTask, type WeekView } from '../../core/week'
import { getSignature, setSignature } from '../../core/scorecardImage'
import { FREE_POINTS, useUpChain, type UpChain } from '../../core/goals'
import './week.css'

// ─── Page ────────────────────────────────────────────────────────────────────

export type Compose = { mode: 'next' } | { mode: 'current' } | { mode: 'edit'; goal: WeekGoal; name: string }

/** What the page needs to know about the horizon being shown. */
export interface Ctx { data: WeekView; horizon: Horizon; H: HorizonInfo; rules: HorizonRules }

function useEscape(onClose: () => void) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
}

// ─── Your record: the numbers across the top and a tile per period ───────────

/** A period counts as done once its dates have passed or it was closed by hand. */
const finished = (h: HistoryItem) => !h.current || !!h.closed

function statusOf(h: HistoryItem, threshold: number): { text: string; tone: 'good' | 'bad' | 'open' } {
  if (!finished(h)) return { text: h.score >= threshold ? 'Beaten already' : `In progress · ${pts(threshold)} to beat`, tone: h.score >= threshold ? 'good' : 'open' }
  return h.score >= threshold ? { text: 'Beaten', tone: 'good' } : { text: `Missed · needed ${pts(threshold)}`, tone: 'bad' }
}

/** Every period as a row, newest first; expand one or all to see the tasks. */
export function PastList({ ctx, selected, onPick }: { ctx: Ctx; selected: number | null; onPick: (id: number) => void }) {
  const { data, H, rules, horizon } = ctx
  const rows = [...data.history].reverse()
  const [open, setOpen] = useState<Set<number>>(() => new Set())
  const allOpen = rows.length > 0 && rows.every(r => open.has(r.id))
  const flip = (id: number) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  if (!rows.length) return <div className="wk-list"><span className="wk-none">No {H.units} recorded yet.</span></div>
  return (
    <div className="wk-list">
      <div className="wk-list-hd">
        <span className="wh-sub">{rows.length} {rows.length === 1 ? H.unit : H.units}, newest first</span>
        <button className="wh-chase" onClick={() => setOpen(allOpen ? new Set() : new Set(rows.map(r => r.id)))} aria-expanded={allOpen}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
      </div>
      <div className="wk-rows">
        {rows.map(h => {
          const idx = data.history.indexOf(h) + 1
          const st = statusOf(h, rules.threshold)
          const isOpen = open.has(h.id)
          return (
            <div key={h.id} className={`wk-row ${isOpen ? 'open' : ''} ${selected === h.id ? 'on' : ''}`}>
              <button className="hd" aria-expanded={isOpen} onClick={() => flip(h.id)} aria-label={`${periodName(horizon, h.from, h.to, idx)}, ${pts(h.score)} of ${pts(h.max)}, ${st.text}`}>
                <svg className="chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>
                <span className="lb num">{periodLabel(horizon, h.from, h.to, idx)}</span>
                <span className="rg">{fmtRange(h.from, h.to)}</span>
                <span className="fc">{h.focus || 'No focus'}</span>
                <span className="sc num" style={{ color: st.tone === 'good' ? 'var(--k-good)' : st.tone === 'bad' ? 'var(--k-bad)' : 'var(--k-ink)' }}>{pts(h.score)}<i> / {pts(h.max)}</i></span>
                <span className={`st ${st.tone}`}>{st.text}</span>
              </button>
              {isOpen && (
                <div className="bd">
                  {(h.tasks ?? []).map((t, i) => (
                    <div key={i} className="tk">
                      <span>{t.title}</span>
                      <b className="num" style={{ color: t.earned == null ? 'var(--k-faint)' : t.earned >= t.max ? 'var(--k-good)' : t.earned === 0 ? 'var(--k-bad)' : 'var(--k-ink)' }}>
                        {t.earned == null ? '–' : pts(t.earned)}<i> / {pts(t.max)}</i>
                      </b>
                    </div>
                  ))}
                  {h.reward && <div className="rw">Earned: {h.reward}</div>}
                  <button className="wh-chase" onClick={() => onPick(h.id)}>Open the scorecard</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── The scorecard: one period, made to be shared ────────────────────────────

/** Segment size: quarter points up to 10, then a round step so the bar stays clickable. */
function segStep(max: number): number {
  if (max <= 10) return 0.25
  for (const s of [0.5, 1, 2, 2.5, 5, 10, 25, 50, 100]) if (max / s <= 40) return s
  return Math.ceil(max / 40)
}

/** Click where the score is: one click per task. Or click the number to type it; Enter moves to the next task. */
export function SegScore({ value, max, onSet, busy, title, typing, onTyping, onNext }: {
  value: number | null; max: number; onSet: (v: number | null) => void; busy: boolean; title: string
  typing: boolean; onTyping: (on: boolean) => void; onNext: () => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  const step = segStep(max)
  const n = Math.max(1, Math.ceil(max / step - 1e-9))
  const shown = hover ?? value ?? 0
  const full = value != null && value >= max
  const handled = useRef(false)
  useEffect(() => { if (typing) handled.current = false }, [typing])

  const commit = (raw: string) => {
    const s = raw.trim().replace(',', '.')
    const v = s === '' ? null : Number(s)
    if (v != null && !Number.isFinite(v)) return
    const clamped = v == null ? null : Math.round(Math.min(max, Math.max(0, v)) * 100) / 100
    if (clamped !== value) onSet(clamped)
  }

  return (
    <span className="seg" role="group" aria-label={`Score ${title}`} onMouseLeave={() => setHover(null)}>
      <button className={`zero ${value === 0 ? 'on' : ''}`} disabled={busy} onClick={() => onSet(0)} aria-label="Score 0">0</button>
      <span className="bar">
        {Array.from({ length: n }, (_, i) => {
          const v = Math.min(max, Math.round((i + 1) * step * 100) / 100)
          return (
            <button key={i} disabled={busy} onMouseEnter={() => setHover(v)} onFocus={() => setHover(v)} onBlur={() => setHover(null)} onClick={() => onSet(v)}
              className={v <= shown ? 'fill' : ''} aria-label={`Score ${pts(v)}`} title={pts(v)}
              style={{ background: v <= shown ? (hover != null ? 'rgba(236,239,244,.55)' : full ? 'var(--k-good)' : 'var(--k-ink2)') : undefined }} />
          )
        })}
      </span>
      {typing ? (
        <input className="wk-typed num" autoFocus type="number" inputMode="decimal" min={0} max={max} step="any"
          defaultValue={value ?? ''} aria-label={`Type the score for ${title}, out of ${pts(max)}`}
          onFocus={e => e.currentTarget.select()}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); handled.current = true; commit(e.currentTarget.value); onNext() }
            else if (e.key === 'Escape') { e.stopPropagation(); handled.current = true; onTyping(false) }
          }}
          onBlur={e => { if (handled.current) return; handled.current = true; commit(e.currentTarget.value); onTyping(false) }} />
      ) : (
        <button className="wk-val num" onClick={() => onTyping(true)} aria-label={`Type the score for ${title}`} title="Click to type a score"
          style={{ color: hover != null ? 'var(--k-ink)' : value == null ? 'var(--k-faint)' : full ? 'var(--k-good)' : 'var(--k-ink)' }}>
          {hover != null ? pts(hover) : value == null ? '–' : pts(value)}
        </button>
      )}
    </span>
  )
}

// ─── No goal for this period yet ─────────────────────────────────────────────

type Draft = Omit<WeekTask, 'earnedPoints'> & { key: string }
let dseq = 0
const dk = () => `d${++dseq}`
const r2 = (n: number) => Math.round(n * 100) / 100

/** Points typed straight in, kept as text while typing so "1." or "0.2" are not cut short. */
function PointsInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [s, setS] = useState(String(value))
  useEffect(() => { if (Number(s) !== value) setS(String(value)) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input className="num" value={s} inputMode="decimal" aria-label={label}
      onFocus={e => e.currentTarget.select()}
      onChange={e => { setS(e.target.value); const n = Number(e.target.value.replace(',', '.')); if (Number.isFinite(n) && n > 0) onChange(r2(n)) }}
      onBlur={() => setS(String(value))} />
  )
}

export function Composer({ ctx, compose, onClose, onSaved }: { ctx: Ctx; compose: Compose; onClose: () => void; onSaved: (id: number | null) => void }) {
  const { data, H, rules, horizon } = ctx
  const plan = usePlanNextWeek()
  const create = useCreateCurrent()
  const save = useSaveWeek()
  const mode = compose.mode
  const base: WeekGoal | null = mode === 'edit' ? compose.goal : mode === 'next' ? data.next : null
  const isCur = mode === 'edit' && compose.goal.id === data.current?.id
  const natural = mode === 'next'
    ? (data.nextPeriod ?? (data.nextStart ? { from: data.nextStart, to: periodEnd(horizon, data.nextStart) } : null))
    : (data.period ?? { from: data.today, to: periodEnd(horizon, data.today) })
  const [from, setFrom] = useState(base?.from ?? natural?.from ?? data.today)
  const [to, setTo] = useState(base?.to ?? natural?.to ?? periodEnd(horizon, data.today))
  const [focus, setFocus] = useState(base?.focus ?? '')
  const [tasks, setTasks] = useState<Draft[]>(() => (base?.tasks ?? []).map(t => ({ id: t.id, title: t.title, maxPoints: t.maxPoints, source: t.source, target: t.target, parentTaskId: t.parentTaskId ?? null, milestoneId: t.milestoneId ?? null, up: t.up ?? null, key: dk() })))
  const [rewards, setRewards] = useState(() => (base?.rewards.length ? base.rewards : data.current?.rewards ?? []).map(r => ({ minScore: r.minScore, reward: r.reward })))
  const [editRewards, setEditRewards] = useState(false)
  const [typed, setTyped] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEscape(onClose)
  const chain = useUpChain(horizon, from)
  /** What a suggestion served last time, if that's still on offer. */
  const lastLink = (sg: WeekView['suggestions']['tasks'][number]): Partial<Draft> => {
    if (!chain) return {}
    if (chain.field === 'milestoneId') return sg.milestoneId != null && chain.options.some(o => o.id === sg.milestoneId) ? { milestoneId: sg.milestoneId } : {}
    const hit = sg.parentTitle ? chain.options.find(o => o.title.trim().toLowerCase() === sg.parentTitle!.trim().toLowerCase()) : undefined
    return hit ? { parentTaskId: hit.id } : {}
  }
  const setUp = (key: string, id: number | null) => chain && setTasks(ts => ts.map(x => x.key === key ? { ...x, [chain.field]: id, up: chain.options.find(o => o.id === id)?.title ?? null } : x))

  // Moving the start moves the end with it, while the end is still the natural one.
  const setStart = (f: string) => {
    if (f && /^\d{4}-\d{2}-\d{2}$/.test(f) && to === periodEnd(horizon, from)) setTo(periodEnd(horizon, f))
    setFrom(f)
  }

  const has = (title: string) => tasks.some(t => t.title.trim().toLowerCase() === title.trim().toLowerCase())
  const toggle = (sg: WeekView['suggestions']['tasks'][number]) => has(sg.title)
    ? setTasks(tasks.filter(t => t.title.trim().toLowerCase() !== sg.title.trim().toLowerCase()))
    : setTasks([...tasks, { title: sg.title, maxPoints: sg.maxPoints, source: sg.source, target: sg.target, ...lastLink(sg), key: dk() }])
  const addTyped = () => {
    const t = typed.trim()
    if (!t || has(t)) { setTyped(''); return }
    setTasks([...tasks, { title: t, maxPoints: rules.defaultPoints, source: 'manual', target: null, key: dk() }]); setTyped('')
  }
  const setPts = (key: string, v: number) => setTasks(ts => ts.map(x => x.key === key ? { ...x, maxPoints: Math.max(0.25, r2(v)) } : x))
  const total = r2(tasks.reduce((s, t) => s + t.maxPoints, 0))
  const lastDone = data.history.filter(h => !h.current).slice(-1)[0]
  const [usual, usualWhen] = mode === 'next' && data.current
    ? [r2(data.current.tasks.reduce((s, t) => s + t.maxPoints, 0)), `this ${H.unit}`]
    : lastDone ? [lastDone.max, `last ${H.unit}`] : [rules.max, 'your max']
  const title = mode === 'next' ? `Next ${H.unit}` : mode === 'current' ? `This ${H.unit}` : isCur ? `This ${H.unit}` : compose.name
  const busy = plan.isPending || create.isPending || save.isPending

  const submit = () => {
    setErr(null)
    if (!from || !to) { setErr('Pick a start and an end date.'); return }
    if (from > to) { setErr('The period has to end after it starts.'); return }
    const onError = (e: any) => setErr(e?.response?.data?.error ?? `Could not save the ${H.unit}.`)
    const clean = tasks.map(t => ({ id: t.id, title: t.title, maxPoints: t.maxPoints, source: t.source, target: t.target, parentTaskId: t.parentTaskId ?? null, milestoneId: t.milestoneId ?? null }))
    if (base && mode === 'edit') {
      // Keeps each task's id, so scores already entered stay.
      save.mutate({ id: base.id, focus, from, to, tasks: clean.map(t => ({ ...t, earnedPoints: null })), rewards }, { onSuccess: onClose, onError })
    } else if (mode === 'next') {
      plan.mutate({ horizon, focus, from, to, tasks: clean, rewards }, { onSuccess: () => onClose(), onError })
    } else {
      create.mutate({ horizon, focus, from, to, tasks: clean, rewards }, { onSuccess: r => { onSaved(r.id); onClose() }, onError })
    }
  }

  return (
    <div className="wh-sheet-bg nx-sheet-bg" onMouseDown={onClose}>
      <div className="wh wh-sheet wk-sheet nx-compose" role="dialog" aria-label={title} onMouseDown={e => e.stopPropagation()}>
        <div className="hd">
          <div>
            <div className="wh-h" style={{ fontSize: 19 }}>{title}</div>
            <div className="wh-sub">{from && to && from <= to ? fmtRange(from, to) : 'Pick the dates'}{mode === 'edit' ? ' · scores you\'ve entered stay' : ''}</div>
          </div>
          <button className="wh-chase" onClick={onClose}>Close</button>
        </div>

        <div className="lbl">Period <span>{natural && from === natural.from && to === natural.to ? `the natural ${H.unit}` : 'custom dates'}</span></div>
        <div className="wk-dates">
          <label><span>Starts</span><input className="in num" type="date" value={from} onChange={e => setStart(e.target.value)} aria-label="Period start" /></label>
          <label><span>Ends</span><input className="in num" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} aria-label="Period end" /></label>
          {natural && (from !== natural.from || to !== natural.to) && mode !== 'edit' && (
            <button className="lnk" onClick={() => { setFrom(natural.from); setTo(natural.to) }}>Back to {fmtRange(natural.from, natural.to)}</button>
          )}
        </div>

        <div className="lbl">Focus</div>
        <input className="in" value={focus} onChange={e => setFocus(e.target.value)} placeholder={`What's this ${H.unit} about?`} aria-label="Focus" />
        {data.suggestions.focuses.length > 0 && (
          <div className="chips">
            {data.suggestions.focuses.map(f => (
              <button key={f} className={focus === f ? 'on' : ''} onClick={() => setFocus(f)}>{f}</button>
            ))}
          </div>
        )}

        <div className="lbl">Goals {data.suggestions.tasks.length > 0 && <span>tap to add, tap again to remove</span>}</div>
        {data.suggestions.tasks.length > 0 && (
          <div className="chips">
            {data.suggestions.tasks.map(sg => (
              <button key={sg.title} className={has(sg.title) ? 'on' : ''} onClick={() => toggle(sg)} aria-pressed={has(sg.title)}>
                {has(sg.title) ? '✓ ' : '+ '}{sg.title}<small>{sg.weeks}{H.unit[0]}</small>
              </button>
            ))}
          </div>
        )}
        <form className="type" onSubmit={e => { e.preventDefault(); addTyped() }}>
          <input className="in" value={typed} onChange={e => setTyped(e.target.value)} placeholder={`${data.suggestions.tasks.length ? 'Or type' : 'Type'} a new goal and press Enter (${pts(rules.defaultPoints)} pt${rules.defaultPoints === 1 ? '' : 's'})`} aria-label="New goal" />
        </form>

        {tasks.length > 0 && (
          <div className="picked">
            {tasks.map(t => (
              <div key={t.key} className="p">
                <span className="t">{t.title}</span>
                <select value={t.source} onChange={e => setTasks(tasks.map(x => x.key === t.key ? { ...x, source: e.target.value as Source, target: e.target.value === 'workouts' ? (x.target ?? 4) : null } : x))} aria-label="How it's scored">
                  {SOURCES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span className="pts">
                  <button onClick={() => setPts(t.key, t.maxPoints - 0.5)} aria-label={`Fewer points for ${t.title}`}>−</button>
                  <PointsInput value={t.maxPoints} onChange={v => setPts(t.key, v)} label={`Points for ${t.title}`} />
                  <button onClick={() => setPts(t.key, t.maxPoints + 0.5)} aria-label={`More points for ${t.title}`}>+</button>
                </span>
                <button className="x" onClick={() => setTasks(tasks.filter(x => x.key !== t.key))} aria-label={`Remove ${t.title}`}>×</button>
                {chain && <UpPick chain={chain} task={t} onPick={id => setUp(t.key, id)} />}
              </div>
            ))}
            {chain && <Alignment chain={chain} tasks={tasks} total={total} unit={H.unit} onFix={onClose} />}
            <div className="sum">
              <span>Total</span>
              <b className="num" style={{ color: total === usual ? 'var(--k-good)' : 'var(--k-warn)' }}>{pts(total)} points</b>
              <span className="wh-sub">{total === usual ? `same as ${usualWhen}` : `${usualWhen} was ${pts(usual)}`} · beaten at {pts(rules.threshold)}</span>
            </div>
          </div>
        )}

        <div className="lbl">Rewards {!editRewards && <button className="lnk" onClick={() => setEditRewards(true)}>change</button>}</div>
        {!editRewards ? (
          <div className="chips static">
            {rewards.length ? rewards.map(r => <span key={r.minScore + r.reward}><b className="num">{pts(r.minScore)}+</b> {r.reward}</span>) : <span>No rewards yet</span>}
          </div>
        ) : (
          <div className="rew">
            {rewards.map((r, i) => (
              <div key={i} className="r">
                <input className="in num" type="number" step={0.25} value={r.minScore} onChange={e => setRewards(rewards.map((x, j) => j === i ? { ...x, minScore: Number(e.target.value) } : x))} aria-label="Score needed" />
                <input className="in" value={r.reward} onChange={e => setRewards(rewards.map((x, j) => j === i ? { ...x, reward: e.target.value } : x))} aria-label="Reward" />
                <button className="x" onClick={() => setRewards(rewards.filter((_, j) => j !== i))} aria-label="Remove reward">×</button>
              </div>
            ))}
            <button className="lnk" onClick={() => setRewards([...rewards, { minScore: (rewards[rewards.length - 1]?.minScore ?? 6) + 1, reward: '' }])}>+ reward</button>
          </div>
        )}

        <div className="foot">
          {err && <span style={{ color: 'var(--k-bad)', fontSize: 13 }} role="alert">{err}</span>}
          <button className="wh-btn" disabled={!tasks.length || busy} onClick={submit}>
            {mode === 'next' ? (base ? `Save next ${H.unit}` : `Set next ${H.unit}`) : mode === 'current' ? `Set this ${H.unit}` : isCur ? `Save this ${H.unit}` : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Up the chain: what each goal serves, and how much of the plan does ──────

const upId = (chain: UpChain, t: Draft) => (chain.field === 'parentTaskId' ? t.parentTaskId : t.milestoneId) ?? null

function UpPick({ chain, task, onPick }: { chain: UpChain; task: Draft; onPick: (id: number | null) => void }) {
  const v = upId(chain, task)
  const groups = [...new Set(chain.options.map(o => o.group))]
  const known = v == null || chain.options.some(o => o.id === v)
  if (!chain.options.length && v == null) return null
  return (
    <label className={`up ${v == null ? 'free' : ''}`}>
      <span>Serves</span>
      <select value={v ?? ''} onChange={e => onPick(e.target.value ? Number(e.target.value) : null)} aria-label={`What ${task.title} serves`}>
        <option value="">Nothing above (life admin)</option>
        {!known && <option value={v!}>{task.up ?? 'Linked earlier'}</option>}
        {groups.map(g => (
          <optgroup key={g} label={g}>
            {chain.options.filter(o => o.group === g).map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

/** The alignment meter: how many of the plan's points move something bigger. */
function Alignment({ chain, tasks, total, unit, onFix }: { chain: UpChain; tasks: Draft[]; total: number; unit: string; onFix: () => void }) {
  if (chain.empty) return (
    <div className="align empty">
      <span>{chain.empty}</span>
      {chain.fix && <a className="lnk" href={chain.fix.href} onClick={onFix}>{chain.fix.label}</a>}
    </div>
  )
  if (!chain.options.length) return null
  const linked = r2(tasks.filter(t => upId(chain, t) != null).reduce((s, t) => s + t.maxPoints, 0))
  const free = r2(total - linked)
  const over = free > FREE_POINTS
  const pct = total ? (linked / total) * 100 : 0
  return (
    <div className={`align ${over ? 'over' : ''}`}>
      <div className="row">
        <span><b className="num">{pts(linked)}</b> of <span className="num">{pts(total)}</span> points serve {chain.target}</span>
        <span className="note">{over
          ? <><span className="num">{pts(free)}</span> serve nothing above; keep it to <span className="num">{FREE_POINTS}</span> or link them</>
          : free > 0 ? <><span className="num">{pts(free)}</span> free for life admin</> : `the whole ${unit} moves something bigger`}</span>
      </div>
      <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Points that serve the level above">
        <b style={{ width: `${pct}%` }} />
        {total > FREE_POINTS && <i style={{ left: `${Math.max(0, ((total - FREE_POINTS) / total) * 100)}%` }} title={`${FREE_POINTS} points may stay free`} />}
      </div>
    </div>
  )
}

// ─── Settings: what counts as beaten, per horizon ────────────────────────────

export function SettingsSheet({ settings, onSave, onClose }: { settings: GoalsSettings; onSave: (s: GoalsSettings) => void; onClose: () => void }) {
  type Field = keyof HorizonRules
  const [draft, setDraft] = useState(() => Object.fromEntries(HORIZONS.map(h => [h.value, {
    max: String(settings[h.value].max), threshold: String(settings[h.value].threshold), defaultPoints: String(settings[h.value].defaultPoints),
  }])) as Record<Horizon, Record<Field, string>>)
  const [err, setErr] = useState<string | null>(null)
  const [sig, setSig] = useState(getSignature)
  useEscape(onClose)
  const set = (h: Horizon, f: Field, v: string) => setDraft(d => ({ ...d, [h]: { ...d[h], [f]: v } }))

  const submit = () => {
    const out = {} as GoalsSettings
    for (const h of HORIZONS) {
      const d = draft[h.value]
      const max = Number(d.max), threshold = Number(d.threshold), defaultPoints = Number(d.defaultPoints)
      if (!(max > 0) || !(threshold >= 0) || !(defaultPoints > 0)) { setErr(`Check the ${h.label.toLowerCase()} numbers: each must be a positive number.`); return }
      if (threshold > max) { setErr(`${h.label}: "beaten at" can't be above the max score.`); return }
      out[h.value] = { max, threshold, defaultPoints }
    }
    setSignature(sig)
    onSave(out); onClose()
  }

  return (
    <div className="wh-sheet-bg" onMouseDown={onClose}>
      <div className="wh wh-sheet wk-sheet wk-settings" role="dialog" aria-label="Goal settings" onMouseDown={e => e.stopPropagation()}>
        <div className="hd">
          <div>
            <div className="wh-h" style={{ fontSize: 19 }}>Goal settings</div>
            <div className="wh-sub">What a period is scored out of, and the score that beats it. Saved for every browser.</div>
          </div>
          <button className="wh-chase" onClick={onClose}>Close</button>
        </div>
        <div className="wk-set" role="table" aria-label="Settings per horizon">
          <div className="r th" role="row"><span /><span>Max score</span><span>Beaten at</span><span>Default points</span></div>
          {HORIZONS.map(h => (
            <div key={h.value} className="r" role="row">
              <span className="h">{h.label}</span>
              {(['max', 'threshold', 'defaultPoints'] as Field[]).map(f => (
                <input key={f} className="in num" type="number" min={0} step={f === 'max' ? 1 : 0.25} value={draft[h.value][f]}
                  onChange={e => set(h.value, f, e.target.value)} aria-label={`${h.label} ${f === 'max' ? 'max score' : f === 'threshold' ? 'beaten at' : 'points per new goal'}`} />
              ))}
            </div>
          ))}
        </div>
        <p className="wh-sub" style={{ marginTop: 12 }}>"Beaten at" sets the streak, the win rate, the tile colours and the marker on each progress bar.</p>
        <div className="lbl" style={{ marginTop: 18 }}>Signature on copied scorecards <span>leave empty for none</span></div>
        <input className="in" value={sig} onChange={e => setSig(e.target.value)} placeholder="Your name or @handle" aria-label="Signature on copied scorecards" />
        <div className="foot">
          {err && <span style={{ color: 'var(--k-bad)', fontSize: 13 }} role="alert">{err}</span>}
          <button className="wh-btn" onClick={submit}>Save settings</button>
        </div>
      </div>
    </div>
  )
}

// ─── Side cards ──────────────────────────────────────────────────────────────
