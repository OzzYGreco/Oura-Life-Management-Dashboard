/**
 * Headless core of the Goal crushers (Week) page, shared by every skin.
 * Every hook defaults to the weekly horizon, so skins that only know weeks keep working.
 */
import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { TodayView } from './today'

export type Source = 'manual' | 'checklist' | 'workouts' | 'trading_rules' | 'journal_reviewed'

export const SOURCES: { value: Source; label: string; hint: string }[] = [
  { value: 'manual',           label: 'By hand',          hint: 'You score it yourself' },
  { value: 'checklist',        label: 'From your routine', hint: 'Average day score this week' },
  { value: 'workouts',         label: 'From workouts',     hint: 'Workouts logged against a target' },
  { value: 'trading_rules',    label: 'From trading',      hint: 'Loses half per rule break' },
  { value: 'journal_reviewed', label: 'From the journal',  hint: 'Share of trades reviewed' },
]

// ─── Horizons ────────────────────────────────────────────────────────────────

export type Horizon = 'weekly' | 'monthly' | 'yearly' | '3yr'

export interface HorizonInfo {
  value: Horizon
  label: string       // Weekly
  unit: string        // week
  units: string       // weeks
  Unit: string        // Week
}

export const HORIZONS: HorizonInfo[] = [
  { value: 'weekly',  label: 'Weekly',  unit: 'week',   units: 'weeks',   Unit: 'Week' },
  { value: 'monthly', label: 'Monthly', unit: 'month',  units: 'months',  Unit: 'Month' },
  { value: 'yearly',  label: 'Yearly',  unit: 'year',   units: 'years',   Unit: 'Year' },
  { value: '3yr',     label: '3-Year',  unit: 'period', units: 'periods', Unit: 'Period' },
]
export const horizonInfo = (h: Horizon) => HORIZONS.find(x => x.value === h)!

const addDays = (d: string, n: number) => {
  const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10)
}
const addMonths = (d: string, n: number) => {
  const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, dd)).toISOString().slice(0, 10)
}
/** The natural last day of a period starting on `from` (same rule as the server). */
export function periodEnd(h: Horizon, from: string): string {
  if (h === 'weekly') return addDays(from, 6)
  return addDays(addMonths(from, h === 'monthly' ? 1 : h === 'yearly' ? 12 : 36), -1)
}

/** A short name for a period: W12, Nov 26, 2026, 2026 to 28. */
export function periodLabel(h: Horizon, from: string, to: string, index: number): string {
  if (h === 'weekly') return `W${index}`
  const f = new Date(from + 'T12:00:00Z')
  if (h === 'monthly') return f.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  if (h === 'yearly') return String(f.getUTCFullYear())
  return `${f.getUTCFullYear()}-${to.slice(2, 4)}`
}

/** A sentence name: "Week 12", "November 2026", "2026", "2026 to 2028". */
export function periodName(h: Horizon, from: string, to: string, index: number): string {
  if (h === 'weekly') return `Week ${index}`
  const f = new Date(from + 'T12:00:00Z')
  if (h === 'monthly') return f.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  if (h === 'yearly') return String(f.getUTCFullYear())
  return `${f.getUTCFullYear()} to ${to.slice(0, 4)}`
}

// ─── Data ────────────────────────────────────────────────────────────────────

export interface WeekTask {
  id?: number; title: string; maxPoints: number; earnedPoints: number | null; source: Source; target: number | null
  /** Up the chain: a weekly task serves a monthly task, a monthly task serves a milestone. */
  parentTaskId?: number | null; milestoneId?: number | null
  /** The name of what it serves (read only, from the server). */
  up?: string | null
}
export interface WeekGoal { id: number; focus: string; from: string; to: string; closed?: boolean; tasks: WeekTask[]; rewards: { id?: number; minScore: number; reward: string }[] }

export interface Suggestion { title: string; maxPoints: number; source: Source; target: number | null; weeks: number; last: string; milestoneId?: number | null; parentTitle?: string | null }

