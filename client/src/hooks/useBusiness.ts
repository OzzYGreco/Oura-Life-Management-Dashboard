import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  BusinessMetrics, ClientRow, LedgerRow, LedgerTotals,
  Retainer, Service, ActiveProject, NeedRow, OwnerPay,
  InvoiceDetail, PaymentRow, PaymentOptions,
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
/** Keyed under 'invoices' so every invoice mutation refreshes it too. */
export function useInvoice(id: number | null | undefined) {
  return useQuery<InvoiceDetail>({ queryKey: ['invoices', 'one', id], queryFn: () => api.get(`/api/business/invoices/${id}`).then(r => r.data), enabled: !!id })
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
        'payment-options', 'meeting-notes', 'comeback',
      ]) qc.invalidateQueries({ queryKey: [key] })
    },
  })
}

/** The composer: client, website, milestone invoices and retainers in one call. */
export function useCreateDeal() {
  return useBusinessMutation((deal: any) => api.post('/api/business/deals', deal).then(r => r.data))
}

/** Record money received: all of what is left by default, or part of it. */
export function usePayInvoice() {
  return useBusinessMutation(({ id, ...body }: {
    id: number; paidDate?: string; amount?: number; feeAmount?: number; method?: 'bank' | 'cash' | 'stripe'; note?: string
  }) => api.post(`/api/business/invoices/${id}/pay`, body).then(r => r.data))
}

export function useVoidInvoice() {
  return useBusinessMutation(({ id, reason }: { id: number; reason?: string | null }) =>
    api.post(`/api/business/invoices/${id}/void`, { reason }).then(r => r.data))
}

export function useRestoreInvoice() {
  return useBusinessMutation((id: number) => api.post(`/api/business/invoices/${id}/restore`).then(r => r.data))
}

/** Delete is only for a draft or a void invoice nothing was paid against. */
export function useRemoveInvoice() {
  return useBusinessMutation((id: number) => api.delete(`/api/business/invoices/${id}`))
}

export function useBulkInvoices() {
  return useBusinessMutation((body: { ids: number[]; action: 'pay' | 'send' | 'void'; paidDate?: string; reason?: string }) =>
    api.post('/api/business/invoices/bulk', body).then(r => r.data as { done: number }))
}

