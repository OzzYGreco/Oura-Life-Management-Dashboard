import { Router } from 'express'
import { db } from '../db'
import { trainingWorkouts, trainingExercises, trainingBodyMetrics, trainingWeeklySchedule, workoutTemplates } from '../db/schema'
import { eq, and, gte, lte } from 'drizzle-orm'

const router = Router()

// Workouts
const CATS = ['strength', 'cardio', 'sport', 'hiit', 'mobility']
const rpeOf = (v: unknown) => { const n = Number(v); return v == null || v === '' || !Number.isFinite(n) ? null : Math.min(10, Math.max(1, Math.round(n))) }
/** Only the workout's own columns, cleaned. A missing name or date is caught by the caller. */
function workoutFields(b: any) {
  const out: Record<string, unknown> = {}
  if (b.date !== undefined) out.date = String(b.date)
  if (b.name !== undefined) out.name = String(b.name).trim()
  if (b.category !== undefined) out.category = CATS.includes(b.category) ? b.category : 'strength'
  if (b.rpe !== undefined) out.rpe = rpeOf(b.rpe)
  if (b.notes !== undefined) out.notes = b.notes ? String(b.notes) : null
  if (b.durationMinutes !== undefined) out.durationMinutes = b.durationMinutes == null || b.durationMinutes === '' ? null : Math.round(Number(b.durationMinutes)) || null
  return out
}
const exerciseFields = (e: any, workoutId: number, i: number) => ({
  workoutId, sortOrder: i,
  exerciseName: String(e.exerciseName ?? '').trim(),
  sets: e.sets ?? (Array.isArray(e.reps) ? e.reps.length : null),
  reps: Array.isArray(e.reps) ? e.reps.map(Number) : null,
  weight: Array.isArray(e.weight) ? e.weight.map(Number) : null,
  rpe: rpeOf(e.rpe),
  notes: e.notes ?? null,
})

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
    const { exercises } = req.body ?? {}
    const data = workoutFields(req.body ?? {})
    if (!data.date || !data.name) return res.status(400).json({ error: 'A workout needs a date and a name.' })
    const [workout] = await db.insert(trainingWorkouts).values(data as any).returning()
    const list = (Array.isArray(exercises) ? exercises : []).filter((e: any) => String(e?.exerciseName ?? '').trim())
    const savedExercises = list.length
      ? await db.insert(trainingExercises).values(list.map((e: any, i: number) => exerciseFields(e, workout.id, i))).returning()
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
    const { exercises } = req.body ?? {}
    const data = workoutFields(req.body ?? {})
    if (data.name === '' || data.date === '') return res.status(400).json({ error: 'A workout needs a date and a name.' })
    const [workout] = Object.keys(data).length
      ? await db.update(trainingWorkouts).set(data).where(eq(trainingWorkouts.id, id)).returning()
      : await db.select().from(trainingWorkouts).where(eq(trainingWorkouts.id, id))
    if (!workout) return res.status(404).json({ error: 'That workout no longer exists.' })
    if (Array.isArray(exercises)) {
      const list = exercises.filter((e: any) => String(e?.exerciseName ?? '').trim())
      await db.delete(trainingExercises).where(eq(trainingExercises.workoutId, id))
      if (list.length) await db.insert(trainingExercises).values(list.map((e: any, i: number) => exerciseFields(e, id, i)))
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

// Logging a second weight on the same day updates that day's entry instead of failing.
router.post('/metrics', async (req, res, next) => {
  try {
    const { date, weightKg, bodyFatPct, notes } = req.body ?? {}
    if (!date) return res.status(400).json({ error: 'A date is needed.' })
    const patch: Record<string, unknown> = {}
    if (weightKg !== undefined) patch.weightKg = weightKg
    if (bodyFatPct !== undefined) patch.bodyFatPct = bodyFatPct
    if (notes !== undefined) patch.notes = notes
    const [row] = await db.insert(trainingBodyMetrics).values({ date, ...patch })
      .onConflictDoUpdate({ target: trainingBodyMetrics.date, set: patch }).returning()
    res.status(201).json(row)
  } catch (e) { next(e) }
})

router.put('/metrics/:id', async (req, res, next) => {
  try {
    const { date, weightKg, bodyFatPct, notes } = req.body ?? {}
    const patch: Record<string, unknown> = {}
    if (date !== undefined) patch.date = date
    if (weightKg !== undefined) patch.weightKg = weightKg
    if (bodyFatPct !== undefined) patch.bodyFatPct = bodyFatPct
    if (notes !== undefined) patch.notes = notes
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change.' })
    const [row] = await db.update(trainingBodyMetrics).set(patch).where(eq(trainingBodyMetrics.id, parseInt(req.params.id))).returning()
    if (!row) return res.status(404).json({ error: 'That entry no longer exists.' })
    res.json(row)
  } catch (e: any) {
    if (String(e?.message ?? '').includes('UNIQUE')) return res.status(409).json({ error: 'There is already an entry on that date.' })
    next(e)
  }
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
function templateFields(b: any) {
  const out: { name?: string; category?: string; exercises?: { exerciseName: string; defaultSets: number }[] } = {}
  if (b.name !== undefined) out.name = String(b.name).trim()
  if (b.category !== undefined) out.category = CATS.includes(b.category) ? b.category : 'strength'
  if (Array.isArray(b.exercises)) out.exercises = b.exercises
    .filter((e: any) => String(e?.exerciseName ?? '').trim())
    .map((e: any) => ({ exerciseName: String(e.exerciseName).trim(), defaultSets: Math.max(1, Math.min(20, Math.round(Number(e.defaultSets)) || 3)) }))
  return out
}
router.post('/templates', async (req, res, next) => {
  try {
    const t = templateFields(req.body ?? {})
    if (!t.name) return res.status(400).json({ error: 'A template needs a name.' })
    res.status(201).json((await db.insert(workoutTemplates).values({ name: t.name, category: t.category ?? 'strength', exercises: t.exercises ?? [] }).returning())[0])
  } catch (e) { next(e) }
})
router.put('/templates/:id', async (req, res, next) => {
  try {
    const t = templateFields(req.body ?? {})
    if (t.name === '') return res.status(400).json({ error: 'A template needs a name.' })
    if (!Object.keys(t).length) return res.status(400).json({ error: 'Nothing to change.' })
    const [row] = await db.update(workoutTemplates).set(t).where(eq(workoutTemplates.id, parseInt(req.params.id))).returning()
    if (!row) return res.status(404).json({ error: 'That template no longer exists.' })
    res.json(row)
  } catch (e) { next(e) }
})
router.delete('/templates/:id', async (req, res, next) => {
  try { await db.delete(workoutTemplates).where(eq(workoutTemplates.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

// ─── Overview: progression, consistency and what to beat next time ──────────

/** Epley estimate of a one-rep max. Sets over 12 reps or with no weight don't count. */
const e1rm = (kg: number, reps: number) => (kg > 0 && reps > 0 && reps <= 12 ? kg * (1 + reps / 30) : 0)
const r1 = (n: number) => Math.round(n * 10) / 10

router.get('/overview', async (_req, res, next) => {
  try {
    const workouts = (await db.select().from(trainingWorkouts)).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    const sets = await db.select().from(trainingExercises)
    const templates = await db.select().from(workoutTemplates)
    const byWorkout = new Map(workouts.map(w => [w.id, w]))

    // Every exercise's sessions in date order.
    type Session = { date: string; workoutId: number; reps: number[]; weight: number[]; e1rm: number; top: { kg: number; reps: number } | null }
    const lifts = new Map<string, Session[]>()
    for (const e of sets) {
      const w = byWorkout.get(e.workoutId); if (!w) continue
      const reps = (e.reps ?? []).map(Number), weight = (e.weight ?? []).map(Number)
      let best = 0, top: Session['top'] = null
      reps.forEach((r, i) => { const v = e1rm(weight[i] ?? 0, r); if (v > best) { best = v; top = { kg: weight[i], reps: r } } })
      const key = e.exerciseName.trim()
      const list = lifts.get(key) ?? []
      list.push({ date: w.date, workoutId: w.id, reps, weight, e1rm: r1(best), top })
      lifts.set(key, list)
    }
    for (const list of lifts.values()) list.sort((a, b) => a.date.localeCompare(b.date))

    const today = new Date().toISOString().slice(0, 10)
    const eightWeeksAgo = new Date(Date.now() - 56 * 864e5).toISOString().slice(0, 10)
    const progress = [...lifts.entries()].filter(([, l]) => l.some(s => s.e1rm > 0)).map(([name, l]) => {
      const scored = l.filter(s => s.e1rm > 0)
      const best = scored.reduce((m, s) => (s.e1rm > m.e1rm ? s : m), scored[0])
      const last = scored[scored.length - 1]
      const before = scored.filter(s => s.date <= eightWeeksAgo).pop() ?? scored[0]
      // Stalled: the last 3 sessions didn't beat what came before them.
      const recent = scored.slice(-3)
      const prior = scored.slice(0, -3)
      const stalled = recent.length === 3 && prior.length > 0 && Math.max(...recent.map(s => s.e1rm)) <= Math.max(...prior.map(s => s.e1rm))
      return {
        name, sessions: scored.length,
        current: last.e1rm, lastDate: last.date,
        best: { e1rm: best.e1rm, date: best.date, kg: best.top?.kg ?? 0, reps: best.top?.reps ?? 0 },
        change: r1(last.e1rm - before.e1rm), since: before.date,
        stalled,
        history: scored.slice(-16).map(s => ({ date: s.date, e1rm: s.e1rm })),
      }
    }).sort((a, b) => b.sessions - a.sessions)

    // What to beat: each exercise's last session, and a target one small step up.
    const last: Record<string, { date: string; reps: number[]; weight: number[]; target: string }> = {}
    for (const [name, l] of lifts) {
      const s = l[l.length - 1]
      const topIdx = s.weight.reduce((bi, w, i) => (w > (s.weight[bi] ?? 0) || (w === s.weight[bi] && (s.reps[i] ?? 0) > (s.reps[bi] ?? 0)) ? i : bi), 0)
      const kg = s.weight[topIdx] ?? 0, reps = s.reps[topIdx] ?? 0
      last[name] = {
        date: s.date, reps: s.reps, weight: s.weight,
        target: kg > 0 ? (reps >= 10 ? `${kg + 2.5} kg × ${Math.max(6, reps - 2)}` : `${kg} kg × ${reps + 1}`) : `${reps + 2} reps`,
      }
    }

    // Workouts per week (Sunday to Saturday), last 12 weeks.
    const sunday = (d: string) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - x.getDay()); return x.toISOString().slice(0, 10) }
    const thisWeek = sunday(today)
    const weeks = Array.from({ length: 12 }, (_, i) => { const x = new Date(thisWeek + 'T12:00:00'); x.setDate(x.getDate() - 7 * (11 - i)); return x.toISOString().slice(0, 10) })
      .map(start => {
        const inWeek = workouts.filter(w => sunday(w.date) === start)
        const byCat: Record<string, number> = {}
        for (const w of inWeek) byCat[w.category] = (byCat[w.category] ?? 0) + 1
        return { start, count: inWeek.length, byCat }
      })

    res.json({
      today,
      templates: templates.map(t => ({ id: t.id, name: t.name, category: t.category, exercises: (t.exercises as any[]) ?? [] })),
      last,
      progress,
      weeks,
      recent: [...workouts].reverse().slice(0, 12).map(w => ({
        id: w.id, date: w.date, name: w.name, category: w.category, durationMinutes: w.durationMinutes, rpe: w.rpe,
        exercises: sets.filter(e => e.workoutId === w.id).sort((a, b) => a.sortOrder - b.sortOrder).map(e => ({ name: e.exerciseName, reps: e.reps ?? [], weight: e.weight ?? [] })),
      })),
      totals: { workouts: workouts.length, first: workouts[0]?.date ?? null },
    })
  } catch (e) { next(e) }
})

export default router
