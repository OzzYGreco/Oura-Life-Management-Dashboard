/**
 * Money received, and the one place that decides whether an invoice is paid.
 *
 * An allocation is one sum of money applied to one invoice: a Stripe payment, a
 * bank transfer, cash. An invoice's `status`, `paidDate`, `feeAmount`,
 * `refundedAmount` and `paymentMethod` are a SUMMARY of its allocations, and
 * `recomputeInvoice` is the only thing that writes them. Before this, every
 * route set those fields by hand, which is how a payment could be undone on the
 * invoice and still sit attached to it, or a short payment be booked as a fee.
 *
 * Every function here is synchronous and takes the transaction it runs in.
 * better-sqlite3 transactions cannot await, and anything that touches money
 * has to happen all at once or not at all.
 */
import { db } from '../db'
import {
  businessInvoices, businessPaymentAllocations, stripePayments, businessRetainers,
  businessRetainerChanges, businessClients,
} from '../db/schema'
import { eq, and, inArray, ne, isNull } from 'drizzle-orm'

export type Tx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

type Invoice    = typeof businessInvoices.$inferSelect
type Allocation = typeof businessPaymentAllocations.$inferSelect

export const round2 = (n: number) => Math.round(n * 100) / 100
const PENNY = 0.005

/** A 4xx the routes can pass straight to the client. */
export function refuse(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

// ─── Reading ──────────────────────────────────────────────────────────────────

export function allocationsFor(tx: Tx, invoiceId: number): Allocation[] {
  return tx.select().from(businessPaymentAllocations)
    .where(eq(businessPaymentAllocations.invoiceId, invoiceId)).all()
}

export function allocationsOfPayment(tx: Tx, paymentId: number): Allocation[] {
  return tx.select().from(businessPaymentAllocations)
    .where(eq(businessPaymentAllocations.paymentId, paymentId)).all()
}

function invoiceById(tx: Tx, id: number): Invoice {
  const row = tx.select().from(businessInvoices).where(eq(businessInvoices.id, id)).get()
  if (!row) refuse(404, `No such invoice (${id})`)
  return row
}

/** What is still owed on an invoice after everything applied to it. */
export function remainingOn(tx: Tx, invoice: Invoice): number {
  const paid = allocationsFor(tx, invoice.id).reduce((s, a) => s + a.amount, 0)
  return round2(Math.max(invoice.amount - paid, 0))
}

// ─── The one writer of paid state ────────────────────────────────────────────

/**
 * Make an invoice's paid fields agree with its allocations.
 *
 * Fully covered: paid, on the date of the last money in. Partly covered: still
 * unpaid (a draft that has taken money has evidently been sent), with the fees
 * so far on it. Nothing applied: open, with no paid date and no fee.
 */
export function recomputeInvoice(tx: Tx, invoiceId: number): void {
  const inv = invoiceById(tx, invoiceId)
  if (inv.status === 'void') return

  const allocs = allocationsFor(tx, invoiceId).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const applied = round2(allocs.reduce((s, a) => s + a.amount, 0))
  const fee = round2(allocs.reduce((s, a) => s + a.fee, 0))
  const refunded = round2(allocs.reduce((s, a) => s + a.refunded, 0))
  const last = allocs.at(-1)

  const full = allocs.length > 0 && applied >= inv.amount - PENNY
  const status = full ? 'paid'
    : allocs.length ? 'unpaid'
    : inv.status === 'paid' ? 'unpaid' : inv.status

  tx.update(businessInvoices).set({
    status,
    paidDate: full ? last!.date : null,
    feeAmount: fee,
    refundedAmount: refunded,
    paymentMethod: last?.method ?? null,
  }).where(eq(businessInvoices.id, invoiceId)).run()
}

/**
 * Money that is not from Stripe: a transfer, cash, or "it is paid" ticked by
 * hand. Less than what is owed leaves the invoice part-paid, which is the whole
 * point: the shortfall is still owed, not a fee.
 */
export function recordManualPayment(tx: Tx, invoiceId: number, p: {
  amount?: number; date: string; fee?: number; method?: 'bank' | 'cash' | 'stripe'; note?: string | null
}): Allocation {
  const inv = invoiceById(tx, invoiceId)
  if (inv.status === 'void') refuse(409, `${inv.invoiceNumber} is void. Restore it before recording a payment.`)
  const remaining = remainingOn(tx, inv)
  const amount = round2(p.amount ?? remaining)
  if (amount <= 0) refuse(409, `${inv.invoiceNumber} has nothing left to pay`)
  if (amount > remaining + PENNY) {
    refuse(409, `${inv.invoiceNumber} only has ${remaining.toFixed(2)} left to pay. Edit the invoice amount first if they paid more.`)
  }
  const row = tx.insert(businessPaymentAllocations).values({
    invoiceId, paymentId: null, method: p.method ?? 'bank',
    amount, fee: round2(p.fee ?? 0), refunded: 0, date: p.date, note: p.note ?? null,
  }).returning().get()
  // Sending is implied by being paid.
  if (inv.status === 'draft') {
    tx.update(businessInvoices).set({ status: 'unpaid' }).where(eq(businessInvoices.id, invoiceId)).run()
  }
  recomputeInvoice(tx, invoiceId)
  return row
}

/** Remove one sum of money. A Stripe one takes its whole payment with it. */
export function removeAllocation(tx: Tx, allocationId: number): void {
  const a = tx.select().from(businessPaymentAllocations)
    .where(eq(businessPaymentAllocations.id, allocationId)).get()
  if (!a) refuse(404, 'No such payment record')
  if (a.paymentId) { releasePayment(tx, a.paymentId); return }
  tx.delete(businessPaymentAllocations).where(eq(businessPaymentAllocations.id, allocationId)).run()
  recomputeInvoice(tx, a.invoiceId)
}

/**
 * Undo every payment on an invoice. Stripe payments are released whole, so they
 * return to the queue rather than sit half-attached, and anything else they
 * settled goes back to open too. Callers show that list before calling this.
 */
export function unpayInvoice(tx: Tx, invoiceId: number): void {
  const allocs = allocationsFor(tx, invoiceId)
  const payments = new Set(allocs.filter(a => a.paymentId).map(a => a.paymentId!))
  for (const pid of payments) releasePayment(tx, pid)
  tx.delete(businessPaymentAllocations)
    .where(and(eq(businessPaymentAllocations.invoiceId, invoiceId), isNull(businessPaymentAllocations.paymentId))).run()
  recomputeInvoice(tx, invoiceId)
}

/** Everything an unpay or void of these invoices would also touch, for the confirm text. */
export function knockOn(tx: Tx, invoiceIds: number[]) {
  const allocs = invoiceIds.length
    ? tx.select().from(businessPaymentAllocations).where(inArray(businessPaymentAllocations.invoiceId, invoiceIds)).all()
    : []
  const paymentIds = [...new Set(allocs.filter(a => a.paymentId).map(a => a.paymentId!))]
  const others = paymentIds.length
    ? tx.select().from(businessPaymentAllocations).where(inArray(businessPaymentAllocations.paymentId, paymentIds)).all()
        .map(a => a.invoiceId).filter(id => !invoiceIds.includes(id))
    : []
  const numbers = others.length
    ? tx.select({ id: businessInvoices.id, n: businessInvoices.invoiceNumber }).from(businessInvoices)
        .where(inArray(businessInvoices.id, [...new Set(others)])).all().map(r => r.n)
    : []
  return { stripePayments: paymentIds.length, alsoReopens: numbers }
}

// ─── Void ────────────────────────────────────────────────────────────────────

/**
 * Cancel an invoice without losing it. The number stays used, the row stays in
 * the ledger, and it stops counting anywhere. Money on it is released first.
 */
export function voidInvoice(tx: Tx, invoiceId: number, reason: string | null, today: string): void {
  const inv = invoiceById(tx, invoiceId)
  if (inv.status === 'void') return
  unpayInvoice(tx, invoiceId)
  const fresh = invoiceById(tx, invoiceId)
  tx.update(businessInvoices).set({
    status: 'void', voidedAt: today, voidReason: reason, voidedFrom: fresh.status,
    paidDate: null, feeAmount: 0, refundedAmount: 0,
  }).where(eq(businessInvoices.id, invoiceId)).run()
}

export function restoreInvoice(tx: Tx, invoiceId: number): void {
  const inv = invoiceById(tx, invoiceId)
  if (inv.status !== 'void') return
  if (inv.raisedFromPaymentId) {
    const elsewhere = allocationsOfPayment(tx, inv.raisedFromPaymentId).length > 0
    if (elsewhere) refuse(409, `${inv.invoiceNumber} was raised from a payment that now settles other invoices, so there is nothing for it to restore to.`)
  }
  // Paid is not restorable on its own: the money was released when it was voided.
  const back = inv.voidedFrom && inv.voidedFrom !== 'paid' ? inv.voidedFrom : 'unpaid'
  tx.update(businessInvoices).set({ status: back, voidedAt: null, voidReason: null, voidedFrom: null })
    .where(eq(businessInvoices.id, invoiceId)).run()
}

// ─── Stripe payments ──────────────────────────────────────────────────────────

/**
 * Detach a Stripe payment from everything it settled and put it back in the
 * queue to be assigned again.
 *
 * `keep` lists invoices the caller is about to re-apply this same payment to, so
 * an invoice raised from the payment and picked again is not voided on the way.
 *
 * An invoice that existed only because this payment had nothing to settle is
 * voided, since it has no reason to exist once the money is elsewhere. One
 * that also created a retainer takes the retainer with it, unless that retainer
 * has billed since, in which case the invoice is a genuine period bill and goes
 * back to open.
 */
export function releasePayment(tx: Tx, paymentId: number, keep: number[] = [], today = new Date().toISOString().slice(0, 10)): void {
  const allocs = allocationsOfPayment(tx, paymentId)
  tx.delete(businessPaymentAllocations).where(eq(businessPaymentAllocations.paymentId, paymentId)).run()

  const touched = [...new Set(allocs.map(a => a.invoiceId))]
  const raised = tx.select().from(businessInvoices).where(eq(businessInvoices.raisedFromPaymentId, paymentId)).all()

  for (const id of touched) recomputeInvoice(tx, id)

  for (const inv of raised) {
    if (keep.includes(inv.id) || inv.status === 'void') continue
    if (allocationsFor(tx, inv.id).length) continue   // other money on it: it is real now

    if (inv.retainerId) {
      const siblings = tx.select({ id: businessInvoices.id }).from(businessInvoices)
        .where(and(eq(businessInvoices.retainerId, inv.retainerId), ne(businessInvoices.id, inv.id), ne(businessInvoices.status, 'void'))).all()
      if (!siblings.length) {
        // The retainer was set up from this payment and has never billed on
        // its own: both go, so MRR does not keep a subscription nobody pays.
        tx.delete(businessInvoices).where(eq(businessInvoices.id, inv.id)).run()
        tx.delete(businessRetainerChanges).where(eq(businessRetainerChanges.retainerId, inv.retainerId)).run()
        tx.delete(businessRetainers).where(eq(businessRetainers.id, inv.retainerId)).run()
        continue
      }
      tx.update(businessInvoices).set({ raisedFromPaymentId: null }).where(eq(businessInvoices.id, inv.id)).run()
      continue
    }
    tx.update(businessInvoices).set({
      status: 'void', voidedAt: today, voidReason: 'Its payment was moved to another invoice', voidedFrom: 'unpaid',
      paidDate: null, feeAmount: 0, refundedAmount: 0,
    }).where(eq(businessInvoices.id, inv.id)).run()
  }

  tx.update(stripePayments).set({
    matchedInvoiceId: null, matchedClientId: null, coversInvoiceIds: null,
    matchedAt: null, confidence: 'none', matchReason: 'Moved by hand',
    releasedAt: new Date().toISOString(),
  }).where(eq(stripePayments.id, paymentId)).run()
}

export interface Split { invoiceId: number; amount: number }

/**
 * Apply a Stripe payment to one or more invoices, for the amounts given.
 *
 * The fee and any refund split in proportion to the amounts, the last share
 * absorbing the rounding so the parts sum to exactly what Stripe charged. Less
 * than an invoice's remainder leaves it part-paid.
 *
 * A hand-ticked "paid" with no money behind it is a stand-in for this very
 * payment, so it gives way rather than blocking it: that is how the real fee
 * lands on an invoice that was marked paid before Stripe was synced.
 */
export function applyPayment(tx: Tx, paymentId: number, splits: Split[], opts: {
  reason: string; confidence?: string; clientId?: number | null
}): void {
  const p = tx.select().from(stripePayments).where(eq(stripePayments.id, paymentId)).get()
  if (!p) refuse(404, 'No such payment')
  if (allocationsOfPayment(tx, paymentId).length) refuse(409, 'Release this payment before applying it again')

  const clean = splits.filter(s => s.amount > 0)
  const total = round2(clean.reduce((s, x) => s + x.amount, 0))
  if (total > p.amountGross + PENNY) {
    refuse(409, `That is ${total.toFixed(2)} across the invoices, more than the ${p.amountGross.toFixed(2)} this payment was`)
  }

  for (const s of clean) {
    const inv = invoiceById(tx, s.invoiceId)
    if (inv.status === 'void') refuse(409, `${inv.invoiceNumber} is void`)
    let remaining = remainingOn(tx, inv)
    if (s.amount > remaining + PENNY) {
      // Hand-recorded "paid" with no money behind it gives way to the real payment.
      const manual = allocationsFor(tx, inv.id).filter(a => !a.paymentId)
      if (manual.length) {
        tx.delete(businessPaymentAllocations).where(inArray(businessPaymentAllocations.id, manual.map(a => a.id))).run()
        remaining = remainingOn(tx, inv)
      }
    }
    if (s.amount > remaining + PENNY) {
      refuse(409, `${inv.invoiceNumber} only has ${remaining.toFixed(2)} left to pay`)
    }
  }

  let feeLeft = p.fee
  let refundLeft = p.refunded
  clean.forEach((s, idx) => {
    const isLast = idx === clean.length - 1
    const share = total > 0 ? s.amount / total : 1 / clean.length
    const fee = isLast ? round2(feeLeft) : round2(p.fee * share)
    const refunded = isLast ? round2(refundLeft) : round2(p.refunded * share)
    feeLeft = round2(feeLeft - fee)
    refundLeft = round2(refundLeft - refunded)
    tx.insert(businessPaymentAllocations).values({
      invoiceId: s.invoiceId, paymentId, method: 'stripe',
      amount: round2(s.amount), fee, refunded, date: p.paidDate,
    }).run()
    const inv = invoiceById(tx, s.invoiceId)
    if (inv.status === 'draft') tx.update(businessInvoices).set({ status: 'unpaid' }).where(eq(businessInvoices.id, inv.id)).run()
    recomputeInvoice(tx, s.invoiceId)
  })

  const first = clean[0]
  const clientId = opts.clientId ?? (first ? invoiceById(tx, first.invoiceId).clientId : p.matchedClientId)
  tx.update(stripePayments).set({
    matchedClientId: clientId ?? null,
    matchedInvoiceId: first?.invoiceId ?? null,
    coversInvoiceIds: clean.length > 1 ? JSON.stringify(clean.map(s => s.invoiceId)) : null,
    confidence: opts.confidence ?? 'exact',
    matchReason: opts.reason,
    matchedAt: new Date().toISOString(),
  }).where(eq(stripePayments.id, paymentId)).run()
}

/**
 * Default split for a payment across chosen invoices: oldest first, each up to
 * what it still owes, until the money runs out.
 */
export function defaultSplits(tx: Tx, gross: number, invoiceIds: number[]): Split[] {
  const invoices = invoiceIds.map(id => invoiceById(tx, id))
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.id - b.id)
  let left = gross
  return invoices.map(inv => {
    // Money from a hand tick is replaceable, so it does not reduce what this payment may cover.
    const stripePaid = allocationsFor(tx, inv.id).filter(a => a.paymentId).reduce((s, a) => s + a.amount, 0)
    const owed = round2(Math.max(inv.amount - stripePaid, 0))
    const amount = round2(Math.min(owed, left))
    left = round2(left - amount)
    return { invoiceId: inv.id, amount }
  })
}

/**
 * Tie a Stripe customer to a client, and only that client. A customer left on
 * two clients makes every later payment from them match whichever comes first.
 */
export function learnCustomerTx(tx: Tx, clientId: number, stripeCustomerId: string): void {
  tx.update(businessClients).set({ stripeCustomerId: null })
    .where(and(eq(businessClients.stripeCustomerId, stripeCustomerId), ne(businessClients.id, clientId))).run()
  tx.update(businessClients).set({ stripeCustomerId }).where(eq(businessClients.id, clientId)).run()
}
