/**
 * Headless core of the Routine page, shared by every skin.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { DayItem } from './today'

export interface ItemStats {
  days: number; onTime: number; late: number; missed: number
  hitRate: number | null
  topReason: string | null
  reasons: Record<string, number>
  recent: { date: string; result: string }[]
}

export interface RoutineItem {
  id?: number                 // missing for a new, unsaved item
  label: string
  time: string | null         // HH:MM 24h
  windowMin: number
  schedule: string | null     // null = every day | weekdays | days:1,3,5 (0 = Sunday) | once:YYYY-MM-DD
  importance: string | null   // UI | NUI | UNI | NUNI
  points: number
  pointsOverride: number | null
  runsToday?: boolean
  stats?: ItemStats
  streak?: number             // daily: days in a row on time · weekly: weeks in a row done
  week?: { entryItemId: number | null; done: boolean }   // weekly routines only: this week
}

export type RoutineType = 'daily' | 'weekly'

export interface RoutineView {
  today: string
  templates: { id: number; name: string; enabled: boolean; type?: RoutineType; items: RoutineItem[] }[]
  history: { date: string; score: number; reflection: string | null; auto: boolean }[]
  todayScore: number | null
  oneOffs: { id: number; label: string; time: string | null; importance?: string | null; completed: boolean }[]
  overall: { days: number; hitRate: number | null; avgScore: number | null }
}

export const IMPORTANCE: { value: string; label: string; hint: string; points: number }[] = [
  { value: 'UI',   label: 'Must',   hint: 'Urgent and important', points: 8 },
  { value: 'NUI',  label: 'Should', hint: 'Important, not urgent', points: 5 },
  { value: 'UNI',  label: 'Could',  hint: 'Urgent, not important', points: 3 },
  { value: 'NUNI', label: 'Nice',   hint: 'Neither', points: 2 },
]
export const pointsOf = (importance: string | null, override: number | null) =>
  override ?? IMPORTANCE.find(i => i.value === importance)?.points ?? 5

export const WINDOWS = [15, 30, 45, 60, 90, 120, 180]

/** Days an item runs, as 0-6 (Sunday = 0). */
export function daysOf(schedule: string | null): number[] {
  if (!schedule || schedule === 'daily') return [0, 1, 2, 3, 4, 5, 6]
  if (schedule === 'weekdays') return [1, 2, 3, 4, 5]
  if (schedule === 'weekends') return [0, 6]
  if (schedule.startsWith('days:')) return schedule.slice(5).split(',').map(Number).filter(n => n >= 0 && n <= 6)
  return []
}
export function scheduleOf(days: number[]): string | null {
  const s = [...new Set(days)].sort()
  if (s.length === 7) return null
  if (s.join() === '1,2,3,4,5') return 'weekdays'
  return `days:${s.join(',')}`
}
export const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]   // Monday first

/** Minutes from midnight on the 04:00-04:00 day (after midnight continues past 1440). */
export function toDayMin(t: string | null): number | null {
  const m = t?.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const v = Number(m[1]) * 60 + Number(m[2])
  return v < 240 ? v + 1440 : v
}
export const fromDayMin = (v: number) => {
  const m = ((v % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

const KEY = ['routine']

export function useRoutine() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<RoutineView>('/api/routine').then(r => r.data) })
}

/** Saves a routine's items. Edited items keep their id (and history); removed ones are retired. */
export function useSaveRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name, items }: { id: number; name?: string; items: RoutineItem[] }) =>
      api.put(`/api/checklists/templates/${id}`, {
        ...(name ? { name } : {}),
        items: items.map(i => ({
          id: i.id, label: i.label, time: i.time, importance: i.importance,
          windowMin: i.windowMin, schedule: i.schedule, points: i.pointsOverride,
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      qc.invalidateQueries({ queryKey: ['today'] })
    },
  })
}

export function useToggleRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => api.put(`/api/checklists/templates/${id}`, { enabled: enabled ? 1 : 0 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ['today'] }) },
  })
}

/** A new routine. Pass a name, or { name, type } for a weekly one. */
export function useNewRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: string | { name: string; type: RoutineType }) =>
      api.post<{ id: number }>('/api/routine/templates', typeof b === 'string' ? { name: b } : b).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

/** Daily routines are scored each day; weekly ones are ticked once a week and not scored. */
export function useSetRoutineType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, type }: { id: number; type: RoutineType }) => api.put(`/api/checklists/templates/${id}`, { type }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ['today'] }) },
  })
}

export function useDayDetail(date: string | null) {
  return useQuery({
    queryKey: ['routine-day', date],
    enabled: !!date,
    queryFn: () => api.get<{ date: string; score: number | null; items: DayItem[]; reflection: string | null; autoClosed: boolean; closed: boolean }>(`/api/routine/day/${date}`).then(r => r.data),
  })
}

