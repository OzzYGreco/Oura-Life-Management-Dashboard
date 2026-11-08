import { cn } from '../../lib/utils'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'good' | 'warn'
  size?: 'sm' | 'md' | 'lg'
}

const baseStyles: Record<string, React.CSSProperties> = {
  primary:   { background: 'var(--c-accent)', color: 'var(--c-on-accent)', boxShadow: 'var(--c-shadow-btn)', filter: 'none' },
  secondary: { background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' },
  ghost:     { background: 'transparent', color: 'var(--c-text-2)' },
  danger:    { background: 'color-mix(in srgb, var(--c-loss) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--c-loss) 28%, transparent)', color: 'var(--c-loss)' },
  good:      { background: 'color-mix(in srgb, var(--c-profit) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--c-profit) 28%, transparent)', color: 'var(--c-profit)' },
  warn:      { background: 'color-mix(in srgb, var(--c-warn) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--c-warn) 30%, transparent)', color: 'var(--c-warn)' },
}

const hoverStyles: Record<string, React.CSSProperties> = {
  primary:   { filter: 'brightness(1.08)' },
  secondary: { background: 'var(--c-bg-hover)', borderColor: 'var(--c-border-strong)' },
  ghost:     { background: 'var(--c-bg-hover)', color: 'var(--c-text-1)' },
  danger:    { background: 'color-mix(in srgb, var(--c-loss) 15%, transparent)' },
  good:      { background: 'color-mix(in srgb, var(--c-profit) 15%, transparent)' },
  warn:      { background: 'color-mix(in srgb, var(--c-warn) 15%, transparent)' },
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
