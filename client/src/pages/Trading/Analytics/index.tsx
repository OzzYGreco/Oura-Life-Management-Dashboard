import { useState, useMemo, useCallback } from 'react'
import { useTrades } from '../../../hooks/useTrades'
import { Card } from '../../../components/ui/Card'
import { PageLoader } from '../../../components/ui/Spinner'
import { useFmtView } from '../../../hooks/useFmtView'
import { MISTAKES } from '../../../lib/constants'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Trade } from '../../../hooks/useTrades'
import { DateFilter, applyDateFilter, type Preset } from '../../../components/shared/DateFilter'

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  profit: '#22c55e',
  loss:   '#ef4444',
  blue:   '#6366f1',
  amber:  '#f59e0b',
  muted:  '#525252',
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

// ── Helpers ───────────────────────────────────────────────────────────────────
const rColor = (r: number | null | undefined) =>
  r == null ? 'var(--c-text-3)' : r > 0 ? C.profit : r < 0 ? C.loss : 'var(--c-text-3)'

const fmtR = (r: number) => `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`

const rCellBg = (r: number | null): React.CSSProperties => {
  if (r == null) return {}
  if (r >  1.5) return { background: 'rgba(34,197,94,0.45)',  color: '#fff' }
  if (r >  0)   return { background: 'rgba(34,197,94,0.18)',  color: C.profit }
  if (r < -1.5) return { background: 'rgba(239,68,68,0.45)',  color: '#fff' }
  if (r <  0)   return { background: 'rgba(239,68,68,0.18)',  color: C.loss }
  return {}
}

const pnlCellBg = (v: number): React.CSSProperties =>
  v > 0 ? { background: 'rgba(34,197,94,0.15)', color: C.profit }
        : v < 0 ? { background: 'rgba(239,68,68,0.15)', color: C.loss }
        : {}

/** Map a raw mistake key → readable label */
const fmtMistake = (key: string): string => {
  const found = MISTAKES.find(m => m.key === key)
  if (found) return found.label
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Shared tooltip styles ─────────────────────────────────────────────────────
const ttStyle   = { background: 'var(--c-bg-card)', border: '1px solid var(--c-border)', borderRadius: 8, fontSize: 12 }
const ttLabel   = { color: 'var(--c-text-1)' }
const barCursor = { fill: 'rgba(255,255,255,0.04)' }

// ── Sub-components ─────────────────────────────────────────────────────────────
function Sect({ label, children, action }: { label: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>{label}</span>
        <div className="flex-1 h-px" style={{ background: 'var(--c-border)' }} />
        {action}
      </div>
      {children}
    </div>
  )
}

function KpiCard({
  label, value, sub, color = 'var(--c-text-1)',
}: { label: string; value: React.ReactNode; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
      <div className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--c-text-3)' }}>{label}</div>
      <div className="text-xl font-bold num leading-none" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] num mt-1.5" style={{ color: 'var(--c-text-3)' }}>{sub}</div>}
    </div>
  )
}

/** Custom P&L tooltip that colors value green / red based on sign */
function PnlTip({
  active, payload, label,
  fmt = (v: number) => `$${v.toFixed(2)}`,
}: { active?: boolean; payload?: any[]; label?: string; fmt?: (v: number) => string }) {
  if (!active || !payload?.length) return null
  const v = payload[0]?.value as number
  return (
    <div style={{ ...ttStyle, padding: '8px 12px' }}>
      <p style={{ color: 'var(--c-text-1)', fontWeight: 600, margin: '0 0 4px' }}>{label}</p>
      <p style={{ margin: 0, color: v >= 0 ? C.profit : C.loss }}>P&amp;L : {fmt(v)}</p>
    </div>
  )
}

