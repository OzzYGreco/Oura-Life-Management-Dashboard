import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, TrendingUp, CheckSquare, Target, DollarSign,
  Briefcase, Dumbbell, Calendar, FileText, ChevronLeft, ChevronRight,
  Zap
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useState, useEffect } from 'react'

const NAV = [
  { to: '/',          icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/trading',   icon: TrendingUp,      label: 'Trading' },
  { to: '/checklists',icon: CheckSquare,     label: 'Checklists' },
  { to: '/goals',     icon: Target,          label: 'Goals' },
  { to: '/finances',  icon: DollarSign,      label: 'Finances' },
  { to: '/business',  icon: Briefcase,       label: 'Business' },
  { to: '/training',  icon: Dumbbell,        label: 'Training' },
  { to: '/calendar',  icon: Calendar,        label: 'Calendar' },
  { to: '/notes',     icon: FileText,        label: 'Notes' },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('sidebar-collapsed') === 'true'
  })

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed))
  }, [collapsed])

  return (
    <aside
      className={cn(
        'flex flex-col h-full shrink-0 transition-all duration-300',
        collapsed ? 'w-[60px]' : 'w-[220px]'
      )}
      style={{ background: 'var(--c-sidebar-bg)', borderRight: '1px solid var(--c-sidebar-border)' }}
    >
      {/* Logo */}
      <div
        className={cn('flex items-center h-14 shrink-0 transition-all', collapsed ? 'justify-center px-0' : 'px-4 gap-2.5')}
        style={{ borderBottom: '1px solid var(--c-sidebar-border)' }}
      >
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, #6366f1 0%, #a78bfa 100%)', boxShadow: '0 0 16px rgba(99,102,241,0.35)' }}
        >
          <Zap size={14} className="text-white" />
        </div>
        {!collapsed && (
          <span className="font-bold text-sm tracking-tight gradient-text">ŌURA</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto space-y-0.5 px-2">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => cn(
              'flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 relative group',
              collapsed ? 'justify-center px-0' : 'px-3',
            )}
            title={collapsed ? label : undefined}
          >
            {({ isActive }) => (
              <>
                <div
                  className="absolute inset-0 rounded-lg transition-all duration-150"
                  style={isActive ? {
                    background: 'linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(167,139,250,0.08) 100%)',
                  } : {}}
                />
                {/* Left accent bar for active */}
                {isActive && (
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r"
                    style={{ background: 'linear-gradient(180deg, var(--c-accent), var(--c-accent-2))' }}
                  />
                )}
                <Icon
                  size={16}
                  className="shrink-0 relative z-10 transition-all"
                  style={{ color: isActive ? 'var(--c-accent)' : 'var(--c-text-3)' }}
                />
                {!collapsed && (
                  <span
                    className="truncate relative z-10"
                    style={{ color: isActive ? 'var(--c-text-1)' : 'var(--c-text-2)' }}
                  >
                    {label}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="p-2 shrink-0" style={{ borderTop: '1px solid var(--c-sidebar-border)' }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn('flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs font-medium transition-colors', collapsed && 'justify-center px-0')}
          style={{ color: 'var(--c-text-3)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-2)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-bg-hover)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)'; (e.currentTarget as HTMLButtonElement).style.background = '' }}
        >
          {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /><span>Collapse</span></>}
        </button>
      </div>
    </aside>
  )
}
