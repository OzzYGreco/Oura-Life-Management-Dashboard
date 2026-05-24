import { Router } from 'express'
import { db } from '../db'
import { trainingWorkouts, trainingExercises, trainingBodyMetrics, trainingWeeklySchedule, workoutTemplates } from '../db/schema'
import { eq, and, gte, lte } from 'drizzle-orm'

const router = Router()

// Workouts
router.get('/workouts', async (req, res, next) => {
  try {
    const { from, to } = req.query
    const conds: any[] = []
    if (from) conds.push(gte(trainingWorkouts.date, from as string))
    if (to) conds.push(lte(trainingWorkouts.date, to as string))
    const workouts = await db.select().from(trainingWorkouts).where(conds.length ? and(...conds) : undefined)
    const exercises = await db.select().from(trainingExercises)
    res.json(workouts.map(w => ({ ...w, exercises: exercises.filter(e => e.workoutId === w.id).sort((a, b) => a.sortOrder - b.sortOrder) })))
  } catch (e) { next(e) }
})

router.post('/workouts', async (req, res, next) => {
  try {
    const { exercises, ...workoutData } = req.body
    const [workout] = await db.insert(trainingWorkouts).values(workoutData).returning()
    const savedExercises = exercises?.length
      ? await db.insert(trainingExercises).values(exercises.map((e: any, i: number) => ({ ...e, workoutId: workout.id, sortOrder: i }))).returning()
      : []
    res.status(201).json({ ...workout, exercises: savedExercises })
  } catch (e) { next(e) }
})

router.get('/workouts/:id', async (req, res, next) => {
  try {
    const [workout] = await db.select().from(trainingWorkouts).where(eq(trainingWorkouts.id, parseInt(req.params.id)))
    if (!workout) return res.status(404).json({ error: 'Not found' })
    const exercises = await db.select().from(trainingExercises).where(eq(trainingExercises.workoutId, workout.id))
    res.json({ ...workout, exercises })
  } catch (e) { next(e) }
})

router.put('/workouts/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id)
    const { exercises, ...workoutData } = req.body
    const [workout] = await db.update(trainingWorkouts).set(workoutData).where(eq(trainingWorkouts.id, id)).returning()
    if (exercises !== undefined) {
      await db.delete(trainingExercises).where(eq(trainingExercises.workoutId, id))
      if (exercises.length) {
        await db.insert(trainingExercises).values(exercises.map((e: any, i: number) => ({ ...e, workoutId: id, sortOrder: i })))
      }
    }
    res.json(workout)
  } catch (e) { next(e) }
})

router.delete('/workouts/:id', async (req, res, next) => {
  try { await db.delete(trainingWorkouts).where(eq(trainingWorkouts.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

// Body Metrics
router.get('/metrics', async (req, res, next) => {
  try {
    const { from, to } = req.query
    const conds: any[] = []
    if (from) conds.push(gte(trainingBodyMetrics.date, from as string))
    if (to) conds.push(lte(trainingBodyMetrics.date, to as string))
    res.json(await db.select().from(trainingBodyMetrics).where(conds.length ? and(...conds) : undefined))
  } catch (e) { next(e) }
})

router.post('/metrics', async (req, res, next) => {
  try { res.status(201).json((await db.insert(trainingBodyMetrics).values(req.body).returning())[0]) } catch (e) { next(e) }
})

router.put('/metrics/:id', async (req, res, next) => {
  try { res.json((await db.update(trainingBodyMetrics).set(req.body).where(eq(trainingBodyMetrics.id, parseInt(req.params.id))).returning())[0]) } catch (e) { next(e) }
})

router.delete('/metrics/:id', async (req, res, next) => {
  try { await db.delete(trainingBodyMetrics).where(eq(trainingBodyMetrics.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

// Weekly Schedule
router.get('/schedule', async (req, res, next) => {
  try {
    const { weekStart } = req.query
    const all = await db.select().from(trainingWeeklySchedule)
    res.json(weekStart ? all.filter(s => s.weekStart === weekStart) : all)
  } catch (e) { next(e) }
})

router.put('/schedule', async (req, res, next) => {
  try {
    const { weekStart, dayOfWeek, plannedWorkout, actualWorkoutId } = req.body
    const existing = await db.select().from(trainingWeeklySchedule)
      .where(and(eq(trainingWeeklySchedule.weekStart, weekStart), eq(trainingWeeklySchedule.dayOfWeek, dayOfWeek)))
    if (existing.length) {
      const [row] = await db.update(trainingWeeklySchedule).set({ plannedWorkout, actualWorkoutId }).where(eq(trainingWeeklySchedule.id, existing[0].id)).returning()
      return res.json(row)
    }
    const [row] = await db.insert(trainingWeeklySchedule).values(req.body).returning()
    res.status(201).json(row)
  } catch (e) { next(e) }
})

// ─── Workout Templates ────────────────────────────────────────────────────────

router.get('/templates', async (_req, res, next) => {
  try { res.json(await db.select().from(workoutTemplates).orderBy(workoutTemplates.name)) } catch (e) { next(e) }
})
router.post('/templates', async (req, res, next) => {
  try { res.status(201).json((await db.insert(workoutTemplates).values(req.body).returning())[0]) } catch (e) { next(e) }
})
router.put('/templates/:id', async (req, res, next) => {
  try { res.json((await db.update(workoutTemplates).set(req.body).where(eq(workoutTemplates.id, parseInt(req.params.id))).returning())[0]) } catch (e) { next(e) }
})
router.delete('/templates/:id', async (req, res, next) => {
  try { await db.delete(workoutTemplates).where(eq(workoutTemplates.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

export default router
