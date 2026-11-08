import { cn } from '../../lib/utils'
import { type InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>{label}</label>}
      <input
        ref={ref}
        className={cn('rounded-lg px-3 py-2 text-sm outline-none transition-all duration-150', className)}
        style={{
          background: 'var(--c-bg-input)',
          border: `1px solid ${error ? 'rgba(239,68,68,0.5)' : 'var(--c-border-mid)'}`,
          color: 'var(--c-text-1)',
        }}
        {...props}
      />
      {error && <span className="text-xs font-medium" style={{ color: 'var(--c-loss)' }}>{error}</span>}
    </div>
  )
)
Input.displayName = 'Input'
