import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useClients() {
  return useQuery({ queryKey: ['clients'], queryFn: () => api.get('/api/business/clients').then(r => r.data) })
}
export function useProjects(params = {}) {
  return useQuery({ queryKey: ['projects', params], queryFn: () => api.get('/api/business/projects', { params }).then(r => r.data) })
}
export function useProjectTasks(projectId: number) {
  return useQuery({ queryKey: ['project-tasks', projectId], queryFn: () => api.get(`/api/business/projects/${projectId}/tasks`).then(r => r.data), enabled: !!projectId })
}
export function useInvoices(params = {}) {
  return useQuery({ queryKey: ['invoices', params], queryFn: () => api.get('/api/business/invoices', { params }).then(r => r.data) })
}
export function useMeetingNotes(params = {}) {
  return useQuery({ queryKey: ['meeting-notes', params], queryFn: () => api.get('/api/business/meeting-notes', { params }).then(r => r.data) })
}

function crud(base: string, qk: string) {
  return {
    useCreate: () => { const qc = useQueryClient(); return useMutation({ mutationFn: (d: any) => api.post(base, d).then(r => r.data), onSuccess: () => qc.invalidateQueries({ queryKey: [qk] }) }) },
    useUpdate: () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...d }: any) => api.put(`${base}/${id}`, d).then(r => r.data), onSuccess: () => qc.invalidateQueries({ queryKey: [qk] }) }) },
    useDelete: () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: number) => api.delete(`${base}/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: [qk] }) }) },
  }
}

export const { useCreate: useCreateClient, useUpdate: useUpdateClient, useDelete: useDeleteClient } = crud('/api/business/clients', 'clients')
export const { useCreate: useCreateProject, useUpdate: useUpdateProject, useDelete: useDeleteProject } = crud('/api/business/projects', 'projects')
export const { useCreate: useCreateInvoice, useUpdate: useUpdateInvoice, useDelete: useDeleteInvoice } = crud('/api/business/invoices', 'invoices')
export const { useCreate: useCreateMeetingNote, useUpdate: useUpdateMeetingNote, useDelete: useDeleteMeetingNote } = crud('/api/business/meeting-notes', 'meeting-notes')
export const { useCreate: useCreateCampaign, useUpdate: useUpdateCampaign, useDelete: useDeleteCampaign } = crud('/api/business/campaigns', 'campaigns')

export function useCampaigns() {
  return useQuery({ queryKey: ['campaigns'], queryFn: () => api.get('/api/business/campaigns').then(r => r.data) })
}

export function useTimeEntries(projectId: number) {
  return useQuery({ queryKey: ['time-entries', projectId], queryFn: () => api.get(`/api/business/projects/${projectId}/time`).then(r => r.data), enabled: !!projectId })
}
export function useAllTimeEntries() {
  return useQuery({ queryKey: ['time-entries-all'], queryFn: () => api.get('/api/business/time').then(r => r.data) })
}
export function useCreateTimeEntry(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: any) => api.post(`/api/business/projects/${projectId}/time`, d).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['time-entries', projectId] }); qc.invalidateQueries({ queryKey: ['time-entries-all'] }) },
  })
}
export function useDeleteTimeEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/business/time/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['time-entries'] }); qc.invalidateQueries({ queryKey: ['time-entries-all'] }) },
  })
}

export function useCreateTask(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: any) => api.post(`/api/business/projects/${projectId}/tasks`, d).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-tasks', projectId] }),
  })
}
export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...d }: any) => api.put(`/api/business/tasks/${id}`, d).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-tasks'] }),
  })
}
export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/business/tasks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-tasks'] }),
  })
}
