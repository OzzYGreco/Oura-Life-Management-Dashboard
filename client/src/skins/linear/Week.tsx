import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  SOURCES, fmtRange, pts, usePlanNextWeek, useSaveWeek, useScoreTask, useTaskSource, useWeek, useWeekGoal,
  type Source, type WeekTask, type WeekView,
} from '../../core/week'
import { PageLoader } from '../../components/ui/Spinner'
import { copyScorecard, type ScorecardTheme } from '../../core/scorecardImage'

const longDay = (iso: string, o: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', o)

// ─── Page ────────────────────────────────────────────────────────────────────

export function LinearWeek() {
  const { data, isPending } = useWeek()
  const [editing, setEditing] = useState(false)
  const [pick, setPick] = useState<number | null>(null)
  if (isPending || !data) return <PageLoader />
  const cur = data.current
  const selected = pick ?? cur?.id ?? data.history[data.history.length - 1]?.id ?? null

  return (
    <div className="ln-today ln-wkp skin-enter">
      <header className="ln-top">
        <h1>Week</h1>
        <div className="crumb num"><i />Goal crushers{cur && <><span style={{ color: 'var(--k-t4)' }}>·</span>{fmtRange(cur.from, cur.to)}</>}</div>
      </header>
      <div className="ln-body">
        <section className="ln-col">
          <div className="ln-wkcol">
            <Record data={data} selected={selected} onPick={id => { setPick(id); setEditing(false) }} />
            {selected != null && <Scorecard data={data} id={selected} onEdit={() => setEditing(true)} />}
          </div>
        </section>
        <aside className="ln-panel" aria-label="Next week and trends">
          <NextWeek data={data} />
          <Slipping data={data} />
          <Honesty data={data} />
        </aside>
      </div>
      {editing && cur && <Composer data={data} mode="current" onClose={() => setEditing(false)} />}
    </div>
  )
}

// ─── Your record: the numbers across the top and a tile per week ─────────────

/** A week counts as beaten at 7 points or more, the threshold the owner has always used. */
const BEATEN_AT = 7

function Record({ data, selected, onPick }: { data: WeekView; selected: number | null; onPick: (id: number) => void }) {
  const done = data.history.filter(h => !h.current)
  const beat = (h: WeekView['history'][number]) => h.score >= BEATEN_AT
  let streak = 0
  for (let i = done.length - 1; i >= 0 && beat(done[i]); i--) streak++
  const won = done.filter(beat).length
  const best = done.reduce((m, h) => Math.max(m, h.score), 0)
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => { if (strip.current) strip.current.scrollLeft = strip.current.scrollWidth }, [data.history.length])

  return (
    <section className="ln-record">
      <div className="ln-rstats num">
        <div><div className="ln-lbl">Streak</div><div className="v">{streak}</div><div className="s">weeks beaten in a row</div></div>
        <div><div className="ln-lbl">Win rate</div><div className="v" style={{ color: 'var(--k-good)' }}>{done.length ? Math.round((won / done.length) * 100) : 0}<small>%</small></div><div className="s">weeks at {BEATEN_AT}+ points</div></div>
        <div><div className="ln-lbl">Beaten</div><div className="v">{won}<small>/{done.length}</small></div><div className="s">weeks</div></div>
        <div><div className="ln-lbl">Best</div><div className="v">{pts(best)}</div><div className="s">points</div></div>
      </div>
      <div ref={strip} className="tiles num" role="listbox" aria-label="Weeks" aria-orientation="horizontal">
        {data.history.map((h, i) => (
          <button key={h.id} role="option" aria-selected={selected === h.id} onClick={() => onPick(h.id)}
            className={`tile ${h.current ? 'cur' : beat(h) ? 'won' : 'lost'} ${selected === h.id ? 'on' : ''}`}
            aria-label={`Week ${i + 1}, ${fmtRange(h.from, h.to)}, ${pts(h.score)} of ${pts(h.max)}${h.current ? ', this week' : ''}`}
            title={`Week ${i + 1} · ${fmtRange(h.from, h.to)} · ${pts(h.score)} of ${pts(h.max)}${h.reward ? ` · ${h.reward}` : ''}`}>
            <span className="sc">{pts(h.score)}</span>
            <span className="wk">W{i + 1}</span>
          </button>
        ))}
        {data.next && (
          <button role="option" aria-selected={selected === data.next.id} onClick={() => onPick(data.next!.id)}
            className={`tile nxt ${selected === data.next.id ? 'on' : ''}`} aria-label={`Next week, ${fmtRange(data.next.from, data.next.to)}`}
            title={`Next week · ${fmtRange(data.next.from, data.next.to)} · starts ${longDay(data.next.from, { weekday: 'long' })}`}>
            <span className="sc">Next</span>
            <span className="wk">W{data.history.length + 1}</span>
          </button>
        )}
      </div>
    </section>
  )
}

