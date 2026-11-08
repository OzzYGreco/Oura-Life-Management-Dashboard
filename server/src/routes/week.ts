/**
 * The Goal crushers page: this period's score with tasks that score themselves
 * from data, the next period's plan, the long history and the tasks that keep
 * slipping. One set of routes serves every horizon (`?horizon=weekly|monthly|
 * yearly|3yr`, weekly by default). Weeks run Sunday to Saturday, as the
 * owner's 110 weeks of history do; months and years are calendar ones; a
 * 3-year period starts on 1 January and runs three calendar years.
 */
import { Router } from 'express'
import { and, eq, gte, inArray, lt, lte, desc } from 'drizzle-orm'
import { db } from '../db'
import { goals, goalTasks, goalRewards, dayReviews, milestones } from '../db/schema'
import { addDays, dayKey, dayState, type DayState } from '../lib/day'
import { autoPoints, weekBlock, weeklyGoalOn } from '../lib/today'

const router = Router()
const SOURCES = ['manual', 'checklist', 'workouts', 'trading_rules', 'journal_reviewed'] as const
const HORIZONS = ['weekly', 'monthly', 'yearly', '3yr'] as const
type Horizon = typeof HORIZONS[number]
type Goal = typeof goals.$inferSelect
const round2 = (n: number) => Math.round(n * 100) / 100
const horizonOf = (v: unknown): Horizon => (HORIZONS as readonly string[]).includes(String(v)) ? v as Horizon : 'weekly'
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const UNIT: Record<Horizon, string> = { weekly: 'week', monthly: 'month', yearly: 'year', '3yr': '3-year period' }

// ─── Periods ─────────────────────────────────────────────────────────────────

function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10)
}

/** The natural last day of a period that starts on `from`. */
function periodEnd(h: Horizon, from: string): string {
  if (h === 'weekly') return addDays(from, 6)
  return addDays(addMonths(from, h === 'monthly' ? 1 : h === 'yearly' ? 12 : 36), -1)
}

/** The natural period that contains `date`. */
function naturalPeriod(h: Horizon, date: string): { from: string; to: string } {
  let from: string
  if (h === 'weekly') from = addDays(date, -new Date(date + 'T12:00:00Z').getUTCDay())
  else if (h === 'monthly') from = date.slice(0, 8) + '01'
  else from = date.slice(0, 4) + '-01-01'
  return { from, to: periodEnd(h, from) }
}

/** The goal of this horizon running on `date`. Weekly keeps using the shared lookup, so it behaves exactly as before. */
async function goalOn(h: Horizon, date: string): Promise<Goal | null> {
  if (h === 'weekly') return weeklyGoalOn(date)
  const [g] = await db.select().from(goals)
    .where(and(eq(goals.horizon, h), lte(goals.periodStart, date), gte(goals.periodEnd, date)))
    .orderBy(desc(goals.id)).limit(1)
  return g ?? null
}

/** Another goal of the same horizon whose dates overlap from..to, if any. */
async function overlapping(h: Horizon, from: string, to: string, except: number[] = []): Promise<Goal | null> {
  const rows = await db.select().from(goals)
    .where(and(eq(goals.horizon, h), lte(goals.periodStart, to), gte(goals.periodEnd, from)))
  return rows.find(g => !except.includes(g.id)) ?? null
}

function datesError(from: unknown, to: unknown): string | null {
  if (!isDate(from) || !isDate(to)) return 'Pick a start and an end date.'
  if (from > to) return 'The period has to end after it starts.'
  return null
}

const fmt = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

// ─── Scores ──────────────────────────────────────────────────────────────────

/** A finished or closed period's data-fed tasks get their final points written down, so history never shifts. */
async function freezePast(h: Horizon, today: string) {
  const past = await db.select().from(goals).where(and(eq(goals.horizon, h), lt(goals.periodEnd, today)))
  const empty = await dayState(today, 0)
  for (const g of past) {
    const tasks = await db.select().from(goalTasks).where(eq(goalTasks.goalId, g.id))
    for (const t of tasks) {
      if (t.source === 'manual' || t.earnedPoints != null) continue
      const a = await autoPoints(t, g.periodStart!, g.periodEnd!, { ...empty, date: '0000-00-00', score: null })
      await db.update(goalTasks).set({ earnedPoints: round2(a.earned) }).where(eq(goalTasks.id, t.id))
    }
  }
}

