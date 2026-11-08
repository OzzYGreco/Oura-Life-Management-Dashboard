import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { checklistEntryItems, checklistEntries, dayReviews } from '../db/schema'
import { todayView } from '../lib/today'
import { dayKey, dayState, closeDay, tickBlocked, minutesInto, reopenDay, reopenInfo, ensureWeek, weekStart, weeklyTemplateIds } from '../lib/day'
import { getAppSettings, setAppSettings } from '../lib/appSettings'
import { notifierInstalled, notifierStatus, notifyOnce } from '../lib/notify'
import fs from 'fs'
import path from 'path'
import { avatarUpload } from '../middleware/upload'

const router = Router()

const ISO = /^\d{4}-\d{2}-\d{2}$/
/** The day a request is about: `date` when given and valid, otherwise today. */
const dayOf = (v: unknown) => (typeof v === 'string' && ISO.test(v) ? v : dayKey())

// The home screen's view model. ?date= shows another day in the day block.
router.get('/', async (req, res, next) => {
  try { res.json(await todayView(new Date(), dayOf(req.query.date))) } catch (e) { next(e) }
})

/** Loads an item of an open day, or says why it can't be changed. */
type Opened = { error: readonly [number, string] } | { item: Awaited<ReturnType<typeof dayState>>['items'][number]; date: string }
async function openItem(id: number, date: string): Promise<Opened> {
  if (date > dayKey()) return { error: [409, "That day hasn't started yet. Items can be ticked once it has."] as const }
  const state = await dayState(date)
  const item = state.items.find(i => i.id === id)
  if (!item) return { error: [404, 'That item is not part of that day.'] as const }
  if (state.closed) return { error: [409, date === dayKey() ? 'Today is already closed.' : 'That day is closed. Use "Correct this day" to reopen it.'] as const }
  return { item, date }
}

// Tick or untick an item. Ticks are scored by the time they happen; an item
// that hasn't opened yet can't be ticked; a tick on a reopened past day is late.
router.post('/items/:id/tick', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const done = req.body?.done !== false
    const date = dayOf(req.body?.date)
    const r = await openItem(id, date)
    if ('error' in r) return res.status(r.error[0]).json({ error: r.error[1] })
    if (done) {
      const blocked = tickBlocked(r.item, minutesInto(date, new Date()))
      if (blocked) return res.status(409).json({ error: blocked })
    }
    await db.update(checklistEntryItems)
      .set({ completed: done ? 1 : 0, completedAt: done ? new Date().toISOString() : null, ...(done ? { result: null } : {}) })
      .where(eq(checklistEntryItems.id, id))
    res.json(await todayView(new Date(), date))
  } catch (e) { next(e) }
})

// Mark an item missed (or take that back). An honest "didn't happen": it earns
// nothing and still counts against the day, exactly like a window running out,
// just recorded now. Ticked items must be unticked first.
router.post('/items/:id/missed', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const missed = req.body?.missed !== false
    const date = dayOf(req.body?.date)
    const r = await openItem(id, date)
    if ('error' in r) return res.status(r.error[0]).json({ error: r.error[1] })
    if (missed && (r.item.status === 'on_time' || r.item.status === 'late')) return res.status(409).json({ error: 'Untick it first, then mark it missed.' })
    await db.update(checklistEntryItems).set({ result: missed ? 'missed' : null }).where(eq(checklistEntryItems.id, id))
    res.json(await todayView(new Date(), date))
  } catch (e) { next(e) }
})

// The evening review: reasons for misses, one line of reflection, and the
// day closes with its score locked. With `date`, closes a reopened past day again.
router.post('/close', async (req, res, next) => {
  try {
    const { reflection, reasons } = req.body ?? {}
    const date = dayOf(req.body?.date)
    if (date > dayKey()) return res.status(409).json({ error: "That day hasn't started yet." })
    if (date < dayKey() && !(await reopenInfo(date))) {
      const [done] = await db.select().from(dayReviews).where(eq(dayReviews.date, date))
      if (!done) return res.status(409).json({ error: 'That day is not open.' })
    }
    const review = await closeDay(date, { reflection, reasons })
    res.json({ review, view: await todayView(new Date(), date) })
  } catch (e) { next(e) }
})

