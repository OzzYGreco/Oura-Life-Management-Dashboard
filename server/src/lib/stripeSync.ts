/**
 * Stripe payments, with the fee Stripe actually charged.
 *
 * Two jobs. The first is exactness: three identical GBP149.99 invoices in this
 * database were paid with fees of 2.46, 3.05 and 4.07 depending on the card, so
 * a fee can only ever be read, never estimated.
 *
 * The second is attribution, and the design choice worth explaining is that
 * payer NAME is the weakest signal available and is used last, as a tiebreak,
 * never on its own. Clients type "J Smith" or nothing at all. Every other
 * signal is stronger:
 *
 *   1. Our own invoice id in the payment metadata. Exact, when the app made the link.
 *   2. A Stripe customer already tied to a client. Exact, and learned from one
 *      correction: the business is mostly retainers, so 16 customers account for
 *      roughly 192 payments a year. After the first match, none are ambiguous.
 *   3. Email, which identifies the client even when the name is nonsense.
 *   4. An exact amount against exactly one open invoice. There is usually only
 *      one unpaid invoice at a time and the prices are distinctive.
 *   5. Name similarity, last, and never enough on its own to auto-apply.
 *
 * Credentials live in server/.env. A RESTRICTED key with read access to Charges
 * and Balance transactions is enough, and is what should be used: a full secret
 * key would let this process move money, which it never needs to do.
 *
 *   STRIPE_SECRET_KEY=rk_live_...
 */
import { db } from '../db'
import { stripePayments, businessInvoices, businessClients, businessPaymentAllocations, stripeFailedCharges } from '../db/schema'
import { eq, and, isNull, isNotNull, sql } from 'drizzle-orm'
import { localToday } from './date'
import { applyPayment, defaultSplits, learnCustomerTx, allocationsFor, round2 as r2, type Tx } from './payments'

const API = 'https://api.stripe.com/v1'

export type Confidence = 'exact' | 'high' | 'low' | 'none'

export interface StripeSyncResult {
  ok: boolean
  fetched: number
  created: number
  autoApplied: number
  queued: number
  message: string
}

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

function keyKind(): 'restricted' | 'secret' | 'test' | 'none' {
  const k = process.env.STRIPE_SECRET_KEY ?? ''
  if (!k) return 'none'
  if (k.startsWith('rk_')) return 'restricted'
  if (k.startsWith('sk_test')) return 'test'
  return 'secret'
}

export function stripeStatusNote(): string {
  switch (keyKind()) {
    case 'restricted': return 'Using a restricted read-only key, which is the right thing.'
    case 'secret':     return 'This is a full secret key. A restricted key with read access to Charges and Balance transactions is safer and is all this needs.'
    case 'test':       return 'This is a test-mode key, so it will only ever see test payments.'
    default:           return 'No key set.'
  }
}

async function stripeGet(path: string, params: Record<string, string | string[]>): Promise<any> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')

  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(item => qs.append(k, item))
    else qs.append(k, v)
  }

  const res = await fetch(`${API}/${path}?${qs}`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  const body: any = await res.json()
  if (!res.ok || body.error) {
    throw new Error(body?.error?.message ? `Stripe: ${body.error.message}` : `Stripe returned ${res.status}`)
  }
  return body
}

/**
 * Write to Stripe. Only payment links use this; everything else reads. A
 * read-only key answers with a permission error, which is turned into what to
 * change rather than Stripe's own wording.
 */
async function stripePost(path: string, params: Record<string, string>): Promise<any> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw Object.assign(new Error('Stripe is not connected, so a payment link cannot be made.'), { status: 409 })
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  const body: any = await res.json()
  if (!res.ok || body.error) {
    const perm = res.status === 403 || /permission|restricted/i.test(body?.error?.message ?? '')
    throw Object.assign(new Error(perm
      ? 'Your Stripe key can only read. To make payment links, give it write access to Payment Links, Prices and Products in Stripe (Developers, API keys, edit the restricted key).'
      : body?.error?.message ? `Stripe: ${body.error.message}` : `Stripe returned ${res.status}`), { status: perm ? 409 : 502 })
  }
  return body
}

/**
 * A Stripe Payment Link for one invoice, for what is still owed on it. The
 * invoice id rides in the metadata, which the sync already reads, so the money
 * matches the invoice by itself when it arrives. One use only.
 */