export function useOneOffs() {
  const qc = useQueryClient()
  const done = () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ['today'] }) }
  return {
    add: useMutation({ mutationFn: (b: { label: string; time?: string; importance?: string | null; date?: string }) => api.post('/api/routine/oneoffs', b), onSuccess: done }),
    addMany: useMutation({
      mutationFn: (b: { date?: string; items: { label: string; time?: string | null; importance?: string | null }[] }) => api.post('/api/routine/oneoffs', b),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: number) => api.delete(`/api/routine/oneoffs/${id}`), onSuccess: done }),
    /** Undo a remove. */
    restore: useMutation({ mutationFn: (id: number) => api.post(`/api/routine/oneoffs/${id}/restore`), onSuccess: done }),
  }
}

export function useRenameRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api.put(`/api/checklists/templates/${id}`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

/** Deletes a routine; one with history is archived so past days keep their scores. */
export function useDeleteRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ archived: boolean }>(`/api/routine/templates/${id}`).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ['today'] }) },
  })
}

/** The date of a one-time item, or null. */
export const onceDate = (schedule: string | null | undefined) => (schedule?.startsWith('once:') ? schedule.slice(5) : null)

/** "Every day", "Weekdays", "Mon, Wed, Fri", "Once, Fri 6 Nov" */
export function daysLabel(schedule: string | null): string {
  const once = onceDate(schedule)
  if (once) return `Once, ${new Date(once + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`
  const d = daysOf(schedule)
  if (d.length === 7) return 'Every day'
  if (d.join() === '1,2,3,4,5') return 'Weekdays'
  if (d.join() === '0,6') return 'Weekends'
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return WEEK_ORDER.filter(x => d.includes(x)).map(x => names[x]).join(', ')
}

export const windowLabel = (m: number) => (m < 60 ? `${m} min` : `${m / 60 === Math.floor(m / 60) ? m / 60 : (m / 60).toFixed(1)} h`)

// ─── One-line quick add ──────────────────────────────────────────────────────

export interface Parsed {
  label: string
  time: string | null        // HH:MM
  windowMin: number | null
  schedule: string | null | undefined   // undefined = not said (keep default)
  importance: string | null
  bits: string[]             // what was understood, for the preview
}

const DAY_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 }
const WEIGHTS: Record<string, string> = { must: 'UI', should: 'NUI', could: 'UNI', nice: 'NUNI', ui: 'UI', nui: 'NUI', uni: 'UNI', nuni: 'NUNI' }