// ─── The scorecard: one week, made to be shared ──────────────────────────────

const THEME: ScorecardTheme = {
  bg: '#08090A', card: '#121316', line: 'rgba(255,255,255,.08)', ink: '#EDEEF0', ink2: '#B4B6BC', mute: '#7E8189',
  good: '#4CB782', warn: '#D7A246', bad: '#E0585C', track: '#1C1D21', chip: 'rgba(76,183,130,.13)',
  font: 'Inter, system-ui, sans-serif', display: 'Inter, system-ui, sans-serif',
}

function Scorecard({ data, id, onEdit }: { data: WeekView; id: number; onEdit: () => void }) {
  const isCurrent = data.current?.id === id
  const isNext = data.next?.id === id
  const past = useWeekGoal(isCurrent ? null : id)
  const [copied, setCopied] = useState<string | null>(null)
  const weekNo = isNext ? data.history.length + 1 : data.history.findIndex(h => h.id === id) + 1
  const goal = isCurrent ? data.current! : past.data
  if (!goal) return <section className="ln-sc"><PageLoader /></section>

  // Current week: auto tasks show their live score; hand tasks their typed one.
  const rows = goal.tasks.map(t => {
    const live = isCurrent ? data.current!.live.tasks.find(x => x.id === t.id) : undefined
    const auto = t.source !== 'manual'
    return { ...t, auto, score: auto ? (live?.earned ?? t.earnedPoints) : t.earnedPoints, note: live?.note ?? null }
  })
  const total = rows.reduce((s, r) => s + (r.score ?? 0), 0)
  const max = rows.reduce((s, r) => s + r.maxPoints, 0)
  const pct = max ? total / max : 0
  const color = pct >= 0.7 ? 'var(--k-good)' : pct >= 0.4 ? 'var(--k-warn)' : 'var(--k-bad)'
  const rewards = [...goal.rewards].sort((a, b) => a.minScore - b.minScore)
  const reached = [...rewards].reverse().find(r => total >= r.minScore)
  const next = rewards.find(r => total < r.minScore)

  const copy = async () => {
    const how = await copyScorecard({
      weekNo, from: goal.from, to: goal.to, focus: goal.focus,
      tasks: rows.map(r => ({ title: r.title, max: r.maxPoints, score: r.score })),
      rewards,
    }, THEME)
    setCopied(how === 'copied' ? 'Copied. Paste it wherever you report.' : 'Saved as an image in Downloads.')
    setTimeout(() => setCopied(null), 3500)
  }

  return (
    <section className="ln-sc">
      <div className="top">
        <div className="l">
          <div className="ln-lbl">Goal crushers · Week {weekNo}{isCurrent ? ' · this week' : isNext ? ` · starts ${longDay(goal.from, { weekday: 'long', day: 'numeric', month: 'short' })}` : ''}</div>
          <h2>{goal.focus || 'This week'}</h2>
          <div className="ln-mut num">{fmtRange(goal.from, goal.to)}</div>
        </div>
        <div className="tot num">
          <div className="fig"><span className="ln-big" style={{ color }}>{pts(total)}</span><span className="of">/ {pts(max)}</span></div>
          {reached ? <span className="earned">Earned: {reached.reward}</span>
            : next ? <span className="togo">{pts(next.minScore - total)} more for {next.reward}</span> : null}
        </div>
      </div>

      <div className="prog" aria-hidden>
        <b style={{ width: `${Math.min(100, pct * 100)}%`, background: color }} />
        {rewards.map(r => <i key={r.minScore} style={{ left: `${Math.min(100, max ? (r.minScore / max) * 100 : 0)}%` }} />)}
      </div>

      <div className="tbl num" role="table" aria-label="Tasks and scores">
        <div className="tr th" role="row"><span role="columnheader">Task</span><span role="columnheader">Max</span><span role="columnheader">Score</span></div>
        {rows.map(r => <ScoreRow key={r.id} row={r} editable={isCurrent} />)}
        <div className="tr total" role="row"><span role="cell">Total</span><span role="cell">{pts(max)} pts</span><span role="cell" style={{ color }}>{pts(total)}</span></div>
      </div>

      {rewards.length > 0 && (
        <div className="chips num">
          {rewards.map(r => <span key={r.minScore} className={total >= r.minScore ? 'got' : ''}><b>{pts(r.minScore)}+</b>{r.reward}</span>)}
        </div>
      )}

      <div className="acts">
        <button className="ln-btn2" onClick={copy} aria-label="Copy the scorecard as an image">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="5" y="5" width="9" height="9" rx="2" /><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" /></svg>
          <span style={{ paddingRight: 2 }}>Copy as image</span>
        </button>
        {isCurrent && <button className="ln-btn2" onClick={onEdit}><span style={{ padding: '0 2px' }}>Edit week</span></button>}
        {isNext && <ChangeNext data={data} />}
        {isNext && <span className="ln-mut">Scoring opens when the week starts.</span>}
        {copied && <span className="ln-mut g" role="status">{copied}</span>}
      </div>
    </section>
  )
}

