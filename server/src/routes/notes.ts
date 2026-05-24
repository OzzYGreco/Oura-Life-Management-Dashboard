import { Router } from 'express'
import { db } from '../db'
import { notes, noteCategories, noteImages } from '../db/schema'
import { eq, like, or } from 'drizzle-orm'
import { noteImageUpload } from '../middleware/upload'
import path from 'path'
import fs from 'fs'

const router = Router()

router.get('/', async (req, res, next) => {
  try {
    const { categoryId, q } = req.query
    let all = await db.select().from(notes)
    if (categoryId) all = all.filter(n => n.categoryId === parseInt(categoryId as string))
    if (q) {
      const query = (q as string).toLowerCase()
      all = all.filter(n => n.title.toLowerCase().includes(query) || (n.content || '').toLowerCase().includes(query))
    }
    const images = await db.select().from(noteImages)
    res.json(all.map(n => ({ ...n, images: images.filter(i => i.noteId === n.id) })))
  } catch (e) { next(e) }
})

router.post('/', async (req, res, next) => {
  try { res.status(201).json((await db.insert(notes).values(req.body).returning())[0]) } catch (e) { next(e) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const [note] = await db.select().from(notes).where(eq(notes.id, parseInt(req.params.id)))
    if (!note) return res.status(404).json({ error: 'Not found' })
    const images = await db.select().from(noteImages).where(eq(noteImages.noteId, note.id))
    res.json({ ...note, images })
  } catch (e) { next(e) }
})

router.put('/:id', async (req, res, next) => {
  try {
    const [row] = await db.update(notes).set({ ...req.body, updatedAt: new Date().toISOString() }).where(eq(notes.id, parseInt(req.params.id))).returning()
    res.json(row)
  } catch (e) { next(e) }
})

router.delete('/:id', async (req, res, next) => {
  try { await db.delete(notes).where(eq(notes.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

router.post('/:id/images', noteImageUpload.array('images', 20), async (req, res, next) => {
  try {
    const files = req.files as Express.Multer.File[]
    const inserted = await Promise.all(files.map(f =>
      db.insert(noteImages).values({
        noteId: parseInt(req.params.id),
        filePath: `/uploads/note-images/${f.filename}`,
        originalName: f.originalname,
      }).returning().then(r => r[0])
    ))
    res.status(201).json(inserted)
  } catch (e) { next(e) }
})

router.delete('/images/:imageId', async (req, res, next) => {
  try {
    const [img] = await db.select().from(noteImages).where(eq(noteImages.id, parseInt(req.params.imageId)))
    if (img) {
      const fp = path.join(__dirname, '../../uploads', img.filePath.replace('/uploads/', ''))
      if (fs.existsSync(fp)) fs.unlinkSync(fp)
      await db.delete(noteImages).where(eq(noteImages.id, img.id))
    }
    res.status(204).send()
  } catch (e) { next(e) }
})

// Categories
router.get('/categories/all', async (_req, res, next) => {
  try { res.json(await db.select().from(noteCategories)) } catch (e) { next(e) }
})
router.post('/categories', async (req, res, next) => {
  try { res.status(201).json((await db.insert(noteCategories).values(req.body).returning())[0]) } catch (e) { next(e) }
})
router.put('/categories/:id', async (req, res, next) => {
  try { res.json((await db.update(noteCategories).set(req.body).where(eq(noteCategories.id, parseInt(req.params.id))).returning())[0]) } catch (e) { next(e) }
})
router.delete('/categories/:id', async (req, res, next) => {
  try { await db.delete(noteCategories).where(eq(noteCategories.id, parseInt(req.params.id))); res.status(204).send() } catch (e) { next(e) }
})

export default router
