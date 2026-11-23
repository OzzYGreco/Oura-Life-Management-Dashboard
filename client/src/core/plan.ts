/**
 * Planning a day ahead: what runs that day, what was skipped for it, and
 * one-tap suggestions. Shared by Today (a day ahead) and the evening review.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Parsed } from './routine'

export interface PlanPick { label: string; time: string | null; importance: string | null; windowMin: number | null; from?: string }
export interface PlanItem {
  id: number; label: string; time: string | null; importance: string | null; points: number
  status: string; oneOff: boolean; start: number | null; end: number | null
}
export interface DayPlan {
  date: string
  today: string
  /** Why the day can't be changed, or null when it can. */
  locked: string | null
  items: PlanItem[]
  total: number
  skipped: { id: number; label: string; time: string | null }[]
  suggestions: { unfinished: PlanPick[]; recent: PlanPick[]; paused: PlanPick[] }
}

const KEY = ['day-plan']

export function useDayPlan(date: string | null) {
  return useQuery({
    queryKey: [...KEY, date],
    queryFn: () => api.get<DayPlan>('/api/routine/plan', { params: date ? { date } : undefined }).then(r => r.data),
    enabled: !!date,
  })
}

/** Everything a plan change can move: the plan, the day views, the Routine page. */
function useRefresh() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: KEY })
    qc.invalidateQueries({ queryKey: ['today'] })
    qc.invalidateQueries({ queryKey: ['routine'] })
  }
}

/** A parsed line or a suggestion, as the server takes it. */
export const toItem = (p: Pick<Parsed, 'label' | 'time' | 'importance' | 'windowMin'>) =>
  ({ label: p.label, time: p.time, importance: p.importance, windowMin: p.windowMin })

export function usePlan() {
  const refresh = useRefresh()
  return {
    add: useMutation({
      mutationFn: (b: { date: string; items: ReturnType<typeof toItem>[] }) => api.post('/api/routine/oneoffs', b),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: number) => api.delete(`/api/routine/oneoffs/${id}`), onSuccess: refresh }),
    restore: useMutation({ mutationFn: (id: number) => api.post(`/api/routine/oneoffs/${id}/restore`), onSuccess: refresh }),
    /** Leave a routine item out of one day, or bring it back. */
    skip: useMutation({ mutationFn: ({ id, skip }: { id: number; skip: boolean }) => api.post(`/api/routine/items/${id}/skip`, { skip }), onSuccess: refresh }),
  }
}

export const errText = (e: unknown) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't do that."
