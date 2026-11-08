import { useEffect, useRef, useState } from 'react'
import {
  SOURCES, fmtRange, pts, usePlanNextWeek, useSaveWeek, useScoreTask, useTaskSource, useWeek, useWeekGoal,
  type Source, type WeekGoal, type WeekTask, type WeekView,
} from '../../core/week'
import { PageLoader } from '../../components/ui/Spinner'
import { copyScorecard, type ScorecardTheme } from '../../core/scorecardImage'

export function RevolutWeek() {
  const { data, isPending } = useWeek()
  const [editing, setEditing] = useState(false)
  const [pick, setPick] = useState<number | null>(null)
  if (isPending || !data) return <PageLoader />
  const cur = data.current
  const selected = pick ?? cur?.id ?? data.history[data.history.length - 1]?.id ?? null

  return (
    <div className="rv rv-page rv-week-page skin-enter">
      <Record data={data} selected={selected} onPick={id => { setPick(id); setEditing(false) }} />
      <div className="rv-grid" style={{ marginTop: 16 }}>
        <div className="rv-left">
          {selected != null && <Scorecard data={data} id={selected} onEdit={() => setEditing(true)} />}
          {editing && cur && <Composer data={data} mode="current" onClose={() => setEditing(false)} />}
        </div>
        <div className="rv-right">
          <NextWeek data={data} />
          <Slipping data={data} />
          <Honesty data={data} />
        </div>
      </div>
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
  // Land on the latest weeks, and stay there while fonts and the layout settle.
  useEffect(() => {
    const el = strip.current
    if (!el) return
    const end = () => { el.scrollLeft = el.scrollWidth }
    end()
    const ro = new ResizeObserver(end)
    ro.observe(el)
    return () => ro.disconnect()
  }, [data.history.length, data.next?.id])

  return (
    <section className="rv-card rv-record">
      <div className="stats">
        <div><span>Streak</span><b className="num">{streak}</b><small>weeks beaten in a row</small></div>
        <div><span>Win rate</span><b className="num" style={{ color: 'var(--k-good)' }}>{done.length ? Math.round((won / done.length) * 100) : 0}%</b><small>weeks at {BEATEN_AT}+ points</small></div>
        <div><span>Beaten</span><b className="num">{won}<i>/{done.length}</i></b><small>weeks</small></div>
        <div><span>Best</span><b className="num">{pts(best)}</b><small>points</small></div>
      </div>
      <div ref={strip} className="tiles" role="listbox" aria-label="Weeks">
        {data.history.map((h, i) => (
          <button key={h.id} role="option" aria-selected={selected === h.id} onClick={() => onPick(h.id)}
            className={`tile ${h.current ? 'cur' : beat(h) ? 'won' : 'lost'} ${selected === h.id ? 'on' : ''}`}
            title={`Week ${i + 1} · ${fmtRange(h.from, h.to)} · ${pts(h.score)} of ${pts(h.max)}${h.reward ? ` · ${h.reward}` : ''}`}
            aria-label={`Week ${i + 1}, ${pts(h.score)} of ${pts(h.max)} points${h.current ? ', this week' : beat(h) ? ', beaten' : ''}`}>
            <span className="sc num">{pts(h.score)}</span>
            <span className="wk num">W{i + 1}</span>
          </button>
        ))}
        {data.next && (
          <button role="option" aria-selected={selected === data.next.id} onClick={() => onPick(data.next!.id)}
            className={`tile nxt ${selected === data.next.id ? 'on' : ''}`} aria-label={`Next week, week ${data.history.length + 1}`} title={`Next week · ${fmtRange(data.next.from, data.next.to)} · starts ${new Date(data.next.from + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' })}`}>
            <span className="sc">Next</span>
            <span className="wk num">W{data.history.length + 1}</span>
          </button>
        )}
      </div>
    </section>
  )
}

// ─── The scorecard: one week, made to be shared ──────────────────────────────

const THEME: ScorecardTheme = {
  bg: '#000000', card: '#0E0E10', line: 'rgba(255,255,255,.07)', ink: '#F5F5F7', ink2: '#C9C9CF', mute: '#8D8D94',
  good: '#3AD67F', warn: '#FFAE3D', bad: '#FF5B4F', track: 'rgba(255,255,255,.08)', chip: 'rgba(58,214,127,.12)',
  font: 'Inter, system-ui, sans-serif', display: 'Manrope, Inter, sans-serif',
}

function Scorecard({ data, id, onEdit }: { data: WeekView; id: number; onEdit: () => void }) {
  const isCurrent = data.current?.id === id
  const isNext = data.next?.id === id
  const past = useWeekGoal(isCurrent ? null : id)
  const [copied, setCopied] = useState<string | null>(null)
  const weekNo = isNext ? data.history.length + 1 : data.history.findIndex(h => h.id === id) + 1
  const goal = isCurrent ? data.current! : past.data
  if (!goal) return <section className="rv-card rv-sc"><PageLoader /></section>

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
    <section className="rv-card rv-sc">
      <div className="top">
        <div>
          <div className="eyebrow">Goal crushers · Week {weekNo}{isCurrent ? ' · this week' : isNext ? ` · starts ${new Date(goal.from + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}` : ''}</div>
          <h2>{goal.focus || 'This week'}</h2>
          <div className="rv-sub">{fmtRange(goal.from, goal.to)}</div>
        </div>
        <div className="tot">
          <div className="n num"><b style={{ color }}>{pts(total)}</b><span> / {pts(max)}</span></div>
          {reached ? <div className="earned">Earned: {reached.reward}</div>
            : next ? <div className="rv-sub">{pts(next.minScore - total)} more for {next.reward}</div> : null}
        </div>
      </div>

      <div className="prog" aria-hidden>
        <b style={{ width: `${Math.min(100, pct * 100)}%`, background: color }} />
        {rewards.map(r => <i key={r.minScore} style={{ left: `${Math.min(100, max ? (r.minScore / max) * 100 : 0)}%` }} />)}
      </div>

      <div className="tbl" role="table" aria-label="Tasks and scores">
        <div className="tr th" role="row"><span>Task</span><span>Max</span><span>Score</span></div>
        {rows.map(r => <ScoreRow key={r.id} row={r} editable={isCurrent} />)}
        <div className="tr total" role="row"><span>Total</span><span className="num">{pts(max)} pts</span><span className="num" style={{ color }}>{pts(total)}</span></div>
      </div>

      <div className="chips">
        {rewards.map(r => <span key={r.minScore} className={total >= r.minScore ? 'got' : ''}><b className="num">{pts(r.minScore)}+</b> {r.reward}</span>)}
      </div>

      <div className="acts">
        <button className="rv-chip" onClick={copy}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="5" y="5" width="9" height="9" rx="2" /><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" /></svg>
          Copy as image
        </button>
        {isCurrent && <button className="rv-sbtn" onClick={onEdit}>Edit week</button>}
        {isNext && <ChangeNext data={data} />}
        {isNext && <span className="rv-sub">Scoring opens when the week starts.</span>}
        {copied && <span className="rv-sub" role="status">{copied}</span>}
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
      <span className="t">
        {row.title}
        {row.auto && editable && (
          <small><b className="auto">auto</b> {src?.label.toLowerCase()}{row.note ? ` · ${row.note}` : ''}
            <button className="sw" onClick={() => row.id && setSource.mutate({ id: row.id, source: 'manual' })}>Score by hand</button></small>
        )}
      </span>
      <span className="num m">{pts(row.maxPoints)} pts</span>
      {editable && !row.auto ? (
        <SegScore value={row.score} max={row.maxPoints} busy={score.isPending} title={row.title}
          onSet={v => row.id && score.mutate({ id: row.id, earnedPoints: v })} />
      ) : (
        <b className="num v" style={{ color: row.score == null ? 'var(--k-t3)' : full ? 'var(--k-good)' : row.score === 0 ? 'var(--k-bad)' : 'var(--k-t1)' }}>{row.score == null ? '–' : pts(row.score)}</b>
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
    <span className="seg" role="group" aria-label={`Score ${title}`} onMouseLeave={() => setHover(null)}>
      <button className={`zero ${value === 0 ? 'on' : ''}`} disabled={busy} onClick={() => onSet(0)} aria-label="Score 0">0</button>
      <span className="bar">
        {Array.from({ length: n }, (_, i) => {
          const v = (i + 1) * 0.25
          return (
            <button key={i} disabled={busy} onMouseEnter={() => setHover(v)} onFocus={() => setHover(v)} onClick={() => onSet(v)}
              className={v <= shown ? 'fill' : ''} aria-label={`Score ${pts(v)}`} title={pts(v)}
              style={{ background: v <= shown ? (hover != null ? 'color-mix(in srgb, var(--k-blue) 75%, transparent)' : full ? 'var(--k-good)' : 'var(--k-t2)') : undefined }} />
          )
        })}
      </span>
      <b className="num" style={{ color: hover != null ? 'var(--k-t1)' : value == null ? 'var(--k-t3)' : full ? 'var(--k-good)' : 'var(--k-t1)' }}>
        {hover != null ? pts(hover) : value == null ? '–' : pts(value)}
      </b>
    </span>
  )
}

// ─── Next week: one composer, nothing assumed ────────────────────────────────

function NextWeek({ data }: { data: WeekView }) {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('plan') === '1')
  if (!data.nextStart) return null
  const start = new Date(data.nextStart + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <section className="rv-card rv-next">
      <div>
        <div className="rv-label">{data.next ? 'Next week is set' : 'Plan next week'}</div>
        <p className="rv-sub" style={{ marginTop: 4 }}>
          {data.next
            ? <>{data.next.focus || 'No focus'} · {data.next.tasks.length} tasks · {pts(data.next.tasks.reduce((s, t) => s + t.maxPoints, 0))} points. Starts {start}.</>
            : <>Starts {start}. Pick this week's goals from your recent ones or type new ones.</>}
        </p>
      </div>
      <button className={data.next ? 'rv-sbtn' : 'rv-chip'} onClick={() => setOpen(true)}>{data.next ? 'Change' : 'Plan next week'}</button>
      {open && <Composer data={data} mode="next" onClose={() => setOpen(false)} />}
    </section>
  )
}

function ChangeNext({ data }: { data: WeekView }) {
  const [open, setOpen] = useState(false)
  return <>
    <button className="rv-sbtn" onClick={() => setOpen(true)}>Change next week</button>
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
  const start = data.nextStart ? new Date(data.nextStart + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : ''

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

  return (
    <div className="rv-sheet-bg" onMouseDown={onClose}>
      <div className="rv rv-sheet" role="dialog" aria-modal="true" aria-label={mode === 'current' ? 'Edit this week' : 'Plan next week'} onMouseDown={e => e.stopPropagation()}>
        <div className="hd">
          <div>
            <div className="rv-label" style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--k-display)', letterSpacing: '-.02em' }}>{mode === 'current' ? 'This week' : 'Next week'}</div>
            <div className="rv-sub">{mode === 'current' && data.current ? `${fmtRange(data.current.from, data.current.to)} · scores you've entered stay` : `Starts ${start}`}</div>
          </div>
          <button className="rv-sbtn" onClick={onClose}>Close</button>
        </div>

        <div className="lbl">Focus</div>
        <input className="in" value={focus} onChange={e => setFocus(e.target.value)} placeholder="What's this week about?" aria-label="Focus" />
        {data.suggestions.focuses.length > 0 && (
          <div className="chips">
            {data.suggestions.focuses.map(f => (
              <button key={f} className={focus === f ? 'on' : ''} onClick={() => setFocus(f)}>{f}</button>
            ))}
          </div>
        )}

        <div className="lbl">Goals <span>tap to add, tap again to remove</span></div>
        <div className="chips">
          {data.suggestions.tasks.map(sg => (
            <button key={sg.title} className={has(sg.title) ? 'on' : ''} onClick={() => toggle(sg)} aria-pressed={has(sg.title)}>
              {has(sg.title) ? '✓ ' : '+ '}{sg.title}<small>{sg.weeks}w</small>
            </button>
          ))}
        </div>
        <form className="type" onSubmit={e => { e.preventDefault(); addTyped() }}>
          <input className="in" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Or type a new goal and press Enter" aria-label="New goal" />
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
                  <button onClick={() => setTasks(tasks.map(x => x.key === t.key ? { ...x, maxPoints: Math.max(0.5, x.maxPoints - 0.5) } : x))} aria-label="Fewer points">−</button>
                  <b className="num">{pts(t.maxPoints)}</b>
                  <button onClick={() => setTasks(tasks.map(x => x.key === t.key ? { ...x, maxPoints: x.maxPoints + 0.5 } : x))} aria-label="More points">+</button>
                </span>
                <button className="x" onClick={() => setTasks(tasks.filter(x => x.key !== t.key))} aria-label={`Remove ${t.title}`}>×</button>
              </div>
            ))}
            <div className="sum">
              <span>Total</span>
              <b className="num" style={{ color: total === usual ? 'var(--k-good)' : 'var(--k-warn)' }}>{pts(total)} points</b>
              <span className="rv-sub">{total === usual ? `same as ${mode === 'current' ? 'last' : 'this'} week` : `${mode === 'current' ? 'last' : 'this'} week was ${pts(usual)}`}</span>
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
          {err && <span style={{ color: 'var(--k-bad)', fontSize: 13 }}>{err}</span>}
          <button className="rv-chip" disabled={!tasks.length || plan.isPending || saveCur.isPending} onClick={submit}>{mode === 'current' ? 'Save this week' : base ? 'Save next week' : 'Set next week'}</button>
        </div>
      </div>
    </div>
  )
}

