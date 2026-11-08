import { useEffect, useRef, useState } from 'react'
import {
  DAY_LETTERS, IMPORTANCE, WEEK_ORDER, WINDOWS, daysLabel, daysOf, fromDayMin, parseQuick, pointsOf, scheduleOf, toDayMin, windowLabel,
  useDayDetail, useDeleteRoutine, useNewRoutine, useOneOffs, useRenameRoutine, useRoutine, useSaveRoutine, useToggleRoutine,
  type Parsed, type RoutineItem, type RoutineView,
} from '../../core/routine'
import { partOfDay } from '../../core/today'
import { PageLoader } from '../../components/ui/Spinner'

const SNAP = 15
const DAY_END = 1440 + 240            // 04:00 the next morning
const zone = (s: number | null) => s == null ? '#E6E9EE' : s >= 75 ? 'var(--k-good)' : s >= 45 ? 'var(--k-warn)' : 'var(--k-bad)'
const hitColor = (h: number | null | undefined) => h == null ? 'var(--k-faint)' : h >= 70 ? 'var(--k-good)' : h >= 40 ? 'var(--k-warn)' : 'var(--k-bad)'
const fmtDate = (iso: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', o)
const GROUP_COLOR: Record<string, string> = { Morning: '#5E6B80', Afternoon: '#1F8F86', Tonight: '#5A55C9', Anytime: 'var(--k-mute)' }

const RoutineIcon = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
    <circle cx="8" cy="8" r="6.6" fill="var(--k-blue)" />
    <path d="M5.2 8.2l1.9 1.9 3.8-4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ─── Page ────────────────────────────────────────────────────────────────────

export function ThingsRoutine() {
  const { data, isPending } = useRoutine()
  const [tplId, setTplId] = useState<number | null>(null)
  const tpl = data?.templates.find(t => t.id === tplId) ?? data?.templates[0]

  if (isPending || !data) return <PageLoader />
  if (!tpl) {
    return (
      <div className="th-page th-routine skin-enter">
        <div className="th-grid">
          <div className="th-left"><Hero data={data} /><EmptyRoutine /></div>
          <div className="th-right"><History data={data} /><OneOffs data={data} /></div>
        </div>
      </div>
    )
  }
  return <RoutineBody key={tpl.id} data={data} tpl={tpl} onPick={setTplId} />
}

function RoutineBody({ data, tpl, onPick }: { data: RoutineView; tpl: RoutineView['templates'][number]; onPick: (id: number | null) => void }) {
  const draft = useDraft(tpl)
  return (
    <div className="th-page th-routine skin-enter">
      <div className="th-grid">
        <div className="th-left">
          <Hero data={data} />
          <Editor data={data} tpl={tpl} onPick={onPick} draft={draft} />
        </div>
        <div className="th-right">
          <History data={data} />
          <WhyMissed data={data} />
          <OneOffs data={data} />
          <Timeline draft={draft} />
        </div>
      </div>
    </div>
  )
}

// ─── Hero: how the routine is holding up ─────────────────────────────────────

function Hero({ data }: { data: RoutineView }) {
  const items = data.templates.flatMap(t => t.items).filter(i => i.stats && i.stats.days >= 3)
  const ranked = [...items].sort((a, b) => (b.stats!.hitRate ?? 0) - (a.stats!.hitRate ?? 0))
  const best = ranked[0], worst = ranked[ranked.length - 1]
  const hit = data.overall.hitRate
  const [kick, tone] = hit == null ? ['Not enough history yet', 'mute']
    : hit >= 70 ? ['Holding strong', 'good'] : hit >= 40 ? ['Holding, with gaps', 'warn'] : ['Slipping', 'bad']

  return (
    <section className="th-rhero">
      <div className="th-title"><RoutineIcon /><h1>Routine</h1><span className={`th-kick ${tone}`}>{kick}</span></div>
      <h2>
        {hit == null ? 'Close a few days and your routine starts telling you how it is going.'
          : <><span className="num">{hit}%</span> of your windows landed on time <span className="soft">over the last {data.overall.days} closed day{data.overall.days === 1 ? '' : 's'}.</span></>}
      </h2>
      {best && worst && best !== worst && (
        <p className="th-mutep">
          Strongest: <b>{best.label}</b> (<span className="num">{best.stats!.hitRate}%</span> on time). Weakest: <b>{worst.label}</b> (<span className="num">{worst.stats!.hitRate}%</span>)
          {worst.stats!.topReason ? <>, usually “{worst.stats!.topReason.toLowerCase()}”.</> : '.'}
        </p>
      )}
      <div className="th-strip th-rstats">
        <div className="cell"><div className="k">On time, last 30 days</div><div className="v"><b className="num">{hit ?? '–'}{hit != null && '%'}</b></div></div>
        <div className="cell"><div className="k">Average day score</div><div className="v"><b className="num">{data.overall.avgScore ?? '–'}</b></div></div>
        <div className="cell"><div className="k">Today so far</div><div className="v"><b className="num">{data.todayScore ?? '–'}</b></div></div>
      </div>
    </section>
  )
}

function EmptyRoutine() {
  const create = useNewRoutine()
  return (
    <section className="th-ed">
      <div className="th-sec"><h3>No routine yet</h3></div>
      <p className="th-mutep">A routine is the set of things you mean to do each day, each with a time window. Ticking inside the window earns its points.</p>
      <button className="th-btn" style={{ marginTop: 14 }} onClick={() => create.mutate('Daily routine')}>Create a routine</button>
    </section>
  )
}

// ─── The routine: one plain list, edited in place ────────────────────────────

type Draft = RoutineItem & { key: string }
let seq = 0
const keyed = (i: RoutineItem): Draft => ({ ...i, key: i.id ? `i${i.id}` : `n${++seq}` })
const byTime = (a: RoutineItem, b: RoutineItem) => (toDayMin(a.time) ?? 99999) - (toDayMin(b.time) ?? 99999)
const GROUPS = ['Morning', 'Afternoon', 'Tonight', 'Anytime'] as const

type DraftApi = ReturnType<typeof useDraft>

/** Editing state shared by the list and the timeline; saves itself shortly after each change. */
function useDraft(tpl: RoutineView['templates'][number]) {
  const save = useSaveRoutine()
  const [items, setItems] = useState<Draft[]>(() => tpl.items.map(keyed))
  const [open, setOpen] = useState<string | null>(null)
  const [status, setStatus] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Take fresh server state (new ids after a save) unless an edit is in flight.
  useEffect(() => {
    if (status !== 'saved') return
    setItems(prev => {
      const next = tpl.items.map(i => { const old = prev.find(p => p.id === i.id); return old ? { ...i, key: old.key } : keyed(i) })
      return [...next, ...prev.filter(p => !p.id && !p.label.trim())]   // keep an unnamed new row
    })
  }, [tpl]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: Draft[]) => {
    setItems(next)
    setStatus('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setStatus('saving')
      save.mutate({ id: tpl.id, items: next.filter(i => i.label.trim()).sort(byTime) }, {
        onSuccess: () => setStatus('saved'),
        onError: () => setStatus('error'),
      })
    }, 600)
  }
  const patch = (key: string, p: Partial<Draft>) => commit(items.map(i => (i.key === key ? { ...i, ...p } : i)))
  const remove = (key: string) => { setOpen(null); commit(items.filter(i => i.key !== key)) }
  const add = () => {
    const last = [...items].filter(i => i.label.trim()).sort(byTime).pop()
    const start = last?.time ? Math.min(DAY_END - 60, (toDayMin(last.time) ?? 540) + 60) : 540
    const d = keyed({ label: '', time: fromDayMin(start), windowMin: 60, schedule: null, importance: 'NUI', points: 5, pointsOverride: null })
    setItems([...items, d]); setOpen(d.key)
  }
  /** Adds a fully described item from the one-line box; saved straight away. */
  const addParsed = (p: Parsed) => {
    const last = [...items].filter(i => i.label.trim()).sort(byTime).pop()
    const fallback = last?.time ? Math.min(DAY_END - 60, (toDayMin(last.time) ?? 540) + 60) : 540
    const d = keyed({
      label: p.label, time: p.time ?? fromDayMin(fallback), windowMin: p.windowMin ?? 60,
      schedule: p.schedule === undefined ? null : p.schedule, importance: p.importance ?? 'NUI',
      points: pointsOf(p.importance ?? 'NUI', null), pointsOverride: null,
    })
    commit([...items, d])
  }
  return { items, open, setOpen, status, patch, remove, add, addParsed }
}