// ── Stats helpers ──────────────────────────────────────────────────────────────
function computeStats(trades: Trade[]) {
  if (!trades.length) return null
  const total   = trades.length
  const wins    = trades.filter(t => (t.netPnl ?? t.realizedPnl ?? 0) > 0)
  const losses  = trades.filter(t => (t.netPnl ?? t.realizedPnl ?? 0) < 0)
  const longs   = trades.filter(t => t.direction === 'Long')
  const shorts  = trades.filter(t => t.direction === 'Short')

  const totalPnl  = trades.reduce((s, t) => s + (t.netPnl ?? t.realizedPnl ?? 0), 0)
  const totalR    = trades.reduce((s, t) => s + (t.rrRatio ?? 0), 0)
  const winRate   = wins.length / total
  const lossRate  = 1 - winRate
  const avgWinR   = wins.length  ? wins.reduce((s, t)   => s + (t.rrRatio ?? 0), 0) / wins.length  : 0
  const avgLossR  = losses.length ? losses.reduce((s, t) => s + (t.rrRatio ?? 0), 0) / losses.length : 0
  const ev        = winRate * avgWinR + lossRate * avgLossR
  const bestR     = trades.reduce((m, t) => Math.max(m, t.rrRatio ?? -Infinity), -Infinity)

  // Max drawdown ($) using netPnl
  const sorted = [...trades].sort((a, b) =>
    a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
  let cum = 0, peak = 0, maxDD = 0
  for (const t of sorted) {
    cum  += t.netPnl ?? t.realizedPnl ?? 0
    if (cum > peak) peak = cum
    const dd = peak - cum
    if (dd > maxDD) maxDD = dd
  }

  return {
    total, wins: wins.length, losses: losses.length,
    longs: longs.length, shorts: shorts.length,
    totalPnl, totalR, winRate, avgWinR, avgLossR, ev,
    bestR: bestR === -Infinity ? 0 : bestR,
    maxDD: -maxDD,
  }
}

// ── Calendar Heatmap ──────────────────────────────────────────────────────────
function CalendarHeatmap({ trades }: { trades: Trade[] }) {
  const now = new Date()
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1)
  const [viewYear, setViewYear]   = useState(now.getFullYear())

  const years = useMemo(() => {
    const ys = [...new Set(trades.map(t => Number(t.date.slice(0, 4))))].sort().reverse()
    return ys.length ? ys : [now.getFullYear()]
  }, [trades])

  const dayR = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of trades) {
      const [y, mo] = t.date.split('-').map(Number)
      if (y === viewYear && mo === viewMonth && t.rrRatio != null) {
        m[t.date] = (m[t.date] ?? 0) + t.rrRatio
      }
    }
    return m
  }, [trades, viewMonth, viewYear])

  const firstDow    = new Date(viewYear, viewMonth - 1, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  const selectStyle: React.CSSProperties = { background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--c-text-2)' }}>Daily R Heatmap</h3>
        <div className="flex items-center gap-2">
          <select value={viewMonth} onChange={e => setViewMonth(Number(e.target.value))}
            className="text-xs px-2.5 py-1.5 rounded-lg outline-none" style={selectStyle}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={viewYear} onChange={e => setViewYear(Number(e.target.value))}
            className="text-xs px-2.5 py-1.5 rounded-lg outline-none" style={selectStyle}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 4 }}>
        <thead>
          <tr>{DAYS.map(d => (
            <th key={d} className="text-center text-[10px] font-bold pb-2 uppercase tracking-widest"
              style={{ color: 'var(--c-text-3)', width: '14.28%' }}>{d}</th>
          ))}</tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((day, di) => {
                if (!day) return <td key={di} />
                const dateKey = `${viewYear}-${String(viewMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                const r = dayR[dateKey] ?? null
                return (
                  <td key={di} style={{
                    borderRadius: 8, padding: '8px 4px', textAlign: 'center',
                    border: '1px solid var(--c-border)',
                    ...rCellBg(r),
                    background: r !== null ? rCellBg(r).background : 'var(--c-bg-secondary)',
                  }}>
                    <div className="text-xs font-semibold num">{day}</div>
                    <div className="text-[11px] num font-medium mt-0.5">
                      {r !== null ? `${r >= 0 ? '+' : ''}${r.toFixed(2)} R` : <span style={{ color: 'var(--c-text-3)' }}>—</span>}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null
  const W = 100, H = 36
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const pts = points
    .map((v, i) => `${(i / (points.length - 1)) * W},${H - ((v - min) / range) * (H - 4) - 2}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
    </svg>
  )
}

