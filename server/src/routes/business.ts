import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import {
  businessClients, businessProjects, businessProjectTasks,
  businessInvoices, businessMeetingNotes, businessTimeEntries,
  businessRetainers, businessRetainerChanges, businessServices,
  businessOwners, businessOwnerDraws,
  financeIncome, financeExpenses, marketingCampaigns, marketingSpendDaily, stripePayments,
  businessPaymentAllocations, businessEvents, stripeFailedCharges,
} from '../db/schema'
import { eq, and, gte, lte, like, or, inArray, notInArray, sql, desc, ne } from 'drizzle-orm'
import { localToday } from '../lib/date'
import { advance, addDays } from '../lib/recurrence'
import { createInvoiceNumberAllocator, nextInvoiceNumber } from '../lib/invoiceNumbers'
import { generateRetainerInvoices, invalidateRetainerBilling } from '../lib/retainerBilling'
import { invoicesBefore, planAhead, issueAhead, moveMoney, openInvoicesOf, priceOn } from '../lib/lifecycle'
import { logEvent } from '../lib/events'
import {
  syncAdSpend, recomputeCampaignSpend, configuredPlatforms, metaConfigured,
} from '../lib/adSpendSync'
import {
  syncStripePayments, unassignedPayments, stripeCoverage, restateForSubscription, subsetsFor,
  stripeConfigured, stripeStatusNote,
} from '../lib/stripeSync'
import {
  businessMetrics, businessDashboardSummary, loadBusinessData, invalidateBusinessData,
  clientEconomics, ownerPay, needsYou, owedOn, toMonthly, retainerMrrOn,
} from '../lib/businessMetrics'
import {
  recordManualPayment, removeAllocation, unpayInvoice, voidInvoice, restoreInvoice,
  releasePayment, applyPayment, defaultSplits, learnCustomerTx, knockOn, allocationsFor,
  allocationsOfPayment, remainingOn, refuse, recomputeInvoice, type Tx,
} from '../lib/payments'

const router = Router()

/**
 * Every figure on this tab is derived from one cached snapshot of the business
 * tables, so any write has to drop that snapshot. Wrapping it in one call means
 * a new route cannot forget half of it.
 */
function invalidate(): void {
  invalidateBusinessData()
  invalidateRetainerBilling()
}

const round2 = (n: number) => Math.round(n * 100) / 100
const gbp = (n: number) => `£${n.toFixed(2)}`
const id = (v: string) => parseInt(v, 10)

/** Runs the retainer generator at boot. Kept exported: `index.ts` calls it. */
export async function materializeRecurringInvoices(): Promise<void> {
  const made = await generateRetainerInvoices()
  if (made.length) {
    invalidateBusinessData()
    console.log(`[business] issued ${made.length} retainer invoice(s): ${made.map(m => m.invoiceNumber).join(', ')}`)
  }
}

/** Turns a zod failure into a 400 the client can actually read. */
function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body)
  if (!r.success) {
    const msg = r.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
    const err = new Error(msg) as Error & { status?: number }
    err.status = 400
    throw err
  }
  return r.data
}

/**
 * The owner-pay settings arrive as query params because they live in the
 * browser's own settings store, not the database. Parsed in one place so
 * /metrics and /owner-draws can never read them differently.
 */
function ownerPayOptions(q: Record<string, any>) {
  return {
    taxReserveEnabled: q.taxReserveEnabled == null ? undefined : q.taxReserveEnabled !== 'false',
    taxRatePct:        q.taxRatePct   ? Number(q.taxRatePct)   : undefined,
    bufferMonths:      q.bufferMonths != null ? Number(q.bufferMonths) : undefined,
  }
}

const money = z.number().finite().nonnegative()
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

// ─── Metrics ──────────────────────────────────────────────────────────────────

router.get('/metrics', async (req, res, next) => {
  try {
    await generateRetainerInvoices()
    const { from, to } = req.query
    res.json(await businessMetrics(
      { from: from as string | undefined, to: to as string | undefined },
      ownerPayOptions(req.query),
    ))
  } catch (e) { next(e) }
})

router.get('/summary', async (_req, res, next) => {
  try { res.json(await businessDashboardSummary()) } catch (e) { next(e) }
})

router.get('/needs', async (_req, res, next) => {
  try { res.json(needsYou(await loadBusinessData())) } catch (e) { next(e) }
})

// ─── Clients ──────────────────────────────────────────────────────────────────

const clientSchema = z.object({
  name:        z.string().min(1),
  company:     z.string().nullish(),
  email:       z.string().nullish(),
  phone:       z.string().nullish(),
  website:     z.string().nullish(),
  notes:       z.string().nullish(),
  source:      z.string().nullish(),
  // 'churned' is set only by the drop flow, which also ends their retainers
  // and invoices. As a bare label it stopped nothing and MRR kept counting them.
  status:      z.enum(['active', 'lead', 'inactive']).optional(),
  wonDate:     dateStr.nullish(),
  churnedAt:   dateStr.nullish(),
  vatNumber:   z.string().nullish(),
  addressLine: z.string().nullish(),
  city:        z.string().nullish(),
  postcode:    z.string().nullish(),
  country:     z.string().nullish(),
  campaignId:  z.number().int().nullish(),
})

router.get('/clients', async (_req, res, next) => {
  try { res.json(await db.select().from(businessClients).orderBy(businessClients.name)) } catch (e) { next(e) }
})

/** Every client with the figures the Clients table shows, computed once. */
router.get('/clients/overview', async (_req, res, next) => {
  try {
    const d = await loadBusinessData()
    const today = localToday()
    res.json(d.clients.map(c => {
      const e = clientEconomics(d, c.id, today)
      return {
        id: c.id, name: c.name, company: c.company, status: c.status, website: c.website,
        mrr: e.mrr, lifetime: e.revenue, costs: e.costs, margin: e.margin, marginPct: e.marginPct,
        outstanding: e.outstanding, unbilled: e.unbilled, since: e.since,
        tenureMonths: e.tenureMonths, invoiceCount: e.invoiceCount,
        projectCount: e.projectCount, retainerCount: e.retainerCount,
        lastInvoiceDate: e.lastInvoiceDate, spark: e.spark,
      }
    }).sort((a, b) => b.mrr - a.mrr || b.lifetime - a.lifetime))
  } catch (e) { next(e) }
})

/** Everything the client drill-in needs, in one request. */
router.get('/clients/:id/summary', async (req, res, next) => {
  try {
    const clientId = id(req.params.id)
    const d = await loadBusinessData()
    const client = d.clients.find(c => c.id === clientId)
    if (!client) return res.status(404).json({ error: 'No such client' })

    res.json({
      client,
      economics: clientEconomics(d, clientId),
      retainers: d.retainers
        .filter(r => r.clientId === clientId)
        .map(r => ({ ...r, serviceName: d.services.find(s => s.id === r.serviceId)?.name ?? r.name }))
        .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || b.amount - a.amount),
      projects: d.projects
        .filter(p => p.clientId === clientId)
        .map(p => ({
          ...p,
          hours:     round2(d.time.filter(t => t.projectId === p.id).reduce((s, t) => s + t.hours, 0)),
          collected: round2(d.receipts.filter(x => x.projectId === p.id).reduce((s, x) => s + x.gross, 0)),
        }))
        .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '')),
      invoices: d.allInvoices
        .filter(i => i.clientId === clientId)
        .map(i => ({
          ...i,
          serviceName: d.services.find(s => s.id === i.serviceId)?.name ?? null,
          applied: round2(d.applied.get(i.id) ?? 0),
          owed: i.status === 'void' ? 0 : owedOn(d, i),
        }))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.id - a.id),
      costs: d.expenses
        .filter(e => e.clientId === clientId)
        .sort((a, b) => b.date.localeCompare(a.date)),
      notes: d.clients.find(c => c.id === clientId)?.notes ?? null,
      meetingNotes: await db.select().from(businessMeetingNotes).where(eq(businessMeetingNotes.clientId, clientId)),
    })
  } catch (e) { next(e) }
})

router.post('/clients', async (req, res, next) => {
  try {
    const body = parse(clientSchema, req.body)
    const row = (await db.insert(businessClients).values(body).returning())[0]
    invalidate()
    res.status(201).json(row)
  } catch (e) { next(e) }
})
router.put('/clients/:id', async (req, res, next) => {
  try {
    const body = parse(clientSchema.partial(), req.body)
    const row = (await db.update(businessClients).set(body).where(eq(businessClients.id, id(req.params.id))).returning())[0]
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})
/**
 * Delete is for a client added by mistake. One with any invoice or payment has
 * history the figures are built on, so they are ended with "Client left"
 * instead, which keeps their churn where it happened.
 */
router.delete('/clients/:id', async (req, res, next) => {
  try {
    const clientId = id(req.params.id)
    const [inv] = await db.select({ n: sql<number>`count(*)` }).from(businessInvoices).where(eq(businessInvoices.clientId, clientId))
    const [pay] = await db.select({ n: sql<number>`count(*)` }).from(stripePayments).where(eq(stripePayments.matchedClientId, clientId))
    const [ret] = await db.select({ n: sql<number>`count(*)` }).from(businessRetainers).where(eq(businessRetainers.clientId, clientId))
    if ((inv?.n ?? 0) + (pay?.n ?? 0) + (ret?.n ?? 0) > 0) {
      return res.status(409).json({ error: 'This client has invoices or payments. Use "Client left" to end them instead, so their history stays in the figures.' })
    }
    db.transaction(tx => {
      tx.delete(businessMeetingNotes).where(eq(businessMeetingNotes.clientId, clientId)).run()
      tx.update(businessProjects).set({ clientId: null }).where(eq(businessProjects.clientId, clientId)).run()
      tx.delete(businessClients).where(eq(businessClients.id, clientId)).run()
    })
    invalidate()
    res.status(204).send()
  } catch (e) { next(e) }
})

/**
 * Remove a client completely, with everything of theirs: invoices, payments
 * recorded by hand, retainers, websites, notes. For a test client or one
 * added by mistake. Their money leaves every figure, which the preview says.
 *
 * Stripe payments are real money that arrived, so they are not deleted: they
 * go back to the queue to be assigned to someone else or marked not income.
 * Costs attributed to them stay, as business costs.
 */
function clientFootprint(clientId: number) {
  const invoices = db.select().from(businessInvoices).where(eq(businessInvoices.clientId, clientId)).all()
  const invIds = invoices.map(i => i.id)
  const allocs = invIds.length ? db.select().from(businessPaymentAllocations).where(inArray(businessPaymentAllocations.invoiceId, invIds)).all() : []
  const paymentIds = [...new Set([
    ...allocs.filter(a => a.paymentId).map(a => a.paymentId!),
    ...db.select({ id: stripePayments.id }).from(stripePayments).where(eq(stripePayments.matchedClientId, clientId)).all().map(p => p.id),
  ])]
  const retainers = db.select().from(businessRetainers).where(eq(businessRetainers.clientId, clientId)).all()
  const projects = db.select().from(businessProjects).where(eq(businessProjects.clientId, clientId)).all()
  return {
    invoices, invIds, paymentIds, retainers, projects,
    summary: {
      invoices: invoices.length,
      collected: round2(allocs.reduce((t, a) => t + a.amount - a.refunded, 0)),
      byHand: allocs.filter(a => !a.paymentId).length,
      stripePayments: paymentIds.length,
      retainers: retainers.length,
      liveRetainers: retainers.filter(r => r.status === 'active').length,
      websites: projects.length,
    },
  }
}

router.get('/clients/:id/delete-preview', async (req, res, next) => {
  try { res.json(clientFootprint(id(req.params.id)).summary) } catch (e) { next(e) }
})

router.delete('/clients/:id/everything', async (req, res, next) => {
  try {
    const clientId = id(req.params.id)
    const f = clientFootprint(clientId)
    const projectIds = f.projects.map(p => p.id)
    db.transaction(tx => {
      // Stripe money back to the queue first, so nothing points at what goes.
      for (const pid of f.paymentIds) releasePayment(tx, pid)
      if (f.paymentIds.length) {
        tx.update(stripePayments).set({ matchedClientId: null, matchedInvoiceId: null, coversInvoiceIds: null })
          .where(inArray(stripePayments.id, f.paymentIds)).run()
      }
      if (f.invIds.length) {
        tx.update(stripePayments).set({ matchedInvoiceId: null }).where(inArray(stripePayments.matchedInvoiceId, f.invIds)).run()
        tx.delete(businessInvoices).where(inArray(businessInvoices.id, f.invIds)).run()
      }
      tx.delete(businessMeetingNotes).where(eq(businessMeetingNotes.clientId, clientId)).run()
      if (projectIds.length) {
        tx.delete(businessMeetingNotes).where(inArray(businessMeetingNotes.projectId, projectIds)).run()
        tx.update(financeExpenses).set({ projectId: null }).where(inArray(financeExpenses.projectId, projectIds)).run()
        tx.delete(businessProjects).where(inArray(businessProjects.id, projectIds)).run()
      }
      tx.update(financeExpenses).set({ clientId: null }).where(eq(financeExpenses.clientId, clientId)).run()
      for (const r of f.retainers) {
        tx.delete(businessRetainerChanges).where(eq(businessRetainerChanges.retainerId, r.id)).run()
        tx.delete(businessRetainers).where(eq(businessRetainers.id, r.id)).run()
      }
      tx.delete(businessEvents).where(eq(businessEvents.clientId, clientId)).run()
      tx.delete(businessClients).where(eq(businessClients.id, clientId)).run()
    })
    invalidate()
    res.json(f.summary)
  } catch (e) { next(e) }
})

/**
 * A client leaving, as one decision rather than five.
 *
 * Marking a client churned used to change a label and nothing else: their
 * retainers stayed active, MRR kept counting them and invoices kept arriving.
 * This ends everything at once, from the last day they were a client, which may
 * be in the past so that the churn lands in the month it actually happened.
 *
 * `dryRun` returns exactly what would happen, which is what the confirm screen
 * shows, so the preview and the action can never disagree.
 */
router.post('/clients/:id/drop', async (req, res, next) => {
  try {
    const clientId = id(req.params.id)
    const today = localToday()
    const body = parse(z.object({
      endDate: dateStr.optional(),
      reason: z.string().nullish(),
      writeOffInvoiceIds: z.array(z.number().int()).optional(),
      /**
       * Sent invoices from after the last day that are still owed anyway: the
       * client left in September but the September and October bills stand,
       * because they will be paid if the client comes back. Churn still lands
       * on the real last day; only these invoices are spared the void.
       */
      keepOwedInvoiceIds: z.array(z.number().int()).optional(),
      dryRun: z.boolean().optional(),
    }), req.body)
    const endDate = body.endDate ?? today
    // A last day ahead is notice: they stay a client, and are billed, until it.
    const notice = endDate > today

    const d = await loadBusinessData()
    const client = d.clients.find(c => c.id === clientId)
    if (!client) return res.status(404).json({ error: 'No such client' })

    // Live retainers end on the last day. So does one already cancelled with a
    // LATER end date: cancelling the retainer first (defaulting to today) and
    // then saying the client left in September would otherwise keep their
    // churn in October.
    const retainers = d.retainers.filter(r => r.clientId === clientId
      && (r.status !== 'cancelled' || (r.endDate != null && r.endDate > endDate)))
    // A paused retainer stopped earning on the day it was paused, so it ends then.
    const stopOf = (r: typeof retainers[number]) =>
      r.status === 'paused' && r.pausedAt && r.pausedAt < endDate ? r.pausedAt : endDate

    const open = d.invoices.filter(i => i.clientId === clientId && (i.status === 'unpaid' || i.status === 'draft'))
    const retainerOf = (i: typeof open[number]) => retainers.find(r => r.id === i.retainerId)
    // Voided without asking: anything for after they left, and every draft,
    // since a draft was never sent and is not owed.
    const afterEnd = open.filter(i => {
      if (!notice && i.status === 'draft' && !d.applied.get(i.id)) return true
      const r = retainerOf(i)
      const from = i.periodStart ?? i.issueDate
      return r ? from >= stopOf(r) : i.issueDate > endDate
    })
    const before = open.filter(i => !afterEnd.includes(i))
    const writeOff = new Set(body.writeOffInvoiceIds ?? [])
    // Only a sent invoice can be kept: a draft was never owed.
    const keepOwed = new Set((body.keepOwedInvoiceIds ?? []).filter(id => afterEnd.some(i => i.id === id && i.status !== 'draft')))

    const plan = {
      client: { id: client.id, name: client.name },
      endDate,
      retainers: retainers.map(r => ({
        id: r.id, name: d.services.find(s => s.id === r.serviceId)?.name ?? r.name,
        amount: r.amount, frequency: r.frequency, status: r.status, endsOn: stopOf(r),
        mrr: round2(toMonthly(r.amount, r.frequency)),
      })),
      mrrLost: round2(retainers.filter(r => r.status === 'active').reduce((s, r) => s + retainerMrrOn(r, today, d.changes), 0)),
      /** Already cancelled, but with a later end date that moves back to the last day. */
      endsEarlier: retainers.filter(r => r.status === 'cancelled').map(r => ({ id: r.id, from: r.endDate, to: endDate })),
      voided: afterEnd.map(i => ({
        id: i.id, invoiceNumber: i.invoiceNumber, amount: i.amount, owed: owedOn(d, i),
        issueDate: i.issueDate, dueDate: i.dueDate, status: i.status,
        /** False for a draft: it was never sent, so there is nothing to keep. */
        canKeep: i.status !== 'draft',
        keepOwed: keepOwed.has(i.id),
      })),
      stillOwed: before.map(i => ({
        id: i.id, invoiceNumber: i.invoiceNumber, amount: i.amount, owed: owedOn(d, i),
        issueDate: i.issueDate, dueDate: i.dueDate, writeOff: writeOff.has(i.id),
      })),
      // Work in progress is finished during notice, so it is left alone.
      projects: notice ? [] : d.projects.filter(p => p.clientId === clientId && p.status === 'active' && p.stage !== 'launched')
        .map(p => ({ id: p.id, name: p.name, stage: p.stage })),
      notice,
      /** Notice: the bills still to come before the last day. */
      stillToBill: notice
        ? retainers.filter(r => r.status === 'active').flatMap(r => invoicesBefore(r, endDate, d.changes).map(x => ({ ...x, name: r.name })))
        : [],
    }
    if (body.dryRun) return res.json(plan)

    db.transaction(tx => {
      for (const r of retainers) {
        const stop = stopOf(r)
        // Still live until a day ahead: the end is scheduled, and closes itself.
        tx.update(businessRetainers).set(stop > today && r.status === 'active' ? {
          endDate: stop, cancelReason: body.reason ?? r.cancelReason ?? 'Client gave notice', updatedAt: new Date().toISOString(),
        } : {
          status: 'cancelled', endDate: stop, cancelledAt: r.cancelledAt ?? today, autoInvoice: 0,
          cancelReason: body.reason ?? r.cancelReason ?? 'Client left', updatedAt: new Date().toISOString(),
        }).where(eq(businessRetainers.id, r.id)).run()
        // A price change dated after they left never happened.
        tx.delete(businessRetainerChanges).where(and(
          eq(businessRetainerChanges.retainerId, r.id), gte(businessRetainerChanges.effectiveDate, stopOf(r)))).run()
      }
      for (const i of afterEnd) if (!keepOwed.has(i.id)) voidInvoice(tx, i.id, 'Client left before this period', today)
      for (const i of before) if (writeOff.has(i.id)) voidInvoice(tx, i.id, 'Written off when the client left', today)
      for (const p of plan.projects) {
        tx.update(businessProjects).set({ status: 'cancelled', updatedAt: new Date().toISOString() })
          .where(eq(businessProjects.id, p.id)).run()
      }
      logEvent(tx, clientId, notice ? 'notice' : 'left', notice
        ? `Gave notice, leaving on ${endDate}${body.reason ? `: ${body.reason}` : ''}`
        : `Left on ${endDate}${body.reason ? `: ${body.reason}` : ''}${writeOff.size ? `, ${writeOff.size} bill${writeOff.size === 1 ? '' : 's'} written off` : ''}`)
      tx.update(businessClients).set(notice
        ? { leavingOn: endDate, churnReason: body.reason ?? null }
        : { status: 'churned', churnedAt: endDate, churnReason: body.reason ?? null, leavingOn: null })
        .where(eq(businessClients.id, clientId)).run()
    })
    invalidate()
    res.json(plan)
  } catch (e) { next(e) }
})

/**
 * Correct the day a client left, after the fact.
 *
 * Their retainers that ended with them move to the new day, so churn and MRR
 * history follow. Moved earlier, open bills for periods from the new day are
 * voided, as leaving on that day would have done. Moved later, bills voided
 * only because they fell after the old day, and now fall before the new one,
 * are owed again.
 */
router.post('/clients/:id/left-on', async (req, res, next) => {
  try {
    const clientId = id(req.params.id)
    const body = parse(z.object({ date: dateStr, dryRun: z.boolean().optional() }), req.body)
    const today = localToday()
    if (body.date > today) {
      return res.status(400).json({ error: 'That is ahead. Use "They are back", then "Client left..." with the day ahead to record notice.' })
    }
    const client = db.select().from(businessClients).where(eq(businessClients.id, clientId)).get()
    if (!client) return res.status(404).json({ error: 'No such client' })
    if (client.status !== 'churned') return res.status(409).json({ error: `${client.name} has not left` })
    const old = client.churnedAt
    const date = body.date

    // The retainers that ended when they left: on the old day, or any time
    // after the new one (a retainer cannot outlive the client).
    const retainers = db.select().from(businessRetainers).where(eq(businessRetainers.clientId, clientId)).all()
      .filter(r => r.status === 'cancelled' && r.endDate && r.startDate < date && (r.endDate === old || r.endDate > date))
    const ids = retainers.map(r => r.id)
    const bills = ids.length
      ? db.select().from(businessInvoices).where(inArray(businessInvoices.retainerId, ids)).all()
      : []
    const toVoid = bills.filter(i => (i.status === 'unpaid' || i.status === 'draft') && (i.periodStart ?? i.issueDate) >= date)
    const toRestore = bills.filter(i => i.status === 'void' && i.voidReason === 'Client left before this period'
      && (i.periodStart ?? i.issueDate) < date)

    const plan = {
      from: old, to: date,
      retainers: retainers.map(r => ({ id: r.id, name: r.name, from: r.endDate, to: date })),
      voided: toVoid.map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, amount: i.amount })),
      restored: toRestore.map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, amount: i.amount })),
    }
    if (body.dryRun) return res.json(plan)

    db.transaction(tx => {
      for (const r of retainers) {
        tx.update(businessRetainers).set({
          endDate: date,
          // MRR reads a cancelled retainer as gone from its cancel date, so that
          // can never sit before the new last day.
          cancelledAt: r.cancelledAt && r.cancelledAt > date ? r.cancelledAt : date,
          updatedAt: new Date().toISOString(),
        }).where(eq(businessRetainers.id, r.id)).run()
        tx.delete(businessRetainerChanges).where(and(
          eq(businessRetainerChanges.retainerId, r.id), gte(businessRetainerChanges.effectiveDate, date))).run()
      }
      for (const i of toVoid) voidInvoice(tx, i.id, 'Client left before this period', today)
      for (const i of toRestore) restoreInvoice(tx, i.id)
      tx.update(businessClients).set({ churnedAt: date }).where(eq(businessClients.id, clientId)).run()
      logEvent(tx, clientId, 'left-date', `Day they left changed from ${old ?? 'unknown'} to ${date}`)
    })
    invalidate()
    res.json(plan)
  } catch (e) { next(e) }
})

