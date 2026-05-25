import { cn, formatPnl } from '../../lib/utils'

interface PnLBadgeProps {
  value: number | null | undefined
  className?: string
}

export function PnLBadge({ value, className }: PnLBadgeProps) {
  if (value == null) return <span className="text-text-muted text-sm num">--</span>
  return (
    <span className={cn('text-sm num font-semibold', value >= 0 ? 'text-pnl-profit' : 'text-pnl-loss', className)}>
      {formatPnl(value)}
    </span>
  )
}

export function RRBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-text-muted text-sm num">--</span>
  return (
    <span className={cn('text-sm num font-semibold', value >= 0 ? 'text-pnl-profit' : 'text-pnl-loss')}>
      {value >= 0 ? '+' : ''}{value.toFixed(2)}R
    </span>
  )
}

export function DeviationBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-text-muted text-sm num">--</span>
  const good = value === 0
  return (
    <span className={cn('text-sm num font-semibold', good ? 'text-pnl-profit' : 'text-pnl-loss')}>
      {value.toFixed(1)}%
    </span>
  )
}
