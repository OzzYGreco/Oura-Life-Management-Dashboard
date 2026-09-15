/**
 * Single source of truth for every business figure.
 *
 * Both `routes/business.ts` and `routes/dashboard.ts` import from here so the
 * Business tab and the Dashboard panel can never drift apart - previously they
 * used two different net-profit formulas and disagreed.
 *
 * Money model (three layers):
 *
 *   GROSS VOLUME   what was invoiced
 *     − fees       payment-processor fees
 *     − refunds
 *   NET VOLUME     what actually landed in the bank
 *     − ad spend   business-funded marketing campaigns
 *     − overheads  business costs not tied to a client (tools, subscriptions)
 *     − client costs  business costs attributed to a client/project
 *   NET PROFIT
 */
import { db } from '../db'
import {
  businessClients, businessProjects, businessInvoices, businessRetainers,
  businessRetainerChanges, businessServices, businessTimeEntries,
  businessOwners, businessOwnerDraws,
  financeExpenses, marketingCampaigns, marketingSpendDaily,
} from '../db/schema'
import { localToday } from './date'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Range { from?: string; to?: string }

type Invoice  = typeof businessInvoices.$inferSelect
type Retainer = typeof businessRetainers.$inferSelect
type Expense  = typeof financeExpenses.$inferSelect

/** Everything the metrics endpoint needs, loaded once and passed around. */
export interface BusinessData {
  clients:   (typeof businessClients.$inferSelect)[]
  projects:  (typeof businessProjects.$inferSelect)[]
  invoices:  Invoice[]
  retainers: Retainer[]
  changes:   (typeof businessRetainerChanges.$inferSelect)[]
  services:  (typeof businessServices.$inferSelect)[]
  time:      (typeof businessTimeEntries.$inferSelect)[]
  expenses:  Expense[]
  campaigns: (typeof marketingCampaigns.$inferSelect)[]
  owners:    (typeof businessOwners.$inferSelect)[]
  draws:     (typeof businessOwnerDraws.$inferSelect)[]
  adSpendDaily: (typeof marketingSpendDaily.$inferSelect)[]
}

/**
 * Every figure on the Business tab is derived from the same nine tables, and a
 * single page render asks for several of them at once. Rather than run eleven
 * full scans per request, the set is loaded once and held until something
 * writes. `invalidateBusinessData()` is called from every mutating route.
 */
let cache: { data: BusinessData; at: number } | null = null
const CACHE_MS = 15_000

export function invalidateBusinessData(): void { cache = null }

export async function loadBusinessData(): Promise<BusinessData> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data

  const [clients, projects, invoices, retainers, changes, services, time, expenses, campaigns, owners, draws, adSpendDaily] =
    await Promise.all([
      db.select().from(businessClients),
      db.select().from(businessProjects),
      db.select().from(businessInvoices),
      db.select().from(businessRetainers),
      db.select().from(businessRetainerChanges),
      db.select().from(businessServices),
      db.select().from(businessTimeEntries),
      db.select().from(financeExpenses),
      db.select().from(marketingCampaigns),
      db.select().from(businessOwners),
      db.select().from(businessOwnerDraws),
      db.select().from(marketingSpendDaily),
    ])

  const data = { clients, projects, invoices, retainers, changes, services, time, expenses, campaigns, owners, draws, adSpendDaily }
  cache = { data, at: Date.now() }
  return data
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100
const monthKey = (d: string) => d.slice(0, 7)