function Editor({ data, tpl, onPick, draft }: { data: RoutineView; tpl: RoutineView['templates'][number]; onPick: (id: number | null) => void; draft: DraftApi }) {
  const { items, open, setOpen, status, patch, remove, add, addParsed } = draft
  const sorted = [...items].sort(byTime)
  const total = items.filter(i => i.label.trim()).reduce((s, i) => s + pointsOf(i.importance, i.pointsOverride), 0)

  return (
    <section className="th-ed" aria-label="Your routine">
      <RoutineHeader data={data} tpl={tpl} onPick={onPick} status={status} count={items.filter(i => i.label.trim()).length} total={total} />
      {!tpl.enabled && (
        <div className="th-paused">
          <span>This routine is paused: no items are added to your day and no reminders fire.</span>
          <ResumeButton id={tpl.id} />
        </div>
      )}
      <QuickAdd onAdd={addParsed} placeholder="Add in one line: Read 10 pages 22:30 30m weekdays must" />
      {GROUPS.map(g => {
        const rows = sorted.filter(i => partOfDay(toDayMin(i.time)) === g)
        if (!rows.length) return null
        return (
          <div key={g} className="th-group">
            <div className="th-sec">
              <h3 style={{ color: GROUP_COLOR[g] }}>{g}</h3>
              <span className="meta">{rows.length} item{rows.length === 1 ? '' : 's'}</span>
            </div>
            {rows.map(i => (
              <Row key={i.key} item={i} open={open === i.key} onToggle={() => setOpen(open === i.key ? null : i.key)}
                onChange={p => patch(i.key, p)} onRemove={() => remove(i.key)} />
            ))}
          </div>
        )
      })}
      {items.length === 0 && <p className="th-mutep" style={{ margin: '14px 0 4px' }}>Nothing here yet. Add the first thing you want to do each day.</p>}
      <button className="th-addrow" onClick={add}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        Add an item field by field
      </button>
    </section>
  )
}