export interface HistoryItem {
  id: number; from: string; to: string; focus: string; score: number; max: number; reward: string | null
  current: boolean; closed?: boolean; dayAvg: number | null; dailyPct: number | null
  tasks?: { title: string; max: number; earned: number | null }[]
}

export interface WeekView {
  horizon?: Horizon
  today: string
  suggestions: { focuses: string[]; tasks: Suggestion[] }
  /** The running period's dates, or the natural one when no goal is set for it. */
  period?: { from: string; to: string }
  nextPeriod?: { from: string; to: string } | null
  current: (WeekGoal & { live: NonNullable<TodayView['week']> }) | null
  next: WeekGoal | null
  nextStart: string | null
  history: HistoryItem[]
  trends: { title: string; weeks: number; avg: number; recent: number[] }[]
}

const KEY = ['week']
const refresh = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: KEY })
  qc.invalidateQueries({ queryKey: ['week-goal'] })
  qc.invalidateQueries({ queryKey: ['today'] })
}
const hq = (h: Horizon) => (h === 'weekly' ? '' : `?horizon=${h}`)

export function useWeek(horizon: Horizon = 'weekly') {
  return useQuery({ queryKey: [...KEY, horizon], queryFn: () => api.get<WeekView>(`/api/week${hq(horizon)}`).then(r => r.data) })
}

/** Any period's scorecard; the current one also comes with live (auto) scores in useWeek. */
export function useWeekGoal(id: number | null) {
  return useQuery({
    queryKey: ['week-goal', id],
    enabled: id != null,
    queryFn: () => api.get<WeekGoal>(`/api/week/goal/${id}`).then(r => r.data),
  })
}

export function useScoreTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, earnedPoints }: { id: number; earnedPoints: number | null }) => api.patch(`/api/week/tasks/${id}`, { earnedPoints }),
    onSuccess: () => refresh(qc),
  })
}

/** Switch how one task scores, e.g. back to by hand for this week. */
export function useTaskSource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, source }: { id: number; source: Source }) => api.patch(`/api/week/tasks/${id}`, { source }),
    onSuccess: () => refresh(qc),
  })
}

/** Edit any period: focus, dates, tasks (kept by id) and rewards. */
export function useSaveWeek() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; focus?: string; from?: string; to?: string; tasks?: WeekTask[]; rewards?: { minScore: number; reward: string }[] }) => api.put(`/api/week/${id}`, body),
    onSuccess: () => refresh(qc),
  })
}

type PlanBody = { focus: string; tasks: Omit<WeekTask, 'earnedPoints'>[]; rewards: { minScore: number; reward: string }[]; horizon?: Horizon; from?: string; to?: string }

/** Set the next period from the composer: creates it, or replaces an unstarted plan. */
export function usePlanNextWeek() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ horizon = 'weekly', ...body }: PlanBody) =>
      api.post<{ id: number; from: string; to: string; replaced: boolean }>(`/api/week/next${hq(horizon)}`, body).then(r => r.data),
    onSuccess: () => refresh(qc),
  })
}

/** Set this period's goals when none exist yet. */
export function useCreateCurrent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ horizon = 'weekly', ...body }: PlanBody) =>
      api.post<{ id: number; from: string; to: string }>(`/api/week/current${hq(horizon)}`, body).then(r => r.data),
    onSuccess: () => refresh(qc),
  })
}

export function useClosePeriod() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.post(`/api/week/${id}/close`), onSuccess: () => refresh(qc) })
}

export function useReopenPeriod() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.post(`/api/week/${id}/reopen`), onSuccess: () => refresh(qc) })
}

export function useDeletePeriod() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.delete(`/api/week/${id}`), onSuccess: () => refresh(qc) })
}

// ─── Settings per horizon (app setting `goalsSettings`) ──────────────────────

export interface HorizonRules { max: number; threshold: number; defaultPoints: number }
export type GoalsSettings = Record<Horizon, HorizonRules>

