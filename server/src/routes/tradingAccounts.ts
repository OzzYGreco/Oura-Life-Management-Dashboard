import { Router } from 'express'
import { db } from '../db'
import { tradingAccounts, trades } from '../db/schema'
import { eq, sql } from 'drizzle-orm'

const router = Router()

// GET / - list all accounts with trade count
router.get('/', async (req, res, next) => {
  try {
    const rows = await db.select({
      id:              tradingAccounts.id,
      name:            tradingAccounts.name,
      broker:          tradingAccounts.broker,
      currency:        tradingAccounts.currency,
      startingBalance: tradingAccounts.startingBalance,
      startingBalanceAt: tradingAccounts.startingBalanceAt,
      notes:           tradingAccounts.notes,
      fullRisk:        tradingAccounts.fullRisk,
      bybitSyncFrom:   tradingAccounts.bybitSyncFrom,
      maxLossDay:      tradingAccounts.maxLossDay,
      maxLossWeek:     tradingAccounts.maxLossWeek,
      maxLossMonth:    tradingAccounts.maxLossMonth,
      lossLimitUnit:   tradingAccounts.lossLimitUnit,
      createdAt:       tradingAccounts.createdAt,
      updatedAt:       tradingAccounts.updatedAt,
      tradeCount:      sql<number>`count(${trades.id})`,
    })
      .from(tradingAccounts)
      .leftJoin(trades, eq(trades.accountId, tradingAccounts.id))
      .groupBy(tradingAccounts.id)
    res.json(rows)
  } catch (e) { next(e) }
})

// POST / - create account
router.post('/', async (req, res, next) => {
  try {
    const { name, broker, currency, startingBalance, notes } = req.body
    const [row] = await db.insert(tradingAccounts).values({
      name,
      broker:          broker || null,
      currency:        currency || 'USD',
      startingBalance: startingBalance != null && startingBalance !== '' ? Number(startingBalance) : null,
      notes:           notes || null,
    }).returning()
    res.status(201).json(row)
  } catch (e) { next(e) }
})

// PUT /:id - update account
router.put('/:id', async (req, res, next) => {
  try {
    const { name, broker, currency, startingBalance, notes, fullRisk } = req.body
    // Loss limits: positive amounts; blank clears one. Only touched when sent.
    const limit = (v: unknown) => (v == null || v === '' ? null : Math.abs(Number(v)) || null)
    const limits: Partial<typeof tradingAccounts.$inferInsert> = {}
    if ('maxLossDay' in req.body) limits.maxLossDay = limit(req.body.maxLossDay)
    if ('maxLossWeek' in req.body) limits.maxLossWeek = limit(req.body.maxLossWeek)
    if ('maxLossMonth' in req.body) limits.maxLossMonth = limit(req.body.maxLossMonth)
    if ('startingBalanceAt' in req.body) limits.startingBalanceAt = req.body.startingBalanceAt || null
    if (req.body.lossLimitUnit === 'R' || req.body.lossLimitUnit === 'USD') limits.lossLimitUnit = req.body.lossLimitUnit
    const [row] = await db.update(tradingAccounts)
      .set({
        ...limits,
        fullRisk:        fullRisk != null && fullRisk !== '' ? Number(fullRisk) : null,
        name,
        broker:          broker || null,
        currency:        currency || 'USD',
        startingBalance: startingBalance != null && startingBalance !== '' ? Number(startingBalance) : null,
        notes:           notes || null,
        updatedAt:       new Date().toISOString(),
      })
      .where(eq(tradingAccounts.id, parseInt(req.params.id)))
      .returning()
    res.json(row)
  } catch (e) { next(e) }
})

// DELETE /:id - block if account has trades
router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await db.select({ id: trades.id })
      .from(trades)
      .where(eq(trades.accountId, parseInt(req.params.id)))
      .limit(1)
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Cannot delete an account that has trades. Reassign or delete the trades first.' })
    }
    await db.delete(tradingAccounts).where(eq(tradingAccounts.id, parseInt(req.params.id)))
    res.status(204).send()
  } catch (e) { next(e) }
})

export default router
