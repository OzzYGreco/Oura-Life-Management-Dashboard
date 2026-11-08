/**
 * The daily loop: which routine items a day has, how each tick is scored and
 * what the day scores.
 *
 * Rules (shown to the user wherever a score appears):
 * - A day runs 04:00 to 04:00, so a 01:45 item belongs to the evening before.
 * - An item opens at its time and stays open for `windowMin` minutes.
 *   Ticked before the window closes: on time, full points.
 *   Ticked after it closes: late, half points.
 *   Never ticked by the time the day closes: missed, nothing.
 * - Items can't be ticked more than EARLY_MIN before they open, so a morning
 *   sweep of the whole day doesn't count.
 * - Items without a time are "anytime": full points whenever they're ticked.
 * - A tick made after the day has ended (a past day reopened to correct it)
 *   is late, whatever the item: half points. That is the honest record.
 * - Weekly routines are not part of any day: they hold one entry per week
 *   (dated the week's Sunday) and are ticked once that week.
 * - The day score is earned ÷ possible so far × 100. Possible counts only
 *   items whose window has opened, so the score is fair at any hour.
 */
import { and, eq, inArray, gte, lte, isNotNull } from 'drizzle-orm'
import { db } from '../db'
import {
  checklistTemplates, checklistTemplateItems, checklistEntries, checklistEntryItems, dayReviews, appSettings,
} from '../db/schema'
import { localDateStr } from './date'

export const DAY_START_MIN = 4 * 60       // the day turns over at 04:00
export const EARLY_MIN = 120              // how early an item may be ticked
export const LATE_CREDIT = 0.5

export type ItemStatus = 'on_time' | 'late' | 'missed' | 'open' | 'overdue' | 'upcoming' | 'anytime'

export interface DayItem {
  id: number                 // entry item id
  entryId: number
  templateId: number | null  // null = a one-off
  templateItemId: number | null
  label: string
  time: string | null        // HH:MM, 24h
  start: number | null       // minutes from the day's midnight (can exceed 1440)
  end: number | null
  importance: string | null
  points: number
  status: ItemStatus
  earned: number
  completedAt: string | null
  reason: string | null
}

export interface DayState {
  date: string
  closed: boolean
  score: number | null       // null when nothing has opened yet
  earned: number
  possible: number
  total: number              // possible for the whole day
  items: DayItem[]
  now: number                // minutes from the day's midnight
}

// ─── Time helpers ────────────────────────────────────────────────────────────

/** The routine day a moment belongs to: before 04:00 it's still yesterday. */
export function dayKey(at = new Date()): string {
  const d = new Date(at)
  if (d.getHours() * 60 + d.getMinutes() < DAY_START_MIN) d.setDate(d.getDate() - 1)
  return localDateStr(d)
}

/** "09:15AM", "13:30PM", "9:15 pm", "21:45" → minutes after midnight. */
export function parseClock(t: string | null | undefined): number | null {
  const m = t?.trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/)
  if (!m) return null
  let h = Number(m[1])
  const ap = m[3]?.toUpperCase()
  if (ap === 'PM' && h < 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  if (h > 23 || Number(m[2]) > 59) return null
  return h * 60 + Number(m[2])
}

/** Clock minutes placed on the 04:00-04:00 day. */
const onDay = (m: number) => (m < DAY_START_MIN ? m + 1440 : m)

export const hhmm = (mins: number) => {
  const m = ((mins % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Minutes from `date`'s local midnight to `at`. */
export function minutesInto(date: string, at: Date): number {
  const [y, mo, d] = date.split('-').map(Number)
  return Math.round((at.getTime() - new Date(y, mo - 1, d).getTime()) / 60000)
}

const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number)
  return localDateStr(new Date(y, m - 1, d + n))
}
export { addDays }

/** The Sunday that starts the week `date` is in. Weekly routines are stored on it. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()
  return addDays(date, -dow)
}

const isWeekly = (t: { type: string | null }) => t.type === 'weekly'

/** Ids of routines marked Weekly (archived ones included, so their history stays out of days). */
export async function weeklyTemplateIds(): Promise<Set<number>> {
  const rows = await db.select({ id: checklistTemplates.id }).from(checklistTemplates).where(eq(checklistTemplates.type, 'weekly'))
  return new Set(rows.map(r => r.id))
}

// ─── Reopening a closed day ──────────────────────────────────────────────────

/**
 * A closed day can be reopened to correct it. The review row is removed and a
 * marker kept (in app_settings, key `reopen:<date>`) with the time it closes
 * again by itself: the next 04:00. The marker also keeps the reflection, so
 * closing it again does not lose the line written that evening.
 */
interface Reopen { until: string; reflection: string | null }
const reopenKey = (date: string) => `reopen:${date}`

export async function reopenInfo(date: string): Promise<Reopen | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, reopenKey(date)))
  if (!row) return null
  try { return JSON.parse(row.value) as Reopen } catch { return null }
}

