/**
 * Things that happen on a date rather than on a click, and money that moves
 * between invoices after it has landed.
 *
 * Dated events: a retainer that ends on a set day (notice given, a fixed-term
 * contract), a pause with a date it restarts, a client who has given notice.
 * Each is stored as a date and settled by `settleDatedEvents` the first time
 * anything reads the books on or after that day, so nobody has to remember to
 * come back and press a button.
 *
 * Money moves: paying months ahead, a credit left over after an invoice was
 * lowered, a bank payment recorded against the wrong client.
 */
import {
  businessRetainers, businessClients, businessInvoices, businessPaymentAllocations,
} from '../db/schema'
import { eq, and, lte, isNotNull, inArray } from 'drizzle-orm'
import { advance, addDays } from './recurrence'
import {
  allocationsFor, allocationsOfPayment, applyPayment, recomputeInvoice, releasePayment,
  remainingOn, refuse, round2, type Tx, type Split,
} from './payments'

type Retainer = typeof businessRetainers.$inferSelect

// ─── Dated events ────────────────────────────────────────────────────────────

/**
 * Apply every dated event that has come due. Safe to call on every read.
 *
 * Order matters: a pause that ends today restarts billing from its date, and a
 * retainer whose last day has passed is closed with that day as its cancel
 * date, so MRR history reads it as live right up to the end.
 */
export function settleDatedEvents(tx: Tx, today: string): void {
  const now = new Date().toISOString()

  // Pauses with a restart date.
  const resuming = tx.select().from(businessRetainers).where(and(
    eq(businessRetainers.status, 'paused'), isNotNull(businessRetainers.resumeOn),
    lte(businessRetainers.resumeOn, today))).all()
  for (const r of resuming) {
    tx.update(businessRetainers).set({
      status: 'active', pausedAt: null, resumeOn: null,
      lastGeneratedDate: r.resumeOn, nextInvoiceDate: r.resumeOn, updatedAt: now,
    }).where(eq(businessRetainers.id, r.id)).run()
  }

  // Retainers whose last day has come.
  const ending = tx.select().from(businessRetainers).where(and(
    eq(businessRetainers.status, 'active'), isNotNull(businessRetainers.endDate),
    lte(businessRetainers.endDate, today))).all()
  for (const r of ending) {
    tx.update(businessRetainers).set({
      status: 'cancelled', cancelledAt: r.endDate, autoInvoice: 0, updatedAt: now,
    }).where(eq(businessRetainers.id, r.id)).run()
  }

  // Clients whose notice has run out.
  const leaving = tx.select().from(businessClients).where(and(
    isNotNull(businessClients.leavingOn), lte(businessClients.leavingOn, today))).all()
  for (const c of leaving) {
    tx.update(businessClients).set({
      status: c.status === 'active' ? 'churned' : c.status,
      churnedAt: c.status === 'active' ? c.leavingOn : c.churnedAt,
      leavingOn: null,
    }).where(eq(businessClients.id, c.id)).run()
  }
}

/** The invoices a retainer will still issue from its next date up to (not on) its last day. */
export function invoicesBefore(r: Retainer, endDate: string): { periodStart: string; amount: number }[] {
  const out: { periodStart: string; amount: number }[] = []
  let cursor = r.nextInvoiceDate ?? advance(r.lastGeneratedDate ?? r.startDate, r.frequency)
  while (cursor < endDate && out.length < 60) {
    out.push({ periodStart: cursor, amount: r.amount })
    cursor = advance(cursor, r.frequency)
  }
  return out
}

// ─── Paying ahead ────────────────────────────────────────────────────────────

/**
 * The periods money paid in advance would cover, in billing order across the
 * client's live retainers, stopping at any retainer's last day. The last one may
 * be part-covered.
 */
export function planAhead(retainers: Retainer[], amount: number, max = 12) {
  const cursors = retainers
    .filter(r => r.status === 'active')
    .map(r => ({ r, at: r.nextInvoiceDate ?? advance(r.lastGeneratedDate ?? r.startDate, r.frequency) }))
  const out: { retainerId: number; name: string; periodStart: string; amount: number; pays: number }[] = []
  let left = round2(amount)
  while (left > 0.005 && out.length < max) {
    const live = cursors.filter(c => !c.r.endDate || c.at < c.r.endDate)
    if (!live.length) break
    const next = live.sort((a, b) => a.at.localeCompare(b.at))[0]
    const pays = round2(Math.min(next.r.amount, left))
    out.push({ retainerId: next.r.id, name: next.r.name, periodStart: next.at, amount: next.r.amount, pays })
    left = round2(left - pays)
    next.at = advance(next.at, next.r.frequency)
  }
  return { periods: out, left }
}

/**
 * Issue a retainer's next period now, ahead of its date, so money paid in
 * advance has a bill to sit on. The billing schedule moves past it, so the
 * generator will not bill that month again.
 */
