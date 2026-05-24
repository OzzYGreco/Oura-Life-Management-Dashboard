import { forwardRef, useState, useEffect, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

interface PriceInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label?: string
  error?: string
  value?: string | number
  onChange?: (raw: string) => void
  prefix?: string
}

function formatWithCommas(raw: string): string {
  const clean = raw.replace(/[^0-9.]/g, '')
  const parts = clean.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.slice(0, 2).join(parts.length > 1 ? '.' : '')
}

export const PriceInput = forwardRef<HTMLInputElement, PriceInputProps>(
  ({ label, error, value, onChange, prefix = '$', className, onFocus, onBlur, placeholder, ...props }, ref) => {
    const [display, setDisplay] = useState(() => {
      const v = String(value ?? '')
      return v ? formatWithCommas(v) : ''
    })

    useEffect(() => {
      const v = String(value ?? '')
      const clean = v.replace(/[^0-9.]/g, '')
      if (clean !== display.replace(/[^0-9.]/g, '')) {
        setDisplay(v ? formatWithCommas(v) : '')
      }
    }, [value])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/[^0-9.]/g, '')
      setDisplay(formatWithCommas(raw))
      onChange?.(raw)
    }

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>
            {label}
          </label>
        )}
        <div className="relative">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold pointer-events-none num"
            style={{ color: 'var(--c-text-3)' }}
          >
            {prefix}
          </span>
          <input
            ref={ref}
            value={display}
            onChange={handleChange}
            placeholder={placeholder}
            inputMode="decimal"
            className={cn('w-full rounded-lg pl-7 pr-3 py-2 text-sm num outline-none transition-all duration-150', className)}
            style={{ background: 'var(--c-bg-input)', border: `1px solid ${error ? 'rgba(239,68,68,0.5)' : 'var(--c-border-mid)'}`, color: 'var(--c-text-1)' }}
            onFocus={e => {
              e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'
              e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)'
              onFocus?.(e)
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = error ? 'rgba(239,68,68,0.5)' : 'var(--c-border-mid)'
              e.currentTarget.style.boxShadow = 'none'
              onBlur?.(e)
            }}
            {...props}
          />
        </div>
        {error && <span className="text-xs font-medium" style={{ color: 'var(--c-loss)' }}>{error}</span>}
      </div>
    )
  }
)
PriceInput.displayName = 'PriceInput'
