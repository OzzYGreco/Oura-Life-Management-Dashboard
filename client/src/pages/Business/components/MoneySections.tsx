import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
} from 'recharts'
import { axisProps, barCursor, compact, HEX } from '../../../lib/chartTheme'
import { MiniBtn, fmtMonth } from './primitives'
import { ChartTooltip, SplitBar, hoverCard } from './charts'
import type { BusinessMetrics, OwnerPay } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

/** Solid hairline grid: dashed reads as a projection, not a scale. */
const grid = { stroke: 'var(--c-border)', vertical: false } as const

const card = { background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' } as const

/** A question as a heading, its answer in one line underneath. */
export function Question({ q, answer, action, children }: {
  q: string; answer: ReactNode; action?: ReactNode; children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[15px] font-bold tracking-tight" style={{ color: 'var(--c-text-1)' }}>{q}</h2>
          <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--c-text-2)' }}>{answer}</p>
        </div>
        {action && <div className="flex gap-1.5">{action}</div>}
      </div>
      {children}
    </section>
  )
}

/**
 * A section closed by default, with its answer in the header so it is useful
 * even shut. Open or shut is remembered per browser.
 */
export function Fold({ id, title, summary, action, children }: {
  id: string; title: string; summary: ReactNode; action?: ReactNode; children: ReactNode
}) {
  const key = `oura.business.fold.${id}`
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) === '1' } catch { return false } })
  const toggle = () => setOpen(o => { try { localStorage.setItem(key, o ? '0' : '1') } catch { /* private window */ } return !o })
  return (
    <section className="rounded-xl" style={card}>
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
        <button type="button" onClick={toggle} aria-expanded={open} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          {open ? <ChevronDown size={14} style={{ color: 'var(--c-accent)' }} /> : <ChevronRight size={14} style={{ color: 'var(--c-accent)' }} />}
          <span className="text-[13px] font-semibold" style={{ color: 'var(--c-text-1)' }}>{title}</span>
          <span className="text-[12px] truncate" style={{ color: 'var(--c-text-3)' }}>{summary}</span>
        </button>
        {action}
      </div>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  )
}

