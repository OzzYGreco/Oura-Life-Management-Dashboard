/**
 * The Today view model: everything the home screen shows, computed once on
 * the server so all four skins read the same numbers. No styling here.
 */
import { and, eq, gte, gt, lte, lt, desc, inArray } from 'drizzle-orm'
import { db } from '../db'
import {
  goals, goalTasks, goalRewards, trades, tradingAccounts, trainingWorkouts, trainingExercises, dayReviews,
  checklistTemplates, checklistEntries, checklistEntryItems, calendarEvents,
} from '../db/schema'
import {
  dayKey, dayState, ensureDay, ensureWeek, weekState, itemStreaks, reopenInfo, addDays, hhmm, minutesInto, weekStart,
  weeklyTemplateIds, type DayState,
} from './day'
import { localToday } from './date'
import { loadBusinessData, currentMrr, businessDashboardSummary } from './businessMetrics'
import { outcomeOf } from './outcome'

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100
const weekdayName = (date: string) =>
  new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' })

// ─── Day ─────────────────────────────────────────────────────────────────────

async function dayBlock(date: string, today: string) {
  // Only today and days ahead are materialised; a past day is read as it stands.
  if (date >= today) await ensureDay(date)
  const state = await dayState(date)
  const isToday = date === today
  const future = date > today
  const re = !isToday && !future && !state.closed ? await reopenInfo(date) : null

  // Ghosts: the same weekday last week at this minute, and the best closed day this month.
  let lastWeekDate = addDays(date, -7)
  let ghostState = await dayState(lastWeekDate, state.now, { closed: false })
  for (let back = 14; ghostState.score == null && back <= 28; back += 7) {
    lastWeekDate = addDays(date, -back)
    ghostState = await dayState(lastWeekDate, state.now, { closed: false })
  }
  const monthStart = `${date.slice(0, 7)}-01`
  const [best] = await db.select().from(dayReviews)
    .where(and(gte(dayReviews.date, monthStart), lt(dayReviews.date, date), gt(dayReviews.score, 0)))
    .orderBy(desc(dayReviews.score)).limit(1)

  const current = state.items.find(i => i.status === 'open') ?? null
  const next = state.items.find(i => i.status === 'upcoming') ?? null
  const overdue = state.items.filter(i => i.status === 'overdue')

  const ghost = ghostState.score
  const diff = state.score != null && ghost != null ? state.score - ghost : null
  const back = Math.round((new Date(date + 'T12:00:00').getTime() - new Date(lastWeekDate + 'T12:00:00').getTime()) / 864e5)
  const lastName = back === 7 ? `last ${weekdayName(lastWeekDate)}` : `${weekdayName(lastWeekDate)} ${new Date(lastWeekDate + 'T12:00:00').getDate()} ${new Date(lastWeekDate + 'T12:00:00').toLocaleDateString('en-GB', { month: 'short' })}`

  // The coach line for the day: plain about the gap, specific about the fix.
  let coach: string
  const dayName = `${weekdayName(date)} ${new Date(date + 'T12:00:00').getDate()} ${new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { month: 'short' })}`
  if (future) {
    const first = state.items.find(i => i.start != null)
    coach = state.items.length
      ? `${dayName} has ${state.items.length} item${state.items.length === 1 ? '' : 's'} planned.${first ? ` First up: ${first.label} at ${first.time}.` : ''}`
      : `Nothing is planned for ${dayName} yet.`
  } else if (!isToday && state.closed) {
    coach = state.items.length ? `${dayName} closed at ${state.score ?? 0}.` : `Nothing was recorded on ${dayName}.`
  } else if (!isToday) {
    coach = `${dayName} is open for corrections. Ticks now count as late, half points.`
  } else if (state.score == null) {
    coach = next ? `Nothing has opened yet. First up: ${next.label} at ${next.time}.` : 'Nothing is planned today.'
  } else if (current) {
    const lead = diff == null ? '' : diff < 0 ? `${-diff} behind ${lastName}. ` : diff > 0 ? `${diff} ahead of ${lastName}. ` : `Level with ${lastName}. `
    coach = `${lead}${current.label} on time is worth +${current.points}.`
  } else if (overdue.length) {
    const latest = overdue[overdue.length - 1]   // the most recent miss is the one still worth chasing
    coach = `${latest.label} is past its window. Ticked now it still earns half (+${latest.points / 2}).`
  } else if (next) {
    coach = `${next.label} opens at ${next.time}.`
  } else {
    coach = state.closed ? 'Day closed.' : 'Everything is behind you. Close the day with the review.'
  }

  // The last seven days' scores (closed days are final; today is so far).
  const recentFrom = addDays(date, -6)
  const recentRows = await db.select().from(dayReviews).where(and(gte(dayReviews.date, recentFrom), lt(dayReviews.date, date)))
  const recent = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(recentFrom, i)
    if (d === date) return { date: d, score: state.score }
    return { date: d, score: recentRows.find(r => r.date === d)?.score ?? null }
  })

  // Streaks (days in a row on time) for routine items, and progress per routine.
  const streaks = await itemStreaks(isToday
    ? new Set(state.items.filter(i => i.status === 'on_time' && i.templateItemId != null).map(i => i.templateItemId!))
    : new Set())
  const items = state.items.map(i => ({ ...i, streak: i.templateItemId != null && date >= today ? streaks.get(i.templateItemId) ?? 0 : 0 }))
  const tIds = [...new Set(items.map(i => i.templateId).filter((x): x is number => x != null))]
  const names = new Map((tIds.length ? await db.select().from(checklistTemplates).where(inArray(checklistTemplates.id, tIds)) : []).map(t => [t.id, t.name]))
  const groups = new Map<string, { key: string; templateId: number | null; name: string; total: number; done: number; missed: number; left: number }>()
  for (const i of items) {
    const key = i.templateId == null ? 'oneoffs' : `t${i.templateId}`
    const g = groups.get(key) ?? { key, templateId: i.templateId, name: i.templateId == null ? 'Just for this day' : names.get(i.templateId) ?? 'Routine', total: 0, done: 0, missed: 0, left: 0 }
    g.total++
    if (i.status === 'on_time' || i.status === 'late') g.done++
    else if (i.status === 'missed') g.missed++
    else g.left++
    groups.set(key, g)
  }
  const routines = [...groups.values()].sort((a, b) => (a.templateId == null ? 1 : 0) - (b.templateId == null ? 1 : 0))

  return {
    date,
    isToday,
    future,
    reopened: re ? { until: re.until } : null,
    routines,
    weekly: await weekState(date),
    recent,
    closed: state.closed,
    now: hhmm(state.now),
    score: state.score,
    earned: round1(state.earned),
    possible: round1(state.possible),
    total: round1(state.total),
    ghost: { label: lastName.charAt(0).toUpperCase() + lastName.slice(1), date: lastWeekDate, score: ghost, diff },
    bestThisMonth: best ? { score: best.score, date: best.date } : null,
    coach,
    current: current && { ...current, minutesLeft: current.end! - state.now },
    next: next && { ...next, minutesUntil: next.start! - state.now },
    items,
    counts: {
      onTime: state.items.filter(i => i.status === 'on_time').length,
      late: state.items.filter(i => i.status === 'late').length,
      missed: state.items.filter(i => i.status === 'missed' || i.status === 'overdue').length,
      ahead: state.items.filter(i => i.status === 'upcoming' || i.status === 'open' || i.status === 'anytime').length,
    },
    closesAt: '04:00',
    minutesToClose: 1440 + 240 - state.now,
  }
}

