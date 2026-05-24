import { useState, useEffect, useRef, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import {
  startOfWeek, endOfWeek, addDays, format, isSameDay,
  startOfMonth, endOfMonth, eachDayOfInterval, getDay,
  startOfYear, endOfYear, eachMonthOfInterval,
  addMonths, subMonths, addYears, subYears,
} from 'date-fns'
import { useCalendarEvents, useCreateEvent, useDeleteEvent } from '../../hooks/useCalendar'
import { useTrades } from '../../hooks/useTrades'
import { useWorkouts, useWeeklySchedule } from '../../hooks/useTraining'
import { useChecklistEntries, useToggleChecklistItem } from '../../hooks/useChecklists'
import { useInvoices, useMeetingNotes, useClients, useProjects } from '../../hooks/useBusiness'
import { useFinanceExpenses, useFinanceIncome } from '../../hooks/useFinances'
import { useGoals } from '../../hooks/useGoals'
import { PageShell } from '../../components/layout/PageShell'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'
import { Button } from '../../components/ui/Button'
// EVENT_CATEGORIES replaced by persisted `categories` state in CalendarPage
import { formatGBP, formatCurrency } from '../../lib/utils'
import {
  ChevronLeft, ChevronRight, Plus,
  TrendingUp, Dumbbell, Briefcase, DollarSign, CheckSquare,
  Clock, Target, Layers, AlarmClock, Settings2, Palette, Trash2,
} from 'lucide-react'

// ─── Constants ────────────────────────────────────────────────────────────────
const GRID_START  = 0     // midnight — full 24 h day
const GRID_END    = 24
const HOURS_SHOWN = GRID_END - GRID_START
const ROW_H       = 56    // px per hour
const GRID_H      = HOURS_SHOWN * ROW_H
const LABEL_W     = 52

type ViewMode = 'day' | 'week' | 'month' | 'year'

// ─── Colours ─────────────────────────────────────────────────────────────────
const IMP: Record<string, string> = { high: '#f87171', medium: '#fbbf24', low: '#818cf8' }
const M = { trading: '#fbbf24', fitness: '#34d399', business: '#a78bfa', finance: '#818cf8', checklist: '#22d3ee', goals: '#34d399' }

// ─── Category config (persisted to localStorage) ─────────────────────────────
export interface CalCategory { value: string; label: string; color: string; builtin?: boolean }
const CAT_KEY = 'cal-categories-v1'
const DEFAULT_CATEGORIES: CalCategory[] = [
  { value: 'personal', label: 'Personal',  color: '#818cf8', builtin: true },
  { value: 'business', label: 'Business',  color: '#a78bfa', builtin: true },
  { value: 'health',   label: 'Health',    color: '#34d399', builtin: true },
  { value: 'trading',  label: 'Trading',   color: '#fbbf24', builtin: true },
  { value: 'focus',    label: 'Deep Work', color: '#22d3ee', builtin: true },
]
function loadCategories(): CalCategory[] {
  try {
    const raw = localStorage.getItem(CAT_KEY)
    if (!raw) return DEFAULT_CATEGORIES
    const saved = JSON.parse(raw) as CalCategory[]
    // Merge: keep saved label/color for builtins, append custom ones
    const builtinsMerged = DEFAULT_CATEGORIES.map(d => ({
      ...d,
      ...(saved.find(s => s.value === d.value) ?? {}),
      builtin: true,
    }))
    const customs = saved.filter(s => !DEFAULT_CATEGORIES.some(d => d.value === s.value))
    return [...builtinsMerged, ...customs]
  } catch { return DEFAULT_CATEGORIES }
}
function saveCategories(cats: CalCategory[]) {
  localStorage.setItem(CAT_KEY, JSON.stringify(cats))
}
function catMap(cats: CalCategory[]): Record<string, string> {
  return Object.fromEntries(cats.map(c => [c.value, c.color]))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pnlClr  = (v: number) => v >= 0 ? '#34d399' : '#f87171'
const fmtTime = (dt: string) => (dt.split('T')[1] ?? '00:00').slice(0, 5)

function dtToPct(dt: string): number {
  const [h, m] = (dt.split('T')[1] ?? '00:00').split(':').map(Number)
  return ((h + m / 60 - GRID_START) / HOURS_SHOWN) * 100
}
function durPct(start: string, end: string): number {
  const [sh, sm] = (start.split('T')[1] ?? '00:00').split(':').map(Number)
  const [eh, em] = (end?.split('T')[1]  ?? '01:00').split(':').map(Number)
  return (Math.max((eh + em / 60) - (sh + sm / 60), 0.25) / HOURS_SHOWN) * 100
}
function timeToPct(t: string): number {
  if (!t) return -999
  // Times may be stored as "14:30PM" (24h + AM/PM suffix), "09:15AM" (12h + suffix),
  // or plain "14:30" (24h). Strip the suffix, parse, then apply 12h adjustment only
  // when the hour is genuinely in 12h range (≤ 12) and needs correction.
  const cleaned = t.trim().replace(/\s*(am|pm)$/i, '')
  const parts   = cleaned.split(':')
  if (parts.length < 2) return -999
  let h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  if (isNaN(h) || isNaN(m)) return -999
  const hasPm = /pm$/i.test(t.trim())
  const hasAm = /am$/i.test(t.trim())
  if (hasPm && h < 12) h += 12   // "09:15PM" → 21:15  (but "14:30PM" h=14 ≥ 12, no change)
  if (hasAm && h === 12) h = 0   // "12:00AM" → 00:00
  return ((h + m / 60 - GRID_START) / HOURS_SHOWN) * 100
}
function nowPct(): number | null {
  const n = new Date()
  const p = ((n.getHours() + n.getMinutes() / 60 - GRID_START) / HOURS_SHOWN) * 100
  return p >= 0 && p <= 100 ? p : null
}
function isWeekday(d: Date) { const w = getDay(d); return w !== 0 && w !== 6 }

const LAYERS_KEY = 'cal-layers-v2'
function loadLayers() {
  try { return JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null') ?? { events: true, schedule: true, plans: true } }
  catch { return { events: true, schedule: true, plans: true } }
}

// ─── Trading sessions ─────────────────────────────────────────────────────────
interface TradingSession { id: string; name: string; start: string; end: string; color: string; enabled: boolean }
const SESSION_KEY = 'cal-trading-sessions'
const DEFAULT_SESSIONS: TradingSession[] = [
  { id: 'nyse',   name: 'NYSE',   start: '14:30', end: '21:00', color: '#818cf8', enabled: true },
  { id: 'london', name: 'London', start: '08:00', end: '16:30', color: '#34d399', enabled: true },
  { id: 'asia',   name: 'Asia',   start: '00:00', end: '09:00', color: '#fbbf24', enabled: true },
]
function loadSessions(): TradingSession[] {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return DEFAULT_SESSIONS
    const saved = JSON.parse(raw) as TradingSession[]
    // Merge saved values over defaults so new fields always exist
    return DEFAULT_SESSIONS.map(def => ({ ...def, ...(saved.find(s => s.id === def.id) ?? {}) }))
  } catch { return DEFAULT_SESSIONS }
}

/** Convert "HH:MM" string to decimal hours. Returns null on invalid input. */
function hhmm(t: string): number | null {
  const parts = t.split(':')
  if (parts.length < 2) return null
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  if (isNaN(h) || isNaN(m)) return null
  return h + m / 60
}

// ─── CategoryConfigModal ──────────────────────────────────────────────────────
const PRESET_COLORS = ['#818cf8','#a78bfa','#34d399','#22d3ee','#fbbf24','#fb923c','#f87171','#e879f9','#38bdf8','#a3e635','#fb7185','#c084fc']

function slugify(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 32) || `cat-${Date.now()}`
}

function CategoryConfigModal({
  open, onClose, categories, onSave,
}: { open: boolean; onClose: () => void; categories: CalCategory[]; onSave: (cats: CalCategory[]) => void }) {
  const [local, setLocal] = useState<CalCategory[]>(categories)
  const [newLabel, setNewLabel] = useState('')
  useEffect(() => { setLocal(categories); setNewLabel('') }, [categories, open])

  const upd = (value: string, field: keyof CalCategory, val: string) =>
    setLocal(prev => prev.map(c => c.value === value ? { ...c, [field]: val } : c))
  const del = (value: string) =>
    setLocal(prev => prev.filter(c => c.value !== value))
  const add = () => {
    const label = newLabel.trim()
    if (!label) return
    const value = slugify(label)
    if (local.some(c => c.value === value)) return
    setLocal(prev => [...prev, { value, label, color: PRESET_COLORS[prev.length % PRESET_COLORS.length] }])
    setNewLabel('')
  }

  return (
    <Modal open={open} onClose={onClose} title="Event Categories" size="sm">
      <div className="p-4 space-y-2">
        <p className="text-xs text-text-muted mb-3">
          Customize the categories and colors for your calendar events.
          Built-in categories can be recolored but not deleted.
        </p>

        {local.map(cat => {
          const isPreset = PRESET_COLORS.includes(cat.color)
          return (
            <div key={cat.value} className="flex items-center gap-2.5 rounded-lg px-3 py-2.5"
              style={{ background: cat.color + '0d', border: `1px solid ${cat.color}25` }}>
              {/* Color swatch + picker */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {PRESET_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => upd(cat.value, 'color', c)}
                    className="w-4 h-4 rounded-full flex-shrink-0 transition-transform hover:scale-110"
                    style={{ background: c, boxShadow: cat.color === c ? `0 0 0 1.5px #0e0e1a, 0 0 0 3px ${c}` : 'none' }} />
                ))}
                {/* Custom */}
                <label className="w-4 h-4 rounded-full cursor-pointer flex-shrink-0 transition-transform hover:scale-110"
                  title="Custom colour"
                  style={{ background: isPreset ? 'var(--c-border-mid)' : cat.color, border: isPreset ? '1px dashed var(--c-border-strong)' : 'none', boxShadow: !isPreset ? `0 0 0 1.5px #0e0e1a, 0 0 0 3px ${cat.color}` : 'none' }}>
                  <input type="color" className="sr-only" value={cat.color}
                    onChange={e => upd(cat.value, 'color', e.target.value)} />
                </label>
              </div>

              {/* Label */}
              <input
                value={cat.label}
                onChange={e => upd(cat.value, 'label', e.target.value)}
                className="flex-1 bg-transparent text-sm text-text-primary outline-none border-b border-transparent focus:border-white/20 transition-colors min-w-0"
                placeholder="Category name"
              />

              {/* Slug badge */}
              <span className="text-[10px] text-text-muted font-mono flex-shrink-0">{cat.value}</span>

              {/* Delete (custom only) */}
              {!cat.builtin
                ? <button onClick={() => del(cat.value)} className="flex-shrink-0 text-text-muted hover:text-red-400 transition-colors p-0.5"><Trash2 size={12} /></button>
                : <span className="w-4 flex-shrink-0" />
              }
            </div>
          )
        })}

        {/* Add new */}
        <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--c-border)' }}>
          <input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="New category name…"
            className="flex-1 bg-transparent text-sm text-text-primary outline-none border-b border-white/10 focus:border-white/25 transition-colors pb-0.5"
          />
          <button onClick={add} disabled={!newLabel.trim()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-all disabled:opacity-30"
            style={{ background: 'rgba(129,140,248,0.15)', color: '#818cf8', border: '1px solid rgba(129,140,248,0.25)' }}>
            <Plus size={11} /> Add
          </button>
        </div>

        <div className="flex justify-end pt-3">
          <button onClick={() => { onSave(local); onClose() }}
            className="px-4 py-1.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,#818cf8,#a78bfa)' }}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── SessionConfigModal ───────────────────────────────────────────────────────
const SESSION_PRESET_COLORS = PRESET_COLORS

function SessionConfigModal({
  open, onClose, sessions, onSave,
}: { open: boolean; onClose: () => void; sessions: TradingSession[]; onSave: (s: TradingSession[]) => void }) {
  const [local, setLocal] = useState<TradingSession[]>(sessions)
  // Keep local in sync if parent sessions change while closed
  useEffect(() => { setLocal(sessions) }, [sessions])

  const upd = (id: string, field: keyof TradingSession, value: any) =>
    setLocal(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s))

  const save = () => { onSave(local); onClose() }

  const SESSION_META: Record<string, { region: string; desc: string }> = {
    nyse:   { region: 'New York',  desc: 'US equities, NQ futures, S&P 500' },
    london: { region: 'London',    desc: 'European equities, forex majors' },
    asia:   { region: 'Tokyo / Hong Kong', desc: 'Asian indices, crypto, JPY pairs' },
  }

  return (
    <Modal open={open} onClose={onClose} title="Trading Sessions" size="sm">
      <div className="p-4 space-y-3">
        <p className="text-xs text-text-muted mb-1">
          Session bands appear as coloured overlays in the time grid when the Plans layer is on.
          Times are in your local timezone.
        </p>
        {local.map(s => {
          const meta = SESSION_META[s.id]
          const isPreset = SESSION_PRESET_COLORS.includes(s.color)
          return (
            <div key={s.id} className="rounded-xl p-3.5 space-y-3"
              style={{ background: s.enabled ? s.color + '0a' : 'var(--c-bg-input)', border: `1px solid ${s.enabled ? s.color + '30' : 'var(--c-border)'}` }}>
              {/* Header row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <div>
                    <p className="text-sm font-bold text-text-primary">{s.name}</p>
                    <p className="text-[11px] text-text-muted">{meta?.region}</p>
                  </div>
                </div>
                {/* Toggle */}
                <label className="relative cursor-pointer flex-shrink-0">
                  <input type="checkbox" className="sr-only" checked={s.enabled}
                    onChange={e => upd(s.id, 'enabled', e.target.checked)} />
                  <div className="w-9 h-5 rounded-full transition-colors relative"
                    style={{ background: s.enabled ? s.color : 'var(--c-border-mid)' }}>
                    <div className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
                      style={{ transform: s.enabled ? 'translateX(20px)' : 'translateX(2px)' }} />
                  </div>
                </label>
              </div>
              {/* Colour picker */}
              <div className={!s.enabled ? 'opacity-30 pointer-events-none' : ''}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Colour</p>
                <div className="flex items-center gap-1.5">
                  {SESSION_PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => upd(s.id, 'color', c)}
                      className="w-5 h-5 rounded-full transition-transform hover:scale-110 flex-shrink-0"
                      style={{
                        background: c,
                        boxShadow: s.color === c ? `0 0 0 2px #0e0e1a, 0 0 0 3.5px ${c}` : 'none',
                      }}
                    />
                  ))}
                  {/* Custom colour input */}
                  <label
                    className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer flex-shrink-0 transition-transform hover:scale-110"
                    title="Custom colour"
                    style={{
                      background: isPreset ? 'var(--c-border-mid)' : s.color,
                      boxShadow: !isPreset ? `0 0 0 2px #0e0e1a, 0 0 0 3.5px ${s.color}` : 'none',
                      border: isPreset ? '1px dashed var(--c-border-strong)' : 'none',
                    }}
                  >
                    <input
                      type="color"
                      value={s.color}
                      onChange={e => upd(s.id, 'color', e.target.value)}
                      className="sr-only"
                    />
                    {isPreset && <span className="text-[10px] text-white/40 leading-none select-none">+</span>}
                  </label>
                </div>
              </div>
              {/* Times */}
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted block mb-1">Open</label>
                  <input
                    type="time"
                    value={s.start}
                    disabled={!s.enabled}
                    onChange={e => upd(s.id, 'start', e.target.value)}
                    className="w-full rounded-lg px-2.5 py-1.5 text-sm text-text-primary outline-none transition-all disabled:opacity-35"
                    style={{ background: 'var(--c-bg-input)', border: `1px solid ${s.enabled ? s.color + '40' : 'var(--c-border-mid)'}` }}
                  />
                </div>
                <div className="mt-5 text-text-muted text-lg font-light">→</div>
                <div className="flex-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted block mb-1">Close</label>
                  <input
                    type="time"
                    value={s.end}
                    disabled={!s.enabled}
                    onChange={e => upd(s.id, 'end', e.target.value)}
                    className="w-full rounded-lg px-2.5 py-1.5 text-sm text-text-primary outline-none transition-all disabled:opacity-35"
                    style={{ background: 'var(--c-bg-input)', border: `1px solid ${s.enabled ? s.color + '40' : 'var(--c-border-mid)'}` }}
                  />
                </div>
              </div>
              {s.enabled && meta?.desc && (
                <p className="text-[10px] text-text-muted">{meta.desc}</p>
              )}
            </div>
          )
        })}
        <div className="flex justify-between items-center pt-2 border-t border-bg-border">
          <button onClick={() => setLocal(DEFAULT_SESSIONS)} className="text-xs text-text-muted hover:text-text-secondary transition-colors">
            Reset to defaults
          </button>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="button" onClick={save}>Save</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── IntelSection ─────────────────────────────────────────────────────────────
