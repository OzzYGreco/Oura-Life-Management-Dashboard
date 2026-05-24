import { Router } from 'express'
import { db } from '../db'
import { checklistTemplates, checklistTemplateItems, checklistEntries, checklistEntryItems } from '../db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { localDateStr } from '../lib/date'

const router = Router()

// Templates
router.get('/templates', async (_req, res, next) => {
  try {
    const templates = await db.select().from(checklistTemplates)
    const items = await db.select().from(checklistTemplateItems)
    res.json(templates.map(t => ({ ...t, items: items.filter(i => i.templateId === t.id) })))
  } catch (e) { next(e) }
})

router.post('/templates', async (req, res, next) => {
  try {
    const [template] = await db.insert(checklistTemplates).values(req.body).returning()
    if (req.body.items?.length) {
      await db.insert(checklistTemplateItems).values(
        req.body.items.map((item: any, i: number) => ({ ...item, templateId: template.id, sortOrder: i }))
      )
    }
    res.status(201).json(template)
  } catch (e) { next(e) }
})

router.put('/templates/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id)
    const [template] = await db.update(checklistTemplates).set(req.body).where(eq(checklistTemplates.id, id)).returning()
    if (req.body.items !== undefined) {
      await db.delete(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, id))
      if (req.body.items.length) {
        await db.insert(checklistTemplateItems).values(
          req.body.items.map((item: any, i: number) => ({ ...item, templateId: id, sortOrder: i }))
        )
      }
    }
    res.json(template)
  } catch (e) { next(e) }
})

router.delete('/templates/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id)
    // Must delete child rows first — FK is ON DELETE NO ACTION
    // 1. entry items cascade-delete when their entry is deleted
    const entries = await db.select().from(checklistEntries).where(eq(checklistEntries.templateId, id))
    for (const e of entries) {
      await db.delete(checklistEntryItems).where(eq(checklistEntryItems.entryId, e.id))
    }
    await db.delete(checklistEntries).where(eq(checklistEntries.templateId, id))
    // 2. template items
    await db.delete(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, id))
    // 3. template itself
    await db.delete(checklistTemplates).where(eq(checklistTemplates.id, id))
    res.status(204).send()
  } catch (e) { next(e) }
})

// Entries (upsert by template+date)
router.get('/entries', async (req, res, next) => {
  try {
    const { date, templateId } = req.query
    if (!date) return res.status(400).json({ error: 'date required' })

    const templates = templateId
      ? await db.select().from(checklistTemplates).where(and(eq(checklistTemplates.id, parseInt(templateId as string)), eq(checklistTemplates.enabled, 1)))
      : await db.select().from(checklistTemplates).where(eq(checklistTemplates.enabled, 1))

    const result = []
    for (const template of templates) {
      let [entry] = await db.select().from(checklistEntries)
        .where(and(eq(checklistEntries.templateId, template.id), eq(checklistEntries.date, date as string)))

      if (!entry) {
        const [newEntry] = await db.insert(checklistEntries).values({ templateId: template.id, date: date as string }).returning()
        entry = newEntry
        const templateItems = await db.select().from(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, template.id))
        if (templateItems.length) {
          await db.insert(checklistEntryItems).values(templateItems.map(ti => ({ entryId: entry.id, templateItemId: ti.id })))
        }
      }

      const entryItems = await db.select().from(checklistEntryItems).where(eq(checklistEntryItems.entryId, entry.id))
      const templateItems = await db.select().from(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, template.id))
      result.push({
        ...entry,
        template,
        items: entryItems.map(ei => {
          const ti = ei.templateItemId ? templateItems.find(t => t.id === ei.templateItemId) : null
          return {
            ...ei,
            label:        ei.label ?? ti?.label ?? '',
            time:         ei.time ?? ti?.time ?? null,
            importance:   ei.importance ?? ti?.importance ?? null,
            repeatDaily:  ti?.repeatDaily ?? 1,
            sortOrder:    ti?.sortOrder ?? 0,
            parentItemId: ti?.parentItemId ?? null,
            archived:     ei.archived ?? 0,
            isAdhoc:      !ei.templateItemId,
          }
        }),
      })
    }

    // Ad-hoc entry for this date (no template)
    if (!templateId) {
      const [adhocEntry] = await db.select().from(checklistEntries)
        .where(and(isNull(checklistEntries.templateId), eq(checklistEntries.date, date as string)))
      if (adhocEntry) {
        const items = await db.select().from(checklistEntryItems).where(eq(checklistEntryItems.entryId, adhocEntry.id))
        result.push({
          ...adhocEntry,
          template: null,
          items: items.map(ei => ({
            ...ei,
            label:        ei.label ?? '',
            time:         ei.time ?? null,
            importance:   ei.importance ?? null,
            repeatDaily:  0,
            sortOrder:    ei.id,
            parentItemId: null,
            archived:     ei.archived ?? 0,
            isAdhoc:      true,
          })),
        })
      }
    }

    res.json(result)
  } catch (e) { next(e) }
})

