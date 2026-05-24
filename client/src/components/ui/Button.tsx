import { cn } from '../../lib/utils'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

const baseStyles: Record<string, React.CSSProperties> = {
  primary:   { background: 'linear-gradient(135deg, #6366f1 0%, #a78bfa 100%)', color: '#fff', boxShadow: 'var(--c-shadow-btn)' },
  secondary: { background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' },
  ghost:     { background: 'transparent', color: 'var(--c-text-2)' },
  danger:    { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' },
}

const hoverStyles: Record<string, React.CSSProperties> = {
  primary:   { boxShadow: '0 6px 20px rgba(99,102,241,0.4), inset 0 1px 0 rgba(255,255,255,0.2)' },
  secondary: { background: 'var(--c-bg-hover)', borderColor: 'var(--c-border-strong)' },
  ghost:     { background: 'var(--c-bg-hover)', color: 'var(--c-text-1)' },
  danger:    { background: 'rgba(239,68,68,0.14)' },
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, children, style, onMouseEnter, onMouseLeave, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
          { 'px-2.5 py-1.5 text-xs': size === 'sm', 'px-4 py-2 text-sm': size === 'md', 'px-5 py-2.5 text-base': size === 'lg' },
          className
        )}
        style={{ ...baseStyles[variant], ...style }}
        onMouseEnter={e => {
          Object.assign((e.currentTarget as HTMLButtonElement).style, hoverStyles[variant])
          onMouseEnter?.(e)
        }}
        onMouseLeave={e => {
          Object.assign((e.currentTarget as HTMLButtonElement).style, baseStyles[variant])
          onMouseLeave?.(e)
        }}
        {...props}
      >
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
