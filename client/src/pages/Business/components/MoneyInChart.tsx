import { useMemo } from 'react'
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
    return metrics.volume.byMonth.slice(-months).map(v => ({
      month: v.month,
      label: fmtMonth(v.month),
      retainer: v.retainer,
      oneOff: v.oneOff,
      mrr: movement.get(v.month) ?? 0,
    }))
  }, [metrics, months])

  const hasAny = data.some(d => d.retainer || d.oneOff || d.mrr)

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
      {hasAny ? (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={v => compact(v)} width={46} />
              <Tooltip
                cursor={barCursor}
                contentStyle={tooltipStyle}
                labelStyle={{ color: 'var(--c-text-1)', fontWeight: 600 }}
                formatter={((value: any, name: any) => [fmtView(Number(value)), String(name)]) as any}
              />
              <Legend
                verticalAlign="top" align="left" height={28} iconType="circle" iconSize={7}
                wrapperStyle={{ fontSize: 11, color: 'var(--c-text-3)', paddingBottom: 6 }}
              />
              <Bar dataKey="retainer" name="Retainer income" stackId="in" fill={HEX.accent} radius={[0, 0, 0, 0]} maxBarSize={44} />
              <Bar dataKey="oneOff" name="Website and one-off" stackId="in" fill={HEX.accent2} fillOpacity={0.55} radius={[3, 3, 0, 0]} maxBarSize={44} />
              <Line dataKey="mrr" name="MRR at month end" type="monotone" stroke={HEX.profit} strokeWidth={2} dot={false}
                activeDot={{ r: 4, fill: HEX.profit, stroke: 'var(--c-bg-card)', strokeWidth: 2 }} />
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
