/**
 * Calendar, the one-layout redesign (approved 2026-11-08). The week is the
 * hero: events, your routine windows and trading sessions on one grid, with
 * each day's facts (workouts, trades, invoices due, goal ends) in a strip on
 * top. Add in one line ("Dentist Tue 15:00 1h", "Gym every Monday 18:00").
 * Events can be edited, repeat, run all day, and deleting asks first with
 * Undo. Day, month and year views stay. The category and trading-session
 * settings are the shared ones from the old page.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  addDays, addMonths, addYears, eachDayOfInterval, endOfMonth, endOfWeek, format, getDay, isSameDay, isSameMonth, parseISO,
  startOfMonth, startOfWeek, subMonths, subYears, differenceInCalendarDays,
} from 'date-fns'
import { useCalendarEvents, useCreateEvent, useDeleteEvent, useUpdateEvent } from '../../hooks/useCalendar'
import { useTrades } from '../../hooks/useTrades'
import { useWorkouts, useWeeklySchedule } from '../../hooks/useTraining'
import { useClients, useInvoices, useMeetingNotes, useProjects } from '../../hooks/useBusiness'
import { useFinanceExpenses, useFinanceIncome } from '../../hooks/useFinances'
import { useGoals } from '../../hooks/useGoals'
import { useRoutine, daysOf } from '../../core/routine'
import { useTick, useToday } from '../../core/today'
import { usePrivacy, MASK } from '../../core/privacy'
import { formatCurrency, formatGBP, formatEUR } from '../../lib/utils'
import { api } from '../../lib/api'
import { loadSessions, saveSessions as storeSessions, windowsForDate, type TradingSession } from '../../lib/sessions'
import { CategoryConfigModal, SessionConfigModal, loadCategories, saveCategories, type CalCategory } from '../../pages/Calendar'
import './next.css'
import './roadmap.css'
import './training.css'
import './money.css'
import './calendar.css'

// ─── Types and helpers ───────────────────────────────────────────────────────

type View = 'day' | 'week' | 'month' | 'year'
type Ev = { id: number; title: string; description: string | null; startDatetime: string; endDatetime: string | null; allDay: number; category: string | null; recurringRule: string | null }
/** One showing of an event on a day (a repeating event has many). */
type Occ = Ev & { day: string; start: string; end: string | null }
type Rec = Record<string, unknown>

const ROW_DEFAULT = 48              // px per hour, until the grid has measured the window
const HOURS = 24
const ymd = (d: Date) => format(d, 'yyyy-MM-dd')
const hm = (dt: string | null) => (dt?.split('T')[1] ?? '').slice(0, 5)
const minOf = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
const toHM = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const REPEATS: { v: string; l: string }[] = [
  { v: '', l: 'Does not repeat' }, { v: 'daily', l: 'Every day' }, { v: 'weekdays', l: 'Every weekday' },
  { v: 'weekly', l: 'Every week' }, { v: 'monthly', l: 'Every month' }, { v: 'yearly', l: 'Every year' },
]
const repeatLabel = (r: string | null) => REPEATS.find(x => x.v === (r ?? ''))?.l ?? r ?? ''

/** Does a repeating event fall on this day? */
function occursOn(e: Ev, day: string): boolean {
  const s = e.startDatetime.slice(0, 10)
  if (day < s) return false
  if (!e.recurringRule) return day === s
  const a = parseISO(s), b = parseISO(day)
  switch (e.recurringRule) {
    case 'daily': return true
    case 'weekdays': { const w = getDay(b); return w !== 0 && w !== 6 }
    case 'weekly': return getDay(a) === getDay(b)
    case 'monthly': return a.getDate() === b.getDate()
    case 'yearly': return a.getDate() === b.getDate() && a.getMonth() === b.getMonth()
    default: return day === s
  }
}
function occurrences(events: Ev[], days: string[]): Occ[] {
  const out: Occ[] = []
  for (const e of events) for (const day of days) {
    if (!occursOn(e, day)) continue
    const st = hm(e.startDatetime) || '00:00'
    out.push({ ...e, day, start: `${day}T${st}`, end: e.endDatetime ? `${day}T${hm(e.endDatetime)}` : null })
  }
  return out.sort((x, y) => x.start.localeCompare(y.start))
}

// ─── One-line add ────────────────────────────────────────────────────────────

const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * "Dentist Tue 15:00 1h personal", "Gym every Monday 18:00", "Holiday 24 Dec
 * all day", "Call with Sam tomorrow at 3 30m". With no day it lands on the
 * selected day; with no time it is all day. Nothing is guessed silently: the
 * preview shows every part before Enter.
 */