// ─── Week ────────────────────────────────────────────────────────────────────

type Goal = typeof goals.$inferSelect

export async function weeklyGoalOn(date: string): Promise<Goal | null> {
  const [g] = await db.select().from(goals)
    .where(and(eq(goals.horizon, 'weekly'), lte(goals.periodStart, date), gte(goals.periodEnd, date)))
    .orderBy(desc(goals.id)).limit(1)
  return g ?? null
}

/** Points a data-fed task has earned so far. Manual tasks return their typed score. */
export async function autoPoints(task: typeof goalTasks.$inferSelect, from: string, to: string, today: DayState) {
  const max = task.maxPoints
  switch (task.source) {
    case 'checklist': {
      const closed = await db.select().from(dayReviews).where(and(gte(dayReviews.date, from), lte(dayReviews.date, to)))
      const scores = closed.map(r => r.score)
      if (today.score != null && !closed.some(r => r.date === today.date)) scores.push(today.score)
      if (!scores.length) return { earned: 0, note: 'no days scored yet' }
      const avg = scores.reduce((s, x) => s + x, 0) / scores.length
      return { earned: round2(max * avg / 100), note: `average day score ${Math.round(avg)}` }
    }
    case 'workouts': {
      const target = task.target ?? 4
      const n = (await db.select().from(trainingWorkouts).where(and(gte(trainingWorkouts.date, from), lte(trainingWorkouts.date, to)))).length
      return { earned: round2(max * Math.min(1, n / target)), note: `${n} of ${target} workouts` }
    }
    case 'trading_rules': {
      const rows = (await db.select().from(trades).where(and(gte(trades.date, from), lte(trades.date, to))))
        .filter(t => t.rulesMet != null)
      const breaks = rows.filter(t => t.rulesMet === 0).length
      return {
        earned: round2(max * Math.max(0, 1 - breaks * 0.5)),
        note: rows.length ? (breaks ? `${breaks} rule break${breaks > 1 ? 's' : ''}` : 'rules kept') : 'no trades yet',
      }
    }
    case 'journal_reviewed': {
      const rows = await db.select().from(trades).where(and(gte(trades.date, from), lte(trades.date, to)))
      const unreviewed = rows.filter(t => !t.reviewedAt).length
      return {
        earned: round2(rows.length ? max * (rows.length - unreviewed) / rows.length : max),
        note: unreviewed ? `${unreviewed} trade${unreviewed > 1 ? 's' : ''} to review` : 'journal up to date',
      }
    }
    case 'weekly_routine': {
      // Weekly-routine items ticked, over every week that starts inside the period.
      const weekly = [...await weeklyTemplateIds()]
      const entries = weekly.length
        ? (await db.select().from(checklistEntries).where(and(inArray(checklistEntries.templateId, weekly), gte(checklistEntries.date, weekStart(from)), lte(checklistEntries.date, to))))
        : []
      const rows = entries.length
        ? (await db.select().from(checklistEntryItems).where(inArray(checklistEntryItems.entryId, entries.map(e => e.id)))).filter(r => !r.archived)
        : []
      if (!rows.length) return { earned: 0, note: 'no weekly routine items' }
      const done = rows.filter(r => r.completed).length
      return { earned: round2(max * done / rows.length), note: `${done} of ${rows.length} weekly items done` }
    }
    default:
      return { earned: task.earnedPoints ?? 0, note: task.earnedPoints == null ? 'not scored yet' : null }
  }
}