/**
 * What a returning client could pick back up: every invoice voided for them
 * that can still stand as a debt, and every retainer that was ended.
 *
 * An invoice raised only because a Stripe payment arrived, whose payment now
 * settles something else, is left out: it was never a bill for work.
 */
router.get('/clients/:id/comeback', async (req, res, next) => {
  try {
    const clientId = id(req.params.id)
    const d = await loadBusinessData()
    const usedElsewhere = (i: (typeof d.allInvoices)[number]) =>
      !!i.raisedFromPaymentId && d.receipts.some(x => x.paymentId === i.raisedFromPaymentId)
    res.json({
      invoices: d.allInvoices
        .filter(i => i.clientId === clientId && i.status === 'void' && !usedElsewhere(i))
        .sort((a, b) => a.issueDate.localeCompare(b.issueDate))
        .map(i => ({
          id: i.id, invoiceNumber: i.invoiceNumber, amount: i.amount, issueDate: i.issueDate,
          voidedAt: i.voidedAt, voidReason: i.voidReason,
        })),
      retainers: d.retainers
        .filter(r => r.clientId === clientId && r.status === 'cancelled')
        .map(r => ({
          id: r.id, name: d.services.find(sv => sv.id === r.serviceId)?.name ?? r.name,
          amount: r.amount, frequency: r.frequency, endDate: r.endDate,
        })),
    })
  } catch (e) { next(e) }
})

/**
 * A client paid: record it once, against whatever they owe, oldest first.
 *
 * "Which invoice was this for?" is a question nobody wants to answer for a
 * client who simply pays what they owe. Money goes to their oldest open bill
 * first and spills into the next; anything left over is refused rather than
 * guessed, so it can be raised as an invoice deliberately.
 */
router.post('/clients/:id/payments', async (req, res, next) => {
  try {
    const clientId = id(req.params.id)
    const body = parse(z.object({
      amount:     z.number().positive(),
      date:       dateStr.optional(),
      fee:        z.number().nonnegative().optional(),
      method:     z.enum(['bank', 'cash', 'stripe']).optional(),
      invoiceIds: z.array(z.number().int()).optional(),
      /** What money beyond their bills was for. It is raised as a paid invoice. */
      restFor:    z.string().nullish(),
      /**
       * Money beyond their bills pays their retainer ahead: next month's
       * invoice is issued now and paid, and that month is not billed again.
       * On by default for a client with a live retainer and no `restFor`.
       */
      ahead:      z.boolean().optional(),
      dryRun:     z.boolean().optional(),
    }), req.body)
    const d = await loadBusinessData()
    const open = d.invoices
      .filter(i => i.clientId === clientId && (i.status === 'unpaid' || i.status === 'draft')
        && (!body.invoiceIds || body.invoiceIds.includes(i.id)))
      .map(i => ({ inv: i, owed: owedOn(d, i) }))
      .filter(x => x.owed > 0.005)
      .sort((a, b) => a.inv.issueDate.localeCompare(b.inv.issueDate) || a.inv.id - b.inv.id)

    let left = round2(body.amount)
    const splits: { invoiceId: number; invoiceNumber: string; amount: number; owed: number; settles: boolean }[] = []
    for (const x of open) {
      if (left <= 0.005) break
      const amt = round2(Math.min(x.owed, left))
      splits.push({ invoiceId: x.inv.id, invoiceNumber: x.inv.invoiceNumber, amount: amt, owed: x.owed, settles: amt >= x.owed - 0.005 })
      left = round2(left - amt)
    }
    const date = body.date ?? localToday()
    const retainers = d.retainers.filter(r => r.clientId === clientId && r.status === 'active')
    const useAhead = left > 0.005 && retainers.length > 0 && (body.ahead ?? !body.restFor)
    const ahead = useAhead ? planAhead(retainers, left, 12, d.changes) : { periods: [], left }
    left = ahead.left

    // The same money entered twice: a payment of this size for this client
    // within three days, already recorded by hand.
    const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= 3 * 86_400_000
    const theirs = new Set(d.allInvoices.filter(i => i.clientId === clientId).map(i => i.id))
    const sameDay = d.receipts.filter(x => !x.paymentId && theirs.has(x.invoiceId) && near(x.date, date))
    const byDay = new Map<string, number>()
    for (const x of sameDay) byDay.set(x.date, round2((byDay.get(x.date) ?? 0) + x.gross))
    const dup = [...byDay.entries()].find(([, v]) => Math.abs(v - body.amount) < 0.01)

    const plan = {
      splits, leftOver: left, owedTotal: round2(open.reduce((s2, x) => s2 + x.owed, 0)),
      ahead: ahead.periods,
      duplicate: dup ? { date: dup[0], amount: dup[1] } : null,
    }
    if (body.dryRun) return res.json(plan)
    // Money beyond what is owed (or when nothing is) is not refused: it becomes
    // a paid invoice for what it was for, so it reaches every total in one step.
    const alloc = await createInvoiceNumberAllocator()
    const aheadNumbers = ahead.periods.map(() => alloc.next())
    const restNumber = left > 0.005 ? alloc.next() : null
    db.transaction(tx => {
      ahead.periods.forEach((p, i) => {
        const inv = issueAhead(tx, p.retainerId, p.periodStart, aheadNumbers[i], localToday())
        splits.push({ invoiceId: inv.id, invoiceNumber: aheadNumbers[i], amount: p.pays, owed: p.amount, settles: p.pays >= p.amount - 0.005 })
      })
      if (restNumber) {
        reactivateIfChurned(tx, clientId)
        const inv = tx.insert(businessInvoices).values({
          clientId, invoiceNumber: restNumber, amount: left, subtotal: left,
          status: 'unpaid', issueDate: date, dueDate: date, sentDate: date,
          notes: body.restFor?.trim() || 'Payment received',
        }).returning().get()
        splits.push({ invoiceId: inv.id, invoiceNumber: restNumber, amount: left, owed: left, settles: true })
      }
      logEvent(tx, clientId, 'payment', `${gbp(body.amount)} received by ${body.method ?? 'bank'}${ahead.periods.length ? `, ${ahead.periods.length} month${ahead.periods.length === 1 ? '' : 's'} paid ahead` : ''}`)
      splits.forEach((sp, idx) => recordManualPayment(tx, sp.invoiceId, {
        amount: sp.amount, date, method: body.method ?? 'bank',
        // The fee belongs to the payment; it rides on the first invoice it touches.
        fee: idx === 0 ? body.fee ?? 0 : 0,
      }))
    })
    invalidate()
    res.json(plan)
  } catch (e) { next(e) }
})

/**
 * They came back. Old debts can be restored as owed and retainers picked up
 * again in the same step: a picked-up retainer starts afresh today, never billing
 * the months they were away, and counts as reactivation MRR.
 */
