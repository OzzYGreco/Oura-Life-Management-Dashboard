/**
 * Routine, the one-layout redesign (approved 2026-11-08): the day's timeline
 * is the hero (drag a bar to move it, its end to resize), the items sit in
 * Morning / Afternoon / Tonight lanes like Today, history is one hue, and
 * one-offs can be undone. Logic is shared with the Whoop page (useDraft,
 * header menu, reminders, quick add).
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DAY_LETTERS, IMPORTANCE, WEEK_ORDER, WINDOWS, daysLabel, daysOf, fromDayMin, onceDate, pointsOf, routineToday, scheduleOf, toDayMin, windowLabel,
  useDayDetail, useOneOffs, useRoutine,
  type Parsed, type RoutineView,
} from '../../core/routine'
import { partOfDay, useWeeklyTick } from '../../core/today'
import { PageLoader } from '../../components/ui/Spinner'
import {
  EmptyRoutine, QuickAdd, Reminders, ResumeButton, RoutineHeader, Streak, WeeklyRow, WhyMissed, useDraft,
  type Draft, type DraftApi,
} from '../whoop/Routine'
import '../whoop/routine-today.css'
import './next.css'
import './routine.css'

const SNAP = 15
const DAY_END = 1440 + 240            // the day runs to 04:00 the next morning
const LANES = ['Morning', 'Afternoon', 'Tonight', 'Anytime'] as const
const fmtDate = (iso: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', o)
const byTime = (a: Draft, b: Draft) => (toDayMin(a.time) ?? 99999) - (toDayMin(b.time) ?? 99999)

function Head({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return <div className="nx-head"><h2 className="nx-h">{children}</h2>{aside && <div className="nx-aside">{aside}</div>}</div>
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function NextRoutine() {
  const { data, isPending } = useRoutine()
  const [tplId, setTplId] = useState<number | null>(null)
  const tpl = data?.templates.find(t => t.id === tplId) ?? data?.templates[0]
  if (isPending || !data) return <PageLoader />
  return (
    <div className="wh-page nx nrt skin-enter">
      <div className="nx-wrap">
        {tpl ? <Body key={tpl.id} data={data} tpl={tpl} onPick={setTplId} /> : (
          <>
            <div className="nx-top">
              <section className="nx-hero nrt-hero"><Status data={data} /><div className="nrt-pad"><EmptyRoutine /></div></section>
              <div className="nrt-side"><History data={data} /><OneOffs data={data} /></div>
            </div>
            <Under data={data} />
          </>
        )}
      </div>
    </div>
  )
}

function Body({ data, tpl, onPick }: { data: RoutineView; tpl: RoutineView['templates'][number]; onPick: (id: number | null) => void }) {
  const draft = useDraft(tpl)
  const weekly = tpl.type === 'weekly'
  const count = draft.items.filter(i => i.label.trim()).length
  const total = draft.items.filter(i => i.label.trim()).reduce((s, i) => s + pointsOf(i.importance, i.pointsOverride), 0)
  return (
    <>
      <div className="nrt-bar">
        <RoutineHeader data={data} tpl={tpl} onPick={onPick} status={draft.status} count={count} total={total} />
        {!tpl.enabled && <span className="nrt-paused"><span className="nx-chip warn">Paused: nothing is added to your {weekly ? 'week' : 'day'} and no reminders fire</span><ResumeButton id={tpl.id} /></span>}
      </div>
      <div className="nx-top">
        <section className="nx-hero nrt-hero" aria-label="Your day">
          <Status data={data} />
          {weekly
            ? <p className="nrt-note">A weekly routine has no times: each item is ticked once a week, any day, and isn't part of the day score.</p>
            : <HTimeline draft={draft} />}
          <Facts data={data} />
        </section>
        <div className="nrt-side">
          <History data={data} />
          <OneOffs data={data} />
          <WhyMissed data={data} />
        </div>
      </div>
      <Items data={data} draft={draft} />
      <Under data={data} />
    </>
  )
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function Status({ data }: { data: RoutineView }) {
  const hit = data.overall.hitRate
  const [kick, tone] = hit == null ? ['Not enough history yet', ''] : hit >= 70 ? ['Holding strong', 'good'] : hit >= 40 ? ['Holding, with gaps', 'warn'] : ['Slipping', 'warn']
  return (
    <div className="nrt-status">
      <p className={`nx-state ${tone}`}>{kick}</p>
      <h1 className="nrt-h1">{hit == null ? 'Close a few days and your routine starts telling you how it is going.'
        : <>{hit}% of windows landed on time <span>over the last {data.overall.days} closed day{data.overall.days === 1 ? '' : 's'}</span></>}</h1>
    </div>
  )
}

function Facts({ data }: { data: RoutineView }) {
  const items = data.templates.flatMap(t => t.items).filter(i => i.stats && i.stats.days >= 3)
  const ranked = [...items].sort((a, b) => (b.stats!.hitRate ?? 0) - (a.stats!.hitRate ?? 0))
  const best = ranked[0], worst = ranked[ranked.length - 1]
  const hit = data.overall.hitRate
  return (
    <div className="nrt-facts">
      <div><span>On time, 30 days</span><b className="num">{hit ?? '–'}{hit != null && <small>%</small>}</b></div>
      <div><span>Average day</span><b className="num">{data.overall.avgScore ?? '–'}</b></div>
      <div><span>Today so far</span><b className="num">{data.todayScore ?? '–'}</b></div>
      {best && worst && best !== worst && <>
        <div><span>Strongest</span><b>{best.label} <small>{best.stats!.hitRate}%</small></b></div>
        <div><span>Weakest</span><b>{worst.label} <small>{worst.stats!.hitRate}%{worst.stats!.topReason ? `, mostly "${worst.stats!.topReason.toLowerCase()}"` : ''}</small></b></div>
      </>}
    </div>
  )
}

/**
 * The day left to right. Each item's window is a bar in its own lane with its
 * on-time rate. Drag a bar to move it, its right end to resize; arrow keys do
 * the same (Shift resizes). Snaps to 15 minutes.
 */
