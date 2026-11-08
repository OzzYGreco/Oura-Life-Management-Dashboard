import type { ReactNode } from 'react'
import { Sparkline } from './Sparkline'

/**
 * The dense stat tile from Trading Analytics. Tighter than `StatCard`: no icon,
 * no accent line, and it takes a raw CSS colour rather than a Tailwind class,
 * so a row of eight of them reads as one object rather than eight cards.
 *
 * `hero` is for the handful of figures a page exists to show.
 */
export function KpiCard({
  label, value, sub, color = 'var(--c-text-1)', hero = false, onClick, spark, sparkColor,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  color?: string
  hero?: boolean
  onClick?: () => void
  /** A small trend under the figure, oldest point first. */
  spark?: number[]
  sparkColor?: string
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      // flex-col + start: a button centres its content by default, which left
      // cards without a trend line sitting lower than their neighbours.
      className={`rounded-xl p-3.5 min-w-0 text-left w-full flex flex-col justify-start ${onClick ? 'transition-all duration-150 hover:-translate-y-px hover:shadow-[0_8px_28px_rgba(0,0,0,0.28)]' : ''}`}
      style={{
        background: 'var(--c-bg-card)',
        border: `1px solid ${hero ? 'var(--c-border-strong)' : 'var(--c-border)'}`,
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
      {spark && spark.some(v => v !== 0) && (
        <div className="mt-2"><Sparkline points={spark} color={sparkColor ?? 'var(--c-text-2)'} height={22} /></div>
      )}
    </Tag>
  )
}