function ScoreRow({ row, editable }: { row: { id?: number; title: string; maxPoints: number; score: number | null; auto: boolean; source: Source; note: string | null }; editable: boolean }) {
  const score = useScoreTask()
  const setSource = useTaskSource()
  const full = row.score != null && row.score >= row.maxPoints
  const src = SOURCES.find(s => s.value === row.source)
  return (
    <div className="tr" role="row">
      <span className="t" role="cell">
        <span className="nm">{row.title}</span>
        {row.auto && editable && (
          <small><span className="ln-tag acc">auto</span>{src?.label.toLowerCase()}{row.note ? ` · ${row.note}` : ''}
            <button className="sw" onClick={() => row.id && setSource.mutate({ id: row.id, source: 'manual' })} aria-label={`Score ${row.title} by hand`}>Score by hand</button></small>
        )}
      </span>
      <span className="m" role="cell">{pts(row.maxPoints)} pts</span>
      {editable && !row.auto ? (
        <span role="cell"><SegScore value={row.score} max={row.maxPoints} busy={score.isPending} title={row.title}
          onSet={v => row.id && score.mutate({ id: row.id, earnedPoints: v })} /></span>
      ) : (
        <b className="v" role="cell" style={{ color: row.score == null ? 'var(--k-t4)' : full ? 'var(--k-good)' : row.score === 0 ? 'var(--k-bad)' : 'var(--k-t1)' }}>{row.score == null ? '–' : pts(row.score)}</b>
      )}
    </div>
  )
}

