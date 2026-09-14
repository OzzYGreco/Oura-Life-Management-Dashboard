/**
 * One chart language for the whole app.
 *
 * Two conventions had grown up side by side: Trading Analytics used a local
 * `ttStyle` object, while Finances, Business and Training each inlined their own
 * `contentStyle`. Business also hardcoded `#8b8baa` axis ticks and a literal
 * pound sign, so its one chart ignored both the theme and the currency selector.
 */
export const C = {
  profit: 'var(--c-profit)',
  loss:   'var(--c-loss)',
  accent: 'var(--c-accent)',
  accent2: 'var(--c-accent-2)',
  amber:  '#f59e0b',
  cyan:   '#22d3ee',
  muted:  'var(--c-text-3)',
} as const

/** Raw hex twins, for SVG attributes that cannot take a CSS variable. */
export const HEX = {
  profit: '#34d399',
  loss:   '#f87171',
  accent: '#818cf8',
  accent2: '#a78bfa',
  amber:  '#f59e0b',
  cyan:   '#22d3ee',
} as const

export const tooltipStyle = {
  background: 'var(--c-bg-card)',
  border: '1px solid var(--c-border)',
  borderRadius: 8,
  fontSize: 12,
} as const

export const tooltipLabelStyle = { color: 'var(--c-text-1)' } as const
export const barCursor = { fill: 'rgba(255,255,255,0.04)' } as const

export const axisTick = { fontSize: 10, fill: 'var(--c-text-3)' } as const
export const axisProps = { tickLine: false, axisLine: false, tick: axisTick } as const
export const gridProps = { strokeDasharray: '3 3', stroke: 'var(--c-border)', vertical: false } as const

/** Compact axis labels: 1.2k rather than 1200. */
export const compact = (v: number): string =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))

/** Green / red cell tint for money in a table, as an inline-block pill. */
export function moneyCell(v: number): React.CSSProperties {
  if (v > 0) return { background: 'rgba(52,211,153,0.15)', color: 'var(--c-profit)' }
  if (v < 0) return { background: 'rgba(248,113,113,0.15)', color: 'var(--c-loss)' }
  return { color: 'var(--c-text-3)' }
}

export const pillCell: React.CSSProperties = {
  padding: '2px 8px', borderRadius: 6, display: 'inline-block',
}