export const DEFAULT_GOALS_SETTINGS: GoalsSettings = {
  weekly:  { max: 10, threshold: 7, defaultPoints: 1 },
  monthly: { max: 10, threshold: 8, defaultPoints: 1 },
  yearly:  { max: 10, threshold: 8, defaultPoints: 1 },
  '3yr':   { max: 10, threshold: 9, defaultPoints: 1 },
}

function parseSettings(raw: unknown): GoalsSettings {
  let p: any = {}
  try { p = typeof raw === 'string' ? JSON.parse(raw) : {} } catch { /* defaults */ }
  const out = {} as GoalsSettings
  for (const h of HORIZONS.map(x => x.value)) {
    const d = DEFAULT_GOALS_SETTINGS[h], v = p?.[h] ?? {}
    const num = (x: unknown, fb: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : fb)
    out[h] = { max: num(v.max, d.max), threshold: num(v.threshold, d.threshold), defaultPoints: num(v.defaultPoints, d.defaultPoints) || d.defaultPoints }
  }
  return out
}
const same = (a: GoalsSettings, b: GoalsSettings) => JSON.stringify(a) === JSON.stringify(b)

export function useGoalsSettings() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => api.get<Record<string, unknown>>('/api/today/settings').then(r => r.data),
  })
  const settings = parseSettings(q.data?.goalsSettings)
  const save = useMutation({
    mutationFn: (next: GoalsSettings) => api.put('/api/today/settings', { goalsSettings: JSON.stringify(next) }),
    onMutate: next => qc.setQueryData<Record<string, unknown>>(['app-settings'], old => (old ? { ...old, goalsSettings: JSON.stringify(next) } : old)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['app-settings'] }),
  })
  return { settings, loaded: q.isSuccess, isDefault: same(settings, DEFAULT_GOALS_SETTINGS), save }
}

const LEGACY_KEY = 'oura-goals-settings'
const MIGRATED_KEY = 'oura-goals-settings-migrated'

/**
 * One-off: the old Goals page kept its settings in this browser. Move them to
 * the server the first time, if the server still has its defaults.
 */
export function useMigrateGoalsSettings(gs: ReturnType<typeof useGoalsSettings>) {
  useEffect(() => {
    if (!gs.loaded) return
    let raw: string | null = null
    try {
      if (localStorage.getItem(MIGRATED_KEY)) return
      raw = localStorage.getItem(LEGACY_KEY)
    } catch { return }
    if (!raw) return
    const done = () => { try { localStorage.setItem(MIGRATED_KEY, '1') } catch { /* ignore */ } }
    if (!gs.isDefault) { done(); return }
    try {
      const old = JSON.parse(raw)
      const next = { ...gs.settings }
      for (const h of HORIZONS.map(x => x.value)) {
        const max = Number(old?.maxScores?.[h]), th = Number(old?.successThresholds?.[h])
        next[h] = {
          ...next[h],
          ...(Number.isFinite(max) && max > 0 ? { max } : {}),
          ...(Number.isFinite(th) && th >= 0 ? { threshold: th } : {}),
        }
      }
      if (!same(next, gs.settings)) gs.save.mutate(next, { onSuccess: done })
      else done()
    } catch { done() }
  }, [gs.loaded]) // eslint-disable-line react-hooks/exhaustive-deps
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export const fmtRange = (from: string, to: string) => {
  const f = new Date(from + 'T12:00:00'), t = new Date(to + 'T12:00:00')
  const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric' })
  const mon = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short' })
  const yr = (d: Date) => d.getFullYear()
  if (yr(f) !== yr(t)) return `${day(f)} ${mon(f)} ${yr(f)} to ${day(t)} ${mon(t)} ${yr(t)}`
  return f.getMonth() === t.getMonth() ? `${day(f)} to ${day(t)} ${mon(t)}` : `${day(f)} ${mon(f)} to ${day(t)} ${mon(t)}`
}
export const pts = (n: number) => String(Math.round(n * 100) / 100)
