/**
 * The goal chain above the month: 3-year directions and their SMART
 * milestones (reached or not, never scored), plus the steps of milestones that
 * aren't a number. Mounted at /api/milestones.
 */
import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { goalDirections, goalTasks, milestoneSteps, milestones } from '../db/schema'
import { MEASURES, currentValue, isMeasure, milestonesView } from '../lib/milestones'

const router = Router()
const ISO = /^\d{4}-\d{2}-\d{2}$/
const now = () => new Date().toISOString()
const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const num = (v: unknown) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : NaN)

/** Everything for the roadmap: directions in order, milestones with their live value and pace, and the measures on offer. */
router.get('/', async (_req, res, next) => {
  try {
    const directions = (await db.select().from(goalDirections)).filter(d => !d.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    res.json({ directions, milestones: await milestonesView(), measures: MEASURES })
  } catch (e) { next(e) }
})

/** A measure's reading right now, so a new milestone can start from where you are. */
router.get('/preview', async (req, res, next) => {
  try {
    const measure = req.query.measure
    if (!isMeasure(measure)) return res.status(400).json({ error: 'Unknown measure.' })
    const startDate = typeof req.query.from === 'string' && ISO.test(req.query.from) ? req.query.from : todayIso()
    const probe = { measure, measureParam: typeof req.query.param === 'string' ? req.query.param : null, startDate, manualValue: null } as typeof milestones.$inferSelect
    res.json({ current: await currentValue(probe, []) })
  } catch (e) { next(e) }
})

// ─── Directions ──────────────────────────────────────────────────────────────

router.post('/directions', async (req, res, next) => {
  try {
    const title = String(req.body?.title ?? '').trim()
    if (!title) return res.status(400).json({ error: 'Name the direction, e.g. "Zavabuild at £10k MRR".' })
    const targetDate = req.body?.targetDate && ISO.test(req.body.targetDate) ? req.body.targetDate : null
    const count = (await db.select().from(goalDirections)).length
    const [d] = await db.insert(goalDirections).values({ title, why: req.body?.why?.trim() || null, targetDate, sortOrder: count }).returning()
    res.status(201).json(d)
  } catch (e) { next(e) }
})

router.put('/directions/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const patch: Partial<typeof goalDirections.$inferInsert> = {}
    if (req.body?.title !== undefined) { const t = String(req.body.title).trim(); if (!t) return res.status(400).json({ error: 'A direction needs a name.' }); patch.title = t }
    if (req.body?.why !== undefined) patch.why = String(req.body.why).trim() || null
    if (req.body?.targetDate !== undefined) patch.targetDate = req.body.targetDate && ISO.test(req.body.targetDate) ? req.body.targetDate : null
    if (req.body?.sortOrder !== undefined) patch.sortOrder = Number(req.body.sortOrder) || 0
    const [d] = await db.update(goalDirections).set(patch).where(eq(goalDirections.id, id)).returning()
    if (!d) return res.status(404).json({ error: 'Direction not found.' })
    res.json(d)
  } catch (e) { next(e) }
})