export async function weekBlock(date: string, today: DayState) {
  const goal = await weeklyGoalOn(date)
  if (!goal) return null
  const from = goal.periodStart!, to = goal.periodEnd!

  const taskRows = await db.select().from(goalTasks).where(eq(goalTasks.goalId, goal.id)).orderBy(goalTasks.sortOrder)
  const rewards = (await db.select().from(goalRewards).where(eq(goalRewards.goalId, goal.id))).sort((a, b) => a.minScore - b.minScore)

  const tasks = []
  for (const t of taskRows) {
    const a = await autoPoints(t, from, to, today)
    tasks.push({ id: t.id, title: t.title, source: t.source, max: t.maxPoints, earned: round2(a.earned), note: a.note })
  }
  const score = round2(tasks.reduce((s, t) => s + t.earned, 0))
  const max = round2(tasks.reduce((s, t) => s + t.max, 0))

  // Last week's final score and the reward it reached.
  const prev = await weeklyGoalOn(addDays(from, -1))
  let lastWeek: { score: number; reward: string | null } | null = null
  if (prev) {
    const prevTasks = await db.select().from(goalTasks).where(eq(goalTasks.goalId, prev.id))
    const prevRewards = (await db.select().from(goalRewards).where(eq(goalRewards.goalId, prev.id))).sort((a, b) => b.minScore - a.minScore)
    const s = round2(prevTasks.reduce((x, t) => x + (t.earnedPoints ?? 0), 0))
    lastWeek = { score: s, reward: prevRewards.find(r => s >= r.minScore)?.reward ?? null }
  }

  const ladder = rewards.map(r => ({ at: r.minScore, reward: r.reward, reached: score >= r.minScore }))
  const nextReward = ladder.find(r => !r.reached) ?? null
  const remaining = tasks.reduce((s, t) => s + (t.max - t.earned), 0)

  // Stakes: the next reward, and whether it's slipping out of reach.
  let stakes: string | null = null
  if (nextReward) {
    const gap = round2(nextReward.at - score)
    stakes = gap > remaining
      ? `${nextReward.reward} is out of reach this week: you need ${gap} more and only ${round2(remaining)} is left to earn.`
      : `${gap} more point${gap === 1 ? '' : 's'} for ${nextReward.reward}.`
  }

  // The coach's lever: the task with the most points still on the table.
  const lever = [...tasks].sort((a, b) => (b.max - b.earned) - (a.max - a.earned))[0]
  const coach = lever && lever.max - lever.earned > 0
    ? `Biggest lever: ${lever.title} is at ${lever.earned} of ${lever.max}. Finishing it adds ${round2(lever.max - lever.earned)}.`
    : null

  return {
    goalId: goal.id, focus: goal.focus, from, to,
    score, max, tasks, ladder, nextReward, stakes, coach, lastWeek,
  }
}

