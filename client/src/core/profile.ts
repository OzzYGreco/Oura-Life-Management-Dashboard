/**
 * The owner's picture: shown on the avatar in the app frame and beside the
 * signature on shared scorecards. Cropped to a centred square in the browser
 * before upload, so any photo works. Server: /api/today/avatar.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

const KEY = ['app-settings']
type Settings = { avatar?: string }
const fetchSettings = () => api.get<Settings>('/api/today/settings').then(r => r.data)

export function useAvatar(): string | null {
  const q = useQuery({ queryKey: KEY, queryFn: fetchSettings, staleTime: 60_000 })
  return q.data?.avatar || null
}

/** A centred square, 512px, as JPEG: small, sharp at every size the app draws it. */
async function squareCrop(file: File, size = 512): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const side = Math.min(bmp.width, bmp.height)
  const c = document.createElement('canvas')
  c.width = c.height = Math.min(size, side)
  c.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, c.width, c.height)
  bmp.close()
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not read that image.'))), 'image/jpeg', 0.9))
}

export function useAvatarActions() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: KEY })
  return {
    set: useMutation({
      mutationFn: async (file: File) => {
        const fd = new FormData()
        fd.append('image', await squareCrop(file), 'avatar.jpg')
        return api.post<{ avatar: string }>('/api/today/avatar', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
      },
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: () => api.delete('/api/today/avatar'), onSuccess: done }),
  }
}

/** The picture, loaded and ready to draw on a canvas, or null when there is none. */
export async function loadAvatarImage(): Promise<HTMLImageElement | null> {
  try {
    const url = (await fetchSettings()).avatar
    if (!url) return null
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } catch { return null }
}
