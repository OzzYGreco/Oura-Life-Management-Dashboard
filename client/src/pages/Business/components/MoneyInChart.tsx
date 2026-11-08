import { useMemo } from 'react'
import { useIsNext } from '../../../skins/isNext'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { axisProps, gridProps, tooltipStyle, barCursor, compact, HEX } from '../../../lib/chartTheme'
import { fmtMonth } from './primitives'
import type { BusinessMetrics } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

/**
 * The one chart that answers the only question that matters about growth: is it
 * going up, and how much of it recurs?
 *
 * Stacked bars split collected revenue into retainer and one-off work; the line
 * is MRR at each month end. Seeing them together is what makes the shift from
 * project work to recurring income legible.
 */
export function MoneyInChart({
  metrics, fmtView, months = 12,
}: { metrics: BusinessMetrics; fmtView: FmtView; months?: number }) {
  const data = useMemo(() => {
    const movement = new Map(metrics.mrr.movement.map(m => [m.month, m.endingMrr]))
    const rows = metrics.volume.byMonth.slice(-months).map(v => ({
      month: v.month,
      label: fmtMonth(v.month),
      retainer: v.retainer,
      oneOff: v.oneOff,
      mrr: movement.get(v.month) ?? 0,
    }))
    // Start at the first month anything happened, not a row of empty months.
    const first = rows.findIndex(d => d.retainer || d.oneOff || d.mrr)
    return first <= 0 ? rows : rows.slice(first)
  }, [metrics, months])

  const hasAny = data.some(d => d.retainer || d.oneOff || d.mrr)
  const nx = useIsNext()
  const col = nx ? { retainer: 'var(--k-ink2)', oneOff: 'var(--k-faint)', mrr: 'var(--k-good)' } : { retainer: HEX.accent, oneOff: HEX.accent2, mrr: HEX.profit }

  return (
    <div className={nx ? 'bz-chart' : 'rounded-xl p-4'} style={nx ? undefined : { background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
      {hasAny ? (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={v => compact(v)} width={46} />
              <Tooltip cursor={barCursor} content={<MonthTooltip fmtView={fmtView} />} />
              <Legend
                verticalAlign="top" align="left" height={28} iconType="circle" iconSize={7}
                wrapperStyle={{ fontSize: 11, color: 'var(--c-text-3)', paddingBottom: 6 }}
              />
              <Bar dataKey="retainer" name="Retainer income" stackId="in" fill={col.retainer} radius={[0, 0, 0, 0]} maxBarSize={44} />
              <Bar dataKey="oneOff" name="Website and one-off" stackId="in" fill={col.oneOff} fillOpacity={nx ? 1 : 0.55} radius={[3, 3, 0, 0]} maxBarSize={44} />
              <Line dataKey="mrr" name="MRR at month end" type="monotone" stroke={col.mrr} strokeWidth={2} dot={false}
                activeDot={{ r: 4, fill: col.mrr, stroke: 'var(--c-bg-card)', strokeWidth: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-16 text-center text-xs" style={{ color: 'var(--c-text-3)' }}>
          Nothing collected in this window yet.
        </p>
      )}
    </div>
  )
}

/**
 * The default tooltip, plus the month's total. Retainer and one-off are the two
 * halves of one bar, and the figure wanted from it is the whole: without this
 * line it had to be added up by hand.
 */
function MonthTooltip({ active, payload, label, fmtView }: {
  active?: boolean; payload?: any[]; label?: string; fmtView: FmtView
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload as { retainer: number; oneOff: number }
  // MRR first, so the two lines the total adds up sit directly above it.
  const lines = [...payload].sort((a, b) => Number(b.dataKey === 'mrr') - Number(a.dataKey === 'mrr'))
  return (
    <div style={{ ...tooltipStyle, padding: '8px 10px' }}>
      <p style={{ color: 'var(--c-text-1)', fontWeight: 600, marginBottom: 4 }}>{label}</p>
      {lines.map(p => (
        <p key={p.dataKey} style={{ color: p.color, lineHeight: 1.7 }}>
          {p.name} : {fmtView(Number(p.value))}
        </p>
      ))}
      <p style={{
        color: 'var(--c-text-1)', fontWeight: 600, lineHeight: 1.7,
        borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 4,
      }}>
        Total : {fmtView(row.retainer + row.oneOff)}
      </p>
    </div>
  )
}