/** Archives a direction; its milestones stay and show as unassigned. */
router.delete('/directions/:id', async (req, res, next) => {
  try {
    const [d] = await db.update(goalDirections).set({ archivedAt: now() }).where(eq(goalDirections.id, Number(req.params.id))).returning()
    if (!d) return res.status(404).json({ error: 'Direction not found.' })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// ─── Milestones ──────────────────────────────────────────────────────────────

type MilestoneIn = typeof milestones.$inferInsert

/** Reads and checks the SMART fields; returns an error message or the values. */
function readMilestone(b: Record<string, unknown>, partial: boolean): string | Partial<MilestoneIn> {
  const out: Partial<MilestoneIn> = {}
  if (!partial || b.title !== undefined) {
    const t = String(b.title ?? '').trim()
    if (!t) return 'Say what the milestone is (Specific).'
    out.title = t
  }
  if (b.doneMeans !== undefined) out.doneMeans = String(b.doneMeans ?? '').trim() || null
  if (b.kind !== undefined) out.kind = b.kind === 'foundation' ? 'foundation' : 'milestone'
  if (b.directionId !== undefined) out.directionId = b.directionId == null || b.directionId === '' ? null : Number(b.directionId)
  if (!partial || b.measure !== undefined) {
    const m = b.measure ?? 'manual'
    if (!isMeasure(m)) return 'Unknown measure.'
    out.measure = m
  }
  if (b.measureParam !== undefined) out.measureParam = String(b.measureParam ?? '').trim() || null
  if (b.unit !== undefined) out.unit = String(b.unit ?? '').trim() || null
  for (const k of ['startValue', 'targetValue', 'manualValue'] as const) {
    if (b[k] !== undefined) { const v = num(b[k]); if (Number.isNaN(v)) return `${k} must be a number.`; out[k] = v }
  }
  if (b.higherIsBetter !== undefined) out.higherIsBetter = !!b.higherIsBetter
  if (!partial || b.startDate !== undefined) {
    const d = b.startDate ?? todayIso()
    if (typeof d !== 'string' || !ISO.test(d)) return 'Pick a start date.'
    out.startDate = d
  }
  if (!partial || b.dueDate !== undefined) {
    if (typeof b.dueDate !== 'string' || !ISO.test(b.dueDate)) return 'Pick a due date (Time-bound).'
    out.dueDate = b.dueDate
  }
  if (out.startDate && out.dueDate && out.dueDate < out.startDate) return 'The due date has to come after the start.'
  // A number to reach is required unless the milestone is a list of steps.
  if (!partial && out.measure !== 'steps' && out.targetValue == null) return 'Set the number that means reached (Measurable).'
  return out
}

router.post('/', async (req, res, next) => {
  try {
    const v = readMilestone(req.body ?? {}, false)
    if (typeof v === 'string') return res.status(400).json({ error: v })
    const [m] = await db.insert(milestones).values(v as MilestoneIn).returning()
    const steps: string[] = Array.isArray(req.body?.steps) ? req.body.steps.map((s: unknown) => String(s).trim()).filter(Boolean) : []
    if (steps.length) await db.insert(milestoneSteps).values(steps.map((title, i) => ({ milestoneId: m.id, title, sortOrder: i })))
    res.status(201).json(m)
  } catch (e) { next(e) }
})

router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const [cur] = await db.select().from(milestones).where(eq(milestones.id, id))
    if (!cur) return res.status(404).json({ error: 'Milestone not found.' })
    const v = readMilestone(req.body ?? {}, true)
    if (typeof v === 'string') return res.status(400).json({ error: v })
    if ((v.dueDate ?? cur.dueDate) < (v.startDate ?? cur.startDate)) return res.status(400).json({ error: 'The due date has to come after the start.' })
    const [m] = await db.update(milestones).set({ ...v, updatedAt: now() }).where(eq(milestones.id, id)).returning()
    res.json(m)
  } catch (e) { next(e) }
})

/** Mark reached (optionally on a given date), missed, dropped, or open again. */
router.post('/:id/status', async (req, res, next) => {
  try {
    const status = req.body?.status
    if (!['open', 'reached', 'missed', 'dropped'].includes(status)) return res.status(400).json({ error: 'Unknown status.' })
    const date = req.body?.date && ISO.test(req.body.date) ? req.body.date : todayIso()
    const [m] = await db.update(milestones).set({ status, reachedAt: status === 'reached' ? date : null, updatedAt: now() })
      .where(eq(milestones.id, Number(req.params.id))).returning()
    if (!m) return res.status(404).json({ error: 'Milestone not found.' })
    res.json(m)
  } catch (e) { next(e) }
})

/** Deletes a milestone that nothing points at; one that goals link to is dropped instead, so their history keeps its meaning. */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const linked = await db.select({ id: goalTasks.id }).from(goalTasks).where(eq(goalTasks.milestoneId, id))
    if (linked.length) {
      await db.update(milestones).set({ status: 'dropped', updatedAt: now() }).where(eq(milestones.id, id))
      return res.json({ dropped: true })
    }
    await db.delete(milestones).where(eq(milestones.id, id))
    res.json({ deleted: true })
  } catch (e) { next(e) }
})

// ─── Steps ───────────────────────────────────────────────────────────────────

router.post('/:id/steps', async (req, res, next) => {
  try {
    const milestoneId = Number(req.params.id)
    const title = String(req.body?.title ?? '').trim()
    if (!title) return res.status(400).json({ error: 'Name the step.' })
    const count = (await db.select().from(milestoneSteps).where(eq(milestoneSteps.milestoneId, milestoneId))).length
    const [s] = await db.insert(milestoneSteps).values({ milestoneId, title, sortOrder: count }).returning()
    res.status(201).json(s)
  } catch (e) { next(e) }
})

router.put('/steps/:id', async (req, res, next) => {
  try {
    const patch: Partial<typeof milestoneSteps.$inferInsert> = {}
    if (req.body?.title !== undefined) { const t = String(req.body.title).trim(); if (!t) return res.status(400).json({ error: 'A step needs a name.' }); patch.title = t }
    if (req.body?.done !== undefined) patch.doneAt = req.body.done ? todayIso() : null
    const [s] = await db.update(milestoneSteps).set(patch).where(eq(milestoneSteps.id, Number(req.params.id))).returning()
    if (!s) return res.status(404).json({ error: 'Step not found.' })
    res.json(s)
  } catch (e) { next(e) }
})

router.delete('/steps/:id', async (req, res, next) => {
  try {
    await db.delete(milestoneSteps).where(eq(milestoneSteps.id, Number(req.params.id)))
    res.json({ ok: true })
  } catch (e) { next(e) }
})

export default router