/** Live scores for a running period: the weekly one is the same block the Today page shows. */
async function liveBlock(h: Horizon, g: Goal, today: string, state: DayState) {
  if (h === 'weekly') return weekBlock(today, state)
  const from = g.periodStart!, to = g.periodEnd!
  const taskRows = (await db.select().from(goalTasks).where(eq(goalTasks.goalId, g.id))).sort((a, b) => a.sortOrder - b.sortOrder)
  const rewards = (await db.select().from(goalRewards).where(eq(goalRewards.goalId, g.id))).sort((a, b) => a.minScore - b.minScore)
  const tasks = []
  for (const t of taskRows) {
    const a = await autoPoints(t, from, to, state)
    tasks.push({ id: t.id, title: t.title, source: t.source, max: t.maxPoints, earned: round2(a.earned), note: a.note })
  }
  const score = round2(tasks.reduce((s, t) => s + t.earned, 0))
  const max = round2(tasks.reduce((s, t) => s + t.max, 0))
  const ladder = rewards.map(r => ({ at: r.minScore, reward: r.reward, reached: score >= r.minScore }))
  const nextReward = ladder.find(r => !r.reached) ?? null
  const remaining = tasks.reduce((s, t) => s + (t.max - t.earned), 0)
  let stakes: string | null = null
  if (nextReward) {
    const gap = round2(nextReward.at - score)
    stakes = gap > remaining
      ? `${nextReward.reward} is out of reach this ${UNIT[h]}: you need ${gap} more and only ${round2(remaining)} is left to earn.`
      : `${gap} more point${gap === 1 ? '' : 's'} for ${nextReward.reward}.`
  }
  const lever = [...tasks].sort((a, b) => (b.max - b.earned) - (a.max - a.earned))[0]
  const coach = lever && lever.max - lever.earned > 0
    ? `Biggest lever: ${lever.title} is at ${lever.earned} of ${lever.max}. Finishing it adds ${round2(lever.max - lever.earned)}.`
    : null
  return { goalId: g.id, focus: g.focus, from, to, score, max, tasks, ladder, nextReward, stakes, coach, lastWeek: null }
}

async function goalPayload(g: Goal) {
  const tasks = (await db.select().from(goalTasks).where(eq(goalTasks.goalId, g.id))).sort((a, b) => a.sortOrder - b.sortOrder)
  const rewards = (await db.select().from(goalRewards).where(eq(goalRewards.goalId, g.id))).sort((a, b) => a.minScore - b.minScore)
  // What each task serves up the chain, by name, so any period can show it.
  const pIds = tasks.map(t => t.parentTaskId).filter((x): x is number => x != null)
  const mIds = tasks.map(t => t.milestoneId).filter((x): x is number => x != null)
  const parents = pIds.length ? await db.select({ id: goalTasks.id, title: goalTasks.title }).from(goalTasks).where(inArray(goalTasks.id, pIds)) : []
  const ms = mIds.length ? await db.select({ id: milestones.id, title: milestones.title }).from(milestones).where(inArray(milestones.id, mIds)) : []
  const up = (t: typeof tasks[number]) => parents.find(x => x.id === t.parentTaskId)?.title ?? ms.find(x => x.id === t.milestoneId)?.title ?? null
  return {
    id: g.id, focus: g.focus, from: g.periodStart, to: g.periodEnd, closed: g.status !== 'active',
    tasks: tasks.map(t => ({ id: t.id, title: t.title, maxPoints: t.maxPoints, earnedPoints: t.earnedPoints, source: t.source, target: t.target, parentTaskId: t.parentTaskId, milestoneId: t.milestoneId, up: up(t) })),
    rewards: rewards.map(r => ({ id: r.id, minScore: r.minScore, reward: r.reward })),
  }
}