/** Last day of the month a YYYY-MM key refers to. */
function monthEnd(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${key}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

/** The N month keys ending with the month containing `to` (inclusive). */
export function monthSpan(n: number, to = localToday()): string[] {
  const [y, m] = to.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 - (n - 1 - i), 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
}

function inRange(date: string | null, r: Range): boolean {
  if (!date) return false
  if (r.from && date < r.from) return false
  if (r.to   && date > r.to)   return false
  return true
}

/** The date a payment is recognised on - paidDate where known, else issueDate. */
const cashDate = (i: Invoice) => i.paidDate ?? i.issueDate

// ─── Invoice money ────────────────────────────────────────────────────────────

export const grossOf = (i: Invoice) => i.amount
export const netOf   = (i: Invoice) => i.amount - (i.feeAmount ?? 0) - (i.refundedAmount ?? 0)

// ─── MRR ──────────────────────────────────────────────────────────────────────

const FREQ_TO_MONTHLY: Record<string, number> = {
  weekly:    52 / 12,   // 4.333…
  monthly:   1,
  quarterly: 1 / 3,
  yearly:    1 / 12,
}

/** Normalise any billing frequency to a monthly-recurring figure. */
export function toMonthly(amount: number, frequency: string): number {
  return amount * (FREQ_TO_MONTHLY[frequency] ?? 1)
}

/**
 * What a retainer was worth on a given date, walking the price-change log.
 * Returns 0 if the retainer had not started, or had already ended.
 */
export function retainerMrrOn(r: Retainer, date: string, changes: typeof businessRetainerChanges.$inferSelect[]): number {
  if (r.startDate > date) return 0
  if (r.endDate && r.endDate <= date) return 0
  if (r.status === 'paused') return 0
  // A cancelled retainer with no end date would otherwise bill forever.
  if (r.status === 'cancelled' && (!r.cancelledAt || r.cancelledAt <= date)) return 0

  const mine = changes.filter(c => c.retainerId === r.id).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
  let amount = r.amount
  const applied = mine.filter(c => c.effectiveDate <= date)
  if (applied.length) {
    amount = applied[applied.length - 1].newAmount
  } else if (mine.length) {
    // No change has taken effect yet - the price back then was the first change's "old".
    amount = mine[0].oldAmount
  }
  return toMonthly(amount, r.frequency)
}

export function currentMrr(d: BusinessData, on = localToday()) {
  const active = d.retainers.filter(r => r.status === 'active' && r.startDate <= on && (!r.endDate || r.endDate > on))
  const total  = active.reduce((s, r) => s + retainerMrrOn(r, on, d.changes), 0)

  const byService = d.services
    .map(svc => ({
      serviceId: svc.id,
      name:      svc.name,
      color:     svc.color,
      mrr:       round2(active.filter(r => r.serviceId === svc.id).reduce((s, r) => s + retainerMrrOn(r, on, d.changes), 0)),
      count:     active.filter(r => r.serviceId === svc.id).length,
    }))
    .filter(s => s.count > 0)

  const unclassified = active.filter(r => !r.serviceId)
  if (unclassified.length) {
    byService.push({
      serviceId: 0, name: 'Other', color: '#8b8baa',
      mrr: round2(unclassified.reduce((s, r) => s + retainerMrrOn(r, on, d.changes), 0)),
      count: unclassified.length,
    })
  }

  return {
    current:    round2(total),
    arr:        round2(total * 12),
    activeCount: active.length,
    arpa:       active.length ? round2(total / active.length) : 0,
    byService,
  }
}

/**
 * Month-by-month MRR movement: new / expansion / contraction / churn / reactivation.
 * Each month's `net` is the change from the previous month's ending MRR.
 */
export function mrrMovement(d: BusinessData, months = 12, to = localToday()) {
  const keys = monthSpan(months, to)
  const rows: any[] = []
  let prevEnding = 0

  // Seed with the MRR at the end of the month *before* the window.
  const firstKey = keys[0]
  const [fy, fm] = firstKey.split('-').map(Number)
  const beforeStart = monthEnd(`${new Date(fy, fm - 2, 1).getFullYear()}-${String(new Date(fy, fm - 2, 1).getMonth() + 1).padStart(2, '0')}`)
  prevEnding = d.retainers.reduce((s, r) => s + retainerMrrOn(r, beforeStart, d.changes), 0)

  for (const key of keys) {
    const end   = monthEnd(key)
    const start = `${key}-01`

    let fresh = 0, expansion = 0, contraction = 0, churn = 0, reactivation = 0

    for (const r of d.retainers) {
      const startedThisMonth = r.startDate >= start && r.startDate <= end
      const endedThisMonth   = !!r.endDate && r.endDate >= start && r.endDate <= end

      if (startedThisMonth) {
        // No `|| r.amount` fallback here. A retainer that started and stopped
        // inside the same month is worth 0 at month end, and counting it as new
        // MRR was inflating every month it happened in.
        const value = retainerMrrOn(r, end, d.changes)
        // A client who had a retainer end before this one started is coming
        // back, not arriving. Kept separate so growth is not overstated.
        const returning = d.retainers.some(o =>
          o.id !== r.id && o.clientId === r.clientId && o.endDate && o.endDate < r.startDate)
        if (returning) reactivation += value
        else fresh += value
      }
      if (endedThisMonth) {
        // Value it lost at the moment it ended, using the day before it stopped.
        const before = new Date(r.endDate + 'T00:00:00Z')
        before.setUTCDate(before.getUTCDate() - 1)
        churn += retainerMrrOn(r, before.toISOString().slice(0, 10), d.changes)
      }
    }

    for (const c of d.changes) {
      if (c.effectiveDate < start || c.effectiveDate > end) continue
      const r = d.retainers.find(x => x.id === c.retainerId)
      if (!r) continue
      const delta = toMonthly(c.newAmount, r.frequency) - toMonthly(c.oldAmount, r.frequency)
      if (delta > 0) expansion += delta
      else contraction += -delta
    }

    const ending = d.retainers.reduce((s, r) => s + retainerMrrOn(r, end, d.changes), 0)

    rows.push({
      month:        key,
      startingMrr:  round2(prevEnding),
      new:          round2(fresh),
      expansion:    round2(expansion),
      contraction:  round2(-contraction),
      churn:        round2(-churn),
      reactivation: round2(reactivation),
      net:          round2(ending - prevEnding),
      endingMrr:    round2(ending),
    })
    prevEnding = ending
  }

  return rows
}

/** Logo and revenue churn over the trailing window. */
export function churn(d: BusinessData, months = 12, to = localToday()) {
  const keys   = monthSpan(months, to)
  const start  = `${keys[0]}-01`
  // `cancelledAt` covers retainers cancelled without anyone setting an end date.
  const stopDate = (r: Retainer) => r.endDate ?? (r.status === 'cancelled' ? r.cancelledAt : null)
  const ended  = d.retainers.filter(r => { const e = stopDate(r); return !!e && e >= start && e <= to })
  const atStart = d.retainers.filter(r => { const e = stopDate(r); return r.startDate <= start && (!e || e > start) })

  const startMrr = atStart.reduce((s, r) => s + retainerMrrOn(r, start, d.changes), 0)
  // Value each loss at the price it was on the day before it stopped, not at
  // whatever `amount` happens to say now.
  const lostMrr  = ended.reduce((s, r) => {
    const e = stopDate(r)!
    const before = new Date(e + 'T00:00:00Z')
    before.setUTCDate(before.getUTCDate() - 1)
    return s + retainerMrrOn({ ...r, status: 'active', endDate: null, cancelledAt: null },
                             before.toISOString().slice(0, 10), d.changes)
  }, 0)

  const logoChurnPct    = atStart.length ? round2((ended.length / atStart.length) * 100) : 0
  const revenueChurnPct = startMrr ? round2((lostMrr / startMrr) * 100) : 0
  // Average monthly churn → expected lifetime in months.
  const monthlyChurn    = logoChurnPct / months / 100
  const avgLifetimeMo   = monthlyChurn > 0 ? round2(1 / monthlyChurn) : null

  return { logoChurnPct, revenueChurnPct, cancelledCount: ended.length, avgLifetimeMonths: avgLifetimeMo }
}

// ─── Volume ───────────────────────────────────────────────────────────────────

export function volume(d: BusinessData, r: Range, months = 12, to = localToday()) {
  const paid = d.invoices.filter(i => i.status === 'paid')
  const inR  = paid.filter(i => inRange(cashDate(i), r))

  const gross   = inR.reduce((s, i) => s + grossOf(i), 0)
  const fees    = inR.reduce((s, i) => s + (i.feeAmount ?? 0), 0)
  const refunds = inR.reduce((s, i) => s + (i.refundedAmount ?? 0), 0)

  // Outstanding and draft are deliberately NOT range-scoped: "what is owed"
  // is a fact about right now, not about the period being viewed. Everything
  // else in this function follows `r`.
  const openInvoices = d.invoices.filter(i => ['unpaid', 'overdue', 'draft'].includes(i.status))
  const outstanding  = openInvoices.filter(i => i.status !== 'draft').reduce((s, i) => s + grossOf(i), 0)

  const keys = monthSpan(months, to)
  const byMonth = keys.map(key => {
    const rows = paid.filter(i => monthKey(cashDate(i)) === key)
    const retainerRows = rows.filter(i => i.retainerId)
    const oneOffRows   = rows.filter(i => !i.retainerId)
    return {
      month:    key,
      gross:    round2(rows.reduce((s, i) => s + grossOf(i), 0)),
      net:      round2(rows.reduce((s, i) => s + netOf(i), 0)),
      retainer: round2(retainerRows.reduce((s, i) => s + netOf(i), 0)),
      oneOff:   round2(oneOffRows.reduce((s, i) => s + netOf(i), 0)),
      count:    rows.length,
    }
  })

  return {
    gross:       round2(gross),
    fees:        round2(fees),
    refunds:     round2(refunds),
    net:         round2(gross - fees - refunds),
    outstanding: round2(outstanding),
    draft:       round2(openInvoices.filter(i => i.status === 'draft').reduce((s, i) => s + grossOf(i), 0)),
    invoiceCount: inR.length,
    byMonth,
  }
}

// ─── Costs & P&L ──────────────────────────────────────────────────────────────

const isBusinessExpense = (e: Expense) => e.category === 'Business'

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

/**
 * A campaign records one lifetime `spent` figure with no per-day breakdown, so
 * attributing it to a month means spreading it evenly across the days it has
 * actually been running. Without this, a campaign that started in May is
 * charged in full to May, June, July and August alike and every month reads as
 * a loss while the all-time total stays correct.
 */
export function campaignSpendInRange(
  c: { spent: number | null; startDate: string; endDate: string | null },
  r: Range,
  today: string,
): number {
  const spent = c.spent ?? 0
  if (!spent) return 0

  const start  = c.startDate
  // Money can only have been spent up to today, even on an open-ended campaign.
  const end    = c.endDate && c.endDate < today ? c.endDate : today
  if (end < start) return spent

  const totalDays = dayDiff(start, end) + 1
  const from = r.from && r.from > start ? r.from : start
  const to   = r.to   && r.to   < end   ? r.to   : end
  if (to < from) return 0

  const overlapDays = dayDiff(from, to) + 1
  return spent * (overlapDays / totalDays)
}

/**
 * What a campaign actually cost over a range.
 *
 * Measured days are used as-is. Days with no row are read one of two ways, and
 * the distinction is the whole point:
 *
 *   - Before daily recording began for that campaign, nothing is known, so the
 *     part of the lifetime total not covered by rows is spread across them.
 *   - After recording began, a day with no row means no money was spent. If it
 *     were estimated instead, every quiet day would invent spend that did not
 *     happen, and the figure would never settle.
 *
 * The effect is that recording can start today without rewriting history, and
 * gets exact from the day it starts.
 */
export function campaignSpendResolved(
  d: BusinessData,
  c: typeof marketingCampaigns.$inferSelect,
  r: Range,
  today: string,
): number {
  const rows = d.adSpendDaily.filter(x => x.campaignId === c.id)
  if (!rows.length) return campaignSpendInRange(c, r, today)

  const measured = rows.filter(x => inRange(x.date, r)).reduce((s, x) => s + x.spend, 0)

  const firstRecorded = rows.map(x => x.date).sort()[0]
  const campaignEnd = c.endDate && c.endDate < today ? c.endDate : today

  // The unmeasured era runs from the campaign starting to the day before the
  // first row, and carries whatever the lifetime total does not account for.
  const eraEnd = firstRecorded <= c.startDate ? null : addOneDay(firstRecorded, -1)
  if (!eraEnd || eraEnd < c.startDate) return round2(measured)

  const unaccounted = Math.max((c.spent ?? 0) - rows.reduce((s, x) => s + x.spend, 0), 0)
  const eraDays = dayDiff(c.startDate, eraEnd) + 1
  if (eraDays <= 0 || unaccounted <= 0) return round2(measured)

  const from = r.from && r.from > c.startDate ? r.from : c.startDate
  const to = r.to && r.to < eraEnd ? r.to : eraEnd
  const overlap = to < from ? 0 : dayDiff(from, to) + 1

  return round2(measured + (unaccounted / eraDays) * overlap)
}

function addOneDay(date: string, step = 1): string {
  const [y, m, day] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, day + step)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export interface StaleCampaign {
  campaignId: number
  name: string
  platform: string
  /** The most recent day with a figure. */
  lastDay: string
  /** Whole days with no figure at all. Today is excluded: it is not over yet. */
  missingDays: number
  perDay: number
  estimatedMissing: number
}

/**
 * Auto-synced campaigns whose daily spend has stopped arriving.
 *
 * This matters more than "the number is a bit old". `campaignSpendResolved`
 * pro-rates the era BEFORE the first recorded day, but days after the last
 * recorded one are read as zero rather than estimated. So a broken connector
 * does not leave ad spend merely stale, it leaves it too LOW, and net profit
 * correspondingly too HIGH, drifting further every day it stays broken.
 *
 * That is exactly what happened on 13 September 2026: Meta blocked the app,
 * the sync failed silently, and September read about GBP 39 more profitable
 * than it was with nothing on screen to say so. Hence this.
 *
 * Only auto-synced, still-running, business-funded campaigns can be stale. One
 * that is paused, hand-logged or personally funded is quiet by design, and a
 * personal one could not move business profit anyway.
 *
 * One clear day of grace: a platform finalises a day some hours into the next
 * one, so "yesterday is missing" is normal and only two days behind is a fault.
 */
export function adSpendStaleness(d: BusinessData, today = localToday()) {
  const campaigns = d.campaigns
    .filter(c => c.externalId
      && c.status === 'active'
      && c.fundingSource === 'business'
      && (!c.endDate || c.endDate >= today))
    .map((c): StaleCampaign | null => {
      const rows = d.adSpendDaily.filter(x => x.campaignId === c.id)
      if (!rows.length) return null

      const lastDay = rows.map(x => x.date).sort()[rows.length - 1]
      const daysBehind = dayDiff(lastDay, today)
      if (daysBehind < 2) return null

      // Estimate from the fortnight before the gap rather than the campaign's
      // whole life, so a budget raised last week is reflected in what the
      // missing days are worth.
      const recent = [...rows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14)
      const perDay = recent.reduce((s, x) => s + x.spend, 0) / recent.length
      const missingDays = daysBehind - 1

      return {
        campaignId: c.id,
        name: c.name,
        platform: c.platform,
        lastDay,
        missingDays,
        perDay: round2(perDay),
        estimatedMissing: round2(perDay * missingDays),
      }
    })
    .filter((c): c is StaleCampaign => c !== null)
    .sort((a, b) => b.estimatedMissing - a.estimatedMissing)

  return {
    campaigns,
    /**
     * Roughly how much ad spend is absent, and so how much net profit is
     * currently overstated. Deliberately conservative: today is left out
     * because the day is still running.
     */
    estimatedMissing: round2(campaigns.reduce((s, c) => s + c.estimatedMissing, 0)),
  }
}

export function costs(d: BusinessData, r: Range, today = localToday()) {
  const biz = d.expenses.filter(e => isBusinessExpense(e) && inRange(e.date, r))

  const clientCosts = biz.filter(e => e.clientId).reduce((s, e) => s + e.amount, 0)
  const overheads   = biz.filter(e => !e.clientId).reduce((s, e) => s + e.amount, 0)

  const adSpend = d.campaigns
    .filter(c => c.fundingSource === 'business')
    .reduce((s, c) => s + campaignSpendResolved(d, c, r, today), 0)

  return {
    clientCosts: round2(clientCosts),
    overheads:   round2(overheads),
    adSpend:     round2(adSpend),
    total:       round2(clientCosts + overheads + adSpend),
    unattributedCount: biz.filter(e => !e.clientId).length,
  }
}

export function pnl(d: BusinessData, r: Range, today = localToday()) {
  const v = volume(d, r)
  const c = costs(d, r, today)
  const netProfit = v.net - c.total
  return {
    grossVolume: v.gross,
    fees:        v.fees,
    refunds:     v.refunds,
    netVolume:   v.net,
    adSpend:     c.adSpend,
    overheads:   c.overheads,
    clientCosts: c.clientCosts,
    totalCosts:  c.total,
    netProfit:   round2(netProfit),
    marginPct:   v.net > 0 ? round2((netProfit / v.net) * 100) : 0,
  }
}

/** Per-month P&L rows for the Money tab table. */
export function pnlByMonth(d: BusinessData, months = 12, to = localToday()) {
  return monthSpan(months, to).map(key => {
    const range: Range = { from: `${key}-01`, to: monthEnd(key) }
    const p = pnl(d, range, to)
    return { month: key, ...p }
  })
}

// ─── Accounts receivable ──────────────────────────────────────────────────────

export function arAging(d: BusinessData, today = localToday()) {
  const open = d.invoices.filter(i => ['unpaid', 'overdue'].includes(i.status))
  const days = (due: string) => Math.floor((Date.parse(today) - Date.parse(due)) / 86_400_000)

  const bucket = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }
  for (const i of open) {
    const overdueBy = days(i.dueDate)
    const amt = grossOf(i)
    if (overdueBy <= 0)      bucket.current += amt
    else if (overdueBy <= 30) bucket.d1_30 += amt
    else if (overdueBy <= 60) bucket.d31_60 += amt
    else if (overdueBy <= 90) bucket.d61_90 += amt
    else                      bucket.d90plus += amt
  }

  return {
    current:  round2(bucket.current),
    d1_30:    round2(bucket.d1_30),
    d31_60:   round2(bucket.d31_60),
    d61_90:   round2(bucket.d61_90),
    d90plus:  round2(bucket.d90plus),
    total:    round2(open.reduce((s, i) => s + grossOf(i), 0)),
    count:    open.length,
    overdueCount: open.filter(i => days(i.dueDate) > 0).length,
  }
}

