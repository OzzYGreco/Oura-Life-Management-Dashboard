/**
 * Business routes added for looking ahead and getting paid: settings, client
 * history, payment links and reminders, declined cards, the cash forecast,
 * changing many prices at once, the month summary, VAT, and leads.
 *
 * Mounted on /api/business next to the main routes, which were already long.
 */
import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db'
import {
  businessInvoices, businessClients, businessRetainers, businessRetainerChanges, businessEvents,
  stripeFailedCharges, businessLeads, businessServices, marketingSpendDaily, marketingCampaigns,
} from '../db/schema'
import { eq, and, desc, gte, inArray } from 'drizzle-orm'
import { invalidate, parse, id, money, dateStr } from './business'
import { loadBusinessData, owedOn } from '../lib/businessMetrics'
import { forecast, monthSummary, vatTracker } from '../lib/insights'
import { getSettings, saveSettings } from '../lib/settings'
import { createPaymentLink } from '../lib/stripeSync'
import { priceOn } from '../lib/lifecycle'
import { advance } from '../lib/recurrence'
import { logEvent } from '../lib/events'
import { localToday } from '../lib/date'

const router = Router()
const round2 = (n: number) => Math.round(n * 100) / 100
const gbp = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const longDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

// ─── Settings ────────────────────────────────────────────────────────────────

router.get('/settings', (_req, res, next) => {
  try { res.json(getSettings()) } catch (e) { next(e) }
})

router.put('/settings', (req, res, next) => {
  try {
    const body = parse(z.object({
      businessName: z.string().optional(), signOff: z.string().optional(), bankDetails: z.string().optional(),
    }), req.body)
    res.json(saveSettings(body))
  } catch (e) { next(e) }
})

// ─── Client history ──────────────────────────────────────────────────────────

router.get('/clients/:id/events', (req, res, next) => {
  try {
    res.json(db.select().from(businessEvents).where(eq(businessEvents.clientId, id(req.params.id)))
      .orderBy(desc(businessEvents.at), desc(businessEvents.id)).all())
  } catch (e) { next(e) }
})

// ─── Getting paid: payment links and reminders ───────────────────────────────

/** Describe an invoice the way the client would read it. */
async function invoiceFacts(invoiceId: number) {
  const d = await loadBusinessData()
  const inv = d.allInvoices.find(i => i.id === invoiceId)
  if (!inv) throw Object.assign(new Error('No such invoice'), { status: 404 })
  const client = d.clients.find(c => c.id === inv.clientId)
  const retainer = inv.retainerId ? d.retainers.find(r => r.id === inv.retainerId) : null
  const service = d.services.find(s => s.id === (inv.serviceId ?? retainer?.serviceId))
  const what = inv.milestoneLabel
    ? `${service?.name ?? 'website'}, ${inv.milestoneLabel.toLowerCase()}`
    : service?.name ?? inv.notes ?? 'work'
  return { inv, client, what, owed: owedOn(d, inv) }
}

/**
 * A Stripe Payment Link for what is still owed. Made once and reused while the
 * amount owed is the same; a new one is made if the amount has changed.
 */
router.post('/invoices/:id/payment-link', async (req, res, next) => {
  try {
    const { inv, what, owed } = await invoiceFacts(id(req.params.id))
    if (inv.status === 'void' || inv.status === 'paid' || owed <= 0.005) {
      return res.status(409).json({ error: `${inv.invoiceNumber} has nothing left to pay` })
    }
    if (inv.paymentLinkUrl && !req.body?.fresh) return res.json({ url: inv.paymentLinkUrl, reused: true })
    const link = await createPaymentLink({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, what, amount: owed, currency: inv.currency })
    db.update(businessInvoices).set({ paymentLinkId: link.id, paymentLinkUrl: link.url }).where(eq(businessInvoices.id, inv.id)).run()
    invalidate()
    res.json({ url: link.url, reused: false })
  } catch (e) { next(e) }
})

/**
 * A ready reminder for an invoice: subject and message, to edit and send from
 * your own email. It includes the payment link if one exists and the bank
 * details from settings if set.
 */
