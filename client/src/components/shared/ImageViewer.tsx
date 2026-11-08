/**
 * A full-window image viewer for trade charts. It sits above everything
 * (portalled to <body>), so it never opens inside a dialog. It browses with
 * arrows, thumbnails or ← →, zooms to full size with a click or Z, and its
 * keys never reach the page or the dialog underneath: Esc closes only the viewer.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react'

export interface ViewerImage { id: number | string; filePath: string; note?: string | null }

export function ImageViewer({ images, start = 0, onClose, onChange }: {
  images: ViewerImage[]; start?: number; onClose: () => void
  /** Told which image is on show, so the page can follow along. */
  onChange?: (i: number) => void
}) {
  const total = images.length
  const [idx, setIdx] = useState(() => Math.min(Math.max(0, start), Math.max(0, total - 1)))
  const [zoom, setZoom] = useState(false)
  const strip = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)

  // The page hears about every move right away, even if the viewer closes in the same tick.
  const pick = useCallback((i: number) => { setZoom(false); setIdx(i); onChange?.(i) }, [onChange])
  const go = useCallback((d: number) => pick((idx + d + total) % total), [idx, total, pick])

  // Capture phase on window: runs before any page or dialog listener, then stops the event.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const k = e.key
      if (k === 'Escape') { if (zoom) setZoom(false); else onClose() }
      else if (k === 'ArrowLeft' && total > 1) go(-1)
      else if (k === 'ArrowRight' && total > 1) go(1)
      else if (k === 'z' || k === 'Z') setZoom(z => !z)
      else if (k === 'Home') pick(0)
      else if (k === 'End') pick(total - 1)
      else if (k !== 'Tab') return
      if (k !== 'Tab') { e.preventDefault() }
      e.stopPropagation()
    }
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  }, [go, pick, onClose, total, zoom])

  // Keep the page behind still, and give focus back when the viewer closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeBtn.current?.focus()
    return () => { document.body.style.overflow = overflow; before?.focus?.() }
  }, [])

  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [idx])

  if (!total) return null
  const cur = images[idx]

  return createPortal(
    <div className="img-viewer" role="dialog" aria-modal="true" aria-label={`Image ${idx + 1} of ${total}`}
      onClick={e => { e.stopPropagation(); onClose() }} onMouseDown={e => e.stopPropagation()}>
      <div className="iv-top" onClick={e => e.stopPropagation()}>
        <span className="iv-count num">{total > 1 ? `${idx + 1} of ${total}` : ''}</span>
        <div className="iv-tools">
          <button onClick={() => setZoom(z => !z)} aria-pressed={zoom} title={zoom ? 'Fit to window (Z)' : 'Full size (Z)'} aria-label={zoom ? 'Fit to window' : 'Show at full size'}>
            {zoom ? <ZoomOut size={17} /> : <ZoomIn size={17} />}
          </button>
          <button ref={closeBtn} onClick={onClose} title="Close (Esc)" aria-label="Close"><X size={18} /></button>
        </div>
      </div>

      <div className={`iv-stage ${zoom ? 'zoomed' : ''}`}>
        <img key={cur.id} src={cur.filePath} alt={cur.note ?? `Chart ${idx + 1}`} draggable={false}
          onClick={e => { e.stopPropagation(); setZoom(z => !z) }} />
      </div>

      {total > 1 && <>
        <button className="iv-nav prev" onClick={e => { e.stopPropagation(); go(-1) }} aria-label="Previous image" title="Previous (←)"><ChevronLeft size={24} /></button>
        <button className="iv-nav next" onClick={e => { e.stopPropagation(); go(1) }} aria-label="Next image" title="Next (→)"><ChevronRight size={24} /></button>
      </>}

      <div className="iv-foot" onClick={e => e.stopPropagation()}>
        {cur.note && <p className="iv-note">{cur.note}</p>}
        {total > 1 && (
          <div className="iv-strip" ref={strip} role="tablist" aria-label="Images">
            {images.map((s, i) => (
              <button key={s.id} data-i={i} role="tab" aria-selected={i === idx} aria-label={`Image ${i + 1}`} className={i === idx ? 'on' : ''} onClick={() => pick(i)}>
                <img src={s.filePath} alt="" draggable={false} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
