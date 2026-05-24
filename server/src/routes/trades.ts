import { Router } from 'express'
import { db } from '../db'
import { trades, tradeScreenshots } from '../db/schema'
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm'
import { screenshotUpload } from '../middleware/upload'
import path from 'path'
import fs from 'fs'

const router = Router()

function computeTradeFields(data: {
  entryPrice?: number | null
  exitPrice?: number | null
  size?: number | null
  direction?: string | null
  riskDollars?: number | null
}) {
  const { entryPrice, exitPrice, size, direction, riskDollars } = data
  let realizedPnl: number | null = null
  let deviationPct: number | null = null
  let rrRatio: number | null = null

  if (entryPrice != null && exitPrice != null && size != null && direction) {
    const mult = direction === 'Long' ? 1 : -1
    realizedPnl = (exitPrice - entryPrice) * size * mult
  }

  if (realizedPnl != null && riskDollars != null && riskDollars > 0) {
    rrRatio = realizedPnl / riskDollars
    const loss = Math.min(realizedPnl, 0)
    deviationPct = Math.abs((loss / riskDollars - 1) * 100)
  }

  return { realizedPnl, deviationPct, rrRatio }
}

router.get('/', async (req, res, next) => {
  try {
    const { from, to, instrument, asset, direction, accountId } = req.query
    const conditions: ReturnType<typeof gte>[] = []
    if (from) conditions.push(gte(trades.date, from as string))
    if (to) conditions.push(lte(trades.date, to as string))
    if (instrument) conditions.push(eq(trades.instrument, instrument as string))
    if (asset) conditions.push(eq(trades.asset, asset as string))
    if (direction) conditions.push(eq(trades.direction, direction as string))
    if (accountId) conditions.push(eq(trades.accountId, Number(accountId)))

    const rows = await db.select().from(trades)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(trades.date), desc(trades.time))

    const screenshots = await db.select().from(tradeScreenshots)
    const screenshotMap: Record<number, typeof screenshots> = {}
    for (const s of screenshots) {
      if (!screenshotMap[s.tradeId]) screenshotMap[s.tradeId] = []
      screenshotMap[s.tradeId].push(s)
    }

    res.json(rows.map(t => ({ ...t, screenshots: screenshotMap[t.id] || [] })))
  } catch (e) { next(e) }
})

router.post('/', async (req, res, next) => {
  try {
    const computed = computeTradeFields(req.body)
    const [row] = await db.insert(trades).values({ ...req.body, ...computed }).returning()
    res.status(201).json(row)
  } catch (e) { next(e) }
})

router.get('/analytics/summary', async (req, res, next) => {
  try {
    const { from, to, accountId } = req.query
    const conditions: ReturnType<typeof gte>[] = []
    if (from) conditions.push(gte(trades.date, from as string))
    if (to) conditions.push(lte(trades.date, to as string))
    if (accountId) conditions.push(eq(trades.accountId, Number(accountId)))

    const rows = await db.select().from(trades)
      .where(conditions.length ? and(...conditions) : undefined)

    const total = rows.length
    const wins = rows.filter(t => (t.realizedPnl ?? 0) > 0).length
    const totalPnl = rows.reduce((s, t) => s + (t.realizedPnl ?? 0), 0)
    const avgRR = rows.filter(t => t.rrRatio != null).reduce((s, t) => s + (t.rrRatio ?? 0), 0) / (rows.filter(t => t.rrRatio != null).length || 1)
    const profitFactor = (() => {
      const g = rows.filter(t => (t.realizedPnl ?? 0) > 0).reduce((s, t) => s + (t.realizedPnl ?? 0), 0)
      const l = Math.abs(rows.filter(t => (t.realizedPnl ?? 0) < 0).reduce((s, t) => s + (t.realizedPnl ?? 0), 0))
      return l > 0 ? g / l : null
    })()

    res.json({ totalTrades: total, wins, losses: total - wins, winRate: total > 0 ? wins / total : 0, totalPnl, avgRR, profitFactor })
  } catch (e) { next(e) }
})

