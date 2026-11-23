/**
 * The Routine page: the routine's items with how each one is actually going,
 * the history of day scores, one-off items for any open day, and weekly routines.
 * Templates are still saved through PUT /api/checklists/templates/:id, which
 * updates items in place and retires removed ones.
 */
import { Router } from 'express'
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { db } from '../db'
import {
  checklistTemplates, checklistTemplateItems, checklistEntries, checklistEntryItems, dayReviews,
} from '../db/schema'
import { addDays, dayKey, dayState, ensureDay, ensureWeek, weekState, itemStreaks, reopenInfo, parseClock, hhmm, pointsFor, runsOn, isWeekly } from '../lib/day'

const router = Router()
const WINDOW_DAYS = 30

router.get('/', async (_req, res, next) => {
  try {
    const today = dayKey()
    await ensureDay(today)
    await ensureWeek(today)
    const from = addDays(today, -WINDOW_DAYS)
    const now = await dayState(today)
    const streaks = await itemStreaks(new Set(now.items.filter(i => i.status === 'on_time' && i.templateItemId != null).map(i => i.templateItemId!)))
    const week = await weekState(today)
    const weekItem = new Map(week.routines.flatMap(r => r.items).filter(i => i.templateItemId != null).map(i => [i.templateItemId!, i]))

    const templates = (await db.select().from(checklistTemplates)).filter(t => !t.archivedAt)
    const items = (await db.select().from(checklistTemplateItems)).filter(i => !i.retiredAt)

    // Results of closed days in the window, per template item.
    const reviews = await db.select().from(dayReviews).where(gte(dayReviews.date, from))
    const closed = new Set(reviews.map(r => r.date))
    const entries = (await db.select().from(checklistEntries).where(gte(checklistEntries.date, from))).filter(e => closed.has(e.date))
    const dateOf = new Map(entries.map(e => [e.id, e.date]))
    const rows = entries.length
      ? await db.select().from(checklistEntryItems).where(inArray(checklistEntryItems.entryId, entries.map(e => e.id)))
      : []

    const statsFor = (id: number) => {
      const mine = rows.filter(r => r.templateItemId === id && !r.archived && r.result)
      const days = mine.map(r => ({ date: dateOf.get(r.entryId)!, result: r.result as string }))
        .sort((a, b) => a.date.localeCompare(b.date))
      const onTime = days.filter(d => d.result === 'on_time').length
      const late = days.filter(d => d.result === 'late').length
      const missed = days.filter(d => d.result === 'missed').length
      const reasons: Record<string, number> = {}
      for (const r of mine) if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1
      const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      return {
        days: days.length,
        onTime, late, missed,
        hitRate: days.length ? Math.round((onTime / days.length) * 100) : null,
        topReason, reasons,
        recent: days.slice(-14),
      }
    }

    const out = templates.map(t => ({
      id: t.id, name: t.name, enabled: !!t.enabled, type: t.type === 'weekly' ? 'weekly' as const : 'daily' as const,
      items: items.filter(i => i.templateId === t.id).sort((a, b) => a.sortOrder - b.sortOrder).map(i => {
        const clock = parseClock(i.time)
        const wk = weekItem.get(i.id)
        return {
          id: i.id, label: i.label, time: clock == null ? null : hhmm(clock),
          windowMin: i.windowMin, schedule: i.schedule, importance: i.importance,
          points: pointsFor(i.importance, i.points), pointsOverride: i.points,
          runsToday: runsOn(i.schedule, today),
          stats: statsFor(i.id),
          streak: t.type === 'weekly' ? wk?.streak ?? 0 : streaks.get(i.id) ?? 0,
          ...(t.type === 'weekly' ? { week: { entryItemId: wk?.id ?? null, done: !!wk?.done } } : {}),
        }
      }),
    }))

    // Day score history (closed days) plus today so far.
    const history = (await db.select().from(dayReviews).where(gte(dayReviews.date, addDays(today, -111))))
      .map(r => ({ date: r.date, score: r.score, reflection: r.reflection, auto: !!r.autoClosed }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // One-off items for today.
    const [adhoc] = await db.select().from(checklistEntries).where(and(isNull(checklistEntries.templateId), eq(checklistEntries.date, today)))
    const oneOffs = adhoc
      ? (await db.select().from(checklistEntryItems).where(eq(checklistEntryItems.entryId, adhoc.id)))
          .filter(i => !i.archived)
          .map(i => ({ id: i.id, label: i.label ?? '', time: i.time, importance: i.importance, completed: !!i.completed }))
      : []

    const windowAll = rows.filter(r => r.result && !r.archived && r.templateItemId)
    const onTimeAll = windowAll.filter(r => r.result === 'on_time').length
    res.json({
      today,
      templates: out,
      history,
      todayScore: now.score,
      oneOffs,
      overall: {
        days: closed.size,
        hitRate: windowAll.length ? Math.round((onTimeAll / windowAll.length) * 100) : null,
        avgScore: reviews.length ? Math.round(reviews.reduce((s, r) => s + r.score, 0) / reviews.length) : null,
      },
    })
  } catch (e) { next(e) }
})

// A closed (or current) day in detail, for the history drill-in.
router.get('/day/:date', async (req, res, next) => {
  try {
    const date = req.params.date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Use a date like 2026-11-06.' })
    const state = await dayState(date)
    const [review] = await db.select().from(dayReviews).where(eq(dayReviews.date, date))
    res.json({ ...state, reflection: review?.reflection ?? null, autoClosed: !!review?.autoClosed })
  } catch (e) { next(e) }
})

/** Whether one-offs can be added to or removed from a day: today, any day ahead, or a past day reopened. */
async function dayIsOpen(date: string): Promise<string | null> {
  const today = dayKey()
  const [review] = await db.select().from(dayReviews).where(eq(dayReviews.date, date))
  if (review) return date === today ? 'Today is already closed.' : 'That day is closed. Use "Correct this day" to reopen it first.'
  if (date < today && !(await reopenInfo(date))) return 'That day is closed. Use "Correct this day" to reopen it first.'
  return null
}

const IMPORTANCE = new Set(['UI', 'NUI', 'UNI', 'NUNI'])

// Add one-offs to a day (the 04:00-04:00 day): one, or many at once from a paste.
// Body: { label, time?, importance?, windowMin?, date? } or { items: [{ label, time?, importance?, windowMin? }], date? }
router.post('/oneoffs', async (req, res, next) => {
  try {
    const date = typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : dayKey()
    const list: { label?: unknown; time?: unknown; importance?: unknown; windowMin?: unknown }[] = Array.isArray(req.body?.items) ? req.body.items : [req.body ?? {}]
    const rows = []
    for (const it of list) {
      const label = String(it.label ?? '').trim()
      if (!label) return res.status(400).json({ error: 'Give each one a name.' })
      const time = it.time ? String(it.time) : null
      if (time && parseClock(time) == null) return res.status(400).json({ error: `Use a time like 14:30 for "${label}".` })
      const importance = typeof it.importance === 'string' && IMPORTANCE.has(it.importance) ? it.importance : null
      const w = Number(it.windowMin)
      const windowMin = time && Number.isFinite(w) && w >= 5 && w <= 600 ? Math.round(w) : null
      rows.push({ label, time, importance, windowMin })
    }
    if (!rows.length) return res.status(400).json({ error: 'Nothing to add.' })
    const closed = await dayIsOpen(date)
    if (closed) return res.status(409).json({ error: closed })
    let [entry] = await db.select().from(checklistEntries).where(and(isNull(checklistEntries.templateId), eq(checklistEntries.date, date)))
    if (!entry) [entry] = await db.insert(checklistEntries).values({ templateId: null, date }).returning()
    const added = await db.insert(checklistEntryItems).values(rows.map(r => ({ entryId: entry.id, ...r }))).returning()
    res.status(201).json(Array.isArray(req.body?.items) ? added : added[0])
  } catch (e) { next(e) }
})

// ─── Planning a day ──────────────────────────────────────────────────────────

// Skip a routine item for one day, or bring it back. Any day ahead; today only
// before the item opens (or while an anytime item is still undone), so a skip
// can never erase a miss. The day keeps no score for it and its streak holds.
router.post('/items/:id/skip', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const skip = req.body?.skip !== false
    const [row] = await db.select({ item: checklistEntryItems, date: checklistEntries.date }).from(checklistEntryItems)
      .innerJoin(checklistEntries, eq(checklistEntryItems.entryId, checklistEntries.id))
      .where(eq(checklistEntryItems.id, id))
    if (!row) return res.status(404).json({ error: 'That item was not found.' })
    if (row.item.templateItemId == null) return res.status(400).json({ error: 'A one-day item is deleted, not skipped.' })
    const today = dayKey()
    if (row.date < today) return res.status(409).json({ error: 'A past day can only be corrected, not planned.' })
    const closed = await dayIsOpen(row.date)
    if (closed) return res.status(409).json({ error: closed })
    if (skip) {
      if (row.item.skipped) return res.status(204).send()
      if (row.item.archived) return res.status(409).json({ error: 'That item is not part of this day.' })
      if (row.date === today) {
        const item = (await dayState(today)).items.find(i => i.id === id)
        if (!item || (item.status !== 'upcoming' && item.status !== 'anytime'))
          return res.status(409).json({ error: 'It has already opened, so today it counts. Tick it, or mark it missed.' })
      }
      await db.update(checklistEntryItems).set({ archived: 1, skipped: 1 }).where(eq(checklistEntryItems.id, id))
    } else {
      if (!row.item.skipped) return res.status(204).send()
      await db.update(checklistEntryItems).set({ archived: 0, skipped: 0 }).where(eq(checklistEntryItems.id, id))
    }
    res.status(204).send()
  } catch (e) { next(e) }
})

