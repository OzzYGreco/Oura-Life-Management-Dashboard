/**
 * The goal chain above the month: 3-year directions and their SMART
 * milestones (reached or not, never scored). Weekly and monthly goals keep
 * their points in core/week.ts; their tasks link up the chain through
 * useLinkTask here. Server: /api/milestones and PATCH /api/week/tasks/:id.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { periodName, useWeek, type Horizon } from './week'

export type Measure =
  | 'manual' | 'steps' | 'business_mrr' | 'business_clients' | 'routine_avg'
  | 'trading_net_r' | 'training_workouts' | 'training_lift' | 'weeks_beaten'

export type MilestoneStatus = 'open' | 'reached' | 'missed' | 'dropped'

export interface Direction {
  id: number
  title: string
  why: string | null
  targetDate: string | null
  sortOrder: number
}

export interface MilestoneStep { id: number; milestoneId: number; title: string; doneAt: string | null; sortOrder: number }

export interface Milestone {
  id: number
  directionId: number | null
  kind: 'milestone' | 'foundation'
  title: string
  doneMeans: string | null
  measure: Measure
  measureParam: string | null
  unit: string | null
  startValue: number | null
  targetValue: number | null
  manualValue: number | null
  higherIsBetter: boolean
  startDate: string
  dueDate: string
  status: MilestoneStatus
  reachedAt: string | null
  steps: MilestoneStep[]
  // Live, from the server's measure and pace.
  current: number | null
  target: number | null
  start: number | null
  progress: number | null
  elapsed: number
  daysLeft: number
  met: boolean
  pace: 'ahead' | 'on' | 'behind' | null
  projected: number | null
  neededPerMonth: number | null
  overdue: boolean
  fedBy: { taskId: number; goalId: number; title: string }[]
}

export interface MilestonesView {
  directions: Direction[]
  milestones: Milestone[]
  measures: { value: Measure; label: string; unit: string | null }[]
}

export type MilestoneInput = Partial<Pick<Milestone,
  'directionId' | 'kind' | 'title' | 'doneMeans' | 'measure' | 'measureParam' | 'unit' |
  'startValue' | 'targetValue' | 'manualValue' | 'higherIsBetter' | 'startDate' | 'dueDate'>> & { steps?: string[] }

const KEY = ['milestones']

export function useMilestones() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<MilestonesView>('/api/milestones').then(r => r.data),
    staleTime: 60_000,
  })
}

/** Every change to the chain refreshes the roadmap and the week views that show links. */
function useRefresh() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: KEY })
    qc.invalidateQueries({ queryKey: ['week'] })
    qc.invalidateQueries({ queryKey: ['week-goal'] })
    qc.invalidateQueries({ queryKey: ['today'] })
  }
}

export function useDirectionActions() {
  const done = useRefresh()
  return {
    create: useMutation({ mutationFn: (b: { title: string; why?: string; targetDate?: string }) => api.post<Direction>('/api/milestones/directions', b).then(r => r.data), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...b }: Partial<Direction> & { id: number }) => api.put<Direction>(`/api/milestones/directions/${id}`, b).then(r => r.data), onSuccess: done }),
    archive: useMutation({ mutationFn: (id: number) => api.delete(`/api/milestones/directions/${id}`), onSuccess: done }),
  }
}

