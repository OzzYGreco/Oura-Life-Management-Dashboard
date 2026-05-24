import { cn } from '../../lib/utils'

interface Tab {
  id: string
  label: string
  icon?: React.ReactNode
}

interface TabsProps {
  tabs: Tab[]
  active: string
  onChange: (id: string) => void
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div
      className="flex gap-1 p-1 rounded-xl w-fit"
      style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}
    >
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150')}
          style={active === t.id ? {
            background: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(167,139,250,0.12) 100%)',
            border: '1px solid rgba(129,140,248,0.25)',
            boxShadow: '0 1px 4px rgba(99,102,241,0.15)',
            color: 'var(--c-text-1)',
          } : {
            color: 'var(--c-text-3)',
          }}
          onMouseEnter={e => { if (active !== t.id) (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-2)' }}
          onMouseLeave={e => { if (active !== t.id) (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)' }}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  )
}