// ─── Client economics ─────────────────────────────────────────────────────────

/** Lifetime revenue, attributed costs and current MRR for one client. */
export function clientEconomics(d: BusinessData, clientId: number, on = localToday()) {
  const invoices = d.invoices.filter(i => i.clientId === clientId)
  const paid     = invoices.filter(i => i.status === 'paid')
  const revenue  = paid.reduce((s, i) => s + netOf(i), 0)
  const grossRev = paid.reduce((s, i) => s + grossOf(i), 0)
  const costs    = d.expenses.filter(e => isBusinessExpense(e) && e.clientId === clientId).reduce((s, e) => s + e.amount, 0)
  const retainers = d.retainers.filter(r => r.clientId === clientId)
  const activeRet = retainers.filter(r => r.status === 'active' && (!r.endDate || r.endDate > on))
  const mrr      = activeRet.reduce((s, r) => s + retainerMrrOn(r, on, d.changes), 0)

  const client   = d.clients.find(c => c.id === clientId)
  const since    = client?.wonDate ?? paid.map(i => i.issueDate).sort()[0] ?? null
  const tenureMo = since ? round2((Date.parse(on) - Date.parse(since)) / (86_400_000 * 30.44)) : 0

  const outstanding = invoices.filter(i => ['unpaid', 'overdue'].includes(i.status)).reduce((s, i) => s + grossOf(i), 0)

  // Agreed project value this client has never been invoiced for.
  const unbilled = unbilledProjects(d)
    .filter(p => p.clientId === clientId)
    .reduce((s, p) => s + p.unbilled, 0)

  return {
    clientId,
    unbilled: round2(unbilled),
    revenue:      round2(revenue),
    grossRevenue: round2(grossRev),
    costs:        round2(costs),
    margin:       round2(revenue - costs),
    marginPct:    revenue > 0 ? round2(((revenue - costs) / revenue) * 100) : 0,
    mrr:          round2(mrr),
    outstanding:  round2(outstanding),
    invoiceCount: invoices.length,
    projectCount: d.projects.filter(p => p.clientId === clientId).length,
    retainerCount: activeRet.length,
    since,
    tenureMonths: tenureMo,
    lastInvoiceDate: invoices.map(i => i.issueDate).sort().at(-1) ?? null,
    /** Net revenue per month for a sparkline - last 12 months. */
    spark: monthSpan(12, on).map(k =>
      round2(paid.filter(i => monthKey(cashDate(i)) === k).reduce((s, i) => s + netOf(i), 0))),
  }
}

