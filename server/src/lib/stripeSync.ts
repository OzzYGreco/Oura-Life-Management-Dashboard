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
import { stripePayments, businessInvoices, businessClients } from '../db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { localToday } from './date'

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

export async function fetchCharges(sinceUnix: number): Promise<FetchedCharge[]> {
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
  confidence: Confidence
  reason: string
}

/** Strip everything that varies between how a name is typed and how it is stored. */
function normalise(s: string): string {
  return s.toLowerCase()
    .replace(/\b(ltd|limited|llp|plc|inc|co|company|services?|solutions?)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Share of the shorter name's words that appear in the longer one. */
function nameOverlap(a: string, b: string): number {
  const A = new Set(normalise(a).split(' ').filter(w => w.length > 2))
  const B = new Set(normalise(b).split(' ').filter(w => w.length > 2))
  if (!A.size || !B.size) return 0
  let hits = 0
  for (const w of A) if (B.has(w)) hits++
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
  /** Invoices a payment is already attached to. One payment, one invoice. */
  taken: Set<number> = new Set(),
): MatchResult {
  const none: MatchResult = { clientId: null, invoiceId: null, confidence: 'none', reason: 'Nothing to go on' }

  const available = invoices.filter(i => !taken.has(i.id))
  const isOpen = (i: typeof businessInvoices.$inferSelect) => i.status === 'unpaid' || i.status === 'draft'
  const sameAmount = (i: typeof businessInvoices.$inferSelect) => Math.abs(i.amount - charge.gross) < 0.01

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

  const invoiceFor = (clientId: number): { id: number | null; why: string; solid: boolean } => {
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

    const open = plausible.filter(isOpen)
    if (open.length === 1) return { id: open[0].id, why: 'their only open invoice, but the amount differs', solid: false }
    return { id: null, why: 'nothing of theirs matches this amount', solid: false }
  }

  const named = nameSuggests(charge.payerName, clients)

  // 1. Our own id, stamped when the app created the payment link.
  if (charge.ourInvoiceId) {
    const inv = invoices.find(i => i.id === charge.ourInvoiceId)
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
      // A name plus an exact amount on one of their own invoices is enough.
      confidence: inv.solid ? 'high' : 'low',
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
 * Write the fee and the paid date onto the invoice or invoices this payment
 * settled.
 *
 * Where one payment covered several, the fee is split in proportion to their
 * amounts, with the last one absorbing the rounding so the parts always sum to
 * exactly what Stripe charged.
 */
export async function applyPaymentToInvoice(paymentId: number): Promise<void> {
  const [p] = await db.select().from(stripePayments).where(eq(stripePayments.id, paymentId))
  if (!p) return

  const ids: number[] = p.coversInvoiceIds
    ? JSON.parse(p.coversInvoiceIds)
    : p.matchedInvoiceId ? [p.matchedInvoiceId] : []
  if (!ids.length) return

  const invoices = (await db.select().from(businessInvoices))
    .filter(i => ids.includes(i.id))
  if (!invoices.length) return

  const total = invoices.reduce((s2, i) => s2 + i.amount, 0)
  let allocatedFee = 0
  let allocatedRefund = 0

  for (let idx = 0; idx < invoices.length; idx++) {
    const inv = invoices[idx]
    const isLast = idx === invoices.length - 1
    const share = total > 0 ? inv.amount / total : 1 / invoices.length
    // The last share absorbs the rounding, so the parts sum to the fee exactly.
    const fee = isLast ? round2(p.fee - allocatedFee) : round2(p.fee * share)
    const refund = isLast ? round2(p.refunded - allocatedRefund) : round2(p.refunded * share)
    allocatedFee = round2(allocatedFee + fee)
    allocatedRefund = round2(allocatedRefund + refund)

    await db.update(businessInvoices)
      .set({
        status: 'paid', paidDate: p.paidDate,
        feeAmount: fee, refundedAmount: refund,
        paymentMethod: 'stripe',
      })
      .where(eq(businessInvoices.id, inv.id))
  }
}

export async function syncStripePayments(lookbackDays = 45): Promise<StripeSyncResult> {
  if (!stripeConfigured()) {
    return { ok: false, fetched: 0, created: 0, autoApplied: 0, queued: 0, message: 'No Stripe key set' }
  }

  const since = Math.floor(Date.now() / 1000) - lookbackDays * 86400
  const charges = await fetchCharges(since)

  const clients = await db.select().from(businessClients)
  const now = new Date().toISOString()

  let created = 0
  let autoApplied = 0
  let queued = 0

  // Invoices a payment already points at. Rebuilt per charge below as matches
  // are made, so two payments can never claim the same invoice.
  const takenRows = await db.select({ id: stripePayments.matchedInvoiceId })
    .from(stripePayments).where(sql`${stripePayments.matchedInvoiceId} is not null`)
  const taken = new Set<number>(takenRows.map(r => r.id!).filter(Boolean))

  for (const c of charges) {
    const allInvoices = await db.select().from(businessInvoices)

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
    if (existing?.matchedInvoiceId) taken.add(existing.matchedInvoiceId)
    if (existing?.matchedAt || existing?.ignored) {
      await db.update(stripePayments)
        .set({
          fee: c.fee, amountNet: c.net, refunded: c.refunded, syncedAt: now,
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

    const m = matchCharge(c, clients, allInvoices, taken)
    const auto = m.confidence === 'exact' || m.confidence === 'high'

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
      matchedClientId: auto ? m.clientId : null,
      matchedInvoiceId: auto && m.invoiceId ? m.invoiceId : null,
      confidence: m.confidence,
      matchReason: m.reason,
      matchedAt: auto && m.invoiceId ? now : null,
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

    if (auto && m.invoiceId) {
      taken.add(m.invoiceId)
      await applyPaymentToInvoice(row.id)
      // Remember the customer, so this client is never ambiguous again.
      if (m.clientId && c.customerId) await learnCustomer(m.clientId, c.customerId)
      autoApplied++
    } else {
      queued++
    }
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
  const [client] = await db.select().from(businessClients).where(eq(businessClients.id, clientId))
  if (!client || client.stripeCustomerId === stripeCustomerId) return
  await db.update(businessClients)
    .set({ stripeCustomerId })
    .where(eq(businessClients.id, clientId))
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