export function issueAhead(tx: Tx, retainerId: number, periodStart: string, invoiceNumber: string, today: string) {
  const r = tx.select().from(businessRetainers).where(eq(businessRetainers.id, retainerId)).get()
  if (!r) refuse(404, 'No such retainer')
  const inv = tx.insert(businessInvoices).values({
    clientId: r.clientId, invoiceNumber, amount: r.amount, subtotal: r.amount,
    status: 'unpaid', issueDate: periodStart, dueDate: addDays(periodStart, r.netTermDays ?? 0),
    notes: r.name, retainerId: r.id, serviceId: r.serviceId, currency: r.currency,
    periodStart, periodEnd: advance(periodStart, r.frequency), sentDate: today,
  }).returning().get()
  const after = advance(periodStart, r.frequency)
  if (!r.nextInvoiceDate || after > r.nextInvoiceDate) {
    tx.update(businessRetainers).set({ lastGeneratedDate: periodStart, nextInvoiceDate: after, updatedAt: new Date().toISOString() })
      .where(eq(businessRetainers.id, r.id)).run()
  }
  return inv
}

// ─── Moving money ────────────────────────────────────────────────────────────

/**
 * Take `amount` of the money on one invoice and put it on others, in order,
 * each up to what it still owes. Latest money moves first.
 *
 * Bank and cash money is split in place. A Stripe payment is re-applied whole
 * with its new split, so its fee follows the money and it never sits half on
 * one invoice and half nowhere.
 */
export function moveMoney(tx: Tx, fromInvoiceId: number, amount: number, targets: number[]): void {
  let left = round2(amount)
  const allocs = allocationsFor(tx, fromInvoiceId).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  const room = new Map(targets.map(id => {
    const inv = tx.select().from(businessInvoices).where(eq(businessInvoices.id, id)).get()!
    return [id, remainingOn(tx, inv)]
  }))
  const take = (most: number) => {
    const out: Split[] = []
    let want = round2(Math.min(most, left))
    for (const id of targets) {
      if (want <= 0.005) break
      const r = room.get(id) ?? 0
      const amt = round2(Math.min(r, want))
      if (amt <= 0.005) continue
      out.push({ invoiceId: id, amount: amt })
      room.set(id, round2(r - amt))
      want = round2(want - amt)
    }
    return out
  }

  for (const a of allocs) {
    if (left <= 0.005) break
    const moves = take(a.amount)
    const moved = round2(moves.reduce((s, m) => s + m.amount, 0))
    if (moved <= 0.005) break

    if (!a.paymentId) {
      const keep = round2(a.amount - moved)
      if (keep > 0.005) {
        tx.update(businessPaymentAllocations).set({ amount: keep, refunded: Math.min(a.refunded, keep) })
          .where(eq(businessPaymentAllocations.id, a.id)).run()
      } else {
        tx.delete(businessPaymentAllocations).where(eq(businessPaymentAllocations.id, a.id)).run()
      }
      for (const m of moves) {
        tx.insert(businessPaymentAllocations).values({
          invoiceId: m.invoiceId, paymentId: null, method: a.method, amount: m.amount,
          fee: 0, refunded: 0, date: a.date, note: 'Moved from another invoice',
        }).run()
        const inv = tx.select().from(businessInvoices).where(eq(businessInvoices.id, m.invoiceId)).get()!
        if (inv.status === 'draft') tx.update(businessInvoices).set({ status: 'unpaid' }).where(eq(businessInvoices.id, inv.id)).run()
        recomputeInvoice(tx, m.invoiceId)
      }
    } else {
      const all = allocationsOfPayment(tx, a.paymentId)
      const splits: Split[] = all.map(x => ({ invoiceId: x.invoiceId, amount: x.id === a.id ? round2(x.amount - moved) : x.amount }))
      for (const m of moves) {
        const same = splits.find(s => s.invoiceId === m.invoiceId)
        if (same) same.amount = round2(same.amount + m.amount)
        else splits.push(m)
      }
      releasePayment(tx, a.paymentId, splits.map(s => s.invoiceId))
      applyPayment(tx, a.paymentId, splits.filter(s => s.amount > 0.005), { reason: 'Moved by hand' })
    }
    left = round2(left - moved)
  }
  recomputeInvoice(tx, fromInvoiceId)
  if (left > 0.005) refuse(409, `Only ${round2(amount - left).toFixed(2)} of ${amount.toFixed(2)} had somewhere to go`)
}

/** Every open invoice a client has, oldest first, with what each still owes. */
export function openInvoicesOf(tx: Tx, clientId: number, except: number[] = []) {
  return tx.select().from(businessInvoices)
    .where(and(eq(businessInvoices.clientId, clientId), inArray(businessInvoices.status, ['unpaid', 'draft']))).all()
    .filter(i => !except.includes(i.id))
    .map(i => ({ inv: i, owed: remainingOn(tx, i) }))
    .filter(x => x.owed > 0.005)
    .sort((a, b) => a.inv.issueDate.localeCompare(b.inv.issueDate) || a.inv.id - b.inv.id)
}