/** Acquisition economics across the whole book. */
export function clientMetrics(d: BusinessData, r: Range, on = localToday()) {
  const won      = d.clients.filter(c => c.wonDate)
  const newInR   = won.filter(c => inRange(c.wonDate, r))
  const active   = d.clients.filter(c => c.status === 'active').length
  const churned  = d.clients.filter(c => c.status === 'churned' || c.churnedAt).length

  const adSpend = costs(d, r, on).adSpend
  const cac     = newInR.length ? round2(adSpend / newInR.length) : 0

  const econ    = won.map(c => clientEconomics(d, c.id, on))
  const ltv     = econ.length ? round2(econ.reduce((s, e) => s + e.margin, 0) / econ.length) : 0

  const mrrNow  = currentMrr(d, on)
  const paybackMonths = cac > 0 && mrrNow.arpa > 0 ? round2(cac / mrrNow.arpa) : null

  return {
    active, churned,
    total:      d.clients.length,
    newInRange: newInR.length,
    cac,
    ltv,
    ltvToCac:   cac > 0 ? round2(ltv / cac) : null,
    paybackMonths,
    bySource:   Object.entries(
      d.clients.reduce((acc: Record<string, number>, c) => {
        const k = c.source || 'unknown'
        acc[k] = (acc[k] ?? 0) + 1
        return acc
      }, {}),
    ).map(([source, count]) => ({ source, count })),
  }
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

export function deliveryStats(d: BusinessData) {
  const launched = d.projects.filter(p => p.stage === 'launched' || p.status === 'completed')

  const buildDays = launched
    .filter(p => p.startDate && (p.launchedDate || p.dueDate))
    .map(p => Math.round((Date.parse((p.launchedDate || p.dueDate)!) - Date.parse(p.startDate!)) / 86_400_000))
    .filter(n => n >= 0)

  const hoursByProject = (id: number) => d.time.filter(t => t.projectId === id).reduce((s, t) => s + t.hours, 0)
  const launchedHours  = launched.map(p => hoursByProject(p.id)).filter(h => h > 0)

  const collectedByProject = (id: number) =>
    d.invoices.filter(i => i.status === 'paid' && i.projectId === id).reduce((s, i) => s + netOf(i), 0)

  const totalHours = d.time.reduce((s, t) => s + t.hours, 0)

  // The rate has to divide money by the hours that earned it. Dividing
  // project revenue by every hour ever logged (including hours on projects
  // that were never invoiced) understates it.
  const billedProjects   = new Set(d.projects.filter(p => hoursByProject(p.id) > 0).map(p => p.id))
  const ratedHours       = d.time.filter(t => billedProjects.has(t.projectId)).reduce((s, t) => s + t.hours, 0)
  const ratedCollected   = d.invoices
    .filter(i => i.status === 'paid' && i.projectId && billedProjects.has(i.projectId))
    .reduce((s, i) => s + netOf(i), 0)

  const onTime = launched.filter(p => p.dueDate && p.launchedDate && p.launchedDate <= p.dueDate).length
  const withDue = launched.filter(p => p.dueDate && p.launchedDate).length

  return {
    activeProjects:  d.projects.filter(p => p.status === 'active').length,
    launchedCount:   launched.length,
    avgBuildDays:    buildDays.length ? round2(buildDays.reduce((a, b) => a + b, 0) / buildDays.length) : null,
    avgHoursPerBuild: launchedHours.length ? round2(launchedHours.reduce((a, b) => a + b, 0) / launchedHours.length) : null,
    totalHours:      round2(totalHours),
    effectiveRate:   ratedHours > 0 ? round2(ratedCollected / ratedHours) : null,
    onTimePct:       withDue ? round2((onTime / withDue) * 100) : null,
    byStage: ['discovery', 'design', 'build', 'review', 'launched'].map(stage => ({
      stage,
      count: d.projects.filter(p => p.stage === stage).length,
    })),
    collectedByProject: Object.fromEntries(d.projects.map(p => [p.id, round2(collectedByProject(p.id))])),
    hoursByProject:     Object.fromEntries(d.projects.map(p => [p.id, round2(hoursByProject(p.id))])),
    unbilledByProject:  Object.fromEntries(unbilledProjects(d).map(p => [p.id, p.unbilled])),
  }
}

// ─── Cohort retention ─────────────────────────────────────────────────────────

/**
 * Retention grid: for each signup month, what share of that cohort was still
 * on a retainer N months later.
 */
export function cohorts(d: BusinessData, months = 12, to = localToday()) {
  const keys = monthSpan(months, to)
  return keys.map(key => {
    const cohort = d.retainers.filter(r => monthKey(r.startDate) === key)
    if (!cohort.length) return { cohort: key, size: 0, retention: [] as (number | null)[] }
    const retention = keys.map((k2, idx) => {
      if (k2 < key) return null
      const end = monthEnd(k2)
      if (end > to) return null
      const alive = cohort.filter(r => r.startDate <= end && (!r.endDate || r.endDate > end) && r.status !== 'cancelled').length
      return round2((alive / cohort.length) * 100)
    }).filter((_, idx) => keys[idx] >= key)
    return { cohort: key, size: cohort.length, retention }
  }).filter(c => c.size > 0)
}

// ─── Gaps between what was agreed and what was recorded ─────────────────────

/**
 * Work that was agreed but never invoiced: a project carries a `value`, yet the
 * invoices raised against it fall short. This is how website builds sold on a
 * handshake stay visible instead of silently missing from revenue.
 */
export function unbilledProjects(d: BusinessData) {
  return d.projects
    .map(p => {
      const invoiced = d.invoices
        .filter(i => i.projectId === p.id && i.status !== 'draft')
        .reduce((s, i) => s + grossOf(i), 0)
      const drafted = d.invoices
        .filter(i => i.projectId === p.id && i.status === 'draft')
        .reduce((s, i) => s + grossOf(i), 0)
      const unbilled = round2((p.value ?? 0) - invoiced - drafted)
      return {
        id: p.id, name: p.name, clientId: p.clientId, stage: p.stage, status: p.status,
        value: p.value ?? 0, invoiced: round2(invoiced), drafted: round2(drafted), unbilled,
      }
    })
    .filter(p => p.value > 0 && p.unbilled > 0.01)
    .sort((a, b) => b.unbilled - a.unbilled)
}

/**
 * Recurring prices written in a client's notes ("Local SEO (£149/mo)") that have
 * no matching retainer. Notes are where deals get agreed first, so this catches
 * MRR that never made it into the system.
 */
export function retainerGaps(d: BusinessData, on = localToday()) {
  const priceRe = /£\s?([\d,]+(?:\.\d{1,2})?)\s*(?:\/|\s+per\s+)\s*(mo|month|wk|week|yr|year)/gi

  const gaps: { clientId: number; clientName: string; amount: number; frequency: string; context: string }[] = []

  for (const c of d.clients) {
    if (!c.notes) continue
    const live = d.retainers.filter(r =>
      r.clientId === c.id && r.status === 'active' && (!r.endDate || r.endDate > on))
    const liveTotal = live.reduce((s, r) => s + toMonthly(r.amount, r.frequency), 0)

    priceRe.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = priceRe.exec(c.notes)) !== null) {
      const amount = Number(match[1].replace(/,/g, ''))
      if (!Number.isFinite(amount) || amount <= 0) continue
      const unit = match[2].toLowerCase()
      const frequency = unit.startsWith('w') ? 'weekly' : unit.startsWith('y') ? 'yearly' : 'monthly'
      const monthly = toMonthly(amount, frequency)

      // Already covered by a live retainer at (roughly) this price - nothing to flag.
      if (live.some(r => Math.abs(toMonthly(r.amount, r.frequency) - monthly) < 0.01)) continue
      // Or the client's total already meets it (e.g. split across two retainers).
      if (liveTotal >= monthly - 0.01 && live.length > 0 && gaps.every(g => g.clientId !== c.id)) continue

      gaps.push({
        clientId: c.id,
        clientName: c.name,
        amount,
        frequency,
        context: c.notes.trim(),
      })
    }
  }
  return gaps
}