// One day's plan: what runs, what was skipped, and suggestions to add in one tap:
// one-day items left undone the day before, ones added recently, and items of
// paused routines. Suggestions are never added on their own.
router.get('/plan', async (req, res, next) => {
  try {
    const today = dayKey()
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : addDays(today, 1)
    if (date >= today) await ensureDay(date)
    const state = await dayState(date)
    const locked = date < today ? 'A past day can only be corrected, not planned.' : await dayIsOpen(date)

    const entries = await db.select().from(checklistEntries)
      .where(and(gte(checklistEntries.date, addDays(date, -30)), lte(checklistEntries.date, date)))
    const rows = entries.length ? await db.select().from(checklistEntryItems).where(inArray(checklistEntryItems.entryId, entries.map(e => e.id))) : []
    const entryOf = new Map(entries.map(e => [e.id, e]))
    const tItems = await db.select().from(checklistTemplateItems)
    const tById = new Map(tItems.map(t => [t.id, t]))

    const skipped = rows.filter(r => r.skipped && entryOf.get(r.entryId)?.date === date).map(r => {
      const t = r.templateItemId ? tById.get(r.templateItemId) : undefined
      return { id: r.id, label: t?.label ?? r.label ?? '', time: t?.time ?? null }
    }).sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'))

    const key = (l: string) => l.trim().toLowerCase()
    const taken = new Set([...state.items.map(i => key(i.label)), ...skipped.map(s => key(s.label))])
    type Pick = { label: string; time: string | null; importance: string | null; windowMin: number | null; from?: string }
    const pick = (r: typeof rows[number]): Pick => ({ label: r.label ?? '', time: r.time, importance: r.importance, windowMin: r.windowMin })

    const yesterday = addDays(date, -1)
    const unfinished: Pick[] = []
    for (const r of rows) {
      const e = entryOf.get(r.entryId)!
      if (e.templateId != null || e.date !== yesterday || r.archived || r.completed || !r.label || taken.has(key(r.label))) continue
      taken.add(key(r.label)); unfinished.push(pick(r))
    }
    const recent: Pick[] = []
    for (const r of [...rows].sort((a, b) => entryOf.get(b.entryId)!.date.localeCompare(entryOf.get(a.entryId)!.date) || b.id - a.id)) {
      const e = entryOf.get(r.entryId)!
      if (e.templateId != null || e.date >= date || r.archived || !r.label || taken.has(key(r.label))) continue
      taken.add(key(r.label)); recent.push(pick(r))
      if (recent.length >= 8) break
    }
    const paused: Pick[] = []
    const templates = (await db.select().from(checklistTemplates)).filter(t => !t.enabled && !t.archivedAt && !isWeekly(t))
    for (const t of templates) {
      for (const i of tItems.filter(i => i.templateId === t.id && !i.retiredAt && !i.schedule?.startsWith('once:')).sort((a, b) => a.sortOrder - b.sortOrder)) {
        if (taken.has(key(i.label))) continue
        taken.add(key(i.label))
        paused.push({ label: i.label, time: i.time, importance: i.importance, windowMin: i.windowMin, from: t.name })
      }
    }

    res.json({
      date, today, locked,
      items: state.items.map(i => ({ id: i.id, label: i.label, time: i.time, importance: i.importance, points: i.points, status: i.status, oneOff: i.templateId == null, end: i.end, start: i.start })),
      total: state.total,
      skipped,
      suggestions: { unfinished, recent, paused },
    })
  } catch (e) { next(e) }
})

