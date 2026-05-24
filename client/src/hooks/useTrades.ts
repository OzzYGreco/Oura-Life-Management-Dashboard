import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Trade {
  id: number
  accountId?: number | null
  date: string
  time?: string
  durationMinutes?: number
  instrument: string
  asset: string
  direction: string
  orderType: string
  entryPrice: number
  stopLoss?: number
  exitPrice?: number
  size?: number | null
  riskDollars?: number
  expectedLoss?: number
  realizedPnl?: number
  deviationPct?: number
  rrRatio?: number
  exitOrderType?: string
  entryFeeAmount?: number
  exitFeeAmount?: number
  slippageAmount?: number
  netPnl?: number
  rulesMet?: number | null
  setupLabel?: string
  quickNote?: string
  mistakes?: string[]
  mistakesOther?: string
  tags?: string[]
  createdAt: string
  updatedAt: string
  screenshots?: { id: number; filePath: string; note?: string; sortOrder: number }[]
}

export function useTrades(filters: Record<string, string> = {}) {
  return useQuery({
    queryKey: ['trades', filters],
    queryFn: () => api.get('/api/trades', { params: filters }).then(r => r.data as Trade[]),
  })
}

export function useTradeAnalyticsSummary(params: Record<string, string> = {}) {
  return useQuery({
    queryKey: ['trades-summary', params],
    queryFn: () => api.get('/api/trades/analytics/summary', { params }).then(r => r.data),
  })
}

export function useTradeEquityCurve(params: Record<string, string> = {}) {
  return useQuery({
    queryKey: ['trades-equity', params],
    queryFn: () => api.get('/api/trades/analytics/equity', { params }).then(r => r.data),
  })
}

export function useTradeMistakes(params: Record<string, string> = {}) {
  return useQuery({
    queryKey: ['trades-mistakes', params],
    queryFn: () => api.get('/api/trades/analytics/mistakes', { params }).then(r => r.data),
  })
}

export function useCreateTrade() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Trade>) => api.post('/api/trades', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useUpdateTrade() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Trade> & { id: number }) =>
      api.put(`/api/trades/${id}`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useDeleteTrade() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/trades/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useUploadScreenshots() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tradeId, files, notes }: { tradeId: number; files: File[]; notes: string[] }) => {
      const fd = new FormData()
      files.forEach(f => fd.append('screenshots', f))
      notes.forEach(n => fd.append('notes', n))
      return api.post(`/api/trades/${tradeId}/screenshots`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then(r => r.data)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trades'] }),
  })
}