router.post('/clients/:id/reactivate', async (req, res, next) => {
  try {
    const clientId = id(req.params.id)
    const body = parse(z.object({
      restoreInvoiceIds:    z.array(z.number().int()).optional(),
      reinstateRetainerIds: z.array(z.number().int()).optional(),
      /** When the picked-up retainers start billing again. Defaults to today. */
      startDate:            dateStr.optional(),
      /** A new price per picked-up retainer, by its id: they came back on different terms. */
      prices:               z.record(z.string(), money).optional(),
    }), req.body ?? {})
    const today = localToday()
    const start = body.startDate ?? today
    const row = db.transaction(tx => {
      // Notice taken back: their scheduled ends are lifted.
      const c = tx.select().from(businessClients).where(eq(businessClients.id, clientId)).get()
      logEvent(tx, clientId, 'back', c?.leavingOn ? 'Took their notice back and stayed'
        : `Came back${body.reinstateRetainerIds?.length ? `, billing again from ${start}` : ''}${body.restoreInvoiceIds?.length ? `, ${body.restoreInvoiceIds.length} old bill${body.restoreInvoiceIds.length === 1 ? '' : 's'} owed again` : ''}`)
      if (c?.leavingOn) {
        tx.update(businessRetainers).set({ endDate: null, cancelReason: null, updatedAt: new Date().toISOString() })
          .where(and(eq(businessRetainers.clientId, clientId), eq(businessRetainers.status, 'active'))).run()
      }
      for (const invoiceId of body.restoreInvoiceIds ?? []) {
        const inv = tx.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId)).get()
        if (inv?.clientId === clientId) restoreInvoice(tx, invoiceId)
      }
      // A NEW retainer on the same terms, starting today, rather than the old
      // one reopened: reopening would erase the months they were away, and
      // their churn with it. This way history shows them leaving and coming
      // back, which MRR counts as reactivation.
      for (const retainerId of body.reinstateRetainerIds ?? []) {
        const r = tx.select().from(businessRetainers).where(eq(businessRetainers.id, retainerId)).get()
        if (!r || r.clientId !== clientId || r.status !== 'cancelled') continue
        tx.insert(businessRetainers).values({
          clientId, serviceId: r.serviceId, name: r.name, amount: body.prices?.[String(r.id)] ?? r.amount, currency: r.currency,
          frequency: r.frequency, startDate: start, status: 'active',
          netTermDays: r.netTermDays, autoInvoice: 1, notes: r.notes,
          // Bills from the day they restart, never for the gap they were away for.
          lastGeneratedDate: null, nextInvoiceDate: start,
        }).run()
      }
      return tx.update(businessClients)
        .set({ status: 'active', churnedAt: null, churnReason: null, leavingOn: null })
        .where(eq(businessClients.id, clientId)).returning().get()
    })
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

/** Anything new for a client who had left means they are back. */
function reactivateIfChurned(tx: Tx, clientId: number): void {
  tx.update(businessClients).set({ status: 'active', churnedAt: null, churnReason: null })
    .where(and(eq(businessClients.id, clientId), eq(businessClients.status, 'churned'))).run()
}

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * The books as CSV, for the accountant or a spreadsheet: invoices, money
 * received, or costs (ad spend included, a row per campaign per month).
 */
router.get('/export', async (req, res, next) => {
  try {
    const q = parse(z.object({
      kind: z.enum(['invoices', 'payments', 'costs']),
      from: dateStr.optional(), to: dateStr.optional(),
    }), req.query)
    const d = await loadBusinessData()
    const inR = (date: string) => (!q.from || date >= q.from) && (!q.to || date <= q.to)
    const client = (cid: number | null) => d.clients.find(c => c.id === cid)
    const inv = (iid: number) => d.allInvoices.find(i => i.id === iid)
    let head: string[] = []
    let rows: (string | number | null)[][] = []

    if (q.kind === 'invoices') {
      head = ['Number', 'Client', 'Company', 'Issued', 'Due', 'For', 'Amount', 'Paid', 'Owed', 'Status', 'Paid on', 'Note']
      rows = d.allInvoices.filter(i => inR(i.issueDate)).sort((a, b) => a.issueDate.localeCompare(b.issueDate)).map(i => {
        const c = client(i.clientId)
        const paid = round2(d.applied.get(i.id) ?? 0)
        return [i.invoiceNumber, c?.name ?? '', c?.company ?? '', i.issueDate, i.dueDate,
          i.notes ?? i.milestoneLabel ?? '', i.amount, paid, i.status === 'void' ? 0 : owedOn(d, i),
          i.status, i.paidDate ?? '', i.voidReason ?? '']
      })
    } else if (q.kind === 'payments') {
      head = ['Date', 'Client', 'Invoice', 'Method', 'Gross', 'Fee', 'Refunded', 'Net']
      rows = d.receipts.filter(x => inR(x.date)).sort((a, b) => a.date.localeCompare(b.date)).map(x => [
        x.date, client(x.clientId)?.name ?? '', inv(x.invoiceId)?.invoiceNumber ?? '', x.method,
        x.gross, x.fee, x.refunded, round2(x.gross - x.fee - x.refunded)])
    } else {
      head = ['Date', 'What', 'Category', 'Client', 'Amount', 'Paid by']
      const owner = (oid: number | null) => d.owners.find(o => o.id === oid)?.name ?? ''
      rows = d.expenses.filter(e => e.category === 'Business' && inR(e.date)).map(e => [
        e.date, e.description, e.vendor ?? 'Cost', client(e.clientId)?.name ?? '', e.amount,
        e.paidByOwnerId ? `${owner(e.paidByOwnerId)}${e.reimbursedAt ? ` (paid back ${e.reimbursedAt})` : ' (not paid back)'}` : 'Business'])
      const ads = new Map<string, number>()
      for (const a of d.adSpendDaily) {
        const camp = d.campaigns.find(c => c.id === a.campaignId)
        if (!camp || camp.fundingSource !== 'business' || !inR(a.date)) continue
        const k = `${a.date.slice(0, 7)}|${camp.name}`
        ads.set(k, round2((ads.get(k) ?? 0) + a.spend))
      }
      for (const [k, v] of ads) {
        const [month, name] = k.split('|')
        rows.push([`${month}-01`, `${name} (ad spend for ${month})`, 'Advertising', '', v, 'Business'])
      }
      rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    }

    const cell = (v: string | number | null) => {
      const t = v == null ? '' : String(v)
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
    }
    const csv = [head, ...rows].map(r => r.map(cell).join(',')).join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="zavabuild-${q.kind}-${q.from ?? 'start'}-to-${q.to ?? localToday()}.csv"`)
    res.send(csv)
  } catch (e) { next(e) }
})

// ─── Services ─────────────────────────────────────────────────────────────────

router.get('/services', async (_req, res, next) => {
  try {
    res.json(await db.select().from(businessServices)
      .where(eq(businessServices.active, 1))
      .orderBy(businessServices.sortOrder))
  } catch (e) { next(e) }
})

/**
 * A new service, for something the business starts selling. Monthly ones
 * become retainers and count in MRR; one-off ones are billed in full, or in
 * stages like a website build when `milestones` is given.
 */
router.post('/services', async (req, res, next) => {
  try {
    const body = parse(z.object({
      name:          z.string().trim().min(1),
      kind:          z.enum(['one_off', 'recurring']),
      defaultAmount: money.nullish(),
      defaultFrequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).nullish(),
      milestones:    z.array(z.object({ label: z.string().min(1), pct: z.number().positive(), offsetDays: z.number().int().min(0).optional() })).nullish(),
      defaultTermDays: z.number().int().min(0).max(180).optional(),
    }), req.body)
    const taken = db.select().from(businessServices).all()
      .find(x => x.active && x.name.trim().toLowerCase() === body.name.toLowerCase())
    if (taken) return res.status(409).json({ error: `There is already a service called ${taken.name}` })
    if (body.milestones?.length && Math.round(body.milestones.reduce((t, m) => t + m.pct, 0)) !== 100) {
      return res.status(400).json({ error: 'The stages have to add up to 100%' })
    }
    const last = db.select().from(businessServices).all().reduce((m, x) => Math.max(m, x.sortOrder), 0)
    const row = db.insert(businessServices).values({
      name: body.name, kind: body.kind,
      defaultAmount: body.defaultAmount ?? null,
      defaultFrequency: body.kind === 'recurring' ? body.defaultFrequency ?? 'monthly' : null,
      milestones: body.kind === 'one_off' && body.milestones?.length ? body.milestones : null,
      defaultTermDays: body.defaultTermDays ?? 7,
      sortOrder: last + 1,
    }).returning().get()
    invalidate()
    res.status(201).json(row)
  } catch (e) { next(e) }
})

/** Rename a service, or change its usual price. Bills already raised keep theirs. */
router.put('/services/:id', async (req, res, next) => {
  try {
    const body = parse(z.object({ name: z.string().trim().min(1).optional(), defaultAmount: money.nullish() }), req.body)
    const serviceId = id(req.params.id)
    if (body.name) {
      const taken = db.select().from(businessServices).all()
        .find(x => x.id !== serviceId && x.active && x.name.trim().toLowerCase() === body.name!.toLowerCase())
      if (taken) return res.status(409).json({ error: `There is already a service called ${taken.name}` })
    }
    const row = db.update(businessServices).set(body).where(eq(businessServices.id, serviceId)).returning().get()
    if (!row) return res.status(404).json({ error: 'No such service' })
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

/**
 * Stop offering a service. One that was never used is deleted; one with
 * retainers, bills or websites behind it is retired instead: gone from New
 * work, but its name stays on everything already sold, so history still reads.
 */
router.delete('/services/:id', async (req, res, next) => {
  try {
    const serviceId = id(req.params.id)
    const used = db.select({ id: businessRetainers.id }).from(businessRetainers).where(eq(businessRetainers.serviceId, serviceId)).all().length
      + db.select({ id: businessInvoices.id }).from(businessInvoices).where(eq(businessInvoices.serviceId, serviceId)).all().length
      + db.select({ id: businessProjects.id }).from(businessProjects).where(eq(businessProjects.serviceId, serviceId)).all().length
    if (used) db.update(businessServices).set({ active: 0 }).where(eq(businessServices.id, serviceId)).run()
    else db.delete(businessServices).where(eq(businessServices.id, serviceId)).run()
    invalidate()
    res.json({ retired: used > 0 })
  } catch (e) { next(e) }
})

// ─── The composer: one form, one transaction ─────────────────────────────────

const dealSchema = z.object({
  clientId: z.number().int().optional(),
  client:   clientSchema.optional(),
  project:  z.object({
    name:        z.string().min(1),
    dueDate:     dateStr.nullish(),
    startDate:   dateStr.nullish(),
    description: z.string().nullish(),
    link:        z.string().nullish(),
  }).optional(),
  items: z.array(z.object({
    serviceId: z.number().int(),
    amount:    money,
    termDays:  z.number().int().min(0).max(180).optional(),
    startDate: dateStr.optional(),
  })).min(1),
  /** Milestone invoices start as drafts unless the first one is being sent now. */
  sendFirst: z.boolean().optional(),
  /**
   * A payment already taken for this work, raised as its own invoice before the
   * work was set up here. It becomes the first milestone instead of a second
   * deposit invoice being raised next to it, which is how one client ended up
   * with a paid deposit and an "overdue" one for the same money.
   */
  depositInvoiceId: z.number().int().optional(),
})

/**
 * Creates a client, a website project, its milestone invoices and any retainers
 * in one go.
 *
 * This is the whole reason the tab was rebuilt: the same outcome previously took
 * three tabs, three modals and a re-entry of the client and project for every
 * single milestone invoice.
 */
router.post('/deals', async (req, res, next) => {
  try {
    const body = parse(dealSchema, req.body)
    if (!body.clientId && !body.client) {
      return res.status(400).json({ error: 'Pick an existing client or give a name for a new one' })
    }

    const today = localToday()
    const services = await db.select().from(businessServices)
    const alloc = await createInvoiceNumberAllocator()

    const deposit = body.depositInvoiceId
      ? (await db.select().from(businessInvoices).where(eq(businessInvoices.id, body.depositInvoiceId)))[0]
      : null
    if (body.depositInvoiceId) {
      if (!deposit || deposit.clientId !== body.clientId || deposit.status !== 'paid' || deposit.projectId) {
        return res.status(400).json({ error: 'That payment cannot be used as the deposit: it must be a paid invoice of this client, not already on a website' })
      }
    }

    const created = {
      clientId: body.clientId ?? 0,
      projectId: null as number | null,
      invoiceIds: [] as number[],
      retainerIds: [] as number[],
    }

    db.transaction((tx) => {
      // 1. The client.
      if (!body.clientId) {
        const row = tx.insert(businessClients)
          .values({ ...body.client!, status: body.client!.status ?? 'active', wonDate: body.client!.wonDate ?? today })
          .returning().get()
        created.clientId = row.id
      } else {
        reactivateIfChurned(tx, created.clientId)
      }

      for (const item of body.items) {
        const svc = services.find(s => s.id === item.serviceId)
        if (!svc) throw Object.assign(new Error(`Unknown service ${item.serviceId}`), { status: 400 })
        const termDays = item.termDays ?? svc.defaultTermDays ?? 7
        const start = item.startDate ?? today

        if (svc.kind === 'recurring') {
          // 2. A retainer, plus the invoice for the period starting today.
          const r = tx.insert(businessRetainers).values({
            clientId:  created.clientId,
            serviceId: svc.id,
            name:      svc.name,
            amount:    item.amount,
            frequency: svc.defaultFrequency ?? 'monthly',
            startDate: start,
            status:    'active',
            netTermDays: termDays,
            autoInvoice: 1,
            lastGeneratedDate: start,
            nextInvoiceDate:   advance(start, svc.defaultFrequency ?? 'monthly'),
          }).returning().get()
          created.retainerIds.push(r.id)

          const inv = tx.insert(businessInvoices).values({
            clientId:      created.clientId,
            invoiceNumber: alloc.next(),
            amount:        item.amount,
            subtotal:      item.amount,
            status:        'unpaid',
            issueDate:     start,
            dueDate:       addDays(start, termDays),
            notes:         svc.name,
            retainerId:    r.id,
            serviceId:     svc.id,
            periodStart:   start,
            periodEnd:     advance(start, svc.defaultFrequency ?? 'monthly'),
            sentDate:      start,
          }).returning().get()
          created.invoiceIds.push(inv.id)
          continue
        }

        // 3. A one-off build: the project, then its milestone invoices.
        if (!created.projectId && body.project) {
          const p = tx.insert(businessProjects).values({
            clientId:    created.clientId,
            name:        body.project.name,
            description: body.project.description,
            link:        body.project.link,
            status:      'active',
            stage:       'discovery',
            serviceId:   svc.id,
            startDate:   body.project.startDate ?? today,
            dueDate:     body.project.dueDate,
            value:       item.amount,
          }).returning().get()
          created.projectId = p.id
        }

        // Drizzle already parses this column (mode: 'json').
        const milestones = svc.milestones?.length
          ? svc.milestones
          : [{ label: 'Full', pct: 100, offsetDays: 0 }]

        // Split so the parts sum to the total exactly: every part is rounded,
        // and the last one absorbs the remainder. 299.98 becomes
        // 149.99 + 75.00 + 74.99, not 149.99 + 75.00 + 75.00.
        //
        // With a deposit already paid, that invoice IS the first milestone, and
        // the rest of the price is split across the others in their proportions.
        let allocated = 0
        const useDeposit = !!deposit && milestones.length > 1
        const restPct = milestones.slice(1).reduce((t, m) => t + m.pct, 0) || 1
        milestones.forEach((m, idx) => {
          const isLast = idx === milestones.length - 1
          if (useDeposit && idx === 0) {
            tx.update(businessInvoices).set({
              projectId: created.projectId, milestoneLabel: m.label, serviceId: svc.id,
              notes: deposit!.notes ?? `${svc.name} - ${m.label}`,
            }).where(eq(businessInvoices.id, deposit!.id)).run()
            allocated = round2(deposit!.amount)
            created.invoiceIds.push(deposit!.id)
            return
          }
          const amount = isLast ? round2(item.amount - allocated)
            : useDeposit ? round2((item.amount - deposit!.amount) * (m.pct / restPct))
            : round2(item.amount * (m.pct / 100))
          allocated = round2(allocated + amount)
          const issueDate = addDays(start, m.offsetDays ?? 0)

          const inv = tx.insert(businessInvoices).values({
            clientId:       created.clientId,
            projectId:      created.projectId,
            invoiceNumber:  alloc.next(),
            amount,
            subtotal:       amount,
            // With a deposit already in, everything left waits as a draft.
            status:         idx === 0 && body.sendFirst ? 'unpaid' : 'draft',
            sentDate:       idx === 0 && body.sendFirst ? issueDate : null,
            issueDate,
            dueDate:        addDays(issueDate, termDays),
            notes:          `${svc.name} - ${m.label}`,
            serviceId:      svc.id,
            milestoneLabel: m.label,
          }).returning().get()
          created.invoiceIds.push(inv.id)
        })
      }
    })

    invalidate()
    res.status(201).json(created)
  } catch (e) { next(e) }
})

// ─── Projects ─────────────────────────────────────────────────────────────────

const projectSchema = z.object({
  clientId:       z.number().int().nullish(),
  name:           z.string().min(1),
  description:    z.string().nullish(),
  link:           z.string().nullish(),
  status:         z.enum(['active', 'completed', 'paused', 'cancelled']).optional(),
  stage:          z.enum(['discovery', 'design', 'build', 'review', 'launched']).optional(),
  serviceId:      z.number().int().nullish(),
  startDate:      dateStr.nullish(),
  dueDate:        dateStr.nullish(),
  launchedDate:   dateStr.nullish(),
  estimatedHours: z.number().nullish(),
  value:          z.number().nullish(),
})

router.get('/projects', async (req, res, next) => {
  try {
    const where = []
    if (req.query.clientId) where.push(eq(businessProjects.clientId, id(req.query.clientId as string)))
    if (req.query.status)   where.push(eq(businessProjects.status, req.query.status as string))
    if (req.query.stage)    where.push(eq(businessProjects.stage, req.query.stage as string))
    const q = db.select().from(businessProjects)
    res.json(await (where.length ? q.where(and(...where)) : q))
  } catch (e) { next(e) }
})

/** Live builds for the Overview cards, with billing progress and hours. */
router.get('/projects/active', async (_req, res, next) => {
  try {
    const d = await loadBusinessData()
    const today = localToday()
    res.json(d.projects
      .filter(p => p.stage !== 'launched' && p.status !== 'cancelled' && p.status !== 'completed')
      .map(p => {
        const invoices = d.invoices.filter(i => i.projectId === p.id)
        const billed = round2(invoices.filter(i => i.status !== 'draft').reduce((s, i) => s + i.amount, 0))
        return {
          id: p.id, name: p.name, clientId: p.clientId,
          clientName: d.clients.find(c => c.id === p.clientId)?.name ?? 'Unknown',
          stage: p.stage, status: p.status, value: p.value ?? 0, dueDate: p.dueDate,
          overdue: !!p.dueDate && p.dueDate < today,
          hours: round2(d.time.filter(t => t.projectId === p.id).reduce((s, t) => s + t.hours, 0)),
          billed,
          billedPct: p.value ? Math.min(Math.round((billed / p.value) * 100), 100) : 0,
          milestonesBilled: invoices.filter(i => i.milestoneLabel && i.status !== 'draft').length,
          milestonesTotal: invoices.filter(i => i.milestoneLabel).length || 3,
        }
      })
      .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')))
  } catch (e) { next(e) }
})

router.post('/projects', async (req, res, next) => {
  try {
    const row = (await db.insert(businessProjects).values(parse(projectSchema, req.body)).returning())[0]
    invalidate()
    res.status(201).json(row)
  } catch (e) { next(e) }
})
router.put('/projects/:id', async (req, res, next) => {
  try {
    const body = parse(projectSchema.partial(), req.body)
    const projectId = id(req.params.id)
    const row = db.transaction(tx => {
      const out = tx.update(businessProjects)
        .set({ ...body, updatedAt: new Date().toISOString() })
        .where(eq(businessProjects.id, projectId)).returning().get()
      // A website stopped part way: milestones never sent are not owed, so they
      // go. Ones already sent stay owed, since that work was done; they can be
      // written off from the invoice if not.
      if (body.status === 'cancelled') {
        const drafts = tx.select().from(businessInvoices).where(and(
          eq(businessInvoices.projectId, projectId), eq(businessInvoices.status, 'draft'))).all()
        for (const i of drafts) if (!allocationsFor(tx, i.id).length) voidInvoice(tx, i.id, 'Website cancelled before this stage', localToday())
      }
      return out
    })
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})
router.delete('/projects/:id', async (req, res, next) => {
  try {
    await db.delete(businessProjects).where(eq(businessProjects.id, id(req.params.id)))
    invalidate()
    res.status(204).send()
  } catch (e) { next(e) }
})

// ─── Project tasks ────────────────────────────────────────────────────────────

router.get('/projects/:id/tasks', async (req, res, next) => {
  try { res.json(await db.select().from(businessProjectTasks).where(eq(businessProjectTasks.projectId, id(req.params.id)))) } catch (e) { next(e) }
})
router.post('/projects/:id/tasks', async (req, res, next) => {
  try { res.status(201).json((await db.insert(businessProjectTasks).values({ ...req.body, projectId: id(req.params.id) }).returning())[0]) } catch (e) { next(e) }
})
router.put('/tasks/:id', async (req, res, next) => {
  try { res.json((await db.update(businessProjectTasks).set(req.body).where(eq(businessProjectTasks.id, id(req.params.id))).returning())[0]) } catch (e) { next(e) }
})
router.delete('/tasks/:id', async (req, res, next) => {
  try { await db.delete(businessProjectTasks).where(eq(businessProjectTasks.id, id(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

// ─── Retainers ────────────────────────────────────────────────────────────────

const retainerSchema = z.object({
  clientId:    z.number().int(),
  serviceId:   z.number().int().nullish(),
  name:        z.string().min(1),
  amount:      money,
  frequency:   z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  startDate:   dateStr,
  netTermDays: z.number().int().min(0).max(180).optional(),
  autoInvoice: z.union([z.literal(0), z.literal(1)]).optional(),
  notes:       z.string().nullish(),
})

router.get('/retainers', async (_req, res, next) => {
  try {
    const d = await loadBusinessData()
    res.json(d.retainers.map(r => ({
      ...r,
      clientName:  d.clients.find(c => c.id === r.clientId)?.name ?? 'Unknown',
      serviceName: d.services.find(s => s.id === r.serviceId)?.name ?? r.name,
    })))
  } catch (e) { next(e) }
})

router.post('/retainers', async (req, res, next) => {
  try {
    const body = parse(retainerSchema, req.body)
    const frequency = body.frequency ?? 'monthly'
    const row = db.transaction(tx => {
      reactivateIfChurned(tx, body.clientId)
      return tx.insert(businessRetainers).values({
        ...body, frequency, status: 'active',
        // The first invoice is for the start date itself. Marking the start as
        // already billed skipped every new retainer's first month.
        lastGeneratedDate: null,
        nextInvoiceDate:   body.startDate,
      }).returning().get()
    })
    invalidate()
    res.status(201).json(row)
  } catch (e) { next(e) }
})

/**
 * Edit everything about a retainer except its price, which has its own route
 * because a price has a history and the rest does not.
 *
 * Moving the next invoice date is how a month is skipped or shifted. The
 * generator will not re-issue a period that already has an invoice, void ones
 * included, so winding it back cannot double-bill.
 */
router.put('/retainers/:id', async (req, res, next) => {
  try {
    const body = parse(z.object({
      serviceId:       z.number().int().nullish(),
      name:            z.string().min(1).optional(),
      frequency:       z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
      startDate:       dateStr.optional(),
      netTermDays:     z.number().int().min(0).max(180).optional(),
      autoInvoice:     z.union([z.literal(0), z.literal(1)]).optional(),
      nextInvoiceDate: dateStr.nullish(),
      notes:           z.string().nullish(),
    }), req.body)
    const retainerId = id(req.params.id)
    const [current] = await db.select().from(businessRetainers).where(eq(businessRetainers.id, retainerId))
    if (!current) return res.status(404).json({ error: 'No such retainer' })

    const patch: Partial<typeof businessRetainers.$inferInsert> = { ...body, updatedAt: new Date().toISOString() }
    // A new cadence runs from the last period billed, not from the old schedule.
    if (body.frequency && body.frequency !== current.frequency && body.nextInvoiceDate === undefined) {
      patch.nextInvoiceDate = advance(current.lastGeneratedDate ?? current.startDate, body.frequency)
    }
    const row = (await db.update(businessRetainers).set(patch).where(eq(businessRetainers.id, retainerId)).returning())[0]
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

const priceSchema = z.object({
  newAmount:     money,
  effectiveDate: dateStr.optional(),
  correction:    z.boolean().optional(),
  reason:        z.string().nullish(),
  /**
   * A move to another service at the same time (Local SEO down to Hosting).
   * The invoices this re-prices take the new service too, so October reads
   * "Hosting £20" rather than "Local SEO £20".
   */
  serviceId:     z.number().int().nullish(),
  name:          z.string().min(1).optional(),
  dryRun:        z.boolean().optional(),
})

/**
 * Work out a price change, and return the plan plus the writes that make it.
 * Shared by the price route and the one-step "Change plan" route, so the two
 * can never disagree about what a change does.
 */
async function planPriceChange(retainerId: number, body: z.infer<typeof priceSchema>) {
  const today = localToday()
  const [current] = await db.select().from(businessRetainers).where(eq(businessRetainers.id, retainerId))
  if (!current) refuse(404, 'No such retainer')
  const changes = await db.select().from(businessRetainerChanges).where(eq(businessRetainerChanges.retainerId, retainerId))
  const invoices = await db.select().from(businessInvoices).where(eq(businessInvoices.retainerId, retainerId))

  // The period currently open: the latest one billed, if it is still unpaid,
  // else the next one.
  const latest = [...invoices].filter(i => i.status !== 'void' && i.periodStart)
    .sort((a, b) => b.periodStart!.localeCompare(a.periodStart!))[0]
  const defaultDate = latest && latest.status !== 'paid' ? latest.periodStart! : (current.nextInvoiceDate ?? today)

  let effectiveDate = body.effectiveDate ?? defaultDate
  if (effectiveDate > today && effectiveDate !== current.nextInvoiceDate) {
    refuse(400, 'Pick a date up to today, or the next invoice date. A price set further ahead would be billed early.')
  }
  // A change on or before the day it started is simply its starting price.
  const correction = !!body.correction || effectiveDate <= current.startDate
  const latestChange = [...changes].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.id - a.id)[0]
  if (correction) effectiveDate = latestChange?.effectiveDate ?? current.startDate

  const oldAmount = priceOn(current, changes, effectiveDate)
  const samePrice = round2(oldAmount) === round2(body.newAmount)
  const serviceMoves = body.serviceId !== undefined && body.serviceId !== current.serviceId
  if (!correction && samePrice && !serviceMoves) {
    refuse(400, 'That is already the price on that date')
  }

  const reprice = invoices.filter(i =>
    (i.status === 'unpaid' || i.status === 'draft')
    && (i.periodStart ?? i.issueDate) >= effectiveDate
    && (round2(i.amount) !== round2(body.newAmount) || (serviceMoves && i.serviceId !== body.serviceId)))

  const plan = {
    effectiveDate, correction, oldAmount, newAmount: body.newAmount,
    mrrDelta: correction ? 0 : round2(toMonthly(body.newAmount, current.frequency) - toMonthly(oldAmount, current.frequency)),
    repriced: reprice.map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, from: i.amount, to: body.newAmount, periodStart: i.periodStart })),
    untouchedPaid: invoices.filter(i => i.status === 'paid' && (i.periodStart ?? i.issueDate) >= effectiveDate)
      .map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, amount: i.amount })),
    /** Invoices for periods before the change, which keep their price and service. */
    earlier: invoices.filter(i => i.status !== 'void' && (i.periodStart ?? i.issueDate) < effectiveDate)
      .map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, amount: i.amount, periodStart: i.periodStart })),
    nextInvoiceDate: current.nextInvoiceDate,
  }

  const apply = (tx: Tx) => {
    if (correction) {
      if (latestChange) {
        tx.update(businessRetainerChanges).set({ newAmount: body.newAmount })
          .where(eq(businessRetainerChanges.id, latestChange.id)).run()
      }
    } else if (!samePrice) {
      // Anything logged for after this date is superseded by it.
      tx.delete(businessRetainerChanges).where(and(
        eq(businessRetainerChanges.retainerId, retainerId), gte(businessRetainerChanges.effectiveDate, effectiveDate))).run()
      tx.insert(businessRetainerChanges).values({
        retainerId, effectiveDate, oldAmount, newAmount: body.newAmount, reason: body.reason ?? null,
      }).run()
    }
    tx.update(businessRetainers).set({
      amount: body.newAmount, updatedAt: new Date().toISOString(),
      ...(serviceMoves ? { serviceId: body.serviceId } : {}),
      ...(body.name ? { name: body.name } : {}),
    }).where(eq(businessRetainers.id, retainerId)).run()
    for (const i of reprice) {
      tx.update(businessInvoices).set({
        amount: body.newAmount, subtotal: body.newAmount,
        ...(body.serviceId !== undefined ? { serviceId: body.serviceId } : {}),
        ...(body.name ? { notes: body.name } : {}),
      }).where(eq(businessInvoices.id, i.id)).run()
      // A part-paid invoice may now be fully covered, or no longer.
      if (allocationsFor(tx, i.id).length) recomputeInvoice(tx, i.id)
    }
  }
  return { plan, apply, current, invoices }
}

/**
 * Change what a retainer costs, and say from when.
 *
 * The date defaults to the start of the period currently open, because that is
 * what "the price changed" nearly always means: this month's invoice should be
 * the new price, not just next month's. Every unpaid or draft invoice for a
 * period from that date on is re-priced; paid ones are what was actually
 * collected and are never touched.
 *
 * A correction ("it was always this") logs no change, so it moves neither
 * expansion nor contraction; it only fixes the number.
 */
router.put('/retainers/:id/price', async (req, res, next) => {
  try {
    const body = parse(priceSchema, req.body)
    const { plan, apply, current } = await planPriceChange(id(req.params.id), body)
    if (body.dryRun) return res.json(plan)
    db.transaction(tx => {
      apply(tx)
      logEvent(tx, current.clientId, 'price', plan.correction
        ? `${current.name} price corrected to ${gbp(body.newAmount)}`
        : `${current.name} price ${gbp(plan.oldAmount)} to ${gbp(body.newAmount)} from ${plan.effectiveDate}`)
    })
    invalidate()
    res.json(plan)
  } catch (e) { next(e) }
})

/**
 * Change a plan in one step: new price, new service, or both, from this
 * month's invoice or from the next one, and what happens to this month's open
 * invoice if the change starts next month (kept as owed, or written off).
 *
 * This is the move that used to take three separate operations (cancel the
 * old retainer, void the unpaid month, set up a new retainer). The preview
 * comes back as one plain sentence, so what is about to happen is never in
 * doubt.
 */
router.post('/retainers/:id/change', async (req, res, next) => {
  try {
    const body = parse(z.object({
      newAmount:   money,
      serviceId:   z.number().int().nullish(),
      /** 'now': this month's open invoice changes too. 'next': from the next invoice. */
      from:        z.enum(['now', 'next']),
      /** Only for 'next': what happens to the open invoice before it. */
      openInvoice: z.enum(['keep', 'writeoff']).optional(),
      reason:      z.string().nullish(),
      dryRun:      z.boolean().optional(),
    }), req.body)
    const retainerId = id(req.params.id)
    const d = await loadBusinessData()
    const r = d.retainers.find(x => x.id === retainerId)
    if (!r) return res.status(404).json({ error: 'No such retainer' })
    const client = d.clients.find(c => c.id === r.clientId)
    const oldService = d.services.find(s => s.id === r.serviceId)?.name ?? r.name
    const serviceChanged = body.serviceId != null && body.serviceId !== r.serviceId
    const newService = serviceChanged ? d.services.find(s => s.id === body.serviceId)?.name ?? r.name : oldService

    const effectiveDate = body.from === 'next' ? (r.nextInvoiceDate ?? undefined) : undefined
    const { plan, apply, invoices } = await planPriceChange(retainerId, {
      newAmount: body.newAmount, effectiveDate, reason: body.reason ?? null,
      ...(serviceChanged ? { serviceId: body.serviceId, name: newService } : {}),
    })

    // Open invoices before the change starts: kept as owed, or written off.
    const leftOpen = invoices.filter(i => (i.status === 'unpaid' || i.status === 'draft')
      && (i.periodStart ?? i.issueDate) < plan.effectiveDate)
    const writeOff = body.from === 'next' && body.openInvoice === 'writeoff' ? leftOpen : []

    const per = r.frequency === 'monthly' ? 'mo' : r.frequency.replace(/ly$/, '')
    const fmt = (n: number) => `£${n.toFixed(2)}`
    const when = new Date(plan.effectiveDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const list = (xs: { invoiceNumber: string; amount: number }[]) => xs.map(i => `${i.invoiceNumber} (${fmt(i.amount)})`).join(', ')
    const sentence = [
      `From ${when}, ${client?.name ?? 'the client'} pays ${fmt(body.newAmount)}/${per} for ${newService}`
        + ` (was ${fmt(plan.oldAmount)}${serviceChanged ? ` for ${oldService}` : ''}).`,
      plan.repriced.length
        ? `${plan.repriced.map(i => i.invoiceNumber).join(', ')} becomes ${fmt(body.newAmount)}${serviceChanged ? ` ${newService}` : ''}.` : '',
      writeOff.length ? `${list(writeOff)} is written off; Mark paid still works if they pay it.`
        : leftOpen.length && body.from === 'next' ? `${list(leftOpen)} stays owed at the old price.` : '',
      plan.mrrDelta ? `MRR ${plan.mrrDelta > 0 ? 'rises' : 'falls'} by ${fmt(Math.abs(plan.mrrDelta))}/mo.` : '',
    ].filter(Boolean).join(' ')

    const preview = {
      ...plan, sentence,
      writtenOff: writeOff.map(i => i.invoiceNumber),
      leftOpen: leftOpen.map(i => ({ invoiceNumber: i.invoiceNumber, amount: i.amount })),
    }
    if (body.dryRun) return res.json(preview)

    const today = localToday()
    db.transaction(tx => {
      apply(tx)
      for (const i of writeOff) voidInvoice(tx, i.id, `Written off: plan changed to ${newService}`, today)
      logEvent(tx, r.clientId, 'plan', sentence)
    })
    invalidate()
    res.json(preview)
  } catch (e) { next(e) }
})

/**
 * Pause keeps the subscription but stops billing, from today. The open invoice
 * for the period being paused can be voided at the same time, which is what
 * otherwise sits in the queue looking like money owed.
 */
router.post('/retainers/:id/pause', async (req, res, next) => {
  try {
    const body = parse(z.object({ voidOpen: z.boolean().optional(), resumeOn: dateStr.nullish() }), req.body ?? {})
    const today = localToday()
    const retainerId = id(req.params.id)
    if (body.resumeOn && body.resumeOn <= today) return res.status(400).json({ error: 'The restart date has to be after today' })
    const row = db.transaction(tx => {
      if (body.voidOpen) {
        const open = tx.select().from(businessInvoices).where(and(
          eq(businessInvoices.retainerId, retainerId), inArray(businessInvoices.status, ['unpaid', 'draft']))).all()
        for (const i of open) if (!allocationsFor(tx, i.id).length) voidInvoice(tx, i.id, 'Retainer paused', today)
      }
      const row = tx.update(businessRetainers)
        .set({ status: 'paused', pausedAt: today, resumeOn: body.resumeOn ?? null, updatedAt: new Date().toISOString() })
        .where(eq(businessRetainers.id, retainerId)).returning().get()
      if (row) logEvent(tx, row.clientId, 'pause', `${row.name} paused${body.resumeOn ? `, restarting ${body.resumeOn}` : ''}`)
      return row
    })
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

router.post('/retainers/:id/resume', async (req, res, next) => {
  try {
    const body = parse(z.object({ date: dateStr.optional() }), req.body ?? {})
    const retainerId = id(req.params.id)
    const current = (await db.select().from(businessRetainers).where(eq(businessRetainers.id, retainerId)))[0]
    if (!current) return res.status(404).json({ error: 'No such retainer' })
    // Billing restarts from the day given, so a pause never back-bills the gap.
    const from = body.date ?? localToday()
    const row = (await db.update(businessRetainers)
      .set({
        status: 'active',
        pausedAt: null,
        resumeOn: null,
        lastGeneratedDate: from,
        nextInvoiceDate: from,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(businessRetainers.id, retainerId)).returning())[0]
    logEvent(db, current.clientId, 'resume', `${current.name} resumed, billing from ${from}`)
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

/**
 * Stop a retainer. The last day may be in the past, which is the usual case:
 * someone says in October that they stopped in September. Every open invoice
 * for a period from that day on is voided, since it bills time they were not a
 * client.
 *
 * A future day is notice, or a fixed-term contract: the retainer stays live and
 * keeps billing the periods that start before that day, then closes itself on
 * it. MRR drops on the day, not today.
 */
router.post('/retainers/:id/cancel', async (req, res, next) => {
  try {
    const body = parse(z.object({ endDate: dateStr.optional(), reason: z.string().nullish(), dryRun: z.boolean().optional() }), req.body)
    const today = localToday()
    const endDate = body.endDate ?? today
    const scheduled = endDate > today
    const retainerId = id(req.params.id)
    const [current] = await db.select().from(businessRetainers).where(eq(businessRetainers.id, retainerId))
    if (!current) return res.status(404).json({ error: 'No such retainer' })

    const open = await db.select().from(businessInvoices).where(and(
      eq(businessInvoices.retainerId, retainerId), inArray(businessInvoices.status, ['unpaid', 'draft'])))
    const voids = open.filter(i => (i.periodStart ?? i.issueDate) >= endDate)
    const plan = {
      endDate, scheduled,
      voided: voids.map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, amount: i.amount, periodStart: i.periodStart })),
      /** Notice: the bills still to come before the last day. */
      stillToBill: scheduled && current.status === 'active' ? invoicesBefore(current, endDate, db.select().from(businessRetainerChanges).all()) : [],
    }
    if (body.dryRun) return res.json(plan)

    db.transaction(tx => {
      for (const i of voids) voidInvoice(tx, i.id, 'Retainer ended before this period', today)
      tx.delete(businessRetainerChanges).where(and(
        eq(businessRetainerChanges.retainerId, retainerId), gte(businessRetainerChanges.effectiveDate, endDate))).run()
      logEvent(tx, current.clientId, 'cancel', scheduled
        ? `${current.name} set to end on ${endDate}${body.reason ? `: ${body.reason}` : ''}`
        : `${current.name} ended on ${endDate}${body.reason ? `: ${body.reason}` : ''}`)
      tx.update(businessRetainers).set(scheduled && current.status === 'active'
        ? { endDate, cancelReason: body.reason ?? null, updatedAt: new Date().toISOString() }
        : {
          status: 'cancelled', endDate,
          cancelReason: body.reason ?? null,
          cancelledAt: today,
          autoInvoice: 0,
          updatedAt: new Date().toISOString(),
        }).where(eq(businessRetainers.id, retainerId)).run()
    })
    invalidate()
    res.json(plan)
  } catch (e) { next(e) }
})

/** Undo a cancel made by mistake. Billing picks up from the next unbilled period. */
router.post('/retainers/:id/reinstate', async (req, res, next) => {
  try {
    const retainerId = id(req.params.id)
    const [current] = await db.select().from(businessRetainers).where(eq(businessRetainers.id, retainerId))
    if (!current) return res.status(404).json({ error: 'No such retainer' })
    const row = db.transaction(tx => {
      reactivateIfChurned(tx, current.clientId)
      logEvent(tx, current.clientId, 'reinstate', `${current.name} reinstated`)
      return tx.update(businessRetainers).set({
        status: 'active', endDate: null, cancelledAt: null, cancelReason: null, autoInvoice: 1,
        updatedAt: new Date().toISOString(),
      }).where(eq(businessRetainers.id, retainerId)).returning().get()
    })
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

/** Only for one set up by mistake. Once it has billed, deleting it would erase its churn. */
router.delete('/retainers/:id', async (req, res, next) => {
  try {
    const retainerId = id(req.params.id)
    const [n] = await db.select({ n: sql<number>`count(*)` }).from(businessInvoices)
      .where(and(eq(businessInvoices.retainerId, retainerId), ne(businessInvoices.status, 'void')))
    if ((n?.n ?? 0) > 0) {
      return res.status(409).json({ error: 'This retainer has invoices. Cancel it instead, so its history stays in MRR.' })
    }
    db.transaction(tx => {
      tx.delete(businessInvoices).where(eq(businessInvoices.retainerId, retainerId)).run()
      tx.delete(businessRetainerChanges).where(eq(businessRetainerChanges.retainerId, retainerId)).run()
      tx.delete(businessRetainers).where(eq(businessRetainers.id, retainerId)).run()
    })
    invalidate()
    res.status(204).send()
  } catch (e) { next(e) }
})

/**
 * Move a retainer to the client it really belongs to.
 *
 * For the slip of picking the wrong one of two clients with the same name.
 * Everything the retainer brought with it goes too, so nothing is left behind
 * on the wrong client: its invoices, the Stripe payments that settled them,
 * failed charges on the same subscription, and the Stripe customer id that was
 * learned from those payments. Without the last one, the next renewal would be
 * matched straight back to the wrong client.
 *
 * Refused when a payment also settled an invoice that is not moving, because
 * then the payment belongs to both clients and there is no single right answer.
 */
router.post('/retainers/:id/move', async (req, res, next) => {
  try {
    const body = parse(z.object({
      clientId: z.number().int(),
      /** Remove the target's own copy of this plan, which this one replaces. */
      replaceIds: z.array(z.number().int()).optional(),
      dryRun:   z.boolean().optional(),
    }), req.body)
    const retainerId = id(req.params.id)
    const [retainer] = await db.select().from(businessRetainers).where(eq(businessRetainers.id, retainerId))
    if (!retainer) return res.status(404).json({ error: 'No such retainer' })
    if (retainer.clientId === body.clientId) return res.status(400).json({ error: 'It is already on that client' })
    const [from] = await db.select().from(businessClients).where(eq(businessClients.id, retainer.clientId))
    const [to] = await db.select().from(businessClients).where(eq(businessClients.id, body.clientId))
    if (!to) return res.status(404).json({ error: 'No such client' })

    const invoices = await db.select().from(businessInvoices).where(eq(businessInvoices.retainerId, retainerId))
    const invoiceIds = invoices.map(i => i.id)
    const allocations = invoiceIds.length
      ? await db.select().from(businessPaymentAllocations).where(inArray(businessPaymentAllocations.invoiceId, invoiceIds))
      : []
    const paymentIds = [...new Set(allocations.map(a => a.paymentId).filter((p): p is number => p != null))]
    const payments = paymentIds.length
      ? await db.select().from(stripePayments).where(inArray(stripePayments.id, paymentIds))
      : []

    if (paymentIds.length) {
      const elsewhere = await db.select().from(businessPaymentAllocations).where(and(
        inArray(businessPaymentAllocations.paymentId, paymentIds),
        notInArray(businessPaymentAllocations.invoiceId, invoiceIds),
      ))
      if (elsewhere.length) {
        return res.status(409).json({
          error: 'A payment on this retainer also paid another of their invoices. Unassign that payment first, then move the retainer.',
        })
      }
    }

    // The customer id goes with the payments, unless the old client still has
    // other payments of its own from that customer.
    const customerIds = [...new Set(payments.map(p => p.stripeCustomerId).filter((c): c is string => !!c))]
    const keptByOld = new Set<string>()
    for (const cid of customerIds) {
      const [other] = await db.select({ id: stripePayments.id }).from(stripePayments).where(and(
        eq(stripePayments.stripeCustomerId, cid),
        eq(stripePayments.matchedClientId, retainer.clientId),
        notInArray(stripePayments.id, paymentIds),
      )).limit(1)
      if (other) keptByOld.add(cid)
    }
    const movingCustomers = customerIds.filter(c => !keptByOld.has(c))
    const subscriptions = [...new Set(payments.map(p => p.subscriptionId).filter((s): s is string => !!s))]

    // The usual way this mistake happens: the payment went on the wrong client,
    // so the right one was given the same plan by hand. Moving the real one
    // across would leave them with two, billing twice. Each look-alike is
    // listed, and can go in the same step when it never took any money.
    const lookAlikes = (await db.select().from(businessRetainers).where(and(
      eq(businessRetainers.clientId, to.id), ne(businessRetainers.status, 'cancelled'),
    ))).filter(r => r.frequency === retainer.frequency
      && (round2(r.amount) === round2(retainer.amount) || (r.serviceId != null && r.serviceId === retainer.serviceId)))
    const duplicates = []
    for (const r of lookAlikes) {
      const theirs = await db.select().from(businessInvoices).where(eq(businessInvoices.retainerId, r.id))
      const live = theirs.filter(i => i.status !== 'void')
      const withMoney = live.length
        ? await db.select({ id: businessPaymentAllocations.id }).from(businessPaymentAllocations)
          .where(inArray(businessPaymentAllocations.invoiceId, live.map(i => i.id))).limit(1)
        : []
      duplicates.push({
        id: r.id, name: r.name, amount: r.amount, frequency: r.frequency, startDate: r.startDate,
        invoices: live.map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, amount: i.amount, status: i.status })),
        /** Only one that never collected anything can be removed: anything else is real history. */
        removable: withMoney.length === 0 && live.every(i => i.status !== 'paid'),
      })
    }
    const replace = duplicates.filter(d => body.replaceIds?.includes(d.id))
    if (replace.some(d => !d.removable)) {
      return res.status(409).json({ error: 'That retainer has money on it, so it cannot be removed here. Cancel it instead.' })
    }

    const plan = {
      retainer: { id: retainer.id, name: retainer.name },
      from: { id: retainer.clientId, name: from?.name ?? 'Unknown' },
      to:   { id: to.id, name: to.name },
      invoices: invoices.map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, amount: i.amount, status: i.status })),
      payments: payments.map(p => ({ id: p.id, amount: p.amountGross, paidDate: p.paidDate, payerName: p.payerName })),
      movesStripeCustomer: movingCustomers.length > 0,
      duplicates,
    }
    if (body.dryRun) return res.json(plan)

    db.transaction(tx => {
      reactivateIfChurned(tx, to.id)
      for (const d of replace) {
        tx.delete(businessInvoices).where(eq(businessInvoices.retainerId, d.id)).run()
        tx.delete(businessRetainerChanges).where(eq(businessRetainerChanges.retainerId, d.id)).run()
        tx.delete(businessRetainers).where(eq(businessRetainers.id, d.id)).run()
        logEvent(tx, to.id, 'moved', `${d.name} set up by hand removed: replaced by the one moved in`
          + (d.invoices.length ? ` (${d.invoices.map(i => i.invoiceNumber).join(', ')} removed)` : ''), { retainerId: d.id })
      }
      tx.update(businessRetainers).set({ clientId: to.id, updatedAt: new Date().toISOString() })
        .where(eq(businessRetainers.id, retainerId)).run()
      if (invoiceIds.length) {
        tx.update(businessInvoices).set({ clientId: to.id }).where(inArray(businessInvoices.id, invoiceIds)).run()
      }
      if (paymentIds.length) {
        tx.update(stripePayments).set({ matchedClientId: to.id }).where(inArray(stripePayments.id, paymentIds)).run()
      }
      if (subscriptions.length) {
        tx.update(stripeFailedCharges).set({ clientId: to.id }).where(and(
          inArray(stripeFailedCharges.subscriptionId, subscriptions), eq(stripeFailedCharges.clientId, retainer.clientId))).run()
      }
      for (const cid of movingCustomers) learnCustomerTx(tx, to.id, cid)
      const summary = `${retainer.name} moved from ${plan.from.name} to ${to.name}`
      logEvent(tx, retainer.clientId, 'moved', summary, { retainerId, toClientId: to.id })
      logEvent(tx, to.id, 'moved', summary, { retainerId, fromClientId: retainer.clientId })
    })
    invalidate()
    res.json(plan)
  } catch (e) { next(e) }
})

// ─── Invoices ─────────────────────────────────────────────────────────────────

const invoiceSchema = z.object({
  clientId:      z.number().int(),
  projectId:     z.number().int().nullish(),
  retainerId:    z.number().int().nullish(),
  serviceId:     z.number().int().nullish(),
  invoiceNumber: z.string().min(1).optional(),
  amount:        money,
  subtotal:      z.number().nullish(),
  status:        z.enum(['draft', 'unpaid', 'paid']).optional(),
  issueDate:     dateStr.optional(),
  dueDate:       dateStr.optional(),
  paidDate:      dateStr.nullish(),
  sentDate:      dateStr.nullish(),
  feeAmount:     z.number().nonnegative().optional(),
  refundedAmount: z.number().nonnegative().optional(),
  milestoneLabel: z.string().nullish(),
  notes:         z.string().nullish(),
})

router.get('/invoices', async (req, res, next) => {
  try {
    await generateRetainerInvoices()
    const { from, to, status, clientId, type, q, limit, offset } = req.query

    const where = []
    if (from)     where.push(gte(businessInvoices.issueDate, from as string))
    if (to)       where.push(lte(businessInvoices.issueDate, to as string))
    if (clientId) where.push(eq(businessInvoices.clientId, id(clientId as string)))
    if (status) {
      const list = (status as string).split(',').filter(Boolean)
      if (list.length) where.push(inArray(businessInvoices.status, list))
    }
    if (type === 'retainer') where.push(sql`${businessInvoices.retainerId} is not null`)
    if (type === 'website')  where.push(sql`${businessInvoices.milestoneLabel} is not null`)
    if (type === 'oneoff')   where.push(sql`${businessInvoices.retainerId} is null and ${businessInvoices.milestoneLabel} is null`)
    if (q) {
      const term = `%${q}%`
      where.push(or(like(businessInvoices.invoiceNumber, term), like(businessInvoices.notes, term))!)
    }

    let query = db.select().from(businessInvoices).orderBy(desc(businessInvoices.issueDate), desc(businessInvoices.id)) as any
    if (where.length) query = query.where(and(...where))
    if (limit)  query = query.limit(id(limit as string))
    if (offset) query = query.offset(id(offset as string))

    res.json(await query)
  } catch (e) { next(e) }
})

/** The ledger view: rows already carrying the client and service names. */
router.get('/invoices/ledger', async (req, res, next) => {
  try {
    await generateRetainerInvoices()
    const d = await loadBusinessData()
    const today = localToday()
    const { from, to } = req.query

    // Void invoices are listed (dimmed) so the numbering has no holes, but no
    // total below counts them.
    const rows = d.allInvoices
      .filter(i => (!from || i.issueDate >= (from as string)) && (!to || i.issueDate <= (to as string)))
      .map(i => {
        const retainer = i.retainerId ? d.retainers.find(r => r.id === i.retainerId) : null
        const service  = d.services.find(s => s.id === (i.serviceId ?? retainer?.serviceId))
        const kind = i.retainerId ? 'retainer' : i.milestoneLabel ? 'website' : 'oneoff'
        const what = i.retainerId
          ? `${service?.name ?? retainer?.name ?? 'Retainer'} - retainer`
          : i.milestoneLabel
            ? `${service?.name ?? 'Website'} - ${i.milestoneLabel.toLowerCase()}`
            : service?.name ?? (i.notes ?? 'One-off')
        const applied = round2(d.applied.get(i.id) ?? 0)
        const isVoid = i.status === 'void'
        return {
          id: i.id, invoiceNumber: i.invoiceNumber, clientId: i.clientId,
          clientName: d.clients.find(c => c.id === i.clientId)?.name ?? 'Unknown',
          projectId: i.projectId, retainerId: i.retainerId, kind, what,
          gross: round2(i.amount),
          fee: isVoid ? 0 : i.feeAmount ?? 0,
          // Net is what has arrived, so a part-paid invoice shows its instalments.
          net: !isVoid && applied > 0 ? round2(applied - (i.feeAmount ?? 0) - (i.refundedAmount ?? 0)) : null,
          applied,
          owed: isVoid ? 0 : owedOn(d, i),
          // `overdue` and `part-paid` are never written to the database; they are
          // simply what an unpaid invoice past its due date, or with money on
          // it, IS.
          status: i.status === 'unpaid' && i.dueDate < today ? 'overdue'
            : i.status === 'unpaid' && applied > 0 ? 'part-paid'
            : i.status,
          partPaid: i.status === 'unpaid' && applied > 0,
          issueDate: i.issueDate, dueDate: i.dueDate, paidDate: i.paidDate,
          notes: i.notes, voidReason: i.voidReason, sentDate: i.sentDate,
          /** On hold: not chased until this date. */
          heldUntil: !isVoid && i.status !== 'paid' && i.chaseAfter && i.chaseAfter > today ? i.chaseAfter : null,
          holdReason: i.holdReason,
        }
      })
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.id - a.id)

    const live = rows.filter(r => r.status !== 'void')
    res.json({
      rows,
      totals: {
        count:       live.length,
        voidCount:   rows.length - live.length,
        /** Bills that were owed and let go. Not counted as billed anywhere. */
        writtenOff:  round2(rows.filter(r => r.status === 'void' && /written off/i.test(r.voidReason ?? '')).reduce((s, r) => s + r.gross, 0)),
        writtenOffCount: rows.filter(r => r.status === 'void' && /written off/i.test(r.voidReason ?? '')).length,
        onHold:      round2(live.filter(r => r.heldUntil).reduce((s, r) => s + r.owed, 0)),
        billed:      round2(live.reduce((s, r) => s + r.gross, 0)),
        collected:   round2(live.reduce((s, r) => s + (r.net ?? 0), 0)),
        fees:        round2(live.reduce((s, r) => s + r.fee, 0)),
        outstanding: round2(live.filter(r => ['unpaid', 'overdue', 'part-paid'].includes(r.status)).reduce((s, r) => s + r.owed, 0)),
        overdue:     round2(live.filter(r => r.status === 'overdue').reduce((s, r) => s + r.owed, 0)),
        paidCount:   rows.filter(r => r.status === 'paid').length,
        avgDaysToPay: (() => {
          const paid = rows.filter(r => r.status === 'paid' && r.paidDate)
          if (!paid.length) return null
          // Paid before it was raised (a deposit taken on the day, invoiced after)
          // is paid at once, not in negative days.
          const days = paid.map(r => Math.max(0, Math.round((Date.parse(r.paidDate!) - Date.parse(r.issueDate)) / 86_400_000)))
          return round2(days.reduce((a, b) => a + b, 0) / days.length)
        })(),
      },
    })
  } catch (e) { next(e) }
})

router.post('/invoices', async (req, res, next) => {
  try {
    const body = parse(invoiceSchema, req.body)
    const issueDate = body.issueDate ?? localToday()
    const invoiceNumber = body.invoiceNumber ?? await nextInvoiceNumber()
    const row = db.transaction(tx => {
      reactivateIfChurned(tx, body.clientId)
      const { feeAmount, paidDate, ...rest } = body
      const created = tx.insert(businessInvoices).values({
        ...rest,
        invoiceNumber,
        subtotal:      body.subtotal ?? body.amount,
        issueDate,
        dueDate:       body.dueDate ?? addDays(issueDate, 7),
        // Paid is recorded as money below, not as a flag.
        status:        body.status === 'paid' ? 'unpaid' : body.status ?? 'unpaid',
        sentDate:      body.status === 'draft' ? null : body.sentDate ?? issueDate,
      }).returning().get()
      if (body.status === 'paid') {
        recordManualPayment(tx, created.id, { date: paidDate ?? issueDate, fee: feeAmount ?? 0 })
      }
      return tx.select().from(businessInvoices).where(eq(businessInvoices.id, created.id)).get()
    })
    invalidate()
    res.status(201).json(row)
  } catch (e) { next(e) }
})

/**
 * Record money received against an invoice: all of what is left, or part of it.
 *
 * The amount and the fee are separate questions. "A different amount landed"
 * used to book the whole shortfall as a processing fee, so a client who paid
 * half looked like a client who paid in full with a ruinous card fee.
 */
router.post('/invoices/:id/pay', async (req, res, next) => {
  try {
    const body = parse(z.object({
      paidDate:    dateStr.optional(),
      amount:      z.number().positive().optional(),
      feeAmount:   z.number().nonnegative().optional(),
      method:      z.enum(['bank', 'cash', 'stripe']).optional(),
      note:        z.string().nullish(),
    }), req.body ?? {})
    const invoiceId = id(req.params.id)
    db.transaction(tx => {
      // A debt voided when the client left, now being paid: the same invoice
      // comes back and is paid, under its own number. Nothing new is raised.
      const inv = tx.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId)).get()
      if (inv?.status === 'void') restoreInvoice(tx, invoiceId)
      recordManualPayment(tx, invoiceId, {
        amount: body.amount, date: body.paidDate ?? localToday(),
        fee: body.feeAmount, method: body.method, note: body.note,
      })
    })
    invalidate()
    res.json((await db.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId)))[0])
  } catch (e) { next(e) }
})

/** Remove every payment from an invoice. Stripe payments go back to the queue. */
router.post('/invoices/:id/unpay', async (req, res, next) => {
  try {
    const invoiceId = id(req.params.id)
    db.transaction(tx => unpayInvoice(tx, invoiceId))
    invalidate()
    res.json((await db.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId)))[0])
  } catch (e) { next(e) }
})

router.delete('/allocations/:id', async (req, res, next) => {
  try {
    db.transaction(tx => removeAllocation(tx, id(req.params.id)))
    invalidate()
    res.status(204).send()
  } catch (e) { next(e) }
})

router.post('/invoices/:id/send', async (req, res, next) => {
  try {
    const invoiceId = id(req.params.id)
    const [current] = await db.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId))
    if (!current) return res.status(404).json({ error: 'No such invoice' })
    if (current.status !== 'draft') return res.status(409).json({ error: `${current.invoiceNumber} is not a draft` })
    const row = (await db.update(businessInvoices)
      .set({ status: 'unpaid', sentDate: localToday() })
      .where(eq(businessInvoices.id, invoiceId)).returning())[0]
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

/** Cancel an invoice and keep it: the number stays used and nothing counts it. */
router.post('/invoices/:id/void', async (req, res, next) => {
  try {
    const body = parse(z.object({ reason: z.string().nullish() }), req.body ?? {})
    const invoiceId = id(req.params.id)
    db.transaction(tx => {
      voidInvoice(tx, invoiceId, body.reason ?? null, localToday())
      const v = tx.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId)).get()
      if (v) logEvent(tx, v.clientId, 'void', `${v.invoiceNumber} (${gbp(v.amount)}) voided${body.reason ? `: ${body.reason}` : ''}`)
    })
    invalidate()
    res.json((await db.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId)))[0])
  } catch (e) { next(e) }
})

router.post('/invoices/:id/restore', async (req, res, next) => {
  try {
    const invoiceId = id(req.params.id)
    db.transaction(tx => {
      restoreInvoice(tx, invoiceId)
      const v = tx.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId)).get()
      if (v) logEvent(tx, v.clientId, 'restore', `${v.invoiceNumber} (${gbp(v.amount)}) owed again`)
    })
    invalidate()
    res.json((await db.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId)))[0])
  } catch (e) { next(e) }
})

/** The same action on several invoices at once, all or nothing. */
router.post('/invoices/bulk', async (req, res, next) => {
  try {
    const body = parse(z.object({
      ids:      z.array(z.number().int()).min(1),
      action:   z.enum(['pay', 'send', 'void']),
      paidDate: dateStr.optional(),
      reason:   z.string().nullish(),
    }), req.body)
    const today = localToday()
    const done = db.transaction(tx => {
      let n = 0
      for (const invoiceId of body.ids) {
        const inv = tx.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId)).get()
        if (!inv || inv.status === 'void') continue
        if (body.action === 'void') { voidInvoice(tx, invoiceId, body.reason ?? null, today); n++ }
        else if (body.action === 'send' && inv.status === 'draft') {
          tx.update(businessInvoices).set({ status: 'unpaid', sentDate: today }).where(eq(businessInvoices.id, invoiceId)).run(); n++
        } else if (body.action === 'pay' && inv.status !== 'paid' && remainingOn(tx, inv) > 0) {
          recordManualPayment(tx, invoiceId, { date: body.paidDate ?? today }); n++
        }
      }
      return n
    })
    invalidate()
    res.json({ done })
  } catch (e) { next(e) }
})

/**
 * One invoice as stored, with the money on it and what undoing that money
 * would also touch, so the edit form can say it before anything happens.
 */
router.get('/invoices/:id', async (req, res, next) => {
  try {
    const invoiceId = id(req.params.id)
    const [row] = await db.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId))
    if (!row) return res.status(404).json({ error: 'No such invoice' })
    const allocations = allocationsFor(db, invoiceId)
    const payments = allocations.some(a => a.paymentId)
      ? await db.select().from(stripePayments).where(inArray(stripePayments.id, allocations.filter(a => a.paymentId).map(a => a.paymentId!)))
      : []
    res.json({
      ...row,
      applied: round2(allocations.reduce((s, a) => s + a.amount, 0)),
      // For a void invoice this is what it would be owed if it were paid off,
      // which is what "Mark paid" on a debt from a client who left needs.
      owed: remainingOn(db, row),
      allocations: allocations.map(a => {
        const p = payments.find(x => x.id === a.paymentId)
        return { ...a, payerName: p?.payerName ?? null, stripeId: p?.stripeId ?? null }
      }),
      knockOn: knockOn(db, [invoiceId]),
    })
  } catch (e) { next(e) }
})

/**
 * Edit what an invoice says. Whether it is paid is not a field here: money in
 * goes through /pay, money out through /unpay, cancelling through /void, so a
 * stray save on the form can never mark something paid with nothing behind it,
 * or leave a Stripe payment attached to an invoice that says unpaid.
 */
router.put('/invoices/:id', async (req, res, next) => {
  try {
    const body = parse(invoiceSchema.partial(), req.body)
    const invoiceId = id(req.params.id)
    const [current] = await db.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId))
    if (!current) return res.status(404).json({ error: 'No such invoice' })
    if (current.status === 'void') return res.status(409).json({ error: `${current.invoiceNumber} is void. Restore it to edit it.` })

    const { status, paidDate, feeAmount, refundedAmount, excess, ...fields } = { ...body, excess: excessChoice.parse(req.body?.excess) }
    // Subtotal is written equal to the amount everywhere else; an edit to the
    // amount that left it behind would have the two disagree.
    if (fields.amount != null && fields.subtotal === undefined) fields.subtotal = fields.amount

    // Lowering an invoice below what was paid leaves money over. It either
    // goes toward their next bills (paying ahead if none is open yet) or was
    // given back. Asking beats refusing: "it cannot be less than that" was a
    // dead end for a client who overpaid.
    const appliedNow = round2(allocationsFor(db, invoiceId).reduce((s, a) => s + a.amount, 0))
    const over = fields.amount != null ? round2(appliedNow - fields.amount) : 0
    if (over > 0.005 && !excess) {
      return res.status(409).json({
        error: `${over.toFixed(2)} more than that has already been paid. Choose whether it goes toward their next bill or was given back.`,
        excess: over,
      })
    }
    let creditPlan: ReturnType<typeof planCredit> | null = null
    let numbers: string[] = []
    if (over > 0.005 && excess === 'credit') {
      creditPlan = planCredit(current.clientId, over, [invoiceId])
      if (creditPlan.left > 0.005) {
        return res.status(409).json({ error: `They have nothing open or coming up to put ${over.toFixed(2)} toward. Record it as given back instead.` })
      }
      const alloc = await createInvoiceNumberAllocator()
      numbers = creditPlan.ahead.map(() => alloc.next())
    }

    db.transaction(tx => {
      if (Object.keys(fields).length) tx.update(businessInvoices).set(fields).where(eq(businessInvoices.id, invoiceId)).run()
      if (over > 0.005 && excess === 'refund') refundFrom(tx, invoiceId, over)
      if (over > 0.005 && excess === 'credit' && creditPlan) {
        const ahead = creditPlan.ahead.map((a, i) => issueAhead(tx, a.retainerId, a.periodStart, numbers[i], localToday()).id)
        moveMoney(tx, invoiceId, over, [...creditPlan.open.map(x => x.inv.id), ...ahead])
      }

      // Only draft <-> unpaid is a plain status change.
      if (status === 'draft' || status === 'unpaid') {
        const now = tx.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId)).get()!
        if (now.status === 'paid' && status === 'unpaid') unpayInvoice(tx, invoiceId)
        else if (now.status !== 'paid') {
          tx.update(businessInvoices).set({
            status, sentDate: status === 'unpaid' ? now.sentDate ?? localToday() : now.sentDate,
          }).where(eq(businessInvoices.id, invoiceId)).run()
        }
      } else if (status === 'paid' && current.status !== 'paid') {
        recordManualPayment(tx, invoiceId, { date: paidDate ?? localToday(), fee: feeAmount ?? 0 })
      } else if (status === 'paid' && feeAmount != null) {
        // Correcting the fee on a hand-recorded payment.
        const manual = allocationsFor(tx, invoiceId).filter(a => !a.paymentId)
        if (manual.length === 1) {
          tx.update(businessPaymentAllocations).set({ fee: round2(feeAmount), ...(paidDate ? { date: paidDate } : {}) })
            .where(eq(businessPaymentAllocations.id, manual[0].id)).run()
        }
      }
      recomputeInvoice(tx, invoiceId)
    })
    invalidate()
    res.json((await db.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId)))[0])
  } catch (e) { next(e) }
})

const excessChoice = z.enum(['credit', 'refund']).optional()

/**
 * Where money a client has over could go: their open invoices first, oldest
 * first, then the next periods of their retainers, paid ahead.
 */
function planCredit(clientId: number, amount: number, except: number[] = []) {
  const open = openInvoicesOf(db, clientId, except)
  let left = round2(amount)
  for (const x of open) left = round2(left - Math.min(x.owed, left))
  const retainers = db.select().from(businessRetainers).where(eq(businessRetainers.clientId, clientId)).all()
  const { periods, left: after } = planAhead(retainers, left, 12, db.select().from(businessRetainerChanges).all())
  return { open, ahead: periods, left: after }
}

/**
 * Record money as given back, latest bank or cash money first. A Stripe payment
 * is refunded in Stripe, and the refund arrives with the next sync.
 */
function refundFrom(tx: Tx, invoiceId: number, amount: number) {
  let left = round2(amount)
  const manual = allocationsFor(tx, invoiceId).filter(a => !a.paymentId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  for (const a of manual) {
    if (left <= 0.005) break
    const r = round2(Math.min(a.amount - a.refunded, left))
    if (r <= 0) continue
    tx.update(businessPaymentAllocations).set({ refunded: round2(a.refunded + r) }).where(eq(businessPaymentAllocations.id, a.id)).run()
    left = round2(left - r)
  }
  if (left > 0.005) refuse(409, `${left.toFixed(2)} of that came by card. Refund it in Stripe and it will arrive with the next sync.`)
  recomputeInvoice(tx, invoiceId)
}

/**
 * Accept what has been paid as payment in full: a discount, a first month
 * free, or a short payment let go. The invoice is lowered to what arrived and
 * the original price kept as its subtotal, so the discount stays visible.
 */
router.post('/invoices/:id/settle', async (req, res, next) => {
  try {
    const body = parse(z.object({ reason: z.string().nullish() }), req.body ?? {})
    const invoiceId = id(req.params.id)
    const inv = db.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId)).get()
    if (!inv) return res.status(404).json({ error: 'No such invoice' })
    const applied = round2(allocationsFor(db, invoiceId).reduce((s, a) => s + a.amount, 0))
    if (inv.status !== 'unpaid' || applied <= 0) {
      return res.status(409).json({ error: 'Only an invoice with part of it paid can be settled for what arrived. To let all of it go, write it off.' })
    }
    const discount = round2(inv.amount - applied)
    const note = `Accepted ${applied.toFixed(2)} as payment in full (${discount.toFixed(2)} off)${body.reason ? `: ${body.reason}` : ''}`
    db.transaction(tx => {
      tx.update(businessInvoices).set({
        amount: applied, subtotal: inv.subtotal ?? inv.amount,
        notes: inv.notes ? `${inv.notes}. ${note}` : note,
      }).where(eq(businessInvoices.id, invoiceId)).run()
      logEvent(tx, inv.clientId, 'settled', `${inv.invoiceNumber}: ${note}`)
      recomputeInvoice(tx, invoiceId)
    })
    invalidate()
    res.json({ discount, note })
  } catch (e) { next(e) }
})

/**
 * On hold: a client disputing a bill, or one agreed to wait. It stays owed and
 * in every total, but out of "Chase" until the date. No date clears the hold.
 */
router.post('/invoices/:id/hold', async (req, res, next) => {
  try {
    const body = parse(z.object({ until: dateStr.nullish(), reason: z.string().nullish() }), req.body ?? {})
    const row = db.update(businessInvoices).set({ chaseAfter: body.until ?? null, holdReason: body.until ? body.reason ?? null : null })
      .where(eq(businessInvoices.id, id(req.params.id))).returning().get()
    if (row) logEvent(db, row.clientId, 'hold', body.until ? `${row.invoiceNumber} on hold until ${body.until}${body.reason ? `: ${body.reason}` : ''}` : `${row.invoiceNumber} taken off hold`)
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

/** Give back part or all of a bank or cash payment. */
router.post('/allocations/:id/refund', async (req, res, next) => {
  try {
    const body = parse(z.object({ amount: money.positive() }), req.body)
    const a = db.select().from(businessPaymentAllocations).where(eq(businessPaymentAllocations.id, id(req.params.id))).get()
    if (!a) return res.status(404).json({ error: 'No such payment record' })
    if (a.paymentId) return res.status(409).json({ error: 'That came by card. Refund it in Stripe and it will arrive with the next sync.' })
    if (body.amount > round2(a.amount - a.refunded) + 0.005) {
      return res.status(409).json({ error: `Only ${round2(a.amount - a.refunded).toFixed(2)} of that payment is left to give back` })
    }
    db.transaction(tx => {
      tx.update(businessPaymentAllocations).set({ refunded: round2(a.refunded + body.amount) })
        .where(eq(businessPaymentAllocations.id, a.id)).run()
      recomputeInvoice(tx, a.invoiceId)
      const v = tx.select().from(businessInvoices).where(eq(businessInvoices.id, a.invoiceId)).get()
      if (v) logEvent(tx, v.clientId, 'refund', `${gbp(body.amount)} given back on ${v.invoiceNumber}`)
    })
    invalidate()
    res.json({ ok: true })
  } catch (e) { next(e) }
})

/**
 * A bank or cash payment recorded against the wrong client: it moves to the
 * right one, onto their open bills oldest first, and anything over becomes a
 * paid invoice for them, as recording it fresh would.
 */
router.post('/allocations/:id/move', async (req, res, next) => {
  try {
    const body = parse(z.object({ clientId: z.number().int(), dryRun: z.boolean().optional() }), req.body)
    const a = db.select().from(businessPaymentAllocations).where(eq(businessPaymentAllocations.id, id(req.params.id))).get()
    if (!a) return res.status(404).json({ error: 'No such payment record' })
    if (a.paymentId) return res.status(409).json({ error: 'That came by card. Use Change on the payment to give it to someone else.' })
    const open = openInvoicesOf(db, body.clientId, [a.invoiceId])
    let left = round2(a.amount)
    const splits = open.map(x => { const amt = round2(Math.min(x.owed, left)); left = round2(left - amt); return { invoiceId: x.inv.id, invoiceNumber: x.inv.invoiceNumber, amount: amt } })
      .filter(x => x.amount > 0.005)
    const plan = { splits, leftOver: left }
    if (body.dryRun) return res.json(plan)
    const rest = left > 0.005 ? await nextInvoiceNumber() : null
    db.transaction(tx => {
      tx.delete(businessPaymentAllocations).where(eq(businessPaymentAllocations.id, a.id)).run()
      recomputeInvoice(tx, a.invoiceId)
      const from = tx.select().from(businessInvoices).where(eq(businessInvoices.id, a.invoiceId)).get()
      const to = tx.select().from(businessClients).where(eq(businessClients.id, body.clientId)).get()
      if (from) logEvent(tx, from.clientId, 'moved', `${gbp(a.amount)} payment of ${a.date} moved to ${to?.name ?? 'another client'}`)
      logEvent(tx, body.clientId, 'moved', `${gbp(a.amount)} payment of ${a.date} moved here from another client`)
      const all = [...splits]
      if (rest) {
        reactivateIfChurned(tx, body.clientId)
        const inv = tx.insert(businessInvoices).values({
          clientId: body.clientId, invoiceNumber: rest, amount: left, subtotal: left, status: 'unpaid',
          issueDate: a.date, dueDate: a.date, sentDate: a.date, notes: 'Payment received',
        }).returning().get()
        all.push({ invoiceId: inv.id, invoiceNumber: rest, amount: left })
      }
      all.forEach((sp, i) => recordManualPayment(tx, sp.invoiceId, {
        amount: sp.amount, date: a.date, method: a.method as 'bank' | 'cash', fee: i === 0 ? a.fee : 0, note: a.note,
      }))
    })
    invalidate()
    res.json(plan)
  } catch (e) { next(e) }
})

/** Only a draft or a void invoice with no money on it: anything sent is voided instead. */
router.delete('/invoices/:id', async (req, res, next) => {
  try {
    const invoiceId = id(req.params.id)
    const [current] = await db.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId))
    if (!current) return res.status(204).send()
    if (!['draft', 'void'].includes(current.status) || allocationsFor(db, invoiceId).length) {
      return res.status(409).json({ error: `${current.invoiceNumber} has been sent. Void it instead, so the number stays accounted for.` })
    }
    db.transaction(tx => {
      tx.update(stripePayments).set({ matchedInvoiceId: null }).where(eq(stripePayments.matchedInvoiceId, invoiceId)).run()
      tx.delete(businessInvoices).where(eq(businessInvoices.id, invoiceId)).run()
    })
    invalidate()
    res.status(204).send()
  } catch (e) { next(e) }
})

/** Say how an invoice was paid, for the clients who transfer rather than card. */
router.put('/invoices/:id/method', async (req, res, next) => {
  try {
    const body = parse(z.object({ method: z.enum(['stripe', 'bank', 'cash']).nullable() }), req.body)
    const invoiceId = id(req.params.id)
    db.transaction(tx => {
      if (body.method) {
        tx.update(businessPaymentAllocations).set({ method: body.method })
          .where(and(eq(businessPaymentAllocations.invoiceId, invoiceId), sql`${businessPaymentAllocations.paymentId} is null`)).run()
      }
      tx.update(businessInvoices).set({ paymentMethod: body.method }).where(eq(businessInvoices.id, invoiceId)).run()
    })
    invalidate()
    res.json((await db.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId)))[0])
  } catch (e) { next(e) }
})

// ─── Owner's pay ──────────────────────────────────────────────────────────────

router.get('/owners', async (_req, res, next) => {
  try { res.json(await db.select().from(businessOwners).orderBy(businessOwners.sortOrder)) } catch (e) { next(e) }
})

router.put('/owners/:id', async (req, res, next) => {
  try {
    const body = parse(z.object({
      name:     z.string().min(1).optional(),
      sharePct: z.number().min(0).max(100).optional(),
      active:   z.union([z.literal(0), z.literal(1)]).optional(),
    }), req.body)
    const row = (await db.update(businessOwners).set(body).where(eq(businessOwners.id, id(req.params.id))).returning())[0]
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

router.get('/owner-draws', async (req, res, next) => {
  try {
    const d = await loadBusinessData()
    res.json(ownerPay(
      d,
      { from: req.query.from as string | undefined, to: req.query.to as string | undefined },
      ownerPayOptions(req.query),
    ))
  } catch (e) { next(e) }
})

/**
 * Record a draw, and optionally post the other half of the same transfer to the
 * personal Finances ledger so the money shows up on both sides exactly once.
 */
router.post('/owner-draws', async (req, res, next) => {
  try {
    const body = parse(z.object({
      ownerId:      z.number().int(),
      amount:       money.positive(),
      date:         dateStr.optional(),
      method:       z.string().nullish(),
      notes:        z.string().nullish(),
      postToFinances: z.boolean().optional(),
    }), req.body)

    const owner = (await db.select().from(businessOwners).where(eq(businessOwners.id, body.ownerId)))[0]
    if (!owner) return res.status(404).json({ error: 'No such owner' })

    const date = body.date ?? localToday()
    let financeIncomeId: number | null = null

    if (body.postToFinances) {
      // Category 'Owner Pay' keeps it out of the Finances "business income"
      // bucket, which already counts paid invoices. Counting both would be the
      // same money twice.
      const income = (await db.insert(financeIncome).values({
        source:    `Zavabuild draw - ${owner.name}`,
        amount:    body.amount,
        frequency: 'one-time',
        category:  'Owner Pay',
        date,
        notes:     body.notes ?? null,
      }).returning())[0]
      financeIncomeId = income.id
    }

    const row = (await db.insert(businessOwnerDraws).values({
      ownerId: body.ownerId,
      amount:  body.amount,
      date,
      method:  body.method ?? 'transfer',
      notes:   body.notes ?? null,
      financeIncomeId,
    }).returning())[0]

    invalidate()
    res.status(201).json(row)
  } catch (e) { next(e) }
})

router.delete('/owner-draws/:id', async (req, res, next) => {
  try {
    const drawId = id(req.params.id)
    const current = (await db.select().from(businessOwnerDraws).where(eq(businessOwnerDraws.id, drawId)))[0]
    if (current?.financeIncomeId) {
      await db.delete(financeIncome).where(eq(financeIncome.id, current.financeIncomeId))
    }
    await db.delete(businessOwnerDraws).where(eq(businessOwnerDraws.id, drawId))
    invalidate()
    res.status(204).send()
  } catch (e) { next(e) }
})


// ─── Daily ad spend ───────────────────────────────────────────────────────────

/** Which platforms are wired up, so the UI can say so rather than guess. */
router.get('/ad-spend/status', async (_req, res, next) => {
  try {
    const platforms = configuredPlatforms()
    const [row] = await db
      .select({
        days:   sql<number>`count(*)`,
        total:  sql<number>`coalesce(sum(${marketingSpendDaily.spend}), 0)`,
        latest: sql<string>`max(${marketingSpendDaily.date})`,
      })
      .from(marketingSpendDaily)
    res.json({
      platforms,
      connected: platforms.length > 0,
      meta: metaConfigured(),
      recordedDays: row?.days ?? 0,
      recordedTotal: round2(row?.total ?? 0),
      latestDate: row?.latest ?? null,
    })
  } catch (e) { next(e) }
})

/** Daily rows for one campaign, newest first. */
router.get('/campaigns/:id/spend', async (req, res, next) => {
  try {
    res.json(await db.select().from(marketingSpendDaily)
      .where(eq(marketingSpendDaily.campaignId, id(req.params.id)))
      .orderBy(desc(marketingSpendDaily.date)))
  } catch (e) { next(e) }
})

/**
 * Record a day of spend by hand.
 *
 * This is the path that always works, whether or not an API is connected, and
 * the one the app had no equivalent of at all: previously the only way to log
 * ad spend was to overwrite a campaign's lifetime total.
 */
router.post('/campaigns/:id/spend', async (req, res, next) => {
  try {
    const body = parse(z.object({
      date:        dateStr.optional(),
      spend:       money,
      impressions: z.number().int().nonnegative().optional(),
      clicks:      z.number().int().nonnegative().optional(),
      leads:       z.number().int().nonnegative().optional(),
    }), req.body)

    const campaignId = id(req.params.id)
    const date = body.date ?? localToday()

    // One row per campaign per day: entering the same day twice corrects it
    // rather than adding to it, which is what would silently double spend.
    const row = (await db.insert(marketingSpendDaily)
      .values({
        campaignId, date, spend: body.spend,
        impressions: body.impressions ?? null,
        clicks: body.clicks ?? null,
        leads: body.leads ?? null,
        source: 'manual',
      })
      .onConflictDoUpdate({
        target: [marketingSpendDaily.campaignId, marketingSpendDaily.date],
        set: {
          spend: body.spend,
          impressions: body.impressions ?? null,
          clicks: body.clicks ?? null,
          leads: body.leads ?? null,
          source: 'manual',
        },
      })
      .returning())[0]

    await recomputeCampaignSpend(campaignId)
    invalidate()
    res.status(201).json(row)
  } catch (e) { next(e) }
})

/**
 * Several days at once: a run of days at the same amount each, a total spread
 * evenly across them, or nothing at all because the ads were off.
 *
 * Days already recorded are kept unless `overwrite` is set. A total is spread
 * over the days actually written, so the days kept do not swallow part of it,
 * and the last day takes the rounding so the parts sum to the total exactly.
 */
router.post('/campaigns/:id/spend/range', async (req, res, next) => {
  try {
    const body = parse(z.object({
      from:      dateStr,
      to:        dateStr,
      perDay:    money.optional(),
      total:     money.optional(),
      overwrite: z.boolean().optional(),
      dryRun:    z.boolean().optional(),
    }), req.body)
    if (body.to < body.from) return res.status(400).json({ error: 'The last day is before the first' })
    if (body.to > localToday()) return res.status(400).json({ error: 'Spend can only be recorded up to today' })
    if (body.perDay == null && body.total == null) return res.status(400).json({ error: 'Give an amount per day or a total' })

    const campaignId = id(req.params.id)
    const existing = await db.select().from(marketingSpendDaily).where(and(
      eq(marketingSpendDaily.campaignId, campaignId),
      gte(marketingSpendDaily.date, body.from), lte(marketingSpendDaily.date, body.to)))
    const recorded = new Map(existing.map(r => [r.date, r]))

    const days: string[] = []
    for (let d = body.from; d <= body.to; d = addDays(d, 1)) days.push(d)
    if (days.length > 400) return res.status(400).json({ error: 'That is more than a year of days' })
    const write = days.filter(d => body.overwrite || !recorded.has(d))

    const amounts = new Map<string, number>()
    if (body.total != null) {
      const each = write.length ? round2(body.total / write.length) : 0
      let left = body.total
      write.forEach((d, i) => {
        const v = i === write.length - 1 ? round2(left) : each
        left = round2(left - v)
        amounts.set(d, v)
      })
    } else {
      for (const d of write) amounts.set(d, round2(body.perDay!))
    }

    const plan = {
      days: days.length,
      writing: write.length,
      kept: days.length - write.length,
      replaced: write.filter(d => recorded.has(d)).length,
      total: round2([...amounts.values()].reduce((s, v) => s + v, 0)),
    }
    if (body.dryRun) return res.json(plan)

    db.transaction(tx => {
      for (const [date, spend] of amounts) {
        tx.insert(marketingSpendDaily)
          .values({ campaignId, date, spend, source: 'manual' })
          .onConflictDoUpdate({
            target: [marketingSpendDaily.campaignId, marketingSpendDaily.date],
            set: { spend, source: 'manual', impressions: null, clicks: null, leads: null },
          }).run()
      }
    })
    await recomputeCampaignSpend(campaignId)
    invalidate()
    res.status(201).json(plan)
  } catch (e) { next(e) }
})

router.delete('/ad-spend/:id', async (req, res, next) => {
  try {
    const rowId = id(req.params.id)
    const [row] = await db.select().from(marketingSpendDaily).where(eq(marketingSpendDaily.id, rowId))
    await db.delete(marketingSpendDaily).where(eq(marketingSpendDaily.id, rowId))
    if (row) await recomputeCampaignSpend(row.campaignId)
    invalidate()
    res.status(204).send()
  } catch (e) { next(e) }
})

/** Pull the trailing window now, rather than waiting for the daily run. */
router.post('/ad-spend/sync', async (req, res, next) => {
  try {
    if (!configuredPlatforms().length) {
      return res.status(400).json({
        error: 'No ad platform is connected. Set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID in server/.env, then restart the server.',
      })
    }
    const lookback = req.body?.lookbackDays ? Number(req.body.lookbackDays) : 14
    const results = await syncAdSpend(lookback)
    invalidate()
    res.json({ results })
  } catch (e) { next(e) }
})


// ─── Stripe payments ──────────────────────────────────────────────────────────

router.get('/payments/status', async (_req, res, next) => {
  try {
    const [row] = await db.select({
      total:    sql<number>`count(*)`,
      // Same definition as unassignedPayments(), or the badge disagrees with the list.
      unmatched: sql<number>`sum(case when ${stripePayments.matchedAt} is null and ${stripePayments.ignored} = 0 then 1 else 0 end)`,
      fees:     sql<number>`coalesce(sum(${stripePayments.fee}), 0)`,
      latest:   sql<string>`max(${stripePayments.paidDate})`,
    }).from(stripePayments)

    const [learned] = await db.select({ n: sql<number>`count(*)` })
      .from(businessClients).where(sql`${businessClients.stripeCustomerId} is not null`)

    res.json({
      connected: stripeConfigured(),
      note: stripeStatusNote(),
      payments: row?.total ?? 0,
      unmatched: row?.unmatched ?? 0,
      feesPaid: round2(row?.fees ?? 0),
      latestDate: row?.latest ?? null,
      clientsLinked: learned?.n ?? 0,
    })
  } catch (e) { next(e) }
})

/**
 * What each invoice can still take, for the pickers: invoices Stripe money
 * already covers in full are taken, and a part-paid one is offered with what is
 * left on it. The payment being edited does not count against its own invoices,
 * or reassigning it would hide the very invoices it is on.
 */
function pickerState(forPaymentId?: number) {
  const own = forPaymentId ? allocationsOfPayment(db, forPaymentId) : []
  const { owed, taken } = stripeCoverage()
  for (const a of own) {
    owed.set(a.invoiceId, round2((owed.get(a.invoiceId) ?? 0) + a.amount))
    taken.delete(a.invoiceId)
  }
  return { owed, taken, own }
}

/** Everything waiting on a decision, with the app's best guess attached. */
router.get('/payments/unassigned', async (_req, res, next) => {
  try {
    const rows = await unassignedPayments()
    const clients = await db.select().from(businessClients)
    const { owed, taken } = pickerState()

    res.json({
      payments: rows.map(p => ({
        ...p,
        // With the company, because two clients can share a name ("Sam" and
        // "Sam") and the suggestion has to say which one it means.
        suggestedClientName: (() => {
          const c = p.matchedClientId ? clients.find(x => x.id === p.matchedClientId) : null
          return c ? (c.company ? `${c.name} (${c.company})` : c.name) : null
        })(),
      })),
      /** Invoices Stripe money already covers in full. */
      takenInvoiceIds: [...taken],
      /** What every invoice can still take. */
      owed: Object.fromEntries(owed),
    })
  } catch (e) { next(e) }
})

/**
 * Every payment that came in, and what it settled: Stripe payments, decided or
 * not, plus every bank or cash payment recorded against an invoice. This is the
 * one place a decision about money can be seen and changed afterwards.
 */
router.get('/payments', async (req, res, next) => {
  try {
    const d = await loadBusinessData()
    const allocs = await db.select().from(businessPaymentAllocations)
    const inv = new Map(d.allInvoices.map(i => [i.id, i]))
    const clientName = (cid: number | null) => d.clients.find(c => c.id === cid)?.name ?? null
    const settled = (rows: typeof allocs) => rows.map(a => ({
      allocationId: a.id, invoiceId: a.invoiceId, amount: a.amount,
      invoiceNumber: inv.get(a.invoiceId)?.invoiceNumber ?? '?',
      invoiceAmount: inv.get(a.invoiceId)?.amount ?? 0,
      milestoneLabel: inv.get(a.invoiceId)?.milestoneLabel ?? null,
    }))

    const stripe = d.payments.map(p => {
      const mine = allocs.filter(a => a.paymentId === p.id)
      const applied = round2(mine.reduce((s, a) => s + a.amount, 0))
      const raised = d.allInvoices.some(i => i.raisedFromPaymentId === p.id && i.status !== 'void')
      return {
        key: `s-${p.id}`, source: 'stripe' as const, paymentId: p.id,
        date: p.paidDate, payer: p.payerName || p.payerEmail || null,
        clientId: p.matchedClientId, clientName: clientName(p.matchedClientId),
        gross: p.amountGross, fee: p.fee, net: round2(p.amountGross - p.fee - p.refunded), refunded: p.refunded,
        settled: settled(mine), applied, unallocated: round2(p.amountGross - applied),
        how: p.ignored ? 'not income' : !p.matchedAt ? 'to assign'
          : raised ? 'raised' : /by hand|Moved/i.test(p.matchReason ?? '') ? 'by hand' : 'auto',
        reason: p.matchReason, subscription: !!p.subscriptionId,
      }
    })

    const manual = allocs.filter(a => !a.paymentId).map(a => {
      const i = inv.get(a.invoiceId)
      return {
        key: `m-${a.id}`, source: a.method as 'bank' | 'cash' | 'stripe', paymentId: null, allocationId: a.id,
        date: a.date, payer: null, clientId: i?.clientId ?? null, clientName: clientName(i?.clientId ?? null),
        gross: a.amount, fee: a.fee, net: round2(a.amount - a.fee - a.refunded), refunded: a.refunded,
        settled: settled([a]), applied: a.amount, unallocated: 0,
        how: 'recorded', reason: a.note, subscription: false,
      }
    })

    const limit = req.query.limit ? id(req.query.limit as string) : 500
    res.json([...stripe, ...manual]
      .sort((a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key))
      .slice(0, limit))
  } catch (e) { next(e) }
})

router.post('/payments/sync', async (req, res, next) => {
  try {
    if (!stripeConfigured()) {
      return res.status(400).json({
        error: 'No Stripe key set. Put STRIPE_SECRET_KEY in server/.env and restart the server.',
      })
    }
    const lookback = req.body?.lookbackDays ? Number(req.body.lookbackDays) : 45
    const result = await syncStripePayments(lookback)
    invalidate()
    res.json(result)
  } catch (e) { next(e) }
})

/**
 * For the allocator: the client's invoices with what each can still take, and
 * the set of them that adds up to this payment exactly, if there is one.
 */
router.get('/payments/:id/options', async (req, res, next) => {
  try {
    const paymentId = id(req.params.id)
    const clientId = id(req.query.clientId as string)
    const [payment] = await db.select().from(stripePayments).where(eq(stripePayments.id, paymentId))
    if (!payment) return res.status(404).json({ error: 'No such payment' })
    const { owed, taken, own } = pickerState(paymentId)

    const invoices = (await db.select().from(businessInvoices).where(eq(businessInvoices.clientId, clientId)))
      .filter(i => i.status !== 'void' && !taken.has(i.id))
      .map(i => ({
        id: i.id, invoiceNumber: i.invoiceNumber, amount: i.amount, status: i.status,
        issueDate: i.issueDate, notes: i.notes, milestoneLabel: i.milestoneLabel,
        owed: owed.get(i.id) ?? i.amount,
        current: round2(own.filter(a => a.invoiceId === i.id).reduce((s, a) => s + a.amount, 0)),
        raisedHere: i.raisedFromPaymentId === paymentId,
      }))
      .filter(i => i.owed > 0.005 || i.current > 0 || i.status === 'paid')
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate))

    // Unlike the auto-matcher, drafts count here and every exact fit is
    // offered: a person is choosing, so the job is to show the options.
    const open = invoices.filter(i => (i.status === 'unpaid' || i.status === 'draft') && !i.raisedHere)
    const singles = open.filter(i => Math.abs(i.owed - payment.amountGross) < 0.006).map(i => [i.id])
    const sets = subsetsFor(payment.amountGross, open.map(i => ({ id: i.id, issueDate: i.issueDate, remaining: i.owed })))
    // Near misses by pennies, which is what milestone rounding produces.
    const near = open.filter(i => Math.abs(i.owed - payment.amountGross) >= 0.006 && Math.abs(i.owed - payment.amountGross) <= 1)
      .map(i => ({ invoiceId: i.id, gap: round2(payment.amountGross - i.owed) }))
    res.json({
      invoices,
      suggestions: [...singles, ...sets].slice(0, 4),
      near,
      openCount: open.length,
    })
  } catch (e) { next(e) }
})

/**
 * Assign a payment, or change where an assigned one went, and learn from it.
 *
 * A payment already decided is released and re-applied in one transaction,
 * which is what makes a wrong match fixable after the fact; before, the only
 * way out was a database edit. Invoices kept in the new selection are not
 * disturbed on the way, so an invoice raised from this payment that is picked
 * again is not voided.
 *
 * The learning is the point of the rest: tying the Stripe customer to the
 * client means the next payment from them is certain no matter what name they
 * type.
 */
router.post('/payments/:id/assign', async (req, res, next) => {
  try {
    const body = parse(z.object({
      clientId:  z.number().int(),
      /** Explicit amounts per invoice; less than an invoice owes leaves it part-paid. */
      allocations: z.array(z.object({ invoiceId: z.number().int(), amount: z.number().positive() })).optional(),
      /** Or just the invoices, split oldest first. */
      invoiceIds: z.array(z.number().int()).optional(),
      invoiceId:  z.number().int().nullish(),
      /** Restate the last invoice by a small gap so it matches what Stripe took. */
      adjustToMatch: z.boolean().optional(),
      /** Off when this payment happens to be from a shared card. */
      remember:  z.boolean().optional(),
    }), req.body)

    const paymentId = id(req.params.id)
    const [payment] = await db.select().from(stripePayments).where(eq(stripePayments.id, paymentId))
    if (!payment) return res.status(404).json({ error: 'No such payment' })

    const ids = body.allocations?.map(a => a.invoiceId)
      ?? (body.invoiceIds?.length ? body.invoiceIds : body.invoiceId ? [body.invoiceId] : [])

    db.transaction(tx => {
      if (payment.ignored) tx.update(stripePayments).set({ ignored: 0 }).where(eq(stripePayments.id, paymentId)).run()
      releasePayment(tx, paymentId, ids)

      if (ids.length && body.adjustToMatch) {
        const chosen = tx.select().from(businessInvoices).where(inArray(businessInvoices.id, ids)).all()
        const owedNow = chosen.reduce((s, i) => s + remainingOn(tx, i), 0)
        const gap = round2(payment.amountGross - owedNow)
        const last = [...chosen].sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.id - a.id)[0]
        if (gap !== 0 && Math.abs(gap) <= 1 && last) {
          tx.update(businessInvoices).set({ amount: round2(last.amount + gap), subtotal: round2(last.amount + gap) })
            .where(eq(businessInvoices.id, last.id)).run()
          // A milestone is a share of the website's price, so the price moves
          // with it, or the pennies would read as work never billed.
          if (last.milestoneLabel && last.projectId) {
            const proj = tx.select().from(businessProjects).where(eq(businessProjects.id, last.projectId)).get()
            if (proj?.value != null) {
              tx.update(businessProjects).set({ value: round2(proj.value + gap) }).where(eq(businessProjects.id, proj.id)).run()
            }
          }
        }
      }
      if (!body.allocations) restateForSubscription(tx, paymentId, ids)

      const splits = body.allocations ?? defaultSplits(tx, payment.amountGross, ids)
      applyPayment(tx, paymentId, splits, {
        clientId: body.clientId,
        reason: ids.length > 1 ? `Assigned by hand, covering ${ids.length} invoices`
          : ids.length ? 'Assigned by hand' : 'Assigned to the client by hand, no invoice',
      })
      if ((body.remember ?? true) && payment.stripeCustomerId) learnCustomerTx(tx, body.clientId, payment.stripeCustomerId)
    })

    invalidate()
    res.json({ ok: true, learned: (body.remember ?? true) && !!payment.stripeCustomerId })
  } catch (e) { next(e) }
})

/** Detach a payment from everything and put it back in the queue. */
router.post('/payments/:id/release', async (req, res, next) => {
  try {
    db.transaction(tx => releasePayment(tx, id(req.params.id)))
    invalidate()
    res.json({ ok: true })
  } catch (e) { next(e) }
})

/**
 * Raise an invoice from a payment that has nothing to attach to.
 *
 * Assigning a payment to a client alone recorded who paid and stopped there,
 * which left real money off the books: every figure on this tab is built from
 * money applied to invoices, so a payment with no invoice behind it is invisible
 * to gross volume, to fees and to profit. A new client who pays before anything
 * has been raised hits that every time, which is exactly when it matters most.
 *
 * The invoice is created already paid, because the money is already in. Gross,
 * fee and the date all come from the payment, so the books agree with Stripe to
 * the penny rather than being retyped.
 */
router.post('/payments/:id/invoice', async (req, res, next) => {
  try {
    const body = parse(z.object({
      clientId:    z.number().int().optional(),
      description: z.string().nullish(),
      serviceId:   z.number().int().nullish(),
      projectId:   z.number().int().nullish(),
    }), req.body)

    const paymentId = id(req.params.id)
    const [payment] = await db.select().from(stripePayments).where(eq(stripePayments.id, paymentId))
    if (!payment) return res.status(404).json({ error: 'No such payment' })

    const clientId = body.clientId ?? payment.matchedClientId
    if (!clientId) return res.status(400).json({ error: 'Assign the payment to a client first' })
    const invoiceNumber = await nextInvoiceNumber()

    const invoice = db.transaction(tx => {
      releasePayment(tx, paymentId)
      reactivateIfChurned(tx, clientId)
      const created = tx.insert(businessInvoices).values({
        invoiceNumber,
        clientId,
        serviceId:      body.serviceId ?? null,
        projectId:      body.projectId ?? null,
        amount:         payment.amountGross,
        subtotal:       payment.amountGross,
        status:         'unpaid',
        issueDate:      payment.paidDate,
        dueDate:        payment.paidDate,
        sentDate:       payment.paidDate,
        notes:          body.description ?? payment.description ?? 'Raised from a Stripe payment',
        raisedFromPaymentId: paymentId,
      }).returning().get()
      applyPayment(tx, paymentId, [{ invoiceId: created.id, amount: payment.amountGross }], {
        clientId, reason: `Invoice ${created.invoiceNumber} raised from this payment`,
      })
      if (payment.stripeCustomerId) learnCustomerTx(tx, clientId, payment.stripeCustomerId)
      return tx.select().from(businessInvoices).where(eq(businessInvoices.id, created.id)).get()
    })

    invalidate()
    res.status(201).json(invoice)
  } catch (e) { next(e) }
})

/**
 * Set a subscription payment up as a retainer, in one step.
 *
 * Stripe already knows everything this needs. The invoice behind the charge
 * carries the price per cycle, the length of the cycle and what the client is
 * buying, so none of it is retyped and none of it is guessed.
 *
 * The important part is the high-water mark. The retainer starts on the day the
 * subscription started, so MRR counts from the right date, but
 * `lastGeneratedDate` is set to that same day and `nextInvoiceDate` to the cycle
 * after it. Without that the biller would raise a second invoice for a period
 * this payment has already settled, and the client would be billed twice for
 * one month in the books.
 */
router.post('/payments/:id/retainer', async (req, res, next) => {
  try {
    const body = parse(z.object({
      clientId:  z.number().int().optional(),
      amount:    z.number().positive().optional(),
      frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
      name:      z.string().min(1).optional(),
      serviceId: z.number().int().nullish(),
    }), req.body)

    const paymentId = id(req.params.id)
    const [payment] = await db.select().from(stripePayments).where(eq(stripePayments.id, paymentId))
    if (!payment) return res.status(404).json({ error: 'No such payment' })

    const clientId = body.clientId ?? payment.matchedClientId
    if (!clientId) return res.status(400).json({ error: 'Assign the payment to a client first' })

    const amount = body.amount ?? payment.planAmount ?? payment.amountGross
    const frequency = body.frequency ?? frequencyFromDays(payment.planIntervalDays)
    const start = payment.paidDate

    // Name it after what Stripe calls it, cleaned of the quantity and price
    // Stripe prefixes: "1 x local SEO (at £149.00 / month)" is just "Local SEO".
    const planName = (payment.planDescription ?? '')
      .replace(/^\s*\d+\s*[x×]\s*/i, '')
      .replace(/\s*\(at .*$/i, '')
      .trim()
    const name = body.name ?? (planName ? planName[0].toUpperCase() + planName.slice(1) : 'Retainer')

    const services = await db.select().from(businessServices)
    const serviceId = body.serviceId
      ?? services.find(sv => sv.name.toLowerCase() === planName.toLowerCase())?.id
      ?? null

    const invoiceNumber = await nextInvoiceNumber()

    const result = db.transaction(tx => {
      releasePayment(tx, paymentId)
      reactivateIfChurned(tx, clientId)
      const retainer = tx.insert(businessRetainers).values({
        clientId, serviceId, name, amount, frequency,
        status: 'active',
        startDate: start,
        // This payment settles the first cycle, so the biller must start after it.
        lastGeneratedDate: start,
        nextInvoiceDate:   advance(start, frequency),
        autoInvoice: 1,
      }).returning().get()

      const invoice = tx.insert(businessInvoices).values({
        invoiceNumber,
        clientId, serviceId,
        retainerId:     retainer.id,
        amount:         payment.amountGross,
        subtotal:       payment.amountGross,
        status:         'unpaid',
        issueDate:      start,
        dueDate:        start,
        sentDate:       start,
        periodStart:    start,
        periodEnd:      advance(start, frequency),
        isRecurring:    1,
        notes:          payment.planDescription ?? name,
        raisedFromPaymentId: paymentId,
      }).returning().get()

      applyPayment(tx, paymentId, [{ invoiceId: invoice.id, amount: payment.amountGross }], {
        clientId, reason: `Retainer set up from this subscription, invoice ${invoice.invoiceNumber}`,
      })
      if (payment.stripeCustomerId) learnCustomerTx(tx, clientId, payment.stripeCustomerId)
      return { retainer, invoice }
    })

    invalidate()
    res.status(201).json(result)
  } catch (e) { next(e) }
})

/** Stripe reports a cycle in days; a retainer thinks in named frequencies. */
function frequencyFromDays(days: number | null): 'weekly' | 'monthly' | 'quarterly' | 'yearly' {
  if (!days) return 'monthly'
  if (days <= 10) return 'weekly'
  if (days <= 45) return 'monthly'
  if (days <= 135) return 'quarterly'
  return 'yearly'
}

/** Not business income: a refund, a transfer, a personal card. Anything it settled reopens. */
router.post('/payments/:id/ignore', async (req, res, next) => {
  try {
    const paymentId = id(req.params.id)
    db.transaction(tx => {
      releasePayment(tx, paymentId)
      tx.update(stripePayments).set({ ignored: 1, matchReason: 'Marked as not business income' })
        .where(eq(stripePayments.id, paymentId)).run()
    })
    invalidate()
    res.json({ ok: true })
  } catch (e) { next(e) }
})

router.post('/payments/:id/unignore', async (req, res, next) => {
  try {
    await db.update(stripePayments).set({ ignored: 0, matchReason: 'Back in the queue' })
      .where(eq(stripePayments.id, id(req.params.id)))
    invalidate()
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// ─── Time entries ─────────────────────────────────────────────────────────────

router.get('/time', async (_req, res, next) => {
  try { res.json(await db.select().from(businessTimeEntries).orderBy(desc(businessTimeEntries.date))) } catch (e) { next(e) }
})
router.get('/projects/:id/time', async (req, res, next) => {
  try { res.json(await db.select().from(businessTimeEntries).where(eq(businessTimeEntries.projectId, id(req.params.id)))) } catch (e) { next(e) }
})
router.post('/projects/:id/time', async (req, res, next) => {
  try {
    const body = parse(z.object({
      date:        dateStr.optional(),
      hours:       z.number().positive(),
      description: z.string().nullish(),
      billable:    z.union([z.literal(0), z.literal(1)]).optional(),
    }), req.body)
    const row = (await db.insert(businessTimeEntries)
      .values({ ...body, date: body.date ?? localToday(), projectId: id(req.params.id) })
      .returning())[0]
    invalidate()
    res.status(201).json(row)
  } catch (e) { next(e) }
})
router.delete('/time/:id', async (req, res, next) => {
  try {
    await db.delete(businessTimeEntries).where(eq(businessTimeEntries.id, id(req.params.id)))
    invalidate()
    res.status(204).send()
  } catch (e) { next(e) }
})

// ─── Meeting notes ────────────────────────────────────────────────────────────

router.get('/meeting-notes', async (req, res, next) => {
  try {
    const where = []
    if (req.query.clientId)  where.push(eq(businessMeetingNotes.clientId, id(req.query.clientId as string)))
    if (req.query.projectId) where.push(eq(businessMeetingNotes.projectId, id(req.query.projectId as string)))
    const q = db.select().from(businessMeetingNotes)
    res.json(await (where.length ? q.where(and(...where)) : q))
  } catch (e) { next(e) }
})
router.post('/meeting-notes', async (req, res, next) => {
  try { res.status(201).json((await db.insert(businessMeetingNotes).values(req.body).returning())[0]) } catch (e) { next(e) }
})
router.put('/meeting-notes/:id', async (req, res, next) => {
  try { res.json((await db.update(businessMeetingNotes).set({ ...req.body, updatedAt: new Date().toISOString() }).where(eq(businessMeetingNotes.id, id(req.params.id))).returning())[0]) } catch (e) { next(e) }
})
router.delete('/meeting-notes/:id', async (req, res, next) => {
  try { await db.delete(businessMeetingNotes).where(eq(businessMeetingNotes.id, id(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

// ─── Marketing campaigns ──────────────────────────────────────────────────────

router.get('/campaigns', async (_req, res, next) => {
  try {
    const campaigns = await db.select().from(marketingCampaigns).orderBy(marketingCampaigns.startDate)
    const daily = await db.select().from(marketingSpendDaily)

    // Where days are recorded they are the truth, and `spent` is only the
    // fallback for the era before recording started. Sending both, with the
    // measured figure named as such, stops the UI showing two different
    // numbers for the same money.
    res.json(campaigns.map(c => {
      const rows = daily.filter(d => d.campaignId === c.id)
      return {
        ...c,
        measuredSpend: rows.length ? round2(rows.reduce((s, d) => s + d.spend, 0)) : null,
        spendDays: rows.length,
      }
    }))
  } catch (e) { next(e) }
})
router.post('/campaigns', async (req, res, next) => {
  try {
    const row = (await db.insert(marketingCampaigns).values(req.body).returning())[0]
    invalidate()
    res.status(201).json(row)
  } catch (e) { next(e) }
})
router.put('/campaigns/:id', async (req, res, next) => {
  try {
    const row = (await db.update(marketingCampaigns).set(req.body).where(eq(marketingCampaigns.id, id(req.params.id))).returning())[0]
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})
router.delete('/campaigns/:id', async (req, res, next) => {
  try {
    await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, id(req.params.id)))
    invalidate()
    res.status(204).send()
  } catch (e) { next(e) }
})

export default router

/** Shared with the routes split out into businessGrowth.ts. */
export { invalidate, parse, id, money, dateStr }
