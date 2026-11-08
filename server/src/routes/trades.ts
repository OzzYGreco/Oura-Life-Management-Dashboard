import { Router } from 'express'
import { db } from '../db'
import { trades, tradeScreenshots, tradingSetups, tradeExcursions } from '../db/schema'
import { fillExcursions, pendingExcursions, excursionsRunning } from '../lib/excursions'
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm'
import { screenshotUpload } from '../middleware/upload'
import path from 'path'
import fs from 'fs'
import { computeTradeFields } from '../lib/tradeMath'
import { ensureSetup } from './tradingSetups'
import { outcomeOf } from '../lib/outcome'

const router = Router()

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
    const riskSource = req.body.riskDollars != null && req.body.riskDollars !== '' ? 'user' : null
    ensureSetup(req.body.setupLabel)
    // A trade typed in by hand is reviewed as it is written.
    const [row] = await db.insert(trades).values({ ...req.body, ...computed, riskSource, reviewedAt: new Date().toISOString() }).returning()
    res.status(201).json(row)
  } catch (e) { next(e) }
})

/** The setup picker: active setups, most recently used first. */
router.get('/setup-labels', async (req, res, next) => {
  try {
    const rows = db.select({ name: tradingSetups.name, last: sql<string | null>`(select max(date) from trades where setup_label = ${tradingSetups.name})` })
      .from(tradingSetups).where(eq(tradingSetups.archived, 0)).all()
    rows.sort((a, b) => (b.last ?? '').localeCompare(a.last ?? '') || a.name.localeCompare(b.name))
    res.json(rows.map(r => r.name))
  } catch (e) { next(e) }
})

/** Takes a setup out of the picker. Trades keep it; nothing is erased. */
router.delete('/setup-labels/:label', async (req, res, next) => {
  try {
    const label = decodeURIComponent(req.params.label)
    db.update(tradingSetups).set({ archived: 1 }).where(eq(tradingSetups.name, label)).run()
    res.status(204).send()
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
    const pnl = (t: typeof rows[number]) => t.netPnl ?? t.realizedPnl ?? 0
    // Inside ±0.1R is breakeven: neither a win nor a loss.
    const outcomes = rows.map(t => outcomeOf(t.rrRatio, pnl(t)))
    const wins = outcomes.filter(o => o === 'win').length
    const losses = outcomes.filter(o => o === 'loss').length
    const totalPnl = rows.reduce((s, t) => s + pnl(t), 0)
    const avgRR = rows.filter(t => t.rrRatio != null).reduce((s, t) => s + (t.rrRatio ?? 0), 0) / (rows.filter(t => t.rrRatio != null).length || 1)
    const profitFactor = (() => {
      const g = rows.filter(t => pnl(t) > 0).reduce((s, t) => s + pnl(t), 0)
      const l = Math.abs(rows.filter(t => pnl(t) < 0).reduce((s, t) => s + pnl(t), 0))
      return l > 0 ? g / l : null
    })()

    res.json({ totalTrades: total, wins, losses, breakeven: total - wins - losses, winRate: total > 0 ? wins / total : 0, totalPnl, avgRR, profitFactor })
  } catch (e) { next(e) }
})

router.get('/analytics/equity', async (req, res, next) => {
  try {
    const { from, to, accountId } = req.query
    const conditions: ReturnType<typeof gte>[] = []
    if (from) conditions.push(gte(trades.date, from as string))
    if (to) conditions.push(lte(trades.date, to as string))
    if (accountId) conditions.push(eq(trades.accountId, Number(accountId)))

    const rows = await db.select({ date: trades.date, pnl: sql<number | null>`coalesce(${trades.netPnl}, ${trades.realizedPnl})` })
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

/**
 * MFE/MAE for each crypto trade (see lib/excursions). Returns what's computed;
 * anything missing is worked out in the background and `pending` says how
 * many are still to come, so the page can poll.
 */
router.get('/analytics/excursions', (req, res, next) => {
  try {
    const accountId = req.query.accountId ? Number(req.query.accountId) : undefined
    const pending = pendingExcursions(accountId).length
    if (pending) fillExcursions()
    const rows = db.select().from(tradeExcursions).all()
    res.json({ pending, running: excursionsRunning(), rows: rows.map(({ basis, ...r }) => r) })
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

/** On a Bybit trade these are the exchange's, kept by the sync; an edit can't change them. */
const BYBIT_OWNED = [
  'date', 'time', 'durationMinutes', 'closedAt', 'instrument', 'asset', 'direction', 'orderType', 'exitOrderType',
  'entryPrice', 'exitPrice', 'size', 'isCompounded', 'entries', 'takeProfits',
  'entryFeeAmount', 'exitFeeAmount', 'fundingFeeAmount', 'slippageAmount', 'realizedPnl', 'netPnl',
  'riskAtStop', 'source', 'externalId', 'bybitAccountId', 'riskSource', 'stopPlacedAt',
] as const

router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id)
    const [current] = await db.select().from(trades).where(eq(trades.id, id))
    if (!current) return res.status(404).json({ error: 'Not found' })
    const body = { ...req.body }
    delete body.id; delete body.createdAt; delete body.updatedAt; delete body.screenshots
    // { reviewed: true } finishes the review; the server stamps the time.
    if ('reviewed' in body) { body.reviewedAt = body.reviewed ? new Date().toISOString() : null; delete body.reviewed }
    delete body.stopPlacedAt
    // Picked in the review even if it equals what the stop risked: still the user's.
    const riskConfirmed = !!body.riskConfirmed; delete body.riskConfirmed
    if (typeof body.setupLabel === 'string') { body.setupLabel = body.setupLabel.trim() || null; ensureSetup(body.setupLabel) }

    if (current.source === 'bybit') {
      for (const k of BYBIT_OWNED) delete body[k]
      // Planned risk: a typed amount is the user's and the sync keeps it;
      // cleared, it goes back to what the stop risked.
      if ('riskDollars' in body) {
        const r = body.riskDollars === '' || body.riskDollars == null ? null : Number(body.riskDollars)
        if (r == null) { body.riskDollars = current.riskAtStop; body.riskSource = current.riskAtStop != null ? 'bybit' : null }
        else if (r !== current.riskDollars || riskConfirmed) { body.riskDollars = r; body.riskSource = 'user' }
      }
    } else if ('riskDollars' in body) {
      body.riskSource = body.riskDollars == null || body.riskDollars === '' ? null : 'user'
    }

    const computed = computeTradeFields({ ...current, ...body })
    const [row] = await db.update(trades)
      .set({ ...body, ...computed, updatedAt: new Date().toISOString() })
      .where(eq(trades.id, id))
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
