import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Preset } from '../../components/shared/DateFilter'
import { CalendarRange } from 'lucide-react'

/**
 * The trading page's controls, one family: a segmented switch with a
 * sliding highlight, a compact date range, quiet tool buttons, one primary
 * action, and a small popover for status menus.
 */

export function Segmented<T extends string>({ options, value, onChange, size = 'md', keep = false, fill = false }: {
  options: { value: T; label: React.ReactNode; title?: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  /** Keep the original look in every skin (the account switcher above the pulse). */
  keep?: boolean
  /** In a form: span the field and share the width evenly, at input height. */
  fill?: boolean
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>(`[data-v="${CSS.escape(value)}"]`)
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth })
    else setPill(null)
  }, [value, options.length])
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const el = wrap.current?.querySelector<HTMLElement>(`[data-v="${CSS.escape(value)}"]`)
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth })
    })
    if (wrap.current) ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [value])

  const pad = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-xs'
  if (!keep) {
    // New style: a quiet track, the chosen option on a faint fill. No glow, no gradient.
    return (
      <div className={`tr-seg ${size} ${fill ? 'fill' : ''}`}>
        {options.map(o => (
          <button key={o.value} type="button" title={o.title} onClick={() => onChange(o.value)} className={value === o.value ? 'on' : ''} aria-pressed={value === o.value}>
            {o.label}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div ref={wrap} className="relative inline-flex items-center p-1 rounded-xl"
      style={{ background: 'var(--c-bg-input)', boxShadow: 'inset 0 0 0 1px var(--c-border)' }}>
      {pill && (
        <span className="absolute top-1 bottom-1 rounded-lg transition-all duration-300 ease-out"
          style={{
            left: pill.left, width: pill.width,
            background: 'linear-gradient(180deg, var(--c-bg-elevated), var(--c-bg-card))',
            boxShadow: '0 1px 2px rgba(0,0,0,0.35), 0 0 0 1px var(--c-border-strong), 0 0 18px color-mix(in srgb, var(--c-accent) 18%, transparent)',
          }} />
      )}
      {options.map(o => (
        <button key={o.value} data-v={o.value} type="button" title={o.title} onClick={() => onChange(o.value)}
          className={`relative z-[1] flex items-center gap-1.5 rounded-lg font-semibold whitespace-nowrap transition-colors duration-200 ${pad}`}
          style={{ color: value === o.value ? 'var(--c-text-1)' : 'var(--c-text-3)' }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const RANGES: { value: Preset; label: string; title: string }[] = [
  { value: '1D', label: 'Today', title: 'Today (UTC)' },
  { value: '1W', label: '1W', title: 'Last 7 days' },
  { value: '1M', label: '1M', title: 'Last 30 days' },
  { value: '3M', label: '3M', title: 'Last 90 days' },
  { value: 'YTD', label: 'YTD', title: 'This year' },
  { value: 'All', label: 'All', title: 'Everything' },
]

/** The date range as one control; Custom opens two date fields beside it. */
export function RangePicker({ preset, onPreset, customFrom, customTo, onCustomFrom, onCustomTo }: {
  preset: Preset; onPreset: (p: Preset) => void
  customFrom: string; customTo: string; onCustomFrom: (v: string) => void; onCustomTo: (v: string) => void
}) {
  const known = RANGES.some(r => r.value === preset) || preset === 'Custom'
  const opts = [
    ...RANGES,
    ...(!known ? [{ value: preset, label: preset, title: preset }] : []),
    { value: 'Custom' as Preset, label: <CalendarRange size={13} />, title: 'Pick dates' },
  ]
  const date = 'px-2 py-1 rounded-lg text-xs num outline-none'
  const ds = { background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)', colorScheme: 'dark' as const }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented size="sm" options={opts} value={preset} onChange={onPreset} />
      {preset === 'Custom' && (
        <div className="flex items-center gap-1.5">
          <input type="date" value={customFrom} onChange={e => onCustomFrom(e.target.value)} className={date} style={ds} />
          <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>→</span>
          <input type="date" value={customTo} onChange={e => onCustomTo(e.target.value)} className={date} style={ds} />
        </div>
      )}
    </div>
  )
}

/** Quiet buttons that sit together in one tray. */
export function ToolTray({ children }: { children: React.ReactNode }) {
  return <div className="tr-tray">{children}</div>
}

export function ToolButton({ icon, label, onClick, title, kbd }: { icon: React.ReactNode; label?: string; onClick: () => void; title?: string; kbd?: string }) {
  return (
    <button type="button" onClick={onClick} title={title ? `${title}${kbd ? ` (${kbd})` : ''}` : undefined} aria-label={label ? undefined : title} className="tr-tool">
      {icon}{label && <span>{label}</span>}{kbd && <kbd>{kbd}</kbd>}
    </button>
  )
}

export function PrimaryButton({ children, onClick, kbd }: { children: React.ReactNode; onClick: () => void; kbd?: string }) {
  return <button type="button" onClick={onClick} className="nx-btn tr-primary">{children}{kbd && <kbd>{kbd}</kbd>}</button>
}

/** A small menu anchored under its trigger; closes on outside click or Escape. */
export function Popover({ trigger, children, align = 'right', width = 340 }: {
  trigger: (open: boolean, toggle: () => void) => React.ReactNode
  children: (close: () => void) => React.ReactNode
  align?: 'left' | 'right'
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  useLayoutEffect(() => {
    if (!open || !anchor.current) return
    const r = anchor.current.getBoundingClientRect()
    const left = align === 'right' ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8)
    setPos({ top: r.bottom + 8, left })
  }, [open, align, width])
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])
  return (
    <>
      <span ref={anchor} className="inline-flex">{trigger(open, () => setOpen(o => !o))}</span>
      {open && createPortal(
        <div ref={panel} className="fixed z-[60] rounded-2xl p-1.5 animate-[popIn_140ms_ease-out]"
          style={{ top: pos.top, left: pos.left, width, background: 'var(--c-bg-elevated)', border: '1px solid var(--c-border-mid)', boxShadow: 'var(--c-shadow-modal)' }}>
          {children(() => setOpen(false))}
        </div>, document.body)}
    </>
  )
}
