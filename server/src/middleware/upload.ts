import multer from 'multer'
import path from 'path'
import { v4 as uuid } from 'uuid'

function makeStorage(folder: string) {
  return multer.diskStorage({
    destination: path.join(__dirname, '../../uploads', folder),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname)
      cb(null, `${uuid()}${ext}`)
    },
  })
}

function imageFilter(_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (file.mimetype.startsWith('image/')) cb(null, true)
  else cb(new Error('Only image files are allowed'))
}

export const screenshotUpload = multer({
  storage: makeStorage('screenshots'),
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
})

export const noteImageUpload = multer({
  storage: makeStorage('note-images'),
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
})
