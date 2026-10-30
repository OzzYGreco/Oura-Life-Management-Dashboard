/**
 * Looking ahead and summing up: the cash forecast, the month-end summary and
 * the VAT threshold. All read-only, built from the same loaded books as every
 * other figure, so they cannot disagree with the dashboard.
 */
import {
  loadBusinessData, pnl, mrrMovement, ownerPay, wonOn, owedOn, retainerMrrOn,
  type BusinessData, type OwnerPayOptions,
} from './businessMetrics'
import { advance } from './recurrence'
import { priceOn } from './lifecycle'
import { localToday } from './date'
import { getSettings } from './settings'

const round2 = (n: number) => Math.round(n * 100) / 100
const pad = (n: number) => String(n).padStart(2, '0')
const monthOf = (d: string) => d.slice(0, 7)
function monthEnd(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${key}-${pad(new Date(y, m, 0).getDate())}`
}
function addDays(d: string, n: number): string {
  const [y, m, dd] = d.split('-').map(Number)
  const x = new Date(y, m - 1, dd + n)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}
function monthsFrom(today: string, n: number): string[] {
  const [y, m] = today.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 + i, 1)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  })
}
const PER_YEAR: Record<string, number> = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 }

// ─── Cash forecast ───────────────────────────────────────────────────────────

export interface ForecastItem {
  date: string
  kind: 'retainer' | 'owed' | 'stage' | 'cost' | 'ads'
  label: string
  clientId?: number | null
  amount: number
  /** Already late: counted as expected this month, but less certain. */
  late?: boolean
}

/**
 * What should come in and go out over the next months.
 *
 * In: every retainer period still to bill (at the price for that period,
 * stopping at a last day, restarting after a pause with a date), bills already
 * owed by their due date (late ones in this month), and website stages not
 * yet sent. Out: repeating costs on their next dates, and ad spend at the last
 * 30 days' daily rate for campaigns still running. Bills on hold count on their
 * hold date. Owner draws are left out: they are a choice, not a cost.
 */
export function forecast(d: BusinessData, months = 3, today = localToday()) {
  const keys = monthsFrom(today, months)
  const horizon = monthEnd(keys[keys.length - 1])
  const items: ForecastItem[] = []
  const clientName = (id: number | null) => d.clients.find(c => c.id === id)?.name ?? 'Unknown'

  for (const r of d.retainers) {
    if (r.status === 'cancelled') continue
    if (r.status === 'paused' && !r.resumeOn) continue
    let cursor = r.status === 'paused' ? r.resumeOn! : r.nextInvoiceDate ?? advance(r.lastGeneratedDate ?? r.startDate, r.frequency)
    let guard = 0
    while (cursor <= horizon && (!r.endDate || cursor < r.endDate) && guard++ < 200) {
      if (cursor >= today) {
        items.push({
          date: addDays(cursor, r.netTermDays ?? 0), kind: 'retainer',
          label: `${clientName(r.clientId)}, ${r.name}`, clientId: r.clientId, amount: priceOn(r, d.changes, cursor),
        })
      }
      cursor = advance(cursor, r.frequency)
    }
  }

  for (const i of d.invoices) {
    const owed = owedOn(d, i)
    if (owed <= 0.005) continue
    if (i.status === 'unpaid') {
      const when = i.chaseAfter && i.chaseAfter > today ? i.chaseAfter : i.dueDate
      items.push({
        date: when < today ? today : when, kind: 'owed', late: i.dueDate < today,
        label: `${clientName(i.clientId)}, ${i.invoiceNumber}`, clientId: i.clientId, amount: owed,
      })
    } else if (i.status === 'draft' && i.projectId) {
      items.push({
        date: i.dueDate < today ? today : i.dueDate, kind: 'stage',
        label: `${clientName(i.clientId)}, ${i.milestoneLabel ?? 'website'} stage`, clientId: i.clientId, amount: owed,
      })
    }
  }

  for (const e of d.expenses) {
    if (e.category !== 'Business' || !e.isRecurring || e.recurringParentId || !e.frequency) continue
    const freq = e.frequency === 'annually' ? 'yearly' : e.frequency
    if (!PER_YEAR[freq]) continue
    let cursor = advance(e.lastGeneratedDate ?? e.date, freq)
    let guard = 0
    while (cursor <= horizon && guard++ < 200) {
      if (cursor >= today) items.push({ date: cursor, kind: 'cost', label: e.description, amount: -(e.recurringAmount ?? e.amount) })
      cursor = advance(cursor, freq)
    }
  }

  // Ads at the recent daily rate, for campaigns still running.
  const since = addDays(today, -30)
  for (const c of d.campaigns) {
    if (c.fundingSource !== 'business' || c.status !== 'active') continue
    if (c.endDate && c.endDate < today) continue
    const spent = d.adSpendDaily.filter(a => a.campaignId === c.id && a.date >= since && a.date < today).reduce((s, a) => s + a.spend, 0)
    const daily = spent / 30
    if (daily <= 0.005) continue
    for (const key of keys) {
      const from = key === monthOf(today) ? today : `${key}-01`
      const to = c.endDate && c.endDate < monthEnd(key) ? c.endDate : monthEnd(key)
      const days = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1)
      if (days) items.push({ date: from, kind: 'ads', label: `${c.name} ads`, amount: -round2(daily * days) })
    }
  }

  const inMonth = (key: string) => items.filter(x => monthOf(x.date) === key)
  const sum = (xs: ForecastItem[]) => round2(xs.reduce((s, x) => s + x.amount, 0))
  let running = 0
  const rows = keys.map(key => {
    const xs = inMonth(key)
    const row = {
      month: key,
      retainers: sum(xs.filter(x => x.kind === 'retainer')),
      owed:      sum(xs.filter(x => x.kind === 'owed')),
      stages:    sum(xs.filter(x => x.kind === 'stage')),
      costs:     -sum(xs.filter(x => x.kind === 'cost')),
      ads:       -sum(xs.filter(x => x.kind === 'ads')),
      net: 0, cumulative: 0,
    }
    row.net = round2(row.retainers + row.owed + row.stages - row.costs - row.ads)
    running = round2(running + row.net)
    row.cumulative = running
    return row
  })
  return {
    from: today, to: horizon, months: rows,
    totalIn: round2(rows.reduce((s, r) => s + r.retainers + r.owed + r.stages, 0)),
    totalOut: round2(rows.reduce((s, r) => s + r.costs + r.ads, 0)),
    lateOwed: sum(items.filter(x => x.late)),
    items: items.filter(x => x.date <= horizon).sort((a, b) => a.date.localeCompare(b.date)),
  }
}

// ─── VAT threshold ───────────────────────────────────────────────────────────

/** UK VAT registration threshold (from 1 April 2024). */
export const VAT_THRESHOLD = 90_000

/**
 * Taxable turnover over the last 12 months, the figure HMRC tests against the
 * threshold: everything billed (not void), by issue date. With the monthly
 * pace of the last three months, the month it would cross at that pace.
 */
export function vatTracker(d: BusinessData, today = localToday()) {
  const yearAgo = addDays(today, -365)
  const rolling = round2(d.invoices.filter(i => i.status !== 'draft' && i.issueDate > yearAgo && i.issueDate <= today)
    .reduce((s, i) => s + i.amount, 0))
  const threeAgo = addDays(today, -91)
  const pace = round2(d.invoices.filter(i => i.status !== 'draft' && i.issueDate > threeAgo && i.issueDate <= today)
    .reduce((s, i) => s + i.amount, 0) / 3)
  let crossing: string | null = null
  if (rolling < VAT_THRESHOLD && pace > 0) {
    // At this pace every new month adds `pace` and the month a year back drops
    // out; with a young business that oldest month is usually small.
    const monthsLeft = Math.ceil((VAT_THRESHOLD - rolling) / pace)
    if (monthsLeft <= 36) crossing = monthsFrom(today, monthsLeft + 1)[monthsLeft]
  }
  return { threshold: VAT_THRESHOLD, rolling12: rolling, pct: round2((rolling / VAT_THRESHOLD) * 100), monthlyPace: pace, crossing }
}

// ─── Month-end summary ───────────────────────────────────────────────────────

/** One month, everything the partners would want to know, plus a copyable text. */
export async function monthSummary(month: string, opts: OwnerPayOptions = {}, today = localToday()) {
  const d = await loadBusinessData()
  const from = `${month}-01`
  const end = monthEnd(month)
  const to = end < today ? end : today
  const range = { from, to }
  const p = pnl(d, range, today)
  const [yy, mm] = month.split('-').map(Number)
  const before = new Date(yy, mm - 2, 1)
  const prevKey = `${before.getFullYear()}-${pad(before.getMonth() + 1)}`
  const prev = pnl(d, { from: `${prevKey}-01`, to: monthEnd(prevKey) }, today)
  const mrrAt = (date: string) => round2(d.retainers.reduce((s, r) => s + retainerMrrOn(r, date, d.changes), 0))
  const move = mrrMovement(d, 24, to).find(r => r.month === month) ?? null
  const op = ownerPay(d, range, opts, today)

  const joined = d.clients.filter(c => { const w = wonOn(d, c); return !!w && w >= from && w <= end })
    .map(c => ({ id: c.id, name: c.name }))
  const left = d.clients.filter(c => c.churnedAt && c.churnedAt >= from && c.churnedAt <= end)
    .map(c => ({ id: c.id, name: c.name, reason: c.churnReason }))
  const owedNow = round2(d.invoices.filter(i => i.status === 'unpaid').reduce((s, i) => s + owedOn(d, i), 0))
  const writtenOff = round2(d.allInvoices.filter(i => i.status === 'void' && /written off/i.test(i.voidReason ?? '')
    && i.voidedAt && i.voidedAt >= from && i.voidedAt <= end).reduce((s, i) => s + i.amount, 0))
  const byClient = new Map<number, number>()
  for (const x of d.receipts) if (x.date >= from && x.date <= to) byClient.set(x.clientId, (byClient.get(x.clientId) ?? 0) + x.gross - x.fee - x.refunded)
  const top = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, v]) => ({ id, name: d.clients.find(c => c.id === id)?.name ?? 'Unknown', amount: round2(v) }))
  const vat = vatTracker(d, to)

  const s = {
    month, from, to, partial: end > today,
    moneyIn: p.netVolume, costs: p.totalCosts, adSpend: p.adSpend, profit: p.netProfit, marginPct: p.marginPct,
    previous: { moneyIn: prev.netVolume, profit: prev.netProfit },
    mrr: { start: mrrAt(addDays(from, -1)), end: mrrAt(to), movement: move },
    joined, left, owedNow, writtenOff, top,
    draws: op.owners.map(o => ({ name: o.name, taken: o.period })),
    safeToDraw: Math.max(op.safeToDraw, 0),
    vat,
  }
  return { ...s, text: summaryText(s) }
}

function summaryText(s: any): string {
  const { businessName } = getSettings()
  const gbp = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const [y, m] = s.month.split('-').map(Number)
  const title = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const diff = (a: number, b: number) => (b ? ` (${a >= b ? 'up' : 'down'} ${gbp(Math.abs(a - b))} on last month)` : '')
  const lines = [
    `${businessName}: ${title}${s.partial ? ' so far' : ''}`,
    '',
    `Money in: ${gbp(s.moneyIn)}${diff(s.moneyIn, s.previous.moneyIn)}`,
    `Costs: ${gbp(s.costs)}, of which ads ${gbp(s.adSpend)}`,
    `Profit: ${gbp(s.profit)} (${s.marginPct.toFixed(0)}% margin)${diff(s.profit, s.previous.profit)}`,
    `Monthly recurring: ${gbp(s.mrr.start)} to ${gbp(s.mrr.end)}`,
    '',
    `Joined: ${s.joined.length ? s.joined.map((c: any) => c.name).join(', ') : 'nobody'}`,
    `Left: ${s.left.length ? s.left.map((c: any) => c.name).join(', ') : 'nobody'}`,
    `Owed to us now: ${gbp(s.owedNow)}${s.writtenOff ? `; written off this month ${gbp(s.writtenOff)}` : ''}`,
    '',
    `Taken by partners: ${s.draws.map((o: any) => `${o.name.split(' ')[0]} ${gbp(o.taken)}`).join(', ') || 'nothing'}`,
    `Safe to take for this month: ${gbp(s.safeToDraw)}`,
    '',
    `VAT: ${gbp(s.vat.rolling12)} billed in the last 12 months, ${s.vat.pct.toFixed(0)}% of the ${gbp(s.vat.threshold)} threshold`,
  ]
  if (s.top.length) lines.splice(10, 0, `Top paying: ${s.top.map((c: any) => `${c.name} ${gbp(c.amount)}`).join(', ')}`)
  return lines.join('\n')
}
