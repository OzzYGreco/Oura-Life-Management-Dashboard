/**
 * The shapes the Business tab actually receives.
 *
 * The page this replaces carried 124 `any` annotations and not one declared
 * interface, which is how two tabs ended up disagreeing about what net profit
 * meant without anything complaining.
 */

export type InvoiceStatus = 'draft' | 'unpaid' | 'paid' | 'overdue'
export type RetainerStatus = 'active' | 'paused' | 'cancelled'
export type ProjectStage = 'discovery' | 'design' | 'build' | 'review' | 'launched'
export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export interface Client {
  id: number
  name: string
  company: string | null
  email: string | null
  phone: string | null
  website: string | null
  notes: string | null
  status: string
  source: string | null
  wonDate: string | null
  churnedAt: string | null
}

/** A client row with its economics already computed server-side. */
export interface ClientRow {
  id: number
  name: string
  company: string | null
  status: string
  website: string | null
  mrr: number
  lifetime: number
  costs: number
  margin: number
  marginPct: number
  outstanding: number
  unbilled: number
  since: string | null
  tenureMonths: number
  invoiceCount: number
  projectCount: number
  retainerCount: number
  lastInvoiceDate: string | null
  spark: number[]
}

export interface Project {
  id: number
  clientId: number | null
  name: string
  description: string | null
  link: string | null
  status: string
  stage: ProjectStage
  serviceId: number | null
  startDate: string | null
  dueDate: string | null
  launchedDate: string | null
  value: number | null
}

export interface ActiveProject {
  id: number
  name: string
  clientId: number | null
  clientName: string
  stage: ProjectStage
  status: string
  value: number
  dueDate: string | null
  overdue: boolean
  hours: number
  billed: number
  billedPct: number
  milestonesBilled: number
  milestonesTotal: number
}

export interface Invoice {
  id: number
  clientId: number
  projectId: number | null
  retainerId: number | null
  serviceId: number | null
  invoiceNumber: string
  amount: number
  subtotal: number | null
  feeAmount: number
  refundedAmount: number
  status: string
  issueDate: string
  dueDate: string
  paidDate: string | null
  sentDate: string | null
  milestoneLabel: string | null
  notes: string | null
}

/** A ledger row: the invoice plus everything needed to read it at a glance. */
export interface LedgerRow {
  id: number
  invoiceNumber: string
  clientId: number
  clientName: string
  projectId: number | null
  retainerId: number | null
  kind: 'retainer' | 'website' | 'oneoff'
  what: string
  gross: number
  fee: number
  net: number | null
  status: InvoiceStatus
  issueDate: string
  dueDate: string
  paidDate: string | null
  notes: string | null
}

export interface LedgerTotals {
  count: number
  billed: number
  collected: number
  fees: number
  outstanding: number
  overdue: number
  paidCount: number
  avgDaysToPay: number | null
}

export interface Retainer {
  id: number
  clientId: number
  clientName: string
  serviceId: number | null
  serviceName: string
  name: string
  amount: number
  frequency: Frequency
  startDate: string
  endDate: string | null
  status: RetainerStatus
  cancelReason: string | null
  netTermDays: number
  autoInvoice: number
  nextInvoiceDate: string | null
  notes: string | null
}

export interface Service {
  id: number
  name: string
  kind: 'one_off' | 'recurring'
  defaultAmount: number | null
  defaultFrequency: string | null
  milestones: { label: string; pct: number; offsetDays?: number }[] | null
  defaultTermDays: number
  color: string | null
}

export interface Owner {
  id: number
  name: string
  sharePct: number
  period: number
  lifetime: number
  entitled: number
  /** Positive means this partner is ahead of their share. */
  delta: number
  /** What they could still take before hitting their share. */
  leftToDraw: number
}