/** Click where the score is: each segment is a quarter point. One click per task. */
function SegScore({ value, max, onSet, busy, title }: { value: number | null; max: number; onSet: (v: number) => void; busy: boolean; title: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const n = Math.max(1, Math.round(max / 0.25))
  const shown = hover ?? value ?? 0
  const full = value != null && value >= max
  return (
    <span className="ln-segsc" role="group" aria-label={`Score ${title}`} onMouseLeave={() => setHover(null)}>
      <button className={`zero ${value === 0 ? 'on' : ''}`} disabled={busy} onClick={() => onSet(0)} aria-label={`Score ${title} 0`}>0</button>
      <span className="bar">
        {Array.from({ length: n }, (_, i) => {
          const v = (i + 1) * 0.25
          return (
            <button key={i} disabled={busy} onMouseEnter={() => setHover(v)} onFocus={() => setHover(v)} onBlur={() => setHover(null)} onClick={() => onSet(v)}
              className={v <= shown ? 'fill' : ''} aria-label={`Score ${title} ${pts(v)}`} aria-pressed={value === v} title={pts(v)}
              style={{ background: v <= shown ? (hover != null ? 'var(--k-acc2)' : full ? 'var(--k-good)' : 'var(--k-t2)') : undefined }} />
          )
        })}
      </span>
      <b style={{ color: hover != null ? 'var(--k-acc2)' : value == null ? 'var(--k-t4)' : full ? 'var(--k-good)' : 'var(--k-t1)' }}>
        {hover != null ? pts(hover) : value == null ? '–' : pts(value)}
      </b>
    </span>
  )
}

// ─── Next week: one composer, nothing assumed ────────────────────────────────

function NextWeek({ data }: { data: WeekView }) {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('plan') === '1')
  if (!data.nextStart) return null
  const start = longDay(data.nextStart)
  return (
    <section className="ln-sect ln-nextwk">
      <div className="ln-ph">
        <span className="h">{data.next ? 'Next week is set' : 'Plan next week'}</span>
        {data.next && <span className="m num">{pts(data.next.tasks.reduce((s, t) => s + t.maxPoints, 0))} points</span>}
      </div>
      <p className="ln-mut num" style={{ marginTop: 6 }}>
        {data.next
          ? <>{data.next.focus || 'No focus'} · {data.next.tasks.length} task{data.next.tasks.length === 1 ? '' : 's'}. Starts {start}.</>
          : <>Starts {start}. Pick this week's goals from your recent ones or type new ones.</>}
      </p>
      {data.next
        ? <button className="ln-chip" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>Change</button>
        : <button className="ln-btn" style={{ marginTop: 14, paddingRight: 14 }} onClick={() => setOpen(true)}>Plan next week</button>}
      {open && <Composer data={data} mode="next" onClose={() => setOpen(false)} />}
    </section>
  )
}

function ChangeNext({ data }: { data: WeekView }) {
  const [open, setOpen] = useState(false)
  return <>
    <button className="ln-btn2" onClick={() => setOpen(true)}><span style={{ padding: '0 2px' }}>Change next week</span></button>
    {open && <Composer data={data} mode="next" onClose={() => setOpen(false)} />}
  </>
}

type Draft = Omit<WeekTask, 'earnedPoints'> & { key: string }
let dseq = 0
const dk = () => `d${++dseq}`

function Composer({ data, mode, onClose }: { data: WeekView; mode: 'next' | 'current'; onClose: () => void }) {
  const plan = usePlanNextWeek()
  const saveCur = useSaveWeek()
  const base = mode === 'current' ? data.current : data.next
  const [focus, setFocus] = useState(base?.focus ?? '')
  const [tasks, setTasks] = useState<Draft[]>(() => (base?.tasks ?? []).map(t => ({ id: t.id, title: t.title, maxPoints: t.maxPoints, source: t.source, target: t.target, key: dk() })))
  const [rewards, setRewards] = useState(() => (base?.rewards.length ? base.rewards : data.current?.rewards ?? []).map(r => ({ minScore: r.minScore, reward: r.reward })))
  const [editRewards, setEditRewards] = useState(false)
  const [typed, setTyped] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const has = (title: string) => tasks.some(t => t.title.trim().toLowerCase() === title.trim().toLowerCase())
  const toggle = (sg: WeekView['suggestions']['tasks'][number]) => has(sg.title)
    ? setTasks(tasks.filter(t => t.title.trim().toLowerCase() !== sg.title.trim().toLowerCase()))
    : setTasks([...tasks, { title: sg.title, maxPoints: sg.maxPoints, source: sg.source, target: sg.target, key: dk() }])
  const addTyped = () => {
    const t = typed.trim()
    if (!t || has(t)) { setTyped(''); return }
    setTasks([...tasks, { title: t, maxPoints: 1, source: 'manual', target: null, key: dk() }]); setTyped('')
  }
  const total = tasks.reduce((s, t) => s + t.maxPoints, 0)
  const usual = (mode === 'current' ? data.history.filter(h => !h.current).slice(-1)[0]?.max : data.current?.tasks.reduce((s, t) => s + t.maxPoints, 0)) ?? 10
  const start = data.nextStart ? longDay(data.nextStart) : ''
  const busy = plan.isPending || saveCur.isPending

  const submit = () => {
    setErr(null)
    const onError = (e: any) => setErr(e?.response?.data?.error ?? 'Could not save the week.')
    if (mode === 'current' && data.current) {
      // Keeps each task's id, so scores already entered stay.
      saveCur.mutate({ id: data.current.id, focus, tasks: tasks.map(({ key: _k, ...t }) => ({ ...t, earnedPoints: null })), rewards }, { onSuccess: onClose, onError })
    } else {
      plan.mutate({ focus, tasks: tasks.map(({ key: _k, ...t }) => t), rewards }, { onSuccess: onClose, onError })
    }
  }

  return createPortal(
    <div className="ln ln-sheet-bg" onMouseDown={onClose}>
      <div className="ln-sheet skin-fade" role="dialog" aria-modal="true" aria-label={mode === 'current' ? 'Edit this week' : 'Plan next week'} onMouseDown={e => e.stopPropagation()}>
        <div className="hd">
          <div>
            <div className="ttl">{mode === 'current' ? 'Edit this week' : 'Plan next week'}</div>
            <div className="ln-mut num">{mode === 'current' && data.current ? `${fmtRange(data.current.from, data.current.to)} · scores you've entered stay` : `Starts ${start}`}</div>
          </div>
          <button className="ln-dots" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="m3.5 3.5 7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="bd">
          <div className="lbl">Focus</div>
          <input className="ln-in wide" value={focus} onChange={e => setFocus(e.target.value)} placeholder="What's this week about?" aria-label="Focus" />
          {data.suggestions.focuses.length > 0 && (
            <div className="chips">
              {data.suggestions.focuses.map(f => (
                <button key={f} className={focus === f ? 'on' : ''} aria-pressed={focus === f} onClick={() => setFocus(f)}>{f}</button>
              ))}
            </div>
          )}

          <div className="lbl">Goals <span>tap to add, tap again to remove</span></div>
          {data.suggestions.tasks.length > 0 && (
            <div className="chips">
              {data.suggestions.tasks.map(sg => (
                <button key={sg.title} className={has(sg.title) ? 'on' : ''} onClick={() => toggle(sg)} aria-pressed={has(sg.title)}
                  aria-label={`${sg.title}, used ${sg.weeks} weeks`}>
                  {has(sg.title)
                    ? <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden><path d="m3.5 7.2 2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    : <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden><path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>}
                  {sg.title}<small className="num">{sg.weeks}w</small>
                </button>
              ))}
            </div>
          )}
          <form className="type" onSubmit={e => { e.preventDefault(); addTyped() }}>
            <input className="ln-in wide" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Or type a new goal and press Enter" aria-label="New goal" />
          </form>

          {tasks.length > 0 && (
            <div className="picked num">
              {tasks.map(t => (
                <div key={t.key} className="p">
                  <span className="t" title={t.title}>{t.title}</span>
                  <select className="ln-in" value={t.source} onChange={e => setTasks(tasks.map(x => x.key === t.key ? { ...x, source: e.target.value as Source, target: e.target.value === 'workouts' ? (x.target ?? 4) : null } : x))} aria-label={`How ${t.title} is scored`}>
                    {SOURCES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <span className="pts">
                    <button onClick={() => setTasks(tasks.map(x => x.key === t.key ? { ...x, maxPoints: Math.max(0.5, x.maxPoints - 0.5) } : x))} aria-label={`Fewer points for ${t.title}`} disabled={t.maxPoints <= 0.5}>−</button>
                    <b>{pts(t.maxPoints)}</b>
                    <button onClick={() => setTasks(tasks.map(x => x.key === t.key ? { ...x, maxPoints: x.maxPoints + 0.5 } : x))} aria-label={`More points for ${t.title}`}>+</button>
                  </span>
                  <button className="x" onClick={() => setTasks(tasks.filter(x => x.key !== t.key))} aria-label={`Remove ${t.title}`}>
                    <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden><path d="m3.5 3.5 7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                  </button>
                </div>
              ))}
              <div className="sum">
                <span className="ln-lbl">Total</span>
                <b style={{ color: total === usual ? 'var(--k-good)' : 'var(--k-warn)' }}>{pts(total)} points</b>
                <span className="ln-mut">{total === usual ? `same as ${mode === 'current' ? 'last' : 'this'} week` : `${mode === 'current' ? 'last' : 'this'} week was ${pts(usual)}`}</span>
              </div>
            </div>
          )}

          <div className="lbl">Rewards {!editRewards && <button className="ln-link lnk" onClick={() => setEditRewards(true)}>change</button>}</div>
          {!editRewards ? (
            <div className="chips static num">
              {rewards.length ? rewards.map(r => <span key={r.minScore + r.reward}><b>{pts(r.minScore)}+</b>{r.reward}</span>) : <span>No rewards yet</span>}
            </div>
          ) : (
            <div className="rew">
              {rewards.map((r, i) => (
                <div key={i} className="r">
                  <input className="ln-in num" type="number" step={0.25} value={r.minScore} onChange={e => setRewards(rewards.map((x, j) => j === i ? { ...x, minScore: Number(e.target.value) } : x))} aria-label="Score needed" />
                  <input className="ln-in" value={r.reward} onChange={e => setRewards(rewards.map((x, j) => j === i ? { ...x, reward: e.target.value } : x))} aria-label="Reward" />
                  <button className="x" onClick={() => setRewards(rewards.filter((_, j) => j !== i))} aria-label="Remove reward">
                    <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden><path d="m3.5 3.5 7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                  </button>
                </div>
              ))}
              <button className="ln-link lnk" onClick={() => setRewards([...rewards, { minScore: (rewards[rewards.length - 1]?.minScore ?? 6) + 1, reward: '' }])}>+ reward</button>
            </div>
          )}
        </div>

        <div className="foot">
          {err && <span className="r_" role="alert" style={{ fontSize: 12.5 }}>{err}</span>}
          <button className="ln-btn" style={{ paddingRight: 14 }} disabled={!tasks.length || busy} onClick={submit}>{mode === 'current' ? 'Save this week' : base ? 'Save next week' : 'Set next week'}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Right panel: what keeps slipping, and honesty ───────────────────────────

/** The hand score for "daily tasks" next to what the routine data said the same week. */
function Honesty({ data }: { data: WeekView }) {
  const both = data.history.filter(h => h.dailyPct != null && h.dayAvg != null)
  if (both.length < 3) return null
  const hand = Math.round(both.reduce((s, h) => s + h.dailyPct!, 0) / both.length)
  const real = Math.round(both.reduce((s, h) => s + h.dayAvg!, 0) / both.length)
  if (hand - real < 15) return null
  return (
    <>
      <div className="ln-div" />
      <section className="ln-sect">
        <div className="ln-ph"><span className="h">Hand score vs your data</span></div>
        <p className="ln-mut num" style={{ marginTop: 6, color: 'var(--k-t2)' }}>Over {both.length} weeks you scored your daily tasks <b style={{ color: 'var(--k-t1)', fontWeight: 500 }}>{hand}%</b> by hand. Your routine averaged <b style={{ color: 'var(--k-t1)', fontWeight: 500 }}>{real}</b> those same weeks.</p>
        <div className="ln-stakes warn">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M7 1.8 12.6 11.6H1.4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M7 5.6v2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><circle cx="7" cy="10" r=".75" fill="currentColor" /></svg>
          <span>{data.current?.tasks.some(t => t.source === 'checklist')
            ? 'From this week it scores itself from your routine, so it tells the same story as your days.'
            : 'A task that scores itself from your routine can\'t drift like that. Set it to “From your routine” in Edit week.'}</span>
        </div>
      </section>
    </>
  )
}

function Slipping({ data }: { data: WeekView }) {
  const slip = data.trends.filter(t => t.avg < 90).slice(0, 4)
  if (!slip.length) return null
  return (
    <>
      <div className="ln-div" />
      <section className="ln-sect">
        <div className="ln-ph"><span className="h">Keeps slipping</span><span className="m">last 12 finished weeks</span></div>
        <ul className="ln-tasks num" style={{ marginTop: 10 }}>
          {slip.map(t => (
            <li key={t.title} className="tk">
              <span className="nm" title={t.title}>{t.title}<span>{t.weeks} weeks</span></span>
              <div className="ln-mini"><i style={{ width: `${t.avg}%`, background: t.avg >= 70 ? 'var(--k-warn)' : 'var(--k-bad)' }} /></div>
              <span className="v" style={{ color: t.avg >= 70 ? 'var(--k-warn)' : 'var(--k-bad)' }}>{t.avg}%</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
