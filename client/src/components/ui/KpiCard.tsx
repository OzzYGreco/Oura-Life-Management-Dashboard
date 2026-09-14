import type { ReactNode } from 'react'

/**
 * The dense stat tile from Trading Analytics. Tighter than `StatCard`: no icon,
 * no accent line, and it takes a raw CSS colour rather than a Tailwind class,
 * so a row of eight of them reads as one object rather than eight cards.
 *
 * `hero` is for the handful of figures a page exists to show.
 */
export function KpiCard({
  label, value, sub, color = 'var(--c-text-1)', hero = false, onClick,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  color?: string
  hero?: boolean
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`rounded-xl p-3.5 min-w-0 text-left w-full ${onClick ? 'transition-colors' : ''}`}
      style={{
        background: hero
          ? 'linear-gradient(160deg, rgba(99,102,241,0.09), var(--c-bg-card) 62%)'
          : 'var(--c-bg-card)',
        border: `1px solid ${hero ? 'rgba(129,140,248,0.3)' : 'var(--c-border)'}`,
      }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--c-text-3)' }}>
        {label}
      </div>
      <div className="text-xl font-bold num leading-none tracking-tight break-words" style={{ color }}>
        {value}
      </div>
      {sub != null && (
        <div className="text-[10px] mt-1.5" style={{ color: 'var(--c-text-3)' }}>{sub}</div>
      )}
    </Tag>
  )
}
