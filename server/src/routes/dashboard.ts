import { Router } from 'express'
import { db } from '../db'
import {
  trades, checklistEntries, checklistEntryItems, checklistTemplateItems,
  goals,
  calendarEvents, trainingWorkouts, financeExpenses,
  financeIncome, marketingCampaigns,
} from '../db/schema'
import { eq, and, gte, lte, desc, ne } from 'drizzle-orm'
import { localToday, localDateStr } from '../lib/date'
import { businessDashboardSummary } from '../lib/businessMetrics'

const router = Router()

router.get('/summary', async (req, res, next) => {
  try {
    const date    = (req.query.date as string) || localToday()
    const [y, m]  = date.split('-')
    const monthStart = `${y}-${m}-01`
    const monthEnd   = `${y}-${m}-31`

    // ── Week bounds (Mon–Sun) ──────────────────────────────────────────────
    const dayOfWeek  = new Date(date + 'T00:00:00Z').getUTCDay() // 0=Sun
    const daysToMon  = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const weekMonday = new Date(date + 'T00:00:00Z')
    weekMonday.setUTCDate(weekMonday.getUTCDate() + daysToMon)
    const weekStart  = weekMonday.toISOString().split('T')[0]

    // ── Today's P&L ───────────────────────────────────────────────────────
    const todayTrades = await db.select().from(trades).where(eq(trades.date, date))
    const todayPnl    = todayTrades.reduce((s, t) => s + (t.realizedPnl ?? 0), 0)

    // ── 7-day P&L (last 7 calendar days) ─────────────────────────────────
    const d7ago = new Date(date + 'T00:00:00Z')
    d7ago.setUTCDate(d7ago.getUTCDate() - 6)
    const sevenDayStart = d7ago.toISOString().split('T')[0]
    const recentTrades  = await db.select().from(trades)
      .where(and(gte(trades.date, sevenDayStart), lte(trades.date, date)))
      .orderBy(trades.date)
    // Group by date
    const pnlByDate: Record<string, number> = {}
    for (let i = 0; i < 7; i++) {
      const d = new Date(d7ago); d.setUTCDate(d.getUTCDate() + i)
      pnlByDate[d.toISOString().split('T')[0]] = 0
    }
    recentTrades.forEach(t => {
      if (pnlByDate[t.date] !== undefined) pnlByDate[t.date] += (t.netPnl ?? t.realizedPnl ?? 0)
    })
    const pnlLast7 = Object.entries(pnlByDate).map(([d, pnl]) => ({
      date:  d,
      label: new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short' }),
      pnl,
    }))

    // ── MTD trading stats ─────────────────────────────────────────────────
    const mtdTrades   = await db.select().from(trades).where(and(gte(trades.date, monthStart), lte(trades.date, monthEnd)))
    const mtdPnl      = mtdTrades.reduce((s, t) => s + (t.netPnl ?? t.realizedPnl ?? 0), 0)
    const winCount    = mtdTrades.filter(t => (t.netPnl ?? t.realizedPnl ?? 0) > 0).length
    const lossCount   = mtdTrades.filter(t => (t.netPnl ?? t.realizedPnl ?? 0) < 0).length
    const winRate     = mtdTrades.length > 0 ? Math.round((winCount / mtdTrades.length) * 100) : null
    const avgRR       = mtdTrades.length > 0
      ? mtdTrades.reduce((s, t) => s + (t.rrRatio ?? 0), 0) / mtdTrades.length
      : null

    // ── Checklist progress ────────────────────────────────────────────────
    const todayEntries = await db.select().from(checklistEntries).where(eq(checklistEntries.date, date))
    let totalItems = 0, completedItems = 0
    const checklistItems: { entryId: number; itemId: number; title: string; completed: boolean; time: string | null }[] = []
    const allTemplateItems = await db.select().from(checklistTemplateItems)
    for (const entry of todayEntries) {
      const items = await db.select().from(checklistEntryItems).where(eq(checklistEntryItems.entryId, entry.id))
      totalItems    += items.length
      completedItems += items.filter(i => i.completed || i.archived).length
      items.filter(i => !i.archived).forEach(i => {
        const tmpl = allTemplateItems.find(t => t.id === i.templateItemId)
        checklistItems.push({ entryId: entry.id, itemId: i.id, title: tmpl?.label ?? ' - ', completed: !!i.completed, time: tmpl?.time ?? null })
      })
    }

    // ── Goals ─────────────────────────────────────────────────────────────
    const activeGoals = await db.select().from(goals).where(eq(goals.status, 'active')).limit(5)

    // ── Business ──────────────────────────────────────────────────────────
    // One engine, shared with the Business tab. This panel used to compute its
    // own net profit as revenue minus ad spend, which ignored every business
    // expense and disagreed with the Business tab by the whole expense total.
    const biz = await businessDashboardSummary(date)
    const totalRevenue   = biz.totalRevenue
    const revenueMTD     = biz.collectedMTD
    const outstandingAmt = biz.outstanding
    const activeClients  = biz.activeClients
    const nextDue        = biz.nextDue

    // ── Finance ───────────────────────────────────────────────────────────
    const mtdExpenses    = await db.select().from(financeExpenses)
      .where(and(gte(financeExpenses.date, monthStart), lte(financeExpenses.date, monthEnd), ne(financeExpenses.category, 'Business')))
    const mtdIncome      = await db.select().from(financeIncome)
      .where(and(gte(financeIncome.date, monthStart), lte(financeIncome.date, monthEnd)))
    const totalExpMTD    = mtdExpenses.reduce((s, e) => s + e.amount, 0)
    const totalIncMTD    = mtdIncome.reduce((s, i) => s + i.amount, 0)

    // ── Marketing ─────────────────────────────────────────────────────────
    const campaigns       = await db.select().from(marketingCampaigns)
    const activeCampaigns = campaigns.filter(c => c.status === 'active').length
    // Ad spend pro-rated across each campaign's running days, not charged in
    // full to whatever window is being viewed.
    const bizAdSpent      = biz.adSpend
    const netProfit       = biz.netProfit

    // ── Training ──────────────────────────────────────────────────────────
    const allWorkouts    = await db.select().from(trainingWorkouts).orderBy(desc(trainingWorkouts.date))
    const weekWorkouts   = allWorkouts.filter(w => w.date >= weekStart && w.date <= date)
    const lastWorkout    = allWorkouts[0] ?? null

    // Current streak
    const workoutDays = [...new Set(allWorkouts.map(w => w.date))].sort().reverse()
    let streak = 0
    let streakCursor: string | null = workoutDays[0] === date ? date : null
    if (streakCursor) {
      for (const wd of workoutDays) {
        if (wd === streakCursor) {
          streak++
          const prevDate: Date = new Date(streakCursor + 'T00:00:00Z')
          prevDate.setUTCDate(prevDate.getUTCDate() - 1)
          streakCursor = prevDate.toISOString().split('T')[0]
        } else break
      }
    }

    // ── Upcoming calendar events (next 7 days) ────────────────────────────
    const futureDate = new Date(date + 'T00:00:00Z')
    futureDate.setUTCDate(futureDate.getUTCDate() + 7)
    const upcomingEvents = await db.select().from(calendarEvents)
      .where(gte(calendarEvents.startDatetime, date))
      .orderBy(calendarEvents.startDatetime)
      .limit(5)

    res.json({
      // Trading
      todayPnl,
      todayTradeCount:  todayTrades.length,
      todayTradesDetail: todayTrades.map(t => ({
        id: t.id, asset: t.asset, direction: t.direction,
        realizedPnl: t.realizedPnl, rrRatio: t.rrRatio, setupLabel: t.setupLabel,
      })),
      mtdPnl,
      mtdTradeCount:    mtdTrades.length,
      winRate,
      avgRR,
      pnlLast7,

      // Checklist
      checklistProgress: { completed: completedItems, total: totalItems },
      checklistItems,

      // Goals
      goalHighlights: activeGoals,

      // Business
      totalRevenue,
      revenueMTD,
      outstandingAmt,
      activeClients,
      nextDue,
      netProfit,
      bizAdSpent,
      activeCampaigns,
      mrr:             biz.mrr,
      arr:             biz.arr,
      activeRetainers: biz.activeRetainers,
      netNewMrr:       biz.netNewMrr,
      ownerPayMTD:     biz.ownerPayMTD,
      marginPct:       biz.marginPct,

      // Finance
      totalExpMTD,
      totalIncMTD,

      // Training
      weekWorkoutsCount: weekWorkouts.length,
      trainingStreak:    streak,
      lastWorkout,

      // Calendar
      upcomingEvents,
    })
  } catch (e) { next(e) }
})

export default router
