import { cn } from '../../lib/utils'
import { type SelectHTMLAttributes, forwardRef } from 'react'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className, ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>{label}</label>}
      <select
        ref={ref}
        className={cn('rounded-lg px-3 py-2 text-sm outline-none transition-all duration-150 appearance-none cursor-pointer', className)}
        style={{
          background: 'var(--c-bg-input)',
          border: `1px solid ${error ? 'rgba(239,68,68,0.5)' : 'var(--c-border-mid)'}`,
          color: 'var(--c-text-1)',
          colorScheme: 'inherit',
        }}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <span className="text-xs font-medium" style={{ color: 'var(--c-loss)' }}>{error}</span>}
    </div>
  )
)
Select.displayName = 'Select'
