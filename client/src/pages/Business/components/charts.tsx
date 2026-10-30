import { useState, type ReactNode } from 'react'
import { tooltipStyle } from '../../../lib/chartTheme'
import type { FmtView } from '../../../hooks/useFmtView'

/**
 * The one tooltip every Business chart uses.
 *
 * Recharts' default prints each line in its series colour, and falls back to
 * black where a bar is coloured per cell, which is unreadable on the dark card.
 * Here the text is always the theme's ink and the colour rides on a dot.
 */
export function ChartTooltip({
  active, payload, label, fmtView, total,
}: {
  active?: boolean; payload?: any[]; label?: string; fmtView: FmtView
  /** Adds a total line under the series, e.g. for stacked bars. */
  total?: boolean
}) {
  if (!active || !payload?.length) return null
  const sum = payload.reduce((s, p) => s + Number(p.value || 0), 0)
  return (
    <div style={{ ...tooltipStyle, padding: '8px 10px', minWidth: 150, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
      <p style={{ color: 'var(--c-text-1)', fontWeight: 600, marginBottom: 4 }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="flex items-center gap-2" style={{ lineHeight: 1.8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: p.color ?? p.fill ?? p.payload?.fill, flexShrink: 0 }} />
          <span style={{ color: 'var(--c-text-2)', flex: 1 }}>{p.name}</span>
          <span className="num" style={{ color: 'var(--c-text-1)' }}>{fmtView(Number(p.value))}</span>
        </p>
      ))}
      {total && payload.length > 1 && (
        <p className="flex justify-between num" style={{
          color: 'var(--c-text-1)', fontWeight: 600, borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 4,
        }}>
          <span>Total</span><span>{fmtView(sum)}</span>
        </p>
      )}
    </div>
  )
}

export interface Part { key: string; value: number; color: string; note?: ReactNode }

/**
 * A part-to-whole bar with its legend, linked both ways: point at a segment or
 * at its legend row and that part lights up while the rest step back, with its
 * share and amount. "Which pound went where" is answered by pointing, not by
 * matching colours by eye.
 */
export function SplitBar({
  parts, fmtView, height = 16, legend = true,
}: { parts: Part[]; fmtView: FmtView; height?: number; legend?: boolean }) {
  const [hover, setHover] = useState<string | null>(null)
  const shown = parts.filter(p => p.value > 0.005)
  const total = shown.reduce((s, p) => s + p.value, 0)
  if (total <= 0) return null
  const dim = (k: string) => hover != null && hover !== k

  return (
    <div onMouseLeave={() => setHover(null)}>
      <div className="flex rounded-md overflow-hidden gap-[2px]" style={{ height }}>
        {shown.map(p => (
          <div key={p.key}
            onMouseEnter={() => setHover(p.key)}
            title={`${p.key}: ${fmtView(p.value)} (${Math.round((p.value / total) * 100)}%)`}
            className="transition-all duration-150 cursor-default"
            style={{
              width: `${(p.value / total) * 100}%`, minWidth: 4, background: p.color,
              opacity: dim(p.key) ? 0.25 : 1,
              boxShadow: hover === p.key ? `0 0 0 2px var(--c-bg-card), 0 0 14px ${p.color}` : 'none',
            }} />
        ))}
      </div>
      {legend && (
        <div className="mt-3 space-y-0.5">
          {shown.map(p => (
            <div key={p.key} onMouseEnter={() => setHover(p.key)}
              className="flex items-center gap-2 text-[12px] rounded-md px-2 py-1 -mx-2 transition-colors duration-150 cursor-default"
              style={{ background: hover === p.key ? 'rgba(255,255,255,0.05)' : 'transparent', opacity: dim(p.key) ? 0.5 : 1 }}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />
              <span className="flex-1" style={{ color: 'var(--c-text-2)' }}>{p.key}{p.note ? <span style={{ color: 'var(--c-text-3)' }}> · {p.note}</span> : null}</span>
              <span className="num" style={{ color: 'var(--c-text-1)' }}>{fmtView(p.value)}</span>
              <span className="num w-10 text-right" style={{ color: 'var(--c-text-3)' }}>{Math.round((p.value / total) * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** A card that lifts a little under the pointer: the "you can look here" cue. */
export const hoverCard = 'transition-all duration-150 hover:-translate-y-px hover:shadow-[0_8px_28px_rgba(0,0,0,0.28)] hover:border-[rgba(129,140,248,0.35)]'