// ─── The action queue ─────────────────────────────────────────────────────────

/**
 * Everything that needs a decision today, so the Overview tab can surface work
 * instead of making the user hunt for it across tabs.
 */
export function actionQueue(d: BusinessData, today = localToday()) {
  const in7 = new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10)

  const overdueInvoices = d.invoices
    .filter(i => ['unpaid', 'overdue'].includes(i.status) && i.dueDate < today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map(i => ({
      id: i.id, invoiceNumber: i.invoiceNumber, clientId: i.clientId, amount: grossOf(i),
      dueDate: i.dueDate, daysOverdue: Math.floor((Date.parse(today) - Date.parse(i.dueDate)) / 86_400_000),
    }))

  const dueSoon = d.invoices
    .filter(i => ['unpaid', 'overdue'].includes(i.status) && i.dueDate >= today && i.dueDate <= in7)
    .map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, clientId: i.clientId, amount: grossOf(i), dueDate: i.dueDate }))

  const draftInvoices = d.invoices
    .filter(i => i.status === 'draft')
    .map(i => ({
      id: i.id, invoiceNumber: i.invoiceNumber, clientId: i.clientId, amount: grossOf(i),
      milestoneLabel: i.milestoneLabel, projectId: i.projectId,
    }))

  const renewingSoon = d.retainers
    .filter(r => r.status === 'active' && r.nextInvoiceDate && r.nextInvoiceDate >= today && r.nextInvoiceDate <= in7)
    .map(r => ({ id: r.id, clientId: r.clientId, name: r.name, amount: r.amount, nextInvoiceDate: r.nextInvoiceDate }))

  const overdueProjects = d.projects
    .filter(p => p.status === 'active' && p.dueDate && p.dueDate < today)
    .map(p => ({ id: p.id, name: p.name, clientId: p.clientId, dueDate: p.dueDate, stage: p.stage }))

  const unattributedCosts = d.expenses
    .filter(e => isBusinessExpense(e) && !e.clientId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20)
    .map(e => ({ id: e.id, description: e.description, amount: e.amount, date: e.date }))

  const unbilled = unbilledProjects(d)
  const gaps     = retainerGaps(d, today)

  return {
    overdueInvoices, dueSoon, draftInvoices, renewingSoon, overdueProjects, unattributedCosts,
    unbilledProjects: unbilled,
    unbilledTotal:    round2(unbilled.reduce((s, p) => s + p.unbilled, 0)),
    retainerGaps:     gaps,
    retainerGapsMrr:  round2(gaps.reduce((s, g) => s + toMonthly(g.amount, g.frequency), 0)),
    totalActions: overdueInvoices.length + draftInvoices.length + overdueProjects.length
                + unbilled.length + gaps.length,
  }
}