/** Next 04:00 after `at`, as an ISO time. */
function nextTurnover(at = new Date()): string {
  const [y, m, d] = addDays(dayKey(at), 1).split('-').map(Number)
  return new Date(y, m - 1, d, DAY_START_MIN / 60, 0, 0).toISOString()
}

export async function reopenDay(date: string): Promise<boolean> {
  const [review] = await db.select().from(dayReviews).where(eq(dayReviews.date, date))
  if (!review) return false
  const value = JSON.stringify({ until: nextTurnover(), reflection: review.reflection } satisfies Reopen)
  db.transaction(tx => {
    tx.delete(dayReviews).where(eq(dayReviews.date, date)).run()
    // The results written on close are cleared, so every item is live again.
    // Reasons stay: they are reused when the day closes again.
    const entryIds = tx.select({ id: checklistEntries.id }).from(checklistEntries).where(eq(checklistEntries.date, date)).all().map(e => e.id)
    if (entryIds.length) {
      tx.update(checklistEntryItems).set({ result: null, pointsEarned: null }).where(inArray(checklistEntryItems.entryId, entryIds)).run()
    }
    tx.delete(appSettings).where(eq(appSettings.key, reopenKey(date))).run()
    tx.insert(appSettings).values({ key: reopenKey(date), value }).run()
  })
  return true
}

async function clearReopen(date: string) {
  await db.delete(appSettings).where(eq(appSettings.key, reopenKey(date)))
}

const POINTS: Record<string, number> = { UI: 8, NUI: 5, UNI: 3, NUNI: 2 }
export const pointsFor = (importance: string | null | undefined, override?: number | null) =>
  override ?? POINTS[importance ?? ''] ?? 5

/** Whether an item runs on a date. null = every day. */
export function runsOn(schedule: string | null | undefined, date: string): boolean {
  if (!schedule || schedule === 'daily') return true
  const [y, m, d] = date.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()
  if (schedule === 'weekdays') return dow >= 1 && dow <= 5
  if (schedule === 'weekends') return dow === 0 || dow === 6
  if (schedule.startsWith('days:')) return schedule.slice(5).split(',').map(Number).includes(dow)
  if (schedule.startsWith('once:')) return schedule.slice(5) === date
  return true
}

// ─── Materialising a day ─────────────────────────────────────────────────────

/**
 * Makes sure `date` has its routine items. Safe to call repeatedly: it adds
 * items that were added to a template after the day was created, and removes
 * untouched items whose template item was retired, but only while the day
 * is still open. A closed day is never changed.
 */
export async function ensureDay(date: string): Promise<void> {
  const [review] = await db.select().from(dayReviews).where(eq(dayReviews.date, date))
  if (review) return

  const templates = (await db.select().from(checklistTemplates)).filter(t => !isWeekly(t))
  for (const template of templates) {
    const live = !!template.enabled && !template.archivedAt
    let [entry] = await db.select().from(checklistEntries)
      .where(and(eq(checklistEntries.templateId, template.id), eq(checklistEntries.date, date)))

    // A paused or deleted routine: its untouched items leave the open day at
    // once, so they're neither scored nor reminded. Ticked ones keep their points.
    if (!live) {
      if (entry) {
        await db.update(checklistEntryItems).set({ archived: 1 })
          .where(and(eq(checklistEntryItems.entryId, entry.id), eq(checklistEntryItems.completed, 0), eq(checklistEntryItems.archived, 0)))
      }
      continue
    }

    const tItems = await db.select().from(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, template.id))
    const due = tItems.filter(i => !i.retiredAt && runsOn(i.schedule, date))

    if (!entry) {
      if (!due.length) continue
      ;[entry] = await db.insert(checklistEntries).values({ templateId: template.id, date }).returning()
    }

    const have = await db.select().from(checklistEntryItems).where(eq(checklistEntryItems.entryId, entry.id))
    const haveIds = new Set(have.map(h => h.templateItemId))
    const missing = due.filter(i => !haveIds.has(i.id))
    if (missing.length) {
      await db.insert(checklistEntryItems).values(missing.map(i => ({ entryId: entry.id, templateItemId: i.id })))
    }

    const dueIds = new Set(due.map(i => i.id))
    // Resumed: items taken off by the pause come back.
    const back = have.filter(h => h.templateItemId && dueIds.has(h.templateItemId) && h.archived && !h.completed)
    if (back.length) {
      await db.update(checklistEntryItems).set({ archived: 0 }).where(inArray(checklistEntryItems.id, back.map(b => b.id)))
    }
    const stale = have.filter(h => h.templateItemId && !dueIds.has(h.templateItemId) && !h.completed && !h.archived)
    if (stale.length) {
      await db.update(checklistEntryItems).set({ archived: 1 })
        .where(inArray(checklistEntryItems.id, stale.map(s => s.id)))
    }
  }
}

