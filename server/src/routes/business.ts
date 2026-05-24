import { Router } from 'express'
import { db } from '../db'
import {
  businessClients, businessProjects, businessProjectTasks,
  businessInvoices, businessMeetingNotes, businessTimeEntries,
  marketingCampaigns,
} from '../db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { localToday } from '../lib/date'

const router = Router()

// ─── Recurring Invoice Materialization ───────────────────────────────────────

/** Add n months to a YYYY-MM-DD string, clamping to end-of-month. */
function addMonthsToDateStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const targetYear  = y + Math.floor((m - 1 + n) / 12)
  const targetMonth = ((m - 1 + n) % 12 + 12) % 12 + 1
  const maxDay      = new Date(targetYear, targetMonth, 0).getDate()
  const targetDay   = Math.min(d, maxDay)
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`
}

function advanceDate(dateStr: string, frequency: string): string {
  switch (frequency) {
    case 'weekly': {
      const [y, m, d] = dateStr.split('-').map(Number)
      const dt = new Date(y, m - 1, d + 7)
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    }
    case 'monthly':   return addMonthsToDateStr(dateStr, 1)
    case 'quarterly': return addMonthsToDateStr(dateStr, 3)
    case 'yearly':    return addMonthsToDateStr(dateStr, 12)
    default:          return addMonthsToDateStr(dateStr, 1)
  }
}

/**
 * Scan all existing invoice numbers, find the highest numeric suffix,
 * and return the next number with the same prefix + padding.
 * e.g.  INV-001, INV-007  →  INV-008
 *       ZAV-0010           →  ZAV-0011
 */
async function nextInvoiceNumber(): Promise<string> {
  const all = await db.select({ n: businessInvoices.invoiceNumber }).from(businessInvoices)
  if (all.length === 0) return 'INV-001'

  let maxNum   = 0
  let prefix   = 'INV-'
  let padWidth = 3

  for (const row of all) {
    const m = row.n.match(/^(.*?)(\d+)$/)
    if (m) {
      const num = parseInt(m[2], 10)
      if (num > maxNum) {
        maxNum   = num
        prefix   = m[1]
        padWidth = Math.max(m[2].length, 3)
      }
    }
  }

  return `${prefix}${String(maxNum + 1).padStart(padWidth, '0')}`
}

let lastInvoiceMaterializedAt = 0

/**
 * For every recurring invoice template, generate all overdue occurrences up
 * to today. Uses `lastGeneratedDate` as a high-water mark — safe to call
 * repeatedly without producing duplicates.
 */
export async function materializeRecurringInvoices(): Promise<void> {
  const now = Date.now()
  if (now - lastInvoiceMaterializedAt < 5 * 60 * 1000) return
  lastInvoiceMaterializedAt = now

  const today = localToday()

  const templates = await db
    .select()
    .from(businessInvoices)
    .where(and(eq(businessInvoices.isRecurring, 1), isNull(businessInvoices.recurringParentId)))

  for (const t of templates) {
    if (!t.frequency) continue

    // Net payment terms from the original invoice (days between issue → due)
    const netDays = Math.max(
      Math.round((new Date(t.dueDate).getTime() - new Date(t.issueDate).getTime()) / 86_400_000),
      0,
    )

    const fromDate = t.lastGeneratedDate ?? t.issueDate
    let cursor     = advanceDate(fromDate, t.frequency)
    let newLast    = fromDate
    let safety     = 0

    while (cursor <= today && safety < 600) {
      safety++

      const invoiceNum = await nextInvoiceNumber()

      // Apply same net-terms to the new issue date
      const dueDateObj = new Date(cursor + 'T00:00:00Z')
      dueDateObj.setUTCDate(dueDateObj.getUTCDate() + netDays)
      const dueDate = dueDateObj.toISOString().split('T')[0]

      await db.insert(businessInvoices).values({
        clientId:          t.clientId,
        projectId:         t.projectId,
        invoiceNumber:     invoiceNum,
        amount:            t.amount,
        status:            'unpaid',
        issueDate:         cursor,
        dueDate,
        notes:             t.notes,
        isRecurring:       1,
        frequency:         t.frequency,
        recurringParentId: t.id,
      })

      newLast = cursor
      cursor  = advanceDate(cursor, t.frequency)
    }

    // Update high-water mark — never go backwards
    if (newLast !== fromDate) {
      await db.update(businessInvoices)
        .set({ lastGeneratedDate: newLast })
        .where(eq(businessInvoices.id, t.id))
    } else if (!t.lastGeneratedDate) {
      await db.update(businessInvoices)
        .set({ lastGeneratedDate: t.issueDate })
        .where(eq(businessInvoices.id, t.id))
    }
  }
}

// ─── Clients ──────────────────────────────────────────────────────────────────

router.get('/clients', async (_req, res, next) => {
  try { res.json(await db.select().from(businessClients)) } catch (e) { next(e) }
})
router.post('/clients', async (req, res, next) => {
  try { res.status(201).json((await db.insert(businessClients).values(req.body).returning())[0]) } catch (e) { next(e) }
})
router.put('/clients/:id', async (req, res, next) => {
  try { res.json((await db.update(businessClients).set(req.body).where(eq(businessClients.id, parseInt(req.params.id))).returning())[0]) } catch (e) { next(e) }
})
router.delete('/clients/:id', async (req, res, next) => {
  try { await db.delete(businessClients).where(eq(businessClients.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

// ─── Projects ─────────────────────────────────────────────────────────────────

router.get('/projects', async (req, res, next) => {
  try {
    const { clientId, status } = req.query
    const all = await db.select().from(businessProjects)
    res.json(all.filter(p => (!clientId || p.clientId === parseInt(clientId as string)) && (!status || p.status === status)))
  } catch (e) { next(e) }
})
router.post('/projects', async (req, res, next) => {
  try { res.status(201).json((await db.insert(businessProjects).values(req.body).returning())[0]) } catch (e) { next(e) }
})
router.put('/projects/:id', async (req, res, next) => {
  try { res.json((await db.update(businessProjects).set({ ...req.body, updatedAt: new Date().toISOString() }).where(eq(businessProjects.id, parseInt(req.params.id))).returning())[0]) } catch (e) { next(e) }
})
router.delete('/projects/:id', async (req, res, next) => {
  try { await db.delete(businessProjects).where(eq(businessProjects.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

// ─── Project Tasks ────────────────────────────────────────────────────────────

router.get('/projects/:id/tasks', async (req, res, next) => {
  try { res.json(await db.select().from(businessProjectTasks).where(eq(businessProjectTasks.projectId, parseInt(req.params.id)))) } catch (e) { next(e) }
})
router.post('/projects/:id/tasks', async (req, res, next) => {
  try { res.status(201).json((await db.insert(businessProjectTasks).values({ ...req.body, projectId: parseInt(req.params.id) }).returning())[0]) } catch (e) { next(e) }
})
router.put('/tasks/:id', async (req, res, next) => {
  try { res.json((await db.update(businessProjectTasks).set(req.body).where(eq(businessProjectTasks.id, parseInt(req.params.id))).returning())[0]) } catch (e) { next(e) }
})
router.delete('/tasks/:id', async (req, res, next) => {
  try { await db.delete(businessProjectTasks).where(eq(businessProjectTasks.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

// ─── Invoices ─────────────────────────────────────────────────────────────────

router.get('/invoices', async (req, res, next) => {
  try {
    await materializeRecurringInvoices()
    const { clientId, status } = req.query
    const all = await db.select().from(businessInvoices)
    res.json(all.filter(i => (!clientId || i.clientId === parseInt(clientId as string)) && (!status || i.status === status)))
  } catch (e) { next(e) }
})
router.post('/invoices', async (req, res, next) => {
  try {
    const row = (await db.insert(businessInvoices).values(req.body).returning())[0]
    // New recurring template → materialise on next fetch
    if (req.body.isRecurring) lastInvoiceMaterializedAt = 0
    res.status(201).json(row)
  } catch (e) { next(e) }
})
router.put('/invoices/:id', async (req, res, next) => {
  try { res.json((await db.update(businessInvoices).set(req.body).where(eq(businessInvoices.id, parseInt(req.params.id))).returning())[0]) } catch (e) { next(e) }
})
router.delete('/invoices/:id', async (req, res, next) => {
  try { await db.delete(businessInvoices).where(eq(businessInvoices.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

// ─── Time Entries ─────────────────────────────────────────────────────────────

router.get('/time', async (_req, res, next) => {
  try { res.json(await db.select().from(businessTimeEntries)) } catch (e) { next(e) }
})
router.get('/projects/:id/time', async (req, res, next) => {
  try { res.json(await db.select().from(businessTimeEntries).where(eq(businessTimeEntries.projectId, parseInt(req.params.id)))) } catch (e) { next(e) }
})
router.post('/projects/:id/time', async (req, res, next) => {
  try { res.status(201).json((await db.insert(businessTimeEntries).values({ ...req.body, projectId: parseInt(req.params.id) }).returning())[0]) } catch (e) { next(e) }
})
router.delete('/time/:id', async (req, res, next) => {
  try { await db.delete(businessTimeEntries).where(eq(businessTimeEntries.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

// ─── Meeting Notes ────────────────────────────────────────────────────────────

router.get('/meeting-notes', async (req, res, next) => {
  try {
    const { clientId, projectId } = req.query
    const all = await db.select().from(businessMeetingNotes)
    res.json(all.filter(n => (!clientId || n.clientId === parseInt(clientId as string)) && (!projectId || n.projectId === parseInt(projectId as string))))
  } catch (e) { next(e) }
})
router.post('/meeting-notes', async (req, res, next) => {
  try { res.status(201).json((await db.insert(businessMeetingNotes).values(req.body).returning())[0]) } catch (e) { next(e) }
})
router.put('/meeting-notes/:id', async (req, res, next) => {
  try { res.json((await db.update(businessMeetingNotes).set({ ...req.body, updatedAt: new Date().toISOString() }).where(eq(businessMeetingNotes.id, parseInt(req.params.id))).returning())[0]) } catch (e) { next(e) }
})
router.delete('/meeting-notes/:id', async (req, res, next) => {
  try { await db.delete(businessMeetingNotes).where(eq(businessMeetingNotes.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

// ─── Marketing Campaigns ──────────────────────────────────────────────────────

router.get('/campaigns', async (_req, res, next) => {
  try { res.json(await db.select().from(marketingCampaigns).orderBy(marketingCampaigns.startDate)) } catch (e) { next(e) }
})
router.post('/campaigns', async (req, res, next) => {
  try { res.status(201).json((await db.insert(marketingCampaigns).values(req.body).returning())[0]) } catch (e) { next(e) }
})
router.put('/campaigns/:id', async (req, res, next) => {
  try { res.json((await db.update(marketingCampaigns).set(req.body).where(eq(marketingCampaigns.id, parseInt(req.params.id))).returning())[0]) } catch (e) { next(e) }
})
router.delete('/campaigns/:id', async (req, res, next) => {
  try { await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

export default router
