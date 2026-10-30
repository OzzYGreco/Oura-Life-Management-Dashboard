import { useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { axisProps, barCursor, compact, HEX } from '../../../lib/chartTheme'
import { useForecast, useVat } from '../../../hooks/useBusiness'
import { Question, Figure, Fold } from './MoneySections'
import { ChartTooltip, hoverCard } from './charts'
import { MiniBtn, fmtMonth } from './primitives'
import { formatDate } from '../../../lib/utils'
import type { FmtView } from '../../../hooks/useFmtView'

const card = { background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }
const KIND: Record<string, string> = { retainer: 'Retainer', owed: 'Owed', stage: 'Website stage', cost: 'Cost', ads: 'Ads' }

/**
 * What is coming: money expected in and out over the next months, from the
 * retainer schedule, bills owed, website stages, repeating costs and ads.
 * Same colours as "Am I profitable?": money in indigo, costs amber, and the
 * running total green, so the two charts read as one.
 */
export function WhatIsComing({ fmtView }: { fmtView: FmtView }) {
  const [months, setMonths] = useState(3)
  const { data: f } = useForecast(months)
  const [focus, setFocus] = useState<string | null>(null)
  const fade = (k: string) => (focus && focus !== k ? 0.25 : 1)
  if (!f) return null

  const rows = f.months.map(m => ({
    label: fmtMonth(m.month), in: m.retainers + m.owed + m.stages, out: m.costs + m.ads, total: m.cumulative,
  }))
  const net = f.totalIn - f.totalOut

  return (
    <Question q="What is coming?"
      answer={<>
        Over the next {months} months <b className="num" style={{ color: 'var(--c-accent)' }}>{fmtView(f.totalIn)}</b> should come in
        and <b className="num" style={{ color: '#f59e0b' }}>{fmtView(f.totalOut)}</b> go out, leaving{' '}
        <b className="num" style={{ color: net >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>{fmtView(net)}</b> before owner pay.
        {f.lateOwed > 0 && <> {fmtView(f.lateOwed)} of it is already late.</>}
      </>}
      action={<>{[3, 6, 12].map(n => (
        <MiniBtn key={n} tone={months === n ? 'accent' : 'default'} onClick={() => setMonths(n)}>{n} months</MiniBtn>
      ))}</>}>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)' }}>
        <div className={`rounded-xl p-4 ${hoverCard}`} style={card}>
          <div className="text-[11px] mb-2" style={{ color: 'var(--c-text-3)' }}>Expected in and out each month, and the running total</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
                <CartesianGrid stroke="var(--c-border)" vertical={false} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} width={44} tickFormatter={compact} />
                <Tooltip cursor={barCursor} content={<ChartTooltip fmtView={fmtView} />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: 'var(--c-text-2)', cursor: 'default' }}
                  onMouseEnter={(o: any) => setFocus(o.dataKey)} onMouseLeave={() => setFocus(null)} />
                <Bar dataKey="in" name="Coming in" fill={HEX.accent} fillOpacity={fade('in')} radius={[4, 4, 0, 0]} maxBarSize={28}
                  activeBar={{ fillOpacity: 1, stroke: HEX.accent, strokeWidth: 1 }} />
                <Bar dataKey="out" name="Going out" fill={HEX.amber} fillOpacity={fade('out')} radius={[4, 4, 0, 0]} maxBarSize={28}
                  activeBar={{ fillOpacity: 1, stroke: HEX.amber, strokeWidth: 1 }} />
                <Line dataKey="total" name="Running total" stroke={HEX.profit} strokeOpacity={fade('total')} strokeWidth={2}
                  dot={{ r: 3, strokeWidth: 0, fill: HEX.profit }} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--c-bg-card)' }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="grid gap-3 content-start">
          {f.months.slice(0, 3).map(m => (
            <Figure key={m.month} label={fmtMonth(m.month)} value={fmtView(m.net)} color={m.net >= 0 ? 'var(--c-profit)' : 'var(--c-loss)'}
              sub={`${fmtView(m.retainers + m.owed + m.stages)} in, ${fmtView(m.costs + m.ads)} out`} />
          ))}
        </div>
      </div>
      <Fold id="forecast-items" title="Everything expected"
        summary={`${f.items.length} items to ${formatDate(f.to)}. Owner draws are left out; they are a choice, not a cost.`}>
        <div className="rounded-xl overflow-hidden max-h-80 overflow-y-auto" style={card}>
          {f.items.map((x, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-1.5 text-[12px]"
              style={{ borderTop: i ? '1px solid rgba(255,255,255,0.045)' : 'none' }}>
              <span className="num w-24" style={{ color: 'var(--c-text-3)' }}>{formatDate(x.date)}</span>
              <span className="w-28" style={{ color: 'var(--c-text-3)' }}>{KIND[x.kind]}{x.late ? ', late' : ''}</span>
              <span className="flex-1 truncate" style={{ color: 'var(--c-text-2)' }}>{x.label}</span>
              <span className="num" style={{ color: x.amount >= 0 ? 'var(--c-text-1)' : '#f59e0b' }}>{fmtView(x.amount)}</span>
            </div>
          ))}
        </div>
      </Fold>
    </Question>
  )
}

/** The VAT registration threshold, for the "everything else" folds. */
export function VatFold({ fmtView }: { fmtView: FmtView }) {
  const { data: v } = useVat()
  if (!v) return null
  const crossing = v.crossing ? new Date(`${v.crossing}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : null
  return (
    <Fold id="vat" title="VAT threshold"
      summary={`${fmtView(v.rolling12)} billed in the last 12 months, ${v.pct.toFixed(0)}% of ${fmtView(v.threshold)}`}>
      <div className={`rounded-xl p-4 ${hoverCard}`} style={card}>
        <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--c-bg-input)' }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(v.pct, 100)}%`, background: v.pct >= 85 ? '#f59e0b' : HEX.accent }} />
        </div>
        <p className="text-[12px] mt-3" style={{ color: 'var(--c-text-2)' }}>
          You must register for VAT once what you bill in any 12 months passes {fmtView(v.threshold)}.
          At your recent pace of {fmtView(v.monthlyPace)} a month,{' '}
          {crossing ? <>you would cross it around <b>{crossing}</b>.</> : 'that is more than three years away.'}
        </p>
      </div>
    </Fold>
  )
}