/**
 * Makes sure the week holding `date` has its weekly-routine items: one entry
 * per weekly routine, dated the week's Sunday. Same rules as a day: items
 * added later join, removed or paused ones leave unless already ticked.
 */
export async function ensureWeek(date: string): Promise<void> {
  const sunday = weekStart(date)
  const templates = (await db.select().from(checklistTemplates)).filter(isWeekly)
  for (const template of templates) {
    const live = !!template.enabled && !template.archivedAt
    let [entry] = await db.select().from(checklistEntries)
      .where(and(eq(checklistEntries.templateId, template.id), eq(checklistEntries.date, sunday)))
    if (!live) {
      if (entry) {
        await db.update(checklistEntryItems).set({ archived: 1 })
          .where(and(eq(checklistEntryItems.entryId, entry.id), eq(checklistEntryItems.completed, 0), eq(checklistEntryItems.archived, 0)))
      }
      continue
    }
    const due = (await db.select().from(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, template.id))).filter(i => !i.retiredAt)
    if (!entry) {
      if (!due.length) continue
      ;[entry] = await db.insert(checklistEntries).values({ templateId: template.id, date: sunday }).returning()
    }
    const have = await db.select().from(checklistEntryItems).where(eq(checklistEntryItems.entryId, entry.id))
    const haveIds = new Set(have.map(h => h.templateItemId))
    const missing = due.filter(i => !haveIds.has(i.id))
    if (missing.length) await db.insert(checklistEntryItems).values(missing.map(i => ({ entryId: entry.id, templateItemId: i.id })))
    const dueIds = new Set(due.map(i => i.id))
    const back = have.filter(h => h.templateItemId && dueIds.has(h.templateItemId) && h.archived && !h.completed)
    if (back.length) await db.update(checklistEntryItems).set({ archived: 0 }).where(inArray(checklistEntryItems.id, back.map(b => b.id)))
    const stale = have.filter(h => h.templateItemId && !dueIds.has(h.templateItemId) && !h.completed && !h.archived)
    if (stale.length) await db.update(checklistEntryItems).set({ archived: 1 }).where(inArray(checklistEntryItems.id, stale.map(s => s.id)))
  }
}

export interface WeeklyItem { id: number; templateId: number; templateItemId: number | null; label: string; done: boolean; completedAt: string | null; streak: number }

/** The weekly routines of the week holding `date`, with each item's run of weeks in a row. */
export async function weekState(date: string): Promise<{ weekOf: string; routines: { templateId: number; name: string; items: WeeklyItem[] }[] }> {
  const sunday = weekStart(date)
  const templates = (await db.select().from(checklistTemplates)).filter(isWeekly)
  if (!templates.length) return { weekOf: sunday, routines: [] }
  const tById = new Map(templates.map(t => [t.id, t]))
  const entries = (await db.select().from(checklistEntries).where(inArray(checklistEntries.templateId, [...tById.keys()])))
  const rows = entries.length ? await db.select().from(checklistEntryItems).where(inArray(checklistEntryItems.entryId, entries.map(e => e.id))) : []
  const tItems = await db.select().from(checklistTemplateItems).where(inArray(checklistTemplateItems.templateId, [...tById.keys()]))
  const tiById = new Map(tItems.map(t => [t.id, t]))
  const dateOf = new Map(entries.map(e => [e.id, e.date]))

  // Weeks in a row: walk back from this week; this week only adds, never breaks.
  const streakOf = (templateItemId: number | null) => {
    if (templateItemId == null) return 0
    const mine = rows.filter(r => r.templateItemId === templateItemId && !r.archived)
      .map(r => ({ date: dateOf.get(r.entryId)!, done: !!r.completed }))
      .filter(r => r.date <= sunday)
      .sort((a, b) => b.date.localeCompare(a.date))
    let n = 0
    for (const r of mine) {
      if (r.date === sunday) { if (r.done) n++; continue }
      if (!r.done) break
      n++
    }
    return n
  }

  const routines = []
  for (const e of entries.filter(e => e.date === sunday)) {
    const t = tById.get(e.templateId!)
    if (!t || t.archivedAt) continue
    const items = rows.filter(r => r.entryId === e.id && !r.archived).map(r => {
      const ti = r.templateItemId ? tiById.get(r.templateItemId) : undefined
      return {
        id: r.id, templateId: t.id, templateItemId: r.templateItemId, label: r.label ?? ti?.label ?? '',
        done: !!r.completed, completedAt: r.completedAt, streak: streakOf(r.templateItemId),
        order: ti?.sortOrder ?? r.id,
      }
    }).sort((a, b) => a.order - b.order).map(({ order: _o, ...i }) => i)
    if (items.length) routines.push({ templateId: t.id, name: t.name, items })
  }
  return { weekOf: sunday, routines }
}