/** The hand score for "daily tasks" next to what the routine data said the same week. */
function Honesty({ data }: { data: WeekView }) {
  const both = data.history.filter(h => h.dailyPct != null && h.dayAvg != null)
  if (both.length < 3) return null
  const hand = Math.round(both.reduce((s, h) => s + h.dailyPct!, 0) / both.length)
  const real = Math.round(both.reduce((s, h) => s + h.dayAvg!, 0) / both.length)
  if (hand - real < 15) return null
  return (
    <section className="rv-card rv-stakes">
      <div className="t">Hand score vs your data</div>
      <p>Over {both.length} weeks you scored your daily tasks <b>{hand}%</b> by hand. Your routine averaged <b>{real}</b> those same weeks.</p>
      <div className="lever">{data.current?.tasks.some(t => t.source === 'checklist')
        ? 'From this week it scores itself from your routine, so it tells the same story as your days.'
        : 'A task that scores itself from your routine can\'t drift like that. Set it to “From your routine” in Edit week.'}</div>
    </section>
  )
}

function Slipping({ data }: { data: WeekView }) {
  const slip = data.trends.filter(t => t.avg < 90).slice(0, 4)
  if (!slip.length) return null
  return (
    <section className="rv-card rv-slip">
      <div className="rv-label">Keeps slipping</div>
      <div className="rv-sub" style={{ marginTop: 2 }}>average of the last 12 finished weeks</div>
      {slip.map(t => (
        <div key={t.title} className="rv-tk">
          <div className="nm">{t.title}<small>{t.weeks} weeks</small></div>
          <div className="rv-bar"><b style={{ width: `${t.avg}%`, background: t.avg >= 70 ? 'var(--k-warn)' : 'var(--k-bad)' }} /></div>
          <div className="v num">{t.avg}%</div>
        </div>
      ))}
    </section>
  )
}
