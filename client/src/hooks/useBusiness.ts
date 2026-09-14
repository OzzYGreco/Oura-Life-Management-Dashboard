import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  BusinessMetrics, ClientRow, LedgerRow, LedgerTotals,
  Retainer, Service, ActiveProject, NeedRow, OwnerPay,
} from '../pages/Business/lib/types'

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

// ─── Business v4: server-computed figures ────────────────────────────────────
//
// Everything below reads from one metrics engine on the server, so the Business
// tab, the Dashboard panel and the Finances page cannot drift apart again.


export interface DateRange { from?: string; to?: string }

/** Every figure the Overview and Money tabs show, in one request. */
export interface OwnerPayOpts { taxReserveEnabled?: boolean; taxRatePct?: number; bufferMonths?: number }

export function useBusinessMetrics(range: DateRange = {}, opts: OwnerPayOpts = {}) {
  const params = { ...range, ...opts }
  return useQuery<BusinessMetrics>({
    queryKey: ['business-metrics', params],
    queryFn: () => api.get('/api/business/metrics', { params }).then(r => r.data),
  })
}

export function useClientRows() {
  return useQuery<ClientRow[]>({
    queryKey: ['client-rows'],
    queryFn: () => api.get('/api/business/clients/overview').then(r => r.data),
  })
}

export function useClientSummary(clientId: number | null) {
  return useQuery<any>({
    queryKey: ['client-summary', clientId],
    queryFn: () => api.get(`/api/business/clients/${clientId}/summary`).then(r => r.data),
    enabled: !!clientId,
  })
}

export function useLedger(range: DateRange = {}) {
  return useQuery<{ rows: LedgerRow[]; totals: LedgerTotals }>({
    queryKey: ['ledger', range],
    queryFn: () => api.get('/api/business/invoices/ledger', { params: range }).then(r => r.data),
  })
}

export function useRetainers() {
  return useQuery<Retainer[]>({
    queryKey: ['retainers'],
    queryFn: () => api.get('/api/business/retainers').then(r => r.data),
  })
}

export function useServices() {
  return useQuery<Service[]>({
    queryKey: ['services'],
    queryFn: () => api.get('/api/business/services').then(r => r.data),
  })
}

export function useActiveProjects() {
  return useQuery<ActiveProject[]>({
    queryKey: ['projects-active'],
    queryFn: () => api.get('/api/business/projects/active').then(r => r.data),
  })
}

export function useNeeds() {
  return useQuery<NeedRow[]>({
    queryKey: ['business-needs'],
    queryFn: () => api.get('/api/business/needs').then(r => r.data),
  })
}

export function useOwnerPay(range: DateRange = {}, opts: OwnerPayOpts = {}) {
  const params = { ...range, ...opts }
  return useQuery<OwnerPay>({
    queryKey: ['owner-pay', params],
    queryFn: () => api.get('/api/business/owner-draws', { params }).then(r => r.data),
  })
}

/**
 * Anything that changes money changes almost every figure on the page, and the
 * Dashboard and Finances panels too. Invalidating a single query key is how the
 * old page ended up showing stale revenue on three other screens.
 */
function useBusinessMutation<TArgs>(fn: (args: TArgs) => Promise<any>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of [
        'business-metrics', 'client-rows', 'client-summary', 'ledger', 'retainers',
        'projects-active', 'business-needs', 'owner-pay', 'invoices', 'clients',
        'projects', 'dashboard', 'finance-summary', 'income-streams', 'cashflow',
        'expenses', 'time-entries-all', 'campaigns', 'campaign-spend', 'ad-spend-status', 'payment-status', 'payments', 'payments-unassigned',
      ]) qc.invalidateQueries({ queryKey: [key] })
    },
  })
}

/** The composer: client, website, milestone invoices and retainers in one call. */
export function useCreateDeal() {
  return useBusinessMutation((deal: any) => api.post('/api/business/deals', deal).then(r => r.data))
}

export function usePayInvoice() {
  return useBusinessMutation(({ id, ...body }: { id: number; paidDate?: string; feeAmount?: number; netReceived?: number }) =>
    api.post(`/api/business/invoices/${id}/pay`, body).then(r => r.data))
}

export function useUnpayInvoice() {
  return useBusinessMutation((id: number) => api.post(`/api/business/invoices/${id}/unpay`).then(r => r.data))
}

export function useSendInvoice() {
  return useBusinessMutation((id: number) => api.post(`/api/business/invoices/${id}/send`).then(r => r.data))
}

