/**
 * Retainer billing.
 *
 * Replaces the legacy generator that walked `business_invoices` rows flagged
 * `is_recurring = 1`. Two things that mechanism could not do, and this one can:
 *
 *   1. Stop. The old loop had no end-date check, so cancelling a retainer left
 *      it invoicing forever.
 *   2. Say what an invoice is for. Generated rows now carry `retainer_id`,
 *      `service_id`, `subtotal` and the period they cover, which is what makes
 *      retainer revenue separable from one-off work.
 *
 * `next_invoice_date` is the high-water mark, so calling this repeatedly is
 * safe: an invoice is only ever issued for a period that has not been issued.
 */
import { db } from '../db'
import { businessRetainers, businessInvoices } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { advance, addDays } from './recurrence'
import { createInvoiceNumberAllocator } from './invoiceNumbers'
import { localToday } from './date'

/** Guards against a burst of requests each triggering a scan. */
let lastRunAt = 0
const THROTTLE_MS = 5 * 60 * 1000

export interface GeneratedInvoice {
  id: number
  invoiceNumber: string
  retainerId: number
  clientId: number
  amount: number
  issueDate: string
}

export async function generateRetainerInvoices(
  opts: { force?: boolean; today?: string } = {},
): Promise<GeneratedInvoice[]> {
  const now = Date.now()
  if (!opts.force && now - lastRunAt < THROTTLE_MS) return []
  lastRunAt = now

  const today = opts.today ?? localToday()

  const due = await db
    .select()
    .from(businessRetainers)
    .where(and(eq(businessRetainers.status, 'active'), eq(businessRetainers.autoInvoice, 1)))

  const generated: GeneratedInvoice[] = []
  const alloc = await createInvoiceNumberAllocator()

  for (const r of due) {
    let cursor = r.nextInvoiceDate ?? advance(r.lastGeneratedDate ?? r.startDate, r.frequency)
    let last   = r.lastGeneratedDate
    let safety = 0

    // A cancelled or ended retainer bills up to its end date and no further.
    while (cursor <= today && (!r.endDate || cursor <= r.endDate) && safety < 600) {
      safety++
      const invoiceNumber = alloc.next()
      const periodEnd = advance(cursor, r.frequency)
      const dueDate = addDays(cursor, r.netTermDays ?? 0)

      const [row] = await db.insert(businessInvoices).values({
        clientId:      r.clientId,
        invoiceNumber,
        amount:        r.amount,
        subtotal:      r.amount,
        status:        'unpaid',
        issueDate:     cursor,
        dueDate,
        notes:         r.notes ?? r.name,
        retainerId:    r.id,
        serviceId:     r.serviceId,
        currency:      r.currency,
        periodStart:   cursor,
        periodEnd,
      }).returning()

      generated.push({
        id: row.id, invoiceNumber, retainerId: r.id,
        clientId: r.clientId, amount: r.amount, issueDate: cursor,
      })

      last   = cursor
      cursor = advance(cursor, r.frequency)
    }

    if (last !== r.lastGeneratedDate || cursor !== r.nextInvoiceDate) {
      await db.update(businessRetainers)
        .set({ lastGeneratedDate: last, nextInvoiceDate: cursor, updatedAt: new Date().toISOString() })
        .where(eq(businessRetainers.id, r.id))
    }
  }

  return generated
}

/** Called after a write that could change what is due, so the next read is fresh. */
export function invalidateRetainerBilling(): void {
  lastRunAt = 0
}
