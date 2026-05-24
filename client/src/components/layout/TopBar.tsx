import { format } from 'date-fns'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { Sun, Moon, ArrowLeftRight } from 'lucide-react'
import { useThemeContext } from '../../lib/themeContext'
import { CurrencyConverter } from '../ui/CurrencyConverter'

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function TopBar() {
  const [now, setNow] = useState(new Date())
  const { theme, toggle } = useThemeContext()
  const [showConverter, setShowConverter] = useState(false)
  const buttonRef  = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const location   = useLocation()

  // Close on navigation
  useEffect(() => { setShowConverter(false) }, [location.pathname])

  // Clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Click-outside — check both the button and the portal popover
  useEffect(() => {
    if (!showConverter) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setShowConverter(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showConverter])

  const btnStyle = (active: boolean) => ({
    background: active ? 'rgba(129,140,248,0.15)' : 'var(--c-bg-input)',
    border: `1px solid ${active ? 'rgba(129,140,248,0.4)' : 'var(--c-border)'}`,
    color: active ? '#818cf8' : 'var(--c-text-2)',
  })

  return (
    <header
      className="h-14 flex items-center justify-between px-6 shrink-0 transition-colors duration-200"
      style={{
        background: 'var(--c-topbar-bg)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--c-topbar-border)',
      }}
    >
      <div className="flex items-center gap-3">
        <div>
          <span className="text-sm font-semibold" style={{ color: 'var(--c-text-2)' }}>{getGreeting()},</span>
          <span className="text-sm font-semibold gradient-text ml-1">OzzY</span>
        </div>
        <div className="w-px h-4" style={{ background: 'var(--c-border)' }} />
        <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>{format(now, 'EEEE, MMMM d')}</span>
      </div>

      <div className="flex items-center gap-2">
        <span
          className="text-xs num font-medium px-2 py-1 rounded-md"
          style={{ background: 'var(--c-bg-input)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}
        >
          {format(now, 'HH:mm:ss')}
        </span>

        {/* Currency converter button */}
        <button
          ref={buttonRef}
          onClick={() => setShowConverter(s => !s)}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200"
          style={btnStyle(showConverter)}
          title="Currency converter"
        >
          <ArrowLeftRight size={14} />
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggle}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200"
          style={btnStyle(false)}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-accent)'
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--c-accent)'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border)'
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-2)'
          }}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>

      {/* Portal — renders directly on document.body, outside all stacking contexts */}
      {showConverter && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            top: '64px',
            right: '16px',
            width: '320px',
            zIndex: 99999,
            background: 'var(--c-bg-card)',
            border: '1px solid var(--c-border)',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 24px 48px rgba(0,0,0,0.7)',
          }}
        >
          <CurrencyConverter />
        </div>,
        document.body
      )}
    </header>
  )
}