export async function createPaymentLink(p: { invoiceId: number; invoiceNumber: string; what: string; amount: number; currency: string }) {
  const price = await stripePost('prices', {
    currency: p.currency.toLowerCase(),
    unit_amount: String(Math.round(p.amount * 100)),
    'product_data[name]': `${p.invoiceNumber}: ${p.what}`,
  })
  const link = await stripePost('payment_links', {
    'line_items[0][price]': price.id,
    'line_items[0][quantity]': '1',
    'metadata[ouraInvoiceId]': String(p.invoiceId),
    'payment_intent_data[metadata][ouraInvoiceId]': String(p.invoiceId),
    'restrictions[completed_sessions][limit]': '1',
  })
  return { id: link.id as string, url: link.url as string }
}

/** Switch a link off once its invoice no longer needs it. Best effort. */
export async function deactivatePaymentLink(id: string): Promise<void> {
  try { await stripePost(`payment_links/${id}`, { active: 'false' }) } catch { /* a read-only key, or already off */ }
}

const round2 = (n: number) => Math.round(n * 100) / 100
/** Stripe reports money in the currency's smallest unit. */
const fromMinor = (n: number) => round2((n ?? 0) / 100)

function dateOf(unix: number): string {
  const d = new Date(unix * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export interface FetchedCharge {
  stripeId: string
  paymentIntentId: string | null
  customerId: string | null
  invoiceId: string | null
  gross: number
  fee: number
  net: number
  refunded: number
  currency: string
  paidDate: string
  payerName: string | null
  payerEmail: string | null
  description: string | null
  status: string
  /** The client disputed the charge with their bank. */
  disputed: boolean
  /** Whatever the app stamped on the payment when it created the link. */
  ourInvoiceId: number | null
  /** Set when a Stripe invoice says this charge settled a subscription. */
  plan: SubscriptionPlan | null
}

export interface SubscriptionPlan {
  subscriptionId: string
  /** Stripe's enum. 'subscription_create' is a retainer starting, 'subscription_cycle' a renewal. */
  billingReason: string
  amount: number
  intervalDays: number
  description: string | null
}

/** A subscription invoice, kept only long enough to pair it with its charge. */
interface PlanInvoice extends SubscriptionPlan {
  customer: string
  /** What the invoice actually collected, for pairing against the charge. */
  gross: number
  /** Unix seconds the invoice was paid, which is the moment the charge settled. */
  paidAt: number
}

/**
 * The subscription facts, read from Stripe invoices rather than guessed.
 *
 * A charge on its own carries only the description Stripe writes for it,
 * "Subscription creation" or "Subscription update", which is prose and cannot
 * be trusted to decide whether money recurs. The invoice behind it carries the
 * real thing: `billing_reason` as an enum, the subscription id, the price per
 * cycle and the period that cycle covers.
 */
export async function fetchSubscriptionPlans(sinceUnix: number): Promise<PlanInvoice[]> {
  const out: PlanInvoice[] = []
  let startingAfter: string | undefined

  for (let page = 0; page < 40; page++) {
    const body = await stripeGet('invoices', {
      limit: '100',
      'created[gte]': String(sinceUnix),
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })

    for (const i of body.data ?? []) {
      startingAfter = i.id

      // Stripe's newer layout: what used to be invoice.subscription now hangs
      // off parent, and its absence is what marks a genuine one-off.
      const subscriptionId = i.parent?.subscription_details?.subscription
      const customer = typeof i.customer === 'string' ? i.customer : i.customer?.id
      if (!subscriptionId || !customer) continue

      const line = i.lines?.data?.[0]
      const unit = Number(line?.pricing?.unit_amount_decimal ?? 0) / 100
      const period = line?.period

      out.push({
        subscriptionId,
        billingReason: String(i.billing_reason ?? ''),
        amount: round2(unit * Number(line?.quantity ?? 1)),
        // The cycle length is the period the line covers, so a monthly plan
        // reads 30 or 31 and a yearly one reads 365, with no price expansion.
        intervalDays: period?.start && period?.end
          ? Math.round((period.end - period.start) / 86_400)
          : 30,
        description: line?.description ?? null,
        customer,
        gross: fromMinor(i.amount_paid),
        paidAt: i.status_transitions?.paid_at ?? i.created,
      })
    }

    if (!body.has_more) break
  }

  return out
}

/**
 * Pair a charge with the subscription invoice that produced it.
 *
 * A restricted key does not expose the link from charge to invoice, so they are
 * paired on customer, amount and time. The invoice's paid_at and the charge's
 * created are the same event, seconds apart, so the window is far wider than it
 * needs to be and still cannot reach a neighbouring month's payment.
 */
function planForCharge(
  plans: PlanInvoice[],
  customerId: string | null,
  gross: number,
  createdUnix: number,
): SubscriptionPlan | null {
  if (!customerId) return null

  let best: PlanInvoice | null = null
  let bestGap = Infinity
  for (const p of plans) {
    if (p.customer !== customerId) continue
    if (Math.abs(p.gross - gross) > 0.005) continue
    const gap = Math.abs(p.paidAt - createdUnix)
    if (gap > 900 || gap >= bestGap) continue
    best = p
    bestGap = gap
  }
  if (!best) return null

  return {
    subscriptionId: best.subscriptionId,
    billingReason: best.billingReason,
    amount: best.amount,
    intervalDays: best.intervalDays,
    description: best.description,
  }
}

/** A card payment Stripe attempted and the bank declined. */
export interface FailedCharge {
  stripeId: string; customerId: string | null; subscriptionId: string | null
  amount: number; currency: string; failedDate: string
  payerName: string | null; payerEmail: string | null; failureMessage: string | null
}

export async function fetchCharges(sinceUnix: number, failed: FailedCharge[] = []): Promise<FetchedCharge[]> {
  const out: FetchedCharge[] = []
  const plans = await fetchSubscriptionPlans(sinceUnix)
  let startingAfter: string | undefined

  for (let page = 0; page < 40; page++) {
    const body = await stripeGet('charges', {
      limit: '100',
      'created[gte]': String(sinceUnix),
      // Three expansions, each load-bearing:
      //   balance_transaction - where the real fee lives. Without it Stripe
      //     reports only the gross and the fee has to be guessed.
      //   payment_intent - where a Payment Link puts its metadata. Charge
      //     metadata is usually empty, so without this the invoice id we stamp
      //     on a link would never be seen.
      //   invoice - the Stripe invoice number, for the ones raised in Stripe.
      'expand[]': ['data.balance_transaction', 'data.payment_intent', 'data.invoice'],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })

    for (const c of body.data ?? []) {
      if (c.status === 'failed') {
        const inv = typeof c.invoice === 'object' ? c.invoice : null
        failed.push({
          stripeId: c.id,
          customerId: typeof c.customer === 'string' ? c.customer : c.customer?.id ?? null,
          subscriptionId: typeof inv?.subscription === 'string' ? inv.subscription : inv?.subscription?.id ?? null,
          amount: fromMinor(c.amount), currency: String(c.currency ?? 'gbp').toUpperCase(),
          failedDate: dateOf(c.created),
          payerName: c.billing_details?.name ?? null, payerEmail: c.billing_details?.email ?? c.receipt_email ?? null,
          failureMessage: c.outcome?.seller_message ?? c.failure_message ?? null,
        })
        continue
      }
      if (c.status !== 'succeeded') continue
      const bt = typeof c.balance_transaction === 'object' ? c.balance_transaction : null
      const billing = c.billing_details ?? {}

      // A Payment Link stamps metadata on the PaymentIntent, a Stripe Invoice on
      // the invoice, and a direct charge on the charge. Read all three.
      const pi = typeof c.payment_intent === 'object' ? c.payment_intent : null
      const inv = typeof c.invoice === 'object' ? c.invoice : null
      const meta = { ...(inv?.metadata ?? {}), ...(pi?.metadata ?? {}), ...(c.metadata ?? {}) }
      const ourId = Number(meta.ouraInvoiceId ?? meta.oura_invoice_id)

      out.push({
        stripeId: c.id,
        paymentIntentId: typeof c.payment_intent === 'string' ? c.payment_intent : pi?.id ?? null,
        customerId: typeof c.customer === 'string' ? c.customer : c.customer?.id ?? null,
        invoiceId: typeof c.invoice === 'string' ? c.invoice : inv?.id ?? null,
        gross: fromMinor(c.amount),
        fee: bt ? fromMinor(bt.fee) : 0,
        net: bt ? fromMinor(bt.net) : fromMinor(c.amount),
        refunded: fromMinor(c.amount_refunded),
        currency: String(c.currency ?? 'gbp').toUpperCase(),
        paidDate: dateOf(c.created),
        payerName: billing.name ?? c.source?.name ?? null,
        payerEmail: billing.email ?? c.receipt_email ?? null,
        description: c.description ?? inv?.number ?? null,
        status: c.status,
        disputed: !!c.disputed,
        ourInvoiceId: Number.isFinite(ourId) && ourId > 0 ? ourId : null,
        plan: planForCharge(
          plans,
          typeof c.customer === 'string' ? c.customer : c.customer?.id ?? null,
          fromMinor(c.amount),
          Number(c.created),
        ),
      })
      startingAfter = c.id
    }

    if (!body.has_more) break
  }

  return out
}

// ─── Matching ─────────────────────────────────────────────────────────────────

export interface MatchResult {
  clientId: number | null
  invoiceId: number | null
  /** Set when one payment plainly settled several invoices together. */
  invoiceIds?: number[]
  confidence: Confidence
  reason: string
}

/**
 * Of a client's open invoices, the one set of 2 to 4 that adds up to the payment.
 *
 * This is the Hope case: a website billed as a deposit, a presentation and a
 * launch, with the last two paid in one go. No single invoice matches, so before
 * this the payment sat in the queue and was easy to settle the wrong way.
 *
 * Kept narrow on purpose. Only invoices that have been SENT count, since a
 * client cannot be paying a draft they have never seen; the set has to include
 * their oldest open invoice, because people pay what they owe in order; and it
 * has to be the only set that fits, or it is a guess.
 */
export function subsetFor(
  gross: number,
  open: { id: number; issueDate: string; remaining: number }[],
): number[] | null {
  const pool = [...open].sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.id - b.id)
  if (pool.length < 2) return null
  const hits = subsetsFor(gross, pool, 2)
  if (hits.length !== 1) return null
  return hits[0].includes(pool[0].id) ? hits[0] : null
}

/**
 * Every set of 2 to 4 invoices whose remaining amounts add up to the payment to
 * the penny, fewest invoices first. The picker offers these as one-click
 * choices; the auto-matcher above uses it only when there is exactly one.
 */
export function subsetsFor(
  gross: number,
  open: { id: number; issueDate: string; remaining: number }[],
  limit = 4,
): number[][] {
  const pool = [...open].sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.id - b.id).slice(0, 12)
  const hits: number[][] = []
  const walk = (start: number, picked: typeof pool, sum: number) => {
    if (hits.length >= limit) return
    if (picked.length >= 2 && Math.abs(sum - gross) < 0.006) hits.push(picked.map(x => x.id))
    if (picked.length === 4) return
    for (let i = start; i < pool.length; i++) walk(i + 1, [...picked, pool[i]], sum + pool[i].remaining)
  }
  walk(0, [], 0)
  return hits.sort((a, b) => a.length - b.length)
}