router.get('/invoices/:id/reminder', async (req, res, next) => {
  try {
    const { inv, client, what, owed } = await invoiceFacts(id(req.params.id))
    const s = getSettings()
    const today = localToday()
    const first = (client?.name ?? '').split(' ')[0] || 'there'
    const late = inv.dueDate < today ? Math.floor((Date.parse(today) - Date.parse(inv.dueDate)) / 86_400_000) : 0
    const paid = round2(inv.amount - owed)
    const lines = [
      `Hi ${first},`,
      '',
      late
        ? `A quick reminder that invoice ${inv.invoiceNumber} for ${what} was due on ${longDate(inv.dueDate)} and is now ${late} day${late === 1 ? '' : 's'} overdue.`
        : `A quick reminder that invoice ${inv.invoiceNumber} for ${what} is due on ${longDate(inv.dueDate)}.`,
      paid > 0.005
        ? `Thank you for the ${gbp(paid)} already paid; ${gbp(owed)} is still outstanding.`
        : `The amount due is ${gbp(owed)}.`,
    ]
    if (inv.paymentLinkUrl) lines.push('', `You can pay by card here: ${inv.paymentLinkUrl}`)
    if (s.bankDetails.trim()) {
      lines.push('', `${inv.paymentLinkUrl ? 'Or by' : 'You can pay by'} bank transfer, using ${inv.invoiceNumber} as the reference:`, s.bankDetails.trim())
    }
    lines.push('', 'If you have already paid, please ignore this message.', '', 'Thanks,', s.signOff.trim() || s.businessName)
    const subject = `${late ? 'Overdue' : 'Reminder'}: invoice ${inv.invoiceNumber} from ${s.businessName}`
    const body = lines.join('\n')
    res.json({
      to: client?.email ?? null, subject, body, hasLink: !!inv.paymentLinkUrl, hasBank: !!s.bankDetails.trim(),
      mailto: `mailto:${encodeURIComponent(client?.email ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    })
  } catch (e) { next(e) }
})

// ─── Declined cards ──────────────────────────────────────────────────────────

/** Sorted: they updated their card, paid another way, or it no longer matters. */
router.post('/failed-charges/dismiss', (req, res, next) => {
  try {
    const body = parse(z.object({ ids: z.array(z.number().int()).min(1) }), req.body)
    db.update(stripeFailedCharges).set({ dismissedAt: localToday() }).where(inArray(stripeFailedCharges.id, body.ids)).run()
    invalidate()
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// ─── Looking ahead ───────────────────────────────────────────────────────────

router.get('/forecast', async (req, res, next) => {
  try {
    const q = parse(z.object({ months: z.coerce.number().int().min(1).max(12).optional() }), req.query)
    res.json(forecast(await loadBusinessData(), q.months ?? 3))
  } catch (e) { next(e) }
})

router.get('/vat', async (_req, res, next) => {
  try { res.json(vatTracker(await loadBusinessData())) } catch (e) { next(e) }
})

router.get('/month-summary', async (req, res, next) => {
  try {
    const q = parse(z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      taxReserve: z.enum(['0', '1']).optional(), taxRate: z.coerce.number().optional(), buffer: z.coerce.number().optional(),
    }), req.query)
    const month = q.month ?? localToday().slice(0, 7)
    res.json(await monthSummary(month, {
      taxReserveEnabled: q.taxReserve ? q.taxReserve === '1' : undefined, taxRatePct: q.taxRate, bufferMonths: q.buffer,
    }))
  } catch (e) { next(e) }
})

// ─── Changing many prices at once ────────────────────────────────────────────

/**
 * A price change for everyone on a service: "Local SEO goes to £169 from 1
 * January for everyone on £149". Each retainer changes from its first billing
 * date on or after the day given, so nobody is billed the new price for a
 * period that started before it. Nothing already billed is touched; the
 * change sits in each retainer's price history and billing picks it up on the
 * day.
 */
router.post('/retainers/bulk-price', async (req, res, next) => {
  try {
    const body = parse(z.object({
      serviceId:     z.number().int(),
      /** Only those paying this now. Blank means everyone on the service. */
      currentAmount: money.nullish(),
      newAmount:     money.positive(),
      from:          dateStr,
      /** Leave some out. */
      exclude:       z.array(z.number().int()).optional(),
      dryRun:        z.boolean().optional(),
    }), req.body)
    const today = localToday()
    if (body.from <= today) return res.status(400).json({ error: 'Pick a day after today. A change from today or earlier is made one client at a time, from Change plan.' })

    const d = await loadBusinessData()
    const service = d.services.find(s => s.id === body.serviceId)
    if (!service) return res.status(404).json({ error: 'No such service' })
    const exclude = new Set(body.exclude ?? [])
    const rows = d.retainers
      .filter(r => r.serviceId === body.serviceId && (r.status === 'active' || (r.status === 'paused' && r.resumeOn)))
      .map(r => {
        // The first period starting on or after the day: that bill is the first at the new price.
        let at = r.status === 'paused' ? r.resumeOn! : r.nextInvoiceDate ?? advance(r.lastGeneratedDate ?? r.startDate, r.frequency)
        let guard = 0
        while (at < body.from && guard++ < 400) at = advance(at, r.frequency)
        const before = priceOn(r, d.changes, at)
        const ends = !!r.endDate && at >= r.endDate
        return {
          retainerId: r.id, clientId: r.clientId,
          clientName: d.clients.find(c => c.id === r.clientId)?.name ?? 'Unknown',
          frequency: r.frequency, from: at, oldAmount: before, newAmount: body.newAmount,
          included: !exclude.has(r.id) && !ends
            && (body.currentAmount == null || Math.abs(before - body.currentAmount) < 0.01)
            && Math.abs(before - body.newAmount) > 0.005,
          why: ends ? 'ends before then' : body.currentAmount != null && Math.abs(before - body.currentAmount) >= 0.01 ? `pays ${gbp(before)}`
            : Math.abs(before - body.newAmount) <= 0.005 ? 'already that price' : exclude.has(r.id) ? 'left out' : null,
        }
      })
      .sort((a, b) => a.clientName.localeCompare(b.clientName))
    const picked = rows.filter(r => r.included)
    const perMonth = (amount: number, f: string) => amount * ({ weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[f] ?? 1)
    const plan = {
      service: service.name, from: body.from, rows,
      count: picked.length,
      mrrDelta: round2(picked.reduce((s, r) => s + perMonth(r.newAmount, r.frequency) - perMonth(r.oldAmount, r.frequency), 0)),
    }
    if (body.dryRun) return res.json(plan)

    db.transaction(tx => {
      for (const r of picked) {
        // Anything already set for that day or later is replaced by this.
        tx.delete(businessRetainerChanges).where(and(
          eq(businessRetainerChanges.retainerId, r.retainerId), gte(businessRetainerChanges.effectiveDate, r.from))).run()
        tx.insert(businessRetainerChanges).values({
          retainerId: r.retainerId, effectiveDate: r.from, oldAmount: r.oldAmount, newAmount: r.newAmount,
          reason: `${service.name} price change for everyone from ${body.from}`,
        }).run()
        logEvent(tx, r.clientId, 'price', `${service.name} goes from ${gbp(r.oldAmount)} to ${gbp(r.newAmount)} from ${longDate(r.from)} (price change for everyone)`)
      }
    })
    invalidate()
    res.json(plan)
  } catch (e) { next(e) }
})

// ─── Leads (the foundation; no screen uses these yet) ───────────────────────

const LEAD_STAGES = ['new', 'contacted', 'quoted', 'won', 'lost'] as const
const leadSchema = z.object({
  name:         z.string().trim().min(1),
  company:      z.string().nullish(),
  email:        z.string().nullish(),
  phone:        z.string().nullish(),
  source:       z.string().nullish(),
  campaignId:   z.number().int().nullish(),
  serviceId:    z.number().int().nullish(),
  stage:        z.enum(LEAD_STAGES).optional(),
  quoteOneOff:  money.nullish(),
  quoteMonthly: money.nullish(),
  notes:        z.string().nullish(),
})

router.get('/leads', (_req, res, next) => {
  try { res.json(db.select().from(businessLeads).orderBy(desc(businessLeads.createdAt)).all()) } catch (e) { next(e) }
})

router.post('/leads', (req, res, next) => {
  try {
    const body = parse(leadSchema, req.body)
    const quoted = body.quoteOneOff != null || body.quoteMonthly != null
    const row = db.insert(businessLeads).values({
      ...body, stage: body.stage ?? (quoted ? 'quoted' : 'new'), quotedAt: quoted ? localToday() : null,
    }).returning().get()
    res.status(201).json(row)
  } catch (e) { next(e) }
})

router.put('/leads/:id', (req, res, next) => {
  try {
    const body = parse(leadSchema.partial(), req.body)
    const current = db.select().from(businessLeads).where(eq(businessLeads.id, id(req.params.id))).get()
    if (!current) return res.status(404).json({ error: 'No such lead' })
    const quoting = !current.quotedAt && (body.quoteOneOff != null || body.quoteMonthly != null || body.stage === 'quoted')
    const row = db.update(businessLeads).set({
      ...body, updatedAt: new Date().toISOString(), ...(quoting ? { quotedAt: localToday() } : {}),
    }).where(eq(businessLeads.id, current.id)).returning().get()
    res.json(row)
  } catch (e) { next(e) }
})

router.delete('/leads/:id', (req, res, next) => {
  try {
    db.delete(businessLeads).where(eq(businessLeads.id, id(req.params.id))).run()
    res.status(204).send()
  } catch (e) { next(e) }
})

/**
 * Won: the lead becomes a client, carrying its source and campaign so cost
 * per client by source can be worked out, or is tied to a client that exists.
 */
router.post('/leads/:id/win', (req, res, next) => {
  try {
    const body = parse(z.object({ clientId: z.number().int().optional() }), req.body ?? {})
    const lead = db.select().from(businessLeads).where(eq(businessLeads.id, id(req.params.id))).get()
    if (!lead) return res.status(404).json({ error: 'No such lead' })
    const today = localToday()
    const out = db.transaction(tx => {
      const clientId = body.clientId ?? tx.insert(businessClients).values({
        name: lead.name, company: lead.company, email: lead.email, phone: lead.phone,
        source: lead.source, campaignId: lead.campaignId, status: 'active', wonDate: today,
      }).returning().get().id
      return tx.update(businessLeads).set({ stage: 'won', decidedAt: today, clientId, updatedAt: new Date().toISOString() })
        .where(eq(businessLeads.id, lead.id)).returning().get()
    })
    invalidate()
    res.json(out)
  } catch (e) { next(e) }
})

router.post('/leads/:id/lose', (req, res, next) => {
  try {
    const body = parse(z.object({ reason: z.string().nullish() }), req.body ?? {})
    const row = db.update(businessLeads).set({
      stage: 'lost', decidedAt: localToday(), lostReason: body.reason ?? null, updatedAt: new Date().toISOString(),
    }).where(eq(businessLeads.id, id(req.params.id))).returning().get()
    if (!row) return res.status(404).json({ error: 'No such lead' })
    res.json(row)
  } catch (e) { next(e) }
})

/**
 * By source: how many leads, how many won, win rate, days to decide, what was
 * quoted and won, and (where a source has campaigns) ad spend per client won.
 */
router.get('/leads/stats', (req, res, next) => {
  try {
    const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional() }), req.query)
    const inR = (d: string) => (!q.from || d >= q.from) && (!q.to || d <= q.to)
    const leads = db.select().from(businessLeads).all().filter(l => inR(l.createdAt.slice(0, 10)))
    const campaigns = db.select().from(marketingCampaigns).all()
    const spend = db.select().from(marketingSpendDaily).all().filter(s => inR(s.date))
    const services = db.select().from(businessServices).all()
    const sources = [...new Set(leads.map(l => l.source ?? 'unknown'))]
    const rows = sources.map(source => {
      const mine = leads.filter(l => (l.source ?? 'unknown') === source)
      const won = mine.filter(l => l.stage === 'won')
      const decided = mine.filter(l => l.stage === 'won' || l.stage === 'lost')
      const days = decided.filter(l => l.decidedAt).map(l => (Date.parse(l.decidedAt!) - Date.parse(l.createdAt.slice(0, 10))) / 86_400_000)
      const campaignIds = new Set(mine.map(l => l.campaignId).filter((x): x is number => x != null))
      const adSpend = round2(spend.filter(s => campaignIds.has(s.campaignId)).reduce((t, s) => t + s.spend, 0))
      const value = (ls: typeof mine) => round2(ls.reduce((t, l) => t + (l.quoteOneOff ?? 0) + (l.quoteMonthly ?? 0) * 12, 0))
      return {
        source, leads: mine.length, quoted: mine.filter(l => l.quotedAt).length, won: won.length,
        lost: mine.filter(l => l.stage === 'lost').length,
        winRatePct: decided.length ? round2((won.length / decided.length) * 100) : null,
        avgDaysToDecide: days.length ? round2(days.reduce((a, b) => a + b, 0) / days.length) : null,
        /** One-off plus a year of monthly, quoted and won. */
        quotedValue: value(mine.filter(l => l.quotedAt)), wonValue: value(won),
        adSpend, costPerWon: won.length && adSpend ? round2(adSpend / won.length) : null,
        campaigns: campaigns.filter(c => campaignIds.has(c.id)).map(c => c.name),
      }
    }).sort((a, b) => b.leads - a.leads)
    const lostReasons = Object.entries(leads.filter(l => l.stage === 'lost').reduce<Record<string, number>>((m, l) => {
      const k = l.lostReason?.trim() || 'no reason given'; m[k] = (m[k] ?? 0) + 1; return m
    }, {})).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }))
    const byService = services.map(s => ({ service: s.name, leads: leads.filter(l => l.serviceId === s.id).length,
      won: leads.filter(l => l.serviceId === s.id && l.stage === 'won').length })).filter(x => x.leads)
    res.json({ total: leads.length, open: leads.filter(l => !['won', 'lost'].includes(l.stage)).length, bySource: rows, byService, lostReasons })
  } catch (e) { next(e) }
})

export default router