/** Remove one recorded payment. A Stripe one returns to the queue whole. */
export function useRemoveAllocation() {
  return useBusinessMutation((id: number) => api.delete(`/api/business/allocations/${id}`))
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

export interface PricePlan {
  effectiveDate: string
  correction: boolean
  oldAmount: number
  newAmount: number
  mrrDelta: number
  repriced: { id: number; invoiceNumber: string; from: number; to: number; periodStart: string | null }[]
  untouchedPaid: { id: number; invoiceNumber: string; amount: number }[]
  earlier: { id: number; invoiceNumber: string; amount: number; periodStart: string | null }[]
  nextInvoiceDate: string | null
}

export type PriceBody = {
  newAmount: number; effectiveDate?: string; correction?: boolean; reason?: string
  serviceId?: number | null; name?: string
}

/** What a price change would do, before it is made. Same route, `dryRun`. */
export function usePricePreview(id: number | null, body: PriceBody | null) {
  return useQuery<PricePlan>({
    queryKey: ['price-preview', id, body],
    queryFn: () => api.put(`/api/business/retainers/${id}/price`, { ...body, dryRun: true }).then(r => r.data),
    enabled: !!id && !!body && body.newAmount > 0,
    retry: false,
  })
}

export function useChangeRetainerPrice() {
  return useBusinessMutation(({ id, ...body }: { id: number } & PriceBody) =>
    api.put(`/api/business/retainers/${id}/price`, body).then(r => r.data))
}

export interface PlanChange {
  newAmount: number
  serviceId?: number | null
  from: 'now' | 'next'
  openInvoice?: 'keep' | 'writeoff'
  reason?: string
}
export interface PlanChangePreview extends PricePlan {
  sentence: string
  writtenOff: string[]
  leftOpen: { invoiceNumber: string; amount: number }[]
}

/** The one-step plan change, previewed as a sentence before it is made. */
export function usePlanChangePreview(retainerId: number | null, body: PlanChange | null) {
  return useQuery<PlanChangePreview>({
    queryKey: ['plan-change-preview', retainerId, body],
    queryFn: () => api.post(`/api/business/retainers/${retainerId}/change`, { ...body, dryRun: true }).then(r => r.data),
    enabled: !!retainerId && !!body && body.newAmount >= 0,
    retry: false,
  })
}

export function useChangePlan() {
  return useBusinessMutation(({ id, ...body }: { id: number } & PlanChange) =>
    api.post(`/api/business/retainers/${id}/change`, body).then(r => r.data as PlanChangePreview))
}

export interface ClientPaymentPlan {
  splits: { invoiceId: number; invoiceNumber: string; amount: number; owed: number; settles: boolean }[]
  leftOver: number
  owedTotal: number
}
export type ClientPaymentBody = { amount: number; date?: string; fee?: number; method?: 'bank' | 'cash' | 'stripe' }

/** One payment from a client, spread over what they owe, oldest first. */
export function useClientPaymentPreview(clientId: number | null, body: ClientPaymentBody | null) {
  return useQuery<ClientPaymentPlan>({
    queryKey: ['client-payment-preview', clientId, body],
    queryFn: () => api.post(`/api/business/clients/${clientId}/payments`, { ...body, dryRun: true }).then(r => r.data),
    enabled: !!clientId && !!body && body.amount > 0,
    retry: false,
  })
}

export function useRecordClientPayment() {
  return useBusinessMutation(({ clientId, ...body }: { clientId: number } & ClientPaymentBody) =>
    api.post(`/api/business/clients/${clientId}/payments`, body).then(r => r.data as ClientPaymentPlan))
}

export function useUpdateRetainer() {
  return useBusinessMutation(({ id, ...body }: { id: number; [k: string]: any }) =>
    api.put(`/api/business/retainers/${id}`, body).then(r => r.data))
}

export function useRetainerLifecycle() {
  return useBusinessMutation(({ id, action, ...body }: {
    id: number; action: 'pause' | 'resume' | 'cancel' | 'reinstate'
    endDate?: string; reason?: string; voidOpen?: boolean; date?: string
  }) => api.post(`/api/business/retainers/${id}/${action}`, body).then(r => r.data))
}

export function useCancelPreview(id: number | null, endDate: string | null) {
  return useQuery<{ endDate: string; voided: { id: number; invoiceNumber: string; amount: number; periodStart: string | null }[] }>({
    queryKey: ['cancel-preview', id, endDate],
    queryFn: () => api.post(`/api/business/retainers/${id}/cancel`, { endDate, dryRun: true }).then(r => r.data),
    enabled: !!id && !!endDate,
    retry: false,
  })
}

export function useDeleteRetainer() {
  return useBusinessMutation((id: number) => api.delete(`/api/business/retainers/${id}`))
}

// ─── Client lifecycle ────────────────────────────────────────────────────────

export interface DropPlan {
  client: { id: number; name: string }
  endDate: string
  retainers: { id: number; name: string; amount: number; frequency: string; status: string; endsOn: string; mrr: number }[]
  mrrLost: number
  endsEarlier?: { id: number; from: string | null; to: string }[]
  voided: {
    id: number; invoiceNumber: string; amount: number; owed: number; issueDate: string; dueDate: string
    status: string; canKeep: boolean; keepOwed: boolean
  }[]
  stillOwed: { id: number; invoiceNumber: string; amount: number; owed: number; issueDate: string; dueDate: string; writeOff: boolean }[]
  projects: { id: number; name: string; stage: string }[]
}

export function useDropPreview(clientId: number | null, endDate: string | null) {
  return useQuery<DropPlan>({
    queryKey: ['drop-preview', clientId, endDate],
    queryFn: () => api.post(`/api/business/clients/${clientId}/drop`, { endDate, dryRun: true }).then(r => r.data),
    enabled: !!clientId && !!endDate,
    retry: false,
  })
}

export function useDropClient() {
  return useBusinessMutation(({ id, ...body }: {
    id: number; endDate: string; reason?: string; writeOffInvoiceIds: number[]; keepOwedInvoiceIds: number[]
  }) =>
    api.post(`/api/business/clients/${id}/drop`, body).then(r => r.data as DropPlan))
}

export interface Comeback {
  invoices: { id: number; invoiceNumber: string; amount: number; issueDate: string; voidedAt: string | null; voidReason: string | null }[]
  retainers: { id: number; name: string; amount: number; frequency: string; endDate: string | null }[]
}

/** What a returning client could pick back up: voided debts and ended retainers. */
export function useComeback(clientId: number | null) {
  return useQuery<Comeback>({
    queryKey: ['comeback', clientId],
    queryFn: () => api.get(`/api/business/clients/${clientId}/comeback`).then(r => r.data),
    enabled: !!clientId,
  })
}

export function useReactivateClient() {
  return useBusinessMutation(({ id, ...body }: { id: number; restoreInvoiceIds?: number[]; reinstateRetainerIds?: number[] }) =>
    api.post(`/api/business/clients/${id}/reactivate`, body).then(r => r.data))
}

export function useRemoveClient() {
  return useBusinessMutation((id: number) => api.delete(`/api/business/clients/${id}`))
}

export function useSaveClient() {
  return useBusinessMutation(({ id, ...body }: { id?: number; [k: string]: any }) =>
    (id ? api.put(`/api/business/clients/${id}`, body) : api.post('/api/business/clients', body)).then(r => r.data))
}

export function useSaveProject() {
  return useBusinessMutation(({ id, ...body }: { id?: number; [k: string]: any }) =>
    (id ? api.put(`/api/business/projects/${id}`, body) : api.post('/api/business/projects', body)).then(r => r.data))
}

export function useSaveMeetingNote() {
  return useBusinessMutation(({ id, ...body }: { id?: number; [k: string]: any }) =>
    (id ? api.put(`/api/business/meeting-notes/${id}`, body) : api.post('/api/business/meeting-notes', body)).then(r => r.data))
}

export function useRemoveMeetingNote() {
  return useBusinessMutation((id: number) => api.delete(`/api/business/meeting-notes/${id}`))
}

export function useRemoveTimeEntry() {
  return useBusinessMutation((id: number) => api.delete(`/api/business/time/${id}`))
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

export interface RangePlan { days: number; writing: number; kept: number; replaced: number; total: number }
export type RangeBody = { from: string; to: string; perDay?: number; total?: number; overwrite?: boolean }

export function useRangePreview(campaignId: number | null, body: RangeBody | null) {
  return useQuery<RangePlan>({
    queryKey: ['range-preview', campaignId, body],
    queryFn: () => api.post(`/api/business/campaigns/${campaignId}/spend/range`, { ...body, dryRun: true }).then(r => r.data),
    enabled: !!campaignId && !!body,
    retry: false,
  })
}

export function useLogAdSpendRange() {
  return useBusinessMutation(({ campaignId, ...body }: { campaignId: number } & RangeBody) =>
    api.post(`/api/business/campaigns/${campaignId}/spend/range`, body).then(r => r.data as RangePlan))
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
  return useQuery<{ payments: any[]; takenInvoiceIds: number[]; owed: Record<string, number> }>({
    queryKey: ['payments-unassigned'],
    queryFn: () => api.get('/api/business/payments/unassigned').then(r => r.data),
  })
}

export function usePayments(limit = 500) {
  return useQuery<PaymentRow[]>({
    queryKey: ['payments', limit],
    queryFn: () => api.get('/api/business/payments', { params: { limit } }).then(r => r.data),
  })
}

export function useSyncPayments() {
  return useBusinessMutation((lookbackDays: number = 45) =>
    api.post('/api/business/payments/sync', { lookbackDays }).then(r => r.data))
}

/** The client's invoices this payment could settle, and the sets that fit exactly. */
export function usePaymentOptions(paymentId: number | null, clientId: number | null) {
  return useQuery<PaymentOptions>({
    queryKey: ['payment-options', paymentId, clientId],
    queryFn: () => api.get(`/api/business/payments/${paymentId}/options`, { params: { clientId } }).then(r => r.data),
    enabled: !!paymentId && !!clientId,
  })
}

/** Assign a payment, or move one already assigned: the server releases it first. */
export function useAssignPayment() {
  return useBusinessMutation(({ id, ...body }: {
    id: number; clientId: number; invoiceId?: number | null; invoiceIds?: number[]
    allocations?: { invoiceId: number; amount: number }[]; adjustToMatch?: boolean; remember?: boolean
  }) => api.post(`/api/business/payments/${id}/assign`, body).then(r => r.data))
}

export function useReleasePayment() {
  return useBusinessMutation((id: number) => api.post(`/api/business/payments/${id}/release`).then(r => r.data))
}

export function useUnignorePayment() {
  return useBusinessMutation((id: number) => api.post(`/api/business/payments/${id}/unignore`).then(r => r.data))
}

/** Raise a paid invoice from a payment that has nothing to attach to. */
export function useInvoiceFromPayment() {
  return useBusinessMutation(({ id, ...body }: {
    id: number; clientId?: number; description?: string | null; serviceId?: number | null
  }) => api.post(`/api/business/payments/${id}/invoice`, body).then(r => r.data))
}

/** Set a subscription payment up as a retainer, with its first invoice paid. */
export function useRetainerFromPayment() {
  return useBusinessMutation(({ id, ...body }: {
    id: number; clientId?: number; amount?: number; frequency?: string; name?: string; serviceId?: number | null
  }) => api.post(`/api/business/payments/${id}/retainer`, body).then(r => r.data))
}

export function useIgnorePayment() {
  return useBusinessMutation((id: number) =>
    api.post(`/api/business/payments/${id}/ignore`).then(r => r.data))
}
