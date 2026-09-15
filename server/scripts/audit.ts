/**
 * Numerical audit of the Business tab.
 *
 * Every figure on that page is derived, and a derived figure is only as good as
 * the invariant behind it. This asserts those invariants against the live
 * database and the live API, so a number that has quietly drifted is caught
 * here rather than believed for months.
 *
 * Read-only. It never writes.
 *
 * Run with:  npm run audit --prefix server
 */
import { db } from '../src/db'
import {
  businessInvoices, businessClients, businessRetainers, businessOwnerDraws,
  stripePayments, marketingSpendDaily, marketingCampaigns, financeExpenses,
} from '../src/db/schema'
import { sql } from 'drizzle-orm'
import { businessMetrics, businessDashboardSummary, loadBusinessData, clientEconomics, invalidateBusinessData, adSpendStaleness } from '../src/lib/businessMetrics'

const API = 'http://localhost:3001'
const round2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => n.toFixed(2).padStart(11)

let passed = 0
let failed = 0
const failures: string[] = []

function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ok    ${label}`) }
  else { failed++; failures.push(`${label}${detail ? ' :: ' + detail : ''}`); console.log(`  FAIL  ${label}${detail ? '\n          ' + detail : ''}`) }
}

function near(a: number, b: number, tol = 0.015): boolean {
  return Math.abs(a - b) <= tol
}

async function get(path: string): Promise<any> {
  const res = await fetch(`${API}${path}`)
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json()
}

function section(title: string) {
  console.log(`\n${title}\n${'-'.repeat(title.length)}`)
}

async function main() {
  console.log('\nBUSINESS TAB AUDIT\n==================')
  invalidateBusinessData()

  const d = await loadBusinessData()
  const m = await businessMetrics({})
  const dash = await businessDashboardSummary()

  // ── Money adds up ─────────────────────────────────────────────────────────
  section('1. Collected money reconciles')

  const paid = d.invoices.filter(i => i.status === 'paid')
  const sumGross = round2(paid.reduce((s, i) => s + i.amount, 0))
  const sumFees = round2(d.invoices.reduce((s, i) => s + (i.feeAmount ?? 0), 0))
  const sumRefunds = round2(d.invoices.reduce((s, i) => s + (i.refundedAmount ?? 0), 0))

  check('gross volume equals the sum of paid invoices',
    near(m.pnl.grossVolume, sumGross), `metrics ${money(m.pnl.grossVolume)} vs rows ${money(sumGross)}`)
  check('fees equal the sum of invoice fees',
    near(m.pnl.fees, sumFees), `metrics ${money(m.pnl.fees)} vs rows ${money(sumFees)}`)
  check('net volume is gross minus fees minus refunds',
    near(m.pnl.netVolume, round2(sumGross - sumFees - sumRefunds)),
    `${money(m.pnl.netVolume)} vs ${money(round2(sumGross - sumFees - sumRefunds))}`)
  check('net profit is net volume minus total costs',
    near(m.pnl.netProfit, round2(m.pnl.netVolume - m.pnl.totalCosts)))
  check('total costs are ads plus overheads plus client costs',
    near(m.pnl.totalCosts, round2(m.pnl.adSpend + m.pnl.overheads + m.pnl.clientCosts)))
  check('no invoice has a fee larger than the invoice',
    !d.invoices.some(i => (i.feeAmount ?? 0) > i.amount + 0.001),
    d.invoices.filter(i => (i.feeAmount ?? 0) > i.amount + 0.001).map(i => i.invoiceNumber).join(', '))
  check('no negative amounts, fees or refunds',
    !d.invoices.some(i => i.amount < 0 || (i.feeAmount ?? 0) < 0 || (i.refundedAmount ?? 0) < 0))

  // ── Stripe reconciles ─────────────────────────────────────────────────────
  section('2. Stripe reconciles')

  const matched = await db.select().from(stripePayments).where(sql`matched_invoice_id is not null`)
  const stripeFees = round2(matched.reduce((s, p) => s + p.fee, 0))
  check('invoice fees equal the fees of matched Stripe payments',
    near(sumFees, stripeFees), `invoices ${money(sumFees)} vs stripe ${money(stripeFees)}`)

  const dupes = await db.all<{ id: number; n: number }>(sql`
    select matched_invoice_id as id, count(*) as n from stripe_payments
    where matched_invoice_id is not null group by matched_invoice_id having count(*) > 1`)
  check('no invoice is claimed by two payments', dupes.length === 0,
    dupes.map(r => `invoice ${r.id} x${r.n}`).join(', '))

  // A decision the user made by hand has to survive the next sync, and has to
  // leave the queue. Both once keyed off matched_invoice_id, so assigning a
  // payment to a client who had no invoice saved correctly, stayed in the queue
  // anyway, and was then overwritten wholesale by the following sync. The field
  // that marks a decision is matched_at; these assert nothing drifts back.
  const decided = await db.all<{ n: number }>(sql`
    select count(*) as n from stripe_payments
    where match_reason like 'Assigned by hand%' and matched_at is null`)
  check('a hand assignment is never left without a decision stamp',
    (decided[0]?.n ?? 0) === 0,
    'without matched_at the next sync overwrites it and it returns to the queue')

  const ghostQueue = await db.all<{ n: number }>(sql`
    select count(*) as n from stripe_payments
    where matched_at is not null and ignored = 0 and matched_client_id is null`)
  check('nothing is marked decided without a client to show for it',
    (ghostQueue[0]?.n ?? 0) === 0)

  const orphanClient = await db.all<{ n: number }>(sql`
    select count(*) as n from stripe_payments p
    where p.matched_client_id is not null
      and not exists (select 1 from business_clients c where c.id = p.matched_client_id)`)
  check('every assigned payment points at a client that exists', (orphanClient[0]?.n ?? 0) === 0)

  // Money attached to a client but to no invoice is money that exists in the
  // bank and in no figure on the page: gross volume, fees and profit are all
  // built from paid invoices. Raising an invoice from the payment is the fix,
  // and this is here so a silent gap cannot open up again.
  const offBooks = await db.all<{ n: number; gross: number }>(sql`
    select count(*) as n, coalesce(sum(amount_gross), 0) as gross from stripe_payments
    where matched_client_id is not null and matched_invoice_id is null and ignored = 0`)
  check('no payment is assigned to a client but left off the books',
    (offBooks[0]?.n ?? 0) === 0,
    `${offBooks[0]?.n} payment(s), ${money(round2(offBooks[0]?.gross ?? 0))} missing from every total`)

  // Paying before the invoice is raised is normal: a deposit agreed on the day,
  // or a first month bought up front. What is NOT normal is the matcher doing
  // it by itself, which is how an August payment once landed on September's
  // invoice and wrongly cleared the month's outstanding balance.
  const assignedByHand = new Set(
    (await db.select().from(stripePayments))
      .filter(p => /hand/i.test(p.matchReason ?? ''))
      .flatMap(p => [p.matchedInvoiceId, ...(p.coversInvoiceIds ? JSON.parse(p.coversInvoiceIds) as number[] : [])])
      .filter((x): x is number => x != null))

  const earlyAuto = d.invoices.filter(i =>
    i.paidDate && i.paidDate < i.issueDate
    && (Date.parse(i.issueDate) - Date.parse(i.paidDate)) / 86400000 > 10
    && !assignedByHand.has(i.id))
  check('no invoice was AUTOMATICALLY matched to a payment predating it by over 10 days',
    earlyAuto.length === 0,
    earlyAuto.map(i => `${i.invoiceNumber} issued ${i.issueDate} paid ${i.paidDate}`).join('; '))

  const paidNoMethod = d.invoices.filter(i => i.status === 'paid' && !i.paymentMethod)
  check('every paid invoice records how it was paid', paidNoMethod.length === 0,
    `${paidNoMethod.length} without a method`)

  // ── MRR ───────────────────────────────────────────────────────────────────
  section('3. MRR')

  const activeSum = round2(d.retainers
    .filter(r => r.status === 'active')
    .reduce((s, r) => s + r.amount * ({ weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[r.frequency] ?? 1), 0))
  check('MRR equals the sum of active retainers',
    near(m.mrr.current, activeSum), `metrics ${money(m.mrr.current)} vs rows ${money(activeSum)}`)
  check('ARR is twelve times MRR', near(m.mrr.arr, round2(m.mrr.current * 12)))
  check('average per client is MRR divided by the retainer count',
    m.mrr.activeCount === 0 || near(m.mrr.arpa, round2(m.mrr.current / m.mrr.activeCount)))
  check('MRR by service sums to total MRR',
    near(round2(m.mrr.byService.reduce((s, x) => s + x.mrr, 0)), m.mrr.current))
  check('a cancelled retainer contributes nothing',
    !d.retainers.some(r => r.status === 'cancelled' && r.endDate && r.endDate <= new Date().toISOString().slice(0, 10)
      && m.mrr.byService.some(() => false)))
  check('no active retainer is already due to invoice',
    !d.retainers.some(r => r.status === 'active' && r.autoInvoice === 1 && r.nextInvoiceDate
      && r.nextInvoiceDate <= new Date().toISOString().slice(0, 10)),
    d.retainers.filter(r => r.status === 'active' && r.autoInvoice === 1 && r.nextInvoiceDate
      && r.nextInvoiceDate <= new Date().toISOString().slice(0, 10)).map(r => `${r.id} due ${r.nextInvoiceDate}`).join(', '))

  // ── Owner pay ─────────────────────────────────────────────────────────────
  section('4. Owner pay')

  const draws = await db.select().from(businessOwnerDraws)
  const drawSum = round2(draws.reduce((s, x) => s + x.amount, 0))
  check('all-time draws equal the sum of draw rows',
    near(m.ownerPay.drawnAllTime, drawSum), `${money(m.ownerPay.drawnAllTime)} vs ${money(drawSum)}`)
  check('per-partner lifetime figures sum to the total',
    near(round2(m.ownerPay.owners.reduce((s, o) => s + o.lifetime, 0)), drawSum))
  check('owner shares add up to 100 percent',
    near(round2(d.owners.filter(o => o.active).reduce((s, o) => s + o.sharePct, 0)), 100, 0.01))
  check('a draw is not counted as a business cost',
    !d.expenses.some(e => e.category === 'Business' && /payout|draw/i.test(e.description)),
    d.expenses.filter(e => e.category === 'Business' && /payout|draw/i.test(e.description)).map(e => e.description).join(', '))
  check('distributable is profit minus the tax reserve',
    near(m.ownerPay.distributable, round2(m.ownerPay.netProfit - m.ownerPay.taxReserve)))

  // ── Ad spend ──────────────────────────────────────────────────────────────
  section('5. Ad spend')

  const daily = await db.select().from(marketingSpendDaily)
  const campaigns = await db.select().from(marketingCampaigns)
  const bizCampaigns = campaigns.filter(c => c.fundingSource === 'business')
  const lifetimeTotal = round2(bizCampaigns.reduce((s, c) => s + (c.spent ?? 0), 0))
  const measuredTotal = round2(daily
    .filter(x => bizCampaigns.some(c => c.id === x.campaignId))
    .reduce((s, x) => s + x.spend, 0))

  check('all-time ad spend is at least the measured total',
    m.pnl.adSpend >= measuredTotal - 0.02,
    `metrics ${money(m.pnl.adSpend)} vs measured ${money(measuredTotal)}`)
  // Campaigns with daily rows contribute their measured total. Campaigns
  // without any still fall back to a pro-rated share of their lifetime figure,
  // so the cap is the sum of both, not the larger of the two.
  const unmeasuredLifetime = round2(bizCampaigns
    .filter(c => !daily.some(x => x.campaignId === c.id))
    .reduce((s, c) => s + (c.spent ?? 0), 0))
  const cap = round2(measuredTotal + unmeasuredLifetime)
  check('all-time ad spend equals measured days plus unmeasured campaigns',
    near(m.pnl.adSpend, cap, 0.05),
    `metrics ${money(m.pnl.adSpend)} vs measured ${money(measuredTotal)} + unmeasured ${money(unmeasuredLifetime)} = ${money(cap)}`)
  const dayDupes = await db.all<{ n: number }>(sql`
    select count(*) as n from (select campaign_id, date from marketing_spend_daily group by 1,2 having count(*) > 1)`)
  check('one ad-spend row per campaign per day', (dayDupes[0]?.n ?? 0) === 0)
  check('no negative ad spend', !daily.some(x => x.spend < 0))

  // A dead connector is the one fault the rest of the tab cannot show, because
  // days after the last recorded one count as zero rather than being estimated:
  // costs fall, profit rises, and nothing on screen says why. These assert the
  // warning both fires and stays quiet at the right times, since a warning that
  // cried wolf would be turned off and one that never fires is not there at all.
  const lastDay = daily.map(x => x.date).sort().slice(-1)[0] ?? '1970-01-01'
  const dayAfter = (iso: string, n: number) => {
    const [y, mo, dd] = iso.split('-').map(Number)
    const t = new Date(y, mo - 1, dd + n)
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  }
  check('ad-spend staleness is quiet the day after the last figure',
    adSpendStaleness(d, dayAfter(lastDay, 1)).campaigns.length === 0,
    'a platform finalises a day some hours late, so one day behind is normal')
  const twoBehind = adSpendStaleness(d, dayAfter(lastDay, 2))
  check('ad-spend staleness fires once a whole day is missing',
    twoBehind.campaigns.length > 0 && twoBehind.estimatedMissing > 0,
    `${twoBehind.campaigns.length} campaign(s), ${money(twoBehind.estimatedMissing)} estimated`)
  check('the staleness estimate grows with the gap',
    adSpendStaleness(d, dayAfter(lastDay, 6)).estimatedMissing > twoBehind.estimatedMissing)
  check('hand-logged campaigns never go stale',
    adSpendStaleness({ ...d, campaigns: d.campaigns.map(c => ({ ...c, externalId: null })) },
      dayAfter(lastDay, 30)).campaigns.length === 0,
    'nothing is feeding them, so there is nothing to have stopped')

  // ── Monthly rows sum to the total ─────────────────────────────────────────
  section('6. Monthly breakdown sums to the whole')

  const byMonthNet = round2(m.volume.byMonth.reduce((s, r) => s + r.net, 0))
  const allTimeNet = m.volume.net
  check('twelve-month net is not greater than all-time net',
    byMonthNet <= allTimeNet + 0.02, `12mo ${money(byMonthNet)} vs all ${money(allTimeNet)}`)
  check('each month splits cleanly into retainer and one-off',
    m.volume.byMonth.every(r => near(r.net, round2(r.retainer + r.oneOff))),
    m.volume.byMonth.filter(r => !near(r.net, round2(r.retainer + r.oneOff)))
      .map(r => `${r.month}: ${r.net} vs ${round2(r.retainer + r.oneOff)}`).join('; '))
  check('no month reports negative income', !m.volume.byMonth.some(r => r.net < 0))

  // ── Per-client figures sum to the whole ───────────────────────────────────
  section('7. Client figures sum to the whole')

  const econ = d.clients.map(c => clientEconomics(d, c.id))
  const clientRevenue = round2(econ.reduce((s, e) => s + e.revenue, 0))
  check('client lifetime revenue sums to net volume',
    near(clientRevenue, m.pnl.netVolume, 0.05), `clients ${money(clientRevenue)} vs net ${money(m.pnl.netVolume)}`)
  const clientMrr = round2(econ.reduce((s, e) => s + e.mrr, 0))
  check('client MRR sums to total MRR', near(clientMrr, m.mrr.current))
  const clientOutstanding = round2(econ.reduce((s, e) => s + e.outstanding, 0))
  check('client outstanding sums to accounts receivable',
    near(clientOutstanding, m.ar.total), `clients ${money(clientOutstanding)} vs ar ${money(m.ar.total)}`)
  check('no client margin exceeds their revenue',
    !econ.some(e => e.margin > e.revenue + 0.001))

  // ── Dashboard agrees with Business ────────────────────────────────────────
  section('8. Dashboard agrees with the Business tab')

  check('net profit agrees', near(dash.netProfit, m.pnl.netProfit),
    `dashboard ${money(dash.netProfit)} vs business ${money(m.pnl.netProfit)}`)
  check('revenue agrees', near(dash.totalRevenue, m.pnl.netVolume))
  check('outstanding agrees', near(dash.outstanding, m.ar.total))
  check('MRR agrees', near(dash.mrr, m.mrr.current))
  check('active clients agree', dash.activeClients === m.clients.active)

  // ── Accounts receivable ───────────────────────────────────────────────────
  section('9. Accounts receivable')

  const open = d.invoices.filter(i => ['unpaid', 'overdue'].includes(i.status))
  check('outstanding equals the sum of unpaid invoices',
    near(m.ar.total, round2(open.reduce((s, i) => s + i.amount, 0))))
  check('ageing buckets sum to the total',
    near(round2(m.ar.current + m.ar.d1_30 + m.ar.d31_60 + m.ar.d61_90 + m.ar.d90plus), m.ar.total))
  check('overdue count never exceeds the open count', m.ar.overdueCount <= m.ar.count)
  check('a paid invoice never carries an outstanding balance',
    !d.invoices.some(i => i.status === 'paid' && !i.paidDate),
    d.invoices.filter(i => i.status === 'paid' && !i.paidDate).map(i => i.invoiceNumber).join(', '))

  // ── Data integrity ────────────────────────────────────────────────────────
  section('10. Data integrity')

  const numbers = d.invoices.map(i => i.invoiceNumber)
  check('invoice numbers are unique', new Set(numbers).size === numbers.length)
  const orphanInvoices = d.invoices.filter(i => !d.clients.some(c => c.id === i.clientId))
  check('every invoice belongs to a client that exists', orphanInvoices.length === 0,
    orphanInvoices.map(i => i.invoiceNumber).join(', '))
  const orphanRetainers = d.retainers.filter(r => !d.clients.some(c => c.id === r.clientId))
  check('every retainer belongs to a client that exists', orphanRetainers.length === 0)
  check('no duplicate Stripe customer across two clients',
    (() => {
      const ids = d.clients.map(c => c.stripeCustomerId).filter(Boolean)
      return new Set(ids).size === ids.length
    })(),
    'two clients share a Stripe customer, which would misattribute every future payment')
  check('every invoice has a due date not before its issue date',
    !d.invoices.some(i => i.dueDate < i.issueDate),
    d.invoices.filter(i => i.dueDate < i.issueDate).map(i => i.invoiceNumber).join(', '))

  // ── The API returns what the engine computes ──────────────────────────────
  section('11. The API returns what the engine computes')

  try {
    const apiMetrics = await get('/api/business/metrics')
    check('API net profit equals the engine', near(apiMetrics.pnl.netProfit, m.pnl.netProfit))
    check('API MRR equals the engine', near(apiMetrics.mrr.current, m.mrr.current))

    const ledger = await get('/api/business/invoices/ledger')
    const ledgerBilled = round2(ledger.rows.reduce((s: number, r: any) => s + r.gross, 0))
    const allBilled = round2(d.invoices.reduce((s, i) => s + i.amount, 0))
    check('the ledger bills what the invoices say',
      near(ledgerBilled, allBilled), `ledger ${money(ledgerBilled)} vs rows ${money(allBilled)}`)
    check('ledger totals match its own rows', near(ledger.totals.billed, ledgerBilled))

    const rows = await get('/api/business/clients/overview')
    check('the clients endpoint returns every client', rows.length === d.clients.length)
    check('clients endpoint MRR sums to total MRR',
      near(round2(rows.reduce((s: number, r: any) => s + r.mrr, 0)), m.mrr.current))
  } catch (e: any) {
    check('API reachable', false, e.message)
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  ${passed} passed, ${failed} failed`)
  if (failures.length) {
    console.log('\n  Failures:')
    failures.forEach(f => console.log(`    - ${f}`))
  }
  console.log(`${'='.repeat(60)}\n`)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error('\nAudit crashed:', e?.message ?? e, '\n'); process.exit(2) })
