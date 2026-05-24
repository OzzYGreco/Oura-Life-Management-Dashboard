import { Router } from 'express'
import { db } from '../db'
import { financeAccounts, financeIncome, financeExpenses, financeNetWorthSnapshots, financeBudgets, trades, businessInvoices } from '../db/schema'
import { eq, and, gte, lte, sum, isNull, ne } from 'drizzle-orm'
import { localToday } from '../lib/date'

const router = Router()

// ─── Helpers ─────────────────────────────────────────────────────────────────

function monthKey(dateStr: string) { return dateStr.slice(0, 7) } // "2026-05"

function last12Months(): string[] {
  const months: string[] = []
  const d = new Date()
  for (let i = 11; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    months.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

// ─── Recurring Materialization ────────────────────────────────────────────────

/** Add n months to a YYYY-MM-DD string, clamping to end-of-month if needed. */
function addMonthsToDateStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const targetYear  = y + Math.floor((m - 1 + n) / 12)
  const targetMonth = ((m - 1 + n) % 12 + 12) % 12 + 1
  const maxDay      = new Date(targetYear, targetMonth, 0).getDate() // last day of target month
  const targetDay   = Math.min(d, maxDay)
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`
}

/** Return the next occurrence date for a given frequency. */
function advanceDate(dateStr: string, frequency: string): string {
  switch (frequency) {
    case 'weekly': {
      const [y, m, d] = dateStr.split('-').map(Number)
      const dt = new Date(y, m - 1, d + 7)
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    }
    case 'monthly':   return addMonthsToDateStr(dateStr, 1)
    case 'quarterly': return addMonthsToDateStr(dateStr, 3)
    case 'yearly':    return addMonthsToDateStr(dateStr, 12)
    default:          return addMonthsToDateStr(dateStr, 1)
  }
}

let lastMaterializedAt = 0

/**
 * For every recurring expense/income template that has not yet been materialized
 * up to today, generate the missing occurrence rows and update `lastGeneratedDate`.
 *
 * Uses `lastGeneratedDate` as a high-water mark so:
 *  - deleted occurrences are NOT re-generated
 *  - each occurrence is only ever inserted once
 *
 * Rate-limited to once every 5 minutes per server process.
 */
export async function materializeRecurring(): Promise<void> {
  const now = Date.now()
  if (now - lastMaterializedAt < 5 * 60 * 1000) return
  lastMaterializedAt = now

  const today = localToday()

  // ── Expenses ──────────────────────────────────────────────────────────────
  const expTemplates = await db
    .select()
    .from(financeExpenses)
    .where(and(eq(financeExpenses.isRecurring, 1), isNull(financeExpenses.recurringParentId)))

  for (const t of expTemplates) {
    if (!t.frequency) continue
    const fromDate = t.lastGeneratedDate ?? t.date
    let cursor     = advanceDate(fromDate, t.frequency)
    let newLast    = fromDate
    let safety     = 0

    while (cursor <= today && safety < 600) {
      safety++
      await db.insert(financeExpenses).values({
        description:       t.description,
        amount:            t.amount,
        category:          t.category,
        date:              cursor,
        accountId:         t.accountId,
        isRecurring:       1,
        frequency:         t.frequency,
        notes:             t.notes,
        recurringParentId: t.id,
      })
      newLast = cursor
      cursor  = advanceDate(cursor, t.frequency)
    }

    // Update high-water mark:
    //  - New entries were generated → advance to the last generated date
    //  - First ever run (lastGeneratedDate was null) → initialise to template's own date
    //  - Subsequent run with nothing new → leave lastGeneratedDate untouched
    if (newLast !== fromDate) {
      await db.update(financeExpenses)
        .set({ lastGeneratedDate: newLast })
        .where(eq(financeExpenses.id, t.id))
    } else if (!t.lastGeneratedDate) {
      await db.update(financeExpenses)
        .set({ lastGeneratedDate: t.date })
        .where(eq(financeExpenses.id, t.id))
    }
  }

  // ── Income ────────────────────────────────────────────────────────────────
  const incTemplates = await db
    .select()
    .from(financeIncome)
    .where(and(
      isNull(financeIncome.recurringParentId),
      ne(financeIncome.frequency, 'one-time'),
    ))

  for (const t of incTemplates) {
    const fromDate = t.lastGeneratedDate ?? t.date
    let cursor     = advanceDate(fromDate, t.frequency)
    let newLast    = fromDate
    let safety     = 0

    while (cursor <= today && safety < 600) {
      safety++
      await db.insert(financeIncome).values({
        source:            t.source,
        amount:            t.amount,
        frequency:         t.frequency,
        category:          t.category,
        date:              cursor,
        accountId:         t.accountId,
        notes:             t.notes,
        recurringParentId: t.id,
      })
      newLast = cursor
      cursor  = advanceDate(cursor, t.frequency)
    }

    if (newLast !== fromDate) {
      await db.update(financeIncome)
        .set({ lastGeneratedDate: newLast })
        .where(eq(financeIncome.id, t.id))
    } else if (!t.lastGeneratedDate) {
      await db.update(financeIncome)
        .set({ lastGeneratedDate: t.date })
        .where(eq(financeIncome.id, t.id))
    }
  }
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

router.get('/accounts', async (_req, res, next) => {
  try {
    const accounts = await db.select().from(financeAccounts)
    const tradingPnl = await db.select({ total: sum(trades.realizedPnl) }).from(trades)
    const totalPnl = Number(tradingPnl[0]?.total ?? 0)
    res.json(accounts.map(a => ({
      ...a,
      displayBalance: a.isTrading ? a.balance + totalPnl : a.balance,
    })))
  } catch (e) { next(e) }
})

router.post('/accounts', async (req, res, next) => {
  try { res.status(201).json((await db.insert(financeAccounts).values(req.body).returning())[0]) } catch (e) { next(e) }
})
router.put('/accounts/:id', async (req, res, next) => {
  try { res.json((await db.update(financeAccounts).set({ ...req.body, updatedAt: new Date().toISOString() }).where(eq(financeAccounts.id, parseInt(req.params.id))).returning())[0]) } catch (e) { next(e) }
})
router.delete('/accounts/:id', async (req, res, next) => {
  try { await db.delete(financeAccounts).where(eq(financeAccounts.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

// ─── Income ───────────────────────────────────────────────────────────────────

router.get('/income', async (req, res, next) => {
  try {
    await materializeRecurring()
    const { from, to } = req.query
    const conds: any[] = []
    if (from) conds.push(gte(financeIncome.date, from as string))
    if (to) conds.push(lte(financeIncome.date, to as string))
    res.json(await db.select().from(financeIncome).where(conds.length ? and(...conds) : undefined))
  } catch (e) { next(e) }
})
router.post('/income', async (req, res, next) => {
  try {
    const row = (await db.insert(financeIncome).values(req.body).returning())[0]
    // If the new entry is recurring, allow materialization on the very next fetch
    if (req.body.frequency && req.body.frequency !== 'one-time') lastMaterializedAt = 0
    res.status(201).json(row)
  } catch (e) { next(e) }
})
router.put('/income/:id', async (req, res, next) => {
  try { res.json((await db.update(financeIncome).set(req.body).where(eq(financeIncome.id, parseInt(req.params.id))).returning())[0]) } catch (e) { next(e) }
})
router.delete('/income/:id', async (req, res, next) => {
  try { await db.delete(financeIncome).where(eq(financeIncome.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

// ─── Expenses ─────────────────────────────────────────────────────────────────

router.get('/expenses', async (req, res, next) => {
  try {
    await materializeRecurring()
    const { from, to, category, recurring, excludeBusiness } = req.query
    const conds: any[] = []
    if (from) conds.push(gte(financeExpenses.date, from as string))
    if (to) conds.push(lte(financeExpenses.date, to as string))
    if (category) conds.push(eq(financeExpenses.category, category as string))
    if (recurring === '1') conds.push(eq(financeExpenses.isRecurring, 1))
    if (excludeBusiness === '1') conds.push(ne(financeExpenses.category, 'Business'))
    res.json(await db.select().from(financeExpenses).where(conds.length ? and(...conds) : undefined))
  } catch (e) { next(e) }
})
router.post('/expenses', async (req, res, next) => {
  try {
    const row = (await db.insert(financeExpenses).values(req.body).returning())[0]
    // If the new entry is recurring, allow materialization on the very next fetch
    if (req.body.isRecurring) lastMaterializedAt = 0
    res.status(201).json(row)
  } catch (e) { next(e) }
})
router.put('/expenses/:id', async (req, res, next) => {
  try { res.json((await db.update(financeExpenses).set(req.body).where(eq(financeExpenses.id, parseInt(req.params.id))).returning())[0]) } catch (e) { next(e) }
})
router.delete('/expenses/:id', async (req, res, next) => {
  try { await db.delete(financeExpenses).where(eq(financeExpenses.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

// ─── Budgets ──────────────────────────────────────────────────────────────────

router.get('/budgets', async (_req, res, next) => {
  try { res.json(await db.select().from(financeBudgets)) } catch (e) { next(e) }
})
router.post('/budgets', async (req, res, next) => {
  try {
    // Upsert by category
    const existing = await db.select().from(financeBudgets).where(eq(financeBudgets.category, req.body.category))
    if (existing.length) {
      const [r] = await db.update(financeBudgets).set({ monthlyLimit: req.body.monthlyLimit, updatedAt: new Date().toISOString() }).where(eq(financeBudgets.category, req.body.category)).returning()
      return res.json(r)
    }
    res.status(201).json((await db.insert(financeBudgets).values(req.body).returning())[0])
  } catch (e) { next(e) }
})
router.delete('/budgets/:id', async (req, res, next) => {
  try { await db.delete(financeBudgets).where(eq(financeBudgets.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

// ─── Cash Flow (monthly breakdown) ───────────────────────────────────────────

router.get('/cashflow', async (req, res, next) => {
  try {
    const includeTrading      = req.query.includeTrading === '1'
    const includePaidInvoices = req.query.includePaidInvoices === '1'
    const excludeBusiness     = req.query.excludeBusiness === '1'
    const months = last12Months()

    const allIncome   = await db.select().from(financeIncome)
    let   allExpenses = await db.select().from(financeExpenses)
    if (excludeBusiness) allExpenses = allExpenses.filter(e => e.category !== 'Business')

    const allTrades   = includeTrading ? await db.select().from(trades) : []
    const allInvoices = includePaidInvoices
      ? await db.select().from(businessInvoices).where(eq(businessInvoices.status, 'paid'))
      : []

    const result = months.map(month => {
      const income = allIncome.filter(i => monthKey(i.date) === month).reduce((s, i) => s + i.amount, 0)
      const expenses = allExpenses.filter(e => monthKey(e.date) === month).reduce((s, e) => s + e.amount, 0)
      const tradingPnl = includeTrading
        ? allTrades.filter(t => monthKey(t.date) === month).reduce((s, t) => s + (t.realizedPnl ?? 0), 0)
        : 0
      const invoiceIncome = includePaidInvoices
        ? allInvoices.filter(i => i.paidDate && monthKey(i.paidDate) === month).reduce((s, i) => s + i.amount, 0)
        : 0

      const totalIncome = income + tradingPnl + invoiceIncome
      const net = totalIncome - expenses
      const savingsRate = totalIncome > 0 ? (net / totalIncome) * 100 : 0

      return { month, income, tradingPnl, invoiceIncome, totalIncome, expenses, net, savingsRate }
    })

    res.json(result)
  } catch (e) { next(e) }
})

// ─── Income Streams breakdown ─────────────────────────────────────────────────

router.get('/streams', async (req, res, next) => {
  try {
    const { from, to, includeTrading, includePaidInvoices } = req.query
    const conds: any[] = []
    if (from) conds.push(gte(financeIncome.date, from as string))
    if (to) conds.push(lte(financeIncome.date, to as string))

    const income   = await db.select().from(financeIncome).where(conds.length ? and(...conds) : undefined)
    const tradeConds: any[] = []
    if (from) tradeConds.push(gte(trades.date, from as string))
    if (to) tradeConds.push(lte(trades.date, to as string))
    const tradeRows = includeTrading === '1' ? await db.select().from(trades).where(tradeConds.length ? and(...tradeConds) : undefined) : []
    const invoices  = includePaidInvoices === '1' ? await db.select().from(businessInvoices).where(eq(businessInvoices.status, 'paid')) : []

    const tradingTotal  = tradeRows.reduce((s, t) => s + (t.realizedPnl ?? 0), 0)
    const invoiceTotal  = invoices.filter(i => !from || (i.paidDate && i.paidDate >= (from as string))).reduce((s, i) => s + i.amount, 0)
    const businessTotal = income.filter(i => i.category === 'Business' || i.category === 'Freelance').reduce((s, i) => s + i.amount, 0) + invoiceTotal
    const otherTotal    = income.filter(i => i.category !== 'Business' && i.category !== 'Freelance' && i.category !== 'Trading').reduce((s, i) => s + i.amount, 0)
    const manualTrading = income.filter(i => i.category === 'Trading').reduce((s, i) => s + i.amount, 0)
    const totalTrading  = tradingTotal + manualTrading

    const total = totalTrading + businessTotal + otherTotal
    res.json({
      trading:  { amount: totalTrading,  pct: total > 0 ? (totalTrading  / total) * 100 : 0 },
      business: { amount: businessTotal, pct: total > 0 ? (businessTotal / total) * 100 : 0 },
      other:    { amount: otherTotal,    pct: total > 0 ? (otherTotal    / total) * 100 : 0 },
      total,
    })
  } catch (e) { next(e) }
})

// ─── Net Worth ────────────────────────────────────────────────────────────────

router.get('/net-worth', async (_req, res, next) => {
  try {
    const snapshots = await db.select().from(financeNetWorthSnapshots).orderBy(financeNetWorthSnapshots.date)
    const latest = snapshots[snapshots.length - 1] || null
    res.json({ latest, snapshots })
  } catch (e) { next(e) }
})
router.post('/net-worth/snapshot', async (req, res, next) => {
  try {
    const date = req.body.date || localToday()
    const existing = await db.select().from(financeNetWorthSnapshots).where(eq(financeNetWorthSnapshots.date, date))
    if (existing.length) {
      const [r] = await db.update(financeNetWorthSnapshots).set(req.body).where(eq(financeNetWorthSnapshots.date, date)).returning()
      return res.json(r)
    }
    res.status(201).json((await db.insert(financeNetWorthSnapshots).values({ ...req.body, date }).returning())[0])
  } catch (e) { next(e) }
})

// ─── Summary ──────────────────────────────────────────────────────────────────

router.get('/summary', async (req, res, next) => {
  try {
    const { from, to, includeTrading, includePaidInvoices, excludeBusiness } = req.query
    const conds: any[] = []
    if (from) conds.push(gte(financeIncome.date, from as string))
    if (to) conds.push(lte(financeIncome.date, to as string))
    const income = await db.select().from(financeIncome).where(conds.length ? and(...conds) : undefined)

    const econds: any[] = []
    if (from) econds.push(gte(financeExpenses.date, from as string))
    if (to) econds.push(lte(financeExpenses.date, to as string))
    if (excludeBusiness === '1') econds.push(ne(financeExpenses.category, 'Business'))
    const expenses = await db.select().from(financeExpenses).where(econds.length ? and(...econds) : undefined)

    const tradeConds: any[] = []
    if (from) tradeConds.push(gte(trades.date, from as string))
    if (to) tradeConds.push(lte(trades.date, to as string))
    const tradeRows = includeTrading === '1' ? await db.select().from(trades).where(tradeConds.length ? and(...tradeConds) : undefined) : []
    const paidInvoices = includePaidInvoices === '1' ? await db.select().from(businessInvoices).where(eq(businessInvoices.status, 'paid')) : []

    const totalIncome   = income.reduce((s, i) => s + i.amount, 0)
    const tradingPnl    = tradeRows.reduce((s, t) => s + (t.realizedPnl ?? 0), 0)
    const invoiceIncome = paidInvoices.reduce((s, i) => s + i.amount, 0)
    const grandIncome   = totalIncome + tradingPnl + invoiceIncome
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
    const latest = await db.select().from(financeNetWorthSnapshots).orderBy(financeNetWorthSnapshots.date)

    res.json({
      totalIncome: grandIncome,
      manualIncome: totalIncome,
      tradingPnl,
      invoiceIncome,
      totalExpenses,
      savingsRate: grandIncome > 0 ? (grandIncome - totalExpenses) / grandIncome : 0,
      netWorth: latest[latest.length - 1]?.netWorth ?? 0,
    })
  } catch (e) { next(e) }
})

export default router
