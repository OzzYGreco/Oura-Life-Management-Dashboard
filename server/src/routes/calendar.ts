import { Router } from 'express'
import { db } from '../db'
import { calendarEvents } from '../db/schema'
import { eq, and, gte, lte } from 'drizzle-orm'

const router = Router()

router.get('/events', async (req, res, next) => {
  try {
    const { from, to } = req.query
    const conds: any[] = []
    if (from) conds.push(gte(calendarEvents.startDatetime, from as string))
    if (to) conds.push(lte(calendarEvents.startDatetime, to as string))
    res.json(await db.select().from(calendarEvents).where(conds.length ? and(...conds) : undefined))
  } catch (e) { next(e) }
})

router.post('/events', async (req, res, next) => {
  try { res.status(201).json((await db.insert(calendarEvents).values(req.body).returning())[0]) } catch (e) { next(e) }
})

router.put('/events/:id', async (req, res, next) => {
  try { res.json((await db.update(calendarEvents).set(req.body).where(eq(calendarEvents.id, parseInt(req.params.id))).returning())[0]) } catch (e) { next(e) }
})

router.delete('/events/:id', async (req, res, next) => {
  try { await db.delete(calendarEvents).where(eq(calendarEvents.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

export default router
