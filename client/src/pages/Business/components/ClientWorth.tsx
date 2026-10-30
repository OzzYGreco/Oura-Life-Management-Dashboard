import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { axisProps, barCursor, compact, HEX } from '../../../lib/chartTheme'
import { Figure } from './MoneySections'
import { ChartTooltip } from './charts'
import { fmtMonth } from './primitives'
import type { FmtView } from '../../../hooks/useFmtView'

const pad = (n: number) => String(n).padStart(2, '0')

/** The last 12 month keys, oldest first, matching the server's `spark` order. */
function last12(): string[] {
  const now = new Date()
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  })
}

/**
 * What one client is worth: four figures and what they paid month by month.
 *
 * The flat sparkline this replaces had no scale and no months, so "is this
 * client growing?" could not be read off it. Bars with a real axis can, and
 * the chart starts at their first paying month rather than a year of nothing.
 */
export function ClientWorth({ e, fmtView }: { e: any; fmtView: FmtView }) {
  const data = useMemo(() => {
    const keys = last12()
    const rows = keys.map((k, i) => ({ label: fmtMonth(k), collected: e.spark?.[i] ?? 0 }))
    const first = rows.findIndex(r => r.collected > 0)
    return first < 0 ? [] : rows.slice(first)
  }, [e])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Figure label="Collected" value={fmtView(e.revenue)} sub={`${e.invoiceCount} invoice${e.invoiceCount === 1 ? '' : 's'}, after fees`} />
        <Figure label="Their costs" value={fmtView(e.costs)} sub={e.costs ? 'attributed to them' : 'none attributed'} />
        <Figure label="Kept" value={e.revenue ? `${e.marginPct.toFixed(0)}%` : '--'}
          color={!e.revenue ? 'var(--c-text-2)' : e.marginPct >= 50 ? 'var(--c-profit)' : 'var(--c-loss)'}
          sub={e.revenue ? `${fmtView(e.margin)} after their costs` : 'nothing collected yet'} />
        <Figure label="Client since"
          value={e.since ? new Date(e.since).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '--'}
          sub={e.since ? `${Math.round(e.tenureMonths)} month${Math.round(e.tenureMonths) === 1 ? '' : 's'}` : 'never invoiced'} />
      </div>
      {data.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
          <div className="text-[11px] mb-2" style={{ color: 'var(--c-text-3)' }}>What they paid, month by month, after fees</div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--c-border)" vertical={false} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} width={40} tickFormatter={compact} />
                <Tooltip cursor={barCursor} content={<ChartTooltip fmtView={fmtView} />} />
                <Bar dataKey="collected" name="Collected" fill={HEX.accent} radius={[4, 4, 0, 0]} maxBarSize={34}
                  activeBar={{ fill: HEX.accent2 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