router.get('/analytics/equity', async (req, res, next) => {
  try {
    const { from, to, accountId } = req.query
    const conditions: ReturnType<typeof gte>[] = []
    if (from) conditions.push(gte(trades.date, from as string))
    if (to) conditions.push(lte(trades.date, to as string))
    if (accountId) conditions.push(eq(trades.accountId, Number(accountId)))

    const rows = await db.select({ date: trades.date, pnl: trades.realizedPnl })
      .from(trades)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(trades.date, trades.time)

    let cumulative = 0
    const curve = rows.map(r => {
      cumulative += r.pnl ?? 0
      return { date: r.date, cumulativePnl: cumulative }
    })
    res.json(curve)
  } catch (e) { next(e) }
})

router.get('/analytics/mistakes', async (req, res, next) => {
  try {
    const { accountId } = req.query
    const conditions: ReturnType<typeof gte>[] = []
    if (accountId) conditions.push(eq(trades.accountId, Number(accountId)))
    const rows = await db.select({ mistakes: trades.mistakes }).from(trades)
      .where(conditions.length ? and(...conditions) : undefined)
    const counts: Record<string, number> = {}
    for (const r of rows) {
      if (Array.isArray(r.mistakes)) {
        for (const m of r.mistakes) counts[m] = (counts[m] || 0) + 1
      }
    }
    res.json(Object.entries(counts).map(([mistake, count]) => ({ mistake, count })).sort((a, b) => b.count - a.count))
  } catch (e) { next(e) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const [trade] = await db.select().from(trades).where(eq(trades.id, parseInt(req.params.id)))
    if (!trade) return res.status(404).json({ error: 'Not found' })
    const screenshots = await db.select().from(tradeScreenshots).where(eq(tradeScreenshots.tradeId, trade.id))
    res.json({ ...trade, screenshots })
  } catch (e) { next(e) }
})

router.put('/:id', async (req, res, next) => {
  try {
    const computed = computeTradeFields(req.body)
    const [row] = await db.update(trades)
      .set({ ...req.body, ...computed, updatedAt: new Date().toISOString() })
      .where(eq(trades.id, parseInt(req.params.id)))
      .returning()
    res.json(row)
  } catch (e) { next(e) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await db.delete(trades).where(eq(trades.id, parseInt(req.params.id)))
    res.status(204).send()
  } catch (e) { next(e) }
})

router.post('/:id/screenshots', screenshotUpload.array('screenshots', 10), async (req, res, next) => {
  try {
    const files = req.files as Express.Multer.File[]
    const notes: string[] = Array.isArray(req.body.notes) ? req.body.notes : [req.body.notes || '']
    const inserted = await Promise.all(files.map((f, i) =>
      db.insert(tradeScreenshots).values({
        tradeId: parseInt(req.params.id),
        filePath: `/uploads/screenshots/${f.filename}`,
        note: notes[i] || null,
        sortOrder: i,
      }).returning().then(r => r[0])
    ))
    res.status(201).json(inserted)
  } catch (e) { next(e) }
})

router.put('/:id/screenshots/:screenshotId', async (req, res, next) => {
  try {
    const [row] = await db.update(tradeScreenshots)
      .set({ note: req.body.note })
      .where(eq(tradeScreenshots.id, parseInt(req.params.screenshotId)))
      .returning()
    res.json(row)
  } catch (e) { next(e) }
})

router.delete('/:id/screenshots/:screenshotId', async (req, res, next) => {
  try {
    const [ss] = await db.select().from(tradeScreenshots).where(eq(tradeScreenshots.id, parseInt(req.params.screenshotId)))
    if (ss) {
      const fp = path.join(__dirname, '../../uploads', ss.filePath.replace('/uploads/', ''))
      if (fs.existsSync(fp)) fs.unlinkSync(fp)
      await db.delete(tradeScreenshots).where(eq(tradeScreenshots.id, ss.id))
    }
    res.status(204).send()
  } catch (e) { next(e) }
})

export default router