/** The day a one-off belongs to, if it is one. */
async function oneOffDate(id: number): Promise<string | null> {
  const [row] = await db.select({ date: checklistEntries.date }).from(checklistEntryItems)
    .innerJoin(checklistEntries, eq(checklistEntryItems.entryId, checklistEntries.id))
    .where(and(eq(checklistEntryItems.id, id), isNull(checklistEntryItems.templateItemId)))
  return row?.date ?? null
}

// Delete a one-off, done or not, while its day is open. Undo restores it.
router.delete('/oneoffs/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const date = await oneOffDate(id)
    if (!date) return res.status(404).json({ error: 'That one-off was not found.' })
    const closed = await dayIsOpen(date)
    if (closed) return res.status(409).json({ error: closed })
    await db.update(checklistEntryItems).set({ archived: 1 }).where(eq(checklistEntryItems.id, id))
    res.status(204).send()
  } catch (e) { next(e) }
})

router.post('/oneoffs/:id/restore', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const date = await oneOffDate(id)
    if (!date) return res.status(404).json({ error: 'That one-off was not found.' })
    const closed = await dayIsOpen(date)
    if (closed) return res.status(409).json({ error: closed })
    await db.update(checklistEntryItems).set({ archived: 0 }).where(eq(checklistEntryItems.id, id))
    res.status(204).send()
  } catch (e) { next(e) }
})

