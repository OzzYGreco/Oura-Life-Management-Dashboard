/**
 * Invoice numbering.
 *
 * Numbers follow whatever prefix/padding the highest existing invoice uses
 * (INV-001 → INV-002, ZAV-0010 → ZAV-0011). The allocator is created once and
 * increments in memory, so generating a long backlog of retainer invoices costs
 * a single query rather than one per invoice.
 */
import { db } from '../db'
import { businessInvoices } from '../db/schema'

export interface InvoiceNumberAllocator {
  next(): string
}

export async function createInvoiceNumberAllocator(): Promise<InvoiceNumberAllocator> {
  const all = await db.select({ n: businessInvoices.invoiceNumber }).from(businessInvoices)

  let maxNum = 0
  let prefix = 'INV-'
  let padWidth = 3

  for (const row of all) {
    const m = row.n.match(/^(.*?)(\d+)$/)
    if (!m) continue
    const num = parseInt(m[2], 10)
    if (num > maxNum) {
      maxNum   = num
      prefix   = m[1]
      padWidth = Math.max(m[2].length, 3)
    }
  }

  let cursor = maxNum
  return {
    next() {
      cursor++
      return `${prefix}${String(cursor).padStart(padWidth, '0')}`
    },
  }
}

/** Convenience for one-off allocations. */
export async function nextInvoiceNumber(): Promise<string> {
  return (await createInvoiceNumberAllocator()).next()
}