function IntelSection({ color, icon, title, summary, defaultOpen = false, children }: {
  color: string; icon: React.ReactNode; title: string; summary: string; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-3 py-2.5 transition-colors text-left"
        style={{ background: open ? color + '0e' : 'var(--c-bg-input)' }}>
        <div className="flex items-center gap-2">
          <span style={{ color }}>{icon}</span>
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color }}>{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-muted">{summary}</span>
          <ChevronRight size={11} className="text-text-muted flex-shrink-0 transition-transform"
            style={{ transform: open ? 'rotate(90deg)' : 'none' }} />
        </div>
      </button>
      {open && (
        <div className="px-3 py-2.5" style={{ borderTop: '1px solid var(--c-border-subtle)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─── ViewSegment ──────────────────────────────────────────────────────────────
function ViewSegment({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const views: ViewMode[] = ['day', 'week', 'month', 'year']
  return (
    <div className="flex items-center p-0.5 rounded-lg" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)' }}>
      {views.map(v => (
        <button key={v} onClick={() => onChange(v)}
          className="px-3 py-1.5 text-xs font-semibold capitalize rounded-md transition-all"
          style={{
            background: view === v ? 'rgba(129,140,248,0.85)' : 'transparent',
            color:      view === v ? '#fff' : 'rgba(139,139,170,0.9)',
          }}>
          {v}
        </button>
      ))}
    </div>
  )
}

// ─── CalendarPage ─────────────────────────────────────────────────────────────
export function CalendarPage() {
  const [view,         setView]         = useState<ViewMode>('day')
  const [selDay,       setSelDay]       = useState<Date>(() => new Date())
  const [layers,       setLayers]       = useState(loadLayers)
  const [sessions,     setSessions]     = useState<TradingSession[]>(loadSessions)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [categories,   setCategories]   = useState<CalCategory[]>(loadCategories)
  const [catsOpen,     setCatsOpen]     = useState(false)
  const [createOpen,   setCreateOpen]   = useState(false)
  const [,             setTick]         = useState(0)   // minute ticker → keeps now-line live
  const gridRef  = useRef<HTMLDivElement>(null)
  const wGridRef = useRef<HTMLDivElement>(null)

  useEffect(() => { localStorage.setItem(LAYERS_KEY, JSON.stringify(layers)) }, [layers])

  // Re-render every minute so the now-line stays accurate
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const saveSessions = (next: TradingSession[]) => {
    setSessions(next)
    localStorage.setItem(SESSION_KEY, JSON.stringify(next))
  }
  const saveCategories_ = (next: CalCategory[]) => {
    setCategories(next)
    saveCategories(next)
  }
  // Live CAT map derived from persisted categories
  const CAT = catMap(categories)

  const toggleLayer = (k: keyof typeof layers) => setLayers((p: typeof layers) => ({ ...p, [k]: !p[k] }))

  // ── Navigation ────────────────────────────────────────────────────────────
  const navigate = (dir: 1 | -1) => {
    setSelDay(d => {
      switch (view) {
        case 'day':   return addDays(d, dir)
        case 'week':  return addDays(d, dir * 7)
        case 'month': return dir > 0 ? addMonths(d, 1) : subMonths(d, 1)
        case 'year':  return dir > 0 ? addYears(d, 1) : subYears(d, 1)
      }
    })
  }

  // ── Derived ranges ────────────────────────────────────────────────────────
  const weekStart = startOfWeek(selDay, { weekStartsOn: 1 })
  const weekEnd   = endOfWeek(selDay,   { weekStartsOn: 1 })
  const weekDays  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const wFrom     = format(weekStart, 'yyyy-MM-dd')
  const wTo       = format(weekEnd,   'yyyy-MM-dd')

  const mStart = startOfMonth(selDay)
  const mEnd   = endOfMonth(selDay)
  const mFrom  = format(mStart, 'yyyy-MM-dd')
  const mTo    = format(mEnd,   'yyyy-MM-dd')

  const yStart = startOfYear(selDay)
  const yEnd   = endOfYear(selDay)
  const yFrom  = format(yStart, 'yyyy-MM-dd')
  const yTo    = format(yEnd,   'yyyy-MM-dd')

  const rangeFrom = view === 'year' ? yFrom : view === 'month' ? mFrom : wFrom
  const rangeTo   = view === 'year' ? yTo   : view === 'month' ? mTo   : wTo
  const selStr    = format(selDay, 'yyyy-MM-dd')

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: events        = [] } = useCalendarEvents({ from: rangeFrom + 'T00:00', to: rangeTo + 'T23:59' })
  const { data: rangeTrades   = [] } = useTrades({ from: rangeFrom, to: rangeTo })
  const { data: allWorkouts   = [] } = useWorkouts()
  const { data: weekSchedule  = [] } = useWeeklySchedule(wFrom)
  const { data: allInvoices   = [] } = useInvoices()
  const { data: allMeetings   = [] } = useMeetingNotes()
  const { data: allClients    = [] } = useClients()
  const { data: allProjects   = [] } = useProjects()
  const { data: allGoals      = [] } = useGoals()
  const { data: rangeExpenses = [] } = useFinanceExpenses({ from: rangeFrom, to: rangeTo })
  const { data: rangeIncome   = [] } = useFinanceIncome({ from: rangeFrom, to: rangeTo })
  const { data: chkEntries    = [] } = useChecklistEntries(view === 'day' ? selStr : '')

  // ── Day slices (day view only) ────────────────────────────────────────────
  const dayEvents   = (events       as any[]).filter(e => e.startDatetime?.startsWith(selStr))
  const dayTrades   = (rangeTrades  as any[]).filter(t => t.date === selStr)
  const dayWorkouts = (allWorkouts  as any[]).filter(w => w.date === selStr)
  const dayInvDue   = (allInvoices  as any[]).filter(i => i.dueDate === selStr && ['unpaid','overdue'].includes(i.status))
  const dayMeetings = (allMeetings  as any[]).filter(n => n.meetingDate === selStr)
  const dayExpenses = (rangeExpenses as any[]).filter(e => e.date === selStr)
  const dayIncome   = (rangeIncome  as any[]).filter(i => i.date === selStr)
  const dayPnl      = dayTrades.reduce((s: number, t: any) => s + (t.realizedPnl ?? 0), 0)
  const timedItems  = useMemo(() =>
    (chkEntries as any[]).flatMap(e => (e.items ?? []).filter((it: any) => it.time)
      .map((it: any) => ({ ...it, entryId: e.id, templateName: e.template?.name ?? '' }))), [chkEntries])
  const selDow      = (getDay(selDay) + 6) % 7
  const plannedWod  = (weekSchedule as any[]).find(s => s.dayOfWeek === selDow)

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const upcomingInv = (allInvoices as any[])
    .filter(i => i.dueDate > todayStr && i.dueDate <= format(addDays(new Date(), 14), 'yyyy-MM-dd') && ['unpaid','overdue'].includes(i.status))
    .sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate))

  const goalDeadlines = useMemo(() => {
    const map: Record<string, any[]> = {}
    ;(allGoals as any[]).filter(g => g.periodEnd && g.status === 'active').forEach(g => {
      ;(map[g.periodEnd] ??= []).push(g)
    })
    return map
  }, [allGoals])

  // Activity indicators helper
  const actFor = (day: Date) => {
    const d = format(day, 'yyyy-MM-dd')
    return {
      trades:   (rangeTrades  as any[]).some(t => t.date === d),
      workout:  (allWorkouts  as any[]).some(w => w.date === d),
      invoices: (allInvoices  as any[]).some(i => i.dueDate === d && ['unpaid','overdue'].includes(i.status)),
      events:   (events       as any[]).some(e => e.startDatetime?.startsWith(d)),
      goal:     !!goalDeadlines[d]?.length,
    }
  }
  const eventsForDay = (day: Date) =>
    (events as any[]).filter(e => e.startDatetime?.startsWith(format(day, 'yyyy-MM-dd')))

  // ── Event form ────────────────────────────────────────────────────────────
  const { register, handleSubmit, watch, reset } = useForm({
    defaultValues: { title:'', description:'', startDatetime:'', endDatetime:'', allDay:false, category:'personal', clientId:'', projectId:'' }
  })
  const watchCat = watch('category'), watchClient = watch('clientId')
  const clientProjects = watchClient ? (allProjects as any[]).filter(p => p.clientId === parseInt(watchClient)) : []

  const toggleItem = useToggleChecklistItem()

  const openAtSlot = (date: string, hour: number, minute: number = 0) => {
    const hh  = String(hour).padStart(2, '0')
    const mm  = String(minute).padStart(2, '0')
    const endMin  = minute + 15
    const endHour = endMin >= 60 ? Math.min(hour + 1, 23) : hour
    const endMm   = String(endMin >= 60 ? 0 : endMin).padStart(2, '0')
    const endHh   = String(endHour).padStart(2, '0')
    reset({ title:'', description:'', startDatetime:`${date}T${hh}:${mm}`, endDatetime:`${date}T${endHh}:${endMm}`, category:'personal', clientId:'', projectId:'' })
    setCreateOpen(true)
  }
  const { mutateAsync: createEvent } = useCreateEvent()
  const { mutate: deleteEvent }      = useDeleteEvent()
  const onSubmit = async (data: any) => {
    if (watchCat === 'business' && data.clientId) {
      try {
        const { api } = await import('../../lib/api')
        await api.post('/api/business/meeting-notes', { title: data.title, meetingDate: data.startDatetime.split('T')[0], clientId: parseInt(data.clientId), projectId: data.projectId ? parseInt(data.projectId) : null, content: data.description || '' })
      } catch { /* non-fatal */ }
    }
    await createEvent({ ...data, allDay: data.allDay ? 1 : 0, clientId: undefined, projectId: undefined })
    setCreateOpen(false)
  }

  // Scroll to now on day/week change
  useEffect(() => {
    if (view !== 'day' && view !== 'week') return
    const ref = view === 'week' ? wGridRef.current : gridRef.current
    const pct = nowPct()
    // Scroll so the now-line is ~2 hours below the visible top edge
    if (ref && pct !== null) ref.scrollTop = Math.max((pct / 100) * GRID_H - 2 * ROW_H, 0)
  }, [view, selStr])

  // ── Layer pill ────────────────────────────────────────────────────────────
  const LP = ({ k, label }: { k: keyof typeof layers; label: string }) => (
    <button onClick={() => toggleLayer(k)}
      className="text-[10px] font-semibold px-2 py-0.5 rounded transition-all"
      style={{ background: layers[k] ? 'rgba(129,140,248,0.18)' : 'var(--c-bg-input)', color: layers[k] ? '#818cf8' : 'rgba(139,139,170,0.55)', border: layers[k] ? '1px solid rgba(129,140,248,0.25)' : '1px solid var(--c-border-subtle)' }}>
      {label}
    </button>
  )

  // ── Shared header title ───────────────────────────────────────────────────
  const titleStr = view === 'day'   ? format(selDay, 'EEEE, MMMM d, yyyy')
                 : view === 'week'  ? `${format(weekStart, 'MMM d')} to ${format(weekEnd, 'MMM d, yyyy')}`
                 : view === 'month' ? format(selDay, 'MMMM yyyy')
                 :                   format(selDay, 'yyyy')

  // ── Shared time-grid renderer (used by Day and Week views) ────────────────
  const renderTimeGrid = (
    columns: { day: Date; events: any[]; timedItems?: any[]; isToday: boolean }[],
    onSlotClick: (date: string, hour: number, minute?: number) => void,
    scrollRef: React.RefObject<HTMLDivElement>,
    showIntel = false,
  ) => {
    const multiCol = columns.length > 1
    return (
      <div className="rounded-xl overflow-hidden flex flex-col" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
        {/* Column headers */}
        {multiCol && (
          <div className="flex border-b" style={{ borderColor: 'var(--c-border)', paddingLeft: LABEL_W }}>
            {columns.map(({ day, isToday }) => {
              const isSelDay = isSameDay(day, selDay)
              const act = actFor(day)
              return (
                <div key={day.toISOString()}
                  onClick={() => { setSelDay(day); setView('day') }}
                  className="flex-1 text-center py-2 cursor-pointer hover:bg-bg-hover/10 transition-colors border-l"
                  style={{ borderColor: 'var(--c-border-subtle)' }}>
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${isToday ? 'text-accent-blue' : 'text-text-muted'}`}>{format(day, 'EEE')}</p>
                  <div className={`text-base num font-bold mx-auto w-7 h-7 flex items-center justify-center rounded-full ${isToday ? 'text-white' : isSelDay ? 'text-accent-blue' : 'text-text-secondary'}`}
                    style={{ background: isToday ? '#818cf8' : undefined }}>
                    {format(day, 'd')}
                  </div>
                  <div className="flex gap-0.5 justify-center mt-1" style={{ minHeight: 6 }}>
                    {act.trades   && <span className="w-1 h-1 rounded-full" style={{ background: M.trading }} />}
                    {act.workout  && <span className="w-1 h-1 rounded-full" style={{ background: M.fitness }} />}
                    {act.events   && <span className="w-1 h-1 rounded-full" style={{ background: M.business }} />}
                    {act.goal     && <span className="w-1 h-1 rounded-full" style={{ background: M.goals }} />}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Layer toggles (day view only) */}
        {!multiCol && (
          <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
            <div className="flex items-center gap-1.5">
              <button onClick={() => navigate(-1)} className="p-1 rounded hover:bg-bg-hover text-text-muted transition-colors"><ChevronLeft size={13} /></button>
              <div>
                <p className="text-sm font-semibold text-text-primary">{format(selDay, 'EEEE, MMMM d')}</p>
                {columns[0]?.isToday && <p className="text-[11px] mt-0" style={{ color: '#818cf8' }}>{new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} <span className="text-text-muted">now</span></p>}
              </div>
              <button onClick={() => navigate(1)} className="p-1 rounded hover:bg-bg-hover text-text-muted transition-colors"><ChevronRight size={13} /></button>
            </div>
            <div className="flex items-center gap-1.5">
              <Layers size={10} className="text-text-muted" />
              <LP k="events" label="Events" />
              <LP k="schedule" label="Checklist" />
              <LP k="plans" label="Plans" />
              <button
                onClick={() => setCatsOpen(true)}
                title="Configure event categories"
                className="p-1 rounded-md transition-all"
                style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#a78bfa'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(167,139,250,0.3)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border)' }}
              >
                <Palette size={11} />
              </button>
              <button
                onClick={() => setSessionsOpen(true)}
                title="Configure trading sessions"
                className="p-1 rounded-md transition-all"
                style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#818cf8'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(129,140,248,0.3)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border)' }}
              >
                <Settings2 size={11} />
              </button>
            </div>
          </div>
        )}

        {/* Grid */}
        <div ref={scrollRef} className="overflow-y-auto flex-1" style={{ maxHeight: multiCol ? 560 : 600 }}>
          <div className="relative flex" style={{ height: GRID_H }}>
            {/* Hour labels */}
            <div className="relative flex-shrink-0 pointer-events-none" style={{ width: LABEL_W }}>
              {Array.from({ length: HOURS_SHOWN }, (_, i) => (
                <div key={i} className="absolute w-full text-right pr-2.5" style={{ top: i * ROW_H - 9 }}>
                  <span className="text-[11px] num" style={{ color: 'rgba(139,139,170,0.55)' }}>
                    {String(GRID_START + i).padStart(2, '0')}:00
                  </span>
                </div>
              ))}
            </div>

            {/* Columns */}
            <div className="flex-1 relative flex" id="cal-cols">
              {columns.map(({ day, events: colEvents, timedItems: colItems, isToday }, ci) => {
                const dateStr = format(day, 'yyyy-MM-dd')
                // (now-line rendered at outer grid level below)
                return (
                  <div key={day.toISOString()}
                    className="flex-1 relative border-l"
                    style={{ borderColor: 'var(--c-border-subtle)', minWidth: 0 }}>
                    {/* 15-minute slot rows (click targets + grid lines) */}
                    {Array.from({ length: HOURS_SHOWN * 4 }, (_, i) => {
                      const slotH   = ROW_H / 4
                      const hour    = GRID_START + Math.floor(i / 4)
                      const minute  = (i % 4) * 15
                      const isHour  = minute === 0
                      const isHalf  = minute === 30
                      return (
                        <div key={i} className="absolute w-full cursor-pointer group"
                          style={{ top: i * slotH, height: slotH }}
                          onClick={() => onSlotClick(dateStr, hour, minute)}>
                          {/* Top border — thicker/brighter on the hour, subtle at :30, hairline at :15/:45 */}
                          <div className="absolute inset-x-0 top-0" style={{
                            borderTop: isHour
                              ? '1px solid var(--c-border)'
                              : isHalf
                                ? '1px solid var(--c-border-subtle)'
                                : '1px solid transparent',
                          }} />
                          {/* Hover highlight */}
                          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(129,140,248,0.04)', borderRadius: 3 }} />
                        </div>
                      )
                    })}

                    {/* Trading session bands (Plans layer) */}
                    {layers.plans && isWeekday(day) && sessions.filter(s => s.enabled).map(s => {
                      const startH = hhmm(s.start)
                      const endH   = hhmm(s.end)
                      if (startH === null || endH === null) return null
                      // Clamp to visible grid; handle overnight sessions (end < start)
                      const visStart = Math.max(startH < endH ? startH : GRID_START, GRID_START)
                      const visEnd   = Math.min(startH < endH ? endH   : GRID_END,   GRID_END)
                      if (visStart >= visEnd) return null
                      const topPct = ((visStart - GRID_START) / HOURS_SHOWN) * 100
                      const hPct   = ((visEnd - visStart)     / HOURS_SHOWN) * 100
                      return (
                        <div key={s.id} className="absolute pointer-events-none"
                          style={{ top: `${topPct}%`, height: `${hPct}%`, left: 0, right: 0, background: s.color + '09', borderLeft: `2px solid ${s.color}2e` }}>
                          {ci === 0 && (
                            <span className="text-[9px] font-bold ml-1.5 mt-0.5 block truncate"
                              style={{ color: s.color + '70' }}>
                              {s.name}
                            </span>
                          )}
                        </div>
                      )
                    })}

                    {/* Checklist timed items (schedule layer) */}
                    {layers.schedule && (colItems ?? []).map((item: any, idx: number) => {
                      const pct = timeToPct(item.time)
                      if (pct < 0 || pct > 100) return null
                      const col = item.completed ? 'var(--c-border-strong)' : (IMP[item.importance] ?? '#818cf8')
                      return (
                        <div key={`chk-${item.id ?? idx}`} className="absolute z-10 flex items-center gap-1 rounded"
                          style={{ left: 2, right: 2, top: `${pct}%`, height: 20, background: item.completed ? 'var(--c-bg-input)' : (IMP[item.importance] ?? '#818cf8') + '14', borderLeft: `2px solid ${item.completed ? 'var(--c-border-mid)' : (IMP[item.importance] ?? '#818cf8')}`, opacity: item.completed ? 0.5 : 1 }}>
                          {/* Apple-style circle toggle */}
                          <button
                            className="flex-shrink-0 ml-1.5 rounded-full transition-all"
                            style={{
                              width: 11, height: 11,
                              border: `1.5px solid ${col}`,
                              background: item.completed ? col : 'transparent',
                            }}
                            onClick={e => {
                              e.stopPropagation()
                              if (item.entryId && item.id != null)
                                toggleItem.mutate({ entryId: item.entryId, itemId: item.id, completed: !item.completed })
                            }}
                            title={item.completed ? 'Mark incomplete' : 'Mark complete'}
                          />
                          <span className={`text-[10px] font-medium truncate ${item.completed ? 'text-text-muted line-through' : 'text-text-primary'}`}>{item.label}</span>
                        </div>
                      )
                    })}

                    {/* Calendar events (events layer) */}
                    {layers.events && colEvents.map((ev: any) => {
                      const top  = dtToPct(ev.startDatetime)
                      const hPct = durPct(ev.startDatetime, ev.endDatetime)
                      if (top < -2 || top > 102) return null
                      const col = CAT[ev.category] ?? '#818cf8'
                      return (
                        <div key={ev.id} className="absolute z-20 rounded group overflow-hidden"
                          onClick={e => e.stopPropagation()}
                          style={{ left: 2, right: 2, top: `${Math.max(top, 0)}%`, height: `${Math.max(hPct, 2)}%`, background: col + '1c', borderLeft: `3px solid ${col}` }}>
                          <div className="px-1.5 py-0.5 h-full overflow-hidden">
                            <p className="text-[11px] font-semibold truncate leading-tight" style={{ color: col }}>{ev.title}</p>
                            {hPct > 5 && <p className="text-[10px] truncate" style={{ color: col + 'aa' }}>{fmtTime(ev.startDatetime)}</p>}
                          </div>
                          <button onClick={() => deleteEvent(ev.id)} className="hidden group-hover:flex absolute top-0.5 right-1 text-[11px]"
                            style={{ color: 'var(--c-text-3)' }} onMouseEnter={e => (e.currentTarget.style.color='#f87171')} onMouseLeave={e => (e.currentTarget.style.color='var(--c-text-3)')}>×</button>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            {/* ── Apple-style "Now" indicator ──────────────────────────── */}
            {/* Positioned in the outer flex container so the time pill     */}
            {/* sits in the gutter and the line spans all columns.          */}
            {columns.some(c => c.isToday) && (() => {
              const pct = nowPct()
              if (pct === null) return null
              const n       = new Date()
              const hh      = String(n.getHours()).padStart(2, '0')
              const mm      = String(n.getMinutes()).padStart(2, '0')
              const timeStr = `${hh}:${mm}`
              return (
                <div className="absolute inset-x-0 z-40 pointer-events-none flex items-center"
                  style={{ top: `${pct}%`, transform: 'translateY(-50%)' }}>
                  {/* Time pill in the gutter */}
                  <div className="flex-shrink-0 flex items-center justify-end pr-1.5"
                    style={{ width: LABEL_W }}>
                    <span className="text-[10px] font-bold text-white num rounded-full px-1.5 py-[2px]"
                      style={{ background: '#ef4444', letterSpacing: '0.02em', lineHeight: 1.5 }}>
                      {timeStr}
                    </span>
                  </div>
                  {/* Solid red line across all columns */}
                  <div className="flex-1" style={{ height: 2, background: '#ef4444', opacity: 0.85 }} />
                </div>
              )
            })()}
          </div>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  HEADER (shared)
  // ─────────────────────────────────────────────────────────────────────────
  const pageAction = (
    <div className="flex items-center gap-3">
      {/* View mode segmented control */}
      <ViewSegment view={view} onChange={setView} />
      {/* Navigation */}
      <div className="flex items-center gap-1">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"><ChevronLeft size={15} /></button>
        <span className="text-sm font-medium text-text-secondary min-w-52 text-center num">{titleStr}</span>
        <button onClick={() => navigate(1)} className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"><ChevronRight size={15} /></button>
      </div>
      <button onClick={() => { setSelDay(new Date()) }} className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors" style={{ background: 'rgba(129,140,248,0.12)', color: '#818cf8' }}>Today</button>
      <button onClick={() => { reset(); setCreateOpen(true) }} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold text-white" style={{ background: 'linear-gradient(135deg, #818cf8, #a78bfa)' }}><Plus size={13} /> New Event</button>
    </div>
  )

  // ─────────────────────────────────────────────────────────────────────────
  //  YEAR VIEW
  // ─────────────────────────────────────────────────────────────────────────
  if (view === 'year') {
    const months = eachMonthOfInterval({ start: yStart, end: yEnd })
    return (
      <PageShell title="Calendar" action={pageAction}>
        <div className="grid grid-cols-4 gap-4">
          {months.map(monthDate => {
            const mDays  = eachDayOfInterval({ start: startOfMonth(monthDate), end: endOfMonth(monthDate) })
            const padDow = (getDay(startOfMonth(monthDate)) + 6) % 7
            const padded = [...Array(padDow).fill(null), ...mDays]
            const isCurMo = format(monthDate, 'yyyy-MM') === format(selDay, 'yyyy-MM')
            return (
              <div key={monthDate.toISOString()}
                className="rounded-xl p-3 cursor-pointer transition-all hover:scale-[1.01]"
                onClick={() => { setSelDay(startOfMonth(monthDate)); setView('month') }}
                style={{ background: isCurMo ? 'rgba(129,140,248,0.07)' : 'var(--c-bg-input)', border: isCurMo ? '1px solid rgba(129,140,248,0.3)' : '1px solid var(--c-border-subtle)' }}>
                <h3 className="text-sm font-bold mb-2" style={{ color: isCurMo ? '#818cf8' : 'rgba(238,238,245,0.9)' }}>{format(monthDate, 'MMMM')}</h3>
                <div className="grid grid-cols-7 gap-px mb-1">
                  {['M','T','W','T','F','S','S'].map((d, i) => (
                    <div key={i} className="text-center text-[9px] font-semibold" style={{ color: 'rgba(139,139,170,0.5)' }}>{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-px">
                  {padded.map((day, i) => {
                    if (!day) return <div key={`p${i}`} />
                    const isToday  = isSameDay(day as Date, new Date())
                    const act      = actFor(day as Date)
                    const hasAct   = act.trades || act.workout || act.invoices || act.events || act.goal
                    return (
                      <div key={(day as Date).toISOString()}
                        onClick={e => { e.stopPropagation(); setSelDay(day as Date); setView('day') }}
                        className="relative flex flex-col items-center justify-center rounded"
                        style={{ height: 22, background: isToday ? '#818cf8' : undefined }}>
                        <span className="text-[10px] num" style={{ color: isToday ? 'white' : 'rgba(238,238,245,0.7)' }}>{format(day as Date, 'd')}</span>
                        {hasAct && !isToday && (
                          <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                            style={{ background: act.trades ? M.trading : act.workout ? M.fitness : act.goal ? M.goals : '#818cf8' }} />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </PageShell>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  MONTH VIEW
  // ─────────────────────────────────────────────────────────────────────────
  if (view === 'month') {
    const mDays  = eachDayOfInterval({ start: mStart, end: mEnd })
    const padDow = (getDay(mStart) + 6) % 7
    const padded = [...Array(padDow).fill(null), ...mDays]
    return (
      <PageShell title="Calendar" action={pageAction}>
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
          <div className="grid grid-cols-7" style={{ background: 'var(--c-bg-input)', borderBottom: '1px solid var(--c-border)' }}>
            {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
              <div key={d} className="text-center text-[11px] font-bold uppercase tracking-widest py-2.5 text-text-muted">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {padded.map((day, i) => {
              if (!day) return <div key={`p${i}`} style={{ borderRight: '1px solid var(--c-border-subtle)', borderBottom: '1px solid var(--c-border-subtle)', minHeight: 100 }} />
              const d       = day as Date
              const dStr    = format(d, 'yyyy-MM-dd')
              const isToday = isSameDay(d, new Date())
              const isSel   = isSameDay(d, selDay)
              const isPast  = d < new Date() && !isToday
              const dayEvts = eventsForDay(d)
              const act     = actFor(d)
              const hasGoal = !!goalDeadlines[dStr]?.length
              return (
                <div key={dStr}
                  onClick={() => { setSelDay(d); setView('day') }}
                  className="cursor-pointer p-2 transition-colors hover:bg-bg-hover/10"
                  style={{ borderRight: '1px solid var(--c-border-subtle)', borderBottom: '1px solid var(--c-border-subtle)', minHeight: 100, background: isToday ? 'rgba(129,140,248,0.05)' : isSel ? 'var(--c-bg-input)' : undefined }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-sm num font-bold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'text-white' : isPast ? 'text-text-muted/50' : 'text-text-primary'}`}
                      style={{ background: isToday ? '#818cf8' : undefined }}>
                      {format(d, 'd')}
                    </span>
                    <div className="flex gap-0.5 items-center">
                      {act.trades  && <span className="w-1.5 h-1.5 rounded-full" style={{ background: M.trading }} />}
                      {act.workout && <span className="w-1.5 h-1.5 rounded-full" style={{ background: M.fitness }} />}
                      {hasGoal     && <Target size={9} style={{ color: M.goals }} />}
                    </div>
                  </div>
                  {/* Event pills */}
                  <div className="space-y-0.5">
                    {dayEvts.slice(0, 3).map((ev: any) => {
                      const col = CAT[ev.category] ?? '#818cf8'
                      return (
                        <div key={ev.id} className="flex items-center gap-1 px-1 py-0.5 rounded" style={{ background: col + '18' }}
                          onClick={e => e.stopPropagation()}>
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: col }} />
                          <span className="text-[10px] font-medium truncate" style={{ color: col }}>{ev.title}</span>
                          {!ev.allDay && <span className="text-[10px] text-text-muted flex-shrink-0 ml-auto">{fmtTime(ev.startDatetime)}</span>}
                        </div>
                      )
                    })}
                    {dayEvts.length > 3 && (
                      <p className="text-[10px] text-text-muted px-1">+{dayEvts.length - 3} more</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </PageShell>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  WEEK VIEW  (7-column time grid)
  // ─────────────────────────────────────────────────────────────────────────
  if (view === 'week') {
    const weekCols = weekDays.map(day => ({
      day,
      isToday: isSameDay(day, new Date()),
      events:  eventsForDay(day),
      timedItems: [],
    }))
    return (
      <PageShell title="Calendar" action={pageAction}>
        {renderTimeGrid(weekCols, openAtSlot, wGridRef, false)}
        <CategoryConfigModal open={catsOpen} onClose={() => setCatsOpen(false)} categories={categories} onSave={saveCategories_} />
        <SessionConfigModal open={sessionsOpen} onClose={() => setSessionsOpen(false)} sessions={sessions} onSave={saveSessions} />
        <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Event">
          <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-3">
            <Input label="Title" placeholder="Event title..." {...register('title', { required: true })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Start" type="datetime-local" {...register('startDatetime', { required: true })} />
              <Input label="End"   type="datetime-local" {...register('endDatetime')} />
            </div>
            <Select label="Category" options={categories.map(c => ({ value: c.value, label: c.label }))} {...register('category')} />
            <Textarea label="Notes" rows={2} {...register('description')} />
            <div className="flex justify-end gap-3 pt-2 border-t border-bg-border">
              <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit">Create Event</Button>
            </div>
          </form>
        </Modal>
      </PageShell>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  DAY VIEW  (schedule + intel panel)
  // ─────────────────────────────────────────────────────────────────────────
  const dayCol = [{ day: selDay, isToday: isSameDay(selDay, new Date()), events: dayEvents, timedItems }]

  return (
    <PageShell title="Calendar" action={pageAction}>

      {/* Compact week strip for context */}
      <div className="grid grid-cols-7 gap-1.5 mb-4">
        {weekDays.map((day, i) => {
          const isToday  = isSameDay(day, new Date())
          const isSel    = isSameDay(day, selDay)
          const isPast   = day < new Date() && !isToday
          const act      = actFor(day)
          const dStr     = format(day, 'yyyy-MM-dd')
          return (
            <button key={i} onClick={() => setSelDay(day)}
              className="rounded-xl py-2 px-2 text-center transition-all select-none relative"
              style={{ background: isSel ? 'rgba(129,140,248,0.1)' : isToday ? 'rgba(129,140,248,0.04)' : 'var(--c-bg-input)', border: isSel ? '1px solid rgba(129,140,248,0.4)' : isToday ? '1px solid rgba(129,140,248,0.15)' : '1px solid var(--c-border-subtle)' }}>
              {goalDeadlines[dStr]?.length > 0 && <span className="absolute top-1 right-1"><Target size={8} style={{ color: M.goals }} /></span>}
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-0.5 ${isToday ? 'text-accent-blue' : 'text-text-muted'}`}>{format(day, 'EEE')}</p>
              <p className={`text-lg num font-bold leading-none ${isToday ? 'text-accent-blue' : isPast ? 'text-text-muted/50' : isSel ? 'text-text-primary' : 'text-text-secondary'}`}>{format(day, 'd')}</p>
              <div className="flex gap-0.5 justify-center mt-1.5" style={{ minHeight: 7 }}>
                {act.trades   && <span className="w-1 h-1 rounded-full" style={{ background: M.trading }} />}
                {act.workout  && <span className="w-1 h-1 rounded-full" style={{ background: M.fitness }} />}
                {act.invoices && <span className="w-1 h-1 rounded-full" style={{ background: '#f87171' }} />}
                {act.events   && <span className="w-1 h-1 rounded-full" style={{ background: M.business }} />}
              </div>
            </button>
          )
        })}
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 292px' }}>
        {/* Time grid */}
        {renderTimeGrid(dayCol, openAtSlot, gridRef, true)}

        {/* Intel panel */}
        <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 680 }}>
          {dayTrades.length > 0 && (
            <IntelSection color={M.trading} icon={<TrendingUp size={13} />} title="Trading"
              summary={`${dayTrades.length} trade${dayTrades.length>1?'s':''} · ${dayPnl>=0?'+':''}${formatCurrency(dayPnl)}`} defaultOpen>
              <div className="space-y-1.5">
                {dayTrades.map((t: any) => (
                  <div key={t.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg" style={{ background: 'var(--c-bg-input)' }}>
                    <div><p className="text-xs font-medium text-text-primary">{t.asset}</p><p className="text-[11px] text-text-muted">{t.direction} · {t.instrument}</p></div>
                    <span className="text-xs num font-semibold" style={{ color: pnlClr(t.realizedPnl??0) }}>{(t.realizedPnl??0)>=0?'+':''}{formatCurrency(t.realizedPnl??0)}</span>
                  </div>
                ))}
              </div>
            </IntelSection>
          )}

          {(chkEntries as any[]).length > 0 && (
            <IntelSection color={M.checklist} icon={<CheckSquare size={13} />} title="Checklists"
              summary={(() => { const all=(chkEntries as any[]).flatMap((e:any)=>e.items??[]); const done=all.filter((it:any)=>it.completed).length; return `${done}/${all.length} done` })()}
              defaultOpen>
              {(chkEntries as any[]).map((entry: any) => {
                const items = (entry.items??[])
                const done  = items.filter((it:any)=>it.completed).length
                const pct   = items.length > 0 ? Math.round((done/items.length)*100) : 0
                return (
                  <div key={entry.id} className="mb-3 last:mb-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-text-primary truncate">{entry.template?.name ?? 'Checklist'}</span>
                      <span className="text-[11px] num ml-2 flex-shrink-0" style={{ color: pct===100?M.checklist:'rgba(139,139,170,0.7)' }}>{done}/{items.length}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--c-bg-input)' }}>
                      <div className="h-full rounded-full transition-all duration-500" style={{ width:`${pct}%`, background:M.checklist }} />
                    </div>
                    {items.filter((it:any)=>it.time).slice(0,4).map((it:any) => (
                      <div key={it.id} className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] num text-text-muted w-9 flex-shrink-0">{it.time}</span>
                        <span className={`text-[11px] truncate ${it.completed?'text-text-muted line-through':'text-text-secondary'}`}>{it.label}</span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </IntelSection>
          )}

          {(dayWorkouts.length > 0 || (layers.plans && plannedWod?.plannedWorkout)) && (
            <IntelSection color={M.fitness} icon={<Dumbbell size={13} />} title="Fitness"
              summary={dayWorkouts.length>0 ? dayWorkouts.map((w:any)=>w.name).join(', ') : `Planned: ${plannedWod?.plannedWorkout}`}
              defaultOpen={dayWorkouts.length>0}>
              {dayWorkouts.map((w:any) => (
                <div key={w.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg mb-1" style={{ background: 'var(--c-bg-input)' }}>
                  <p className="text-xs font-medium text-text-primary truncate">{w.name}</p>
                  {w.durationMinutes!=null && <span className="text-[11px] num text-text-muted flex-shrink-0 ml-2">{w.durationMinutes>=60?`${Math.floor(w.durationMinutes/60)}h${w.durationMinutes%60>0?` ${w.durationMinutes%60}m`:''}` :`${w.durationMinutes}m`}</span>}
                </div>
              ))}
              {dayWorkouts.length===0 && <p className="text-xs text-text-muted">Planned: <span className="text-text-secondary">{plannedWod?.plannedWorkout}</span> (not yet logged)</p>}
            </IntelSection>
          )}

          {(dayInvDue.length > 0 || dayMeetings.length > 0) && (
            <IntelSection color={M.business} icon={<Briefcase size={13} />} title="Business"
              summary={[dayInvDue.length>0&&`${dayInvDue.length} due`, dayMeetings.length>0&&`${dayMeetings.length} meeting${dayMeetings.length>1?'s':''}`].filter(Boolean).join(' · ')}
              defaultOpen>
              {dayInvDue.map((inv:any) => { const client=(allClients as any[]).find(c=>c.id===inv.clientId); return (
                <div key={inv.id} className="flex items-center justify-between mb-2 pb-2 last:mb-0 last:pb-0" style={{ borderBottom:'1px solid var(--c-border-subtle)' }}>
                  <div><p className="text-xs font-medium text-text-primary">{inv.invoiceNumber}</p><p className="text-[11px] text-text-muted">{client?.name}</p></div>
                  <div className="text-right"><p className="text-xs num font-semibold text-amber-400">{formatGBP(inv.amount)}</p><p className="text-[10px] text-amber-400/70">due today</p></div>
                </div>
              )})}
              {dayMeetings.map((m:any) => { const client=(allClients as any[]).find(c=>c.id===m.clientId); return (
                <div key={m.id} className="py-1"><p className="text-xs font-medium text-text-primary">{m.title}</p>{client&&<p className="text-[11px] text-text-muted">{client.name}</p>}</div>
              )})}
            </IntelSection>
          )}

          {upcomingInv.length > 0 && (
            <IntelSection color="#f87171" icon={<AlarmClock size={13} />} title="Upcoming Due"
              summary={`${upcomingInv.length} invoice${upcomingInv.length>1?'s':''} in 14d`}>
              {upcomingInv.slice(0,5).map((inv:any) => { const client=(allClients as any[]).find(c=>c.id===inv.clientId); const days=Math.ceil((new Date(inv.dueDate).getTime()-new Date().getTime())/86400000); return (
                <div key={inv.id} className="flex items-center justify-between mb-1.5"><div><p className="text-xs text-text-primary">{inv.invoiceNumber} · {client?.name}</p></div><div className="text-right"><p className="text-xs num text-text-secondary">{formatGBP(inv.amount)}</p><p className="text-[10px] text-text-muted">in {days}d</p></div></div>
              )})}
            </IntelSection>
          )}

          {goalDeadlines[selStr]?.length > 0 && (
            <IntelSection color={M.goals} icon={<Target size={13} />} title="Goal Deadline"
              summary={`${goalDeadlines[selStr].length} goal${goalDeadlines[selStr].length>1?'s':''} due`} defaultOpen>
              {goalDeadlines[selStr].map((g:any) => (
                <div key={g.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg mb-1" style={{ background:'var(--c-bg-input)' }}>
                  <div><p className="text-xs font-medium text-text-primary truncate">{g.focus}</p><p className="text-[11px] text-text-muted capitalize">{g.horizon}</p></div>
                  <span className="text-xs num font-semibold" style={{ color:M.goals }}>{Math.round(g.progressPct??0)}%</span>
                </div>
              ))}
            </IntelSection>
          )}

          {(dayIncome.length > 0 || dayExpenses.length > 0) && (
            <IntelSection color={M.finance} icon={<DollarSign size={13} />} title="Finances"
              summary={[dayIncome.length>0&&`+${formatGBP((dayIncome as any[]).reduce((s:number,i:any)=>s+i.amount,0))}`,dayExpenses.length>0&&`-${formatGBP((dayExpenses as any[]).reduce((s:number,e:any)=>s+e.amount,0))}`].filter(Boolean).join('  ')}>
              {(dayIncome as any[]).map((i:any) => <div key={i.id} className="flex items-center justify-between mb-1.5"><span className="text-xs text-text-secondary truncate">{i.source}</span><span className="text-xs num font-semibold text-pnl-profit">+{formatGBP(i.amount)}</span></div>)}
              {(dayExpenses as any[]).map((e:any) => <div key={e.id} className="flex items-center justify-between mb-1.5"><span className="text-xs text-text-secondary truncate">{e.description}</span><span className="text-xs num font-semibold text-pnl-loss">-{formatGBP(e.amount)}</span></div>)}
            </IntelSection>
          )}

          {dayEvents.length > 0 && (
            <IntelSection color={M.finance} icon={<Clock size={13} />} title="Events" summary={`${dayEvents.length} event${dayEvents.length>1?'s':''}`}>
              {dayEvents.map((ev:any) => { const col=CAT[ev.category]??'#818cf8'; return (
                <div key={ev.id} className="flex items-start gap-2 mb-2 last:mb-0">
                  <div className="w-0.5 rounded-full flex-shrink-0 mt-0.5" style={{ height:26, background:col }} />
                  <div><p className="text-xs font-medium text-text-primary leading-tight">{ev.title}</p><p className="text-[11px] num mt-0.5" style={{ color:col+'cc' }}>{fmtTime(ev.startDatetime)}{ev.endDatetime?` – ${fmtTime(ev.endDatetime)}`:''}</p></div>
                </div>
              )})}
            </IntelSection>
          )}

          {!dayTrades.length&&!(chkEntries as any[]).length&&!dayWorkouts.length&&!dayInvDue.length&&!dayMeetings.length&&!dayExpenses.length&&!dayIncome.length&&!dayEvents.length&&!upcomingInv.length&&!goalDeadlines[selStr]?.length && (
            <div className="rounded-xl px-4 py-8 text-center" style={{ background:'var(--c-bg-input)', border:'1px solid var(--c-border-subtle)' }}>
              <p className="text-sm font-medium text-text-secondary mb-1.5">Nothing here yet</p>
              <p className="text-xs text-text-muted leading-relaxed">Trades, workouts, checklist completions,<br />invoices and meetings appear automatically.</p>
            </div>
          )}
        </div>
      </div>

      {/* Categories config modal */}
      <CategoryConfigModal
        open={catsOpen}
        onClose={() => setCatsOpen(false)}
        categories={categories}
        onSave={saveCategories_}
      />

      {/* Sessions config modal */}
      <SessionConfigModal
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        sessions={sessions}
        onSave={saveSessions}
      />

      {/* Event modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Event">
        <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-3">
          <Input label="Title" placeholder="Meeting, focus block, reminder..." {...register('title', { required: true })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start" type="datetime-local" {...register('startDatetime', { required: true })} />
            <Input label="End"   type="datetime-local" {...register('endDatetime')} />
          </div>
          <Select label="Category" options={categories.map(c => ({ value: c.value, label: c.label }))} {...register('category')} />
          {watchCat === 'business' && (
            <div className="grid grid-cols-2 gap-3">
              <Select label="Client (optional)" placeholder="Select..." options={(allClients as any[]).map((c:any)=>({ value:String(c.id), label:c.name }))} {...register('clientId')} />
              {clientProjects.length > 0 && <Select label="Project (optional)" placeholder="Select..." options={clientProjects.map((p:any)=>({ value:String(p.id), label:p.name }))} {...register('projectId')} />}
            </div>
          )}
          <Textarea label="Notes" rows={2} {...register('description')} />
          <div className="flex justify-end gap-3 pt-2 border-t border-bg-border">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit">Create Event</Button>
          </div>
        </form>
      </Modal>
    </PageShell>
  )
}