// ─── Owner's pay ──────────────────────────────────────────────────────────────

export interface OwnerPayOptions {
  /**
   * Whether to hold anything back for tax at all. Off means the step is
   * skipped rather than set to zero, so the waterfall does not carry a row
   * that always reads nothing. Useful before the real rate is known.
   */
  taxReserveEnabled?: boolean
  /** Percentage of profit held back for tax when the reserve is on. */
  taxRatePct?: number
  /** Months of running costs to keep in the business before drawing. */
  bufferMonths?: number
}

/**
 * What the partners have taken, and what it was safe to take.
 *
 * A draw is a distribution of profit, so it sits BELOW net profit: it never
 * appears in `costs()` and never reduces margin. Before this existed the two
 * payouts were filed as business expenses, which made the business look less
 * profitable than it was and hid the money from the personal ledger too.
 */
export function ownerPay(d: BusinessData, r: Range, opts: OwnerPayOptions = {}, today = localToday()) {
  const taxReserveEnabled = opts.taxReserveEnabled ?? true
  const taxRatePct        = opts.taxRatePct ?? 25
  const bufferMonths      = opts.bufferMonths ?? 1

  const period    = pnl(d, r, today)
  const allTime   = pnl(d, {}, today)

  const taxReserve = taxReserveEnabled
    ? round2(Math.max(period.netProfit, 0) * (taxRatePct / 100))
    : 0

  // A month of running costs, averaged over the last three months that had any.
  // Multiplying the period's total costs would make the buffer grow with the
  // window, so an all-time view would demand years of runway before a penny
  // was safe to draw.
  const recent = pnlByMonth(d, 3, today).filter(r => r.totalCosts > 0)
  const monthlyCosts = recent.length
    ? recent.reduce((s2, r) => s2 + r.totalCosts, 0) / recent.length
    : period.totalCosts
  const buffer = round2(monthlyCosts * bufferMonths)
  const distributable = round2(period.netProfit - taxReserve)
  const safeToDraw    = round2(distributable - buffer)

  const allTimeTax = taxReserveEnabled
    ? round2(Math.max(allTime.netProfit, 0) * (taxRatePct / 100))
    : 0
  const allTimeDistributable = round2(allTime.netProfit - allTimeTax)

  const inPeriod = d.draws.filter(x => inRange(x.date, r))
  const drawnPeriod  = round2(inPeriod.reduce((s, x) => s + x.amount, 0))
  const drawnAllTime = round2(d.draws.reduce((s, x) => s + x.amount, 0))

  const owners = d.owners
    .filter(o => o.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map(o => {
      const period   = round2(inPeriod.filter(x => x.ownerId === o.id).reduce((s, x) => s + x.amount, 0))
      const lifetime = round2(d.draws.filter(x => x.ownerId === o.id).reduce((s, x) => s + x.amount, 0))
      const entitled = round2(allTimeDistributable * (o.sharePct / 100))
      return {
        id: o.id, name: o.name, sharePct: o.sharePct,
        period, lifetime, entitled,
        /** Positive means this partner is ahead of their share. */
        delta: round2(lifetime - entitled),
        /** What they could still take before hitting their share. */
        leftToDraw: round2(Math.max(entitled - lifetime, 0)),
      }
    })

  return {
    taxReserveEnabled, taxRatePct, bufferMonths,
    netProfit:    period.netProfit,
    taxReserve,
    buffer,
    distributable,
    safeToDraw,
    drawnPeriod,
    drawnAllTime,
    /** Profit kept in the business after the partners have been paid. */
    retained:     round2(period.netProfit - drawnPeriod),
    overdrawn:    round2(Math.max(drawnPeriod - Math.max(safeToDraw, 0), 0)),
    allTimeDistributable,
    owners,
    recent: [...d.draws]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .slice(0, 24)
      .map(x => ({
        id: x.id, ownerId: x.ownerId,
        ownerName: d.owners.find(o => o.id === x.ownerId)?.name ?? 'Unknown',
        amount: x.amount, date: x.date, method: x.method, notes: x.notes,
        postedToFinances: x.financeIncomeId != null,
      })),
    /** Per month, so the Money table can carry a "drawn" and a "kept" column. */
    byMonth: monthSpan(12, today).map(key => {
      const rows = d.draws.filter(x => monthKey(x.date) === key)
      return { month: key, drawn: round2(rows.reduce((s, x) => s + x.amount, 0)) }
    }),
  }
}

// ─── The one call the Overview/Money tabs make ───────────────────────────────

export async function businessMetrics(r: Range = {}, opts: OwnerPayOptions = {}, today = localToday()) {
  const d = await loadBusinessData()

  const mtdStart = `${today.slice(0, 7)}-01`
  const mtd      = volume(d, { from: mtdStart, to: today })
  const movement = mrrMovement(d, 12, today)
  const thisMonth = movement[movement.length - 1]

  return {
    range: r,
    mrr:       { ...currentMrr(d, today), movement, netNewThisMonth: thisMonth?.net ?? 0 },
    churn:     churn(d, 12, today),
    retainers: {
      active:    d.retainers.filter(r2 => r2.status === 'active').length,
      paused:    d.retainers.filter(r2 => r2.status === 'paused').length,
      cancelled: d.retainers.filter(r2 => r2.status === 'cancelled').length,
    },
    volume:    volume(d, r),
    mtd:       { collected: mtd.net, gross: mtd.gross, invoiceCount: mtd.invoiceCount },
    pnl:       pnl(d, r, today),
    pnlByMonth: pnlByMonth(d, 12, today),
    costs:     costs(d, r, today),
    ar:        arAging(d, today),
    clients:   clientMetrics(d, r, today),
    work:      deliveryStats(d),
    cohorts:   cohorts(d, 12, today),
    ownerPay:  ownerPay(d, r, opts, today),
    actions:   actionQueue(d, today),
    adStale:   adSpendStaleness(d, today),
  }
}

/** Compact figures for the Dashboard business panel - same maths, fewer bytes. */
export async function businessDashboardSummary(today = localToday()) {
  const d = await loadBusinessData()
  const mtdStart = `${today.slice(0, 7)}-01`
  const mtd = volume(d, { from: mtdStart, to: today })
  const m   = currentMrr(d, today)
  const p   = pnl(d, {}, today)
  const mv  = mrrMovement(d, 2, today)
  const ar  = arAging(d, today)
  const c   = costs(d, {}, today)
  const draws = d.draws.filter(x => x.date >= mtdStart && x.date <= today)

  const nextDue = d.invoices
    .filter(i => ['unpaid', 'overdue'].includes(i.status))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null

  return {
    mrr:            m.current,
    arr:            m.arr,
    activeRetainers: m.activeCount,
    netNewMrr:      mv[mv.length - 1]?.net ?? 0,
    collectedMTD:   mtd.net,
    outstanding:    ar.total,
    overdueCount:   ar.overdueCount,
    totalRevenue:   p.netVolume,
    netProfit:      p.netProfit,
    marginPct:      p.marginPct,
    adSpend:        c.adSpend,
    ownerPayMTD:    round2(draws.reduce((s2, x) => s2 + x.amount, 0)),
    activeClients:  d.clients.filter(c => c.status === 'active').length,
    activeProjects: d.projects.filter(p2 => p2.status === 'active').length,
    nextDue: nextDue && {
      invoiceNumber: nextDue.invoiceNumber,
      amount:        grossOf(nextDue),
      dueDate:       nextDue.dueDate,
      clientName:    d.clients.find(c => c.id === nextDue.clientId)?.name ?? null,
    },
  }
}

// ─── Home screen ──────────────────────────────────────────────────────────────

export type NeedAction = 'paid' | 'send' | 'invoice' | 'setup' | 'assign'

export interface NeedRow {
  key: string
  action: NeedAction
  clientId: number | null
  clientName: string
  /** What this is, in the client's language - "hosting", "Local SEO", "website". */
  what: string
  amount: number
  /** Short urgency note: "6 days overdue", "due 30 Aug". */
  detail: string | null
  /** Sort weight - lower is more urgent. */
  rank: number
  invoiceId?: number
  projectId?: number
  expenseId?: number
}

/**
 * Everything waiting on the user, flattened into one ranked list.
 *
 * v2 spread this across eight separate cards; a single list sorted by urgency
 * is what actually gets worked through top to bottom.
 */
export function needsYou(d: BusinessData, today = localToday()): NeedRow[] {
  const clientName = (id: number | null) =>
    d.clients.find(c => c.id === id)?.name ?? 'Unknown'
  const serviceName = (id: number | null) => d.services.find(s => s.id === id)?.name
  const days = (from: string, to: string) => Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000)

  /** Describe an invoice the way its client would: "hosting", "Local SEO", "website". */
  const describe = (i: Invoice): string => {
    if (i.retainerId) {
      const r = d.retainers.find(x => x.id === i.retainerId)
      return (serviceName(r?.serviceId ?? null) ?? r?.name ?? 'retainer').toLowerCase()
    }
    if (i.milestoneLabel) return `website · ${i.milestoneLabel.toLowerCase()}`
    return serviceName(i.serviceId)?.toLowerCase() ?? 'invoice'
  }

  const rows: NeedRow[] = []
  const monthEndDate = monthEnd(today.slice(0, 7))

  for (const i of d.invoices) {
    if (i.status === 'draft') {
      rows.push({
        key: `draft-${i.id}`, action: 'send', invoiceId: i.id,
        clientId: i.clientId, clientName: clientName(i.clientId),
        what: describe(i), amount: grossOf(i),
        detail: 'not sent yet', rank: 300,
      })
      continue
    }
    if (!['unpaid', 'overdue'].includes(i.status)) continue

    const overdueBy = days(i.dueDate, today)
    if (overdueBy > 0) {
      rows.push({
        key: `overdue-${i.id}`, action: 'paid', invoiceId: i.id,
        clientId: i.clientId, clientName: clientName(i.clientId),
        what: describe(i), amount: grossOf(i),
        detail: `${overdueBy} day${overdueBy === 1 ? '' : 's'} overdue`,
        rank: 100 - Math.min(overdueBy, 99),
      })
    } else if (i.dueDate <= monthEndDate) {
      rows.push({
        key: `due-${i.id}`, action: 'paid', invoiceId: i.id,
        clientId: i.clientId, clientName: clientName(i.clientId),
        what: describe(i), amount: grossOf(i),
        detail: overdueBy === 0 ? 'due today' : `due in ${-overdueBy} days`,
        rank: 200 + -overdueBy,
      })
    }
  }

  for (const p of unbilledProjects(d)) {
    rows.push({
      key: `unbilled-${p.id}`, action: 'invoice', projectId: p.id,
      clientId: p.clientId, clientName: clientName(p.clientId),
      what: 'website, never invoiced', amount: p.unbilled,
      detail: p.invoiced > 0 ? `${round2(p.invoiced)} of ${p.value} billed` : 'nothing billed yet',
      rank: 400,
    })
  }

  for (const g of retainerGaps(d, today)) {
    rows.push({
      key: `gap-${g.clientId}-${g.amount}`, action: 'setup',
      clientId: g.clientId, clientName: g.clientName,
      what: 'monthly fee in your notes, not set up', amount: g.amount,
      detail: g.context.length > 60 ? g.context.slice(0, 57) + '…' : g.context,
      rank: 500,
    })
  }

  // A cost is only worth chasing if it looks like it belongs to someone. Tools
  // and subscriptions are genuine overheads, and nagging to attribute them
  // forever is how a work queue turns into noise.
  // Match on the client's full name or full company only. A partial match on one
  // word is worse than no match: "Localo" is a tool subscription, and matching it
  // to "Local Garden & Tree Service" puts a wrong answer in front of the user.
  const needles = d.clients.flatMap(c =>
    [c.name, c.company]
      .filter((v): v is string => !!v && v.trim().length > 3)
      .map(v => ({ needle: v.trim().toLowerCase(), client: c })))

  for (const e of d.expenses) {
    if (e.category !== 'Business' || e.clientId) continue
    if (days(e.date, today) > 60) continue
    const desc = e.description.toLowerCase()
    const match = needles.find(n => desc.includes(n.needle))
    if (!match) continue
    rows.push({
      key: `cost-${e.id}`, action: 'assign', expenseId: e.id,
      clientId: match.client.id, clientName: e.description,
      what: `cost that looks like ${match.client.name}`, amount: e.amount,
      detail: e.date, rank: 600,
    })
  }

  return rows.sort((a, b) => a.rank - b.rank || b.amount - a.amount)
}

