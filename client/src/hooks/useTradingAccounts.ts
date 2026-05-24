import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface TradingAccount {
  id: number
  name: string
  broker: string | null
  currency: string
  startingBalance: number | null
  notes: string | null
  tradeCount: number
  createdAt: string
  updatedAt: string
}

export function useTradingAccounts() {
  return useQuery({
    queryKey: ['trading-accounts'],
    queryFn: () => api.get('/api/trading-accounts').then(r => r.data as TradingAccount[]),
  })
}

export function useCreateTradingAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<TradingAccount, 'id' | 'tradeCount' | 'createdAt' | 'updatedAt'>) =>
      api.post('/api/trading-accounts', data).then(r => r.data as TradingAccount),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trading-accounts'] }),
  })
}

export function useUpdateTradingAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<TradingAccount> & { id: number }) =>
      api.put(`/api/trading-accounts/${id}`, data).then(r => r.data as TradingAccount),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trading-accounts'] }),
  })
}

export function useDeleteTradingAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/trading-accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trading-accounts'] }),
  })
}