function ResumeButton({ id }: { id: number }) {
  const toggle = useToggleRoutine()
  return <button className="th-soft" onClick={() => toggle.mutate({ id, enabled: true })}>Resume</button>
}

function RoutineHeader({ data, tpl, onPick, status, count, total }: {
  data: RoutineView; tpl: RoutineView['templates'][number]; onPick: (id: number | null) => void
  status: 'saved' | 'saving' | 'dirty' | 'error'; count: number; total: number
}) {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(tpl.name)
  const [confirm, setConfirm] = useState(false)
  const rename = useRenameRoutine()
  const toggle = useToggleRoutine()
  const del = useDeleteRoutine()
  const create = useNewRoutine()

  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.th-rmenu, .th-dots')) { setMenu(false); setConfirm(false) } }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(false); setConfirm(false) } }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [menu])

  return (
    <div className="th-rhead">
      <div className="l">
        {renaming ? (
          <form onSubmit={e => { e.preventDefault(); if (name.trim()) rename.mutate({ id: tpl.id, name: name.trim() }); setRenaming(false) }}>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={() => setRenaming(false)} className="th-rename" aria-label="Routine name" />
          </form>
        ) : data.templates.length > 1 ? (
          <div className="th-tpls" role="tablist" aria-label="Routines">
            {data.templates.map(t => (
              <button key={t.id} role="tab" aria-selected={t.id === tpl.id} className={t.id === tpl.id ? 'on' : ''} onClick={() => onPick(t.id)}>
                {t.name}{!t.enabled && <small> · paused</small>}
              </button>
            ))}
          </div>
        ) : (
          <h2>{tpl.name}</h2>
        )}
        <div className="meta"><span className="num">{count}</span> item{count === 1 ? '' : 's'} · up to <span className="num">{total}</span> points a day</div>
      </div>
      <div className="r">
        <span className={`th-saved ${status}`} role="status">
          {status === 'saved' && <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden><path d="M2.2 5.3l1.9 1.9 3.8-4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          {status === 'saved' ? 'Saved' : status === 'error' ? "Couldn't save, try again" : 'Saving…'}
        </span>
        <button className="th-dots" aria-label="Routine options" aria-haspopup="menu" aria-expanded={menu} onClick={() => { setMenu(m => !m); setConfirm(false) }}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><circle cx="3.5" cy="8" r="1.3" fill="currentColor" /><circle cx="8" cy="8" r="1.3" fill="currentColor" /><circle cx="12.5" cy="8" r="1.3" fill="currentColor" /></svg>
        </button>
        {menu && (
          <div className="th-rmenu" role="menu" aria-label="Routine options">
            {!confirm ? (
              <>
                <button role="menuitem" onClick={() => { setMenu(false); setName(tpl.name); setRenaming(true) }}>Rename</button>
                <button role="menuitem" onClick={() => { setMenu(false); toggle.mutate({ id: tpl.id, enabled: !tpl.enabled }) }}>{tpl.enabled ? 'Pause' : 'Resume'}</button>
                <button role="menuitem" onClick={() => { setMenu(false); create.mutate('New routine', { onSuccess: r => onPick(r.id) }) }}>New routine</button>
                <div className="th-menu-sep" role="separator" />
                <button role="menuitem" className="bad" onClick={() => setConfirm(true)}>Delete routine…</button>
              </>
            ) : (
              <div className="confirm">
                <p>Delete “{tpl.name}”? It stops running from today. Past days keep their scores.</p>
                <div>
                  <button className="cancel" onClick={() => { setConfirm(false); setMenu(false) }}>Cancel</button>
                  <button className="del" onClick={() => del.mutate(tpl.id, { onSuccess: () => { setMenu(false); onPick(null) } })}>Delete</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ item, open, onToggle, onChange, onRemove }: {
  item: Draft; open: boolean; onToggle: () => void; onChange: (p: Partial<Draft>) => void; onRemove: () => void
}) {
  const imp = IMPORTANCE.find(o => o.value === (item.importance ?? 'NUI')) ?? IMPORTANCE[1]
  const hit = item.stats?.hitRate
  const days = daysOf(item.schedule)
  const flipDay = (d: number) => {
    const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d]
    if (next.length) onChange({ schedule: scheduleOf(next) })
  }
  return (
    <div className={`th-ri${open ? ' open' : ''}`}>
      <div className="sum" onClick={onToggle} role="button" tabIndex={0} aria-expanded={open}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onToggle() } }}>
        <input className="t num" type="time" value={item.time ?? ''} aria-label={`Time for ${item.label || 'new item'}`}
          onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} onChange={e => onChange({ time: e.target.value || null })} />
        <span className="n">{item.label || <i>New item</i>}</span>
        <span className="m">{windowLabel(item.windowMin)} window · {daysLabel(item.schedule)}</span>
        <button className={`th-tag w-${imp.value}`} title="Click to change how much it matters"
          aria-label={`Weight ${imp.label}, click to change`}
          onClick={e => { e.stopPropagation(); const i = IMPORTANCE.findIndex(o => o.value === imp.value); onChange({ importance: IMPORTANCE[(i + 1) % IMPORTANCE.length].value }) }}
          onKeyDown={e => e.stopPropagation()}>
          {imp.label}
        </button>
        <span className="h num" style={{ color: hitColor(hit) }}>{hit == null ? 'new' : `${hit}% on time`}</span>
      </div>
      {open && (
        <div className="edit">
          <label className="nm"><span>Name</span>
            <input autoFocus={!item.label} value={item.label} placeholder="What do you do?" onChange={e => onChange({ label: e.target.value })} />
          </label>
          <label><span>Starts at</span>
            <input className="num" type="time" value={item.time ?? ''} onChange={e => onChange({ time: e.target.value || null })} />
          </label>
          <label><span>Window</span>
            <select value={item.windowMin} onChange={e => onChange({ windowMin: Number(e.target.value) })}>
              {[...new Set([...WINDOWS, item.windowMin])].sort((a, b) => a - b).map(w => <option key={w} value={w}>{windowLabel(w)}</option>)}
            </select>
          </label>
          <div className="lab"><span>Days</span>
            <div className="days" role="group" aria-label="Days it runs">
              {WEEK_ORDER.map(d => (
                <button key={d} className={days.includes(d) ? 'on' : ''} aria-pressed={days.includes(d)} onClick={() => flipDay(d)}
                  aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]}>{DAY_LETTERS[d]}</button>
              ))}
            </div>
          </div>
          <div className="lab"><span>How much it matters</span>
            <div className="seg" role="radiogroup" aria-label="How much it matters">
              {IMPORTANCE.map(o => (
                <button key={o.value} role="radio" aria-checked={(item.importance ?? 'NUI') === o.value} className={(item.importance ?? 'NUI') === o.value ? 'on' : ''}
                  onClick={() => onChange({ importance: o.value })} title={o.hint}>{o.label} <small className="num">{o.points}</small></button>
              ))}
            </div>
          </div>
          <div className="foot">
            <span>On time inside the {windowLabel(item.windowMin)} window earns <b className="num">{pointsOf(item.importance, item.pointsOverride)}</b>; late earns half.</span>
            <button className="th-btn2" onClick={onRemove}>Remove item</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── History heatmap + day drill-in ──────────────────────────────────────────

function History({ data }: { data: RoutineView }) {
  const [pick, setPick] = useState<string | null>(null)
  const detail = useDayDetail(pick)
  const scores = new Map(data.history.map(h => [h.date, h]))
  // 16 weeks, Monday-first columns, ending this week.
  const end = new Date(data.today + 'T12:00:00')
  const start = new Date(end); start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7 * 15)
  const weeks: string[][] = []
  for (let w = 0; w < 16; w++) {
    const col: string[] = []
    for (let d = 0; d < 7; d++) { const x = new Date(start); x.setDate(start.getDate() + w * 7 + d); col.push(x.toISOString().slice(0, 10)) }
    weeks.push(col)
  }
  const shown = data.history.slice(-28)
  const avg = shown.length ? Math.round(shown.reduce((s, h) => s + h.score, 0) / shown.length) : null

  return (
    <section className="th-card th-hist">
      <div className="top">
        <h2>Day scores</h2>
        <span className="aside">{avg != null ? <>last 4 weeks average <b className="num">{avg}</b></> : 'no closed days yet'}</span>
      </div>
      <div className="th-heat" role="grid" aria-label="Day scores, last 16 weeks">
        <div className="lbls" aria-hidden>{['M', '', 'W', '', 'F', '', 'S'].map((l, i) => <span key={i}>{l}</span>)}</div>
        {weeks.map((col, w) => (
          <div key={w} className="col" role="row">
            {col.map(d => {
              const h = scores.get(d)
              const future = d > data.today
              const isToday = d === data.today
              const s = isToday ? data.todayScore : h?.score ?? null
              return (
                <button key={d} role="gridcell" className={`cell${pick === d ? ' on' : ''}${isToday ? ' today' : ''}`} disabled={future || (s == null && !isToday)}
                  onClick={() => setPick(pick === d ? null : d)}
                  aria-label={`${fmtDate(d)}: ${s == null ? 'no score' : s}${isToday ? ' (so far)' : ''}`}
                  title={`${fmtDate(d)}: ${s == null ? 'no score' : s}${isToday ? ' (so far)' : ''}`}
                  style={{ background: future ? 'transparent' : zone(s), opacity: s == null ? 1 : 0.35 + (s / 100) * 0.65 }} />
              )
            })}
          </div>
        ))}
      </div>
      <div className="th-legend"><i style={{ background: 'var(--k-bad)' }} />under 45<i style={{ background: 'var(--k-warn)' }} />45 to 74<i style={{ background: 'var(--k-good)' }} />75 and up</div>

      {pick && (
        <div className="th-dd">
          <div className="hd">
            <b>{fmtDate(pick, { weekday: 'long', day: 'numeric', month: 'long' })}</b>
            <span className="num">{detail.data?.score ?? '–'}</span>
          </div>
          {detail.data?.reflection && <p className="ref">“{detail.data.reflection}”</p>}
          {detail.data?.autoClosed && <p className="th-mutep">Closed automatically at 04:00, no review.</p>}
          <ul>
            {detail.data?.items.map(i => {
              const tone = i.status === 'on_time' ? 'good' : i.status === 'late' ? 'late' : i.status === 'missed' || i.status === 'overdue' ? 'miss' : ''
              return (
                <li key={i.id}>
                  <span className="t num">{i.time ?? '··'}</span>
                  <span className="l">{i.label}</span>
                  <span className={tone === 'good' ? 'ok' : tone ? `th-pill ${tone}` : 'mute'}>
                    {i.status === 'on_time' ? 'on time' : i.status === 'late' ? 'late' : i.status === 'missed' || i.status === 'overdue' ? (i.reason ? i.reason.toLowerCase() : 'missed') : i.status}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}

// ─── Why things get missed ───────────────────────────────────────────────────

function WhyMissed({ data }: { data: RoutineView }) {
  const items = data.templates.flatMap(t => t.items)
  const reasons: Record<string, number> = {}
  for (const i of items) for (const [r, n] of Object.entries(i.stats?.reasons ?? {})) reasons[r] = (reasons[r] ?? 0) + n
  const rs = Object.entries(reasons).sort((a, b) => b[1] - a[1])
  const total = rs.reduce((s, [, n]) => s + n, 0)
  const most = [...items].filter(i => (i.stats?.missed ?? 0) > 0).sort((a, b) => b.stats!.missed - a.stats!.missed).slice(0, 3)
  if (total === 0) return null   // appears once evening reviews have given reasons

  return (
    <section className="th-card th-why">
      <div className="top"><h2>Why things get missed</h2></div>
      <div className="th-tasks">
        {rs.map(([r, n]) => (
          <div key={r} className="th-task">
            <div className="nm">{r}</div>
            <div className="bar"><i style={{ width: `${(n / total) * 100}%`, background: 'var(--k-bad)' }} /></div>
            <div className="p num">{n}</div>
          </div>
        ))}
      </div>
      {most.length > 0 && (
        <>
          <div className="th-subh">Missed most, last 30 days</div>
          {most.map(i => (
            <div key={i.id} className="th-mrow">
              <span className="k">{i.label}</span>
              <span className="r num" style={{ color: 'var(--k-bad)' }}>{i.stats!.missed} of {i.stats!.days}</span>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

// ─── One-offs for today ──────────────────────────────────────────────────────

function OneOffs({ data }: { data: RoutineView }) {
  const { add, remove } = useOneOffs()
  return (
    <section className="th-card th-one">
      <div className="top"><h2>Just for today</h2><span className="aside">one-offs, scored like the rest</span></div>
      {data.oneOffs.length > 0 && (
        <div className="list">
          {data.oneOffs.map(o => (
            <div key={o.id} className="th-mrow">
              <span className={`th-cb${o.completed ? ' done' : ''}`} aria-hidden>
                {o.completed && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2.2 5.3l1.9 1.9 3.8-4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              <span className="k">{o.label}</span>
              {o.time && <span className="tm num">{o.time}</span>}
              <span className="r">
                {o.completed ? <span className="ok">done</span> : <button className="th-misslink back" onClick={() => remove.mutate(o.id)} aria-label={`Remove ${o.label}`}>Remove</button>}
              </span>
            </div>
          ))}
        </div>
      )}
      <QuickAdd placeholder="Add for today: Call the bank 16:00" onAdd={p => add.mutate({ label: p.label, time: p.time ?? undefined })} />
    </section>
  )
}

// ─── One line in, one item out ───────────────────────────────────────────────

function QuickAdd({ onAdd, placeholder }: { onAdd: (p: Parsed) => void; placeholder: string }) {
  const [text, setText] = useState('')
  const p = text.trim() ? parseQuick(text) : null
  return (
    <form className="th-quick" onSubmit={e => { e.preventDefault(); if (p?.label) { onAdd(p); setText('') } }}>
      <div className="box">
        <svg width="18" height="18" viewBox="0 0 12 12" aria-hidden><path d="M6 2.5v7M2.5 6h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} aria-label="Add an item in one line" />
      </div>
      {p && (
        <div className="prev" aria-live="polite">
          {p.label ? <b>{p.label}</b> : <i>name it</i>}
          {p.bits.map(b => <span key={b}>{b}</span>)}
          <kbd>Enter</kbd>
        </div>
      )}
    </form>
  )
}

// ─── The day, top to bottom ──────────────────────────────────────────────────

/**
 * A vertical timeline. Each item's window is a slim bar in its own lane; its
 * name sits in one column on the right. Names never overlap: a name that would
 * collide is pushed down and joined to its real time with a thin line.
 * Drag a name (or bar) up or down to move the time; drag a bar's end to resize.
 */
function Timeline({ draft }: { draft: DraftApi }) {
  const { items, open, setOpen, patch } = draft
  const [drag, setDrag] = useState<{ key: string; mode: 'move' | 'size'; y0: number; start: number; win: number } | null>(null)
  const [ghost, setGhost] = useState<{ start: number; win: number } | null>(null)

  const S = 0.62                                         // pixels per minute
  const LINE = 22                                        // minimum gap between names
  const AXIS = 44, LANE = 7, GAP = 4
  const shown = items.filter(i => toDayMin(i.time) != null).map(i =>
    drag?.key === i.key && ghost ? { ...i, s: ghost.start, w: ghost.win } : { ...i, s: toDayMin(i.time)!, w: i.windowMin })
  shown.sort((a, b) => a.s - b.s)

  const from = Math.max(240, Math.floor((Math.min(...shown.map(i => i.s), 8 * 60) - 30) / 60) * 60)
  const lastEnd = Math.max(...shown.map(i => i.s + i.w), 22 * 60)
  const to = Math.min(DAY_END, Math.ceil((lastEnd + 15) / 60) * 60)
  const y = (m: number) => (m - from) * S + 10

  // Window lanes.
  const ends: number[] = []
  const lane = new Map<string, number>()
  for (const i of shown) {
    let l = ends.findIndex(e => e <= i.s)
    if (l === -1) { l = ends.length; ends.push(i.s + i.w) } else ends[l] = i.s + i.w
    lane.set(i.key, l)
  }
  const lanes = Math.max(1, ends.length)
  const labelX = AXIS + lanes * (LANE + GAP) + 18

  // Name positions: at their time, pushed down just enough to clear the one above.
  const ly = new Map<string, number>()
  let prev = -Infinity
  for (const i of shown) { const want = y(i.s); const at = Math.max(want, prev + LINE); ly.set(i.key, at); prev = at }
  const height = Math.max(y(to), prev + LINE) + 14

  useEffect(() => {
    if (!drag) return
    const toMin = (dy: number) => Math.round(dy / S / SNAP) * SNAP
    const onMove = (e: PointerEvent) => {
      const d = toMin(e.clientY - drag.y0)
      if (drag.mode === 'move') setGhost({ start: Math.min(DAY_END - SNAP, Math.max(240, drag.start + d)), win: drag.win })
      else setGhost({ start: drag.start, win: Math.min(360, Math.max(SNAP, drag.win + d)) })
    }
    const onUp = () => {
      if (ghost && (ghost.start !== drag.start || ghost.win !== drag.win)) patch(drag.key, { time: fromDayMin(ghost.start), windowMin: ghost.win })
      setDrag(null); setGhost(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [drag, ghost]) // eslint-disable-line react-hooks/exhaustive-deps

  const hours: number[] = []
  for (let h = Math.ceil(from / 60) * 60; h <= to; h += 60) hours.push(h)
  const nowMin = (() => { const d = new Date(); const m = d.getHours() * 60 + d.getMinutes(); return m < 240 ? m + 1440 : m })()
  const start = (i: (typeof shown)[number], mode: 'move' | 'size') => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation(); setOpen(i.key)
    setDrag({ key: i.key, mode, y0: e.clientY, start: i.s, win: i.w })
  }

  return (
    <section className="th-card th-tline">
      <div className="top col">
        <h2>Your day, top to bottom</h2>
        <span className="aside">drag a name to move it · drag a bar's end to resize</span>
      </div>
      {shown.length === 0 ? <p className="th-mutep" style={{ marginTop: 10 }}>Items with a time appear here.</p> : (
        <div className="th-vt" style={{ height }}>
          {hours.map(h => (
            <div key={h} className={`hr${h % 180 === 0 ? ' maj' : ''}`} style={{ top: y(h) }}><span className="num">{fromDayMin(h)}</span></div>
          ))}
          {nowMin >= from && nowMin <= to && <div className="now" style={{ top: y(nowMin) }} aria-hidden />}
          {shown.map(i => {
            const l = lane.get(i.key) ?? 0
            const bx = AXIS + l * (LANE + GAP)
            const by = y(i.s), bh = Math.max(6, i.w * S)
            const nameY = ly.get(i.key)!
            const sel = open === i.key
            const heavy = i.importance === 'UI'
            const hit = i.stats?.hitRate
            return (
              <div key={i.key} className={`it${sel ? ' sel' : ''}${heavy ? ' heavy' : ''}${drag?.key === i.key ? ' drag' : ''}`}>
                <div className="bar" style={{ left: bx, top: by, height: bh, width: LANE }} onPointerDown={start(i, 'move')}
                  title={`${fromDayMin(i.s)} to ${fromDayMin(i.s + i.w)}`}>
                  <span className="end" onPointerDown={start(i, 'size')} />
                </div>
                {/* Leader from the bar's start to the name, bent when the name was pushed down. */}
                <svg className="lead" style={{ left: bx + LANE, top: Math.min(by, nameY) - 1, width: labelX - bx - LANE, height: Math.abs(nameY - by) + 2 }} aria-hidden>
                  <polyline points={`0,${by <= nameY ? 1 : Math.abs(nameY - by) + 1} ${(labelX - bx - LANE) * 0.45},${by <= nameY ? 1 : Math.abs(nameY - by) + 1} ${(labelX - bx - LANE) - 4},${by <= nameY ? Math.abs(nameY - by) + 1 : 1}`} />
                </svg>
                <button className="name" style={{ left: labelX, top: nameY - 10 }} onPointerDown={start(i, 'move')}
                  onClick={() => setOpen(i.key)}
                  onKeyDown={e => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                      e.preventDefault()
                      const d = (e.key === 'ArrowUp' ? -1 : 1) * SNAP
                      if (e.shiftKey) patch(i.key, { windowMin: Math.min(360, Math.max(SNAP, i.w + d)) })
                      else patch(i.key, { time: fromDayMin(Math.min(DAY_END - SNAP, Math.max(240, i.s + d))) })
                    }
                  }}
                  aria-label={`${i.label || 'New item'} at ${fromDayMin(i.s)}, ${i.w} minute window. Up and down arrows move it; with Shift they resize it.`}>
                  <b className="num">{fromDayMin(i.s)}</b>
                  <span>{i.label || 'New item'}</span>
                  {hit != null && <i className="num" style={{ color: zone(hit) }}>{hit}%</i>}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
