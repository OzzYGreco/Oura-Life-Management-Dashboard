import { cn } from '../../lib/utils'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'green' | 'red' | 'yellow' | 'blue' | 'purple' | 'gray'
  className?: string
}

const styles: Record<string, React.CSSProperties> = {
  green:  { background: 'rgba(52,211,153,0.1)',  color: '#34d399', border: '1px solid rgba(52,211,153,0.2)',  boxShadow: 'inset 0 0 0 1px rgba(52,211,153,0.12)'  },
  red:    { background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)', boxShadow: 'inset 0 0 0 1px rgba(248,113,113,0.12)' },
  yellow: { background: 'rgba(251,191,36,0.1)',  color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)',  boxShadow: 'inset 0 0 0 1px rgba(251,191,36,0.12)'  },
  // blue and purple were the old theme's accent; both are neutral chips now.
  blue:   { background: 'var(--c-bg-hover)', color: 'var(--c-text-1)', border: '1px solid var(--c-border)' },
  purple: { background: 'var(--c-bg-hover)', color: 'var(--c-text-1)', border: '1px solid var(--c-border)' },
  gray:   { background: 'var(--c-bg-input)', color: 'var(--c-text-2)', border: '1px solid var(--c-border-mid)', boxShadow: 'inset 0 0 0 1px var(--c-border-subtle)' },
}

export function Badge({ children, variant = 'gray', className }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-wide', className)}
      style={styles[variant]}
    >
      {children}
    </span>
  )
}
