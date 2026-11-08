import { useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'
import type { Trade } from '../../../hooks/useTrades'
import { Panel } from './Panel'
import { useIsNext } from '../../../skins/isNext'
import { fmtR, mean } from '../../../lib/tradeStats'
import type { Lever } from './slices'
import { TrendingDown, TrendingUp } from 'lucide-react'

const ttStyle = { background: 'var(--c-bg-card)', border: '1px solid var(--c-border)', borderRadius: 8, fontSize: 12 }

/** The strongest findings as cards: what it is, what it costs or adds, and against what. */
export function LeverCards({ items, holdNote }: { items: Lever[]; holdNote?: boolean }) {
  const nx = useIsNext()
  if (!items.length) {
    return <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>Nothing stands out yet: no slice of 15+ trades differs enough from the rest.</p>
  }
  return (
    <div className={nx ? 'tr-levers' : 'grid gap-3 md:grid-cols-3'}>
      {items.map((l, i) => {
        const bad = l.impact < 0
        // Green only when the slice makes money; a losing slice that beats the rest is "least bad".
        const lessBad = !bad && l.avgR < 0
        const c = bad ? 'var(--c-loss)' : lessBad ? '#f59e0b' : 'var(--c-profit)'
        return (
          <div key={`${l.dim.key}${l.bucket}`} className={nx ? 'tr-lever' : 'relative overflow-hidden rounded-xl p-4'}
            style={nx ? undefined : { background: `radial-gradient(130% 120% at 0% 0%, color-mix(in srgb, ${c} ${i === 0 ? 14 : 8}%, transparent), transparent 60%), var(--c-bg-card)`, border: '1px solid var(--c-border)', boxShadow: 'var(--c-shadow-card)' }}>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: c }}>
              {bad ? <TrendingDown size={13} /> : <TrendingUp size={13} />} {bad ? 'Costs you' : lessBad ? 'Loses least' : 'Works for you'} · {l.dim.label}
            </div>
            <div className="mt-2 text-sm font-semibold leading-snug" style={{ color: 'var(--c-text-1)' }}>{l.dim.phrase(l.bucket)}</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold num" style={{ color: l.netR >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>{fmtR(l.netR, 1)}</span>
              <span className="text-xs num" style={{ color: 'var(--c-text-3)' }}>over {l.n} trades</span>
            </div>
            <div className="mt-1.5 text-xs num leading-relaxed" style={{ color: 'var(--c-text-2)' }}>
              {fmtR(l.avgR)} a trade, against {fmtR(l.restAvg)} for the rest.
              {' '}That's <b style={{ color: c }}>{fmtR(Math.abs(l.impact), 1).replace(/^[+−]/, '')}</b> {bad ? 'lost' : lessBad ? 'less lost' : 'gained'} compared with trading like the rest.
              {lessBad && ' Still losing, just less than your other trades.'}
            </div>
            {holdNote && l.dim.key === 'hold' && bad && (
              <div className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--c-text-3)' }}>
                Partly built in (a stop-out ends a trade fast). Trade management below shows whether these went straight against you.
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** A rolling average R: is the edge improving, or slipping? */
export function RollingEdge({ trades, window: win }: { trades: Trade[]; window: number }) {
  const data = useMemo(() => {
    const rs = trades.filter(t => t.rrRatio != null)
    const out: { i: number; avg: number; date: string; pos: number | null; neg: number | null }[] = []
    for (let i = win; i <= rs.length; i++) {
      const avg = mean(rs.slice(i - win, i).map(t => t.rrRatio!))!
      out.push({ i, avg: +avg.toFixed(3), date: rs[i - 1].date, pos: avg >= 0 ? avg : 0, neg: avg < 0 ? avg : 0 })
    }
    return out
  }, [trades, win])
  if (data.length < 2) return <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>Needs at least {win + 1} trades with a planned risk.</p>
  return (
    <Panel className="p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-3)' }}>Average R of the last {win} trades, trade by trade</div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
            <defs>
              <linearGradient id="edgePos" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--c-profit)" stopOpacity={0.45} /><stop offset="100%" stopColor="var(--c-profit)" stopOpacity={0.05} /></linearGradient>
              <linearGradient id="edgeNeg" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="var(--c-loss)" stopOpacity={0.45} /><stop offset="100%" stopColor="var(--c-loss)" stopOpacity={0.05} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--c-chart-grid)" vertical={false} />
            <XAxis dataKey="i" tick={{ fontSize: 10, fill: 'var(--c-chart-tick)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--c-chart-tick)' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}R`} />
            <ReferenceLine y={0} stroke="var(--c-border-strong)" />
            <Tooltip cursor={{ stroke: 'var(--c-border-mid)' }} content={({ active, payload }: any) => active && payload?.length ? (
              <div style={{ ...ttStyle, padding: '8px 12px' }}>
                <div style={{ color: 'var(--c-text-3)' }}>Trade #{payload[0].payload.i} · {payload[0].payload.date}</div>
                <div style={{ color: 'var(--c-text-1)' }}>Last {win} trades averaged <b>{fmtR(payload[0].payload.avg)}</b></div>
              </div>
            ) : null} />
            <Area type="monotone" dataKey="pos" stroke="none" fill="url(#edgePos)" isAnimationActive={false} />
            <Area type="monotone" dataKey="neg" stroke="none" fill="url(#edgeNeg)" isAnimationActive={false} />
            <Area type="monotone" dataKey="avg" stroke="var(--c-accent)" strokeWidth={2} fill="none" dot={false} isAnimationActive={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}

/**
 * Win rate against the one you need. With your average win W and loss L
 * (in R), breaking even takes a win rate of |L| / (W + |L|); at your actual
 * win rate p, breaking even takes an average win of |L|(1-p)/p.
 */
export function BreakevenGauge({ winRate, avgWin, avgLoss }: { winRate: number; avgWin: number | null; avgLoss: number | null }) {
  if (avgWin == null || avgLoss == null || winRate <= 0) return null
  const need = Math.abs(avgLoss) / (avgWin + Math.abs(avgLoss))
  const winNeeded = (Math.abs(avgLoss) * (1 - winRate)) / winRate
  const max = Math.max(0.6, need + 0.1, winRate + 0.1)
  const x = (v: number) => `${(v / max) * 100}%`
  const ahead = winRate >= need
  return (
    <Panel className="p-4">
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Win rate against break-even</span>
        <span className="text-xs num" style={{ color: ahead ? 'var(--c-profit)' : 'var(--c-loss)' }}>
          {ahead ? `${Math.round((winRate - need) * 100)} points above` : `${Math.round((need - winRate) * 100)} points short`}
        </span>
      </div>
      <div className="relative h-3 rounded-full" style={{ background: 'var(--c-bg-input)', boxShadow: 'inset 0 0 0 1px var(--c-border)' }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: x(winRate), background: ahead ? 'linear-gradient(90deg, rgba(52,211,153,0.35), var(--c-profit))' : 'linear-gradient(90deg, rgba(248,113,113,0.3), var(--c-loss))' }} />
        <div className="absolute -top-1.5 -bottom-1.5 w-0.5 rounded" style={{ left: x(need), background: 'var(--c-text-1)' }} />
      </div>
      <div className="relative h-8 mt-1.5 text-[11px] num">
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: x(winRate), color: ahead ? 'var(--c-profit)' : 'var(--c-loss)' }}>you win {Math.round(winRate * 100)}%</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap top-4" style={{ left: x(need), color: 'var(--c-text-1)' }}>need {Math.round(need * 100)}%</span>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--c-text-2)' }}>
        Your wins average <b>{fmtR(avgWin)}</b> and losses <b>{fmtR(avgLoss)}</b>.
        {ahead
          ? <> At that payoff you need {Math.round(need * 100)}%, and you're above it.</>
          : <> To profit at your {Math.round(winRate * 100)}% win rate, wins would need to average <b>{fmtR(winNeeded)}</b>, or losses shrink to <b>{fmtR(-(avgWin * winRate) / (1 - winRate))}</b>.</>}
      </p>
    </Panel>
  )
}
