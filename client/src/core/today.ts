/**
 * The headless core of the home screen. Every skin reads the same view model
 * from /api/today and calls the same actions; skins only decide how it looks.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export type ItemStatus = 'on_time' | 'late' | 'missed' | 'open' | 'overdue' | 'upcoming' | 'anytime'

export interface DayItem {
  id: number
  entryId: number
  templateId?: number | null   // null = a one-off
  templateItemId?: number | null
  streak?: number              // days in a row on time (today counts once it lands)
  label: string
  time: string | null          // HH:MM
  start: number | null         // minutes from the day's midnight (past 1440 = after midnight)
  end: number | null
  importance: string | null
  points: number
  status: ItemStatus
  earned: number
  completedAt: string | null
  reason: string | null
}

export interface RoutineProgress { key: string; templateId: number | null; name: string; total: number; done: number; missed: number; left: number }
export interface WeeklyItem { id: number; templateId: number; templateItemId: number | null; label: string; done: boolean; completedAt: string | null; streak: number }

export interface TodayView {
  generatedAt: string
  today?: string
  minuteOfDay: number            // minutes into the day being shown
  day: {
    date: string
    isToday?: boolean
    future?: boolean
    reopened?: { until: string } | null
    routines?: RoutineProgress[]
    weekly?: { weekOf: string; routines: { templateId: number; name: string; items: WeeklyItem[] }[] }
    recent: { date: string; score: number | null }[]
    closed: boolean
    now: string
    score: number | null
    earned: number
    possible: number
    total: number
    ghost: { label: string; date: string; score: number | null; diff: number | null }
    bestThisMonth: { score: number; date: string } | null
    coach: string
    current: (DayItem & { minutesLeft: number }) | null
    next: (DayItem & { minutesUntil: number }) | null
    items: DayItem[]
    counts: { onTime: number; late: number; missed: number; ahead: number }
    closesAt: string
    minutesToClose: number
  }
  week: null | {
    goalId: number
    focus: string
    from: string
    to: string
    score: number
    max: number
    tasks: { id: number; title: string; source: string; max: number; earned: number; note: string | null }[]
    ladder: { at: number; reward: string; reached: boolean }[]
    nextReward: { at: number; reward: string; reached: boolean } | null
    stakes: string | null
    coach: string | null
    lastWeek: { score: number; reward: string | null } | null
  }
  wins: { kind: 'business' | 'training' | 'week' | string; title: string; detail: string }[]
  pulse: {
    trading: { id: number; name: string; trades: number; net: number; netR: number | null; limitLeft: number | null; limitUnit: string; oneR: number | null }[]
    tradingDay?: { pnl: number; count: number; avgR: number | null; trades: { id: number; asset: string; direction: string; r: number | null; pnl: number }[] }
    tradingMonth?: { pnl: number; count: number; winRate: number | null; avgR: number | null; last7: { date: string; label: string; pnl: number }[] }
    business: null | {
      mrr: number; outstanding: number
      netNewMrr?: number; revenueMTD?: number; marginPct?: number; activeClients?: number
      nextDue: null | { invoiceNumber: string; amount: number; dueDate: string; clientName: string | null }
    }
    workouts: { done: number; target: number }
    lastWorkout?: { id: number; name: string; date: string; durationMinutes: number | null; category: string } | null
    upcoming?: { id: number; title: string; start: string; allDay: boolean }[]
  }
}

const KEY = ['today']
/** Today's view lives at ['today']; another day's at ['today', date]. */
const keyFor = (date?: string | null) => (date ? ['today', date] : KEY)

/** The home view model. `date` shows another day (past to review or correct, ahead to plan). */
export function useToday(date?: string | null) {
  return useQuery({
    queryKey: keyFor(date),
    queryFn: () => api.get<TodayView>('/api/today', { params: date ? { date } : undefined }).then(r => r.data),
    placeholderData: prev => prev,  // stepping between days keeps the page up while the next one loads
    refetchInterval: 30_000,        // windows open and close on the minute
    refetchOnWindowFocus: true,
  })
}

