import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useWorkouts(params = {}) {
  return useQuery({ queryKey: ['workouts', params], queryFn: () => api.get('/api/training/workouts', { params }).then(r => r.data) })
}
export function useBodyMetrics(params = {}) {
  return useQuery({ queryKey: ['body-metrics', params], queryFn: () => api.get('/api/training/metrics', { params }).then(r => r.data) })
}
export function useWeeklySchedule(weekStart: string) {
  return useQuery({ queryKey: ['weekly-schedule', weekStart], queryFn: () => api.get('/api/training/schedule', { params: { weekStart } }).then(r => r.data), enabled: !!weekStart })
}

export function useCreateWorkout() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (d: any) => api.post('/api/training/workouts', d).then(r => r.data), onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }) })
}
export function useUpdateWorkout() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, ...d }: any) => api.put(`/api/training/workouts/${id}`, d).then(r => r.data), onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }) })
}
export function useDeleteWorkout() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.delete(`/api/training/workouts/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }) })
}
export function useCreateMetric() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (d: any) => api.post('/api/training/metrics', d).then(r => r.data), onSuccess: () => qc.invalidateQueries({ queryKey: ['body-metrics'] }) })
}
export function useUpdateMetric() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, ...d }: any) => api.put(`/api/training/metrics/${id}`, d).then(r => r.data), onSuccess: () => qc.invalidateQueries({ queryKey: ['body-metrics'] }) })
}
export function useDeleteMetric() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.delete(`/api/training/metrics/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['body-metrics'] }) })
}
export function useUpdateSchedule() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (d: any) => api.put('/api/training/schedule', d).then(r => r.data), onSuccess: () => qc.invalidateQueries({ queryKey: ['weekly-schedule'] }) })
}

// ─── Workout Templates ────────────────────────────────────────────────────────

export function useWorkoutTemplates() {
  return useQuery({ queryKey: ['workout-templates'], queryFn: () => api.get('/api/training/templates').then(r => r.data) })
}
export function useCreateTemplate() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (d: any) => api.post('/api/training/templates', d).then(r => r.data), onSuccess: () => qc.invalidateQueries({ queryKey: ['workout-templates'] }) })
}
export function useUpdateTemplate() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, ...d }: any) => api.put(`/api/training/templates/${id}`, d).then(r => r.data), onSuccess: () => qc.invalidateQueries({ queryKey: ['workout-templates'] }) })
}
export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.delete(`/api/training/templates/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['workout-templates'] }) })
}
