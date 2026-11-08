import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell } from 'recharts'
import type { Trade } from '../../../hooks/useTrades'
import { api } from '../../../lib/api'
import { Panel } from './Panel'
import { fmtR, median, outcomeOf } from '../../../lib/tradeStats'

interface Excursion { tradeId: number; mfeR: number | null; maeR: number | null; status: string }
const ttStyle = { background: 'var(--c-bg-card)', border: '1px solid var(--c-border)', borderRadius: 8, fontSize: 12 }
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')

/** Excursions for every crypto trade; polls while the server is still working them out. */
function useExcursions() {
  return useQuery({
    queryKey: ['trade-excursions'],
    queryFn: () => api.get('/api/trades/analytics/excursions').then(r => r.data as { pending: number; running: boolean; rows: Excursion[] }),
    refetchInterval: q => ((q.state.data?.pending ?? 1) > 0 ? 4000 : false),
  })
}

/**
 * How trades behaved while open (MFE: best point, MAE: worst point, in R).
 * Losers that were well in profit first point at management (partials, a
 * stop to breakeven); losers that never went your way point at entries.
 */
export function TradeManagement({ trades }: { trades: Trade[] }) {
  const { data } = useExcursions()
  const m = useMemo(() => {
    const ex = new Map((data?.rows ?? []).filter(r => r.status === 'ok' && r.mfeR != null).map(r => [r.tradeId, r]))
    const rows = trades.filter(t => t.rrRatio != null && ex.has(t.id)).map(t => ({ t, mfe: ex.get(t.id)!.mfeR!, mae: ex.get(t.id)!.maeR!, r: t.rrRatio!, o: outcomeOf(t) }))
    const losers = rows.filter(x => x.o === 'loss')
    const winners = rows.filter(x => x.o === 'win')
    const quick = losers.filter(x => (x.t.durationMinutes ?? 0) < 15)
    return {
      rows, losers, winners,
      cryptoClosed: trades.filter(t => t.instrument === 'Crypto' && t.rrRatio != null).length,
      upHalf: losers.filter(x => x.mfe >= 0.5).length,
      upOne: losers.filter(x => x.mfe >= 1).length,
      straight: losers.filter(x => x.mfe < 0.2).length,
      quickStraight: quick.filter(x => x.mfe < 0.2).length, quick: quick.length,
      capture: median(winners.filter(x => x.mfe > 0).map(x => Math.min(1, x.r / x.mfe))),
      winMfe: median(winners.map(x => x.mfe)),
      winHeat: median(winners.map(x => x.mae)),
      winDeep: winners.filter(x => x.mae <= -0.5).length,
    }
  }, [data, trades])

  const pending = data?.pending ?? 0
  if (!m.rows.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
        {pending ? `Reading Bybit's price history for your trades… ${pending} to go.` : 'No crypto trades with a stop or planned risk in this period.'}
      </p>
    )
  }

  const points = m.rows.map(x => ({ x: +Math.min(x.mfe, 8).toFixed(2), y: +x.r.toFixed(2), o: x.o, asset: x.t.asset, date: x.t.date, mfe: x.mfe, mae: x.mae }))
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Stat big={pct(m.straight, m.losers.length)} label="of losses never went your way" sub={`best point under +0.2R · ${m.straight} of ${m.losers.length}`} tone="loss" />
        <Stat big={pct(m.upHalf, m.losers.length)} label="of losses were +0.5R up first" sub={`${m.upOne} were a full +1R up before losing`} tone="warn" />
        <Stat big={m.capture != null ? `${Math.round(m.capture * 100)}%` : '—'} label="of the best move your winners keep" sub={m.winMfe != null ? `winners peak at ${fmtR(m.winMfe)} (median)` : ''} tone="neutral" />
        <Stat big={m.winHeat != null ? fmtR(m.winHeat) : '—'} label="heat your winners take" sub={`median worst point · ${pct(m.winDeep, m.winners.length)} went past −0.5R`} tone="neutral" />
      </div>

      <Panel className="p-4">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Best point reached (MFE) against where it ended</span>
          <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>
            {m.rows.length} of {m.cryptoClosed} crypto trades{pending ? ` · ${pending} still loading` : ''} · 1R = distance to the stop
          </span>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 6, right: 10, bottom: 4, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--c-chart-grid)" />
              <XAxis type="number" dataKey="x" name="Best point" tick={{ fontSize: 10, fill: 'var(--c-chart-tick)' }} tickLine={false} axisLine={false} tickFormatter={v => `+${v}R`} domain={[0, 'dataMax']} />
              <YAxis type="number" dataKey="y" name="Result" tick={{ fontSize: 10, fill: 'var(--c-chart-tick)' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}R`} />
              <ZAxis range={[28, 28]} />
              <ReferenceLine y={0} stroke="var(--c-border-strong)" />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 8, y: 8 }]} stroke="var(--c-border-mid)" strokeDasharray="4 4" ifOverflow="hidden" />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }: any) => active && payload?.length ? (
                <div style={{ ...ttStyle, padding: '8px 12px' }}>
                  <div style={{ color: 'var(--c-text-3)' }}>{payload[0].payload.date} · {payload[0].payload.asset}</div>
                  <div style={{ color: 'var(--c-text-1)' }}>Best <b>{fmtR(payload[0].payload.mfe)}</b> · worst <b>{fmtR(payload[0].payload.mae)}</b></div>
                  <div style={{ color: 'var(--c-text-1)' }}>Ended <b>{fmtR(payload[0].payload.y)}</b></div>
                </div>
              ) : null} />
              <Scatter data={points} isAnimationActive={false}>
                {points.map((p, i) => <Cell key={i} fill={p.o === 'win' ? 'var(--c-profit)' : p.o === 'loss' ? 'var(--c-loss)' : 'var(--c-text-3)'} fillOpacity={0.7} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--c-text-3)' }}>
          The dashed line is "closed at the best point". Red dots far to the right were well in profit before they lost.
          Red dots stacked at the left never went your way. From Bybit's 1-minute candles; the minute you entered and the minute you left only count your own prices.
        </p>
      </Panel>

      {m.quick > 0 && (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--c-text-2)' }}>
          Of the <b>{m.quick}</b> losses over within 15 minutes, <b>{pct(m.quickStraight, m.quick)}</b> never got to +0.2R.
          {m.quickStraight / m.quick >= 0.6
            ? ' Those trades were wrong from the moment you entered: entry timing or where the stop sits, not how you managed them.'
            : ' Many were in profit first, so how you manage the first minutes matters as much as the entry.'}
        </p>
      )}
    </div>
  )
}

function Stat({ big, label, sub, tone }: { big: string; label: string; sub?: string; tone: 'loss' | 'warn' | 'neutral' }) {
  const c = tone === 'loss' ? 'var(--c-loss)' : tone === 'warn' ? '#f59e0b' : 'var(--c-text-1)'
  return (
    <div className="tr-stat">
      <div className="text-2xl font-bold num leading-none" style={{ color: c }}>{big}</div>
      <div className="mt-1.5 text-xs font-medium" style={{ color: 'var(--c-text-1)' }}>{label}</div>
      {sub && <div className="mt-1 text-[10px] num" style={{ color: 'var(--c-text-3)' }}>{sub}</div>}
    </div>
  )
}
