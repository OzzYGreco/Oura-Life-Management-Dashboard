/**
 * The shapes the Business tab actually receives.
 *
 * The page this replaces carried 124 `any` annotations and not one declared
 * interface, which is how two tabs ended up disagreeing about what net profit
 * meant without anything complaining.
 */

export type InvoiceStatus = 'draft' | 'unpaid' | 'paid' | 'overdue' | 'part-paid' | 'void'
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
  churnReason?: string | null
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
  voidReason?: string | null
  voidedAt?: string | null
  raisedFromPaymentId?: number | null
}

/** One sum of money applied to one invoice. */
export interface Allocation {
  id: number
  invoiceId: number
  paymentId: number | null
  method: 'stripe' | 'bank' | 'cash'
  amount: number
  fee: number
  refunded: number
  date: string
  note: string | null
  payerName?: string | null
}

/** An invoice as the edit form loads it, with the money on it. */
export interface InvoiceDetail extends Invoice {
  applied: number
  owed: number
  allocations: Allocation[]
  knockOn: { stripePayments: number; alsoReopens: string[] }
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
  /** Money in so far, and what is still owed. */
  applied: number
  owed: number
  partPaid: boolean
  status: InvoiceStatus
  issueDate: string
  dueDate: string
  paidDate: string | null
  notes: string | null
  voidReason: string | null
  sentDate: string | null
}

export interface LedgerTotals {
  count: number
  voidCount: number
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
  lastGeneratedDate: string | null
  pausedAt: string | null
  notes: string | null
}

/** A row on the Payments view: a Stripe payment, or money recorded by hand. */
export interface PaymentRow {
  key: string
  source: 'stripe' | 'bank' | 'cash'
  paymentId: number | null
  allocationId?: number
  date: string
  payer: string | null
  clientId: number | null
  clientName: string | null
  gross: number
  fee: number
  net: number
  refunded: number
  settled: { allocationId: number; invoiceId: number; amount: number; invoiceNumber: string; invoiceAmount: number; milestoneLabel: string | null }[]
  applied: number
  unallocated: number
  how: 'auto' | 'by hand' | 'raised' | 'to assign' | 'not income' | 'recorded'
  reason: string | null
  subscription: boolean
}

/** What a payment could be applied to, for one client. */
export interface PaymentOptions {
  invoices: {
    id: number; invoiceNumber: string; amount: number; status: string
    issueDate: string; notes: string | null; milestoneLabel: string | null
    /** What it can still take. */
    owed: number
    /** What this payment already puts on it. */
    current: number
    raisedHere: boolean
  }[]
  /** Sets of invoice ids that add up to the payment exactly. */
  suggestions: number[][]
  /** Single invoices a few pence off, which "adjust to match" can close. */
  near: { invoiceId: number; gap: number }[]
  openCount: number
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

export type NeedAction = 'paid' | 'send' | 'invoice' | 'setup' | 'assign' | 'void'

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
  /** Auto-synced campaigns that have stopped reporting. Empty when all is well. */
  adStale: {
    campaigns: StaleCampaign[]
    estimatedMissing: number
  }
}

/**
 * A campaign whose daily spend has gone quiet. Days after `lastDay` are counted
 * as zero rather than estimated, so an unnoticed gap understates costs and
 * overstates profit.
 */
export interface StaleCampaign {
  campaignId: number
  name: string
  platform: string
  lastDay: string
  /** Whole days with no figure. Today is excluded: it is not over yet. */
  missingDays: number
  perDay: number
  estimatedMissing: number
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
  'part-paid': '#38bdf8',
  void:    'var(--c-text-3)',
  // Retainers
  active:    'var(--c-profit)',
  paused:    '#f59e0b',
  cancelled: 'var(--c-text-3)',
}