/** The routine day right now: before 04:00 it is still yesterday. */
export function routineToday(at = new Date()): string {
  const d = new Date(at)
  if (d.getHours() < 4) d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const plusDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Reads a routine item from one line, e.g.
 *   "Read 10 pages 22:30 30m weekdays must"
 *   "Gym at 6pm 1.5h mon wed fri"
 *   "Call the bank tomorrow 16:00"        (just once, tomorrow)
 *   "* Coffee at 09:30 AM NUI"            (the old pasted format)
 * Whatever isn't a time, length, days or weight is the name.
 * `today` is the routine day "today" and "once" mean (defaults to now).
 */
export function parseQuick(text: string, today = routineToday()): Parsed {
  // Bullets and tick marks from a pasted list are not part of the name.
  let rest = ` ${text.trim().replace(/^[*\-•·]\s*/, '').replace(/[\u2705\u274C\u2714\u2716]/g, '')} `
  const bits: string[] = []
  let time: string | null = null, windowMin: number | null = null, importance: string | null = null
  let schedule: string | null | undefined

  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean) => {
    const m = rest.match(re)
    if (m && fn(m)) rest = rest.replace(m[0], ' ')
  }
  // time: 22:30, 9:05, 17.30, 6pm, 6:30am, "at 5", "at 17"
  take(/\s(at\s+)?(\d{1,2})[:.](\d{2})\s*(am|pm)?(?=\s)/i, m => {
    let h = Number(m[2]); const mm = Number(m[3]); const ap = m[4]?.toLowerCase()
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0
    // "at 5:30" with no am/pm and no leading zero reads like "at 5": the afternoon.
    if (!ap && m[1] && m[2].length === 1 && h >= 1 && h <= 6) h += 12
    if (h > 23 || mm > 59) return false
    time = `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; return true
  })
  if (!time) take(/\s(?:at\s+)?(\d{1,2})\s*(am|pm)(?=\s)/i, m => {
    let h = Number(m[1]); const ap = m[2].toLowerCase()
    if (h > 12) return false
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0
    time = `${String(h).padStart(2, '0')}:00`; return true
  })
  // A bare hour needs "at": "Gym at 5". Without am/pm, 1 to 6 reads as afternoon
  // (nobody plans 5 am by saying "at 5"), 7 to 11 as morning, 12 and up as written.
  // Only when the number ends the line or other parts follow, so "Look at 3 charts" stays a name.
  if (!time) take(/\sat\s+(\d{1,2})(?=\s*$|\s+(?:\d|must|should|could|nice|nuni|nui|uni|ui|once|today|tomorrow|daily|every|weekdays?|weekends?|mon|tue|wed|thu|fri|sat|sun)\b)/i, m => {
    let h = Number(m[1])
    if (h > 23) return false
    if (h >= 1 && h <= 6) h += 12
    time = `${String(h).padStart(2, '0')}:00`; return true
  })
  // length: 30m, 30 min, 1h, 1.5h, 90mins
  take(/\s(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)(?=\s)/i, m => {
    const n = Number(m[1]); const unit = m[2].toLowerCase()
    windowMin = Math.round(unit.startsWith('h') ? n * 60 : n)
    return windowMin >= 5 && windowMin <= 600
  })
  // just once: "once" (today), "today", "tomorrow", "once tomorrow", "once on 2026-11-09"
  take(/\s(?:once\s+(?:on\s+)?)?(\d{4}-\d{2}-\d{2})(?=\s)/i, m => { schedule = `once:${m[1]}`; return true })
  if (schedule === undefined) take(/\s(?:once\s+)?tomorrow(?=\s)/i, () => { schedule = `once:${plusDays(today, 1)}`; return true })
  if (schedule === undefined) take(/\s(?:once\s+)?today(?=\s)/i, () => { schedule = `once:${today}`; return true })
  if (schedule === undefined) take(/\sonce(?=\s)/i, () => { schedule = `once:${today}`; return true })
  // days
  if (schedule === undefined) take(/\s(every\s*day|daily)(?=\s)/i, () => { schedule = null; return true })
  if (schedule === undefined) take(/\s(weekdays?|mon\s*-\s*fri)(?=\s)/i, () => { schedule = 'weekdays'; return true })
  if (schedule === undefined) take(/\s(weekends?)(?=\s)/i, () => { schedule = 'days:0,6'; return true })
  if (schedule === undefined) {
    const found: number[] = []
    let m: RegExpMatchArray | null
    const re = /\s(sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)(?:day)?s?,?(?=\s)/i
    while ((m = rest.match(re))) { found.push(DAY_NAMES[m[1].toLowerCase()]); rest = rest.replace(m[0], ' ') }
    if (found.length) schedule = scheduleOf(found)
  }
  // weight
  take(/\s(must|should|could|nice|nuni|nui|uni|ui)(?=\s)/i, m => { importance = WEIGHTS[m[1].toLowerCase()]; return true })

  const label = rest.replace(/\s+/g, ' ').trim()
  if (time) bits.push(`at ${time}`)
  if (windowMin) bits.push(`${windowLabel(windowMin)} window`)
  if (schedule !== undefined) bits.push(daysLabel(schedule).toLowerCase())
  if (importance) bits.push(IMPORTANCE.find(i => i.value === importance)!.label.toLowerCase())
  return { label, time, windowMin, schedule, importance, bits }
}

/** One parsed item per non-empty line of a paste. */
export function parseMany(text: string, today = routineToday()): Parsed[] {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => parseQuick(l, today)).filter(p => p.label)
}

// ─── Reminder settings ───────────────────────────────────────────────────────

export interface ReminderSettings {
  notifications: string        // on | off
  alertLeadMin: string         // 0 | 5 | 10 | 15 | 30
  reviewTime: string           // HH:MM
  quietFrom: string            // HH:MM or ''
  quietTo: string
  notifierInstalled?: boolean
}
export const LEADS = [0, 5, 10, 15, 30]

export function useReminderSettings() {
  return useQuery({ queryKey: ['app-settings'], queryFn: () => api.get<ReminderSettings>('/api/today/settings').then(r => r.data) })
}
export function useSaveReminderSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<ReminderSettings>) => api.put<ReminderSettings>('/api/today/settings', patch).then(r => r.data),
    onSuccess: d => qc.setQueryData(['app-settings'], (old: object | undefined) => ({ ...(old ?? {}), ...d })),
  })
}
export interface NotifierStatus {
  via: 'arete' | 'terminal-notifier' | 'applescript'
  permission: 'authorized' | 'denied' | 'not-determined' | 'provisional' | 'unknown' | null
  style: 'alerts' | 'banners' | 'none' | null
  sound: boolean | null
}
/** How reminders arrive, as macOS reports it. Rechecked when the window regains focus (after a visit to System Settings). */
export function useNotifierStatus() {
  return useQuery({ queryKey: ['notifier'], queryFn: () => api.get<NotifierStatus>('/api/today/settings/notifier').then(r => r.data), refetchOnWindowFocus: true, staleTime: 5_000 })
}
export function useTestNotification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ sent: boolean; notifierInstalled: boolean; notifier: NotifierStatus }>('/api/today/settings/test').then(r => r.data),
    onSuccess: r => qc.setQueryData(['notifier'], r.notifier),
  })
}