// ─── Wins ────────────────────────────────────────────────────────────────────

/** Only true, recent achievements. Nothing is shown to fill space. */
async function winsBlock(date: string) {
  const wins: { kind: string; title: string; detail: string }[] = []

  // Recurring revenue at a new high, compared with every month-end of the last two years.
  try {
    const d = await loadBusinessData()
    const now = currentMrr(d, date).current
    let prevMax = 0
    for (let i = 1; i <= 24; i++) {
      const dt = new Date(date + 'T12:00:00'); dt.setDate(1); dt.setMonth(dt.getMonth() - i + 1); dt.setDate(0)
      prevMax = Math.max(prevMax, currentMrr(d, dt.toISOString().slice(0, 10)).current)
    }
    if (now > 0 && now > prevMax) {
      wins.push({ kind: 'business', title: 'Recurring revenue at an all-time high', detail: `£${now.toLocaleString('en-GB', { minimumFractionDigits: 2 })}/mo` })
    }
  } catch { /* business data is optional for this block */ }

  // Lifts: an estimated one-rep max (Epley, sets of 12 or fewer) that is a best, set in the last 7 days.
  const workouts = await db.select().from(trainingWorkouts)
  const byId = new Map(workouts.map(w => [w.id, w]))
  const sets = await db.select().from(trainingExercises)
  const best = new Map<string, { e1rm: number; date: string }>()
  const priorBest = new Map<string, number>()
  const weekAgo = addDays(date, -7)
  for (const s of sets.sort((a, b) => (byId.get(a.workoutId)?.date ?? '').localeCompare(byId.get(b.workoutId)?.date ?? ''))) {
    const w = byId.get(s.workoutId); if (!w) continue
    const reps = s.reps ?? [], kg = s.weight ?? []
    let top = 0
    reps.forEach((r, i) => { const k = kg[i] ?? 0; if (r > 0 && r <= 12 && k > 0) top = Math.max(top, k * (1 + r / 30)) })
    if (!top) continue
    const name = s.exerciseName.trim()
    if (w.date < weekAgo) priorBest.set(name, Math.max(priorBest.get(name) ?? 0, top))
    const b = best.get(name)
    if (!b || top > b.e1rm) best.set(name, { e1rm: top, date: w.date })
  }
  for (const [name, b] of best) {
    const prior = priorBest.get(name)
    if (b.date >= weekAgo && prior && b.e1rm > prior) {
      wins.push({ kind: 'training', title: `${name}: a new best`, detail: `estimated 1RM ${Math.round(b.e1rm)} kg, up from ${Math.round(prior)}` })
    }
  }

  // Last week's score against the weeks before it.
  const weekly = await db.select().from(goals).where(eq(goals.horizon, 'weekly')).orderBy(goals.periodStart)
  const past = weekly.filter(g => g.periodEnd! < date)
  if (past.length > 1) {
    const allTasks = await db.select().from(goalTasks)
    const total = (g: Goal) => allTasks.filter(t => t.goalId === g.id).reduce((s, t) => s + (t.earnedPoints ?? 0), 0)
    const last = past[past.length - 1]
    const lastScore = total(last)
    let since: Goal | null = null
    for (let i = past.length - 2; i >= 0; i--) if (total(past[i]) >= lastScore) { since = past[i]; break }
    const weeksBack = since ? past.length - 1 - past.indexOf(since) : past.length
    if (weeksBack >= 4) {
      const when = since ? `since the week of ${new Date(since.periodStart! + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'ever recorded'
      wins.push({ kind: 'week', title: `Last week scored ${round2(lastScore)}`, detail: `your best ${when}` })
    }
  }

  return wins.slice(0, 4)
}

// ─── Money pulse ─────────────────────────────────────────────────────────────

const tradeDay = (t: typeof trades.$inferSelect) => (t.closedAt ? t.closedAt.slice(0, 10) : t.date)
const tradePnl = (t: typeof trades.$inferSelect) => t.netPnl ?? t.realizedPnl ?? 0

async function pulseBlock(date: string) {
  const utcToday = new Date().toISOString().slice(0, 10)
  const accounts = await db.select().from(tradingAccounts)
  const rows = await db.select().from(trades)

  // Trading in figures (the journal is UTC, so days and months are UTC days).
  const oneROf = new Map(accounts.map(a => [a.id, a.fullRisk ?? null]))
  const rOf = (t: typeof trades.$inferSelect) => {
    if (t.rrRatio != null) return round2(t.rrRatio)
    const oneR = t.accountId != null ? oneROf.get(t.accountId) : null
    return oneR ? round2(tradePnl(t) / oneR) : null
  }
  const avgR = (list: typeof rows) => {
    const rs = list.map(rOf).filter((x): x is number => x != null)
    return rs.length ? round2(rs.reduce((s, x) => s + x, 0) / rs.length) : null
  }
  const todayRows = rows.filter(t => tradeDay(t) === utcToday).sort((a, b) => (a.closedAt ?? a.date).localeCompare(b.closedAt ?? b.date))
  const monthRows = rows.filter(t => tradeDay(t).slice(0, 7) === utcToday.slice(0, 7))
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(utcToday + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 6 + i)
    const iso = d.toISOString().slice(0, 10)
    return {
      date: iso,
      label: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
      pnl: round2(rows.filter(t => tradeDay(t) === iso).reduce((s, t) => s + tradePnl(t), 0)),
    }
  })
  // Inside ±0.1R is breakeven: neither a win nor a loss.
  const monthWins = monthRows.filter(t => outcomeOf(rOf(t), tradePnl(t)) === 'win').length
  const tradingDay = {
    pnl: round2(todayRows.reduce((s, t) => s + tradePnl(t), 0)),
    count: todayRows.length,
    avgR: avgR(todayRows),
    trades: todayRows.map(t => ({ id: t.id, asset: t.asset, direction: t.direction, r: rOf(t), pnl: round2(tradePnl(t)) })),
  }
  const tradingMonth = {
    pnl: round2(monthRows.reduce((s, t) => s + tradePnl(t), 0)),
    count: monthRows.length,
    winRate: monthRows.length ? Math.round((monthWins / monthRows.length) * 100) : null,
    avgR: avgR(monthRows),
    last7,
  }

  const trading = accounts.map(a => {
    const todays = rows.filter(t => t.accountId === a.id && (t.closedAt ? t.closedAt.slice(0, 10) : t.date) === utcToday)
      .map(t => t.netPnl ?? t.realizedPnl).filter((x): x is number => x != null)
    const net = round2(todays.reduce((s, x) => s + x, 0))
    const oneR = a.fullRisk ?? null
    const netR = oneR ? round2(net / oneR) : null
    let limitLeft: number | null = null
    if (a.maxLossDay) {
      const usedUnit = a.lossLimitUnit === 'USD' ? Math.max(0, -net) : (netR != null ? Math.max(0, -netR) : null)
      if (usedUnit != null) limitLeft = round2(a.maxLossDay - usedUnit)
    }
    return { id: a.id, name: a.name, trades: todays.length, net, netR, limitLeft, limitUnit: a.lossLimitUnit ?? 'R', oneR }
  }).filter(a => a.trades > 0 || a.limitLeft != null)

  let business = null
  try {
    const b = await businessDashboardSummary()
    business = {
      mrr: b.mrr, netNewMrr: b.netNewMrr, revenueMTD: b.collectedMTD, marginPct: b.marginPct,
      activeClients: b.activeClients, outstanding: b.outstanding, nextDue: b.nextDue,
    }
  } catch { /* optional */ }

  const goal = await weeklyGoalOn(date)
  const from = goal?.periodStart ?? addDays(date, -6)
  const workouts = (await db.select().from(trainingWorkouts).where(and(gte(trainingWorkouts.date, from), lte(trainingWorkouts.date, date)))).length
  const target = goal
    ? (await db.select().from(goalTasks).where(and(eq(goalTasks.goalId, goal.id), eq(goalTasks.source, 'workouts'))))[0]?.target ?? 4
    : 4

  const [last] = await db.select().from(trainingWorkouts).orderBy(desc(trainingWorkouts.date), desc(trainingWorkouts.id)).limit(1)
  const lastWorkout = last ? { id: last.id, name: last.name, date: last.date, durationMinutes: last.durationMinutes, category: last.category } : null

  const upcoming = (await db.select().from(calendarEvents).where(gte(calendarEvents.startDatetime, localToday()))
    .orderBy(calendarEvents.startDatetime).limit(5))
    .map(e => ({ id: e.id, title: e.title, start: e.startDatetime, allDay: !!e.allDay }))

  return { trading, tradingDay, tradingMonth, business, workouts: { done: workouts, target }, lastWorkout, upcoming }
}

// ─── Assembled ───────────────────────────────────────────────────────────────

/**
 * `viewDate` shows another day in the day block (past days read-only unless
 * reopened, days ahead for planning). Week, wins and money are always now.
 */
export async function todayView(at = new Date(), viewDate?: string) {
  const today = dayKey(at)
  const date = viewDate && /^\d{4}-\d{2}-\d{2}$/.test(viewDate) ? viewDate : today
  await ensureWeek(today)
  const day = await dayBlock(date, today)
  const state = await dayState(today)
  const [week, wins, pulse] = await Promise.all([weekBlock(today, state), winsBlock(today), pulseBlock(today)])
  return { generatedAt: at.toISOString(), today, minuteOfDay: minutesInto(date, at), day, week, wins, pulse }
}
