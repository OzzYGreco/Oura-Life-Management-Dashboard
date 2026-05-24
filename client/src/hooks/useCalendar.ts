import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useCalendarEvents(params: { from?: string; to?: string } = {}) {
  return useQuery({ queryKey: ['calendar-events', params], queryFn: () => api.get('/api/calendar/events', { params }).then(r => r.data) })
}

export function useCreateEvent() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (d: any) => api.post('/api/calendar/events', d).then(r => r.data), onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar-events'] }) })
}
export function useUpdateEvent() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, ...d }: any) => api.put(`/api/calendar/events/${id}`, d).then(r => r.data), onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar-events'] }) })
}
export function useDeleteEvent() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.delete(`/api/calendar/events/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar-events'] }) })
}