// ─── Read ────────────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const h = horizonOf(req.query.horizon)
    const today = dayKey()
    await freezePast(h, today)
    const state = await dayState(today)

    const current = await goalOn(h, today)
    // A period closed by hand keeps its frozen scores; only an open one is scored live.
    const isOpen = !!current && current.status === 'active'
    const live = current ? await liveBlock(h, current, today, state) : null
    // The next period: the one after the current, or (with none running) the first one planned ahead.
    const next = current
      ? await goalOn(h, addDays(current.periodEnd!, 1))
      : (await db.select().from(goals).where(and(eq(goals.horizon, h), gte(goals.periodStart, addDays(today, 1)))).orderBy(goals.periodStart).limit(1))[0] ?? null
    const nextStart = current ? addDays(current.periodEnd!, 1) : next?.periodStart ?? null

    // History: every goal of this horizon with its final (or live) score.
    const all = (await db.select().from(goals).where(eq(goals.horizon, h))).sort((a, b) => (a.periodStart ?? '').localeCompare(b.periodStart ?? ''))
    const tasks = await db.select().from(goalTasks)
    const rewards = await db.select().from(goalRewards)
    const reviews = await db.select().from(dayReviews)
    const history = all.filter(g => g.periodStart! <= today).map(g => {
      const ts = tasks.filter(t => t.goalId === g.id).sort((a, b) => a.sortOrder - b.sortOrder)
      const isLive = g.id === current?.id && isOpen && live
      const earned = (t: typeof ts[number]) => isLive ? (live.tasks.find(x => x.id === t.id)?.earned ?? t.earnedPoints) : t.earnedPoints
      const max = round2(ts.reduce((s, t) => s + t.maxPoints, 0))
      const score = isLive ? live.score : round2(ts.reduce((s, t) => s + (t.earnedPoints ?? 0), 0))
      const rs = rewards.filter(r => r.goalId === g.id).sort((a, b) => b.minScore - a.minScore)
      // What the routine data said that period: the average closed day score.
      const days = reviews.filter(r => r.date >= g.periodStart! && r.date <= g.periodEnd!)
      const dayAvg = days.length ? Math.round(days.reduce((x, r) => x + r.score, 0) / days.length) : null
      // How the period's routine task was scored by hand (the one titled like "daily tasks").
      const daily = ts.find(t => /daily task|to-do|routine|checklist/i.test(t.title) && t.maxPoints > 0)
      const dailyPct = daily && daily.earnedPoints != null && daily.source === 'manual' ? Math.round((daily.earnedPoints / daily.maxPoints) * 100) : null
      return {
        id: g.id, from: g.periodStart, to: g.periodEnd, focus: g.focus, score, max,
        reward: rs.find(r => score >= r.minScore)?.reward ?? null,
        current: g.id === current?.id, closed: g.status !== 'active' && g.periodEnd! >= today,
        dayAvg, dailyPct,
        tasks: ts.map(t => ({ title: t.title, max: t.maxPoints, earned: earned(t) })),
      }
    })

    // Tasks that keep slipping: by title over the last 12 finished periods.
    const finished = history.filter(x => !x.current || x.closed).slice(-12)
    const byTitle = new Map<string, { title: string; pcts: number[] }>()
    for (const x of finished) {
      for (const t of tasks.filter(t => t.goalId === x.id && t.maxPoints > 0)) {
        const key = t.title.trim().toLowerCase()
        const e = byTitle.get(key) ?? { title: t.title.trim(), pcts: [] }
        e.pcts.push(Math.round(((t.earnedPoints ?? 0) / t.maxPoints) * 100))
        byTitle.set(key, e)
      }
    }
    const trends = [...byTitle.values()].filter(t => t.pcts.length >= 3)
      .map(t => ({ title: t.title, weeks: t.pcts.length, avg: Math.round(t.pcts.reduce((s, x) => s + x, 0) / t.pcts.length), recent: t.pcts.slice(-8) }))
      .sort((a, b) => a.avg - b.avg)

    // Suggestions for planning: recent focuses and the tasks used in the last 8 periods.
    const recent = all.filter(g => g.periodStart! <= today).slice(-8)
    const focuses = [...new Set([...recent].reverse().map(g => g.focus.trim()).filter(Boolean))].slice(0, 6)
    // Each suggestion remembers what it served last time: a milestone, or a monthly goal by title (ids change every month).
    const titleOf = new Map(tasks.map(t => [t.id, t.title.trim()]))
    type Seen = { title: string; maxPoints: number; source: string; target: number | null; weeks: number; last: string; milestoneId: number | null; parentTitle: string | null }
    const seen = new Map<string, Seen>()
    for (const g of recent) {
      for (const t of tasks.filter(t => t.goalId === g.id)) {
        const key = t.title.trim().toLowerCase()
        const e = seen.get(key)
        const link = { milestoneId: t.milestoneId ?? null, parentTitle: t.parentTaskId ? titleOf.get(t.parentTaskId) ?? null : null }
        if (e) { e.weeks++; if (g.periodStart! >= e.last) Object.assign(e, { maxPoints: t.maxPoints, source: t.source, target: t.target, last: g.periodStart! }, link) }
        else seen.set(key, { title: t.title.trim(), maxPoints: t.maxPoints, source: t.source, target: t.target, weeks: 1, last: g.periodStart!, ...link })
      }
    }
    const suggestions = { focuses, tasks: [...seen.values()].sort((a, b) => b.weeks - a.weeks || b.last.localeCompare(a.last)).slice(0, 14) }

    const period = current ? { from: current.periodStart!, to: current.periodEnd! } : naturalPeriod(h, today)
    res.json({
      horizon: h,
      today,
      suggestions,
      period,
      nextPeriod: nextStart ? { from: nextStart, to: periodEnd(h, nextStart) } : null,
      current: current ? { ...(await goalPayload(current)), live } : null,
      next: next ? await goalPayload(next) : null,
      nextStart,
      history,
      trends,
    })
  } catch (e) { next(e) }
})

