import { Router } from 'express'
import { db } from '../db'
import { trades, tradingSetups } from '../db/schema'
import { eq, sql } from 'drizzle-orm'

/**
 * Setups (systems). Trades point at a setup by name, so a rename or a merge
 * rewrites trades.setup_label; archiving only takes it out of the picker.
 */
const router = Router()

/** A result inside ±0.1R counts as breakeven, not a win or a loss. */
const BE_R = 0.1

/** Lowercase, letters and digits only, with common typos folded. */
const norm = (s: string) => s.toLowerCase().replace(/consoliation/g, 'consolidation').replace(/[^a-z0-9]+/g, '')

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/** Adds a setup the first time a trade uses its name (and un-archives it). */
export function ensureSetup(name: string | null | undefined) {
  const n = name?.trim()
  if (!n) return
  db.insert(tradingSetups).values({ name: n }).onConflictDoUpdate({ target: tradingSetups.name, set: { archived: 0 } }).run()
}

router.get('/', (_req, res, next) => {
  try {
    const setups = db.select().from(tradingSetups).all()
    const stats = db.select({
      name: trades.setupLabel,
      n: sql<number>`count(*)`,
      closed: sql<number>`sum(${trades.rrRatio} is not null)`,
      wins: sql<number>`sum(${trades.rrRatio} >= ${BE_R})`,
      losses: sql<number>`sum(${trades.rrRatio} <= ${-BE_R})`,
      netR: sql<number | null>`sum(${trades.rrRatio})`,
      firstUsed: sql<string>`min(${trades.date})`,
      lastUsed: sql<string>`max(${trades.date})`,
    }).from(trades).where(sql`${trades.setupLabel} is not null and trim(${trades.setupLabel}) != ''`)
      .groupBy(trades.setupLabel).all()
    const byName = new Map(stats.map(s => [s.name!, s]))

    const rows = setups.map(s => {
      const st = byName.get(s.name)
      return {
        id: s.id, name: s.name, description: s.description, archived: !!s.archived,
        trades: st?.n ?? 0, wins: st?.wins ?? 0, losses: st?.losses ?? 0,
        netR: st?.netR ?? null, avgR: st?.closed ? (st.netR ?? 0) / st.closed : null,
        firstUsed: st?.firstUsed ?? null, lastUsed: st?.lastUsed ?? null,
        sameAs: [] as number[],
      }
    })
    // Names that look like the same setup: same letters, or a letter or two apart.
    for (const a of rows) for (const b of rows) {
      if (a.id === b.id) continue
      const na = norm(a.name), nb = norm(b.name)
      if (na === nb || (Math.min(na.length, nb.length) >= 8 && editDistance(na, nb) <= 2)) a.sameAs.push(b.id)
    }
    rows.sort((a, b) => Number(a.archived) - Number(b.archived) || (b.lastUsed ?? '').localeCompare(a.lastUsed ?? '') || a.name.localeCompare(b.name))
    res.json(rows)
  } catch (e) { next(e) }
})

router.post('/', (req, res, next) => {
  try {
    const name = String(req.body.name ?? '').trim()
    if (!name) return res.status(400).json({ error: 'A setup needs a name' })
    ensureSetup(name)
    if (req.body.description != null) db.update(tradingSetups).set({ description: req.body.description || null }).where(eq(tradingSetups.name, name)).run()
    res.status(201).json(db.select().from(tradingSetups).where(eq(tradingSetups.name, name)).get())
  } catch (e) { next(e) }
})

router.put('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const cur = db.select().from(tradingSetups).where(eq(tradingSetups.id, id)).get()
    if (!cur) return res.status(404).json({ error: 'Not found' })
    const set: Partial<typeof tradingSetups.$inferInsert> = {}
    if ('archived' in req.body) set.archived = req.body.archived ? 1 : 0
    if ('description' in req.body) set.description = req.body.description?.trim() || null
    const name = req.body.name != null ? String(req.body.name).trim() : null
    if (name && name !== cur.name) {
      const clash = db.select().from(tradingSetups).where(eq(tradingSetups.name, name)).get()
      if (clash) return res.status(409).json({ error: `"${name}" already exists. Merge into it instead.`, intoId: clash.id })
      set.name = name
    }
    db.transaction(tx => {
      if (set.name) tx.update(trades).set({ setupLabel: set.name }).where(eq(trades.setupLabel, cur.name)).run()
      if (Object.keys(set).length) tx.update(tradingSetups).set(set).where(eq(tradingSetups.id, id)).run()
    })
    res.json(db.select().from(tradingSetups).where(eq(tradingSetups.id, id)).get())
  } catch (e) { next(e) }
})

/** Moves every trade of this setup onto another one, then removes this one. */
router.post('/:id/merge', (req, res, next) => {
  try {
    const from = db.select().from(tradingSetups).where(eq(tradingSetups.id, Number(req.params.id))).get()
    const into = db.select().from(tradingSetups).where(eq(tradingSetups.id, Number(req.body.intoId))).get()
    if (!from || !into || from.id === into.id) return res.status(400).json({ error: 'Pick a different setup to merge into' })
    let moved = 0
    db.transaction(tx => {
      moved = tx.update(trades).set({ setupLabel: into.name }).where(eq(trades.setupLabel, from.name)).run().changes
      tx.update(tradingSetups).set({ archived: 0, description: into.description ?? from.description }).where(eq(tradingSetups.id, into.id)).run()
      tx.delete(tradingSetups).where(eq(tradingSetups.id, from.id)).run()
    })
    res.json({ moved, into: into.name })
  } catch (e) { next(e) }
})

/** Removes a setup no trade uses; one with history is archived instead. */
router.delete('/:id', (req, res, next) => {
  try {
    const s = db.select().from(tradingSetups).where(eq(tradingSetups.id, Number(req.params.id))).get()
    if (!s) return res.status(204).send()
    const [{ n }] = db.select({ n: sql<number>`count(*)` }).from(trades).where(eq(trades.setupLabel, s.name)).all()
    if (n > 0) db.update(tradingSetups).set({ archived: 1 }).where(eq(tradingSetups.id, s.id)).run()
    else db.delete(tradingSetups).where(eq(tradingSetups.id, s.id)).run()
    res.json({ archived: n > 0 })
  } catch (e) { next(e) }
})

export default router