export function useCreateRetainer() {
  return useBusinessMutation((body: any) => api.post('/api/business/retainers', body).then(r => r.data))
}

export function useChangeRetainerPrice() {
  return useBusinessMutation(({ id, ...body }: { id: number; newAmount: number; effectiveDate?: string; reason?: string }) =>
    api.put(`/api/business/retainers/${id}/price`, body).then(r => r.data))
}

export function useRetainerLifecycle() {
  return useBusinessMutation(({ id, action, ...body }: { id: number; action: 'pause' | 'resume' | 'cancel'; endDate?: string; reason?: string }) =>
    api.post(`/api/business/retainers/${id}/${action}`, body).then(r => r.data))
}

export function useRecordDraw() {
  return useBusinessMutation((body: {
    ownerId: number; amount: number; date?: string; method?: string; notes?: string; postToFinances?: boolean
  }) => api.post('/api/business/owner-draws', body).then(r => r.data))
}

export function useDeleteDraw() {
  return useBusinessMutation((id: number) => api.delete(`/api/business/owner-draws/${id}`))
}

export function useLogTime() {
  return useBusinessMutation(({ projectId, ...body }: { projectId: number; hours: number; date?: string; description?: string }) =>
    api.post(`/api/business/projects/${projectId}/time`, body).then(r => r.data))
}

// ─── Daily ad spend ──────────────────────────────────────────────────────────

export function useAdSpendStatus() {
  return useQuery<{
    platforms: string[]; connected: boolean; meta: boolean
    recordedDays: number; recordedTotal: number; latestDate: string | null
  }>({
    queryKey: ['ad-spend-status'],
    queryFn: () => api.get('/api/business/ad-spend/status').then(r => r.data),
  })
}

export function useCampaignSpend(campaignId: number | null) {
  return useQuery<any[]>({
    queryKey: ['campaign-spend', campaignId],
    queryFn: () => api.get(`/api/business/campaigns/${campaignId}/spend`).then(r => r.data),
    enabled: !!campaignId,
  })
}

export function useLogAdSpend() {
  return useBusinessMutation(({ campaignId, ...body }: { campaignId: number; date: string; spend: number }) =>
    api.post(`/api/business/campaigns/${campaignId}/spend`, body).then(r => r.data))
}

export function useDeleteAdSpend() {
  return useBusinessMutation((id: number) => api.delete(`/api/business/ad-spend/${id}`))
}

export function useSyncAdSpend() {
  return useBusinessMutation((lookbackDays: number = 14) =>
    api.post('/api/business/ad-spend/sync', { lookbackDays }).then(r => r.data))
}

/**
 * Change what a recurring cost costs, saying what the new price means.
 * Editing the amount on its own only ever touched one charge, and the next
 * month regenerated at the old price.
 */
export function useChangeCostPrice() {
  return useBusinessMutation(({ id, ...body }: { id: number; newAmount: number; scope: 'this' | 'future' | 'all' }) =>
    api.put(`/api/finance/expenses/${id}/price`, body).then(r => r.data))
}

// ─── Stripe payments ─────────────────────────────────────────────────────────

export function usePaymentStatus() {
  return useQuery<{
    connected: boolean; note: string; payments: number; unmatched: number
    feesPaid: number; latestDate: string | null; clientsLinked: number
  }>({
    queryKey: ['payment-status'],
    queryFn: () => api.get('/api/business/payments/status').then(r => r.data),
  })
}

export function useUnassignedPayments() {
  return useQuery<{ payments: any[]; takenInvoiceIds: number[] }>({
    queryKey: ['payments-unassigned'],
    queryFn: () => api.get('/api/business/payments/unassigned').then(r => r.data),
  })
}

export function usePayments(limit = 100) {
  return useQuery<any[]>({
    queryKey: ['payments', limit],
    queryFn: () => api.get('/api/business/payments', { params: { limit } }).then(r => r.data),
  })
}

export function useSyncPayments() {
  return useBusinessMutation((lookbackDays: number = 45) =>
    api.post('/api/business/payments/sync', { lookbackDays }).then(r => r.data))
}

export function useAssignPayment() {
  return useBusinessMutation(({ id, ...body }: {
    id: number; clientId: number; invoiceId?: number | null; invoiceIds?: number[]; remember?: boolean
  }) => api.post(`/api/business/payments/${id}/assign`, body).then(r => r.data))
}

export function useIgnorePayment() {
  return useBusinessMutation((id: number) =>
    api.post(`/api/business/payments/${id}/ignore`).then(r => r.data))
}