export function useMilestoneActions() {
  const done = useRefresh()
  return {
    create: useMutation({ mutationFn: (b: MilestoneInput) => api.post('/api/milestones', b).then(r => r.data), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...b }: MilestoneInput & { id: number }) => api.put(`/api/milestones/${id}`, b).then(r => r.data), onSuccess: done }),
    /** Measures from app data by default; this switches it to a number typed by hand, keeping the current reading. */
    unlink: useMutation({ mutationFn: ({ id, current }: { id: number; current: number | null }) => api.put(`/api/milestones/${id}`, { measure: 'manual', manualValue: current }).then(r => r.data), onSuccess: done }),
    setStatus: useMutation({ mutationFn: ({ id, status, date }: { id: number; status: MilestoneStatus; date?: string }) => api.post(`/api/milestones/${id}/status`, { status, date }).then(r => r.data), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: number) => api.delete<{ deleted?: boolean; dropped?: boolean }>(`/api/milestones/${id}`).then(r => r.data), onSuccess: done }),
    addStep: useMutation({ mutationFn: ({ id, title }: { id: number; title: string }) => api.post(`/api/milestones/${id}/steps`, { title }), onSuccess: done }),
    setStep: useMutation({ mutationFn: ({ id, ...b }: { id: number; title?: string; done?: boolean }) => api.put(`/api/milestones/steps/${id}`, b), onSuccess: done }),
    removeStep: useMutation({ mutationFn: (id: number) => api.delete(`/api/milestones/steps/${id}`), onSuccess: done }),
  }
}

/** Link a goal task up the chain: a weekly task to a monthly task, a monthly task or a habit to a milestone. null unlinks. */
export function useLinkTask() {
  const done = useRefresh()
  return useMutation({
    mutationFn: ({ id, ...b }: { id: number; parentTaskId?: number | null; milestoneId?: number | null }) => api.patch(`/api/week/tasks/${id}`, b),
    onSuccess: done,
  })
}

// ─── Up the chain, for the planner ───────────────────────────────────────────

export interface UpOption { id: number; title: string; group: string }
export interface UpChain {
  /** Which link a task of this horizon carries. */
  field: 'parentTaskId' | 'milestoneId'
  options: UpOption[]
  /** What the links point at, in a sentence: "November's goals", "your milestones". */
  target: string
  /** Why there is nothing to link to, when there isn't. */
  empty: string | null
  /** Where to set up the level above. */
  fix: { label: string; href: string } | null
}

/** Points a period may leave unlinked for life admin. */
export const FREE_POINTS = 2

/**
 * What a period starting on `from` can serve: a week serves the monthly goal
 * that contains it, a month serves the open milestones. Longer horizons have
 * nothing above them.
 */
export function useUpChain(horizon: Horizon, from: string | null): UpChain | null {
  const month = useWeek('monthly')
  const ms = useMilestones()
  if (horizon === 'weekly') {
    const goals = [month.data?.current, month.data?.next].filter(Boolean)
    const g = from ? goals.find(x => x!.from <= from && from <= x!.to) : null
    const label = from ? new Date(from + 'T12:00:00').toLocaleDateString('en-GB', { month: 'long' }) : 'the month'
    if (!g) return {
      field: 'parentTaskId', options: [], target: `${label}'s goals`,
      empty: month.isPending ? null : `${label} has no monthly goals yet. Set them, then each weekly goal can say which one it moves.`,
      fix: { label: `Set ${label}'s goals`, href: '/goals?horizon=monthly' },
    }
    const name = periodName('monthly', g.from, g.to, 0)
    return {
      field: 'parentTaskId', target: `${label}'s goals`, empty: g.tasks.length ? null : `${name} has no goals in it yet.`, fix: null,
      options: g.tasks.filter(t => t.id != null).map(t => ({ id: t.id!, title: t.title, group: name })),
    }
  }
  if (horizon === 'monthly') {
    const dirs = new Map((ms.data?.directions ?? []).map(d => [d.id, d.title]))
    const open = (ms.data?.milestones ?? []).filter(m => m.status === 'open')
    return {
      field: 'milestoneId', target: 'your milestones',
      empty: ms.isPending || open.length ? null : 'No open milestones yet. Add one on the Roadmap, then each monthly goal can say which one it moves.',
      fix: open.length ? null : { label: 'Open the Roadmap', href: '/goals?horizon=roadmap' },
      options: open.map(m => ({ id: m.id, title: m.title, group: m.kind === 'foundation' ? 'Foundation' : (m.directionId != null ? dirs.get(m.directionId) : null) ?? 'Milestones' })),
    }
  }
  return null
}
