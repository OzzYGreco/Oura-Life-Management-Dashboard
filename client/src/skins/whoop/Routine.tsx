import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DAY_LETTERS, IMPORTANCE, LEADS, WEEK_ORDER, WINDOWS, daysLabel, daysOf, fromDayMin, onceDate, parseMany, pointsOf, routineToday, scheduleOf, toDayMin, windowLabel,
  useDayDetail, useDeleteRoutine, useNewRoutine, useOneOffs, useRenameRoutine, useReminderSettings, useRoutine, useSaveReminderSettings, useSaveRoutine,
  useNotifierStatus, useSetRoutineType, useTestNotification, useToggleRoutine, type NotifierStatus,
  type Parsed, type RoutineItem, type RoutineView,
} from '../../core/routine'
import { partOfDay, useWeeklyTick } from '../../core/today'
import { PageLoader } from '../../components/ui/Spinner'
import './routine-today.css'

const SNAP = 15
const DAY_END = 1440 + 240            // 04:00 the next morning
const zone = (s: number | null) => s == null ? 'rgb(var(--k-fg) / .06)' : s >= 75 ? 'var(--k-good)' : s >= 45 ? 'var(--k-warn)' : 'var(--k-bad)'
const fmtDate = (iso: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', o)

// ─── Page ────────────────────────────────────────────────────────────────────

export function WhoopRoutine() {
  const { data, isPending } = useRoutine()
  const [tplId, setTplId] = useState<number | null>(null)
  const tpl = data?.templates.find(t => t.id === tplId) ?? data?.templates[0]

  if (isPending || !data) return <PageLoader />
  if (!tpl) {
    return (
      <div className="wh-page wh-routine skin-enter">
        <div className="wh-grid"><div className="wh-left"><Hero data={data} /><EmptyRoutine /></div>
          <div className="wh-right"><History data={data} /><OneOffs data={data} /><Reminders /></div></div>
      </div>
    )
  }
  return <RoutineBody key={tpl.id} data={data} tpl={tpl} onPick={setTplId} />
}

function RoutineBody({ data, tpl, onPick }: { data: RoutineView; tpl: RoutineView['templates'][number]; onPick: (id: number | null) => void }) {
  const draft = useDraft(tpl)
  const weekly = tpl.type === 'weekly'
  return (
    <div className="wh-page wh-routine skin-enter">
      <div className="wh-grid">
        <div className="wh-left">
          <Hero data={data} />
          <Editor data={data} tpl={tpl} onPick={onPick} draft={draft} />
        </div>
        <div className="wh-right">
          <History data={data} />
          <WhyMissed data={data} />
          <OneOffs data={data} />
          <Reminders />
          {!weekly && <Timeline draft={draft} />}
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
  const [kick, color] = hit == null ? ['Not enough history yet', 'var(--k-mute)']
    : hit >= 70 ? ['Holding strong', 'var(--k-good)'] : hit >= 40 ? ['Holding, with gaps', 'var(--k-warn)'] : ['Slipping', 'var(--k-bad)']

  return (
    <section className="wh-rhero">
      <div className="wh-kick" style={{ color }}><i />{kick}</div>
      <h1>
        {hit == null ? 'Close a few days and your routine starts telling you how it is going.'
          : <>{hit}% of your windows landed on time<br /><span>over the last {data.overall.days} closed day{data.overall.days === 1 ? '' : 's'}.</span></>}
      </h1>
      {best && worst && best !== worst && (
        <p>
          Strongest: <b>{best.label}</b> ({best.stats!.hitRate}% on time). Weakest: <b>{worst.label}</b> ({worst.stats!.hitRate}%)
          {worst.stats!.topReason ? <>, usually “{worst.stats!.topReason.toLowerCase()}”.</> : '.'}
        </p>
      )}
      <div className="wh-ghosts">
        <div className="wh-g"><div className="k">On time, last 30 days</div><div className="v num">{hit ?? '–'}{hit != null && <small>%</small>}</div></div>
        <div className="wh-g"><div className="k">Average day score</div><div className="v num">{data.overall.avgScore ?? '–'}</div></div>
        <div className="wh-g"><div className="k">Today so far</div><div className="v num">{data.todayScore ?? '–'}</div></div>
      </div>
    </section>
  )
}

export function EmptyRoutine() {
  const create = useNewRoutine()
  return (
    <section className="wh-card wh-ed">
      <div className="wh-h">No routine yet</div>
      <p className="wh-sub" style={{ marginTop: 6 }}>A routine is the set of things you mean to do each day, each with a time window. Ticking inside the window earns its points.</p>
      <button className="wh-btn" style={{ marginTop: 14 }} onClick={() => create.mutate('Daily routine')}>Create a routine</button>
    </section>
  )
}

// ─── The routine: one plain list, edited in place ────────────────────────────

export type Draft = RoutineItem & { key: string }
let seq = 0
const keyed = (i: RoutineItem): Draft => ({ ...i, key: i.id ? `i${i.id}` : `n${++seq}` })
const byTime = (a: RoutineItem, b: RoutineItem) => (toDayMin(a.time) ?? 99999) - (toDayMin(b.time) ?? 99999)
const GROUPS = ['Morning', 'Afternoon', 'Tonight', 'Anytime'] as const

export type DraftApi = ReturnType<typeof useDraft>

/** Editing state shared by the list and the timeline; saves itself shortly after each change. */
export function useDraft(tpl: RoutineView['templates'][number]) {
  const weekly = tpl.type === 'weekly'
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
    const d = keyed({ label: '', time: weekly ? null : fromDayMin(start), windowMin: 60, schedule: null, importance: 'NUI', points: 5, pointsOverride: null })
    setItems([...items, d]); setOpen(d.key)
  }
  /**
   * Adds fully described items from the quick-add box (one line, or a pasted
   * list); saved straight away. An item with no time follows the one before it.
   * Weekly routines have no times or days.
   */
  const addParsed = (ps: Parsed[]) => {
    const next = [...items]
    for (const p of ps) {
      const last = [...next].filter(i => i.label.trim() && i.time).sort(byTime).pop()
      const fallback = last?.time ? Math.min(DAY_END - 60, (toDayMin(last.time) ?? 540) + 60) : 540
      next.push(keyed({
        label: p.label, time: weekly ? null : p.time ?? fromDayMin(fallback), windowMin: p.windowMin ?? 60,
        schedule: weekly || p.schedule === undefined ? null : p.schedule, importance: p.importance ?? 'NUI',
        points: pointsOf(p.importance ?? 'NUI', null), pointsOverride: null,
      }))
    }
    commit(next)
  }
  return { items, open, setOpen, status, patch, remove, add, addParsed, weekly }
}

function Editor({ data, tpl, onPick, draft }: { data: RoutineView; tpl: RoutineView['templates'][number]; onPick: (id: number | null) => void; draft: DraftApi }) {
  const { items, open, setOpen, status, patch, remove, add, addParsed, weekly } = draft
  const sorted = [...items].sort(byTime)
  const total = items.filter(i => i.label.trim()).reduce((s, i) => s + pointsOf(i.importance, i.pointsOverride), 0)

  return (
    <section className="wh-card wh-ed">
      <RoutineHeader data={data} tpl={tpl} onPick={onPick} status={status} count={items.filter(i => i.label.trim()).length} total={total} />
      {!tpl.enabled && (
        <div className="wh-paused">This routine is paused: no items are added to your {weekly ? 'week' : 'day'} and no reminders fire. <ResumeButton id={tpl.id} /></div>
      )}
      <QuickAdd onAdd={addParsed} today={data.today}
        placeholder={weekly ? 'Add in one line, or paste a list: Laundry' : 'Add in one line, or paste a list: Read 10 pages 22:30 30m weekdays must'} />
      {weekly ? (
        <div className="wh-grp">
          <div className="wh-grph">Once a week, any day Sunday to Saturday · not part of the day score</div>
          {items.map(i => <WeeklyRow key={i.key} item={i} onChange={p => patch(i.key, p)} onRemove={() => remove(i.key)} />)}
        </div>
      ) : GROUPS.map(g => {
        const rows = sorted.filter(i => partOfDay(toDayMin(i.time)) === g)
        if (!rows.length) return null
        return (
          <div key={g} className="wh-grp">
            <div className="wh-grph">{g}</div>
            {rows.map(i => (
              <Row key={i.key} item={i} open={open === i.key} onToggle={() => setOpen(open === i.key ? null : i.key)}
                onChange={p => patch(i.key, p)} onRemove={() => remove(i.key)} />
            ))}
          </div>
        )
      })}
      {items.length === 0 && <p className="wh-sub" style={{ margin: '14px 0 4px' }}>Nothing here yet. Add the first thing you want to do each {weekly ? 'week' : 'day'}.</p>}
      <button className="wh-addrow" onClick={add}>{weekly ? '+ Add an item' : '+ Add an item field by field'}</button>
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
    <section className="wh-card wh-tline">
      <div className="hd">
        <div className="wh-h">Your day, top to bottom</div>
        <div className="wh-sub">drag a name to move it · drag a bar's end to resize</div>
      </div>
      {shown.length === 0 ? <p className="wh-sub" style={{ marginTop: 10 }}>Items with a time appear here.</p> : (
        <div className="wh-vt" style={{ height }}>
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

export function ResumeButton({ id }: { id: number }) {
  const toggle = useToggleRoutine()
  return <button className="wh-chase" onClick={() => toggle.mutate({ id, enabled: true })}>Resume</button>
}

export function RoutineHeader({ data, tpl, onPick, status, count, total }: {
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
  const setType = useSetRoutineType()
  const weekly = tpl.type === 'weekly'

  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.wh-rmenu, .wh-dots')) { setMenu(false); setConfirm(false) } }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [menu])

  return (
    <div className="wh-rhead">
      <div className="l">
        {renaming ? (
          <form onSubmit={e => { e.preventDefault(); if (name.trim()) rename.mutate({ id: tpl.id, name: name.trim() }); setRenaming(false) }}>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={() => setRenaming(false)} className="wh-rename" aria-label="Routine name" />
          </form>
        ) : data.templates.length > 1 ? (
          <div className="wh-tpls" role="tablist" aria-label="Routines">
            {data.templates.map(t => (
              <button key={t.id} role="tab" aria-selected={t.id === tpl.id} className={t.id === tpl.id ? 'on' : ''} onClick={() => onPick(t.id)}>
                {t.name}{t.type === 'weekly' && <small> · weekly</small>}{!t.enabled && <small> · paused</small>}
              </button>
            ))}
          </div>
        ) : (
          <div className="wh-h" style={{ fontSize: 17 }}>{tpl.name}</div>
        )}
        <div className="wh-sub">{count} item{count === 1 ? '' : 's'} · {weekly ? 'weekly, ticked once a week and not scored' : `up to ${total} points a day`}</div>
      </div>
      <div className="r">
        <span className="wh-sub" style={{ color: status === 'error' ? 'var(--k-bad)' : undefined }} role="status">
          {status === 'saved' ? 'Saved' : status === 'error' ? "Couldn't save, try again" : 'Saving…'}
        </span>
        <button className="wh-dots" aria-label="Routine options" aria-expanded={menu} onClick={() => { setMenu(m => !m); setConfirm(false) }}>⋯</button>
        {menu && (
          <div className="wh wh-rmenu" role="menu">
            {!confirm ? (
              <>
                <button role="menuitem" onClick={() => { setMenu(false); setName(tpl.name); setRenaming(true) }}>Rename</button>
                <button role="menuitem" onClick={() => { setMenu(false); toggle.mutate({ id: tpl.id, enabled: !tpl.enabled }) }}>{tpl.enabled ? 'Pause' : 'Resume'}</button>
                <button role="menuitem" onClick={() => { setMenu(false); setType.mutate({ id: tpl.id, type: weekly ? 'daily' : 'weekly' }) }}>
                  {weekly ? 'Make it daily' : 'Make it weekly'}
                </button>
                <hr />
                <button role="menuitem" onClick={() => { setMenu(false); create.mutate({ name: 'New routine', type: 'daily' }, { onSuccess: r => onPick(r.id) }) }}>New daily routine</button>
                <button role="menuitem" onClick={() => { setMenu(false); create.mutate({ name: 'Weekly routine', type: 'weekly' }, { onSuccess: r => onPick(r.id) }) }}>New weekly routine</button>
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
  const once = onceDate(item.schedule)
  const flipDay = (d: number) => {
    const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d]
    if (next.length) onChange({ schedule: scheduleOf(next) })
  }
  return (
    <div className={`wh-ri ${open ? 'open' : ''}`}>
      <div className="sum" onClick={onToggle} role="button" tabIndex={0} aria-expanded={open}
        onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onToggle() }}>
        <input className="t num" type="time" value={item.time ?? ''} aria-label={`Time for ${item.label}`}
          onClick={e => e.stopPropagation()} onChange={e => onChange({ time: e.target.value || null })} />
        <span className="n">{item.label || <i>New item</i>}<Streak n={item.streak} unit="day" /></span>
        <span className="m">{windowLabel(item.windowMin)} window · {daysLabel(item.schedule)}</span>
        <button className={`w ${imp.value === 'UI' ? 'must' : ''}`} title="Click to change how much it matters"
          aria-label={`Weight ${imp.label}, click to change`}
          onClick={e => { e.stopPropagation(); const i = IMPORTANCE.findIndex(o => o.value === imp.value); onChange({ importance: IMPORTANCE[(i + 1) % IMPORTANCE.length].value }) }}>
          {imp.label}
        </button>
        <span className="h num" style={{ color: hit == null ? 'var(--k-faint)' : hit >= 70 ? 'var(--k-good)' : hit >= 40 ? 'var(--k-warn)' : 'var(--k-bad)' }}>
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
            <div className="rt-daysrow">
              <div className="days" role="group" aria-label="Days it runs">
                {WEEK_ORDER.map(d => (
                  <button key={d} className={days.includes(d) ? 'on' : ''} aria-pressed={days.includes(d)} onClick={() => flipDay(d)}
                    aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]}>{DAY_LETTERS[d]}</button>
                ))}
              </div>
              <span className="rt-or">or</span>
              <button className={`rt-once ${once ? 'on' : ''}`} aria-pressed={!!once}
                onClick={() => onChange({ schedule: once ? null : `once:${routineToday()}` })}>Just once</button>
              {once && (
                <input className="num rt-oncedate" type="date" value={once} aria-label="The day it runs once"
                  onChange={e => e.target.value && onChange({ schedule: `once:${e.target.value}` })} />
              )}
            </div>
          </div>
          <div className="lab"><span>How much it matters</span>
            <div className="seg" role="radiogroup">
              {IMPORTANCE.map(o => (
                <button key={o.value} role="radio" aria-checked={item.importance === o.value} className={(item.importance ?? 'NUI') === o.value ? 'on' : ''}
                  onClick={() => onChange({ importance: o.value })} title={o.hint}>{o.label} <small className="num">{o.points}</small></button>
              ))}
            </div>
          </div>
          <div className="foot">
            <span className="wh-sub">On time inside the {windowLabel(item.windowMin)} window earns {pointsOf(item.importance, item.pointsOverride)}; late earns half.</span>
            <button className="rm" onClick={onRemove}>Remove item</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── One line in, one item out (or a pasted list, one item per line) ────────

/** Days in a row (or weeks in a row) as a small flame and a number. Shown from 2. */
export function Streak({ n, unit = 'day' }: { n?: number; unit?: 'day' | 'week' }) {
  if (!n || n < 2) return null
  return (
    <span className="rt-streak num" title={`${n} ${unit}s in a row ${unit === 'day' ? 'on time' : 'done'}`} aria-label={`${n} ${unit}s in a row`}>
      <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden><path d="M5 .6c.4 2-1.9 3-1.9 5.2 0 .8.4 1.4.9 1.7-.1-1.2.6-2 1.4-2.6.1 1.4 1.6 1.9 1.6 3.4 0 .4-.1.8-.3 1.1C8.2 8.8 9 7.6 9 6.2 9 3.4 6.3 2.6 5 .6zM1 7.4C1 9.9 2.8 11.4 5 11.4S9 9.9 9 7.4" fill="currentColor" /></svg>
      {n}
    </span>
  )
}

export function QuickAdd({ onAdd, placeholder, today, label = 'Add an item in one line, or paste a list' }: {
  onAdd: (ps: Parsed[]) => void; placeholder: string; today?: string; label?: string
}) {
  const [text, setText] = useState('')
  const ps = text.trim() ? parseMany(text, today) : []
  const lines = text.split('\n').length
  const multi = lines > 1
  const submit = () => { if (ps.length) { onAdd(ps); setText('') } }
  return (
    <form className="wh-quick rt-quick" onSubmit={e => { e.preventDefault(); submit() }}>
      <textarea value={text} rows={Math.min(lines, 6)} onChange={e => setText(e.target.value)} placeholder={placeholder} aria-label={label}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} />
      {ps.length > 0 && !multi && (
        <div className="prev" aria-live="polite">
          <b>{ps[0].label}</b>
          {ps[0].bits.map(b => <span key={b}>{b}</span>)}
          <kbd>Enter</kbd>
        </div>
      )}
      {multi && (
        <div className="rt-many" aria-live="polite">
          <div className="hd"><span>{ps.length} item{ps.length === 1 ? '' : 's'} read from the paste</span><kbd>Enter adds all</kbd></div>
          <ol>
            {ps.map((p, i) => (
              <li key={i}><b>{p.label}</b>{p.bits.map(b => <span key={b}>{b}</span>)}</li>
            ))}
          </ol>
        </div>
      )}
      {text.trim() && !ps.length && <div className="prev"><i>name it</i></div>}
    </form>
  )
}

// ─── A weekly routine's item: a name, done or not this week ─────────────────

export function WeeklyRow({ item, onChange, onRemove }: { item: Draft; onChange: (p: Partial<Draft>) => void; onRemove: () => void }) {
  const tick = useWeeklyTick()
  const done = !!item.week?.done
  const id = item.week?.entryItemId
  return (
    <div className="rt-wrow">
      <button className={`rt-check ${done ? 'on' : ''}`} disabled={!id || tick.isPending} aria-pressed={done}
        aria-label={done ? `Untick ${item.label} for this week` : `Tick ${item.label} for this week`}
        title={id ? (done ? 'Done this week. Click to untick.' : 'Tick it for this week') : 'Saved items can be ticked'}
        onClick={() => id && tick.mutate({ id, done: !done })}>
        {done && <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden><path d="M2.5 6.3l2.2 2.1 4.8-4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </button>
      <input value={item.label} placeholder="What do you do once a week?" autoFocus={!item.label} aria-label="Weekly item name"
        onChange={e => onChange({ label: e.target.value })} />
      <Streak n={item.streak} unit="week" />
      <span className={`rt-wst ${done ? 'good' : ''}`}>{done ? 'Done this week' : 'Not yet this week'}</span>
      <button className="rt-x" onClick={onRemove} aria-label={`Remove ${item.label || 'this item'}`}>×</button>
    </div>
  )
}

// ─── Reminders ───────────────────────────────────────────────────────────────

/** Opens System Settings at Notifications. */
const NOTIFICATION_SETTINGS = 'x-apple.systempreferences:com.apple.Notifications-Settings.extension'

/** Whether macOS settings stand between a reminder and you. */
const needsSettings = (n: NotifierStatus) => n.via === 'arete' && (n.permission === 'denied' || n.style === 'none' || n.sound === false)

/** One line on how reminders arrive, and what to change when they won't get your attention. */
function notifierLine(n: NotifierStatus | undefined): string {
  if (!n) return 'Reminders come as macOS notifications, even with the browser closed.'
  if (n.via !== 'arete') return 'Reminders use plain macOS notifications, which can arrive quietly. Run npm run notifier:build for Arete notifications with a sound.'
  if (n.permission === 'not-determined') return 'Send a test: macOS will ask once whether Arete may send notifications. Choose Allow.'
  if (n.permission === 'denied') return 'macOS is blocking Arete. In Notification settings, open Arete and turn on Allow notifications.'
  if (n.style === 'none') return 'Arete is allowed but set to show nothing. In Notification settings, set Arete to Alerts.'
  if (n.sound === false) return 'Sound is off for Arete. Turn on "Play sound for notification" in Notification settings.'
  return n.style === 'alerts'
    ? 'Reminders arrive as Arete alerts with a sound, and stay until you dismiss them, even with the browser closed.'
    : 'Reminders arrive as Arete notifications with a sound, even with the browser closed.'
}

export function Reminders() {
  const { data } = useReminderSettings()
  const save = useSaveReminderSettings()
  const test = useTestNotification()
  const status = useNotifierStatus()
  const [tested, setTested] = useState<string | null>(null)
  if (!data) return null
  const on = data.notifications === 'on'
  const lead = Number(data.alertLeadMin) || 0
  const quiet = data.quietFrom && data.quietTo
  const set = (patch: Record<string, string>) => save.mutate(patch)

  return (
    <section className="wh-card rt-rem">
      <div className="hd">
        <div className="wh-h">Reminders</div>
        <span className="wh-sub" role="status">{save.isPending ? 'Saving…' : save.isError ? "Couldn't save" : ''}</span>
      </div>
      <p className="rt-answer">
        {on
          ? <>On. Each item alerts {lead ? <><b className="num">{lead} min</b> before</> : 'when'} its window opens; the evening review prompt comes at <b className="num">{data.reviewTime}</b>{quiet ? <>; quiet from <b className="num">{data.quietFrom}</b> to <b className="num">{data.quietTo}</b></> : ''}.</>
          : 'Off. No item alerts and no evening review prompt.'}
      </p>
      <div className="rt-field">
        <span>Notifications</span>
        <div className="rt-seg" role="radiogroup" aria-label="Notifications">
          {(['on', 'off'] as const).map(v => (
            <button key={v} role="radio" aria-checked={data.notifications === v} className={data.notifications === v ? 'on' : ''}
              onClick={() => set({ notifications: v })}>{v === 'on' ? 'On' : 'Off'}</button>
          ))}
        </div>
      </div>
      <div className={`rt-field ${on ? '' : 'dim'}`}>
        <span>Alert me</span>
        <div className="rt-seg" role="radiogroup" aria-label="How early to alert">
          {LEADS.map(m => (
            <button key={m} role="radio" aria-checked={lead === m} className={lead === m ? 'on' : ''} disabled={!on}
              onClick={() => set({ alertLeadMin: String(m) })}>{m === 0 ? 'At start' : `${m} min`}</button>
          ))}
        </div>
      </div>
      <div className={`rt-field ${on ? '' : 'dim'}`}>
        <span>Evening review</span>
        <input className="num" type="time" value={data.reviewTime} disabled={!on} aria-label="Evening review time"
          onChange={e => e.target.value && set({ reviewTime: e.target.value })} />
      </div>
      <div className={`rt-field ${on ? '' : 'dim'}`}>
        <span>Quiet hours</span>
        <div className="rt-quiet">
          <input className="num" type="time" value={data.quietFrom} disabled={!on} aria-label="Quiet from"
            onChange={e => set({ quietFrom: e.target.value, ...(data.quietTo ? {} : { quietTo: '08:00' }) })} />
          <span>to</span>
          <input className="num" type="time" value={data.quietTo} disabled={!on} aria-label="Quiet until"
            onChange={e => set({ quietTo: e.target.value, ...(data.quietFrom ? {} : { quietFrom: '23:00' }) })} />
          {quiet && <button className="wh-chase" disabled={!on} onClick={() => set({ quietFrom: '', quietTo: '' })}>None</button>}
        </div>
      </div>
      <div className="rt-foot">
        <span className="wh-sub">{tested ?? notifierLine(status.data)}
          {status.data && needsSettings(status.data) && <> <a className="lnk" href={NOTIFICATION_SETTINGS}>Open Notification settings</a></>}
        </span>
        <button className="wh-chase" disabled={test.isPending}
          onClick={() => test.mutate(undefined, {
            onSuccess: r => setTested(!r.sent ? 'Not sent, try again.'
              : r.notifier.permission === 'not-determined' ? 'macOS is asking whether Arete may send notifications. Choose Allow, then send another test.'
              : 'Sent. It should appear in the top corner of the screen.'),
            onError: () => setTested("Couldn't send it. Is the server running?"),
          })}>Send a test notification</button>
      </div>
    </section>
  )
}

// ─── History heatmap + day drill-in ──────────────────────────────────────────

function History({ data }: { data: RoutineView }) {
  const [pick, setPick] = useState<string | null>(null)
  const detail = useDayDetail(pick)
  const nav = useNavigate()
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
    <section className="wh-card wh-hist">
      <div className="hd">
        <div className="wh-h">Day scores</div>
        <div className="wh-sub">{avg != null ? <>last 4 weeks average <span className="num" style={{ color: 'var(--k-ink2)' }}>{avg}</span></> : 'no closed days yet'}</div>
      </div>
      <div className="wh-heat" role="grid" aria-label="Day scores, last 16 weeks">
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
                  style={{ background: future ? 'transparent' : s == null ? 'rgb(var(--k-fg) / .045)' : zone(s), opacity: s == null ? 1 : 0.35 + (s / 100) * 0.65, outline: isToday ? '1px solid var(--k-ink2)' : undefined }} />
              )
            })}
          </div>
        ))}
      </div>
      <div className="wh-legend wh-sub"><i style={{ background: 'var(--k-bad)' }} />under 45<i style={{ background: 'var(--k-warn)' }} />45 to 74<i style={{ background: 'var(--k-good)' }} />75 and up</div>

      {pick && (
        <div className="wh-dd">
          <div className="hd">
            <b>{fmtDate(pick, { weekday: 'long', day: 'numeric', month: 'long' })}</b>
            <span className="num">{detail.data?.score ?? '–'}</span>
          </div>
          {detail.data?.reflection && <p className="ref">“{detail.data.reflection}”</p>}
          {detail.data?.autoClosed && <p className="wh-sub">Closed automatically at 04:00, no review.</p>}
          <button className="wh-chase rt-open" onClick={() => nav(pick === data.today ? '/' : `/?date=${pick}`)}>
            {pick === data.today ? 'Open on Today' : 'Open on Today to view or correct it'}
          </button>
          <ul>
            {detail.data?.items.map(i => (
              <li key={i.id}>
                <span className="num">{i.time ?? '··'}</span>
                <span className="l">{i.label}</span>
                <span style={{ color: i.status === 'on_time' ? 'var(--k-good)' : i.status === 'late' ? 'var(--k-warn)' : i.status === 'missed' || i.status === 'overdue' ? 'var(--k-bad)' : 'var(--k-mute)' }}>
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

export function WhyMissed({ data }: { data: RoutineView }) {
  const items = data.templates.flatMap(t => t.items)
  const reasons: Record<string, number> = {}
  for (const i of items) for (const [r, n] of Object.entries(i.stats?.reasons ?? {})) reasons[r] = (reasons[r] ?? 0) + n
  const rs = Object.entries(reasons).sort((a, b) => b[1] - a[1])
  const total = rs.reduce((s, [, n]) => s + n, 0)
  const most = [...items].filter(i => (i.stats?.missed ?? 0) > 0).sort((a, b) => b.stats!.missed - a.stats!.missed).slice(0, 3)
  if (total === 0) return null   // appears once evening reviews have given reasons

  return (
    <section className="wh-card wh-why">
      <div className="wh-h">Why things get missed</div>
      {total === 0
        ? <p className="wh-sub" style={{ marginTop: 6 }}>Reasons come from the evening review. Close a few days with a reason for each miss and the pattern shows up here.</p>
        : rs.map(([r, n]) => (
          <div key={r} className="wh-tk">
            <div className="nm">{r}</div>
            <div className="wh-bar"><b style={{ width: `${(n / total) * 100}%`, background: 'var(--k-ink2)' }} /></div>
            <div className="v num">{n}</div>
          </div>
        ))}
      {most.length > 0 && (
        <>
          <div className="wh-sub" style={{ marginTop: 14 }}>Missed most, last 30 days</div>
          {most.map(i => (
            <div key={i.id} className="wh-mrow">
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
  const { addMany, remove } = useOneOffs()
  const [err, setErr] = useState<string | null>(null)
  // "tomorrow" or a date in the line sends it to that day; otherwise today.
  const addAll = (ps: Parsed[]) => {
    const byDate = new Map<string, Parsed[]>()
    for (const p of ps) { const d = onceDate(p.schedule ?? null) ?? data.today; byDate.set(d, [...(byDate.get(d) ?? []), p]) }
    setErr(null)
    for (const [date, list] of byDate) {
      addMany.mutate({ date, items: list.map(p => ({ label: p.label, time: p.time, importance: p.importance })) },
        { onError: (e: any) => setErr(e?.response?.data?.error ?? "Couldn't add that.") })
    }
  }
  return (
    <section className="wh-card wh-one">
      <div className="hd"><div className="wh-h">Just for today</div><div className="wh-sub">one-offs, scored like the rest</div></div>
      {data.oneOffs.map(o => (
        <div key={o.id} className="wh-mrow">
          <div className="k">{o.label}{o.time && <span className="num">{o.time}</span>}{o.importance && <span>{IMPORTANCE.find(i => i.value === o.importance)?.label.toLowerCase()}</span>}</div>
          <div className="r">
            {o.completed && <span style={{ color: 'var(--k-good)' }}>done</span>}
            <button className="wh-chase" onClick={() => remove.mutate(o.id)} aria-label={`Remove ${o.label}`}>Remove</button>
          </div>
        </div>
      ))}
      <QuickAdd today={data.today} label="Add one-offs in one line, or paste a list" placeholder="Call the bank 16:00 must · or tomorrow · or paste a list" onAdd={addAll} />
      {err && <p className="rt-err" role="alert">{err}</p>}
    </section>
  )
}