// Ad-hoc entry — create or reuse the templateless entry for a date, batch-add items
router.post('/entries/adhoc', async (req, res, next) => {
  try {
    const { date, items } = req.body as { date: string; items: { label: string; time?: string; importance?: string }[] }
    if (!date || !items?.length) return res.status(400).json({ error: 'date and items required' })

    // Get or create the ad-hoc entry for this date
    let [entry] = await db.select().from(checklistEntries)
      .where(and(isNull(checklistEntries.templateId), eq(checklistEntries.date, date)))
    if (!entry) {
      const [newEntry] = await db.insert(checklistEntries).values({ templateId: null, date }).returning()
      entry = newEntry
    }

    // Insert each ad-hoc item (no templateItemId)
    const inserted = await db.insert(checklistEntryItems)
      .values(items.filter(i => i.label?.trim()).map(i => ({
        entryId:   entry.id,
        label:     i.label.trim(),
        time:      i.time || null,
        importance: i.importance || null,
      })))
      .returning()

    res.status(201).json({ entry, items: inserted })
  } catch (e) { next(e) }
})

// Delete a single entry item (for ad-hoc items)
router.delete('/entries/:entryId/items/:itemId', async (req, res, next) => {
  try {
    await db.delete(checklistEntryItems).where(
      and(
        eq(checklistEntryItems.id, parseInt(req.params.itemId)),
        eq(checklistEntryItems.entryId, parseInt(req.params.entryId)),
      )
    )
    res.status(204).send()
  } catch (e) { next(e) }
})

// Archive — move all currently-completed (non-archived) items to the archived section
router.delete('/entries/:entryId/completed', async (req, res, next) => {
  try {
    const entryId = parseInt(req.params.entryId)
    await db.update(checklistEntryItems)
      .set({ archived: 1 })
      .where(and(
        eq(checklistEntryItems.entryId, entryId),
        eq(checklistEntryItems.completed, 1),
        eq(checklistEntryItems.archived, 0),
      ))
    res.json({ ok: true })
  } catch (e) { next(e) }
})

router.put('/entries/:entryId/items/:itemId', async (req, res, next) => {
  try {
    const completed = req.body.completed ? 1 : 0
    const [row] = await db.update(checklistEntryItems)
      .set({ completed, completedAt: completed ? new Date().toISOString() : null })
      .where(eq(checklistEntryItems.id, parseInt(req.params.itemId)))
      .returning()
    res.json(row)
  } catch (e) { next(e) }
})

// Per-task streaks — consecutive days where each individual item was completed
router.get('/task-streaks', async (_req, res, next) => {
  try {
    const entries = await db.select().from(checklistEntries)
    const items   = await db.select().from(checklistEntryItems)

    // Build map: templateItemId → date → completed  (skip ad-hoc items with no templateItemId)
    const map: Record<number, Record<string, boolean>> = {}
    for (const entry of entries) {
      const entryItems = items.filter(i => i.entryId === entry.id)
      for (const item of entryItems) {
        if (item.templateItemId == null) continue
        if (!map[item.templateItemId]) map[item.templateItemId] = {}
        map[item.templateItemId][entry.date] = !!item.completed
      }
    }

    const result: { templateItemId: number; streak: number }[] = []

    for (const [tidStr, dateMap] of Object.entries(map)) {
      const templateItemId = parseInt(tidStr)
      let streak = 0
      const cursor = new Date()

      for (let i = 0; i < 730; i++) {
        const dateStr = localDateStr(cursor)
        const completed = dateMap[dateStr]

        if (completed === undefined) {
          // No entry for this day = paused, skip
        } else if (completed) {
          streak++
        } else {
          // Entry exists but not completed — break
          if (i === 0) streak = 0
          else break
        }
        cursor.setDate(cursor.getDate() - 1)
      }

      result.push({ templateItemId, streak })
    }

    res.json(result)
  } catch (e) { next(e) }
})

// Streaks — consecutive days where each template was 100% completed
// Days with no entry (template disabled/paused) are skipped, not counted against the streak
router.get('/streaks', async (_req, res, next) => {
  try {
    const entries  = await db.select().from(checklistEntries)
    const items    = await db.select().from(checklistEntryItems)

    // Build map: templateId → date → { total, done }  (skip ad-hoc entries with no templateId)
    const map: Record<number, Record<string, { total: number; done: number }>> = {}
    for (const entry of entries) {
      if (entry.templateId == null) continue
      if (!map[entry.templateId]) map[entry.templateId] = {}
      const entryItems = items.filter(i => i.entryId === entry.id)
      map[entry.templateId][entry.date] = {
        total: entryItems.length,
        done:  entryItems.filter(i => i.completed).length,
      }
    }

    const result: { templateId: number; streak: number; longestStreak: number }[] = []

    for (const [tidStr, dateMap] of Object.entries(map)) {
      const templateId = parseInt(tidStr)
      let streak = 0
      let longest = 0
      let current = 0

      // Walk backwards up to 730 days
      const cursor = new Date()
      for (let i = 0; i < 730; i++) {
        const dateStr = localDateStr(cursor)
        const day = dateMap[dateStr]

        if (!day) {
          // No entry = paused/disabled day, neutral — don't count, don't break
        } else if (day.total > 0 && day.done === day.total) {
          // Fully completed
          current++
          if (current > longest) longest = current
        } else {
          // Entry exists but not complete — break current run
          if (i === 0) { current = 0 } // today incomplete: streak = 0
          else break
        }

        cursor.setDate(cursor.getDate() - 1)
      }

      streak = current
      result.push({ templateId, streak, longestStreak: longest })
    }

    res.json(result)
  } catch (e) { next(e) }
})

export default router