export interface OwnerPay {
  taxReserveEnabled: boolean
  taxRatePct: number
  bufferMonths: number
  netProfit: number
  taxReserve: number
  buffer: number
  distributable: number
  safeToDraw: number
  drawnPeriod: number
  drawnAllTime: number
  retained: number
  overdrawn: number
  allTimeDistributable: number
  owners: Owner[]
  recent: {
    id: number; ownerId: number; ownerName: string
    amount: number; date: string; method: string | null; notes: string | null
    postedToFinances: boolean
  }[]
  byMonth: { month: string; drawn: number }[]
}

export type NeedAction = 'paid' | 'send' | 'invoice' | 'setup' | 'assign'

export interface NeedRow {
  key: string
  action: NeedAction
  clientId: number | null
  clientName: string
  what: string
  amount: number
  detail: string | null
  rank: number
  invoiceId?: number
  projectId?: number
  expenseId?: number
}

export interface MrrMovementRow {
  month: string
  startingMrr: number
  new: number
  expansion: number
  contraction: number
  churn: number
  reactivation: number
  net: number
  endingMrr: number
}

export interface PnlRow {
  grossVolume: number
  fees: number
  refunds: number
  netVolume: number
  adSpend: number
  overheads: number
  clientCosts: number
  totalCosts: number
  netProfit: number
  marginPct: number
}

export interface BusinessMetrics {
  range: { from?: string; to?: string }
  mrr: {
    current: number
    arr: number
    activeCount: number
    arpa: number
    byService: { serviceId: number; name: string; color: string | null; mrr: number; count: number }[]
    movement: MrrMovementRow[]
    netNewThisMonth: number
  }
  churn: {
    logoChurnPct: number
    revenueChurnPct: number
    cancelledCount: number
    avgLifetimeMonths: number | null
  }
  retainers: { active: number; paused: number; cancelled: number }
  volume: {
    gross: number; fees: number; refunds: number; net: number
    outstanding: number; draft: number; invoiceCount: number
    byMonth: { month: string; gross: number; net: number; retainer: number; oneOff: number; count: number }[]
  }
  mtd: { collected: number; gross: number; invoiceCount: number }
  pnl: PnlRow
  pnlByMonth: (PnlRow & { month: string })[]
  costs: { clientCosts: number; overheads: number; adSpend: number; total: number; unattributedCount: number }
  ar: {
    current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number
    total: number; count: number; overdueCount: number
  }
  clients: {
    active: number; churned: number; total: number; newInRange: number
    cac: number; ltv: number; ltvToCac: number | null; paybackMonths: number | null
    bySource: { source: string; count: number }[]
  }
  work: {
    activeProjects: number
    launchedCount: number
    avgBuildDays: number | null
    avgHoursPerBuild: number | null
    totalHours: number
    effectiveRate: number | null
    onTimePct: number | null
    byStage: { stage: string; count: number }[]
    collectedByProject: Record<string, number>
    hoursByProject: Record<string, number>
    unbilledByProject: Record<string, number>
  }
  ownerPay: OwnerPay
  actions: {
    unbilledProjects: { id: number; name: string; clientId: number | null; unbilled: number; value: number; invoiced: number }[]
    unbilledTotal: number
    retainerGaps: { clientId: number; clientName: string; amount: number; frequency: string; context: string }[]
    retainerGapsMrr: number
    totalActions: number
  }
}

export const STAGES: { key: ProjectStage; label: string; color: string }[] = [
  { key: 'discovery', label: 'Discovery', color: '#818cf8' },
  { key: 'design',    label: 'Design',    color: '#a78bfa' },
  { key: 'build',     label: 'Build',     color: '#22d3ee' },
  { key: 'review',    label: 'Review',    color: '#f59e0b' },
  { key: 'launched',  label: 'Launched',  color: '#34d399' },
]

export const STATUS_COLOR: Record<string, string> = {
  paid:    'var(--c-profit)',
  unpaid:  '#f59e0b',
  overdue: 'var(--c-loss)',
  draft:   'var(--c-text-3)',
}