/**
 * Everything the one-screen Business home needs, in a single request:
 * three headline numbers, the work queue, live builds and the client list.
 */
export async function businessHome(today = localToday()) {
  const d = await loadBusinessData()

  const mrr       = currentMrr(d, today)
  const monthFrom = `${today.slice(0, 7)}-01`
  const thisMonth = volume(d, { from: monthFrom, to: today })
  const ar        = arAging(d, today)

  const clients = d.clients
    .map(c => {
      const e = clientEconomics(d, c.id, today)
      return {
        id: c.id, name: c.name, company: c.company, status: c.status,
        monthly: e.mrr, lifetime: e.revenue, owed: e.outstanding,
        since: e.since,
        activeWebsites: d.projects.filter(p => p.clientId === c.id && p.status === 'active').length,
      }
    })
    .sort((a, b) => b.monthly - a.monthly || b.lifetime - a.lifetime)

  const inProgress = d.projects
    .filter(p => p.status === 'active')
    .map(p => ({
      id: p.id, name: p.name, clientId: p.clientId,
      clientName: d.clients.find(c => c.id === p.clientId)?.name ?? '--',
      stage: p.stage, dueDate: p.dueDate,
      overdue: !!p.dueDate && p.dueDate < today,
      value: p.value,
    }))
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))

  return {
    /** The only three figures on the home screen. */
    headline: {
      monthly:        mrr.current,
      retainerCount:  mrr.activeCount,
      collectedMonth: thisMonth.net,
      owed:           ar.total,
      overdueCount:   ar.overdueCount,
    },
    needs: needsYou(d, today),
    inProgress,
    clients,
  }
}
