import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import {
  businessClients, businessProjects, businessProjectTasks,
  businessInvoices, businessMeetingNotes, businessTimeEntries,
  businessRetainers, businessRetainerChanges, businessServices,
  businessOwners, businessOwnerDraws,
  financeIncome, marketingCampaigns, marketingSpendDaily, stripePayments,
} from '../db/schema'
import { eq, and, gte, lte, like, or, inArray, sql, desc } from 'drizzle-orm'
import { localToday } from '../lib/date'
import { advance, addDays } from '../lib/recurrence'
import { createInvoiceNumberAllocator, nextInvoiceNumber } from '../lib/invoiceNumbers'
import { generateRetainerInvoices, invalidateRetainerBilling } from '../lib/retainerBilling'
import {
  syncAdSpend, recomputeCampaignSpend, configuredPlatforms, metaConfigured,
} from '../lib/adSpendSync'
import {
  syncStripePayments, unassignedPayments, applyPaymentToInvoice, learnCustomer,
  stripeConfigured, stripeStatusNote,
} from '../lib/stripeSync'
import {
  businessMetrics, businessDashboardSummary, loadBusinessData, invalidateBusinessData,
  clientEconomics, ownerPay, needsYou,
} from '../lib/businessMetrics'

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
  status:      z.enum(['active', 'lead', 'churned', 'inactive']).optional(),
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
          collected: round2(d.invoices.filter(i => i.projectId === p.id && i.status === 'paid').reduce((s, i) => s + i.amount, 0)),
        }))
        .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '')),
      invoices: d.invoices
        .filter(i => i.clientId === clientId)
        .map(i => ({ ...i, serviceName: d.services.find(s => s.id === i.serviceId)?.name ?? null }))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate)),
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
router.delete('/clients/:id', async (req, res, next) => {
  try {
    await db.delete(businessClients).where(eq(businessClients.id, id(req.params.id)))
    invalidate()
    res.status(204).send()
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
        let allocated = 0
        milestones.forEach((m, idx) => {
          const isLast = idx === milestones.length - 1
          const amount = isLast ? round2(item.amount - allocated) : round2(item.amount * (m.pct / 100))
          allocated = round2(allocated + amount)
          const issueDate = addDays(start, m.offsetDays ?? 0)

          const inv = tx.insert(businessInvoices).values({
            clientId:       created.clientId,
            projectId:      created.projectId,
            invoiceNumber:  alloc.next(),
            amount,
            subtotal:       amount,
            status:         idx === 0 && body.sendFirst ? 'unpaid' : 'draft',
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
          milestonesTotal: 3,
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
    const row = (await db.update(businessProjects)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(businessProjects.id, id(req.params.id))).returning())[0]
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
    const row = (await db.insert(businessRetainers).values({
      ...body, frequency, status: 'active',
      lastGeneratedDate: body.startDate,
      nextInvoiceDate:   advance(body.startDate, frequency),
    }).returning())[0]
    invalidate()
    res.status(201).json(row)
  } catch (e) { next(e) }
})

router.put('/retainers/:id', async (req, res, next) => {
  try {
    const body = parse(retainerSchema.partial(), req.body)
    const row = (await db.update(businessRetainers)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(businessRetainers.id, id(req.params.id))).returning())[0]
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

/**
 * A price change is logged, not overwritten. Without the log, expansion and
 * contraction MRR are permanently zero, which is exactly the state the app was
 * in before this route existed.
 */
router.put('/retainers/:id/price', async (req, res, next) => {
  try {
    const body = parse(z.object({
      newAmount:     money,
      effectiveDate: dateStr.optional(),
      reason:        z.string().nullish(),
    }), req.body)

    const retainerId = id(req.params.id)
    const current = (await db.select().from(businessRetainers).where(eq(businessRetainers.id, retainerId)))[0]
    if (!current) return res.status(404).json({ error: 'No such retainer' })
    if (round2(current.amount) === round2(body.newAmount)) {
      return res.status(400).json({ error: 'That is already the price' })
    }

    const effectiveDate = body.effectiveDate ?? localToday()
    await db.insert(businessRetainerChanges).values({
      retainerId, effectiveDate,
      oldAmount: current.amount, newAmount: body.newAmount,
      reason: body.reason ?? null,
    })
    const row = (await db.update(businessRetainers)
      .set({ amount: body.newAmount, updatedAt: new Date().toISOString() })
      .where(eq(businessRetainers.id, retainerId)).returning())[0]

    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

/** Pause keeps the subscription but stops billing; MRR drops to zero while paused. */
router.post('/retainers/:id/pause', async (req, res, next) => {
  try {
    const row = (await db.update(businessRetainers)
      .set({ status: 'paused', updatedAt: new Date().toISOString() })
      .where(eq(businessRetainers.id, id(req.params.id))).returning())[0]
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

router.post('/retainers/:id/resume', async (req, res, next) => {
  try {
    const retainerId = id(req.params.id)
    const current = (await db.select().from(businessRetainers).where(eq(businessRetainers.id, retainerId)))[0]
    if (!current) return res.status(404).json({ error: 'No such retainer' })
    // Restart the clock from today so a pause never back-bills the gap.
    const today = localToday()
    const row = (await db.update(businessRetainers)
      .set({
        status: 'active',
        lastGeneratedDate: today,
        nextInvoiceDate: advance(today, current.frequency),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(businessRetainers.id, retainerId)).returning())[0]
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

router.post('/retainers/:id/cancel', async (req, res, next) => {
  try {
    const body = parse(z.object({ endDate: dateStr.optional(), reason: z.string().nullish() }), req.body)
    const endDate = body.endDate ?? localToday()
    const row = (await db.update(businessRetainers)
      .set({
        status: 'cancelled', endDate,
        cancelReason: body.reason ?? null,
        cancelledAt: localToday(),
        autoInvoice: 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(businessRetainers.id, id(req.params.id))).returning())[0]
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

router.delete('/retainers/:id', async (req, res, next) => {
  try {
    await db.delete(businessRetainers).where(eq(businessRetainers.id, id(req.params.id)))
    invalidate()
    res.status(204).send()
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

    const rows = d.invoices
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
        return {
          id: i.id, invoiceNumber: i.invoiceNumber, clientId: i.clientId,
          clientName: d.clients.find(c => c.id === i.clientId)?.name ?? 'Unknown',
          projectId: i.projectId, retainerId: i.retainerId, kind, what,
          gross: round2(i.amount),
          fee: i.feeAmount ?? 0,
          net: i.status === 'paid' ? round2(i.amount - (i.feeAmount ?? 0) - (i.refundedAmount ?? 0)) : null,
          // `overdue` is never written to the database; it is simply what an
          // unpaid invoice past its due date IS.
          status: i.status === 'unpaid' && i.dueDate < today ? 'overdue' : i.status,
          issueDate: i.issueDate, dueDate: i.dueDate, paidDate: i.paidDate,
          notes: i.notes,
        }
      })
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.id - a.id)

    res.json({
      rows,
      totals: {
        count:       rows.length,
        billed:      round2(rows.reduce((s, r) => s + r.gross, 0)),
        collected:   round2(rows.filter(r => r.status === 'paid').reduce((s, r) => s + (r.net ?? 0), 0)),
        fees:        round2(rows.reduce((s, r) => s + r.fee, 0)),
        outstanding: round2(rows.filter(r => r.status !== 'paid' && r.status !== 'draft').reduce((s, r) => s + r.gross, 0)),
        overdue:     round2(rows.filter(r => r.status === 'overdue').reduce((s, r) => s + r.gross, 0)),
        paidCount:   rows.filter(r => r.status === 'paid').length,
        avgDaysToPay: (() => {
          const paid = rows.filter(r => r.status === 'paid' && r.paidDate)
          if (!paid.length) return null
          const days = paid.map(r => Math.round((Date.parse(r.paidDate!) - Date.parse(r.issueDate)) / 86_400_000))
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
    const row = (await db.insert(businessInvoices).values({
      ...body,
      invoiceNumber: body.invoiceNumber ?? await nextInvoiceNumber(),
      subtotal:      body.subtotal ?? body.amount,
      issueDate,
      dueDate:       body.dueDate ?? addDays(issueDate, 7),
      status:        body.status ?? 'unpaid',
    }).returning())[0]
    invalidate()
    res.status(201).json(row)
  } catch (e) { next(e) }
})

/**
 * Mark paid, and record the fee at the same time.
 *
 * Either give the fee directly, or give the amount that actually landed in the
 * bank and let the fee fall out of it. That is what makes gross volume and net
 * volume two different real numbers instead of the same number twice.
 */
router.post('/invoices/:id/pay', async (req, res, next) => {
  try {
    const body = parse(z.object({
      paidDate:    dateStr.optional(),
      feeAmount:   z.number().nonnegative().optional(),
      netReceived: z.number().nonnegative().optional(),
    }), req.body)

    const invoiceId = id(req.params.id)
    const current = (await db.select().from(businessInvoices).where(eq(businessInvoices.id, invoiceId)))[0]
    if (!current) return res.status(404).json({ error: 'No such invoice' })

    const feeAmount = body.feeAmount != null
      ? round2(body.feeAmount)
      : body.netReceived != null
        ? round2(Math.max(current.amount - body.netReceived, 0))
        : current.feeAmount ?? 0

    const row = (await db.update(businessInvoices)
      .set({ status: 'paid', paidDate: body.paidDate ?? localToday(), feeAmount })
      .where(eq(businessInvoices.id, invoiceId)).returning())[0]
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

/** Undo for the one-click mark-paid on the Overview queue. */
router.post('/invoices/:id/unpay', async (req, res, next) => {
  try {
    const row = (await db.update(businessInvoices)
      .set({ status: 'unpaid', paidDate: null, feeAmount: 0 })
      .where(eq(businessInvoices.id, id(req.params.id))).returning())[0]
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

router.post('/invoices/:id/send', async (req, res, next) => {
  try {
    const row = (await db.update(businessInvoices)
      .set({ status: 'unpaid', sentDate: localToday() })
      .where(eq(businessInvoices.id, id(req.params.id))).returning())[0]
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})

router.put('/invoices/:id', async (req, res, next) => {
  try {
    const body = parse(invoiceSchema.partial(), req.body)
    const row = (await db.update(businessInvoices).set(body).where(eq(businessInvoices.id, id(req.params.id))).returning())[0]
    invalidate()
    res.json(row)
  } catch (e) { next(e) }
})
router.delete('/invoices/:id', async (req, res, next) => {
  try {
    await db.delete(businessInvoices).where(eq(businessInvoices.id, id(req.params.id)))
    invalidate()
    res.status(204).send()
  } catch (e) { next(e) }
})


/** Say how an invoice was paid, for the clients who transfer rather than card. */
router.put('/invoices/:id/method', async (req, res, next) => {
  try {
    const body = parse(z.object({ method: z.enum(['stripe', 'bank']).nullable() }), req.body)
    const row = (await db.update(businessInvoices)
      .set({ paymentMethod: body.method })
      .where(eq(businessInvoices.id, id(req.params.id))).returning())[0]
    invalidate()
    res.json(row)
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

/** Everything waiting on a decision, with the app's best guess attached. */
router.get('/payments/unassigned', async (_req, res, next) => {
  try {
    const rows = await unassignedPayments()
    const clients = await db.select().from(businessClients)

    // Invoices another payment already settled. Without this the picker would
    // happily offer an invoice that is already accounted for.
    const claimed = await db.select({ id: stripePayments.matchedInvoiceId, covers: stripePayments.coversInvoiceIds })
      .from(stripePayments).where(sql`${stripePayments.matchedInvoiceId} is not null`)
    const taken = new Set<number>()
    for (const c of claimed) {
      if (c.id) taken.add(c.id)
      if (c.covers) for (const extra of JSON.parse(c.covers) as number[]) taken.add(extra)
    }

    res.json({
      payments: rows.map(p => ({
        ...p,
        suggestedClientName: p.matchedClientId
          ? clients.find(c => c.id === p.matchedClientId)?.name ?? null
          : null,
      })),
      /** Every invoice still available to attach a payment to, paid or not:
       *  a payment for an invoice already ticked off still needs matching,
       *  because that is how the real fee lands on it. */
      takenInvoiceIds: [...taken],
    })
  } catch (e) { next(e) }
})

router.get('/payments', async (req, res, next) => {
  try {
    const clients = await db.select().from(businessClients)
    const rows = await db.select().from(stripePayments).orderBy(desc(stripePayments.paidDate))
    const limit = req.query.limit ? id(req.query.limit as string) : 100
    res.json(rows.slice(0, limit).map(p => ({
      ...p,
      clientName: clients.find(c => c.id === p.matchedClientId)?.name ?? null,
    })))
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
 * Assign a payment by hand, and learn from it.
 *
 * The learning is the point: tying the Stripe customer to the client means the
 * next payment from them is certain no matter what name they type.
 */
router.post('/payments/:id/assign', async (req, res, next) => {
  try {
    const body = parse(z.object({
      clientId:  z.number().int(),
      invoiceId: z.number().int().nullish(),
      /** When one payment settled several invoices, as a new client paying the
       *  website and the first month together usually does. */
      invoiceIds: z.array(z.number().int()).optional(),
      /** Off when this payment happens to be from a shared card. */
      remember:  z.boolean().optional(),
    }), req.body)

    const paymentId = id(req.params.id)
    const [payment] = await db.select().from(stripePayments).where(eq(stripePayments.id, paymentId))
    if (!payment) return res.status(404).json({ error: 'No such payment' })

    const ids = body.invoiceIds?.length
      ? body.invoiceIds
      : body.invoiceId ? [body.invoiceId] : []

    await db.update(stripePayments).set({
      matchedClientId: body.clientId,
      matchedInvoiceId: ids[0] ?? null,
      coversInvoiceIds: ids.length > 1 ? JSON.stringify(ids) : null,
      confidence: 'exact',
      matchReason: ids.length > 1
        ? `Assigned by hand, covering ${ids.length} invoices`
        : 'Assigned by hand',
      matchedAt: new Date().toISOString(),
    }).where(eq(stripePayments.id, paymentId))

    if (ids.length) await applyPaymentToInvoice(paymentId)
    if ((body.remember ?? true) && payment.stripeCustomerId) {
      await learnCustomer(body.clientId, payment.stripeCustomerId)
    }

    invalidate()
    res.json({ ok: true, learned: (body.remember ?? true) && !!payment.stripeCustomerId })
  } catch (e) { next(e) }
})

/**
 * Raise an invoice from a payment that has nothing to attach to.
 *
 * Assigning a payment to a client alone recorded who paid and stopped there,
 * which left real money off the books: every figure on this tab is built from
 * paid invoices, so a payment with no invoice behind it is invisible to gross
 * volume, to fees and to profit. A new client who pays before anything has been
 * raised hits that every time, which is exactly when it matters most.
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
    }), req.body)

    const paymentId = id(req.params.id)
    const [payment] = await db.select().from(stripePayments).where(eq(stripePayments.id, paymentId))
    if (!payment) return res.status(404).json({ error: 'No such payment' })
    if (payment.matchedInvoiceId) {
      return res.status(409).json({ error: 'This payment already has an invoice against it' })
    }

    const clientId = body.clientId ?? payment.matchedClientId
    if (!clientId) return res.status(400).json({ error: 'Assign the payment to a client first' })

    const invoice = (await db.insert(businessInvoices).values({
      invoiceNumber:  await nextInvoiceNumber(),
      clientId,
      serviceId:      body.serviceId ?? null,
      amount:         payment.amountGross,
      subtotal:       payment.amountGross,
      feeAmount:      payment.fee,
      refundedAmount: payment.refunded,
      status:         'paid',
      issueDate:      payment.paidDate,
      dueDate:        payment.paidDate,
      paidDate:       payment.paidDate,
      paymentMethod:  'stripe',
      notes:          body.description ?? payment.description ?? 'Raised from a Stripe payment',
    }).returning())[0]

    await db.update(stripePayments).set({
      matchedClientId:  clientId,
      matchedInvoiceId: invoice.id,
      confidence:       'exact',
      matchReason:      `Invoice ${invoice.invoiceNumber} raised from this payment`,
      matchedAt:        new Date().toISOString(),
    }).where(eq(stripePayments.id, paymentId))

    if (payment.stripeCustomerId) await learnCustomer(clientId, payment.stripeCustomerId)

    invalidate()
    res.status(201).json(invoice)
  } catch (e) { next(e) }
})

/** Not business income: a refund, a transfer, a personal card. */
router.post('/payments/:id/ignore', async (req, res, next) => {
  try {
    const row = (await db.update(stripePayments)
      .set({ ignored: 1, matchReason: 'Marked as not business income' })
      .where(eq(stripePayments.id, id(req.params.id))).returning())[0]
    invalidate()
    res.json(row)
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
