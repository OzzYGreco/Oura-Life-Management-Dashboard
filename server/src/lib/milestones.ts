/**
 * Milestones: the yearly and 3-year level of the goal chain. A milestone is
 * reached or not; it is never scored. Its current value comes from where it
 * is measured (typed by hand, a checklist of steps, or the app's own data),
 * and its pace compares progress with the straight line from start to due.
 */
import { and, eq, gte, isNotNull, lte } from 'drizzle-orm'
import { db } from '../db'
import {
  dayReviews, goalTasks, goals, milestoneSteps, milestones,
  trades, trainingExercises, trainingWorkouts,
} from '../db/schema'
import { currentMrr, loadBusinessData } from './businessMetrics'
import { getAppSettings } from './appSettings'

export const MEASURES = [
  { value: 'manual',            label: 'Typed by hand',            unit: null },
  { value: 'steps',             label: 'Steps ticked off',         unit: 'steps' },
  { value: 'business_mrr',      label: 'Business MRR',             unit: 'GBP' },
  { value: 'business_clients',  label: 'Active clients',           unit: 'clients' },
  { value: 'routine_avg',       label: 'Average day score',        unit: 'points' },
  { value: 'trading_net_r',     label: 'Trading net R',            unit: 'R' },
  { value: 'training_workouts', label: 'Workouts logged',          unit: 'workouts' },
  { value: 'training_lift',     label: 'A lift\'s estimated max',  unit: 'kg' },
  { value: 'weeks_beaten',      label: 'Weeks beaten',             unit: 'weeks' },
] as const
export type Measure = (typeof MEASURES)[number]['value']
export const isMeasure = (v: unknown): v is Measure => MEASURES.some(m => m.value === v)

type Milestone = typeof milestones.$inferSelect
type Step = typeof milestoneSteps.$inferSelect

const round2 = (n: number) => Math.round(n * 100) / 100
const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const days = (from: string, to: string) => Math.round((new Date(to + 'T12:00:00').getTime() - new Date(from + 'T12:00:00').getTime()) / 864e5)
const e1rm = (kg: number, reps: number) => (kg > 0 && reps > 0 && reps <= 12 ? kg * (1 + reps / 30) : 0)

/** The milestone's current value from its measure. Null when it can't be read. */
export async function currentValue(m: Milestone, steps: Step[]): Promise<number | null> {
  const to = todayIso()
  const from = m.startDate
  switch (m.measure as Measure) {
    case 'manual': return m.manualValue
    case 'steps': return steps.filter(s => s.doneAt).length
    case 'business_mrr': return currentMrr(await loadBusinessData()).current
    case 'business_clients': return currentMrr(await loadBusinessData()).activeCount
    case 'routine_avg': {
      // The average closed day over the last 30 days: a habit, measured as it is now.
      const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
      const rows = await db.select().from(dayReviews).where(and(gte(dayReviews.date, since), lte(dayReviews.date, to)))
      return rows.length ? round2(rows.reduce((s, r) => s + r.score, 0) / rows.length) : null
    }
    case 'trading_net_r': {
      // Closed trades since the start, each in R of its planned risk; trades without a planned risk don't count.
      const rows = await db.select().from(trades).where(and(gte(trades.date, from), isNotNull(trades.exitPrice)))
      return round2(rows.reduce((s, t) => s + (t.riskDollars && t.riskDollars > 0 && t.netPnl != null ? t.netPnl / t.riskDollars : 0), 0))
    }
    case 'training_workouts': {
      const rows = await db.select().from(trainingWorkouts).where(and(gte(trainingWorkouts.date, from), lte(trainingWorkouts.date, to)))
      return rows.length
    }
    case 'training_lift': {
      // The best estimated one-rep max for the named lift, ever: a lift milestone is about where you are now.
      const name = (m.measureParam ?? '').trim().toLowerCase()
      if (!name) return null
      const sets = await db.select().from(trainingExercises)
      let best = 0
      for (const e of sets) {
        if (e.exerciseName.trim().toLowerCase() !== name) continue
        const reps = (e.reps ?? []).map(Number), weight = (e.weight ?? []).map(Number)
        reps.forEach((r, i) => { best = Math.max(best, e1rm(weight[i] ?? 0, r)) })
      }
      return best ? Math.round(best * 10) / 10 : null
    }
    case 'weeks_beaten': {
      // Weekly periods inside the milestone's dates that reached the "beaten at" score.
      const settings = await getAppSettings()
      let threshold = 7
      try { threshold = JSON.parse(settings.goalsSettings ?? '{}')?.weekly?.threshold ?? 7 } catch { /* default */ }
      const weeks = await db.select().from(goals).where(and(eq(goals.horizon, 'weekly'), gte(goals.periodStart, from), lte(goals.periodStart, to)))
      if (!weeks.length) return 0
      const tasks = await db.select().from(goalTasks)
      return weeks.filter(w => tasks.filter(t => t.goalId === w.id).reduce((s, t) => s + (t.earnedPoints ?? 0), 0) >= threshold).length
    }
  }
  return null
}

