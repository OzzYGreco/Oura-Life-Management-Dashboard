import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { loadFinanceSettings } from './useFinanceSettings'

function streamParams() {
  const s = loadFinanceSettings()
  return {
    includeTrading:   s.includeTrading          ? '1' : '0',
    includePaidInvoices: s.includePaidInvoices  ? '1' : '0',
    excludeBusiness:  s.excludeBusinessExpenses ? '1' : '0',
  }
}

export function useFinanceAccounts() {
  return useQuery({ queryKey: ['finance-accounts'], queryFn: () => api.get('/api/finance/accounts').then(r => r.data) })
}
export function useFinanceIncome(params = {}) {
  return useQuery({ queryKey: ['finance-income', params], queryFn: () => api.get('/api/finance/income', { params }).then(r => r.data) })
}
export function useFinanceExpenses(params: Record<string, any> = {}) {
  return useQuery({ queryKey: ['finance-expenses', params], queryFn: () => api.get('/api/finance/expenses', { params }).then(r => r.data) })
}
export function useRecurringExpenses() {
  return useQuery({ queryKey: ['finance-recurring'], queryFn: () => api.get('/api/finance/expenses', { params: { recurring: '1' } }).then(r => r.data) })
}
export function useFinanceSummary(params: Record<string, any> = {}) {
  const sp = streamParams()
  return useQuery({ queryKey: ['finance-summary', params, sp], queryFn: () => api.get('/api/finance/summary', { params: { ...params, ...sp } }).then(r => r.data) })
}
export function useNetWorth() {
  return useQuery({ queryKey: ['net-worth'], queryFn: () => api.get('/api/finance/net-worth').then(r => r.data) })
}
export function useCashFlow() {
  const sp = streamParams()
  return useQuery({ queryKey: ['cashflow', sp], queryFn: () => api.get('/api/finance/cashflow', { params: sp }).then(r => r.data), staleTime: 30_000 })
}
export function useIncomeStreams(params: Record<string, any> = {}) {
  const sp = streamParams()
  return useQuery({ queryKey: ['income-streams', params, sp], queryFn: () => api.get('/api/finance/streams', { params: { ...params, ...sp } }).then(r => r.data) })
}
export function useFinanceBudgets() {
  return useQuery({ queryKey: ['finance-budgets'], queryFn: () => api.get('/api/finance/budgets').then(r => r.data) })
}

// Mutations
function makeFinanceMutations(entity: string, queryKey: string) {
  return {
    useCreate: () => {
      const qc = useQueryClient()
      return useMutation({ mutationFn: (d: any) => api.post(`/api/finance/${entity}`, d).then(r => r.data), onSuccess: () => { qc.invalidateQueries({ queryKey: [queryKey] }); qc.invalidateQueries({ queryKey: ['finance-summary'] }); qc.invalidateQueries({ queryKey: ['cashflow'] }) } })
    },
    useUpdate: () => {
      const qc = useQueryClient()
      return useMutation({ mutationFn: ({ id, ...d }: any) => api.put(`/api/finance/${entity}/${id}`, d).then(r => r.data), onSuccess: () => { qc.invalidateQueries({ queryKey: [queryKey] }); qc.invalidateQueries({ queryKey: ['finance-summary'] }); qc.invalidateQueries({ queryKey: ['cashflow'] }) } })
    },
    useDelete: () => {
      const qc = useQueryClient()
      return useMutation({ mutationFn: (id: number) => api.delete(`/api/finance/${entity}/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: [queryKey] }); qc.invalidateQueries({ queryKey: ['finance-summary'] }); qc.invalidateQueries({ queryKey: ['cashflow'] }) } })
    },
  }
}

export const { useCreate: useCreateAccount, useUpdate: useUpdateAccount, useDelete: useDeleteAccount } = makeFinanceMutations('accounts', 'finance-accounts')
export const { useCreate: useCreateIncome, useUpdate: useUpdateIncome, useDelete: useDeleteIncome } = makeFinanceMutations('income', 'finance-income')
export const { useCreate: useCreateExpense, useUpdate: useUpdateExpense, useDelete: useDeleteExpense } = makeFinanceMutations('expenses', 'finance-expenses')

export function useUpsertBudget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: any) => api.post('/api/finance/budgets', d).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance-budgets'] }),
  })
}
export function useDeleteBudget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/finance/budgets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance-budgets'] }),
  })
}
