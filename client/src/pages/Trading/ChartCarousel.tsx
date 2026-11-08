/**
 * A trade's charts in the expanded row: one large chart that slides between
 * images (arrow buttons, a swipe or a trackpad flick), every chart as a
 * thumbnail below with the one on show outlined, and a click on the large
 * chart to open it full screen.
 */
import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react'
import { ImageViewer, type ViewerImage } from '../../components/shared/ImageViewer'

export function ChartCarousel({ shots }: { shots: ViewerImage[] }) {
  const [cur, setCur] = useState(0)
  const [view, setView] = useState<number | null>(null)
  const [drag, setDrag] = useState(0)
  const start = useRef<{ x: number; id: number } | null>(null)
  const moved = useRef(false)
  const wheelLock = useRef(0)
  const n = shots.length
  const many = n > 1
  const go = (i: number) => setCur(Math.max(0, Math.min(n - 1, i)))

  // Swipe with a finger or a mouse drag; a short tap still opens the chart.
  const onDown = (e: React.PointerEvent) => {
    if (!many || e.button !== 0) return
    start.current = { x: e.clientX, id: e.pointerId }; moved.current = false
  }
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return
    const dx = e.clientX - start.current.x
    if (Math.abs(dx) > 6 && !moved.current) { moved.current = true; (e.currentTarget as HTMLElement).setPointerCapture(start.current.id) }
    if (moved.current) setDrag(dx)
  }
  const onUp = (e: React.PointerEvent) => {
    if (!start.current) return
    const w = (e.currentTarget as HTMLElement).clientWidth
    if (moved.current && Math.abs(drag) > w * 0.18) go(cur + (drag < 0 ? 1 : -1))
    start.current = null; setDrag(0)
  }
  // A sideways trackpad flick moves one chart; vertical scrolling is left alone.
  const onWheel = (e: React.WheelEvent) => {
    if (!many || Math.abs(e.deltaX) < 24 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return
    const now = Date.now()
    if (now - wheelLock.current < 450) return
    wheelLock.current = now
    go(cur + (e.deltaX > 0 ? 1 : -1))
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' && cur > 0) { e.preventDefault(); e.stopPropagation(); go(cur - 1) }
    else if (e.key === 'ArrowRight' && cur < n - 1) { e.preventDefault(); e.stopPropagation(); go(cur + 1) }
  }

  const arrow = 'absolute top-1/2 -translate-y-1/2 w-9 h-9 rounded-full grid place-items-center transition-opacity disabled:opacity-0 disabled:pointer-events-none opacity-70 hover:opacity-100 focus-visible:opacity-100'

  return (
    <div className="space-y-2" onKeyDown={onKey}>
      <div className="relative rounded-xl overflow-hidden group select-none" style={{ border: '1px solid var(--c-border)', background: '#0b0b12', touchAction: 'pan-y' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
        role={many ? 'region' : undefined} aria-roledescription={many ? 'carousel' : undefined} aria-label={many ? 'Charts' : undefined}>
        <div className="flex" style={{
          transform: `translateX(calc(${-cur * 100}% + ${drag}px))`,
          transition: drag ? 'none' : 'transform 280ms cubic-bezier(.22,.8,.3,1)',
        }}>
          {shots.map((s, i) => (
            <button key={s.id} type="button" className="w-full shrink-0 block" tabIndex={i === cur ? 0 : -1} aria-hidden={i !== cur}
              onClick={() => { if (!moved.current) setView(i) }}
              aria-label={many ? `Open chart ${i + 1} of ${n} full screen` : 'Open chart full screen'}>
              <img src={s.filePath} alt="" draggable={false} className="w-full h-[340px] object-contain" />
            </button>
          ))}
        </div>
        {many && <>
          <button type="button" className={`${arrow} left-2`} style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
            disabled={cur === 0} onClick={() => go(cur - 1)} aria-label="Previous chart"><ChevronLeft size={18} /></button>
          <button type="button" className={`${arrow} right-2`} style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
            disabled={cur === n - 1} onClick={() => go(cur + 1)} aria-label="Next chart"><ChevronRight size={18} /></button>
          <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md text-[11px] num pointer-events-none" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }} aria-live="polite">
            {cur + 1} of {n}
          </span>
        </>}
        <span className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
          <Maximize2 size={13} />
        </span>
      </div>

      {many && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Choose a chart">
          {shots.map((s, i) => (
            <button key={s.id} type="button" role="tab" aria-selected={i === cur} aria-label={`Chart ${i + 1}`} onClick={() => go(i)}
              className={`rounded-lg overflow-hidden transition-[box-shadow,opacity] duration-150 ${i === cur ? 'opacity-100' : 'opacity-60 hover:opacity-100'}`}
              style={{ boxShadow: i === cur ? '0 0 0 2px var(--c-accent)' : '0 0 0 1px var(--c-border)' }}>
              <img src={s.filePath} alt="" draggable={false} className="h-12 w-20 object-cover block" />
            </button>
          ))}
        </div>
      )}

      {view !== null && <ImageViewer images={shots} start={view} onChange={setCur} onClose={() => setView(null)} />}
    </div>
  )
}
