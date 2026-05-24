import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useArchiveCompleted() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (entryId: number) => api.delete(`/api/checklists/entries/${entryId}/completed`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklist-entries'] })
      qc.invalidateQueries({ queryKey: ['checklist-task-streaks'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useChecklistTaskStreaks() {
  return useQuery({
    queryKey: ['checklist-task-streaks'],
    queryFn: () => api.get('/api/checklists/task-streaks').then(r => r.data as { templateItemId: number; streak: number }[]),
    staleTime: 60_000,
  })
}

export function useChecklistStreaks() {
  return useQuery({
    queryKey: ['checklist-streaks'],
    queryFn: () => api.get('/api/checklists/streaks').then(r => r.data as { templateId: number; streak: number; longestStreak: number }[]),
    staleTime: 60_000,
  })
}

export function useChecklistTemplates() {
  return useQuery({
    queryKey: ['checklist-templates'],
    queryFn: () => api.get('/api/checklists/templates').then(r => r.data),
  })
}

export function useChecklistEntries(date: string) {
  return useQuery({
    queryKey: ['checklist-entries', date],
    queryFn: () => api.get('/api/checklists/entries', { params: { date } }).then(r => r.data),
    enabled: !!date,
  })
}

export function useCreateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => api.post('/api/checklists/templates', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklist-templates'] }),
  })
}

export function useUpdateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: any) => api.put(`/api/checklists/templates/${id}`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklist-templates'] })
      qc.invalidateQueries({ queryKey: ['checklist-entries'] })
    },
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/checklists/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklist-templates'] }),
  })
}

export function useToggleChecklistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ entryId, itemId, completed }: { entryId: number; itemId: number; completed: boolean }) =>
      api.put(`/api/checklists/entries/${entryId}/items/${itemId}`, { completed }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklist-entries'] })
      qc.invalidateQueries({ queryKey: ['checklist-streaks'] })
      qc.invalidateQueries({ queryKey: ['checklist-task-streaks'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useAddAdhocItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ date, items }: { date: string; items: { label: string; time?: string; importance?: string }[] }) =>
      api.post('/api/checklists/entries/adhoc', { date, items }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklist-entries'] }),
  })
}

export function useDeleteChecklistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ entryId, itemId }: { entryId: number; itemId: number }) =>
      api.delete(`/api/checklists/entries/${entryId}/items/${itemId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklist-entries'] }),
  })
}
