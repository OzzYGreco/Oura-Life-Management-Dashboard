import { cn } from '../../lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}

export function Card({ children, className, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn('rounded-xl transition-all duration-200', onClick && 'cursor-pointer', className)}
      style={{
        background: 'var(--c-bg-card)',
        border: '1px solid var(--c-border)',
        boxShadow: 'var(--c-shadow-card)',
      }}
      onMouseEnter={onClick ? e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.boxShadow = 'var(--c-shadow-hover)'
        el.style.borderColor = 'var(--c-border-strong)'
      } : undefined}
      onMouseLeave={onClick ? e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.boxShadow = 'var(--c-shadow-card)'
        el.style.borderColor = 'var(--c-border)'
      } : undefined}
    >
      {children}
    </div>
  )
}
