import { useTradeAnalyticsSummary, useTradeEquityCurve, useTradeMistakes, useTrades } from '../../../hooks/useTrades'
import { StatCard } from '../../../components/ui/StatCard'
import { Card } from '../../../components/ui/Card'
import { PageLoader } from '../../../components/ui/Spinner'
import { formatPct, pnlColor } from '../../../lib/utils'
import { useFmtView } from '../../../hooks/useFmtView'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'

const COLORS = { profit: '#22c55e', loss: '#ef4444', neutral: '#3b82f6' }

interface Props {
  accountId?: number | null
}

export function TradingAnalytics({ accountId }: Props) {
  const { fmtView } = useFmtView('USD', 'trading')
  const params: Record<string, string> = accountId ? { accountId: String(accountId) } : {}
  const { data: summary, isPending } = useTradeAnalyticsSummary(params)
  const { data: equity } = useTradeEquityCurve(params)
  const { data: mistakes } = useTradeMistakes(params)
  const { data: trades } = useTrades(params)

  if (isPending) return <PageLoader />

  const instrumentBreakdown = trades?.reduce((acc: Record<string, { pnl: number; count: number }>, t) => {
    if (!acc[t.instrument]) acc[t.instrument] = { pnl: 0, count: 0 }
    acc[t.instrument].pnl += t.realizedPnl ?? 0
    acc[t.instrument].count++
    return acc
  }, {})

  const winRate = summary ? summary.winRate * 100 : 0

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-5 gap-4">
        <StatCard label="Total P&L" value={fmtView(summary?.totalPnl)} valueColor={pnlColor(summary?.totalPnl)} />
        <StatCard label="Win Rate" value={formatPct(winRate)} valueColor={winRate >= 50 ? 'text-pnl-profit' : 'text-pnl-loss'} />
        <StatCard label="Total Trades" value={summary?.totalTrades ?? 0} />
        <StatCard label="Avg R:R" value={summary?.avgRR != null ? `${summary.avgRR.toFixed(2)}R` : '--'} valueColor={pnlColor(summary?.avgRR)} />
        <StatCard label="Profit Factor" value={summary?.profitFactor != null ? summary.profitFactor.toFixed(2) : '--'} valueColor={pnlColor(summary?.profitFactor)} />
      </div>

      {/* Equity Curve */}
      <Card className="p-4">
        <h3 className="text-sm font-medium text-text-secondary mb-4">Equity Curve</h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={equity || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#525252' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#525252' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v >= 1000 ? (v/1000).toFixed(1)+'k' : v}`} />
              <Tooltip contentStyle={{ background: 'var(--c-chart-tooltip-bg)', border: '1px solid var(--c-border)', borderRadius: 8 }} labelStyle={{ color: 'var(--c-chart-tick)' }} formatter={(v: any) => [fmtView(v as number), 'P&L']} />
              <Line type="monotone" dataKey="cumulativePnl" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        {/* Mistakes */}
        <Card className="p-4">
          <h3 className="text-sm font-medium text-text-secondary mb-4">Top Mistakes</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(mistakes || []).slice(0, 7)} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10, fill: '#525252' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="mistake" tick={{ fontSize: 10, fill: '#525252' }} axisLine={false} tickLine={false} width={90} />
                <Tooltip contentStyle={{ background: 'var(--c-chart-tooltip-bg)', border: '1px solid var(--c-border)', borderRadius: 8 }} />
                <Bar dataKey="count" fill="#ef4444" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Win/Loss pie */}
        <Card className="p-4">
          <h3 className="text-sm font-medium text-text-secondary mb-4">Win / Loss</h3>
          <div className="h-48 flex items-center justify-center">
            {summary && (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={[{ name: 'Wins', value: summary.wins }, { name: 'Losses', value: summary.losses }]} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                    <Cell fill={COLORS.profit} />
                    <Cell fill={COLORS.loss} />
                  </Pie>
                  <Tooltip contentStyle={{ background: 'var(--c-chart-tooltip-bg)', border: '1px solid var(--c-border)', borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          {summary && (
            <div className="flex justify-center gap-6 text-xs text-text-muted mt-2">
              <span className="text-pnl-profit">Wins: {summary.wins}</span>
              <span className="text-pnl-loss">Losses: {summary.losses}</span>
            </div>
          )}
        </Card>

        {/* Instrument Breakdown */}
        <Card className="p-4 col-span-2">
          <h3 className="text-sm font-medium text-text-secondary mb-4">P&L by Instrument</h3>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={Object.entries(instrumentBreakdown || {}).map(([k, v]) => ({ instrument: k, pnl: v.pnl, trades: v.count }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="instrument" tick={{ fontSize: 12, fill: '#525252' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#525252' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={{ background: 'var(--c-chart-tooltip-bg)', border: '1px solid var(--c-border)', borderRadius: 8 }} formatter={(v: any) => [fmtView(v as number), 'P&L']} />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {Object.values(instrumentBreakdown || {}).map((v, i) => (
                    <Cell key={i} fill={v.pnl >= 0 ? COLORS.profit : COLORS.loss} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  )
}
