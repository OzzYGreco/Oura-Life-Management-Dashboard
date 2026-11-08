import { useEffect, useState } from 'react'
import type { Trade } from '../../hooks/useTrades'
import type { TradingAccount } from '../../hooks/useTradingAccounts'
import { accountLimits, fmtLimit, untilText, STATE_COLOR, type AccountLimits, type PeriodUse } from '../../lib/lossLimits'
import { OctagonX, TriangleAlert, Gauge } from 'lucide-react'

/** Re-renders every minute so "resets in" and the period boundaries stay current. */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t) }, [])
  return now
}

export function useAccountLimits(accounts: TradingAccount[], trades: Trade[], accountId: number | null) {
  const now = useNow()
  const scope = accountId ? accounts.filter(a => a.id === accountId) : accounts
  return { now, limits: scope.map(a => accountLimits(a, trades, now)).filter(Boolean) as AccountLimits[] }
}

/** The loudest message across accounts: a limit hit, or less than one full loss left. */
export function LimitBanner({ limits, now }: { limits: AccountLimits[]; now: Date }) {
  const order = { day: 0, week: 1, month: 2 }
  const all = limits.flatMap(l => l.periods.map(p => ({ l, p }))).sort((a, b) => order[a.p.period] - order[b.p.period])
  const hit = all.find(x => x.p.state === 'hit')
  const edge = !hit && all.find(x => x.p.fullLossesLeft === 0)
  if (!hit && !edge) return null
  const { l, p } = (hit || edge)!
  const name = limits.length > 1 || hit ? ` on ${l.account.name}` : ''
  const when = p.period === 'day' ? 'today' : p.period === 'week' ? 'this week' : 'this month'
  return (
    <div className="flex items-center gap-3 px-5 py-3 text-sm"
      style={hit
        ? { background: 'linear-gradient(90deg, rgba(248,113,113,0.22), rgba(248,113,113,0.06))', borderBottom: '1px solid rgba(248,113,113,0.35)', color: 'var(--c-text-1)' }
        : { background: 'linear-gradient(90deg, rgba(245,158,11,0.18), rgba(245,158,11,0.04))', borderBottom: '1px solid rgba(245,158,11,0.3)', color: 'var(--c-text-1)' }}>
      {hit ? <OctagonX size={18} style={{ color: 'var(--c-loss)' }} /> : <TriangleAlert size={18} style={{ color: '#f59e0b' }} />}
      {hit
        ? <span><b>{p.label === 'Today' ? 'Daily' : p.period === 'week' ? 'Weekly' : 'Monthly'} loss limit hit{name}</b>: down {fmtLimit(p.used, l.unit)} of {fmtLimit(p.limit, l.unit)}. You're done trading {when}.</span>
        : <span><b>Less than one full loss left {when}{name}</b>: {fmtLimit(p.limit - p.used, l.unit)} of {fmtLimit(p.limit, l.unit)} remaining. A full 1R stop-out would break the limit.</span>}
      <span className="ml-auto text-xs num whitespace-nowrap" style={{ color: 'var(--c-text-2)' }}>resets in {untilText(p.resetsAt, now)}</span>
    </div>
  )
}

export function LimitMeters({ limits, now, onSetLimits }: { limits: AccountLimits[]; now: Date; onSetLimits: () => void }) {
  if (!limits.length) {
    return (
      <div className="flex items-center gap-2 px-5 py-2.5 text-xs" style={{ borderTop: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}>
        <Gauge size={13} />
        No loss limits set.
        <button onClick={onSetLimits} className="hover:underline" style={{ color: 'var(--c-accent)' }}>Set daily, weekly and monthly limits →</button>
      </div>
    )
  }
  return (
    <div style={{ borderTop: '1px solid var(--c-border)' }}>
      {limits.map(l => (
        <div key={l.account.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3.5">
          <button onClick={onSetLimits} className="w-36 shrink-0 text-left hover:opacity-80" title="Change limits">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--c-text-3)' }}><Gauge size={12} /> Loss limits</span>
            {limits.length > 1 && <span className="block mt-0.5 text-sm font-medium truncate" style={{ color: 'var(--c-text-1)' }}>{l.account.name}</span>}
          </button>
          {l.periods.map(p => <Meter key={p.period} p={p} unit={l.unit} now={now} />)}
        </div>
      ))}
    </div>
  )
}

function Meter({ p, unit, now }: { p: PeriodUse; unit: 'R' | 'USD'; now: Date }) {
  const color = STATE_COLOR[p.state]
  const fill = Math.min(1, p.pct) * 100
  const risk = Math.min(100 - fill, (p.atRisk / p.limit) * 100)
  const up = p.net > 0
  return (
    <div className="flex-1 min-w-[200px]">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs font-medium" style={{ color: 'var(--c-text-2)' }}>{p.label}</span>
        <span className="text-xs num" style={{ color: 'var(--c-text-3)' }}>
          {up
            ? <span style={{ color: 'var(--c-profit)' }}>+{fmtLimit(p.net, unit)}</span>
            : <span style={{ color: p.used ? color : 'var(--c-text-2)' }}>{p.used > 0.005 ? '−' : ''}{fmtLimit(p.used, unit)}</span>}
          {' '}/ {fmtLimit(p.limit, unit)}
        </span>
      </div>
      <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'var(--c-bg-input)', boxShadow: 'inset 0 0 0 1px var(--c-border)' }}>
        <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
          style={{ width: `${fill}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${color} 55%, transparent), ${color})`, boxShadow: p.state !== 'ok' ? `0 0 10px ${color}` : undefined }} />
        {risk > 0 && (
          <div className="absolute inset-y-0" title={`Running trades could lose ${fmtLimit(p.atRisk, unit)} more at their stops`}
            style={{ left: `${fill}%`, width: `${risk}%`, background: `repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in srgb, ${color} 45%, transparent) 3px 6px)` }} />
        )}
      </div>
      <div className="mt-1.5 text-[11px] num" style={{ color: p.state === 'hit' ? 'var(--c-loss)' : 'var(--c-text-3)' }}>
        {p.state === 'hit'
          ? `Limit hit · resets in ${untilText(p.resetsAt, now)}`
          : p.fullLossesLeft != null
            ? `${p.fullLossesLeft === 0 ? 'Less than 1' : p.fullLossesLeft} full ${p.fullLossesLeft <= 1 ? 'loss' : 'losses'} left${p.atRisk > 0 ? ` · ${fmtLimit(p.atRisk, unit)} at risk now` : ''}`
            : `${fmtLimit(p.limit - p.used, unit)} left`}
      </div>
    </div>
  )
}
