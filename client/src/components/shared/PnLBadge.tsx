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

/** How far a loss may run past the planned risk, as a share of the loss. */
export const MAX_DEVIATION_PCT = 10

export function DeviationBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-text-muted text-sm num">--</span>
  // The trader's rule: a loss may run at most 10% past the planned risk (fees included).
  const color = value === 0 ? undefined : value <= MAX_DEVIATION_PCT ? '#f59e0b' : undefined
  return (
    <span className={cn('text-sm num font-semibold', value === 0 ? 'text-pnl-profit' : value > MAX_DEVIATION_PCT ? 'text-pnl-loss' : '')}
      style={color ? { color } : undefined}
      title={value === 0 ? 'Within plan' : value <= MAX_DEVIATION_PCT ? 'Past plan, within your 10% rule' : 'Broke your 10% deviation rule'}>
      {value.toFixed(1)}%
    </span>
  )
}