export interface Pace {
  current: number | null
  target: number | null
  start: number | null
  /** 0 to 1: how far from start to target. */
  progress: number | null
  /** 0 to 1: how far through the dates. */
  elapsed: number
  daysLeft: number
  met: boolean
  /** on (within 5 points of the line), ahead, behind; null when it can't be judged. */
  pace: 'ahead' | 'on' | 'behind' | null
  /** Where the current rate lands on the due date. */
  projected: number | null
  /** What's still needed per 30 days to land on target. */
  neededPerMonth: number | null
  overdue: boolean
}

export function paceOf(m: Milestone, current: number | null, steps: Step[]): Pace {
  const today = todayIso()
  const total = Math.max(1, days(m.startDate, m.dueDate))
  const gone = Math.min(total, Math.max(0, days(m.startDate, today)))
  const elapsed = gone / total
  const daysLeft = Math.max(0, days(today, m.dueDate))
  const target = m.measure === 'steps' ? steps.length : m.targetValue
  const start = m.measure === 'steps' ? 0 : (m.startValue ?? 0)
  const up = m.higherIsBetter
  const met = current != null && target != null && (up ? current >= target : current <= target)
  let progress: number | null = null, projected: number | null = null, needed: number | null = null
  let pace: Pace['pace'] = null
  if (current != null && target != null && target !== start) {
    progress = Math.max(0, Math.min(1, (current - start) / (target - start)))
    if (elapsed > 0.02) {
      projected = round2(start + (current - start) / elapsed)
      pace = progress >= elapsed + 0.05 ? 'ahead' : progress >= elapsed - 0.05 ? 'on' : 'behind'
    }
    needed = daysLeft > 0 ? round2(((target - current) / daysLeft) * 30) : null
  }
  if (met) pace = 'ahead'
  return { current, target, start, progress, elapsed: round2(elapsed), daysLeft, met, pace, projected, neededPerMonth: needed, overdue: !met && today > m.dueDate }
}

/** Every milestone with its steps, current value and pace. Open milestones whose target is met become reached, dated today. */
export async function milestonesView() {
  const all = await db.select().from(milestones)
  const steps = await db.select().from(milestoneSteps)
  const links = await db.select({ id: goalTasks.id, goalId: goalTasks.goalId, title: goalTasks.title, milestoneId: goalTasks.milestoneId })
    .from(goalTasks).where(isNotNull(goalTasks.milestoneId))
  const out = []
  for (const m of all.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.sortOrder - b.sortOrder)) {
    const st = steps.filter(s => s.milestoneId === m.id).sort((a, b) => a.sortOrder - b.sortOrder)
    let current: number | null = null
    try { current = await currentValue(m, st) } catch { current = null }
    const p = paceOf(m, current, st)
    let row = m
    if (m.status === 'open' && p.met) {
      const [u] = await db.update(milestones).set({ status: 'reached', reachedAt: todayIso(), updatedAt: new Date().toISOString() })
        .where(eq(milestones.id, m.id)).returning()
      row = u
    }
    out.push({ ...row, steps: st, ...p, fedBy: links.filter(l => l.milestoneId === m.id).map(l => ({ taskId: l.id, goalId: l.goalId, title: l.title })) })
  }
  return out
}