// ── System Performance ────────────────────────────────────────────────────────
function SystemPerformance({ trades, fmtView }: { trades: Trade[]; fmtView: (n: number) => string }) {
  const [selected, setSelected] = useState<string | null>(null)

  const systems = useMemo(() => {
    const m: Record<string, { trades: number; wins: number; r: number; pnl: number; equityPts: number[] }> = {}
    // Sort trades by date first so sparkline is chronological
    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
    for (const t of sorted) {
      const key = t.setupLabel || 'Untagged'
      if (!m[key]) m[key] = { trades: 0, wins: 0, r: 0, pnl: 0, equityPts: [0] }
      const pnl = t.netPnl ?? t.realizedPnl ?? 0
      m[key].trades++
      if (pnl > 0) m[key].wins++
      m[key].r   += t.rrRatio ?? 0
      m[key].pnl += pnl
      m[key].equityPts.push(+(m[key].pnl).toFixed(2))
    }
    return Object.entries(m)
      .sort(([, a], [, b]) => b.trades - a.trades)
      .map(([name, v]) => ({
        name, ...v,
        winRate: v.trades ? v.wins / v.trades * 100 : 0,
        ev:      v.trades ? v.r / v.trades : 0,
      }))
  }, [trades])

  // Aggregate (all trades) — used by the '__ALL__' card
  const allEquityPts = useMemo(() => {
    let cum = 0
    return [0, ...[...trades]
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
      .map(t => { cum += t.netPnl ?? t.realizedPnl ?? 0; return +cum.toFixed(2) })]
  }, [trades])

  const allStats = useMemo(() => {
    const pnls  = trades.map(t => t.netPnl ?? t.realizedPnl ?? 0)
    const wins  = pnls.filter(p => p > 0)
    const rs    = trades.map(t => t.rrRatio ?? 0)
    const winRs = trades.filter(t => (t.netPnl ?? t.realizedPnl ?? 0) > 0).map(t => t.rrRatio ?? 0)
    const lossRs= trades.filter(t => (t.netPnl ?? t.realizedPnl ?? 0) < 0).map(t => t.rrRatio ?? 0)
    const winRate = trades.length ? wins.length / trades.length : 0
    const avgWinR  = winRs.length  ? winRs.reduce((s,r)=>s+r,0)/winRs.length   : 0
    const avgLossR = lossRs.length ? lossRs.reduce((s,r)=>s+r,0)/lossRs.length : 0
    const ev = winRate * avgWinR + (1 - winRate) * avgLossR
    const totalR = rs.reduce((s,r)=>s+r,0)
    const totalPnl = pnls.reduce((s,p)=>s+p,0)
    const bestR = rs.length ? Math.max(...rs) : 0
    const sorted = [...trades].sort((a,b)=>a.date.localeCompare(b.date))
    let cum = 0
    const equity = sorted.map(t => { cum += t.netPnl ?? t.realizedPnl ?? 0; return { date: t.date.slice(5), pnl: +cum.toFixed(2) } })
    return {
      total: trades.length, wins: wins.length, losses: trades.length - wins.length,
      winRate, avgWinR, avgLossR, ev, totalR, totalPnl, bestR, equity,
    }
  }, [trades])

  const detail = useMemo(() => {
    if (!selected) return null
    if (selected === '__ALL__') return allStats
    const ts = trades.filter(t => (t.setupLabel || 'Untagged') === selected)
    const pnls = ts.map(t => t.netPnl ?? t.realizedPnl ?? 0)
    const wins = pnls.filter(p => p > 0)
    const rs = ts.map(t => t.rrRatio ?? 0)
    const winRs = ts.filter(t => (t.netPnl ?? t.realizedPnl ?? 0) > 0).map(t => t.rrRatio ?? 0)
    const lossRs = ts.filter(t => (t.netPnl ?? t.realizedPnl ?? 0) < 0).map(t => t.rrRatio ?? 0)
    const totalR = rs.reduce((s, r) => s + r, 0)
    const winRate = ts.length ? wins.length / ts.length : 0
    const avgWinR = winRs.length ? winRs.reduce((s, r) => s + r, 0) / winRs.length : 0
    const avgLossR = lossRs.length ? lossRs.reduce((s, r) => s + r, 0) / lossRs.length : 0
    const ev = winRate * avgWinR + (1 - winRate) * avgLossR
    const totalPnl = pnls.reduce((s, p) => s + p, 0)
    const bestR = rs.length ? Math.max(...rs) : 0
    const sorted = [...ts].sort((a, b) => a.date.localeCompare(b.date))
    let cum = 0
    const equity = sorted.map(t => {
      cum += t.netPnl ?? t.realizedPnl ?? 0
      return { date: t.date.slice(5), pnl: +cum.toFixed(2) }
    })
    return { total: ts.length, wins: wins.length, losses: ts.length - wins.length, winRate, avgWinR, avgLossR, ev, totalR, totalPnl, bestR, equity }
  }, [selected, trades, allStats])

  if (selected && detail) {
    // ── Drill-in view ───────────────────────────────────────────────────────
    return (
      <div>
        <button onClick={() => setSelected(null)}
          className="flex items-center gap-1.5 text-xs mb-4 transition-colors"
          style={{ color: 'var(--c-text-3)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--c-accent)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--c-text-3)' }}>
          ← All Systems
        </button>
        <div className="mb-4">
          <h3 className="text-base font-bold" style={{ color: 'var(--c-text-1)' }}>
            {selected === '__ALL__' ? 'All Systems' : selected}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>{detail.total} trades · {detail.wins}W {detail.losses}L</p>
        </div>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <KpiCard label="Win Rate"   value={`${(detail.winRate * 100).toFixed(0)}%`} color={detail.winRate >= 0.5 ? C.profit : C.loss} />
          <KpiCard label="EV / trade" value={fmtR(detail.ev)}      color={rColor(detail.ev)} />
          <KpiCard label="Net R"      value={fmtR(detail.totalR)}  color={rColor(detail.totalR)} />
          <KpiCard label="Total P&L"  value={fmtView(detail.totalPnl)} color={detail.totalPnl >= 0 ? C.profit : C.loss} />
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <KpiCard label="Avg Win R"  value={fmtR(detail.avgWinR)}  color={C.profit} />
          <KpiCard label="Avg Loss R" value={fmtR(detail.avgLossR)} color={C.loss} />
          <KpiCard label="Best Trade" value={fmtR(detail.bestR)}    color={C.profit} />
        </div>
        {detail.equity.length > 1 && (
          <Card className="p-4">
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--c-text-3)' }}>Equity — {selected}</div>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={detail.equity}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false}
                    tickFormatter={v => `$${Math.abs(v) >= 1000 ? (v/1000).toFixed(1)+'k' : v}`} />
                  <Tooltip content={(p: any) => <PnlTip {...p} fmt={fmtView} />} />
                  <Line type="monotone" dataKey="pnl" stroke={C.blue} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </div>
    )
  }

  // ── All-systems card grid ─────────────────────────────────────────────────
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>

      {/* Aggregate "All Systems" card */}
      {(() => {
        const evColor = rColor(allStats.ev)
        const wrColor = allStats.winRate >= 0.5 ? C.profit : C.loss
        return (
          <button type="button" onClick={() => setSelected('__ALL__')}
            className="text-left rounded-xl p-4 transition-all col-span-1"
            style={{ background: 'var(--c-bg-card)', border: '2px solid var(--c-accent)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}>
            <div className="text-xs font-bold mb-1 uppercase tracking-widest" style={{ color: 'var(--c-accent)' }}>All Systems</div>
            <div className="text-[10px] mb-3" style={{ color: 'var(--c-text-3)' }}>{allStats.total} trades</div>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--c-text-3)' }}>EV</div>
                <div className="text-lg font-bold num" style={{ color: evColor }}>{allStats.ev >= 0 ? '+' : ''}{allStats.ev.toFixed(2)}R</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--c-text-3)' }}>Win%</div>
                <div className="text-sm font-bold num" style={{ color: wrColor }}>{(allStats.winRate * 100).toFixed(0)}%</div>
                <div className="text-[10px] num mt-0.5" style={{ color: 'var(--c-text-3)' }}>{allStats.wins}W · {allStats.losses}L</div>
              </div>
            </div>
            <div className="mt-3 -mx-1">
              <Sparkline points={allEquityPts} color={evColor} />
            </div>
          </button>
        )
      })()}

      {systems.map(s => {
        const evColor = rColor(s.ev)
        const wrColor = s.winRate >= 50 ? C.profit : C.loss
        return (
          <button key={s.name} type="button" onClick={() => setSelected(s.name)}
            className="text-left rounded-xl p-4 transition-all group"
            style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(99,102,241,0.4)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--c-border)' }}>
            {/* Name */}
            <div className="text-xs font-semibold mb-3 leading-snug" style={{ color: 'var(--c-text-1)' }}
              title={s.name}>
              {s.name.length > 28 ? s.name.slice(0, 26) + '…' : s.name}
            </div>
            {/* 3 key numbers */}
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--c-text-3)' }}>EV</div>
                <div className="text-lg font-bold num" style={{ color: evColor }}>{s.ev >= 0 ? '+' : ''}{s.ev.toFixed(2)}R</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--c-text-3)' }}>Win%</div>
                <div className="text-sm font-bold num" style={{ color: wrColor }}>{s.winRate.toFixed(0)}%</div>
                <div className="text-[10px] num mt-0.5" style={{ color: 'var(--c-text-3)' }}>{s.trades} trades</div>
              </div>
            </div>
            {/* Mini equity sparkline */}
            <div className="mt-3 -mx-1">
              <Sparkline points={s.equityPts} color={evColor} />
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
interface Props { accountId?: number | null }

export function TradingAnalytics({ accountId }: Props) {
  const { fmtView } = useFmtView('USD', 'trading')
  const params: Record<string, string> = accountId ? { accountId: String(accountId) } : {}
  const { data: trades = [], isPending } = useTrades(params)

  // ── Date filter ─────────────────────────────────────────────────────────────
  const [preset, setPreset]         = useState<Preset>('All')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')

  const filteredTrades = useMemo(
    () => applyDateFilter(trades, preset, customFrom, customTo),
    [trades, preset, customFrom, customTo],
  )

  // Compute mistakes directly from filtered trades
  const mistakes = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of filteredTrades) {
      for (const key of t.mistakes ?? []) m[key] = (m[key] ?? 0) + 1
    }
    return Object.entries(m)
      .map(([mistake, count]) => ({ mistake, count, label: fmtMistake(mistake) }))
      .sort((a, b) => b.count - a.count)
  }, [filteredTrades])

  // ── Available years derived from actual data ──────────────────────────────
  const availableYears = useMemo(() =>
    [...new Set(filteredTrades.map(t => Number(t.date.slice(0, 4))))].sort().reverse()
  , [filteredTrades])

  const [annualYear, setAnnualYear] = useState<number | null>(null)
  const displayYear = annualYear ?? availableYears[0] ?? new Date().getFullYear()
  const prevYear = useCallback(() => setAnnualYear(y => (y ?? displayYear) - 1), [displayYear])
  const nextYear = useCallback(() => setAnnualYear(y => (y ?? displayYear) + 1), [displayYear])
  const hasDataInYear = (y: number) => availableYears.includes(y)

  // ── Core stats ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => computeStats(filteredTrades), [filteredTrades])

  // ── Equity curve ─────────────────────────────────────────────────────────────
  const equity = useMemo(() => {
    let cum = 0
    return [...filteredTrades]
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
      .map(t => { cum += t.netPnl ?? t.realizedPnl ?? 0; return { date: t.date.slice(5), pnl: +cum.toFixed(2) } })
  }, [filteredTrades])

  // ── Day of week ───────────────────────────────────────────────────────────────
  const dow = useMemo(() => {
    const d: Record<number, { trades: number; wins: number; r: number }> = {}
    for (const t of filteredTrades) {
      const day = new Date(t.date + 'T12:00:00').getDay()
      if (!d[day]) d[day] = { trades: 0, wins: 0, r: 0 }
      d[day].trades++
      const pnl = t.netPnl ?? t.realizedPnl ?? 0
      if (pnl > 0) d[day].wins++
      d[day].r += t.rrRatio ?? 0
    }
    return DAYS.map((name, i) => ({
      day: name, trades: d[i]?.trades ?? 0, wins: d[i]?.wins ?? 0,
      losses: (d[i]?.trades ?? 0) - (d[i]?.wins ?? 0), r: d[i]?.r ?? 0,
    }))
  }, [filteredTrades])

  // ── Annual/monthly breakdown ──────────────────────────────────────────────────
  const monthly = useMemo(() => {
    const m: Record<string, { trades: number; wins: number; pnl: number; r: number }> = {}
    for (const t of filteredTrades) {
      const key = t.date.slice(0, 7)
      if (!m[key]) m[key] = { trades: 0, wins: 0, pnl: 0, r: 0 }
      m[key].trades++
      const pnl = t.netPnl ?? t.realizedPnl ?? 0
      if (pnl > 0) m[key].wins++
      m[key].pnl += pnl
      m[key].r   += t.rrRatio ?? 0
    }
    return m
  }, [filteredTrades])

  const annual = useMemo(() =>
    MONTHS.map((name, i) => {
      const key   = `${displayYear}-${String(i + 1).padStart(2, '0')}`
      const found = monthly[key]
      const wins = found?.wins ?? 0
      const t    = found?.trades ?? 0
      return { month: name, trades: t, wins, losses: t - wins, pnl: found?.pnl ?? 0, r: found?.r ?? 0 }
    })
  , [monthly, displayYear])

  const annualTotals = useMemo(() => ({
    trades: annual.reduce((s, m) => s + m.trades, 0),
    wins:   annual.reduce((s, m) => s + m.wins, 0),
    losses: annual.reduce((s, m) => s + m.losses, 0),
    pnl:    annual.reduce((s, m) => s + m.pnl, 0),
    r:      annual.reduce((s, m) => s + m.r, 0),
  }), [annual])

  // ── Instrument ────────────────────────────────────────────────────────────────
  const byInstrument = useMemo(() => {
    const m: Record<string, { pnl: number; trades: number }> = {}
    for (const t of filteredTrades) {
      if (!m[t.instrument]) m[t.instrument] = { pnl: 0, trades: 0 }
      m[t.instrument].pnl += t.netPnl ?? t.realizedPnl ?? 0
      m[t.instrument].trades++
    }
    return Object.entries(m).map(([name, v]) => ({ name, ...v }))
  }, [filteredTrades])

  if (isPending) return <PageLoader />

  const selectStyle: React.CSSProperties = { background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }

  return (
    <div className="space-y-8">

      {/* ── Date filter bar ──────────────────────────────────────────── */}
      <div className="mb-6">
        <DateFilter
          preset={preset}         onPreset={setPreset}
          customFrom={customFrom} onCustomFrom={setCustomFrom}
          customTo={customTo}     onCustomTo={setCustomTo}
        />
      </div>

      {!stats && (
        <div className="text-center py-20" style={{ color: 'var(--c-text-3)' }}>
          No trades in the selected period.
        </div>
      )}

      {stats && <>

      {/* ── 1. KPI Overview ───────────────────────────────────────────── */}
      <Sect label="Performance Overview">
        <div className="grid grid-cols-4 gap-3 mb-3">
          <KpiCard label="Total Trades" value={stats.total}
            sub={`${stats.wins} wins · ${stats.losses} losses`} />
          <KpiCard label="Win Rate" value={`${(stats.winRate * 100).toFixed(1)}%`}
            color={stats.winRate >= 0.5 ? C.profit : C.loss}
            sub={`Loss rate ${(100 - stats.winRate * 100).toFixed(1)}%`} />
          <KpiCard label="Total P&L" value={fmtView(stats.totalPnl)}
            color={stats.totalPnl >= 0 ? C.profit : C.loss} />
          <KpiCard label="Total R" value={fmtR(stats.totalR)}
            color={rColor(stats.totalR)} />
        </div>
        <div className="grid grid-cols-5 gap-3">
          <KpiCard label="EV (per trade)" value={fmtR(stats.ev)}
            color={rColor(stats.ev)} sub="winR×avgWin + lossR×avgLoss" />
          <KpiCard label="Avg Win R"    value={fmtR(stats.avgWinR)}  color={C.profit} />
          <KpiCard label="Avg Loss R"   value={fmtR(stats.avgLossR)} color={C.loss} />
          <KpiCard label="Best Trade"   value={fmtR(stats.bestR)}    color={C.profit} />
          <KpiCard label="Max Drawdown" value={fmtView(stats.maxDD)} color={C.loss} />
        </div>
      </Sect>

      {/* ── 2. Equity Curve ───────────────────────────────────────────── */}
      <Sect label="Equity Curve">
        <Card className="p-4">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={equity}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={false}
                  tickFormatter={v => `$${Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v}`} />
                <Tooltip content={(p: any) => <PnlTip {...p} fmt={fmtView} />} />
                <Line type="monotone" dataKey="pnl" stroke={C.blue} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </Sect>

      {/* ── 3. Win/Loss + Long/Short ──────────────────────────────────── */}
      <Sect label="Distribution">
        <div className="grid grid-cols-2 gap-4">
          {[
            { title: 'Win / Loss', data: [{ name: 'Win', value: stats.wins }, { name: 'Loss', value: stats.losses }] },
            { title: 'Long / Short', data: [{ name: 'Long', value: stats.longs }, { name: 'Short', value: stats.shorts }] },
          ].map(({ title, data }) => {
            const tot = data.reduce((s, d) => s + d.value, 0)
            return (
              <Card key={title} className="p-4 flex gap-4 items-center">
                <div style={{ width: 120, height: 120, flexShrink: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={data} cx="50%" cy="50%" outerRadius={52} innerRadius={28} dataKey="value" paddingAngle={3}>
                        <Cell fill={C.profit} />
                        <Cell fill={C.loss} />
                      </Pie>
                      <Tooltip contentStyle={ttStyle} labelStyle={ttLabel}
                        formatter={(v: any, name: any) => [`${v} (${tot ? (v/tot*100).toFixed(1) : 0}%)`, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold mb-3" style={{ color: 'var(--c-text-2)' }}>{title}</div>
                  {data.map((d, i) => (
                    <div key={d.name} className="flex items-center justify-between py-1.5"
                      style={{ borderBottom: i < data.length - 1 ? '1px solid var(--c-border)' : undefined }}>
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ background: i === 0 ? C.profit : C.loss }} />
                        <span className="text-sm" style={{ color: 'var(--c-text-2)' }}>{d.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold num" style={{ color: i === 0 ? C.profit : C.loss }}>{d.value}</span>
                        <span className="text-xs ml-1.5" style={{ color: 'var(--c-text-3)' }}>({tot ? (d.value/tot*100).toFixed(1) : 0}%)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )
          })}
        </div>
      </Sect>

      {/* ── 4. Day of Week ───────────────────────────────────────────── */}
      <Sect label="By Day of Week">
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-6">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dow} barSize={14} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={ttStyle} cursor={barCursor} labelStyle={ttLabel} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="wins"   name="Wins"   stackId="a" fill={C.profit} radius={[2,2,0,0]} />
                  <Bar dataKey="losses" name="Losses" stackId="a" fill={C.loss}   radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="w-full text-xs self-start">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                  {['Day','T','W','L','Win%','Net R'].map(h => (
                    <th key={h} className="pb-2 text-center font-semibold uppercase"
                      style={{ color: 'var(--c-text-3)', fontSize: 9 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dow.map(d => (
                  <tr key={d.day} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: d.trades === 0 ? 0.35 : 1 }}>
                    <td className="py-1.5 text-center font-medium" style={{ color: 'var(--c-text-2)' }}>{d.day}</td>
                    <td className="py-1.5 num text-center" style={{ color: 'var(--c-text-3)' }}>{d.trades || '—'}</td>
                    <td className="py-1.5 num text-center" style={{ color: C.profit }}>{d.wins || '—'}</td>
                    <td className="py-1.5 num text-center" style={{ color: C.loss }}>{d.losses || '—'}</td>
                    <td className="py-1.5 num text-center" style={{ color: d.trades ? (d.wins/d.trades >= 0.5 ? C.profit : C.loss) : 'var(--c-text-3)' }}>
                      {d.trades ? `${(d.wins/d.trades*100).toFixed(0)}%` : '—'}
                    </td>
                    <td className="py-1.5 num text-center" style={{ color: rColor(d.r) }}>
                      {d.trades ? fmtR(d.r) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Sect>

      {/* ── 5. System Performance ────────────────────────────────────── */}
      <Sect label="System Performance">
        <SystemPerformance trades={filteredTrades} fmtView={fmtView} />
      </Sect>

      {/* ── 6. Annual Performance ─────────────────────────────────────── */}
      <Sect label="Annual Performance" action={
        <div className="flex items-center gap-2">
          <button onClick={prevYear}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
            <ChevronLeft size={14} />
          </button>
          <span className="text-sm font-bold num min-w-[44px] text-center"
            style={{ color: hasDataInYear(displayYear) ? 'var(--c-text-1)' : 'var(--c-text-3)' }}>
            {displayYear}
          </span>
          <button onClick={nextYear}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
            <ChevronRight size={14} />
          </button>
        </div>
      }>
        <Card className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                  {['Month','Trades','Wins','Losses','Win%','P&L','Net R'].map(h => (
                    <th key={h} className="pb-2.5 text-center font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--c-text-3)', fontSize: 10 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {annual.map(m => {
                  const wr = m.trades ? m.wins / m.trades : 0
                  return (
                    <tr key={m.month} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: m.trades === 0 ? 0.4 : 1 }}>
                      <td className="py-2 text-center font-semibold" style={{ color: 'var(--c-text-2)' }}>{m.month}</td>
                      <td className="py-2 num text-center" style={{ color: 'var(--c-text-2)' }}>{m.trades || '—'}</td>
                      <td className="py-2 num text-center" style={{ color: C.profit }}>{m.wins || '—'}</td>
                      <td className="py-2 num text-center" style={{ color: C.loss }}>{m.losses || '—'}</td>
                      <td className="py-2 num text-center" style={{ color: m.trades ? (wr >= 0.5 ? C.profit : C.loss) : 'var(--c-text-3)' }}>
                        {m.trades ? `${(wr * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className="py-2 num text-center">
                        {m.pnl !== 0 ? (
                          <span style={{ ...pnlCellBg(m.pnl), padding: '2px 8px', borderRadius: 6, display: 'inline-block' }}>
                            {fmtView(m.pnl)}
                          </span>
                        ) : <span style={{ color: 'var(--c-text-3)' }}>—</span>}
                      </td>
                      <td className="py-2 num text-center" style={{ color: m.r !== 0 ? rColor(m.r) : 'var(--c-text-3)' }}>
                        {m.r !== 0 ? fmtR(m.r) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--c-border)' }}>
                  <td className="py-2.5 text-center font-bold" style={{ color: 'var(--c-text-1)' }}>YTD {displayYear}</td>
                  <td className="py-2.5 num text-center font-bold" style={{ color: 'var(--c-text-1)' }}>{annualTotals.trades || '—'}</td>
                  <td className="py-2.5 num text-center font-bold" style={{ color: C.profit }}>{annualTotals.wins || '—'}</td>
                  <td className="py-2.5 num text-center font-bold" style={{ color: C.loss }}>{annualTotals.losses || '—'}</td>
                  <td />
                  <td className="py-2.5 num text-center font-bold" style={{ color: annualTotals.pnl >= 0 ? C.profit : C.loss }}>
                    {fmtView(annualTotals.pnl)}
                  </td>
                  <td className="py-2.5 num text-center font-bold" style={{ color: rColor(annualTotals.r) }}>
                    {fmtR(annualTotals.r)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </Sect>

      {/* ── 7. Calendar Heatmap ──────────────────────────────────────── */}
      <Sect label="Calendar">
        <CalendarHeatmap trades={filteredTrades} />
      </Sect>

      {/* ── 8. Diagnostics ───────────────────────────────────────────── */}
      <Sect label="Diagnostics">
        <div className="grid grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--c-text-2)' }}>P&L by Instrument</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byInstrument} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: C.muted }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false}
                    tickFormatter={v => `$${Math.abs(v) >= 1000 ? (v/1000).toFixed(0)+'k' : v}`} />
                  <Tooltip content={(p: any) => <PnlTip {...p} fmt={fmtView} />} cursor={barCursor} />
                  <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                    {byInstrument.map((v, i) => <Cell key={i} fill={v.pnl >= 0 ? C.profit : C.loss} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--c-text-2)' }}>Top Mistakes</h3>
            {mistakes.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-text-muted text-sm">No mistakes logged</div>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={mistakes.slice(0, 7)} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} width={110} />
                    <Tooltip contentStyle={ttStyle} cursor={barCursor} labelStyle={ttLabel} />
                    <Bar dataKey="count" fill={C.loss} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>
      </Sect>

      </>}

    </div>
  )
}
