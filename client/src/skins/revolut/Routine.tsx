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
const zone = (s: number | null) => s == null ? '#1a1a1e' : s >= 75 ? 'var(--k-good)' : s >= 45 ? 'var(--k-warn)' : 'var(--k-bad)'
const fmtDate = (iso: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', o)

// ─── Page ────────────────────────────────────────────────────────────────────

export function RevolutRoutine() {
  const { data, isPending } = useRoutine()
  const [tplId, setTplId] = useState<number | null>(null)
  const tpl = data?.templates.find(t => t.id === tplId) ?? data?.templates[0]

  if (isPending || !data) return <PageLoader />
  if (!tpl) {
    return (
      <div className="rv rv-page rv-routine skin-enter">
        <div className="rv-grid"><div className="rv-left"><Hero data={data} /><EmptyRoutine /></div>
          <div className="rv-right"><History data={data} /><OneOffs data={data} /></div></div>
      </div>
    )
  }
  return <RoutineBody key={tpl.id} data={data} tpl={tpl} onPick={setTplId} />
}

function RoutineBody({ data, tpl, onPick }: { data: RoutineView; tpl: RoutineView['templates'][number]; onPick: (id: number | null) => void }) {
  const draft = useDraft(tpl)
  return (
    <div className="rv rv-page rv-routine skin-enter">
      <div className="rv-grid">
        <div className="rv-left">
          <Hero data={data} />
          <Editor data={data} tpl={tpl} onPick={onPick} draft={draft} />
        </div>
        <div className="rv-right">
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
  const [kick, color] = hit == null ? ['Not enough history yet', 'var(--k-t2)']
    : hit >= 70 ? ['Holding strong', 'var(--k-good)'] : hit >= 40 ? ['Holding, with gaps', 'var(--k-warn)'] : ['Slipping', 'var(--k-bad)']

  const tone = (v: number | null, good: number, warn: number) => v == null ? 'var(--k-t3)' : v >= good ? 'var(--k-good)' : v >= warn ? 'var(--k-warn)' : 'var(--k-bad)'

  return (
    <section className="rv-rhero">
      <div className="rv-hhead">
        <div className="rv-label">Routine</div>
        <span className="rv-kick" style={{ color }}><i />{kick}</span>
      </div>
      {hit == null ? (
        <h1 className="rv-verdict">Close a few days and your routine starts telling you how it is going.</h1>
      ) : (
        <div className="rv-srow">
          <div className="rv-big num" style={{ color }}>{hit}<small>%</small></div>
          <h1 className="rv-verdict">of your windows landed on time<span>over the last {data.overall.days} closed day{data.overall.days === 1 ? '' : 's'}.</span></h1>
        </div>
      )}
      {best && worst && best !== worst && (
        <p className="rv-coach">
          Strongest: <b>{best.label}</b> ({best.stats!.hitRate}% on time). Weakest: <b>{worst.label}</b> ({worst.stats!.hitRate}%)
          {worst.stats!.topReason ? <>, usually “{worst.stats!.topReason.toLowerCase()}”.</> : '.'}
        </p>
      )}
      <div className="rv-ghosts">
        <div className="rv-card rv-g"><div className="k">On time, last 30 days</div><div className="v num" style={{ color: tone(hit, 70, 40) }}>{hit ?? '–'}{hit != null && <small>%</small>}</div></div>
        <div className="rv-card rv-g"><div className="k">Average day score</div><div className="v num" style={{ color: tone(data.overall.avgScore, 75, 45) }}>{data.overall.avgScore ?? '–'}</div></div>
        <div className="rv-card rv-g"><div className="k">Today so far</div><div className="v num" style={{ color: tone(data.todayScore, 75, 45) }}>{data.todayScore ?? '–'}</div></div>
      </div>
    </section>
  )
}

function EmptyRoutine() {
  const create = useNewRoutine()
  return (
    <section className="rv-card rv-ed">
      <div className="rv-label">No routine yet</div>
      <p className="rv-sub" style={{ marginTop: 6 }}>A routine is the set of things you mean to do each day, each with a time window. Ticking inside the window earns its points.</p>
      <button className="rv-chip" style={{ marginTop: 14 }} onClick={() => create.mutate('Daily routine')}>Create a routine</button>
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
    <section className="rv-card rv-ed">
      <RoutineHeader data={data} tpl={tpl} onPick={onPick} status={status} count={items.filter(i => i.label.trim()).length} total={total} />
      {!tpl.enabled && (
        <div className="rv-paused">This routine is paused: no items are added to your day and no reminders fire. <ResumeButton id={tpl.id} /></div>
      )}
      <QuickAdd onAdd={addParsed} placeholder="Add in one line: Read 10 pages 22:30 30m weekdays must" />
      {GROUPS.map(g => {
        const rows = sorted.filter(i => partOfDay(toDayMin(i.time)) === g)
        if (!rows.length) return null
        return (
          <div key={g} className="rv-grp">
            <div className="rv-grph">{g}</div>
            {rows.map(i => (
              <Row key={i.key} item={i} open={open === i.key} onToggle={() => setOpen(open === i.key ? null : i.key)}
                onChange={p => patch(i.key, p)} onRemove={() => remove(i.key)} />
            ))}
          </div>
        )
      })}
      {items.length === 0 && <p className="rv-sub" style={{ margin: '14px 0 4px' }}>Nothing here yet. Add the first thing you want to do each day.</p>}
      <button className="rv-addrow" onClick={add}>+ Add an item field by field</button>
    </section>
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
    <section className="rv-card rv-tline">
      <div className="hd">
        <div className="rv-label">Your day, top to bottom</div>
        <div className="rv-sub">drag a name to move it · drag a bar's end to resize</div>
      </div>
      {shown.length === 0 ? <p className="rv-sub" style={{ marginTop: 10 }}>Items with a time appear here.</p> : (
        <div className="rv-vt" style={{ height }}>
          {hours.map(h => (
            <div key={h} className={`hr ${h % 180 === 0 ? 'maj' : ''}`} style={{ top: y(h) }}><span className="num">{fromDayMin(h)}</span></div>
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
              <div key={i.key} className={`it ${sel ? 'sel' : ''} ${heavy ? 'heavy' : ''} ${drag?.key === i.key ? 'drag' : ''}`}>
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

function ResumeButton({ id }: { id: number }) {
  const toggle = useToggleRoutine()
  return <button className="rv-chip" onClick={() => toggle.mutate({ id, enabled: true })}>Resume</button>
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
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.rv-rmenu, .rv-dots')) { setMenu(false); setConfirm(false) } }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [menu])

  return (
    <div className="rv-rhead">
      <div className="l">
        {renaming ? (
          <form onSubmit={e => { e.preventDefault(); if (name.trim()) rename.mutate({ id: tpl.id, name: name.trim() }); setRenaming(false) }}>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={() => setRenaming(false)} className="rv-rename" aria-label="Routine name" />
          </form>
        ) : data.templates.length > 1 ? (
          <div className="rv-tpls" role="tablist" aria-label="Routines">
            {data.templates.map(t => (
              <button key={t.id} role="tab" aria-selected={t.id === tpl.id} className={t.id === tpl.id ? 'on' : ''} onClick={() => onPick(t.id)}>
                {t.name}{!t.enabled && <small> · paused</small>}
              </button>
            ))}
          </div>
        ) : (
          <div className="rv-label rv-tname">{tpl.name}</div>
        )}
        <div className="rv-sub">{count} item{count === 1 ? '' : 's'} · up to {total} points a day</div>
      </div>
      <div className="r">
        <span className={`rv-saved ${status}`} role="status"><i aria-hidden />
          {status === 'saved' ? 'Saved' : status === 'error' ? "Couldn't save, try again" : 'Saving…'}
        </span>
        <button className="rv-dots" aria-label="Routine options" aria-haspopup="menu" aria-expanded={menu} onClick={() => { setMenu(m => !m); setConfirm(false) }}>⋯</button>
        {menu && (
          <div className="rv-rmenu" role="menu">
            {!confirm ? (
              <>
                <button role="menuitem" onClick={() => { setMenu(false); setName(tpl.name); setRenaming(true) }}>Rename</button>
                <button role="menuitem" onClick={() => { setMenu(false); toggle.mutate({ id: tpl.id, enabled: !tpl.enabled }) }}>{tpl.enabled ? 'Pause' : 'Resume'}</button>
                <button role="menuitem" onClick={() => { setMenu(false); create.mutate('New routine', { onSuccess: r => onPick(r.id) }) }}>New routine</button>
                <hr />
                <button role="menuitem" className="bad" onClick={() => setConfirm(true)}>Delete routine…</button>
              </>
            ) : (
              <div className="confirm">
                <p>Delete “{tpl.name}”? It stops running from today. Past days keep their scores.</p>
                <div>
                  <button onClick={() => { setConfirm(false); setMenu(false) }}>Cancel</button>
                  <button className="bad" onClick={() => del.mutate(tpl.id, { onSuccess: () => { setMenu(false); onPick(null) } })}>Delete</button>
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
    <div className={`rv-ri ${open ? 'open' : ''}`}>
      <div className="sum" onClick={onToggle} role="button" tabIndex={0} aria-expanded={open}
        aria-label={`${item.label || 'New item'}, ${open ? 'collapse' : 'edit'}`}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onToggle() } }}>
        <input className="t num" type="time" value={item.time ?? ''} aria-label={`Time for ${item.label || 'new item'}`}
          onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} onChange={e => onChange({ time: e.target.value || null })} />
        <span className="n">{item.label || <i>New item</i>}</span>
        <span className="m">{windowLabel(item.windowMin)} window · {daysLabel(item.schedule)}</span>
        <button className={`w ${imp.value === 'UI' ? 'must' : ''}`} title="Click to change how much it matters"
          aria-label={`Weight ${imp.label}, click to change`}
          onClick={e => { e.stopPropagation(); const i = IMPORTANCE.findIndex(o => o.value === imp.value); onChange({ importance: IMPORTANCE[(i + 1) % IMPORTANCE.length].value }) }}
          onKeyDown={e => e.stopPropagation()}>
          {imp.label}
        </button>
        <span className="h num" style={{ color: hit == null ? 'var(--k-t3)' : hit >= 70 ? 'var(--k-good)' : hit >= 40 ? 'var(--k-warn)' : 'var(--k-bad)' }}>
          {hit == null ? 'new' : `${hit}% on time`}
        </span>
      </div>
      {open && (
        <div className="edit">
          <label><span>Name</span>
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
                <button key={o.value} role="radio" aria-checked={item.importance === o.value} className={(item.importance ?? 'NUI') === o.value ? 'on' : ''}
                  onClick={() => onChange({ importance: o.value })} title={o.hint}>{o.label} <small className="num">{o.points}</small></button>
              ))}
            </div>
          </div>
          <div className="foot">
            <span className="rv-sub">On time inside the {windowLabel(item.windowMin)} window earns {pointsOf(item.importance, item.pointsOverride)}; late earns half.</span>
            <button className="rm" onClick={onRemove} aria-label={`Remove ${item.label || 'new item'}`}>Remove item</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── One line in, one item out ───────────────────────────────────────────────

function QuickAdd({ onAdd, placeholder }: { onAdd: (p: Parsed) => void; placeholder: string }) {
  const [text, setText] = useState('')
  const p = text.trim() ? parseQuick(text) : null
  return (
    <form className="rv-quick" onSubmit={e => { e.preventDefault(); if (p?.label) { onAdd(p); setText('') } }}>
      <input value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} aria-label="Add an item in one line" />
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
    <section className="rv-card rv-hist">
      <div className="hd">
        <div className="rv-label">Day scores</div>
        <div className="rv-sub">{avg != null ? <>last 4 weeks average <span className="num" style={{ color: 'var(--k-t2)' }}>{avg}</span></> : 'no closed days yet'}</div>
      </div>
      <div className="rv-heat" role="grid" aria-label="Day scores, last 16 weeks">
        <div className="lbls">{['M', '', 'W', '', 'F', '', 'S'].map((l, i) => <span key={i}>{l}</span>)}</div>
        {weeks.map((col, w) => (
          <div key={w} className="col">
            {col.map(d => {
              const h = scores.get(d)
              const future = d > data.today
              const isToday = d === data.today
              const s = isToday ? data.todayScore : h?.score ?? null
              return (
                <button key={d} className={`cell ${pick === d ? 'on' : ''}`} disabled={future || (s == null && !isToday)}
                  onClick={() => setPick(pick === d ? null : d)}
                  title={`${fmtDate(d)}: ${s == null ? 'no score' : s}${isToday ? ' (so far)' : ''}`}
                  style={{ background: future ? 'transparent' : s == null ? '#1a1a1e' : zone(s), opacity: s == null ? 1 : 0.35 + (s / 100) * 0.65, outline: isToday ? '1px solid var(--k-t2)' : undefined }} />
              )
            })}
          </div>
        ))}
      </div>
      <div className="rv-legend rv-sub"><i style={{ background: 'var(--k-bad)' }} />under 45<i style={{ background: 'var(--k-warn)' }} />45 to 74<i style={{ background: 'var(--k-good)' }} />75 and up</div>

      {pick && (
        <div className="rv-dd">
          <div className="hd">
            <b>{fmtDate(pick, { weekday: 'long', day: 'numeric', month: 'long' })}</b>
            <span className="num">{detail.data?.score ?? '–'}</span>
          </div>
          {detail.data?.reflection && <p className="ref">“{detail.data.reflection}”</p>}
          {detail.data?.autoClosed && <p className="rv-sub">Closed automatically at 04:00, no review.</p>}
          <ul>
            {detail.data?.items.map(i => (
              <li key={i.id}>
                <span className="num">{i.time ?? '··'}</span>
                <span className="l">{i.label}</span>
                <span style={{ color: i.status === 'on_time' ? 'var(--k-good)' : i.status === 'late' ? 'var(--k-warn)' : i.status === 'missed' || i.status === 'overdue' ? 'var(--k-bad)' : 'var(--k-t2)' }}>
                  {i.status === 'on_time' ? 'on time' : i.status === 'late' ? 'late' : i.status === 'missed' || i.status === 'overdue' ? (i.reason ? i.reason.toLowerCase() : 'missed') : i.status}
                </span>
              </li>
            ))}
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
    <section className="rv-card rv-why">
      <div className="rv-label">Why things get missed</div>
      {total === 0
        ? <p className="rv-sub" style={{ marginTop: 6 }}>Reasons come from the evening review. Close a few days with a reason for each miss and the pattern shows up here.</p>
        : rs.map(([r, n]) => (
          <div key={r} className="rv-tk">
            <div className="nm">{r}</div>
            <div className="rv-bar"><b style={{ width: `${(n / total) * 100}%`, background: 'var(--k-t1)' }} /></div>
            <div className="v num">{n}</div>
          </div>
        ))}
      {most.length > 0 && (
        <>
          <div className="rv-sub" style={{ marginTop: 14 }}>Missed most, last 30 days</div>
          {most.map(i => (
            <div key={i.id} className="rv-mrow">
              <div className="k">{i.label}</div>
              <div className="r num" style={{ color: 'var(--k-bad)' }}>{i.stats!.missed} of {i.stats!.days}</div>
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
    <section className="rv-card rv-one">
      <div className="hd"><div className="rv-label">Just for today</div><div className="rv-sub">one-offs, scored like the rest</div></div>
      {data.oneOffs.map(o => (
        <div key={o.id} className="rv-mrow">
          <div className="k">{o.label}{o.time && <span className="num">{o.time}</span>}</div>
          <div className="r">
            {o.completed ? <span style={{ color: 'var(--k-good)' }}>done</span> : <button className="rv-chip" onClick={() => remove.mutate(o.id)} aria-label={`Remove ${o.label}`}>Remove</button>}
          </div>
        </div>
      ))}
      <QuickAdd placeholder="Add for today: Call the bank 16:00" onAdd={p => add.mutate({ label: p.label, time: p.time ?? undefined })} />
    </section>
  )
}