// One period's scorecard (any period, past or current).
router.get('/goal/:id', async (req, res, next) => {
  try {
    const [g] = await db.select().from(goals).where(eq(goals.id, Number(req.params.id)))
    if (!g) return res.status(404).json({ error: 'Period not found.' })
    res.json(await goalPayload(g))
  } catch (e) { next(e) }
})

// ─── Write ───────────────────────────────────────────────────────────────────

// Score a task, in any period.
router.patch('/tasks/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const [t] = await db.select().from(goalTasks).where(eq(goalTasks.id, id))
    if (!t) return res.status(404).json({ error: 'Task not found.' })
    // Link or unlink up the chain: a weekly task to a monthly task, a monthly task (or a habit) to a milestone. null unlinks.
    if (req.body?.parentTaskId !== undefined || req.body?.milestoneId !== undefined) {
      const set: { parentTaskId?: number | null; milestoneId?: number | null } = {}
      if (req.body.parentTaskId !== undefined) {
        const p = linkId(req.body.parentTaskId)
        if (p === id) return res.status(400).json({ error: 'A goal can\'t serve itself.' })
        if (p != null && !(await db.select().from(goalTasks).where(eq(goalTasks.id, p))).length) return res.status(404).json({ error: 'That monthly goal no longer exists.' })
        set.parentTaskId = p
      }
      if (req.body.milestoneId !== undefined) {
        const m = linkId(req.body.milestoneId)
        if (m != null && !(await db.select().from(milestones).where(eq(milestones.id, m))).length) return res.status(404).json({ error: 'That milestone no longer exists.' })
        set.milestoneId = m
      }
      await db.update(goalTasks).set(set).where(eq(goalTasks.id, id))
      return res.json({ ok: true })
    }
    // Switching how a task scores (e.g. back to by hand) keeps its stored score.
    if (req.body?.source !== undefined) {
      if (!SOURCES.includes(req.body.source)) return res.status(400).json({ error: 'Unknown scoring source.' })
      await db.update(goalTasks).set({ source: req.body.source }).where(eq(goalTasks.id, id))
      return res.json({ ok: true })
    }
    const v = req.body?.earnedPoints
    if (v != null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > t.maxPoints)) return res.status(400).json({ error: `Score between 0 and ${t.maxPoints}.` })
    await db.update(goalTasks).set({ earnedPoints: v == null ? null : round2(v) }).where(eq(goalTasks.id, id))
    res.json({ ok: true })
  } catch (e) { next(e) }
})

type TaskIn = { title?: unknown; maxPoints?: unknown; source?: unknown; target?: unknown; parentTaskId?: unknown; milestoneId?: unknown }
const linkId = (v: unknown) => (v == null || v === '' ? null : Number.isInteger(Number(v)) ? Number(v) : null)
const taskValues = (t: TaskIn, i: number) => ({
  title: String(t.title ?? '').trim() || 'Untitled',
  maxPoints: round2(Math.max(0.25, Number(t.maxPoints) || 1)),
  source: (SOURCES as readonly unknown[]).includes(t.source) ? t.source as typeof SOURCES[number] : 'manual' as const,
  target: t.target == null || t.target === '' ? null : Number(t.target),
  sortOrder: i,
  // Links up the chain only change when sent, so a save that doesn't know about them keeps them.
  ...('parentTaskId' in t ? { parentTaskId: linkId(t.parentTaskId) } : {}),
  ...('milestoneId' in t ? { milestoneId: linkId(t.milestoneId) } : {}),
})