// "Correct this day": reopens a closed day so its items can be ticked or
// unticked. It closes again with the review, or by itself at the next 04:00.
router.post('/days/:date/reopen', async (req, res, next) => {
  try {
    const date = req.params.date
    if (!ISO.test(date)) return res.status(400).json({ error: 'Use a date like 2026-11-06.' })
    if (date > dayKey()) return res.status(409).json({ error: "That day hasn't started yet." })
    if (!(await reopenDay(date))) return res.status(409).json({ error: 'That day is not closed.' })
    res.json(await todayView(new Date(), date))
  } catch (e) { next(e) }
})

// Tick (or untick) a weekly-routine item: once a week, any day of it.
router.post('/weekly/:id/tick', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const done = req.body?.done !== false
    const today = dayKey()
    await ensureWeek(today)
    const [row] = await db.select({ item: checklistEntryItems, entry: checklistEntries }).from(checklistEntryItems)
      .innerJoin(checklistEntries, eq(checklistEntryItems.entryId, checklistEntries.id))
      .where(and(eq(checklistEntryItems.id, id)))
    const weekly = await weeklyTemplateIds()
    if (!row || row.entry.templateId == null || !weekly.has(row.entry.templateId)) return res.status(404).json({ error: 'That is not a weekly item.' })
    if (row.entry.date !== weekStart(today)) return res.status(409).json({ error: 'Only this week can be ticked.' })
    await db.update(checklistEntryItems)
      .set({ completed: done ? 1 : 0, completedAt: done ? new Date().toISOString() : null })
      .where(eq(checklistEntryItems.id, id))
    res.json(await todayView(new Date(), dayOf(req.body?.date)))
  } catch (e) { next(e) }
})

// App settings: skin, notifications, alert lead time, review time, quiet hours.
router.get('/settings', async (_req, res, next) => {
  try { res.json({ ...(await getAppSettings()), notifierInstalled: notifierInstalled() }) } catch (e) { next(e) }
})
router.put('/settings', async (req, res, next) => {
  try { res.json({ ...(await setAppSettings(req.body ?? {})), notifierInstalled: notifierInstalled() }) } catch (e) { next(e) }
})

// The owner's picture: replacing or removing it also deletes the old file.
const removeAvatarFile = (url: string) => {
  if (!url.startsWith('/uploads/profile/')) return
  fs.rm(path.join(__dirname, '../../uploads', url.replace('/uploads/', '')), { force: true }, () => {})
}
router.post('/avatar', avatarUpload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose an image.' })
    const old = (await getAppSettings()).avatar
    const s = await setAppSettings({ avatar: `/uploads/profile/${req.file.filename}` })
    removeAvatarFile(old)
    res.json({ avatar: s.avatar })
  } catch (e) { next(e) }
})
router.delete('/avatar', async (_req, res, next) => {
  try {
    removeAvatarFile((await getAppSettings()).avatar)
    await setAppSettings({ avatar: '' })
    res.json({ avatar: '' })
  } catch (e) { next(e) }
})

// Sends one notification now, so the owner can see what reminders look like.
// How reminders arrive right now: through which route, and what macOS allows.
router.get('/settings/notifier', async (_req, res, next) => {
  try { res.json(await notifierStatus()) } catch (e) { next(e) }
})

router.post('/settings/test', async (_req, res, next) => {
  try {
    const s = await getAppSettings()
    const sent = await notifyOnce({
      key: `test:${Date.now()}`,
      title: 'Test reminder',
      body: s.notifications === 'on' ? 'Reminders are on. This is what one looks like.' : 'Reminders are off, so none will fire until you turn them on.',
      url: `${s.appUrl}/checklists`,
    })
    res.json({ sent, notifierInstalled: notifierInstalled(), notifier: await notifierStatus() })
  } catch (e) { next(e) }
})

export default router