// ─── Streaks ─────────────────────────────────────────────────────────────────

/**
 * Days in a row each routine item landed on time, counted back from the last
 * closed day. Days an item doesn't run are skipped, not counted against it.
 * `today` adds one for items already on time in the open day; an item still
 * waiting today never breaks the run.
 */
export async function itemStreaks(todayOnTime: Set<number> = new Set()): Promise<Map<number, number>> {
  const rows = await db.select({
    templateItemId: checklistEntryItems.templateItemId, result: checklistEntryItems.result,
    archived: checklistEntryItems.archived, date: checklistEntries.date,
  }).from(checklistEntryItems)
    .innerJoin(checklistEntries, eq(checklistEntryItems.entryId, checklistEntries.id))
    .where(and(isNotNull(checklistEntryItems.templateItemId), isNotNull(checklistEntryItems.result)))
  const by = new Map<number, { date: string; result: string }[]>()
  for (const r of rows) {
    if (r.archived || r.templateItemId == null) continue
    const list = by.get(r.templateItemId) ?? []
    list.push({ date: r.date, result: r.result! })
    by.set(r.templateItemId, list)
  }
  const out = new Map<number, number>()
  for (const [id, list] of by) {
    list.sort((a, b) => b.date.localeCompare(a.date))
    let n = 0
    for (const r of list) { if (r.result !== 'on_time') break; n++ }
    out.set(id, n)
  }
  for (const id of todayOnTime) out.set(id, (out.get(id) ?? 0) + 1)
  return out
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Scores a day as it stood at minute `asOf` (minutes from the day's midnight).
 * Ticks after `asOf` are ignored, which is how "last Friday at this hour" is
 * worked out. `closed` scores every item as final.
 */
export async function dayState(date: string, asOf?: number, opts: { closed?: boolean } = {}): Promise<DayState> {
  const [review] = await db.select().from(dayReviews).where(eq(dayReviews.date, date))
  const now = asOf ?? minutesInto(date, new Date())
  const re = !review && now >= 1440 + DAY_START_MIN ? await reopenInfo(date) : null
  const reopened = !!re && re.until > new Date().toISOString()
  const closed = opts.closed ?? (!!review || (now >= 1440 + DAY_START_MIN && !reopened))

  const weekly = await weeklyTemplateIds()
  const entries = (await db.select().from(checklistEntries).where(eq(checklistEntries.date, date)))
    .filter(e => e.templateId == null || !weekly.has(e.templateId))
  const templateOf = new Map(entries.map(e => [e.id, e.templateId]))
  if (!entries.length) {
    return { date, closed, score: null, earned: 0, possible: 0, total: 0, items: [], now }
  }
  const rows = await db.select().from(checklistEntryItems)
    .where(inArray(checklistEntryItems.entryId, entries.map(e => e.id)))
  const tIds = rows.map(r => r.templateItemId).filter((x): x is number => x != null)
  const tItems = tIds.length
    ? await db.select().from(checklistTemplateItems).where(inArray(checklistTemplateItems.id, tIds))
    : []
  const tById = new Map(tItems.map(t => [t.id, t]))

  const items: DayItem[] = []
  for (const r of rows) {
    if (r.archived) continue
    const t = r.templateItemId ? tById.get(r.templateItemId) : undefined
    const clock = parseClock(r.time ?? t?.time)
    const start = clock == null ? null : onDay(clock)
    const end = start == null ? null : start + (t?.windowMin ?? 60)
    const points = pointsFor(r.importance ?? t?.importance, t?.points)
    const doneAt = r.completed && r.completedAt ? minutesInto(date, new Date(r.completedAt)) : null
    const done = doneAt != null && doneAt <= now

    let status: ItemStatus
    let earned = 0
    if (r.result === 'missed' && !r.completed) {
      // Marked missed by hand: an honest "didn't happen". Earns nothing and still counts in the day's possible points.
      status = 'missed'
    } else if (done) {
      const afterDay = doneAt! >= 1440 + DAY_START_MIN
      if (!afterDay && (end == null || doneAt! <= end)) { status = 'on_time'; earned = points }
      else { status = 'late'; earned = points * LATE_CREDIT }
    } else if (start == null) {
      status = closed ? 'missed' : 'anytime'
    } else if (closed) {
      status = 'missed'
    } else if (now < start) {
      status = 'upcoming'
    } else if (now <= end!) {
      status = 'open'
    } else {
      status = 'overdue'
    }

    items.push({
      id: r.id, entryId: r.entryId, templateId: templateOf.get(r.entryId) ?? null, templateItemId: r.templateItemId,
      label: r.label ?? t?.label ?? '',
      time: clock == null ? null : hhmm(clock),
      start, end, importance: r.importance ?? t?.importance ?? null,
      points, status, earned, completedAt: r.completedAt, reason: r.reason,
    })
  }
  items.sort((a, b) => (a.start ?? 99999) - (b.start ?? 99999) || a.id - b.id)

  const total = items.reduce((s, i) => s + i.points, 0)
  const counted = items.filter(i =>
    closed || i.status === 'on_time' || i.status === 'late' || i.status === 'missed' || (i.start != null && now >= i.start))
  const possible = counted.reduce((s, i) => s + i.points, 0)
  const earned = items.reduce((s, i) => s + i.earned, 0)

  if (review) {
    return { date, closed: true, score: review.score, earned: review.earned, possible: review.possible, total, items, now }
  }
  return { date, closed, score: possible > 0 ? Math.round((earned / possible) * 100) : null, earned, possible, total, items, now }
}

/** Whether an item may be ticked now. Returns a reason when it may not. */
export function tickBlocked(item: DayItem, now: number): string | null {
  if (item.start != null && now < item.start - EARLY_MIN) {
    return `Opens at ${hhmm(item.start)}. Items can be ticked up to ${EARLY_MIN / 60} hours early.`
  }
  return null
}

/**
 * Closes a day: every item gets its final result, the score is locked.
 * `reasons` maps entry item id → why it was missed.
 */
export async function closeDay(date: string, opts: { reflection?: string; reasons?: Record<number, string>; auto?: boolean } = {}) {
  const [existing] = await db.select().from(dayReviews).where(eq(dayReviews.date, date))
  if (existing) return existing

  const reopen = await reopenInfo(date)
  const state = await dayState(date, undefined, { closed: true })
  for (const i of state.items) {
    await db.update(checklistEntryItems).set({
      result: i.status === 'on_time' || i.status === 'late' ? i.status : 'missed',
      pointsEarned: i.earned,
      reason: opts.reasons?.[i.id] ?? i.reason ?? null,
    }).where(eq(checklistEntryItems.id, i.id))
  }
  const [row] = await db.insert(dayReviews).values({
    date,
    score: state.possible > 0 ? Math.round((state.earned / state.possible) * 100) : 0,
    earned: state.earned,
    possible: state.possible,
    reflection: opts.reflection?.trim() || reopen?.reflection || null,
    autoClosed: opts.auto ? 1 : 0,
  }).returning()
  if (reopen) await clearReopen(date)
  return row
}

/** Closes every past day that has items but no review (missed reviews, app off). */
export async function autoCloseOpenDays(): Promise<string[]> {
  const today = dayKey()
  const weekly = await weeklyTemplateIds()
  const entries = (await db.select({ date: checklistEntries.date, templateId: checklistEntries.templateId }).from(checklistEntries))
    .filter(e => e.templateId == null || !weekly.has(e.templateId))
  const reviewed = new Set((await db.select({ date: dayReviews.date }).from(dayReviews)).map(r => r.date))
  const open = [...new Set(entries.map(e => e.date))].filter(d => d < today && !reviewed.has(d)).sort()
  const closed: string[] = []
  const nowIso = new Date().toISOString()
  for (const d of open) {
    // A day reopened for corrections stays open until its next 04:00.
    const re = await reopenInfo(d)
    if (re && re.until > nowIso) continue
    await closeDay(d, { auto: true })
    closed.push(d)
  }
  return closed
}

/** Final scores for a date range, from reviews (closed days only). */
export async function scoresBetween(from: string, to: string) {
  return db.select().from(dayReviews).where(and(gte(dayReviews.date, from), lte(dayReviews.date, to)))
}

