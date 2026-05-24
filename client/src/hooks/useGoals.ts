import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface GoalTask {
  id: number
  goalId: number
  title: string
  maxPoints: number
  earnedPoints: number | null
  notes?: string
  sortOrder: number
}

export interface GoalReward {
  id: number
  goalId: number
  minScore: number
  reward: string
  sortOrder: number
}

export interface Goal {
  id: number
  horizon: string
  focus: string
  periodStart?: string
  periodEnd?: string
  status: string
  tasks: GoalTask[]
  rewards: GoalReward[]
  maxPoints: number
  earnedPoints: number
  progressPct: number
  createdAt: string
}

export function useGoals(horizon?: string) {
  return useQuery({
    queryKey: ['goals', horizon],
    queryFn: () => api.get('/api/goals', { params: horizon ? { horizon } : {} }).then(r => r.data as Goal[]),
  })
}

export function useGoal(id: number) {
  return useQuery({
    queryKey: ['goal', id],
    queryFn: () => api.get(`/api/goals/${id}`).then(r => r.data as Goal),
    enabled: !!id,
  })
}

export function useCreateGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => api.post('/api/goals', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useUpdateGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: any) => api.put(`/api/goals/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useScoreTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, earnedPoints }: { taskId: number; earnedPoints: number | null }) =>
      api.patch(`/api/goals/tasks/${taskId}`, { earnedPoints }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useDeleteGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/goals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}
