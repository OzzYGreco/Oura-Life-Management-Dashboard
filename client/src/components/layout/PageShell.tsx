import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftRight } from 'lucide-react'
import { CurrencyConverter } from '../ui/CurrencyConverter'

interface PageShellProps {
  title: string
  subtitle?: string
  action?: React.ReactNode      // trailing toolbar items
  leftAction?: React.ReactNode  // items placed after the title
  children: React.ReactNode
  noPad?: boolean               // full-bleed content (Notes)
}

/**
 * A unified macOS-style toolbar (title + controls in one bar) over the
 * page content. The currency converter lives here so it is on every page.
 */
export function PageShell({ title, subtitle, action, leftAction, children, noPad }: PageShellProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header
        className="flex items-center gap-4 h-[52px] px-6 shrink-0"
        style={{ borderBottom: '0.5px solid var(--c-border)' }}
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-[15px] font-semibold tracking-[-0.01em] truncate" style={{ color: 'var(--c-text-1)' }}>
            {title}
          </h1>
          {subtitle && (
            <span className="text-[12px] truncate" style={{ color: 'var(--c-text-2)' }}>{subtitle}</span>
          )}
        </div>
        {leftAction && <div className="flex items-center">{leftAction}</div>}
        <div className="flex-1" />
        {action && <div className="flex items-center gap-2">{action}</div>}
        <ConverterButton />
      </header>
      {noPad
        ? <div className="flex-1 overflow-hidden min-h-0">{children}</div>
        : <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">{children}</div>
      }
    </div>
  )
}

function ConverterButton() {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (btn.current?.contains(t) || pop.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const rect = btn.current?.getBoundingClientRect()

  return (
    <>
      <button
        ref={btn}
        onClick={() => setOpen(o => !o)}
        title="Currency converter"
        aria-label="Currency converter"
        aria-expanded={open}
        className="w-7 h-7 rounded-[6px] flex items-center justify-center transition-colors hover:bg-[var(--c-bg-hover)]"
        style={{ color: open ? 'var(--c-accent)' : 'var(--c-text-2)', background: open ? 'var(--c-bg-selected)' : undefined }}
      >
        <ArrowLeftRight size={15} strokeWidth={1.75} />
      </button>
      {open && rect && createPortal(
        <div
          ref={pop}
          className="fixed z-[99999] w-[320px] p-4 rounded-[12px]"
          style={{
            top: rect.bottom + 8,
            right: Math.max(12, window.innerWidth - rect.right),
            background: 'var(--c-bg-elevated)',
            boxShadow: 'var(--c-shadow-modal)',
            animation: 'popIn 0.14s ease-out',
          }}
        >
          <CurrencyConverter />
        </div>,
        document.body,
      )}
    </>
  )
}