/** Puts a fresh view where it belongs and marks every other day's view stale. */
function useStore() {
  const qc = useQueryClient()
  return (view: TodayView, date?: string | null) => {
    qc.setQueryData(keyFor(date), view)
    qc.invalidateQueries({ queryKey: KEY, predicate: q => JSON.stringify(q.queryKey) !== JSON.stringify(keyFor(date)) })
    qc.invalidateQueries({ queryKey: ['routine'] })
    qc.invalidateQueries({ queryKey: ['checklist-entries'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }
}

/** Tick (or untick) an item. The server scores it by the time it happens. */
export function useTick() {
  const store = useStore()
  return useMutation({
    mutationFn: ({ id, done = true, date }: { id: number; done?: boolean; date?: string | null }) =>
      api.post<TodayView>(`/api/today/items/${id}/tick`, { done, ...(date ? { date } : {}) }).then(r => r.data),
    onSuccess: (view, v) => store(view, v.date),
  })
}

/** Mark an item missed (missed:false takes it back). It earns nothing and still counts against the day. */
export function useMarkMissed() {
  const store = useStore()
  return useMutation({
    mutationFn: ({ id, missed = true, date }: { id: number; missed?: boolean; date?: string | null }) =>
      api.post<TodayView>(`/api/today/items/${id}/missed`, { missed, ...(date ? { date } : {}) }).then(r => r.data),
    onSuccess: (view, v) => store(view, v.date),
  })
}

/** Closes the day: today by default, or a past day reopened for corrections. */
export function useCloseDay() {
  const store = useStore()
  return useMutation({
    mutationFn: (body: { reflection?: string; reasons?: Record<number, string>; date?: string | null }) =>
      api.post<{ view: TodayView }>('/api/today/close', body).then(r => r.data),
    onSuccess: (d, v) => store(d.view, v.date),
  })
}

/** "Correct this day": reopens a closed day; it closes again with the review or at 04:00. */
export function useReopenDay() {
  const store = useStore()
  return useMutation({
    mutationFn: ({ date }: { date: string; view?: string | null }) => api.post<TodayView>(`/api/today/days/${date}/reopen`).then(r => r.data),
    onSuccess: (view, v) => store(view, v.view),
  })
}

/** Ticks a weekly-routine item for this week. `date` is the day on screen, for the view sent back. */
export function useWeeklyTick() {
  const store = useStore()
  return useMutation({
    mutationFn: ({ id, done = true, date }: { id: number; done?: boolean; date?: string | null }) =>
      api.post<TodayView>(`/api/today/weekly/${id}/tick`, { done, ...(date ? { date } : {}) }).then(r => r.data),
    onSuccess: (view, v) => store(view, v.date),
  })
}

/** One-offs for any open day: add one or many, remove (done or not), restore after a remove. */
export function useDayOneOffs() {
  const qc = useQueryClient()
  const done = () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ['routine'] }) }
  return {
    add: useMutation({
      mutationFn: (b: { date?: string | null; items: { label: string; time?: string | null; importance?: string | null }[] }) =>
        api.post('/api/routine/oneoffs', { items: b.items, ...(b.date ? { date: b.date } : {}) }),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: number) => api.delete(`/api/routine/oneoffs/${id}`), onSuccess: done }),
    restore: useMutation({ mutationFn: (id: number) => api.post(`/api/routine/oneoffs/${id}/restore`), onSuccess: done }),
  }
}

// ─── Shared helpers every skin uses ──────────────────────────────────────────

export const MISS_REASONS = ['Skipped it', 'Not relevant today', 'Forgot', "Couldn't"] as const

/** "52 min" / "1 h 7 min" */
export function duration(mins: number): string {
  if (mins < 60) return `${Math.max(0, mins)} min`
  const h = Math.floor(mins / 60), m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** Which part of the day an item falls in, for grouped layouts. */
export function partOfDay(start: number | null): 'Morning' | 'Afternoon' | 'Tonight' | 'Anytime' {
  if (start == null) return 'Anytime'
  if (start < 12 * 60) return 'Morning'
  if (start < 18 * 60) return 'Afternoon'
  return 'Tonight'
}

export const isDone = (s: ItemStatus) => s === 'on_time' || s === 'late'

export function resultLabel(i: DayItem): string {
  switch (i.status) {
    case 'on_time': return `On time +${i.earned}`
    case 'late': return `Late +${i.earned}`
    case 'missed': return 'Missed'
    case 'overdue': return `Past window, +${i.points / 2} if done now`
    case 'open': return 'Now'
    case 'upcoming': return ''
    case 'anytime': return 'Anytime'
  }
}

// ─── Ticking rules (mirrors the server) ──────────────────────────────────────

export const EARLY_MIN = 120

/** Whether an item can be ticked now; the server enforces the same rule. */
export function canTick(i: DayItem, minuteOfDay: number, closed: boolean): boolean {
  if (closed || isDone(i.status) || i.status === 'missed') return false
  if (i.status === 'upcoming') return i.start != null && minuteOfDay >= i.start - EARLY_MIN
  return true   // open, overdue, anytime
}

/** A ticked item can be unticked until the day is closed. */
export const canUntick = (i: DayItem, closed: boolean) => !closed && isDone(i.status)

/** Why an item can't be ticked yet, for tooltips. */
export function tickHint(i: DayItem, minuteOfDay: number, closed: boolean): string {
  if (closed) return 'The day is closed.'
  if (isDone(i.status)) return 'Click to untick.'
  if (i.status === 'upcoming' && i.start != null && minuteOfDay < i.start - EARLY_MIN) {
    const opens = i.start - EARLY_MIN, h = Math.floor((opens % 1440) / 60), m = opens % 60
    return `Can be ticked from ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}.`
  }
  return i.status === 'overdue' ? `Done late earns half (+${i.points / 2}).` : `Done on time earns +${i.points}.`
}

/** Whether an item can be marked missed: anything not done and not already missed, until the day closes. */
export const canMarkMissed = (i: DayItem, closed: boolean) => !closed && !isDone(i.status) && i.status !== 'missed'
/** A miss marked today can be taken back until the day closes. */
export const canUnmarkMissed = (i: DayItem, closed: boolean) => !closed && i.status === 'missed'
