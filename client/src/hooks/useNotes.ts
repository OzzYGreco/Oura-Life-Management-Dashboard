import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useNotes(params: { categoryId?: number; q?: string } = {}) {
  return useQuery({ queryKey: ['notes', params], queryFn: () => api.get('/api/notes', { params }).then(r => r.data) })
}
export function useNote(id: number) {
  return useQuery({ queryKey: ['note', id], queryFn: () => api.get(`/api/notes/${id}`).then(r => r.data), enabled: !!id })
}
export function useNoteCategories() {
  return useQuery({ queryKey: ['note-categories'], queryFn: () => api.get('/api/notes/categories/all').then(r => r.data) })
}
export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (d: any) => api.post('/api/notes/categories', d).then(r => r.data), onSuccess: () => qc.invalidateQueries({ queryKey: ['note-categories'] }) })
}
export function useUpdateCategory() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, ...d }: any) => api.put(`/api/notes/categories/${id}`, d).then(r => r.data), onSuccess: () => qc.invalidateQueries({ queryKey: ['note-categories'] }) })
}
export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.delete(`/api/notes/categories/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['note-categories'] }); qc.invalidateQueries({ queryKey: ['notes'] }) } })
}

export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (d: any) => api.post('/api/notes', d).then(r => r.data), onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }) })
}
export function useUpdateNote() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, ...d }: any) => api.put(`/api/notes/${id}`, d).then(r => r.data), onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['note', v.id] }) } })
}
export function useDeleteNote() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.delete(`/api/notes/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['notes-deleted'] }) } })
}
export function useDeletedNotes() {
  return useQuery({ queryKey: ['notes-deleted'], queryFn: () => api.get('/api/notes/deleted').then(r => r.data) })
}
export function useRestoreNote() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.post(`/api/notes/${id}/restore`).then(r => r.data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['notes-deleted'] }) } })
}
export function usePermanentlyDeleteNote() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.delete(`/api/notes/${id}/permanent`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notes-deleted'] }) })
}
export function useUploadNoteImages() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ noteId, files }: { noteId: number; files: File[] }) => {
      const fd = new FormData()
      files.forEach(f => fd.append('images', f))
      return api.post(`/api/notes/${noteId}/images`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  })
}