function HTimeline({ draft }: { draft: DraftApi }) {
  const { items, open, setOpen, patch } = draft
  const box = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ key: string; mode: 'move' | 'size'; x0: number; start: number; win: number; perMin: number } | null>(null)
  const [ghost, setGhost] = useState<{ start: number; win: number } | null>(null)

  const shown = items.filter(i => toDayMin(i.time) != null).map(i =>
    drag?.key === i.key && ghost ? { ...i, s: ghost.start, w: ghost.win } : { ...i, s: toDayMin(i.time)!, w: i.windowMin })
  shown.sort((a, b) => a.s - b.s)
  const from = Math.max(240, Math.floor((Math.min(...shown.map(i => i.s), 8 * 60) - 30) / 60) * 60)
  const to = Math.min(DAY_END, Math.ceil((Math.max(...shown.map(i => i.s + i.w), 22 * 60) + 15) / 60) * 60)
  const span = Math.max(60, to - from)
  const x = (m: number) => ((m - from) / span) * 100

  // One row per item, in time order, so every name is readable and nothing overlaps.
  const ROW = 22
  const rowOf = new Map(shown.map((i, n) => [i.key, n]))

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const d = Math.round((e.clientX - drag.x0) / drag.perMin / SNAP) * SNAP
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

  const begin = (i: (typeof shown)[number], mode: 'move' | 'size') => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation(); setOpen(i.key)
    const w = box.current?.getBoundingClientRect().width ?? 600
    setDrag({ key: i.key, mode, x0: e.clientX, start: i.s, win: i.w, perMin: w / span })
  }
  const hours: number[] = []
  for (let h = Math.ceil(from / 60) * 60; h <= to; h += 60) hours.push(h)
  const nowMin = (() => { const d = new Date(); const m = d.getHours() * 60 + d.getMinutes(); return m < 240 ? m + 1440 : m })()
  const tone = (hit?: number | null) => hit == null ? '' : hit >= 70 ? 'good' : hit >= 40 ? 'warn' : 'low'

  if (!shown.length) return <p className="nrt-note">Items with a time appear here as bars you can drag.</p>
  return (
    <div className="nrt-tl">
      <div className="nrt-tl-hint">Drag a bar to move it, its end to resize. Arrow keys work too.</div>
      <div ref={box} className="nrt-tl-box" style={{ height: shown.length * ROW + 8 }}>
        {hours.map(h => <div key={h} className={`hr ${h % 180 === 0 ? 'maj' : ''}`} style={{ left: `${x(h)}%` }}><span className="num">{String(Math.floor((h % 1440) / 60)).padStart(2, '0')}</span></div>)}
        {nowMin >= from && nowMin <= to && <div className="now" style={{ left: `${x(nowMin)}%` }} aria-hidden />}
        {shown.map(i => {
          const hit = i.stats?.hitRate
          const at = x(i.s), wide = Math.max(1.2, (i.w / span) * 100)
          // The label sits after the bar, or before it near the right edge.
          const flip = at + wide > 72
          return (
            <div key={i.key} className="row" style={{ top: (rowOf.get(i.key) ?? 0) * ROW }}>
            <button type="button"
              className={`bar ${tone(hit)} ${open === i.key ? 'sel' : ''} ${drag?.key === i.key ? 'drag' : ''}`}
              style={{ left: `${at}%`, width: `${wide}%` }}
              onPointerDown={begin(i, 'move')}
              onKeyDown={e => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                e.preventDefault()
                const d = (e.key === 'ArrowLeft' ? -1 : 1) * SNAP
                if (e.shiftKey) patch(i.key, { windowMin: Math.min(360, Math.max(SNAP, i.w + d)) })
                else patch(i.key, { time: fromDayMin(Math.min(DAY_END - SNAP, Math.max(240, i.s + d))) })
              }}
              title={`${i.label || 'New item'}, ${fromDayMin(i.s)} to ${fromDayMin(i.s + i.w)}${hit != null ? `, ${hit}% on time` : ''}`}
              aria-label={`${i.label || 'New item'} at ${fromDayMin(i.s)}, ${i.w} minute window. Left and right arrows move it; with Shift they resize it.`}>
              <span className="end" onPointerDown={begin(i, 'size')} aria-hidden />
            </button>
            <span className={`lbl ${flip ? 'flip' : ''}`} style={flip ? { right: `${100 - at}%` } : { left: `${at + wide}%` }} onClick={() => setOpen(i.key)}>
              <b className="num">{fromDayMin(i.s)}</b> {i.label || 'New item'}{hit != null && <em className={`num ${tone(hit)}`}> {hit}%</em>}
            </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Side: day scores in one hue, and why things get missed ─────────────────

function History({ data }: { data: RoutineView }) {
  const [pick, setPick] = useState<string | null>(null)
  const detail = useDayDetail(pick)
  const nav = useNavigate()
  const scores = new Map(data.history.map(h => [h.date, h]))
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
    <section className="nx-sec nrt-hist">
      <Head aside={avg != null ? <span>last 4 weeks avg <b className="num">{avg}</b></span> : <span>no closed days yet</span>}>Day scores</Head>
      <div className="nrt-heat" role="grid" aria-label="Day scores, last 16 weeks">
        {weeks.map((col, w) => (
          <div key={w} className="col">
            {col.map(d => {
              const h = scores.get(d)
              const future = d > data.today, isToday = d === data.today
              const s = isToday ? data.todayScore : h?.score ?? null
              return (
                <button key={d} className={`cell ${pick === d ? 'on' : ''} ${isToday ? 'today' : ''}`} disabled={future || (s == null && !isToday)}
                  onClick={() => setPick(pick === d ? null : d)} title={`${fmtDate(d)}: ${s == null ? 'no score' : s}${isToday ? ' (so far)' : ''}`}
                  style={{ opacity: future ? 0 : s == null ? 1 : 0.18 + (s / 100) * 0.82, background: s == null ? 'rgb(var(--k-fg) / .05)' : 'var(--k-good)' }} />
              )
            })}
          </div>
        ))}
      </div>
      <p className="nrt-cap">Brighter is a better day. An empty day stays faint, never red. Click a day to open it.</p>
      {pick && (
        <div className="nrt-dd">
          <div className="hd"><b>{fmtDate(pick, { weekday: 'long', day: 'numeric', month: 'long' })}</b><span className="num">{detail.data?.score ?? '–'}</span></div>
          {detail.data?.reflection && <p className="ref">"{detail.data.reflection}"</p>}
          {detail.data?.autoClosed && <p className="nrt-cap">Closed automatically at 04:00, no review.</p>}
          {detail.data?.items.map(i => (
            <div key={i.id} className="nx-line">
              <span className="k"><span className="num mute">{i.time ?? '··'}</span> {i.label}</span>
              <span className={`v ${i.status === 'on_time' ? 'good' : i.status === 'late' ? 'warn' : i.status === 'missed' || i.status === 'overdue' ? 'bad' : 'mute'}`}>
                {i.status === 'on_time' ? 'on time' : i.status === 'late' ? 'late' : i.status === 'missed' || i.status === 'overdue' ? (i.reason ? i.reason.toLowerCase() : 'missed') : i.status}
              </span>
            </div>
          ))}
          <button className="nx-btn ghost sm" style={{ marginTop: 10 }} onClick={() => nav(pick === data.today ? '/' : `/?date=${pick}`)}>
            {pick === data.today ? 'Open on Today' : 'Open on Today to view or correct it'}
          </button>
        </div>
      )}
    </section>
  )
}

// ─── Items: the routine in lanes, edited in place ────────────────────────────

function Items({ data, draft }: { data: RoutineView; draft: DraftApi }) {
  const { items, open, setOpen, patch, remove, add, addParsed, weekly } = draft
  const sorted = [...items].sort(byTime)
  const count = items.filter(i => i.label.trim()).length
  const total = items.filter(i => i.label.trim()).reduce((s, i) => s + pointsOf(i.importance, i.pointsOverride), 0)
  const lanes = LANES.map(g => ({ g, rows: sorted.filter(i => partOfDay(toDayMin(i.time)) === g) })).filter(l => l.rows.length)
  return (
    <section className="nx-sec nrt-items">
      <Head aside={<span className="num">{count} item{count === 1 ? '' : 's'}{weekly ? ', once a week' : `, up to ${total} points a day`}</span>}>Items</Head>
      <div className="nrt-quick">
        <QuickAdd onAdd={addParsed} today={data.today}
          placeholder={weekly ? 'Add in one line, or paste a list: Laundry' : 'Add in one line, or paste a list: Read 10 pages 22:30 30m weekdays must'} />
      </div>
      {weekly ? (
        <div className="nrt-weekly">{items.map(i => <WeeklyRow key={i.key} item={i} onChange={p => patch(i.key, p)} onRemove={() => remove(i.key)} />)}</div>
      ) : (
        <div className="nrt-lanes" style={{ ['--lanes' as string]: Math.min(3, Math.max(1, lanes.length)) }}>
          {lanes.map(l => (
            <div key={l.g} className="nrt-lane">
              <div className="nrt-lh"><span>{l.g}</span><span className="num">{l.rows.length}</span></div>
              {l.rows.map(i => (
                <ItemRow key={i.key} item={i} open={open === i.key} onToggle={() => setOpen(open === i.key ? null : i.key)}
                  onChange={p => patch(i.key, p)} onRemove={() => remove(i.key)} />
              ))}
            </div>
          ))}
        </div>
      )}
      {items.length === 0 && <p className="nx-answer">Nothing here yet. Add the first thing you want to do each {weekly ? 'week' : 'day'}.</p>}
      <button className="nx-link nrt-addrow" onClick={add}>{weekly ? '+ Add an item' : '+ Add an item field by field'}</button>
    </section>
  )
}

/** The last results as dots, oldest first: green on time, amber late, red missed. */
function Dots({ item }: { item: Draft }) {
  const recent = item.stats?.recent ?? []
  if (!recent.length) return <span className="nrt-new">new</span>
  return (
    <span className="nrt-dots" title={recent.slice(-5).map(r => `${fmtDate(r.date)}: ${r.result.replace('_', ' ')}`).join('\n')}
      aria-label={`Last ${Math.min(5, recent.length)} results: ${recent.slice(-5).map(r => r.result.replace('_', ' ')).join(', ')}. ${item.stats?.onTime ?? 0} on time, ${item.stats?.late ?? 0} late, ${item.stats?.missed ?? 0} missed in ${item.stats?.days ?? 0} days.`}>
      {recent.slice(-5).map((r, n) => <i key={n} className={r.result === 'on_time' ? 'd-on' : r.result === 'late' ? 'd-late' : r.result === 'missed' || r.result === 'overdue' ? 'd-miss' : ''} />)}
    </span>
  )
}

function ItemRow({ item, open, onToggle, onChange, onRemove }: {
  item: Draft; open: boolean; onToggle: () => void; onChange: (p: Partial<Draft>) => void; onRemove: () => void
}) {
  const imp = IMPORTANCE.find(o => o.value === (item.importance ?? 'NUI')) ?? IMPORTANCE[1]
  const days = daysOf(item.schedule)
  const once = onceDate(item.schedule)
  const flipDay = (d: number) => {
    const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d]
    if (next.length) onChange({ schedule: scheduleOf(next) })
  }
  return (
    <div className={`nrt-row ${open ? 'open' : ''}`}>
      <div className="sum">
        <input className="t num" type="time" value={item.time ?? ''} aria-label={`Time for ${item.label}`} onChange={e => onChange({ time: e.target.value || null })} />
        <button className="n" onClick={onToggle} aria-expanded={open} title="Open to edit">{item.label || <i>New item</i>}<Streak n={item.streak} unit="day" /></button>
        <Dots item={item} />
        <button className={`w ${imp.value === 'UI' ? 'must' : ''}`} title={`${imp.hint}. Click to change how much it matters.`} aria-label={`Weight ${imp.label}, click to change`}
          onClick={() => { const i = IMPORTANCE.findIndex(o => o.value === imp.value); onChange({ importance: IMPORTANCE[(i + 1) % IMPORTANCE.length].value }) }}>{imp.label}</button>
        <button className="nx-more" onClick={onToggle} aria-expanded={open} aria-label={`Edit ${item.label || 'item'}`}>⋯</button>
      </div>
      {open && (
        <div className="edit">
          <label className="f"><span>Name</span><input className="nr-in" autoFocus={!item.label} value={item.label} placeholder="What do you do?" onChange={e => onChange({ label: e.target.value })} /></label>
          <div className="two">
            <label className="f"><span>Starts at</span><input className="nr-in num" type="time" value={item.time ?? ''} onChange={e => onChange({ time: e.target.value || null })} /></label>
            <label className="f"><span>Window</span>
              <select className="nr-in" value={item.windowMin} onChange={e => onChange({ windowMin: Number(e.target.value) })}>
                {[...new Set([...WINDOWS, item.windowMin])].sort((a, b) => a - b).map(w => <option key={w} value={w}>{windowLabel(w)}</option>)}
              </select></label>
          </div>
          <div className="f"><span>Days <em>{daysLabel(item.schedule)}</em></span>
            <div className="days" role="group" aria-label="Days it runs">
              {WEEK_ORDER.map(d => (
                <button key={d} className={days.includes(d) ? 'on' : ''} aria-pressed={days.includes(d)} onClick={() => flipDay(d)}
                  aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]}>{DAY_LETTERS[d]}</button>
              ))}
              <button className={`once ${once ? 'on' : ''}`} aria-pressed={!!once} onClick={() => onChange({ schedule: once ? null : `once:${routineToday()}` })}>Just once</button>
              {once && <input className="nr-in num" type="date" value={once} aria-label="The day it runs once" onChange={e => e.target.value && onChange({ schedule: `once:${e.target.value}` })} />}
            </div>
          </div>
          <div className="f"><span>How much it matters</span>
            <div className="tr-seg sm" role="radiogroup">
              {IMPORTANCE.map(o => (
                <button key={o.value} role="radio" aria-checked={item.importance === o.value} className={(item.importance ?? 'NUI') === o.value ? 'on' : ''}
                  onClick={() => onChange({ importance: o.value })} title={o.hint}>{o.label} <small className="num">{o.points}</small></button>
              ))}
            </div>
          </div>
          <div className="foot">
            <span>On time inside the {windowLabel(item.windowMin)} window earns {pointsOf(item.importance, item.pointsOverride)}; late earns half.{item.stats ? ` ${item.stats.onTime} on time, ${item.stats.late} late, ${item.stats.missed} missed in ${item.stats.days} days.` : ''}</span>
            <button className="nr-quiet" onClick={onRemove}>Remove item</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Under the items: reminders, this week, just for today ───────────────────

function Under({ data }: { data: RoutineView }) {
  return (
    <div className="nrt-under">
      <ThisWeek data={data} />
      <div className="nrt-rem"><Reminders /></div>
    </div>
  )
}

function ThisWeek({ data }: { data: RoutineView }) {
  const tick = useWeeklyTick()
  const items = data.templates.filter(t => t.type === 'weekly' && t.enabled).flatMap(t => t.items)
  const done = items.filter(i => i.week?.done).length
  return (
    <section className="nx-sec">
      <Head aside={items.length ? <span className="num">{done} of {items.length}</span> : undefined}>This week</Head>
      {items.length === 0
        ? <p className="nx-answer">No weekly items. Make a routine weekly from its ⋯ menu; its items tick once a week, any day.</p>
        : items.map(i => {
            const id = i.week?.entryItemId
            const d = !!i.week?.done
            return (
              <div key={i.id} className={`nrt-wk ${d ? 'done' : ''}`}>
                <button className={`nx-check ${d ? 'on' : ''}`} disabled={!id || tick.isPending} aria-pressed={d}
                  aria-label={d ? `Untick ${i.label} for this week` : `Tick ${i.label} for this week`} onClick={() => id && tick.mutate({ id, done: !d })}>
                  {d && <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden><path d="M2.5 6.3l2.2 2.1 4.8-4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </button>
                <span className="lb">{i.label}<Streak n={i.streak} unit="week" /></span>
                <span className={`st ${d ? 'good' : 'mute'}`}>{d ? 'done' : 'not yet'}</span>
              </div>
            )
          })}
    </section>
  )
}

function OneOffs({ data }: { data: RoutineView }) {
  const { addMany, remove, restore } = useOneOffs()
  const [err, setErr] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ id: number; label: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onError = (e: unknown) => setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't do that.")
  // "tomorrow" or a date in the line sends it to that day; otherwise today.
  const addAll = (ps: Parsed[]) => {
    const byDate = new Map<string, Parsed[]>()
    for (const p of ps) { const d = onceDate(p.schedule ?? null) ?? data.today; byDate.set(d, [...(byDate.get(d) ?? []), p]) }
    setErr(null)
    for (const [date, list] of byDate) addMany.mutate({ date, items: list.map(p => ({ label: p.label, time: p.time, importance: p.importance })) }, { onError })
  }
  const drop = (id: number, label: string) => remove.mutate(id, {
    onSuccess: () => {
      setUndo({ id, label })
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setUndo(null), 6000)
    },
    onError,
  })
  return (
    <section className="nx-sec">
      <Head aside={<span>one-offs, scored like the rest</span>}>Just for today</Head>
      {data.oneOffs.map(o => (
        <div key={o.id} className="nx-line">
          <span className="k">{o.label}{o.time && <em className="num mute"> {o.time}</em>}{o.importance && <em className="mute">, {IMPORTANCE.find(i => i.value === o.importance)?.label.toLowerCase()}</em>}</span>
          <span className="v">{o.completed && <span className="good">done</span>}<button className="nr-quiet" onClick={() => drop(o.id, o.label)} aria-label={`Remove ${o.label}`}>Remove</button></span>
        </div>
      ))}
      {undo && (
        <div className="nrt-undo" role="status">{undo.label} removed.
          <button className="nx-link" onClick={() => restore.mutate(undo.id, { onSuccess: () => setUndo(null), onError })}>Undo</button>
        </div>
      )}
      <div className="nrt-quick"><QuickAdd today={data.today} label="Add one-offs in one line, or paste a list" placeholder="Call the bank 16:00 must, or tomorrow, or paste a list" onAdd={addAll} /></div>
      {err && <p className="nr-err" role="alert">{err}</p>}
    </section>
  )
}
