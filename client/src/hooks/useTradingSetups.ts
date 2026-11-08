import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface TradingSetup {
  id: number
  name: string
  description: string | null
  archived: boolean
  trades: number
  wins: number
  losses: number
  netR: number | null
  avgR: number | null
  firstUsed: string | null
  lastUsed: string | null
  /** Setups whose name looks like the same one (case, spacing, a typo) */
  sameAs: number[]
}

function useRefresh() {
  const qc = useQueryClient()
  return () => { for (const k of ['trading-setups', 'setup-labels', 'trades']) qc.invalidateQueries({ queryKey: [k] }) }
}

export function useTradingSetups() {
  return useQuery({
    queryKey: ['trading-setups'],
    queryFn: () => api.get('/api/trading-setups').then(r => r.data as TradingSetup[]),
  })
}

export function useUpdateSetup() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; name?: string; description?: string | null; archived?: boolean }) =>
      api.put(`/api/trading-setups/${id}`, body).then(r => r.data),
    onSuccess: refresh,
  })
}

export function useCreateSetup() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: { name: string; description?: string }) => api.post('/api/trading-setups', body).then(r => r.data),
    onSuccess: refresh,
  })
}

export function useMergeSetup() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ id, intoId }: { id: number; intoId: number }) =>
      api.post(`/api/trading-setups/${id}/merge`, { intoId }).then(r => r.data as { moved: number; into: string }),
    onSuccess: refresh,
  })
}

export function useDeleteSetup() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/trading-setups/${id}`).then(r => r.data as { archived: boolean } | undefined),
    onSuccess: refresh,
  })
}