// A new, empty routine: daily (scored every day) or weekly (once a week, not scored).
router.post('/templates', async (req, res, next) => {
  try {
    const type = req.body?.type === 'weekly' ? 'weekly' : 'daily'
    const name = String(req.body?.name ?? '').trim() || (type === 'weekly' ? 'Weekly routine' : 'New routine')
    const [t] = await db.insert(checklistTemplates).values({ name, type, enabled: 1 }).returning()
    res.status(201).json(t)
  } catch (e) { next(e) }
})

// Delete a routine. Never used: removed outright. Used: archived, so every
// past day keeps its items and score; it disappears from the app and stops running.
router.delete('/templates/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const used = (await db.select({ id: checklistEntries.id }).from(checklistEntries).where(eq(checklistEntries.templateId, id)).limit(1)).length > 0
    if (used) {
      await db.update(checklistTemplates).set({ archivedAt: new Date().toISOString(), enabled: 0 }).where(eq(checklistTemplates.id, id))
      // Today's untouched items from it go too.
      const today = dayKey()
      const [entry] = await db.select().from(checklistEntries).where(and(eq(checklistEntries.templateId, id), eq(checklistEntries.date, today)))
      if (entry) await db.update(checklistEntryItems).set({ archived: 1 }).where(and(eq(checklistEntryItems.entryId, entry.id), eq(checklistEntryItems.completed, 0)))
    } else {
      await db.delete(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, id))
      await db.delete(checklistTemplates).where(eq(checklistTemplates.id, id))
    }
    res.json({ archived: used })
  } catch (e) { next(e) }
})

export default router
