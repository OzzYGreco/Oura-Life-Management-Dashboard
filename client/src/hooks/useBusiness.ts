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

// Every save refreshes everything that can depend on it. Refreshing only the
// saved object's own list left "Needs you", the client page and the figures
// showing the old state until the page was reloaded.
function crud(base: string) {
  return {
    useCreate: () => useBusinessMutation((d: any) => api.post(base, d).then(r => r.data)),
    useUpdate: () => useBusinessMutation(({ id, ...d }: any) => api.put(`${base}/${id}`, d).then(r => r.data)),
    useDelete: () => useBusinessMutation((id: number) => api.delete(`${base}/${id}`)),
  }
}

export const { useCreate: useCreateClient, useUpdate: useUpdateClient, useDelete: useDeleteClient } = crud('/api/business/clients')
export const { useCreate: useCreateProject, useUpdate: useUpdateProject, useDelete: useDeleteProject } = crud('/api/business/projects')
export const { useCreate: useCreateInvoice, useUpdate: useUpdateInvoice, useDelete: useDeleteInvoice } = crud('/api/business/invoices')
export const { useCreate: useCreateMeetingNote, useUpdate: useUpdateMeetingNote, useDelete: useDeleteMeetingNote } = crud('/api/business/meeting-notes')
export const { useCreate: useCreateCampaign, useUpdate: useUpdateCampaign, useDelete: useDeleteCampaign } = crud('/api/business/campaigns')

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
  return useBusinessMutation((d: any) => api.post(`/api/business/projects/${projectId}/time`, d).then(r => r.data))
}
export function useDeleteTimeEntry() {
  return useBusinessMutation((id: number) => api.delete(`/api/business/time/${id}`))
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

export function useUpdateService() {
  return useBusinessMutation(({ id, ...body }: { id: number; name?: string; defaultAmount?: number | null }) =>
    api.put(`/api/business/services/${id}`, body).then(r => r.data as Service))
}

/** Stop offering a service. Retired rather than deleted if anything was sold on it. */
export function useRemoveService() {
  return useBusinessMutation((id: number) =>
    api.delete(`/api/business/services/${id}`).then(r => r.data as { retired: boolean }))
}

export interface ClientFootprint {
  invoices: number; collected: number; byHand: number; stripePayments: number
  retainers: number; liveRetainers: number; websites: number
}

/** Everything that deleting a client would take with it. */
export function useClientFootprint(id: number | null) {
  return useQuery<ClientFootprint>({
    queryKey: ['client-footprint', id],
    queryFn: () => api.get(`/api/business/clients/${id}/delete-preview`).then(r => r.data),
    enabled: !!id,
  })
}

export function useDeleteClientEverything() {
  return useBusinessMutation((id: number) => api.delete(`/api/business/clients/${id}/everything`).then(r => r.data))
}

/** Add a service the business has started selling. */
export function useCreateService() {
  return useBusinessMutation((body: {
    name: string; kind: 'one_off' | 'recurring'; defaultAmount?: number | null
    defaultFrequency?: string | null; milestones?: { label: string; pct: number; offsetDays?: number }[] | null
  }) => api.post('/api/business/services', body).then(r => r.data as Service))
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
        'payment-options', 'meeting-notes', 'comeback', 'finance-expenses', 'finance-recurring', 'services',
        'business-settings', 'client-events', 'forecast', 'vat', 'month-summary', 'reminder',
        'time-entries', 'project-tasks', 'finance-accounts', 'client-footprint',
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
  /** Retainer months the extra pays ahead. */
  ahead?: { retainerId: number; name: string; periodStart: string; amount: number; pays: number }[]
  /** The same amount already recorded for them within three days. */
  duplicate?: { date: string; amount: number } | null
}
export type ClientPaymentBody = { amount: number; date?: string; fee?: number; method?: 'bank' | 'cash' | 'stripe'; restFor?: string; ahead?: boolean }

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

// ─── Costs, from the sheet ───────────────────────────────────────────────────
//
// The Finances hooks refresh the Finances page only, so a cost typed in on the
// Business tab left every business figure stale until a reload. These go
// through the business mutation, which refreshes both.

export function useSaveCost() {
  return useBusinessMutation(({ id, ...body }: { id?: number; [k: string]: any }) =>
    (id ? api.put(`/api/finance/expenses/${id}`, body) : api.post('/api/finance/expenses', body)).then(r => r.data))
}

export function useSaveCampaign() {
  return useBusinessMutation(({ id, ...body }: { id: number; [k: string]: any }) =>
    api.put(`/api/business/campaigns/${id}`, body).then(r => r.data))
}

export function useDeleteCost() {
  return useBusinessMutation((id: number) => api.delete(`/api/finance/expenses/${id}`))
}

export function useUpdateRetainer() {
  return useBusinessMutation(({ id, ...body }: { id: number; [k: string]: any }) =>
    api.put(`/api/business/retainers/${id}`, body).then(r => r.data))
}

export function useRetainerLifecycle() {
  return useBusinessMutation(({ id, action, ...body }: {
    id: number; action: 'pause' | 'resume' | 'cancel' | 'reinstate'
    endDate?: string; reason?: string; voidOpen?: boolean; date?: string; resumeOn?: string | null
  }) => api.post(`/api/business/retainers/${id}/${action}`, body).then(r => r.data))
}

export function useCancelPreview(id: number | null, endDate: string | null) {
  return useQuery<{
    endDate: string; scheduled?: boolean
    voided: { id: number; invoiceNumber: string; amount: number; periodStart: string | null }[]
    stillToBill?: { periodStart: string; amount: number }[]
  }>({
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
  /** A last day ahead: they have given notice. */
  notice?: boolean
  stillToBill?: { periodStart: string; amount: number; name: string }[]
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

export interface LeftOnPlan {
  from: string | null; to: string
  retainers: { id: number; name: string; from: string | null; to: string }[]
  voided: { id: number; invoiceNumber: string; amount: number }[]
  restored: { id: number; invoiceNumber: string; amount: number }[]
}

/** What moving the day a client left would change. */
export function useLeftOnPreview(clientId: number | null, date: string | null) {
  return useQuery<LeftOnPlan>({
    queryKey: ['left-on-preview', clientId, date],
    queryFn: () => api.post(`/api/business/clients/${clientId}/left-on`, { date, dryRun: true }).then(r => r.data),
    enabled: !!clientId && !!date,
    retry: false,
  })
}

export function useChangeLeftOn() {
  return useBusinessMutation(({ id, date }: { id: number; date: string }) =>
    api.post(`/api/business/clients/${id}/left-on`, { date }).then(r => r.data as LeftOnPlan))
}

export function useReactivateClient() {
  return useBusinessMutation(({ id, ...body }: {
    id: number; restoreInvoiceIds?: number[]; reinstateRetainerIds?: number[]
    startDate?: string; prices?: Record<string, number>
  }) => api.post(`/api/business/clients/${id}/reactivate`, body).then(r => r.data))
}

// ─── Edge cases: discounts, holds, refunds, moves, export ────────────────────

/** Accept what has been paid on an invoice as payment in full. */
export function useSettleInvoice() {
  return useBusinessMutation(({ id, reason }: { id: number; reason?: string }) =>
    api.post(`/api/business/invoices/${id}/settle`, { reason }).then(r => r.data))
}

/** Keep an invoice out of chasing until a date; no date takes the hold off. */
export function useHoldInvoice() {
  return useBusinessMutation(({ id, until, reason }: { id: number; until: string | null; reason?: string }) =>
    api.post(`/api/business/invoices/${id}/hold`, { until, reason }).then(r => r.data))
}

/** Give back part or all of a bank or cash payment. */
export function useRefundAllocation() {
  return useBusinessMutation(({ id, amount }: { id: number; amount: number }) =>
    api.post(`/api/business/allocations/${id}/refund`, { amount }).then(r => r.data))
}

/** Move a bank or cash payment to the client it really came from. */
export function useMoveAllocation() {
  return useBusinessMutation(({ id, clientId }: { id: number; clientId: number }) =>
    api.post(`/api/business/allocations/${id}/move`, { clientId }).then(r => r.data))
}

/** Where a CSV of the books downloads from. */
export const exportUrl = (kind: 'invoices' | 'payments' | 'costs', range: { from?: string; to?: string }) =>
  `/api/business/export?${new URLSearchParams({ kind, ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) })}`

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

// ─── Getting paid, looking ahead (businessGrowth routes) ─────────────────────

export interface BusinessSettings { businessName: string; signOff: string; bankDetails: string }

export function useBusinessSettings() {
  return useQuery<BusinessSettings>({ queryKey: ['business-settings'], queryFn: () => api.get('/api/business/settings').then(r => r.data) })
}
export function useSaveBusinessSettings() {
  return useBusinessMutation((body: Partial<BusinessSettings>) => api.put('/api/business/settings', body).then(r => r.data as BusinessSettings))
}

export interface ClientEvent { id: number; at: string; kind: string; summary: string }
export function useClientEvents(clientId: number | null) {
  return useQuery<ClientEvent[]>({
    queryKey: ['client-events', clientId],
    queryFn: () => api.get(`/api/business/clients/${clientId}/events`).then(r => r.data),
    enabled: !!clientId,
  })
}

export function usePaymentLink() {
  return useBusinessMutation(({ id, fresh }: { id: number; fresh?: boolean }) =>
    api.post(`/api/business/invoices/${id}/payment-link`, { fresh }).then(r => r.data as { url: string; reused: boolean }))
}

export interface Reminder { to: string | null; subject: string; body: string; mailto: string; hasLink: boolean; hasBank: boolean }
export function useReminder(invoiceId: number | null) {
  return useQuery<Reminder>({
    queryKey: ['reminder', invoiceId],
    queryFn: () => api.get(`/api/business/invoices/${invoiceId}/reminder`).then(r => r.data),
    enabled: !!invoiceId,
  })
}

export function useDismissFailedCharges() {
  return useBusinessMutation((ids: number[]) => api.post('/api/business/failed-charges/dismiss', { ids }).then(r => r.data))
}

export interface ForecastMonth { month: string; retainers: number; owed: number; stages: number; costs: number; ads: number; net: number; cumulative: number }
export interface Forecast {
  from: string; to: string; months: ForecastMonth[]; totalIn: number; totalOut: number; lateOwed: number
  items: { date: string; kind: 'retainer' | 'owed' | 'stage' | 'cost' | 'ads'; label: string; amount: number; late?: boolean; clientId?: number | null }[]
}
export function useForecast(months = 3) {
  return useQuery<Forecast>({ queryKey: ['forecast', months], queryFn: () => api.get(`/api/business/forecast?months=${months}`).then(r => r.data) })
}

export interface Vat { threshold: number; rolling12: number; pct: number; monthlyPace: number; crossing: string | null }
export function useVat() {
  return useQuery<Vat>({ queryKey: ['vat'], queryFn: () => api.get('/api/business/vat').then(r => r.data) })
}

export interface MonthSummary {
  month: string; from: string; to: string; partial: boolean
  moneyIn: number; costs: number; adSpend: number; profit: number; marginPct: number
  previous: { moneyIn: number; profit: number }
  mrr: { start: number; end: number }
  joined: { id: number; name: string }[]; left: { id: number; name: string; reason: string | null }[]
  owedNow: number; writtenOff: number; top: { id: number; name: string; amount: number }[]
  draws: { name: string; taken: number }[]; safeToDraw: number; vat: Vat; text: string
}
export function useMonthSummary(month: string | null, opts?: OwnerPayOpts) {
  const qs = new URLSearchParams({ month: month ?? '' })
  if (opts) { qs.set('taxReserve', opts.taxReserveEnabled ? '1' : '0'); qs.set('taxRate', String(opts.taxRatePct)); qs.set('buffer', String(opts.bufferMonths)) }
  return useQuery<MonthSummary>({
    queryKey: ['month-summary', month, opts],
    queryFn: () => api.get(`/api/business/month-summary?${qs}`).then(r => r.data),
    enabled: !!month,
  })
}

export interface BulkPriceBody { serviceId: number; currentAmount?: number | null; newAmount: number; from: string; exclude?: number[] }
export interface BulkPricePlan {
  service: string; from: string; count: number; mrrDelta: number
  rows: { retainerId: number; clientId: number; clientName: string; frequency: string; from: string; oldAmount: number; newAmount: number; included: boolean; why: string | null }[]
}
export function useBulkPricePreview(body: BulkPriceBody | null) {
  return useQuery<BulkPricePlan>({
    queryKey: ['bulk-price-preview', body],
    queryFn: () => api.post('/api/business/retainers/bulk-price', { ...body, dryRun: true }).then(r => r.data),
    enabled: !!body && body.newAmount > 0 && !!body.from,
    retry: false,
  })
}
export function useBulkPrice() {
  return useBusinessMutation((body: BulkPriceBody) => api.post('/api/business/retainers/bulk-price', body).then(r => r.data as BulkPricePlan))
}