export function Figure({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${hoverCard}`} style={card}>
      <div className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--c-text-3)' }}>{label}</div>
      <div className="text-xl font-bold num leading-none tracking-tight" style={{ color: color ?? 'var(--c-text-1)' }}>{value}</div>
      {sub != null && <div className="text-[10.5px] mt-1.5" style={{ color: 'var(--c-text-3)' }}>{sub}</div>}
    </div>
  )
}

// ─── 1. Am I profitable? ─────────────────────────────────────────────────────

/**
 * Profit first, as four figures and one chart: what came in against what went
 * out, month by month, with what was left as a line. One axis, because all
 * three are the same pounds. The chart starts at the first month money came in,
 * so the year does not open on empty months.
 */
export function Profitable({ m, fmtView, periodLabel }: { m: BusinessMetrics; fmtView: FmtView; periodLabel: string }) {
  const months = useMemo(() => {
    const first = m.pnlByMonth.findIndex(r => r.netVolume > 0)
    return (first < 0 ? [] : m.pnlByMonth.slice(first)).map(r => ({
      label: fmtMonth(r.month), month: r.month,
      in: r.netVolume, costs: r.totalCosts, profit: r.netProfit,
    }))
  }, [m])
  const thisMonth = m.pnlByMonth.at(-1)
  const lastMonth = m.pnlByMonth.at(-2)
  const p = m.pnl
  // A loss of pennies next to months of thousands would stretch the scale to a
  // round -750; under 5% of the top it sits on the zero line instead (the
  // tooltip still gives the exact figure). A real loss keeps its own floor.
  const low = Math.min(0, ...months.map(x => x.profit))
  const high = Math.max(1, ...months.map(x => Math.max(x.in, x.costs)))
  const floor = low > -0.05 * high ? 0 : 'auto'
  // Pointing at a legend entry brings that series forward and fades the rest.
  const [focus, setFocus] = useState<string | null>(null)
  const fade = (k: string) => (focus && focus !== k ? 0.2 : 1)

  // Where each pound went, for the one bar under the chart.
  const flow = [
    { key: 'Fees and refunds', value: p.fees + p.refunds, color: 'var(--c-text-3)' },
    { key: 'Ads', value: p.adSpend, color: HEX.amber },
    { key: 'Tools', value: p.overheads, color: HEX.accent2 },
    { key: 'Client costs', value: p.clientCosts, color: HEX.cyan },
    { key: 'Profit', value: Math.max(p.netProfit, 0), color: HEX.profit },
  ].filter(f => f.value > 0.005)
  const gross = flow.reduce((s, f) => s + f.value, 0)

  return (
    <Question
      q="Am I profitable?"
      answer={p.netProfit >= 0
        ? <>Yes: <b className="num" style={{ color: 'var(--c-profit)' }}>{fmtView(p.netProfit)}</b> profit {periodLabel}, keeping {p.marginPct.toFixed(0)}p of every pound that came in.</>
        : <>Not {periodLabel}: costs ran <b className="num" style={{ color: 'var(--c-loss)' }}>{fmtView(-p.netProfit)}</b> over money in.</>}
    >
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Figure label="Profit" value={fmtView(p.netProfit)} color={p.netProfit >= 0 ? 'var(--c-profit)' : 'var(--c-loss)'}
          sub={thisMonth && lastMonth ? `this month ${fmtView(thisMonth.netProfit)} · last ${fmtView(lastMonth.netProfit)}` : undefined} />
        <Figure label="Margin" value={`${p.marginPct.toFixed(1)}%`}
          sub={thisMonth && lastMonth ? `this month ${thisMonth.marginPct.toFixed(0)}% · last ${lastMonth.marginPct.toFixed(0)}%` : undefined} />
        <Figure label="Money in" value={fmtView(p.netVolume)}
          sub={`${fmtView(p.grossVolume)} before ${fmtView(p.fees + p.refunds)} fees and refunds`} />
        <Figure label="Costs" value={fmtView(p.totalCosts)} color="var(--c-text-1)"
          sub={`ads ${fmtView(p.adSpend)} · tools ${fmtView(p.overheads)} · client ${fmtView(p.clientCosts)}`} />
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)' }}>
        <div className="rounded-xl p-4" style={card}>
          <div className="text-[11px] mb-2" style={{ color: 'var(--c-text-3)' }}>Month by month, money in against costs</div>
          {months.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={months} margin={{ top: 6, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
                  <CartesianGrid {...grid} />
                  <XAxis dataKey="label" {...axisProps} />
                  {/* Floor at the real lowest point: a -£20 month should not drag the scale to -£800. */}
                  <YAxis {...axisProps} width={44} tickFormatter={compact}
                    domain={[floor, 'auto']} allowDataOverflow />
                  <Tooltip cursor={barCursor} content={<ChartTooltip fmtView={fmtView} />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: 'var(--c-text-2)', cursor: 'default' }}
                    onMouseEnter={(o: any) => setFocus(o.dataKey)} onMouseLeave={() => setFocus(null)} />
                  <Bar dataKey="in" name="Money in" fill={HEX.accent} fillOpacity={fade('in')} radius={[4, 4, 0, 0]} maxBarSize={22}
                    activeBar={{ fillOpacity: 1, stroke: HEX.accent, strokeWidth: 1 }} />
                  <Bar dataKey="costs" name="Costs" fill={HEX.amber} fillOpacity={fade('costs')} radius={[4, 4, 0, 0]} maxBarSize={22}
                    activeBar={{ fillOpacity: 1, stroke: HEX.amber, strokeWidth: 1 }} />
                  <Line dataKey="profit" name="Profit" stroke={HEX.profit} strokeOpacity={fade('profit')} strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0, fill: HEX.profit }} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--c-bg-card)' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="py-12 text-center text-xs" style={{ color: 'var(--c-text-3)' }}>No money in yet.</p>}
        </div>

        <div className="rounded-xl p-4 flex flex-col" style={card}>
          <div className="text-[11px] mb-3" style={{ color: 'var(--c-text-3)' }}>Where each pound went, {periodLabel}</div>
          {gross > 0 ? (
            <>
              <SplitBar parts={flow.map(f => ({ key: f.key, value: f.value, color: f.color }))} fmtView={fmtView} />
              <p className="text-[10.5px] mt-auto pt-3" style={{ color: 'var(--c-text-3)' }}>
                Out of {fmtView(p.grossVolume)} billed and paid. Owner draws come out of profit, not costs.
              </p>
            </>
          ) : <p className="py-10 text-center text-xs" style={{ color: 'var(--c-text-3)' }}>Nothing in this period.</p>}
        </div>
      </div>
    </Question>
  )
}

// ─── 2. What can we take? ────────────────────────────────────────────────────

/**
 * What it is safe to take, as one figure and one bar that shows how profit
 * splits into tax, buffer and what is free, then one line per partner: what
 * they have taken against their share.
 */
export function WhatWeCanTake({
  op, fmtView, periodLabel, onRecordDraw, onDeleteDraw, onSettings,
}: {
  op: OwnerPay; fmtView: FmtView; periodLabel: string
  onRecordDraw: () => void; onDeleteDraw: (id: number) => void; onSettings: () => void
}) {
  const [allDraws, setAllDraws] = useState(false)
  const profit = Math.max(op.netProfit, 0)
  const safe = Math.max(op.safeToDraw, 0)
  const parts = [
    { key: `Tax reserve${op.taxReserveEnabled ? ` (${op.taxRatePct}%)` : ''}`, value: op.taxReserve, color: 'var(--c-text-3)' },
    { key: `Buffer (${op.bufferMonths} month${op.bufferMonths === 1 ? '' : 's'} of costs)`, value: Math.min(op.buffer, Math.max(profit - op.taxReserve, 0)), color: HEX.amber },
    { key: 'Safe to take', value: safe, color: HEX.profit },
  ].filter(x => x.value > 0.005)
  const total = parts.reduce((s, x) => s + x.value, 0)
  const draws = allDraws ? op.recent : op.recent.slice(0, 3)

  return (
    <Question
      q="What can we take?"
      answer={safe > 0
        ? <><b className="num" style={{ color: 'var(--c-profit)' }}>{fmtView(safe)}</b> is safe to take {periodLabel}, after tax and a buffer. {fmtView(op.drawnPeriod)} taken so far.</>
        : <>Nothing is safe to take {periodLabel} once tax and the buffer are held back. {fmtView(op.drawnPeriod)} taken so far.</>}
      action={<>
        <MiniBtn onClick={onSettings}>What to hold back</MiniBtn>
        <MiniBtn tone="good" onClick={onRecordDraw}>+ Record a draw</MiniBtn>
      </>}
    >
      <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(280px, 1fr) minmax(0, 1.4fr)' }}>
        <div className="rounded-xl p-4" style={card}>
          <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Safe to take</div>
          <div className="text-3xl font-bold num mt-1" style={{ color: safe > 0 ? 'var(--c-profit)' : 'var(--c-text-2)' }}>{fmtView(safe)}</div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--c-text-3)' }}>of {fmtView(profit)} profit {periodLabel}</div>
          {total > 0 && (
            <>
              <div className="mt-4"><SplitBar parts={parts} fmtView={fmtView} height={12} /></div>
            </>
          )}
        </div>

        <div className="rounded-xl p-4" style={card}>
          <div className="text-[11px] mb-3" style={{ color: 'var(--c-text-3)' }}>Each partner, taken against their share of all profit so far</div>
          <div className="space-y-3.5">
            {op.owners.map(o => {
              const pct = o.entitled > 0 ? Math.min((o.lifetime / o.entitled) * 100, 100) : 0
              return (
                <div key={o.id}>
                  <div className="flex items-baseline justify-between text-[12.5px]">
                    <span style={{ color: 'var(--c-text-1)' }}>{o.name} <span style={{ color: 'var(--c-text-3)' }}>· {o.sharePct}%</span></span>
                    <span className="num" style={{ color: 'var(--c-text-2)' }}>
                      {fmtView(o.lifetime)} of {fmtView(o.entitled)}
                      <span style={{ color: o.leftToDraw > 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>
                        {' · '}{o.leftToDraw > 0 ? `${fmtView(o.leftToDraw)} left` : `${fmtView(o.delta)} ahead`}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full mt-1.5 overflow-hidden" style={{ background: 'var(--c-bg-input)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: HEX.accent2 }} />
                  </div>
                </div>
              )
            })}
          </div>
          {op.recent.length > 0 && (
            <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--c-border)' }}>
              <div className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--c-text-3)' }}>Recent draws</div>
              {draws.map(d => (
                <div key={d.id} className="flex items-center gap-3 py-1 text-[12px]">
                  <span className="num w-20" style={{ color: 'var(--c-text-3)' }}>{d.date}</span>
                  <span className="flex-1" style={{ color: 'var(--c-text-2)' }}>{d.ownerName}{d.notes ? ` · ${d.notes}` : ''}</span>
                  <span className="num" style={{ color: 'var(--c-text-1)' }}>{fmtView(d.amount)}</span>
                  <button type="button" className="text-[10.5px] hover:underline" style={{ color: 'var(--c-loss)' }}
                    onClick={() => { if (window.confirm(`Remove ${d.ownerName}'s ${fmtView(d.amount)} draw?`)) onDeleteDraw(d.id) }}>remove</button>
                </div>
              ))}
              {op.recent.length > 3 && (
                <button type="button" className="text-[11px] mt-1 hover:underline" style={{ color: 'var(--c-accent)' }}
                  onClick={() => setAllDraws(v => !v)}>
                  {allDraws ? 'Show fewer' : `Show all ${op.recent.length}`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Question>
  )
}

// ─── 3. Where does money go? ─────────────────────────────────────────────────

/**
 * Costs by type as bars (close values read better as lengths than as a
 * donut), with the biggest single items under each, then a link down to the
 * full list where they are logged.
 */
export function WhereItGoes({
  m, expenses, campaigns, fmtView, periodLabel, range, children,
}: {
  m: BusinessMetrics; expenses: any[]; campaigns: any[]; fmtView: FmtView; periodLabel: string
  range: { from?: string; to?: string }
  children?: ReactNode
}) {
  const inRange = (d: string) => (!range.from || d >= range.from) && (!range.to || d <= range.to)
  const top = (rows: any[], client: boolean) => {
    const by = new Map<string, number>()
    for (const e of rows) {
      if (!inRange(e.date) || !!e.clientId !== client) continue
      const k = e.vendor || e.description
      by.set(k, (by.get(k) ?? 0) + e.amount)
    }
    return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  }
  const types = [
    { key: 'Ads', value: m.costs.adSpend, color: HEX.amber,
      items: campaigns.filter(c => c.fundingSource === 'business').map(c => [c.name, c.measuredSpend ?? c.spent ?? 0] as [string, number])
        .sort((a, b) => b[1] - a[1]).slice(0, 3), itemsNote: 'all time' },
    { key: 'Tools and overheads', value: m.costs.overheads, color: HEX.accent2, items: top(expenses, false) },
    { key: 'Client delivery', value: m.costs.clientCosts, color: HEX.cyan, items: top(expenses, true) },
  ]
  const max = Math.max(...types.map(t => t.value), 1)
  const biggest = [...types].sort((a, b) => b.value - a.value)[0]

  return (
    <Question
      q="Where does money go?"
      answer={m.costs.total > 0
        ? <><b className="num">{fmtView(m.costs.total)}</b> spent {periodLabel}. The most went on {biggest.key.toLowerCase()} ({fmtView(biggest.value)}, {Math.round((biggest.value / m.costs.total) * 100)}%).</>
        : <>Nothing spent {periodLabel}.</>}
    >
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {types.map(t => (
          <div key={t.key} className={`rounded-xl p-4 ${hoverCard}`} style={card}>
            <div className="flex items-baseline justify-between">
              <span className="text-[12.5px] font-semibold" style={{ color: 'var(--c-text-1)' }}>{t.key}</span>
              <span className="text-lg font-bold num" style={{ color: 'var(--c-text-1)' }}>{fmtView(t.value)}</span>
            </div>
            <div className="h-2 rounded-full mt-2 overflow-hidden" style={{ background: 'var(--c-bg-input)' }}>
              <div className="h-full rounded-full" style={{ width: `${(t.value / max) * 100}%`, background: t.color }} />
            </div>
            <div className="mt-3 space-y-1 text-[11.5px]">
              {t.items.length === 0
                ? <p style={{ color: 'var(--c-text-3)' }}>Nothing here {periodLabel}.</p>
                : t.items.map(([name, v]) => (
                  <div key={name} className="flex justify-between gap-3">
                    <span className="truncate" style={{ color: 'var(--c-text-2)' }}>{name}</span>
                    <span className="num" style={{ color: 'var(--c-text-1)' }}>{fmtView(v)}</span>
                  </div>
                ))}
              {'itemsNote' in t && t.items.length > 0 && (
                <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>campaign totals, {t.itemsNote}</p>
              )}
            </div>
          </div>
        ))}
      </div>
      {children}
    </Question>
  )
}

/** Ad spend per month as plain bars, for the Marketing fold. */
export function AdSpendBars({ m, fmtView }: { m: BusinessMetrics; fmtView: FmtView }) {
  const data = m.pnlByMonth.filter(r => r.adSpend > 0 || r.netVolume > 0).map(r => ({ label: fmtMonth(r.month), ads: r.adSpend }))
  if (!data.length) return null
  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...grid} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} width={44} tickFormatter={compact} />
          <Tooltip cursor={barCursor} content={<ChartTooltip fmtView={fmtView} />} />
          <Bar dataKey="ads" name="Ad spend" radius={[4, 4, 0, 0]} maxBarSize={26}>
            {data.map((_, i) => <Cell key={i} fill={HEX.amber} />)}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