// Edit any period: focus, dates, tasks (kept by id, so their scores stay attached) and rewards.
router.put('/:goalId', async (req, res, next) => {
  try {
    const goalId = Number(req.params.goalId)
    const [g] = await db.select().from(goals).where(eq(goals.id, goalId))
    if (!g) return res.status(404).json({ error: 'Period not found.' })
    const { focus, tasks, rewards, from, to } = req.body ?? {}
    if (from !== undefined || to !== undefined) {
      const f = from ?? g.periodStart, t = to ?? g.periodEnd
      const bad = datesError(f, t)
      if (bad) return res.status(400).json({ error: bad })
      const clash = await overlapping(horizonOf(g.horizon), f, t, [goalId])
      if (clash) return res.status(409).json({ error: `Those dates overlap the ${UNIT[horizonOf(g.horizon)]} of ${fmt(clash.periodStart!)}.` })
    }
    db.transaction(tx => {
      const set: Partial<Goal> = { updatedAt: new Date().toISOString() }
      if (typeof focus === 'string') set.focus = focus.trim()
      if (isDate(from)) set.periodStart = from
      if (isDate(to)) set.periodEnd = to
      tx.update(goals).set(set).where(eq(goals.id, goalId)).run()
      if (Array.isArray(tasks)) {
        const have = tx.select().from(goalTasks).where(eq(goalTasks.goalId, goalId)).all()
        const keep = new Set<number>()
        tasks.forEach((t: TaskIn & { id?: number }, i: number) => {
          const values = taskValues(t, i)
          const old = t.id ? have.find(x => x.id === t.id) : undefined
          if (old) {
            // A lowered maximum caps a score already entered above it.
            const capped = old.earnedPoints != null && old.earnedPoints > values.maxPoints ? { earnedPoints: values.maxPoints } : {}
            tx.update(goalTasks).set({ ...values, ...capped }).where(eq(goalTasks.id, old.id)).run(); keep.add(old.id)
          } else tx.insert(goalTasks).values({ ...values, goalId }).run()
        })
        for (const x of have) if (!keep.has(x.id)) tx.delete(goalTasks).where(eq(goalTasks.id, x.id)).run()
      }
      if (Array.isArray(rewards)) {
        tx.delete(goalRewards).where(eq(goalRewards.goalId, goalId)).run()
        rewards.filter((r: any) => String(r.reward ?? '').trim()).forEach((r: any, i: number) =>
          tx.insert(goalRewards).values({ goalId, minScore: Number(r.minScore) || 0, reward: String(r.reward).trim(), sortOrder: i }).run())
      }
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

function insertGoal(h: Horizon, from: string, to: string, body: any, replace: Goal | null) {
  const clean = (body.tasks as any[]).filter(t => String(t.title ?? '').trim())
  return db.transaction(tx => {
    let goalId: number
    if (replace) {
      goalId = replace.id
      tx.update(goals).set({ focus: String(body.focus ?? '').trim(), periodStart: from, periodEnd: to, updatedAt: new Date().toISOString() }).where(eq(goals.id, goalId)).run()
      tx.delete(goalTasks).where(eq(goalTasks.goalId, goalId)).run()      // unstarted: nothing scored yet
      tx.delete(goalRewards).where(eq(goalRewards.goalId, goalId)).run()
    } else {
      goalId = tx.insert(goals).values({ horizon: h, focus: String(body.focus ?? '').trim(), periodStart: from, periodEnd: to, status: 'active' }).returning().get().id
    }
    clean.forEach((t, i) => tx.insert(goalTasks).values({ ...taskValues(t, i), goalId }).run())
    ;((body.rewards ?? []) as any[]).filter(r => String(r.reward ?? '').trim()).forEach((r, i) => tx.insert(goalRewards).values({
      goalId, minScore: Number(r.minScore) || 0, reward: String(r.reward).trim(), sortOrder: i,
    }).run())
    return goalId
  })
}

// Set the next period from the composer: creates it, or replaces an unstarted one's plan.
router.post('/next', async (req, res, next) => {
  try {
    const h = horizonOf(req.query.horizon ?? req.body?.horizon)
    const today = dayKey()
    const current = await goalOn(h, today)
    const natural = current ? addDays(current.periodEnd!, 1)
      : h === 'weekly' ? (() => { const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); return d.toISOString().slice(0, 10) })()
      : addDays(naturalPeriod(h, today).to, 1)
    const from = isDate(req.body?.from) ? req.body.from : natural
    const to = isDate(req.body?.to) ? req.body.to : periodEnd(h, from)
    const bad = datesError(from, to)
    if (bad) return res.status(400).json({ error: bad })
    const { tasks = [] } = req.body ?? {}
    if (!(tasks as any[]).some(t => String(t.title ?? '').trim())) return res.status(400).json({ error: 'Add at least one task.' })

    const existing = await goalOn(h, from)
    if (existing && existing.periodStart! < today) return res.status(409).json({ error: `That ${UNIT[h]} has already started. Edit it from its scorecard.` })
    const clash = await overlapping(h, from, to, existing ? [existing.id] : [])
    if (clash) return res.status(409).json({ error: `Those dates overlap the ${UNIT[h]} of ${fmt(clash.periodStart!)}.` })
    const id = insertGoal(h, from, to, { ...req.body, tasks }, existing)
    res.status(existing ? 200 : 201).json({ id, from, to, replaced: !!existing })
  } catch (e) { next(e) }
})

// Set this period's goals when none exist yet.
router.post('/current', async (req, res, next) => {
  try {
    const h = horizonOf(req.query.horizon ?? req.body?.horizon)
    const today = dayKey()
    const natural = naturalPeriod(h, today)
    const from = isDate(req.body?.from) ? req.body.from : natural.from
    const to = isDate(req.body?.to) ? req.body.to : natural.to
    const bad = datesError(from, to)
    if (bad) return res.status(400).json({ error: bad })
    const { tasks = [] } = req.body ?? {}
    if (!(tasks as any[]).some(t => String(t.title ?? '').trim())) return res.status(400).json({ error: 'Add at least one task.' })
    const clash = await overlapping(h, from, to)
    if (clash) return res.status(409).json({ error: `Those dates overlap the ${UNIT[h]} of ${fmt(clash.periodStart!)}.` })
    const id = insertGoal(h, from, to, { ...req.body, tasks }, null)
    res.status(201).json({ id, from, to })
  } catch (e) { next(e) }
})

// Close a period by hand: its data-fed tasks are scored now and frozen.
router.post('/:goalId/close', async (req, res, next) => {
  try {
    const goalId = Number(req.params.goalId)
    const [g] = await db.select().from(goals).where(eq(goals.id, goalId))
    if (!g) return res.status(404).json({ error: 'Period not found.' })
    const today = dayKey()
    const state = await dayState(today)
    const tasks = await db.select().from(goalTasks).where(eq(goalTasks.goalId, goalId))
    const frozen: { id: number; earned: number }[] = []
    for (const t of tasks) {
      if (t.source === 'manual') continue
      const a = await autoPoints(t, g.periodStart!, g.periodEnd!, state)
      frozen.push({ id: t.id, earned: round2(a.earned) })
    }
    db.transaction(tx => {
      for (const f of frozen) tx.update(goalTasks).set({ earnedPoints: f.earned }).where(eq(goalTasks.id, f.id)).run()
      tx.update(goals).set({ status: 'past', updatedAt: new Date().toISOString() }).where(eq(goals.id, goalId)).run()
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// Reopen a period closed by hand: data-fed tasks go back to scoring live.
router.post('/:goalId/reopen', async (req, res, next) => {
  try {
    const goalId = Number(req.params.goalId)
    const [g] = await db.select().from(goals).where(eq(goals.id, goalId))
    if (!g) return res.status(404).json({ error: 'Period not found.' })
    const running = g.periodEnd! >= dayKey()
    db.transaction(tx => {
      if (running) {
        for (const t of tx.select().from(goalTasks).where(eq(goalTasks.goalId, goalId)).all()) {
          if (t.source !== 'manual') tx.update(goalTasks).set({ earnedPoints: null }).where(eq(goalTasks.id, t.id)).run()
        }
      }
      tx.update(goals).set({ status: 'active', updatedAt: new Date().toISOString() }).where(eq(goals.id, goalId)).run()
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// Delete a period with its tasks and rewards.
router.delete('/:goalId', async (req, res, next) => {
  try {
    const goalId = Number(req.params.goalId)
    db.transaction(tx => {
      tx.delete(goalTasks).where(eq(goalTasks.goalId, goalId)).run()
      tx.delete(goalRewards).where(eq(goalRewards.goalId, goalId)).run()
      tx.delete(goals).where(eq(goals.id, goalId)).run()
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

export default router
