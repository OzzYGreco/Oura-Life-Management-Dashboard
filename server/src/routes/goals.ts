import { Router } from 'express'
import { db } from '../db'
import { goals, goalTasks, goalRewards } from '../db/schema'
import { eq, desc } from 'drizzle-orm'

const router = Router()

function withChildren(goal: any, tasks: any[], rewards: any[]) {
  const t = tasks.filter(t => t.goalId === goal.id).sort((a, b) => a.sortOrder - b.sortOrder)
  const r = rewards.filter(r => r.goalId === goal.id).sort((a, b) => a.minScore - b.minScore)
  const maxPoints  = t.reduce((s, t) => s + (t.maxPoints ?? 0), 0)
  const earnedPoints = t.reduce((s, t) => s + (t.earnedPoints ?? 0), 0)
  const progressPct  = maxPoints > 0 ? Math.round((earnedPoints / maxPoints) * 100) : 0
  return { ...goal, tasks: t, rewards: r, maxPoints, earnedPoints, progressPct }
}

// GET all goals for a horizon
router.get('/', async (req, res, next) => {
  try {
    const { horizon } = req.query
    const allGoals = await db.select().from(goals)
      .where(horizon ? eq(goals.horizon, horizon as string) : undefined)
      .orderBy(desc(goals.createdAt))
    const allTasks   = await db.select().from(goalTasks)
    const allRewards = await db.select().from(goalRewards)
    res.json(allGoals.map(g => withChildren(g, allTasks, allRewards)))
  } catch (e) { next(e) }
})

// POST create goal period
router.post('/', async (req, res, next) => {
  try {
    const { tasks = [], rewards = [], ...goalData } = req.body
    const [goal] = await db.insert(goals).values(goalData).returning()
    if (tasks.length) {
      await db.insert(goalTasks).values(tasks.map((t: any, i: number) => ({ ...t, goalId: goal.id, sortOrder: i })))
    }
    if (rewards.length) {
      await db.insert(goalRewards).values(rewards.map((r: any, i: number) => ({ ...r, goalId: goal.id, sortOrder: i })))
    }
    const t = await db.select().from(goalTasks).where(eq(goalTasks.goalId, goal.id))
    const r = await db.select().from(goalRewards).where(eq(goalRewards.goalId, goal.id))
    res.status(201).json(withChildren(goal, t, r))
  } catch (e) { next(e) }
})

// GET single goal
router.get('/:id', async (req, res, next) => {
  try {
    const [goal] = await db.select().from(goals).where(eq(goals.id, parseInt(req.params.id)))
    if (!goal) return res.status(404).json({ error: 'Not found' })
    const t = await db.select().from(goalTasks).where(eq(goalTasks.goalId, goal.id))
    const r = await db.select().from(goalRewards).where(eq(goalRewards.goalId, goal.id))
    res.json(withChildren(goal, t, r))
  } catch (e) { next(e) }
})

// PUT update goal metadata + tasks + rewards
router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id)
    const { tasks, rewards, ...goalData } = req.body
    const [goal] = await db.update(goals)
      .set({ ...goalData, updatedAt: new Date().toISOString() })
      .where(eq(goals.id, id)).returning()

    if (tasks !== undefined) {
      await db.delete(goalTasks).where(eq(goalTasks.goalId, id))
      if (tasks.length) {
        await db.insert(goalTasks).values(tasks.map((t: any, i: number) => ({ ...t, goalId: id, sortOrder: i })))
      }
    }
    if (rewards !== undefined) {
      await db.delete(goalRewards).where(eq(goalRewards.goalId, id))
      if (rewards.length) {
        await db.insert(goalRewards).values(rewards.map((r: any, i: number) => ({ ...r, goalId: id, sortOrder: i })))
      }
    }
    const t = await db.select().from(goalTasks).where(eq(goalTasks.goalId, id))
    const r = await db.select().from(goalRewards).where(eq(goalRewards.goalId, id))
    res.json(withChildren(goal, t, r))
  } catch (e) { next(e) }
})

// PATCH score a single task
router.patch('/tasks/:taskId', async (req, res, next) => {
  try {
    const [task] = await db.update(goalTasks)
      .set({ earnedPoints: req.body.earnedPoints })
      .where(eq(goalTasks.id, parseInt(req.params.taskId)))
      .returning()
    res.json(task)
  } catch (e) { next(e) }
})

// DELETE goal period
router.delete('/:id', async (req, res, next) => {
  try {
    await db.delete(goals).where(eq(goals.id, parseInt(req.params.id)))
    res.status(204).send()
  } catch (e) { next(e) }
})

export default router