function parseEvent(line: string, base: string, cats: CalCategory[]) {
  let s = ` ${line} `
  const take = (re: RegExp) => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m }
  let date = base, repeat = ''
  const every = take(/\s(?:every|each)\s+(day|weekday|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)s?\b/i)
  if (every) {
    const w = every[1].toLowerCase()
    if (w === 'day') repeat = 'daily'
    else if (w === 'weekday') repeat = 'weekdays'
    else if (w === 'week') repeat = 'weekly'
    else if (w === 'month') repeat = 'monthly'
    else if (w === 'year') repeat = 'yearly'
    else {
      repeat = 'weekly'
      const t = WD.indexOf(w.slice(0, 3)); const d = parseISO(base)
      date = ymd(addDays(d, (t - getDay(d) + 7) % 7))
    }
  }
  const rw = take(/\s(daily|weekly|monthly|yearly)\b/i)
  if (rw) repeat = rw[1].toLowerCase()
  if (take(/\stoday\b/i)) date = ymd(new Date())
  if (take(/\stomorrow\b/i)) date = ymd(addDays(new Date(), 1))
  const wd = !every && take(/\s(?:on\s+)?(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i)
  if (wd) { const t = WD.indexOf(wd[1].toLowerCase()); const d = new Date(); date = ymd(addDays(d, (t - getDay(d) + 7) % 7 || 7)) }
  const dm = take(/\s(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i) ?? null
  const md = !dm && take(/\s(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/i)
  if (dm || md) {
    const day = Number(dm ? dm[1] : (md as RegExpMatchArray)[2]); const mon = MON.indexOf((dm ? dm[2] : (md as RegExpMatchArray)[1]).toLowerCase().slice(0, 3))
    const now = new Date(); let d = new Date(now.getFullYear(), mon, day, 12)
    if (ymd(d) < ymd(now)) d = new Date(now.getFullYear() + 1, mon, day, 12)
    date = ymd(d)
  }
  const allDay = !!take(/\sall[\s-]?day\b/i)
  let start: string | null = null
  const t1 = take(/\s(?:at\s+)?(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i) ?? take(/\s(?:at\s+)?(\d{1,2})\s*(am|pm)\b/i) ?? take(/\sat\s+(\d{1,2})\b/i)
  if (t1) {
    let h = Number(t1[1]); const m = t1[2] && /^\d+$/.test(t1[2]) ? Number(t1[2]) : 0
    const ap = (t1[3] ?? (t1[2] && !/^\d+$/.test(t1[2]) ? t1[2] : '')).toLowerCase()
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    if (!ap && !t1[0].includes(':') && !t1[0].includes('.') && h >= 1 && h <= 6) h += 12   // "at 5" means the afternoon
    if (h < 24 && m < 60) start = toHM(h * 60 + m)
  }
  let mins = 60
  const dur = take(/\s(?:for\s+)?(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)\b/i)
  if (dur) mins = Math.round(Number(dur[1]) * (/^h/i.test(dur[2]) ? 60 : 1))
  let category = 'personal'
  const words = s.trim().split(/\s+/)
  for (let i = words.length - 1; i >= 1; i--) {
    const c = cats.find(x => x.label.toLowerCase() === words[i].toLowerCase() || x.value === words[i].toLowerCase())
    if (c) { category = c.value; words.splice(i, 1); break }
  }
  const title = words.join(' ').replace(/\s+(on|at|for)$/i, '').trim()
  const timed = !!start && !allDay
  return { title, date, start: timed ? start : null, mins, allDay: !timed, repeat, category }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function NextCalendar() {
  const [view, setView] = useState<View>(() => (localStorage.getItem('oura-cal-view') as View) || 'week')
  const [sel, setSel] = useState(() => new Date())
  const [layers, setLayers] = useState<{ events: boolean; routine: boolean; sessions: boolean }>(() => {
    try { return { events: true, routine: true, sessions: true, ...JSON.parse(localStorage.getItem('oura-cal-layers') ?? '{}') } } catch { return { events: true, routine: true, sessions: true } }
  })
  const [cats, setCats] = useState<CalCategory[]>(loadCategories)
  const [sessions, setSessions] = useState<TradingSession[]>(loadSessions)
  const [catsOpen, setCatsOpen] = useState(false)
  const [sessOpen, setSessOpen] = useState(false)
  const [sheet, setSheet] = useState<{ ev?: Ev; date?: string; start?: string } | null>(null)
  const [undo, setUndo] = useState<Ev | null>(null)
  const addRef = useRef<HTMLInputElement>(null)
  // The Undo offer stays for ten seconds.
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 10_000); return () => clearTimeout(t) }, [undo])

  const pick = (v: View) => { setView(v); try { localStorage.setItem('oura-cal-view', v) } catch { /* private mode */ } }
  const toggle = (k: keyof typeof layers) => setLayers(p => { const n = { ...p, [k]: !p[k] }; try { localStorage.setItem('oura-cal-layers', JSON.stringify(n)) } catch { /* private mode */ } return n })
  const nav = (dir: 1 | -1) => setSel(d => (view === 'day' ? addDays(d, dir) : view === 'week' ? addDays(d, dir * 7) : view === 'month' ? (dir > 0 ? addMonths(d, 1) : subMonths(d, 1)) : (dir > 0 ? addYears(d, 1) : subYears(d, 1))))
  const color = (c: string | null) => cats.find(x => x.value === c)?.color ?? '#B4BCC9'

  const weekStart = startOfWeek(sel, { weekStartsOn: 1 })
  const days = view === 'day' ? [sel] : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const title = view === 'day' ? format(sel, 'EEEE d MMMM') : view === 'week' ? `${format(weekStart, 'd MMM')} to ${format(endOfWeek(sel, { weekStartsOn: 1 }), 'd MMM yyyy')}` : view === 'month' ? format(sel, 'MMMM yyyy') : format(sel, 'yyyy')

  // Keys: T today, D W M Y views, arrows step, N adds.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || sheet || el.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      const k = e.key.toLowerCase()
      if (k === 't') setSel(new Date())
      else if (k === 'd') pick('day'); else if (k === 'w') pick('week'); else if (k === 'm') pick('month'); else if (k === 'y') pick('year')
      else if (e.key === 'ArrowLeft') nav(-1); else if (e.key === 'ArrowRight') nav(1)
      else if (k === 'n') { e.preventDefault(); addRef.current?.focus() }
      else return
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  return (
    <div className="wh-page nx ncl skin-enter">
      <div className="nx-wrap">
        <div className="ncl-bar">
          <h1 className="ncl-title">Calendar</h1>
          <div className="tr-seg" role="group" aria-label="View">
            {(['day', 'week', 'month', 'year'] as View[]).map(v => <button key={v} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => pick(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
          </div>
          <div className="ncl-nav">
            <button onClick={() => nav(-1)} aria-label="Back">‹</button>
            <b>{title}</b>
            <button onClick={() => nav(1)} aria-label="Forward">›</button>
            <button className="nx-btn ghost sm" onClick={() => setSel(new Date())}>Today<kbd>T</kbd></button>
          </div>
          <span className="nr-grow" />
          {(view === 'day' || view === 'week') && (
            <div className="ncl-show" role="group" aria-label="Show on the grid">
              <span>Show</span>
              <button className={layers.events ? 'on' : ''} aria-pressed={layers.events} onClick={() => toggle('events')} title="Your events"><i className="sw ev" />Events</button>
              <button className={layers.routine ? 'on' : ''} aria-pressed={layers.routine} onClick={() => toggle('routine')} title="Your routine's time windows"><i className="sw rt" />Routine</button>
              <button className={layers.sessions ? 'on' : ''} aria-pressed={layers.sessions} onClick={() => toggle('sessions')} title="When the markets are open, in your time"><i className="sw ss" />Market hours</button>
            </div>
          )}
        </div>

        <Data sel={sel} view={view} days={days}>
          {d => (
            <div className="nx-top">
              <section className="nx-hero ncl-hero" aria-label="Calendar">
                <AddLine inputRef={addRef} base={ymd(sel)} cats={cats} color={color} onForm={() => setSheet({ date: ymd(sel), start: '09:00' })} />
                {(view === 'day' || view === 'week') && <Grid d={d} days={days} sel={sel} layers={layers} sessions={sessions} color={color}
                  onPickDay={day => setSel(day)}
                  onSlot={(date, start) => setSheet({ date, start })} onOpen={ev => setSheet({ ev })} />}
                {view === 'month' && <MonthGrid d={d} sel={sel} color={color} onPick={day => { setSel(day); pick('day') }} />}
                {view === 'year' && <YearGrid d={d} sel={sel} onPick={m => { setSel(m); pick('month') }} />}
              </section>
              <aside className="ncl-side">
                {undo && (
                  <div className="nrt-undo"><span>Deleted "{undo.title}".</span><UndoButton ev={undo} onDone={() => setUndo(null)} /></div>
                )}
                <DayPanel d={d} day={sel} color={color} onOpen={ev => setSheet({ ev })} onDayView={view !== 'day' ? () => pick('day') : undefined} onAdd={() => setSheet({ date: ymd(sel), start: '09:00' })} />
                <ComingUp d={d} color={color} onOpen={ev => setSheet({ ev })} />
                <MiniMonth sel={sel} d={d} onPick={day => setSel(day)} />
                <div className="ncl-set">
                  <button className="ntr-lnk" onClick={() => setCatsOpen(true)}>Categories</button>
                  <button className="ntr-lnk" onClick={() => setSessOpen(true)}>Trading sessions</button>
                </div>
              </aside>
            </div>
          )}
        </Data>
      </div>
      {sheet && <EventSheet init={sheet} cats={cats} onClose={() => setSheet(null)} onDeleted={ev => { setUndo(ev); setSheet(null) }} />}
      <CategoryConfigModal open={catsOpen} onClose={() => setCatsOpen(false)} categories={cats} onSave={c => { setCats(c); saveCategories(c) }} />
      <SessionConfigModal open={sessOpen} onClose={() => setSessOpen(false)} sessions={sessions} onSave={s => { setSessions(s); storeSessions(s) }} />
    </div>
  )
}

function UndoButton({ ev, onDone }: { ev: Ev; onDone: () => void }) {
  const create = useCreateEvent()
  return <button className="nx-btn ghost sm" disabled={create.isPending} onClick={() => {
    const { title, description, startDatetime, endDatetime, allDay, category, recurringRule } = ev
    create.mutate({ title, description, startDatetime, endDatetime, allDay, category, recurringRule }, { onSuccess: onDone })
  }}>Undo</button>
}

// ─── Data: everything the views read, for the range on screen ────────────────

type DayFacts = { workouts: string[]; planned: string | null; trades: number; pnl: number; due: { label: string; amount: number }[]; meetings: string[]; goals: string[]; spent: number; earned: number }

function Data({ sel, view, days, children }: { sel: Date; view: View; days: Date[]; children: (d: ReturnType<typeof useData>) => React.ReactNode }) {
  const d = useData(sel, view, days)
  return <>{children(d)}</>
}

function useData(sel: Date, view: View, days: Date[]) {
  const from = view === 'year' ? `${sel.getFullYear()}-01-01` : view === 'month' ? ymd(startOfWeek(startOfMonth(sel), { weekStartsOn: 1 })) : ymd(days[0])
  const to = view === 'year' ? `${sel.getFullYear()}-12-31` : view === 'month' ? ymd(endOfWeek(endOfMonth(sel), { weekStartsOn: 1 })) : ymd(days[days.length - 1])
  const { data: evs = [] } = useCalendarEvents()                    // all of them: repeating events start before the range
  const { data: trades = [] } = useTrades({ from, to })
  const { data: workouts = [] } = useWorkouts()
  const { data: schedule = [] } = useWeeklySchedule(ymd(startOfWeek(sel, { weekStartsOn: 1 })))
  const { data: invoices = [] } = useInvoices()
  const { data: meetings = [] } = useMeetingNotes()
  const { data: clients = [] } = useClients()
  const { data: goals = [] } = useGoals()
  const { data: expenses = [] } = useFinanceExpenses({ from, to, excludeBusiness: '1' })
  const { data: income = [] } = useFinanceIncome({ from, to })
  const routine = useRoutine()
  const today = ymd(new Date())

  const range = useMemo(() => eachDayOfInterval({ start: parseISO(from), end: parseISO(to) }).map(ymd), [from, to])
  const ahead = useMemo(() => Array.from({ length: 15 }, (_, i) => ymd(addDays(new Date(), i))), [])
  const events = evs as Ev[]
  const occ = useMemo(() => occurrences(events, range), [events, range])
  const upcoming = useMemo(() => occurrences(events, ahead).filter(o => o.start >= `${today}T${format(new Date(), 'HH:mm')}` || o.allDay), [events, ahead, today])
  const clientName = (id: unknown) => (clients as Rec[]).find(c => c.id === id)?.name as string | undefined

  const facts = (day: string): DayFacts => {
    const dow = (getDay(parseISO(day)) + 6) % 7
    const t = (trades as unknown as Rec[]).filter(x => x.date === day)
    return {
      workouts: (workouts as Rec[]).filter(w => w.date === day).map(w => String(w.name)),
      planned: ((schedule as Rec[]).find(s => s.dayOfWeek === dow)?.plannedWorkout as string) ?? null,
      trades: t.length,
      pnl: t.reduce((s, x) => s + Number(x.netPnl ?? x.realizedPnl ?? 0), 0),
      due: (invoices as Rec[]).filter(i => i.dueDate === day && ['unpaid', 'overdue'].includes(String(i.status)))
        .map(i => ({ label: `${i.invoiceNumber ?? 'Invoice'}${clientName(i.clientId) ? `, ${clientName(i.clientId)}` : ''}`, amount: Number(i.total ?? i.amount ?? 0) })),
      meetings: (meetings as Rec[]).filter(m => m.meetingDate === day).map(m => `${m.title}${clientName(m.clientId) ? `, ${clientName(m.clientId)}` : ''}`),
      goals: (goals as unknown as Rec[]).filter(g => g.periodEnd === day && g.status === 'active').map(g => String(g.focus || 'Week goal')),
      spent: (expenses as Rec[]).filter(e => e.date === day).reduce((s, e) => s + Number(e.amount), 0),
      earned: (income as Rec[]).filter(i => i.date === day).reduce((s, i) => s + Number(i.amount), 0),
    }
  }
  const dueSoon = (invoices as Rec[]).filter(i => String(i.dueDate) >= today && String(i.dueDate) <= ahead[14] && ['unpaid', 'overdue'].includes(String(i.status)))
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    .map(i => ({ id: Number(i.id), day: String(i.dueDate), label: `${i.invoiceNumber ?? 'Invoice'} due${clientName(i.clientId) ? `, ${clientName(i.clientId)}` : ''}`, amount: Number(i.total ?? i.amount ?? 0) }))

  // Routine windows per weekday (0 = Sunday), from the enabled daily routines.
  const routineFor = (day: string) => {
    const dow = getDay(parseISO(day))
    return (routine.data?.templates ?? []).filter(t => t.enabled && t.type !== 'weekly').flatMap(t => t.items
      .filter(i => i.time && (i.schedule?.startsWith('once:') ? i.schedule.slice(5) === day : daysOf(i.schedule).includes(dow)))
      .map(i => ({ key: `${t.id}-${i.id}`, label: i.label, start: minOf(i.time!), win: i.windowMin || 30 })))
  }
  return { occ, upcoming, facts, dueSoon, routineFor, today }
}
type D = ReturnType<typeof useData>

// ─── One-line add ────────────────────────────────────────────────────────────

function AddLine({ inputRef, base, cats, color, onForm }: { inputRef: React.RefObject<HTMLInputElement | null>; base: string; cats: CalCategory[]; color: (c: string | null) => string; onForm: () => void }) {
  const create = useCreateEvent()
  const [line, setLine] = useState('')
  const p = line.trim() ? parseEvent(line, base, cats) : null
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!p?.title) return
    const start = p.start ? `${p.date}T${p.start}` : `${p.date}T00:00`
    const end = p.start ? `${p.date}T${toHM(Math.min(minOf(p.start) + p.mins, 1439))}` : null
    create.mutate({ title: p.title, startDatetime: start, endDatetime: end, allDay: p.allDay ? 1 : 0, category: p.category, recurringRule: p.repeat || null }, { onSuccess: () => setLine('') })
  }
  return (
    <form className="ncl-add" onSubmit={submit}>
      <div className="row">
        <div className="in">
          <input ref={inputRef} className="nr-in" value={line} onChange={e => setLine(e.target.value)} placeholder="New event: what, which day, what time" aria-label="Add an event in one line" />
          {!p && <kbd className="ncl-kbd">N</kbd>}
        </div>
        <button type="button" className="nx-btn ghost" onClick={onForm}>Use a form</button>
      </div>
      {!p ? (
        <div className="ncl-try"><span>Try</span>
          {['Dentist Tue 15:00 1h', 'Gym every Monday 18:00', 'Holiday 24 Dec all day'].map(x => <button type="button" key={x} onClick={() => { setLine(x); inputRef.current?.focus() }}>{x}</button>)}
        </div>
      ) : (
        <div className="ncl-parse">
          <span className="t"><i className="nx-dot" style={{ color: color(p.category) }} />{p.title || <em>what is it?</em>}</span>
          <span>{format(parseISO(p.date), 'EEE d MMM')}</span>
          <span>{p.allDay ? 'all day' : `${p.start} to ${toHM(Math.min(minOf(p.start!) + p.mins, 1439))}`}</span>
          {p.repeat && <span>{repeatLabel(p.repeat).toLowerCase()}</span>}
          <span className="mute">{cats.find(c => c.value === p.category)?.label}</span>
          <button className="nx-btn sm" type="submit" disabled={!p.title || create.isPending}>Add <kbd>↵</kbd></button>
        </div>
      )}
    </form>
  )
}

// ─── The time grid (day and week) ────────────────────────────────────────────

function Grid({ d, days, sel, layers, sessions, color, onPickDay, onSlot, onOpen }: {
  d: D; days: Date[]; sel: Date; layers: { events: boolean; routine: boolean; sessions: boolean }; sessions: TradingSession[]
  color: (c: string | null) => string; onPickDay: (d: Date) => void; onSlot: (date: string, start: string) => void; onOpen: (e: Ev) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t) }, [])
  const todayStr = ymd(now)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const selStr = ymd(sel)
  const dayView = useToday(days.length === 1 ? selStr : null)       // the routine's real state, for ticking on the grid
  const tick = useTick()
  const { hidden } = usePrivacy()
  const one = days.length === 1
  const [ghost, setGhost] = useState<{ day: string; min: number } | null>(null)

  // The grid fills the window from where it starts down to the bottom, so the page itself never needs to scroll.
  // Hours grow or shrink with it, aiming for about 15 hours on screen (a working day plus the evening).
  const [fitH, setFitH] = useState<number | null>(null)
  useLayoutEffect(() => {
    const fit = () => {
      const el = box.current
      if (!el) return
      const page = el.closest('.wh-page') as HTMLElement | null
      const pageTop = page?.getBoundingClientRect().top ?? 0
      const top = el.getBoundingClientRect().top - pageTop + (page?.scrollTop ?? 0)
      const pageH = page?.clientHeight ?? window.innerHeight
      // Whatever sits below the grid inside its card (the hint line, padding), plus the page's own bottom padding.
      // Measured from what really sits there, not the card's bottom: the card may be stretched by the side column.
      const card = el.closest('.ncl-hero') as HTMLElement | null
      const hint = card?.querySelector('.ncl-hint') as HTMLElement | null
      const px = (e: Element | null, prop: string) => (e ? parseFloat(getComputedStyle(e).getPropertyValue(prop)) || 0 : 0)
      const under = (hint ? hint.offsetHeight + px(hint, 'margin-top') : 0) + px(card, 'padding-bottom') + px(card, 'border-bottom-width') + px(page, 'padding-bottom') + 2
      const h = Math.max(320, Math.floor(pageH - top - under))
      setFitH(prev => (prev != null && Math.abs(prev - h) < 2 ? prev : h))
    }
    fitRef.current = fit
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [days.length])
  // Re-fit after every update: the day headers grow as workouts, trades and all-day events load.
  const fitRef = useRef<() => void>(() => {})
  useLayoutEffect(() => { fitRef.current() })
  const ROW = fitH ? Math.max(32, Math.min(64, Math.floor(fitH / 15))) : ROW_DEFAULT

  // Start scrolled to two hours before now, or 07:00, once the size is known.
  const scrolled = useRef(false)
  useEffect(() => {
    if (scrolled.current || !box.current || fitH == null) return
    scrolled.current = true
    const at = days.some(x => ymd(x) === todayStr) && nowMin >= 9 * 60 ? nowMin - 120 : 7 * 60
    box.current.scrollTop = (at / 60) * ROW
  })

  return (
    <div className="ncl-grid">
      <div className="ncl-heads" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
        <span />
        {days.map(day => {
          const s = ymd(day), f = d.facts(s)
          const allDay = layers.events ? d.occ.filter(o => o.day === s && o.allDay) : []
          return (
            <div key={s} className={`ncl-head ${s === todayStr ? 'today' : ''} ${s === selStr && !one ? 'sel' : ''}`}>
              {!one && <button className="dn" onClick={() => onPickDay(day)} aria-label={`Select ${format(day, 'EEEE d MMMM')}`} title="Show this day on the right"><span>{format(day, 'EEE')}</span><b className="num">{format(day, 'd')}</b></button>}
              <div className="strip">
                {allDay.map(o => <button key={`${o.id}-${s}`} className="ad" style={{ ['--c' as string]: color(o.category) }} onClick={() => onOpen(o)}>{o.title}</button>)}
                {f.workouts.map(w => <span key={w} className="f"><em>Trained</em>{w}</span>)}
                {!f.workouts.length && f.planned && <span className="f mute"><em>Plan</em>{f.planned}</span>}
                {f.trades > 0 && <span className="f"><em>Trades</em><span className={f.pnl >= 0 ? 'good' : 'bad'}>{f.trades}{hidden ? '' : `, ${f.pnl >= 0 ? '+' : '−'}${formatCurrency(Math.abs(f.pnl))}`}</span></span>}
                {f.due.map(x => <span key={x.label} className="f"><em>Due</em><span className="warn">{x.label.split(',')[0]}</span></span>)}
                {f.goals.length > 0 && <span className="f"><em>Goal</em>week ends</span>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="ncl-scroll" ref={box} style={fitH ? { height: fitH } : undefined}>
        <div className={`ncl-body ${one ? "one" : ""}`} style={{ height: HOURS * ROW, gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="ncl-hours">{Array.from({ length: HOURS }, (_, h) => <span key={h} style={{ top: h * ROW }}>{h ? `${String(h).padStart(2, '0')}:00` : ''}</span>)}</div>
          {days.map(day => {
            const s = ymd(day)
            const evs = layers.events ? d.occ.filter(o => o.day === s && !o.allDay) : []
            const isSel = s === selStr && one
            const items = isSel ? (dayView.data?.day.items ?? []).filter(i => i.start != null) : []
            const rout = layers.routine ? (isSel && items.length ? [] : d.routineFor(s)) : []
            const sess = layers.sessions ? windowsForDate(sessions, s) : []
            const dayStartMs = parseISO(s).getTime()
            return (
              <div key={s} className={`ncl-col ${s === todayStr ? 'today' : ''}`}
                onMouseMove={e => {
                  if (e.target !== e.currentTarget) { if (ghost) setGhost(null); return }
                  const min = Math.floor((e.nativeEvent.offsetY / ROW) * 4) * 15
                  if (ghost?.day !== s || ghost.min !== min) setGhost({ day: s, min })
                }}
                onMouseLeave={() => setGhost(null)}
                onClick={e => {
                  if (e.target !== e.currentTarget) return
                  const y = e.nativeEvent.offsetY
                  onSlot(s, toHM(Math.floor((y / ROW) * 4) * 15))
                }}>
                {ghost?.day === s && <div className="ghost" style={{ top: (ghost.min / 60) * ROW }}>+ {toHM(ghost.min)}</div>}
                {sess.map((w, i) => {
                  const a = Math.max(0, (w.start - dayStartMs) / 60000), b = Math.min(1440, (w.end - dayStartMs) / 60000)
                  if (b <= 0 || a >= 1440) return null
                  const top = (a / 60) * ROW
                  return (
                    <div key={w.session.id}>
                      <div className="sess" style={{ top, height: ((b - a) / 60) * ROW, right: 2 + i * 5, ['--c' as string]: w.session.color }} title={`${w.session.name} market open, ${toHM(Math.round(a))} to ${toHM(Math.round(b) % 1440)} your time`} />
                      {a > 0 && <span className="sess-l" style={{ top, right: 8 + i * 5, ['--c' as string]: w.session.color }}>{w.session.name} opens</span>}
                    </div>
                  )
                })}
                {rout.map(r => (
                  <div key={r.key} className="rt" style={{ top: (r.start / 60) * ROW, height: Math.max(14, (r.win / 60) * ROW) }} title={`${r.label}, ${toHM(r.start)}`}><span>{r.label}</span></div>
                ))}
                {layers.routine && items.map(i => {
                  const done = i.status === 'on_time' || i.status === 'late'
                  const top = ((i.start! % 1440) / 60) * ROW, h = Math.max(18, (((i.end ?? i.start! + 30) - i.start!) / 60) * ROW)
                  return (
                    <button key={i.id} className={`rt tick ${done ? 'done' : i.status === 'missed' ? 'missed' : ''}`} style={{ top, height: h }}
                      onClick={() => tick.mutate({ id: i.id, done: !done, date: s === todayStr ? null : s })} aria-pressed={done} aria-label={`${i.label}: ${done ? 'done, click to undo' : 'click when done'}`}>
                      <i />{i.label}
                    </button>
                  )
                })}
                {evs.map(o => {
                  const a = minOf(hm(o.start)), b = o.end ? minOf(hm(o.end)) : a + 60
                  return (
                    <button key={`${o.id}-${s}`} className="ev" style={{ top: (a / 60) * ROW, height: Math.max(20, ((b - a) / 60) * ROW - 2), ['--c' as string]: color(o.category) }} onClick={() => onOpen(o)}>
                      <b>{o.title}</b><span>{hm(o.start)}{o.end ? ` to ${hm(o.end)}` : ''}{o.recurringRule ? ', repeats' : ''}</span>
                    </button>
                  )
                })}
                {s === todayStr && <div className="now" style={{ top: (nowMin / 60) * ROW }}><i /></div>}
              </div>
            )
          })}
        </div>
      </div>
      <p className="ncl-hint">Click any empty time to add an event there. Click a day's name to see it on the right. {one ? 'Tick routine items straight from the grid.' : 'Open a day to tick its routine.'}</p>
    </div>
  )
}

// ─── Month and year ──────────────────────────────────────────────────────────

function MonthGrid({ d, sel, color, onPick }: { d: D; sel: Date; color: (c: string | null) => string; onPick: (d: Date) => void }) {
  const start = startOfWeek(startOfMonth(sel), { weekStartsOn: 1 })
  const cells = eachDayOfInterval({ start, end: endOfWeek(endOfMonth(sel), { weekStartsOn: 1 }) })
  return (
    <div className="ncl-month">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => <span key={x} className="wd">{x}</span>)}
      {cells.map(day => {
        const s = ymd(day), list = d.occ.filter(o => o.day === s), f = d.facts(s)
        return (
          <button key={s} className={`cell ${isSameMonth(day, sel) ? '' : 'out'} ${s === d.today ? 'today' : ''}`} onClick={() => onPick(day)}>
            <b className="num">{format(day, 'd')}</b>
            {list.slice(0, 3).map(o => <span key={`${o.id}`} className="e" style={{ ['--c' as string]: color(o.category) }}>{o.allDay ? '' : `${hm(o.start)} `}{o.title}</span>)}
            {list.length > 3 && <span className="more">+{list.length - 3} more</span>}
            <span className="dots">
              {f.workouts.length > 0 && <i title="Workout" className="w" />}
              {f.trades > 0 && <i title="Trades" className={f.pnl >= 0 ? 'g' : 'r'} />}
              {f.due.length > 0 && <i title="Invoice due" className="a" />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function YearGrid({ d, sel, onPick }: { d: D; sel: Date; onPick: (m: Date) => void }) {
  const y = sel.getFullYear()
  return (
    <div className="ncl-year">
      {Array.from({ length: 12 }, (_, m) => {
        const first = new Date(y, m, 1)
        const cells = eachDayOfInterval({ start: startOfWeek(first, { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(first), { weekStartsOn: 1 }) })
        const n = d.occ.filter(o => o.day.startsWith(format(first, 'yyyy-MM'))).length
        return (
          <button key={m} className="mo" onClick={() => onPick(first)}>
            <span className="hd"><b>{format(first, 'MMMM')}</b>{n > 0 && <small>{n} event{n === 1 ? '' : 's'}</small>}</span>
            <span className="days">
              {cells.map(c => { const s = ymd(c); const has = d.occ.some(o => o.day === s); return <i key={s} className={`${isSameMonth(c, first) ? '' : 'out'} ${s === d.today ? 'today' : ''} ${has ? 'has' : ''}`}>{format(c, 'd')}</i> })}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Side: the selected day, what is coming, a month to jump around ──────────

function DayPanel({ d, day, color, onOpen, onDayView, onAdd }: { d: D; day: Date; color: (c: string | null) => string; onOpen: (e: Ev) => void; onDayView?: () => void; onAdd: () => void }) {
  const s = ymd(day), f = d.facts(s)
  const list = d.occ.filter(o => o.day === s)
  const view = useToday(s === d.today ? null : s)
  const items = view.data?.day.items ?? []
  const done = items.filter(i => i.status === 'on_time' || i.status === 'late').length
  const { hidden } = usePrivacy()
  const money = (n: number, f2: (x: number) => string) => (hidden ? MASK : f2(n))
  const rel = differenceInCalendarDays(day, new Date())
  return (
    <section className="nx-sec ncl-day">
      <p className="ncl-eyebrow">Selected day, {rel === 0 ? 'today' : rel === 1 ? 'tomorrow' : rel === -1 ? 'yesterday' : rel > 0 ? `in ${rel} days` : `${-rel} days ago`}</p>
      <div className="nx-head"><h2 className="nx-h">{format(day, 'EEEE d MMMM')}</h2><div className="nx-aside">{onDayView && <button className="ntr-lnk" onClick={onDayView}>Open day</button>}<button className="ntr-lnk" onClick={onAdd}>Add event</button></div></div>
      <div className="nx-rows">
        <div className="nx-line"><span className="k">Events</span><span className="v">{list.length ? `${list.length}` : 'none'}</span></div>
        {list.map(o => (
          <button key={`${o.id}-${s}`} className="ncl-evrow" onClick={() => onOpen(o)}>
            <i className="nx-dot" style={{ color: color(o.category) }} /><span>{o.title}</span><em>{o.allDay ? 'all day' : hm(o.start)}</em>
          </button>
        ))}
        <div className="nx-line"><span className="k">Routine</span><span className="v num">{items.length ? `${done} of ${items.length} done` : 'nothing scheduled'}</span></div>
        <div className="nx-line"><span className="k">Workout</span><span className="v">{f.workouts.length ? <span className="good">{f.workouts.join(', ')}</span> : f.planned ? `planned: ${f.planned}` : 'none'}</span></div>
        {f.trades > 0 && <div className="nx-line"><span className="k">Trading</span><span className="v num"><span>{f.trades} trade{f.trades === 1 ? '' : 's'}</span><span className={f.pnl >= 0 ? 'good' : 'bad'}>{money(f.pnl, x => `${x >= 0 ? '+' : '−'}${formatCurrency(Math.abs(x))}`)}</span></span></div>}
        {f.due.map(x => <div key={x.label} className="nx-line"><span className="k">{x.label} <span className="warn">due</span></span><span className="v num">{money(x.amount, formatGBP)}</span></div>)}
        {f.meetings.map(m => <div key={m} className="nx-line"><span className="k">Meeting: {m}</span></div>)}
        {f.goals.map(g => <div key={g} className="nx-line"><span className="k">Week goal ends: {g}</span></div>)}
        {(f.spent > 0 || f.earned > 0) && <div className="nx-line"><span className="k">Money</span><span className="v num">{f.earned > 0 && <span className="good">+{money(f.earned, formatEUR)}</span>}{f.spent > 0 && <span>−{money(f.spent, formatEUR)}</span>}</span></div>}
      </div>
    </section>
  )
}

function ComingUp({ d, color, onOpen }: { d: D; color: (c: string | null) => string; onOpen: (e: Ev) => void }) {
  const { hidden } = usePrivacy()
  const rows = [
    ...d.upcoming.map(o => ({ key: `e${o.id}-${o.day}`, day: o.day, at: o.allDay ? '' : hm(o.start), node: <><i className="nx-dot" style={{ color: color(o.category) }} />{o.title}</>, open: () => onOpen(o) })),
    ...d.dueSoon.map(x => ({ key: `i${x.id}`, day: x.day, at: '', node: <><span className="warn">{x.label}</span> <span className="mute num">{hidden ? MASK : formatGBP(x.amount)}</span></>, open: undefined })),
  ].sort((a, b) => (a.day + a.at).localeCompare(b.day + b.at)).slice(0, 8)
  return (
    <section className="nx-sec ncl-up">
      <div className="nx-head"><h2 className="nx-h">Coming up</h2><div className="nx-aside">next 14 days</div></div>
      {!rows.length && <p className="nx-answer">Nothing booked. Add one in the line on the left.</p>}
      <div className="nx-rows">
        {rows.map(r => (
          <button key={r.key} className="ncl-evrow" onClick={r.open} disabled={!r.open}>
            <span>{r.node}</span><em>{format(parseISO(r.day), 'EEE d')}{r.at ? `, ${r.at}` : ''}</em>
          </button>
        ))}
      </div>
    </section>
  )
}

function MiniMonth({ sel, d, onPick }: { sel: Date; d: D; onPick: (d: Date) => void }) {
  const [m, setM] = useState(() => startOfMonth(sel))
  const [seen, setSeen] = useState(sel)
  if (!isSameDay(seen, sel)) { setSeen(sel); if (!isSameMonth(m, sel)) setM(startOfMonth(sel)) }
  const cells = eachDayOfInterval({ start: startOfWeek(m, { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(m), { weekStartsOn: 1 }) })
  return (
    <section className="nx-sec ncl-mini">
      <div className="nx-head"><h2 className="nx-h">{format(m, 'MMMM')}</h2>
        <div className="nx-aside"><button onClick={() => setM(subMonths(m, 1))} aria-label="Previous month">‹</button><button onClick={() => setM(addMonths(m, 1))} aria-label="Next month">›</button></div></div>
      <div className="g">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x, i) => <span key={i} className="wd">{x}</span>)}
        {cells.map(c => { const s = ymd(c); const has = d.occ.some(o => o.day === s); return (
          <button key={s} className={`${isSameMonth(c, m) ? '' : 'out'} ${s === d.today ? 'today' : ''} ${isSameDay(c, sel) ? 'sel' : ''}`} onClick={() => onPick(c)} aria-label={format(c, 'EEEE d MMMM')}>
            {format(c, 'd')}{has && <i />}
          </button>
        ) })}
      </div>
    </section>
  )
}

// ─── Create and edit ─────────────────────────────────────────────────────────

function EventSheet({ init, cats, onClose, onDeleted }: { init: { ev?: Ev; date?: string; start?: string }; cats: CalCategory[]; onClose: () => void; onDeleted: (e: Ev) => void }) {
  const ev = init.ev
  const create = useCreateEvent(), upd = useUpdateEvent(), del = useDeleteEvent()
  const { data: clients = [] } = useClients()
  const { data: projects = [] } = useProjects()
  const startT = ev ? hm(ev.startDatetime) : init.start ?? '09:00'
  const [f, setF] = useState({
    title: ev?.title ?? '', date: ev ? ev.startDatetime.slice(0, 10) : init.date ?? ymd(new Date()),
    start: startT, end: ev?.endDatetime ? hm(ev.endDatetime) : toHM(Math.min(minOf(startT) + (init.start ? 30 : 60), 1439)),
    allDay: ev ? !!ev.allDay : false, category: ev?.category ?? 'personal', repeat: ev?.recurringRule ?? '', notes: ev?.description ?? '',
    clientId: '', projectId: '',
  })
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }))
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    if (!f.title.trim()) { setErr('Give it a name.'); return }
    if (!f.allDay && f.end <= f.start) { setErr('The end is before the start.'); return }
    const body = { title: f.title.trim(), description: f.notes || null, startDatetime: `${f.date}T${f.allDay ? '00:00' : f.start}`, endDatetime: f.allDay ? null : `${f.date}T${f.end}`, allDay: f.allDay ? 1 : 0, category: f.category, recurringRule: f.repeat || null }
    try {
      if (ev) await upd.mutateAsync({ id: ev.id, ...body }); else await create.mutateAsync(body)
      if (f.category === 'business' && f.clientId) {
        await api.post('/api/business/meeting-notes', { title: body.title, meetingDate: f.date, clientId: Number(f.clientId), projectId: f.projectId ? Number(f.projectId) : null, content: f.notes || '' })
      }
      onClose()
    } catch { setErr('Could not save. Try again.') }
  }
  const clientProjects = (projects as Rec[]).filter(p => String(p.clientId) === f.clientId)
  return (
    <div className="nr-sheet-bg" onMouseDown={onClose}>
      <form className="nr-sheet ncl-sheet" role="dialog" aria-label={ev ? `Edit ${ev.title}` : 'New event'} onMouseDown={e => e.stopPropagation()} onSubmit={save} onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
        <div className="hd"><div><h2>{ev ? 'Edit event' : 'New event'}</h2>{ev?.recurringRule && <p>Changes apply to every repeat.</p>}</div><button type="button" className="nx-btn ghost sm" onClick={onClose}>Close</button></div>
        <input className="nr-in big" value={f.title} onChange={e => set({ title: e.target.value })} placeholder="What is it?" aria-label="Title" autoFocus />
        <div className="ncl-f">
          <input className="nr-in" type="date" value={f.date} onChange={e => set({ date: e.target.value })} aria-label="Date" />
          {!f.allDay && <><input className="nr-in" type="time" value={f.start} onChange={e => set({ start: e.target.value })} aria-label="Start" step={900} /><span>to</span><input className="nr-in" type="time" value={f.end} onChange={e => set({ end: e.target.value })} aria-label="End" step={900} /></>}
          <label className="nmo-chk"><input type="checkbox" checked={f.allDay} onChange={e => set({ allDay: e.target.checked })} /> All day</label>
        </div>
        <div className="ncl-f">
          <select className="nr-in" value={f.repeat} onChange={e => set({ repeat: e.target.value })} aria-label="Repeats">{REPEATS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}</select>
          <div className="ncl-cats" role="radiogroup" aria-label="Category">
            {cats.map(c => <button type="button" key={c.value} role="radio" aria-checked={f.category === c.value} className={f.category === c.value ? 'on' : ''} onClick={() => set({ category: c.value })}><i className="nx-dot" style={{ color: c.color }} />{c.label}</button>)}
          </div>
        </div>
        {f.category === 'business' && (
          <div className="ncl-f">
            <select className="nr-in" value={f.clientId} onChange={e => set({ clientId: e.target.value, projectId: '' })} aria-label="Client"><option value="">No client</option>{(clients as Rec[]).map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}</select>
            {clientProjects.length > 0 && <select className="nr-in" value={f.projectId} onChange={e => set({ projectId: e.target.value })} aria-label="Project"><option value="">No project</option>{clientProjects.map(p => <option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}</select>}
            {f.clientId && <span className="mute">Also saved as a meeting note on the client.</span>}
          </div>
        )}
        <textarea className="nr-in" rows={3} value={f.notes} onChange={e => set({ notes: e.target.value })} placeholder="Notes" aria-label="Notes" />
        <div className="ncl-ft">
          {ev && (confirm
            ? <span className="nmo-del">Delete{ev.recurringRule ? ' every repeat' : ''}? <button type="button" className="nx-btn ghost sm" onClick={() => setConfirm(false)}>Keep</button><button type="button" className="nx-btn sm danger" onClick={() => del.mutate(ev.id, { onSuccess: () => onDeleted(ev) })}>Delete</button></span>
            : <button type="button" className="nx-btn ghost sm" onClick={() => setConfirm(true)}>Delete</button>)}
          {err && <span className="bad">{err}</span>}
          <span className="nr-grow" />
          <button type="submit" className="nx-btn" disabled={create.isPending || upd.isPending}>{ev ? 'Save' : 'Add event'}</button>
        </div>
      </form>
    </div>
  )
}
