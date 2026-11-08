import { NavLink } from 'react-router-dom'
import {
  LayoutGrid, CandlestickChart, Briefcase, Wallet,
  ListChecks, Target, Dumbbell, CalendarDays, NotebookPen, PanelLeft,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/utils'
import { AreteBrand } from '../../brand/AreteMark'

type Item = { to: string; icon: LucideIcon; label: string }

/** Two short groups, as a macOS source list: what you do, and the money. */
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Day',
    items: [
      { to: '/',           icon: LayoutGrid,   label: 'Summary' },
      { to: '/checklists', icon: ListChecks,   label: 'Checklists' },
      { to: '/goals',      icon: Target,       label: 'Goals' },
      { to: '/training',   icon: Dumbbell,     label: 'Training' },
      { to: '/calendar',   icon: CalendarDays, label: 'Calendar' },
      { to: '/notes',      icon: NotebookPen,  label: 'Notes' },
    ],
  },
  {
    title: 'Money',
    items: [
      { to: '/trading',  icon: CandlestickChart, label: 'Trading' },
      { to: '/business', icon: Briefcase,        label: 'Business' },
      { to: '/finances', icon: Wallet,           label: 'Finances' },
    ],
  },
]

export function Sidebar() {
  const [hidden, setHidden] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')

  useEffect(() => { localStorage.setItem('sidebar-collapsed', String(hidden)) }, [hidden])

  // ⌃⌘S toggles the sidebar, the macOS shortcut for Show/Hide Sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.metaKey && e.key.toLowerCase() === 's') { e.preventDefault(); setHidden(h => !h) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (hidden) {
    return (
      <div className="shrink-0 pt-3 pl-3">
        <ToggleButton onClick={() => setHidden(false)} label="Show sidebar" />
      </div>
    )
  }

  return (
    <aside className="shrink-0 p-2 pr-0 h-full">
      <div
        className="material flex flex-col h-full w-[220px] rounded-[12px] overflow-hidden"
        style={{ boxShadow: 'var(--c-shadow-sidebar)' }}
      >
        <div className="flex items-center justify-between h-[44px] pl-4 pr-2 shrink-0">
          <AreteBrand size={20} />
          <ToggleButton onClick={() => setHidden(true)} label="Hide sidebar" />
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 pb-3" aria-label="Sections">
          {GROUPS.map(group => (
            <div key={group.title} className="mt-3 first:mt-1">
              <p className="px-2 pb-1 text-[11px] font-semibold" style={{ color: 'var(--c-text-3)' }}>
                {group.title}
              </p>
              <ul className="space-y-px">
                {group.items.map(({ to, icon: Icon, label }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={to === '/'}
                      className={({ isActive }) => cn(
                        'flex items-center gap-2 h-[28px] px-2 rounded-[6px] text-[13px] transition-colors duration-100',
                        isActive ? 'font-medium' : 'hover:bg-[var(--c-bg-hover)]',
                      )}
                      style={({ isActive }) => ({
                        background: isActive ? 'var(--c-bg-selected)' : undefined,
                        color: 'var(--c-text-1)',
                      })}
                    >
                      <Icon size={16} strokeWidth={1.75} style={{ color: 'var(--c-accent)' }} aria-hidden />
                      <span className="truncate">{label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </aside>
  )
}

function ToggleButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      title={`${label} (⌃⌘S)`}
      aria-label={label}
      className="w-7 h-7 rounded-[6px] flex items-center justify-center transition-colors hover:bg-[var(--c-bg-hover)]"
      style={{ color: 'var(--c-text-2)' }}
    >
      <PanelLeft size={16} strokeWidth={1.75} />
    </button>
  )
}