/** Strip everything that varies between how a name is typed and how it is stored. */
function normalise(s: string): string {
  return s.toLowerCase()
    .replace(/\b(ltd|limited|llp|plc|inc|co|company|services?|solutions?)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Share of the shorter name's words that appear in the longer one.
 *
 * One shared word is only a match when neither name has anything else in it.
 * Dividing by the shorter name alone scored payer "Sam Carter" as a 100%
 * match for a client stored as just "Sam": a shared first name. With no other
 * Sam on the books that was the only candidate, so the payment was suggested
 * for, and set up as a retainer on, a different person entirely.
 */
function nameOverlap(a: string, b: string): number {
  const A = new Set(normalise(a).split(' ').filter(w => w.length > 2))
  const B = new Set(normalise(b).split(' ').filter(w => w.length > 2))
  if (!A.size || !B.size) return 0
  let hits = 0
  for (const w of A) if (B.has(w)) hits++
  if (hits === 1 && Math.max(A.size, B.size) > 1) return 0
  return hits / Math.min(A.size, B.size)
}

/** A single client the payer name plainly points at, or null. */
function nameSuggests(
  payerName: string | null,
  clients: (typeof businessClients.$inferSelect)[],
): number | null {
  if (!payerName) return null
  const scored = clients
    .map(c => ({
      id: c.id,
      score: Math.max(nameOverlap(payerName, c.name),
                      c.company ? nameOverlap(payerName, c.company) : 0),
    }))
    .filter(x => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)

  if (!scored.length) return null
  if (scored.length === 1 || scored[0].score > scored[1].score + 0.2) return scored[0].id
  return null
}

const daysApart = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000

export function matchCharge(
  charge: FetchedCharge,
  clients: (typeof businessClients.$inferSelect)[],
  /** Every invoice, not only the open ones: a payment for an invoice already
   *  marked paid still needs matching, because that is how the real fee gets
   *  onto history instead of staying at zero. */
  invoices: (typeof businessInvoices.$inferSelect)[],
  /** Invoices Stripe money already covers in full. */
  taken: Set<number> = new Set(),
  /** What each invoice still owes after Stripe money already on it. */
  owed: Map<number, number> = new Map(),
): MatchResult {
  const none: MatchResult = { clientId: null, invoiceId: null, confidence: 'none', reason: 'Nothing to go on' }

  // A void invoice is never something a payment settles.
  const available = invoices.filter(i => !taken.has(i.id) && i.status !== 'void')
  const isOpen = (i: typeof businessInvoices.$inferSelect) => i.status === 'unpaid' || i.status === 'draft'
  const left = (i: typeof businessInvoices.$inferSelect) => owed.get(i.id) ?? i.amount
  const sameAmount = (i: typeof businessInvoices.$inferSelect) => Math.abs(left(i) - charge.gross) < 0.006

  /**
   * Of this client's invoices, the one this payment plainly settled.
   *
   * Ranked by how close the invoice is to the payment date, NOT by whether it
   * is still open. Preferring the open one looked sensible and was wrong: a
   * GBP149 payment in August was matched to September's retainer invoice simply
   * because that was the only unpaid GBP149, giving it a paid date a month
   * before it existed and wrongly clearing the month's outstanding balance.
   *
   * An invoice raised shortly AFTER a payment is fine, because work is often
   * paid for on agreement and invoiced a day or two later. A month later is not.
   */
  const FUTURE_GRACE_DAYS = 10

  const invoiceFor = (clientId: number): { id: number | null; ids?: number[]; why: string; solid: boolean } => {
    const theirs = available.filter(i => i.clientId === clientId)
    if (!theirs.length) return { id: null, why: 'no invoice of theirs left to match', solid: false }

    const issuedTooLate = (i: typeof businessInvoices.$inferSelect) =>
      i.issueDate > charge.paidDate
      && daysApart(i.issueDate, charge.paidDate) > FUTURE_GRACE_DAYS

    const plausible = theirs.filter(i => !issuedTooLate(i))
    const exact = plausible.filter(sameAmount)

    if (exact.length) {
      const best = [...exact].sort((a, b) => {
        const da = daysApart(a.paidDate ?? a.issueDate, charge.paidDate)
        const dbb = daysApart(b.paidDate ?? b.issueDate, charge.paidDate)
        if (Math.abs(da - dbb) > 0.5) return da - dbb
        // Equally close: settle the one still outstanding.
        return (isOpen(a) ? 0 : 1) - (isOpen(b) ? 0 : 1)
      })[0]
      const gap = daysApart(best.paidDate ?? best.issueDate, charge.paidDate)
      if (gap <= 7) {
        return {
          id: best.id,
          why: isOpen(best) ? 'amount matches their open invoice'
                            : 'matches an invoice already marked paid, so the fee lands on it',
          solid: true,
        }
      }
      return { id: best.id, why: `matches an invoice from ${Math.round(gap)} days away`, solid: false }
    }

    // Several sent invoices that add up to it, settled together.
    const sent = plausible.filter(i => i.status === 'unpaid')
      .map(i => ({ id: i.id, issueDate: i.issueDate, remaining: left(i) }))
      .filter(i => i.remaining > 0.005)
    const set = subsetFor(charge.gross, sent)
    if (set) {
      const numbers = set.map(id => theirs.find(i => i.id === id)!.invoiceNumber).join(' + ')
      return { id: set[0], ids: set, why: `together settles ${numbers}`, solid: true }
    }

    const open = plausible.filter(isOpen)
    if (open.length === 1) return { id: open[0].id, why: 'their only open invoice, but the amount differs', solid: false }
    return { id: null, why: 'nothing of theirs matches this amount', solid: false }
  }

  const named = nameSuggests(charge.payerName, clients)

  // 1. Our own id, stamped when the app created the payment link.
  if (charge.ourInvoiceId) {
    const inv = invoices.find(i => i.id === charge.ourInvoiceId)
    // A payment link for an invoice that has since been voided, e.g. from a
    // client who left, is money to look at, not to apply.
    if (inv?.status === 'void') {
      return {
        clientId: inv.clientId, invoiceId: null, confidence: 'low',
        reason: `Paid through the link for ${inv.invoiceNumber}, which is void`,
      }
    }
    return {
      clientId: inv?.clientId ?? null,
      invoiceId: charge.ourInvoiceId,
      confidence: 'exact',
      reason: 'The payment carries this invoice id',
    }
  }

  // 2. A Stripe customer already tied to a client. This is what makes a generic
  //    payer name stop mattering after the first correction.
  if (charge.customerId) {
    const client = clients.find(c => c.stripeCustomerId === charge.customerId)
    if (client) {
      const inv = invoiceFor(client.id)
      return {
        clientId: client.id,
        invoiceId: inv.id,
        invoiceIds: inv.ids,
        confidence: inv.solid ? 'exact' : 'low',
        reason: `Known Stripe customer, ${inv.why}`,
      }
    }
  }

  // 3. Email identifies the client whatever the name says.
  if (charge.payerEmail) {
    const email = charge.payerEmail.trim().toLowerCase()
    const client = clients.find(c => c.email && c.email.trim().toLowerCase() === email)
    if (client) {
      const inv = invoiceFor(client.id)
      return {
        clientId: client.id,
        invoiceId: inv.id,
        invoiceIds: inv.ids,
        confidence: inv.solid ? 'high' : 'low',
        reason: `Email matches ${client.name}, ${inv.why}`,
      }
    }
  }

  // 4. The payer name, when it points at one client on its own.
  if (named != null) {
    const client = clients.find(c => c.id === named)!
    const inv = invoiceFor(client.id)
    return {
      clientId: client.id,
      invoiceId: inv.id,
      invoiceIds: inv.ids,
      // A name plus an exact amount on one of their own invoices is enough.
      // A set of invoices on a name alone is not: names overlap too easily.
      confidence: inv.solid && !inv.ids ? 'high' : 'low',
      reason: `Payer name matches ${client.name}, ${inv.why}`,
    }
  }

  // 5. An exact amount against exactly one invoice anywhere. Weakest, and the
  //    one that went wrong before: three clients each had a GBP149 invoice, so
  //    picking "the only OPEN one" quietly proposed the wrong person. It now
  //    looks at every unmatched invoice, and refuses when the name disagrees.
  const byAmount = available.filter(i =>
    sameAmount(i) && !(i.issueDate > charge.paidDate && daysApart(i.issueDate, charge.paidDate) > 10))
  if (byAmount.length === 1) {
    const inv = byAmount[0]
    const client = clients.find(c => c.id === inv.clientId)
    if (named != null && named !== inv.clientId) {
      return {
        ...none,
        reason: `Amount fits ${client?.name ?? 'an invoice'}, but the payer name says someone else`,
      }
    }
    return {
      clientId: inv.clientId,
      invoiceId: inv.id,
      confidence: 'low',
      reason: `The only unmatched invoice for this amount (${client?.name ?? 'unknown'})`,
    }
  }

  if (byAmount.length > 1) {
    return { ...none, reason: `${byAmount.length} unmatched invoices for this amount` }
  }
  return none
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

/**
 * A subscription charge is Stripe billing the plan's price for the period, so
 * when it settles one invoice it IS what that period cost. The invoice may have
 * been raised before a price change reached the retainer (raised at the old
 * price, collected at the new one), and keeping it books the wrong money. Only
 * for subscriptions, and only on an invoice with no other money on it: a
 * one-off paying less than its invoice may be a part payment, and rewriting the
 * amount there would erase what is still owed.
 */
export function restateForSubscription(tx: Tx, paymentId: number, invoiceIds: number[]): void {
  const p = tx.select().from(stripePayments).where(eq(stripePayments.id, paymentId)).get()
  if (!p?.subscriptionId || invoiceIds.length !== 1) return
  const inv = tx.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceIds[0])).get()
  if (!inv || r2(inv.amount) === r2(p.amountGross)) return
  if (allocationsFor(tx, inv.id).some(a => a.paymentId)) return
  tx.update(businessInvoices).set({ amount: p.amountGross, subtotal: p.amountGross })
    .where(eq(businessInvoices.id, inv.id)).run()
}

/** Invoices Stripe money already covers in full, and what the rest still owe. */
export function stripeCoverage(tx: Tx = db) {
  const invoices = tx.select({ id: businessInvoices.id, amount: businessInvoices.amount }).from(businessInvoices).all()
  const allocs = tx.select().from(businessPaymentAllocations).where(sql`${businessPaymentAllocations.paymentId} is not null`).all()
  const paid = new Map<number, number>()
  for (const a of allocs) paid.set(a.invoiceId, (paid.get(a.invoiceId) ?? 0) + a.amount)
  const owed = new Map<number, number>()
  const taken = new Set<number>()
  for (const i of invoices) {
    const left = r2(Math.max(i.amount - (paid.get(i.id) ?? 0), 0))
    owed.set(i.id, left)
    if (left <= 0.005 && paid.has(i.id)) taken.add(i.id)
  }
  return { owed, taken }
}

export async function syncStripePayments(lookbackDays = 45): Promise<StripeSyncResult> {
  if (!stripeConfigured()) {
    return { ok: false, fetched: 0, created: 0, autoApplied: 0, queued: 0, message: 'No Stripe key set' }
  }

  const since = Math.floor(Date.now() / 1000) - lookbackDays * 86400
  const failed: FailedCharge[] = []
  const charges = await fetchCharges(since, failed)

  const clients = await db.select().from(businessClients)

  // Declined card payments, kept apart from money: nothing arrived. Each is
  // tied to the client whose Stripe customer it is, for "Chase".
  for (const f of failed) {
    const clientId = clients.find(c => c.stripeCustomerId && c.stripeCustomerId === f.customerId)?.id ?? null
    await db.insert(stripeFailedCharges).values({
      stripeId: f.stripeId, stripeCustomerId: f.customerId, subscriptionId: f.subscriptionId,
      amount: f.amount, currency: f.currency, failedDate: f.failedDate,
      payerName: f.payerName, payerEmail: f.payerEmail, failureMessage: f.failureMessage, clientId,
    }).onConflictDoUpdate({ target: stripeFailedCharges.stripeId, set: { clientId } })
  }
  const now = new Date().toISOString()

  let created = 0
  let autoApplied = 0
  let queued = 0

  for (const c of charges) {
    const allInvoices = await db.select().from(businessInvoices)
    // Rebuilt per charge, from what money is actually on each invoice, so two
    // payments can never claim the same invoice and a part-paid one stays open.
    const { owed, taken } = stripeCoverage()

    const [existing] = await db.select().from(stripePayments)
      .where(eq(stripePayments.stripeId, c.stripeId))

    // An already-decided payment is left alone: a re-sync must never undo a
    // correction that was made by hand.
    //
    // Guarded on `matchedAt`, not on the invoice id. Assigning a payment to a
    // client who has no invoice is a complete decision that sets no invoice id,
    // and testing the invoice id let the next sync overwrite it wholesale:
    // client, confidence and reason all reverted, and the payment reappeared in
    // the queue as though the user had never touched it. Only the money fields
    // are refreshed below, because Stripe can still restate a fee or a refund.
    if (existing?.matchedAt || existing?.ignored) {
      await db.update(stripePayments)
        .set({
          fee: c.fee, amountNet: c.net, refunded: c.refunded, syncedAt: now, disputed: c.disputed ? 1 : 0,
          // Safe to refresh on a decided payment: these describe what Stripe
          // did, not what the user chose, so they can never undo a decision.
          subscriptionId:   c.plan?.subscriptionId ?? existing.subscriptionId,
          billingReason:    c.plan?.billingReason ?? existing.billingReason,
          planAmount:       c.plan?.amount ?? existing.planAmount,
          planIntervalDays: c.plan?.intervalDays ?? existing.planIntervalDays,
          planDescription:  c.plan?.description ?? existing.planDescription,
        })
        .where(eq(stripePayments.id, existing.id))
      continue
    }

    const m = matchCharge(c, clients, allInvoices, taken, owed)
    // A payment moved by hand is only ever suggested again, never re-applied:
    // otherwise the next sync would undo the move.
    const auto = (m.confidence === 'exact' || m.confidence === 'high') && !existing?.releasedAt

    const values = {
      stripeId: c.stripeId,
      paymentIntentId: c.paymentIntentId,
      stripeCustomerId: c.customerId,
      stripeInvoiceId: c.invoiceId,
      amountGross: c.gross,
      fee: c.fee,
      amountNet: c.net,
      refunded: c.refunded,
      currency: c.currency,
      paidDate: c.paidDate,
      payerName: c.payerName,
      payerEmail: c.payerEmail,
      description: c.description,
      status: c.status,
      disputed: c.disputed ? 1 : 0,
      // A suggestion only. applyPayment writes the decision if it is applied.
      matchedClientId: m.clientId,
      matchedInvoiceId: null,
      confidence: m.confidence,
      matchReason: m.reason,
      matchedAt: null,
      subscriptionId:   c.plan?.subscriptionId ?? null,
      billingReason:    c.plan?.billingReason ?? null,
      planAmount:       c.plan?.amount ?? null,
      planIntervalDays: c.plan?.intervalDays ?? null,
      planDescription:  c.plan?.description ?? null,
      syncedAt: now,
    }

    const [row] = existing
      ? await db.update(stripePayments).set(values).where(eq(stripePayments.id, existing.id)).returning()
      : await db.insert(stripePayments).values(values).returning()

    if (!existing) created++

    let applied = false
    if (auto && m.invoiceId) {
      const ids = m.invoiceIds ?? [m.invoiceId]
      try {
        db.transaction(tx => {
          restateForSubscription(tx, row.id, ids)
          applyPayment(tx, row.id, defaultSplits(tx, c.gross, ids), {
            reason: m.reason, confidence: m.confidence, clientId: m.clientId,
          })
          // Remember the customer, so this client is never ambiguous again.
          if (m.clientId && c.customerId) learnCustomerTx(tx, m.clientId, c.customerId)
        })
        applied = true
      } catch (e: any) {
        // Anything the allocation rules refuse is left for a person to decide.
        console.warn(`[stripe] left ${c.stripeId} in the queue: ${e?.message ?? e}`)
      }
    }
    if (applied) autoApplied++
    else queued++
  }

  // A card link left open on a bill now paid (by bank, or written off) could
  // take the money a second time. Switch those off.
  const linked = await db.select().from(businessInvoices).where(isNotNull(businessInvoices.paymentLinkId))
  for (const inv of linked) {
    if (inv.status !== 'paid' && inv.status !== 'void') continue
    await deactivatePaymentLink(inv.paymentLinkId!)
    await db.update(businessInvoices).set({ paymentLinkId: null, paymentLinkUrl: null }).where(eq(businessInvoices.id, inv.id))
  }

  const parts = [`${charges.length} payment(s) read`, `${autoApplied} applied`, `${queued} to assign`]
  return {
    ok: true,
    fetched: charges.length,
    created,
    autoApplied,
    queued,
    message: parts.join(', '),
  }
}

/** Tie a Stripe customer to a client, so future payments are certain. */
export async function learnCustomer(clientId: number, stripeCustomerId: string): Promise<void> {
  learnCustomerTx(db, clientId, stripeCustomerId)
}

/** Payments still waiting on a decision, newest first. */
/**
 * Payments still waiting on a decision from the user.
 *
 * Keyed on `matchedAt`, which is set only when a match is actually applied or
 * confirmed by hand, never by a mere suggestion. Keying it on the invoice id
 * instead was wrong in a way that looked like a broken button: assigning a
 * payment to a client who has no invoice saved perfectly and then reappeared
 * in the queue on the next render, with nothing the user could do to clear it.
 * A payment can legitimately belong to a client and to no invoice, and that is
 * a finished decision, not an unfinished one.
 */
export async function unassignedPayments() {
  return db.select().from(stripePayments)
    .where(and(isNull(stripePayments.matchedAt), eq(stripePayments.ignored, 0)))
    .orderBy(sql`${stripePayments.paidDate} desc`)
}

// ─── Daily schedule ───────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null

export function startStripeSchedule(): void {
  if (timer || !stripeConfigured()) return

  const run = async () => {
    try {
      const r = await syncStripePayments()
      console.log(`[stripe] ${r.ok ? r.message : 'FAILED ' + r.message}`)
    } catch (e: any) {
      console.error('[stripe] sync failed:', e?.message ?? e)
    }
  }

  setTimeout(run, 15_000)
  timer = setInterval(run, 6 * 60 * 60 * 1000)
  console.log(`[stripe] sync enabled. ${stripeStatusNote()}`)
}

export { localToday }
