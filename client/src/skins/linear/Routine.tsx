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
const zone = (s: number | null) => s == null ? 'rgba(255,255,255,.05)' : s >= 75 ? 'var(--k-good)' : s >= 45 ? 'var(--k-warn)' : 'var(--k-bad)'
const hitColor = (h: number | null | undefined) => h == null ? 'var(--k-t4)' : h >= 70 ? 'var(--k-good)' : h >= 40 ? 'var(--k-warn)' : 'var(--k-bad)'
const fmtDate = (iso: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', o)

type Tpl = RoutineView['templates'][number]

// ─── Page ────────────────────────────────────────────────────────────────────

function Frame({ data, left, right }: { data: RoutineView; left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="ln-today ln-rt skin-enter">
      <header className="ln-top">
        <h1>Routine</h1>
        <div className="crumb num"><i />{fmtDate(data.today, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      </header>
      <div className="ln-body">
        <section className="ln-col"><div className="ln-rtcol">{left}</div></section>
        <aside className="ln-panel" aria-label="Scores and timeline">{right}</aside>
      </div>
    </div>
  )
}

export function LinearRoutine() {
  const { data, isPending } = useRoutine()
  const [tplId, setTplId] = useState<number | null>(null)
  const tpl = data?.templates.find(t => t.id === tplId) ?? data?.templates[0]

  if (isPending || !data) return <PageLoader />
  if (!tpl) {
    return (
      <Frame data={data}
        left={<><Hero data={data} /><EmptyRoutine /></>}
        right={<><History data={data} /><div className="ln-div" /><OneOffs data={data} /></>} />
    )
  }
  return <RoutineBody key={tpl.id} data={data} tpl={tpl} onPick={setTplId} />
}

function RoutineBody({ data, tpl, onPick }: { data: RoutineView; tpl: Tpl; onPick: (id: number | null) => void }) {
  const draft = useDraft(tpl)
  const hasWhy = data.templates.some(t => t.items.some(i => Object.values(i.stats?.reasons ?? {}).some(n => n > 0)))
  return (
    <Frame data={data}
      left={<><Hero data={data} /><Editor data={data} tpl={tpl} onPick={onPick} draft={draft} /></>}
      right={<>
        <History data={data} />
        <div className="ln-div" />
        {hasWhy && <><WhyMissed data={data} /><div className="ln-div" /></>}
        <OneOffs data={data} />
        <div className="ln-div" />
        <Timeline draft={draft} />
      </>} />
  )
}

// ─── Hero: how the routine is holding up ─────────────────────────────────────

function Hero({ data }: { data: RoutineView }) {
  const items = data.templates.flatMap(t => t.items).filter(i => i.stats && i.stats.days >= 3)
  const ranked = [...items].sort((a, b) => (b.stats!.hitRate ?? 0) - (a.stats!.hitRate ?? 0))
  const best = ranked[0], worst = ranked[ranked.length - 1]
  const hit = data.overall.hitRate
  const [kick, color] = hit == null ? ['Not enough history yet', 'var(--k-t3)']
    : hit >= 70 ? ['Holding strong', 'var(--k-good)'] : hit >= 40 ? ['Holding, with gaps', 'var(--k-warn)'] : ['Slipping', 'var(--k-bad)']

  return (
    <section className="ln-rhero">
      <div className="ln-kick" style={{ color }}><i />{kick}</div>
      <h2>
        {hit == null ? 'Close a few days and your routine starts telling you how it is going.'
          : <>{hit}% of your windows landed on time <span>over the last {data.overall.days} closed day{data.overall.days === 1 ? '' : 's'}.</span></>}
      </h2>
      {best && worst && best !== worst && (
        <p>
          Strongest: <b>{best.label}</b> <span className="num">({best.stats!.hitRate}% on time)</span>. Weakest: <b>{worst.label}</b> <span className="num">({worst.stats!.hitRate}%)</span>
          {worst.stats!.topReason ? <>, usually “{worst.stats!.topReason.toLowerCase()}”.</> : '.'}
        </p>
      )}
      <div className="ln-rstats num">
        <div><div className="ln-lbl">On time, last 30 days</div><div className="v">{hit ?? '–'}{hit != null && <small>%</small>}</div></div>
        <div><div className="ln-lbl">Average day score</div><div className="v">{data.overall.avgScore ?? '–'}</div></div>
        <div><div className="ln-lbl">Today so far</div><div className="v">{data.todayScore ?? '–'}</div></div>
      </div>
    </section>
  )
}

function EmptyRoutine() {
  const create = useNewRoutine()
  return (
    <section className="ln-red">
      <div className="ln-ph"><span className="h">No routine yet</span></div>
      <p className="ln-mut" style={{ marginTop: 6 }}>A routine is the set of things you mean to do each day, each with a time window. Ticking inside the window earns its points.</p>
      <button className="ln-btn" style={{ marginTop: 14, paddingRight: 14 }} onClick={() => create.mutate('Daily routine')}>Create a routine</button>
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
function useDraft(tpl: Tpl) {
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

function Editor({ data, tpl, onPick, draft }: { data: RoutineView; tpl: Tpl; onPick: (id: number | null) => void; draft: DraftApi }) {
  const { items, open, setOpen, status, patch, remove, add, addParsed } = draft
  const sorted = [...items].sort(byTime)
  const named = items.filter(i => i.label.trim())
  const total = named.reduce((s, i) => s + pointsOf(i.importance, i.pointsOverride), 0)

  return (
    <section className="ln-red">
      <RoutineHeader data={data} tpl={tpl} onPick={onPick} status={status} count={named.length} total={total} />
      {!tpl.enabled && (
        <div className="ln-stakes warn ln-paused">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><rect x="4" y="3" width="2" height="8" rx=".6" fill="currentColor" /><rect x="8" y="3" width="2" height="8" rx=".6" fill="currentColor" /></svg>
          <span>This routine is paused: no items are added to your day and no reminders fire.</span>
          <ResumeButton id={tpl.id} />
        </div>
      )}
      <QuickAdd onAdd={addParsed} placeholder="Add in one line: Read 10 pages 22:30 30m weekdays must" />
      <div className="ln-rlist num">
        {GROUPS.map(g => {
          const rows = sorted.filter(i => partOfDay(toDayMin(i.time)) === g)
          if (!rows.length) return null
          const pts = rows.filter(i => i.label.trim()).reduce((s, i) => s + pointsOf(i.importance, i.pointsOverride), 0)
          return (
            <div key={g} className="ln-rgrp">
              <div className="ln-gh" role="heading" aria-level={3}>{g}<span className="n">{rows.length}</span><span className="r">{pts} pts</span></div>
              {rows.map(i => (
                <Row key={i.key} item={i} open={open === i.key} onToggle={() => setOpen(open === i.key ? null : i.key)}
                  onChange={p => patch(i.key, p)} onRemove={() => remove(i.key)} />
              ))}
            </div>
          )
        })}
        {items.length === 0 && <p className="ln-mut" style={{ margin: '14px 0 4px' }}>Nothing here yet. Add the first thing you want to do each day.</p>}
        <button className="ln-addrow" onClick={add}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          Add an item field by field
        </button>
      </div>
    </section>
  )
}

function ResumeButton({ id }: { id: number }) {
  const toggle = useToggleRoutine()
  return <button className="ln-chip" onClick={() => toggle.mutate({ id, enabled: true })}>Resume</button>
}

function RoutineHeader({ data, tpl, onPick, status, count, total }: {
  data: RoutineView; tpl: Tpl; onPick: (id: number | null) => void
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
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.ln-rmenu, .ln-dots')) { setMenu(false); setConfirm(false) } }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [menu])

  return (
    <div className="ln-rhead">
      <div className="l">
        {renaming ? (
          <form onSubmit={e => { e.preventDefault(); if (name.trim()) rename.mutate({ id: tpl.id, name: name.trim() }); setRenaming(false) }}>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={() => setRenaming(false)} className="ln-in ln-rename" aria-label="Routine name" />
          </form>
        ) : data.templates.length > 1 ? (
          <div className="ln-seg2" role="tablist" aria-label="Routines">
            {data.templates.map(t => (
              <button key={t.id} role="tab" aria-selected={t.id === tpl.id} className={t.id === tpl.id ? 'on' : ''} onClick={() => onPick(t.id)}>
                {t.name}{!t.enabled && <small> · paused</small>}
              </button>
            ))}
          </div>
        ) : (
          <span className="nm">{tpl.name}</span>
        )}
        <span className="m num">{count} item{count === 1 ? '' : 's'} · up to {total} points a day</span>
      </div>
      <div className="r">
        <span className={`ln-saved ${status}`} role="status">
          <i aria-hidden />
          {status === 'saved' ? 'Saved' : status === 'error' ? "Couldn't save, try again" : 'Saving…'}
        </span>
        <button className="ln-dots" aria-label="Routine options" aria-haspopup="menu" aria-expanded={menu} onClick={() => { setMenu(m => !m); setConfirm(false) }}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><circle cx="3" cy="7" r="1.1" fill="currentColor" /><circle cx="7" cy="7" r="1.1" fill="currentColor" /><circle cx="11" cy="7" r="1.1" fill="currentColor" /></svg>
        </button>
        {menu && (
          <div className="ln-rmenu" role="menu">
            {!confirm ? (
              <>
                <button role="menuitem" onClick={() => { setMenu(false); setName(tpl.name); setRenaming(true) }}>Rename</button>
                <button role="menuitem" onClick={() => { setMenu(false); toggle.mutate({ id: tpl.id, enabled: !tpl.enabled }) }}>{tpl.enabled ? 'Pause' : 'Resume'}</button>
                <button role="menuitem" onClick={() => { setMenu(false); create.mutate('New routine', { onSuccess: r => onPick(r.id) }) }}>New routine</button>
                <div className="ln-menu-sep" />
                <button role="menuitem" className="bad" onClick={() => setConfirm(true)}>Delete routine…</button>
              </>
            ) : (
              <div className="confirm">
                <p>Delete “{tpl.name}”? It stops running from today. Past days keep their scores.</p>
                <div>
                  <button className="ln-chip" onClick={() => { setConfirm(false); setMenu(false) }}>Cancel</button>
                  <button className="ln-chip bad" onClick={() => del.mutate(tpl.id, { onSuccess: () => { setMenu(false); onPick(null) } })}>Delete</button>
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
    <div className={`ln-ri ${open ? 'open' : ''}`}>
      <div className="sum" onClick={onToggle} role="button" tabIndex={0} aria-expanded={open} aria-label={`${item.label || 'New item'}, show details`}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onToggle() } }}>
        <input className="t num" type="time" value={item.time ?? ''} aria-label={`Time for ${item.label || 'new item'}`}
          onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} onChange={e => onChange({ time: e.target.value || null })} />
        <span className="n">{item.label || <i>New item</i>}</span>
        <span className="m">{windowLabel(item.windowMin)} window · {daysLabel(item.schedule)}</span>
        <button className={`ln-tag w ${imp.value === 'UI' ? 'must' : ''}`} title={`${imp.hint}. Click to change how much it matters`}
          aria-label={`Weight ${imp.label}, click to change`}
          onClick={e => { e.stopPropagation(); const i = IMPORTANCE.findIndex(o => o.value === imp.value); onChange({ importance: IMPORTANCE[(i + 1) % IMPORTANCE.length].value }) }}>
          {imp.label}
        </button>
        <span className="h" style={{ color: hitColor(hit) }}>{hit == null ? 'new' : `${hit}% on time`}</span>
      </div>
      {open && (
        <div className="edit">
          <label><span>Name</span>
            <input className="ln-in" autoFocus={!item.label} value={item.label} placeholder="What do you do?" onChange={e => onChange({ label: e.target.value })} />
          </label>
          <label><span>Starts at</span>
            <input className="ln-in num" type="time" value={item.time ?? ''} onChange={e => onChange({ time: e.target.value || null })} />
          </label>
          <label><span>Window</span>
            <select className="ln-in" value={item.windowMin} onChange={e => onChange({ windowMin: Number(e.target.value) })}>
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
            <div className="ln-seg2" role="radiogroup" aria-label="How much it matters">
              {IMPORTANCE.map(o => (
                <button key={o.value} role="radio" aria-checked={(item.importance ?? 'NUI') === o.value} className={(item.importance ?? 'NUI') === o.value ? 'on' : ''}
                  onClick={() => onChange({ importance: o.value })} title={o.hint}>{o.label} <small className="num">{o.points}</small></button>
              ))}
            </div>
          </div>
          <div className="foot">
            <span className="ln-mut">On time inside the {windowLabel(item.windowMin)} window earns <b className="num">{pointsOf(item.importance, item.pointsOverride)}</b>; late earns half.</span>
            <button className="ln-btn2 miss rm" onClick={onRemove}>Remove item</button>
          </div>
        </div>
      )}
    </div>
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
    <section className="ln-sect">
      <div className="ln-ph"><span className="h">Your day, top to bottom</span></div>
      <p className="ln-mut ln-tlsub">Drag a name to move it · drag a bar's end to resize</p>
      {shown.length === 0 ? <p className="ln-mut" style={{ marginTop: 10 }}>Items with a time appear here.</p> : (
        <div className="ln-vt" style={{ height }}>
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
    <section className="ln-sect">
      <div className="ln-ph">
        <span className="h">Day scores</span>
        <span className="m num">{avg != null ? <>Last 4 weeks average <b style={{ color: 'var(--k-t1)', fontWeight: 500 }}>{avg}</b></> : 'No closed days yet'}</span>
      </div>
      <div className="ln-heat" role="grid" aria-label="Day scores, last 16 weeks">
        <div className="lbls" aria-hidden>{['M', '', 'W', '', 'F', '', 'S'].map((l, i) => <span key={i}>{l}</span>)}</div>
        {weeks.map((col, w) => (
          <div key={w} className="col" role="row">
            {col.map(d => {
              const h = scores.get(d)
              const future = d > data.today
              const isToday = d === data.today
              const s = isToday ? data.todayScore : h?.score ?? null
              return (
                <button key={d} role="gridcell" className={`cell ${pick === d ? 'on' : ''} ${isToday ? 'today' : ''}`} disabled={future || (s == null && !isToday)}
                  onClick={() => setPick(pick === d ? null : d)}
                  aria-label={`${fmtDate(d)}: ${s == null ? 'no score' : s}${isToday ? ' (so far)' : ''}`}
                  title={`${fmtDate(d)}: ${s == null ? 'no score' : s}${isToday ? ' (so far)' : ''}`}
                  style={{ background: future ? 'transparent' : zone(s), opacity: s == null ? 1 : 0.35 + (s / 100) * 0.65 }} />
              )
            })}
          </div>
        ))}
      </div>
      <div className="ln-legend"><i style={{ background: 'var(--k-bad)' }} />under 45<i style={{ background: 'var(--k-warn)' }} />45 to 74<i style={{ background: 'var(--k-good)' }} />75 and up</div>

      {pick && (
        <div className="ln-dd">
          <div className="hd">
            <b>{fmtDate(pick, { weekday: 'long', day: 'numeric', month: 'long' })}</b>
            <span className="num">{detail.data?.score ?? '–'}</span>
          </div>
          {detail.data?.reflection && <p className="ref">“{detail.data.reflection}”</p>}
          {detail.data?.autoClosed && <p className="ln-mut" style={{ fontSize: 12, marginTop: 6 }}>Closed automatically at 04:00, no review.</p>}
          <ul className="num">
            {detail.data?.items.map(i => (
              <li key={i.id}>
                <span className="t">{i.time ?? '··'}</span>
                <span className="l">{i.label}</span>
                <span className="s" style={{ color: i.status === 'on_time' ? 'var(--k-good)' : i.status === 'late' ? 'var(--k-warn)' : i.status === 'missed' || i.status === 'overdue' ? 'var(--k-bad)' : 'var(--k-t3)' }}>
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
    <section className="ln-sect">
      <div className="ln-ph"><span className="h">Why things get missed</span><span className="m num">{total} reason{total === 1 ? '' : 's'}</span></div>
      <ul className="ln-tasks num" style={{ marginTop: 8 }}>
        {rs.map(([r, n]) => (
          <li key={r} className="tk">
            <span className="nm">{r}</span>
            <div className="ln-mini"><i style={{ width: `${(n / total) * 100}%`, background: 'var(--k-t2)' }} /></div>
            <span className="v">{n}</span>
          </li>
        ))}
      </ul>
      {most.length > 0 && (
        <>
          <div className="ln-lbl" style={{ marginTop: 12 }}>Missed most, last 30 days</div>
          <ul className="ln-money num" style={{ marginTop: 2 }}>
            {most.map(i => (
              <li key={i.id} className="mr ln-mr">
                <span className="nm">{i.label}</span>
                <span className="v" style={{ color: 'var(--k-bad)' }}>{i.stats!.missed} of {i.stats!.days}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

// ─── One-offs for today ──────────────────────────────────────────────────────

function OneOffs({ data }: { data: RoutineView }) {
  const { add, remove } = useOneOffs()
  return (
    <section className="ln-sect">
      <div className="ln-ph"><span className="h">Just for today</span><span className="m">One-offs, scored like the rest</span></div>
      {data.oneOffs.length > 0 && (
        <ul className="ln-money num" style={{ marginTop: 6 }}>
          {data.oneOffs.map(o => (
            <li key={o.id} className="mr ln-mr">
              <span className="nm">{o.label}{o.time && <span>{o.time}</span>}</span>
              <span className="v">
                {o.completed ? <span className="g">done</span> : <button className="ln-chip" onClick={() => remove.mutate(o.id)} aria-label={`Remove ${o.label}`}>Remove</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <QuickAdd placeholder="Add for today: Call the bank 16:00" label="Add a one-off for today in one line"
        onAdd={p => add.mutate({ label: p.label, time: p.time ?? undefined })} />
    </section>
  )
}

// ─── One line in, one item out ───────────────────────────────────────────────

function QuickAdd({ onAdd, placeholder, label = 'Add an item in one line' }: { onAdd: (p: Parsed) => void; placeholder: string; label?: string }) {
  const [text, setText] = useState('')
  const p = text.trim() ? parseQuick(text) : null
  return (
    <form className="ln-quick" onSubmit={e => { e.preventDefault(); if (p?.label) { onAdd(p); setText('') } }}>
      <div className="box">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        <input className="num" value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} aria-label={label} />
        {p && <span className="ln-kbd" aria-hidden>↵</span>}
      </div>
      {p && (
        <div className="prev num" aria-live="polite">
          {p.label ? <b>{p.label}</b> : <i>name it</i>}
          {p.bits.map(b => <span key={b} className="ln-tag">{b}</span>)}
          <span className="hint">Enter to add</span>
        </div>
      )}
    </form>
  )
}
