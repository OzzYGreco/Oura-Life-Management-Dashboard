import { useMemo } from 'react'
import { useTrades } from '../../hooks/useTrades'
import { useTradingAccounts } from '../../hooks/useTradingAccounts'
import { LimitBanner, LimitMeters, useAccountLimits } from './LossLimits'
import { useFmtView } from '../../hooks/useFmtView'
import { MAX_DEVIATION_PCT } from '../../components/shared/PnLBadge'
import { byTime, fmtR, isClosed, outcomeOf, pnlOf, sum } from '../../lib/tradeStats'
import { FormGuide, useCountUp } from './ui'
import { AccountTile, SessionTimeline } from './PulseParts'
import { ClipboardCheck, ShieldCheck, ShieldAlert, Flame, Snowflake } from 'lucide-react'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Monday of this week, UTC, as YYYY-MM-DD. */
function weekStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d
}

/**
 * The top of the trading page: how this week is going at a glance. Net R
 * with a bar per day, the last ten results, the current streak, whether the
 * 10% rule held, and what's waiting to be reviewed.
 */
export function TradingPulse({ accountId, onReview, onSetLimits }: { accountId: number | null; onReview: () => void; onSetLimits: () => void }) {
  const { fmtView } = useFmtView('USD', 'trading')
  const { data: trades = [] } = useTrades(accountId ? { accountId: String(accountId) } : {})
  const { data: accounts = [] } = useTradingAccounts()
  const { limits, now } = useAccountLimits(accounts, trades, accountId)

  const w = useMemo(() => {
    const closed = trades.filter(isClosed).sort(byTime)
    const mon = weekStart()
    const days = DAYS.map((name, i) => {
      const d = new Date(mon); d.setUTCDate(mon.getUTCDate() + i)
      const key = d.toISOString().slice(0, 10)
      const ts = closed.filter(t => t.date === key)
      return { name, key, n: ts.length, r: sum(ts.filter(t => t.rrRatio != null).map(t => t.rrRatio!)) }
    })
    const week = closed.filter(t => t.date >= days[0].key)
    const outcomes = week.map(outcomeOf)

    // Streak: same result in a row, newest first; scratches don't break or add.
    const decided = closed.map(outcomeOf).filter(o => o !== 'be')
    const lastO = decided[decided.length - 1]
    let streak = 0
    for (let i = decided.length - 1; i >= 0 && decided[i] === lastO; i--) streak++

    return {
      days, closed,
      today: new Date().toISOString().slice(0, 10),
      n: week.length,
      wins: outcomes.filter(o => o === 'win').length,
      losses: outcomes.filter(o => o === 'loss').length,
      be: outcomes.filter(o => o === 'be').length,
      r: sum(week.filter(t => t.rrRatio != null).map(t => t.rrRatio!)),
      pnl: sum(week.map(t => pnlOf(t) ?? 0)),
      breaks: week.filter(t => (t.deviationPct ?? 0) > MAX_DEVIATION_PCT).length,
      toReview: closed.filter(t => !t.reviewedAt).length,
      streak, streakKind: lastO,
    }
  }, [trades])

  const r = useCountUp(w.r)
  const maxAbs = Math.max(1, ...w.days.map(d => Math.abs(d.r)))
  const tone = w.r > 0.05 ? 'var(--c-profit)' : w.r < -0.05 ? 'var(--c-loss)' : 'var(--c-text-1)'
  const glow = w.r > 0.05 ? 'rgba(52,211,153,0.10)' : w.r < -0.05 ? 'rgba(248,113,113,0.09)' : 'rgba(129,140,248,0.08)'

  return (
    <div className="relative overflow-hidden rounded-2xl mb-5"
      style={{ background: `radial-gradient(120% 140% at 0% 0%, ${glow}, transparent 55%), linear-gradient(180deg, var(--c-bg-elevated), var(--c-bg-card))`, border: '1px solid var(--c-border)', boxShadow: 'var(--c-shadow-card)' }}>
      <LimitBanner limits={limits} now={now} />
      <div className="grid md:grid-cols-2 xl:grid-cols-[1.25fr_1.35fr_0.9fr_1fr]">
        <AccountTile accounts={accounts} trades={trades} accountId={accountId} />


        {/* This week: net R and a bar per day */}
        <div className="p-5 flex items-end gap-6 border-t md:border-t-0 md:border-l" style={{ borderColor: 'var(--c-border)' }}>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--c-text-3)' }}>This week</div>
            <div className="mt-1.5 text-4xl font-bold num leading-none tracking-tight" style={{ color: tone }}>
              {w.n ? fmtR(r, 1) : '—'}
            </div>
            <div className="mt-2 text-xs num whitespace-nowrap" style={{ color: 'var(--c-text-2)' }}>
              {w.n ? <>{fmtView(w.pnl)} · {w.n} {w.n === 1 ? 'trade' : 'trades'}</> : 'No closed trades yet'}
            </div>
          </div>
          <div className="flex items-end gap-2 h-20 ml-auto">
            {w.days.map(d => {
              const h = d.n ? Math.max(8, (Math.abs(d.r) / maxAbs) * 100) : 6
              const isToday = d.key === w.today
              return (
                <div key={d.key} className="h-full flex flex-col items-center gap-1" title={d.n ? `${d.name}: ${fmtR(d.r)} over ${d.n} trades` : `${d.name}: no trades`}>
                  <div className="w-5 flex-1 flex items-end">
                    <div className="w-full rounded-[4px] transition-all duration-700" style={{
                      height: `${h}%`,
                      background: !d.n ? 'var(--c-bg-input)' : d.r >= 0 ? 'linear-gradient(180deg, var(--c-profit), rgba(52,211,153,0.35))' : 'linear-gradient(0deg, var(--c-loss), rgba(248,113,113,0.35))',
                      boxShadow: isToday ? '0 0 0 1.5px var(--c-accent)' : undefined,
                    }} />
                  </div>
                  <span className="text-[9px] font-medium" style={{ color: isToday ? 'var(--c-accent)' : 'var(--c-text-3)' }}>{d.name[0]}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Form */}
        <Tile label="Last 10 trades">
          <FormGuide trades={w.closed} />
          <div className="mt-2.5 flex items-center gap-1.5 text-xs" style={{ color: 'var(--c-text-2)' }}>
            {w.streakKind === 'win'
              ? <><Flame size={13} style={{ color: '#fb923c' }} /> {w.streak} {w.streak === 1 ? 'win' : 'wins'} in a row</>
              : w.streakKind === 'loss'
                ? <><Snowflake size={13} style={{ color: '#7dd3fc' }} /> {w.streak} {w.streak === 1 ? 'loss' : 'losses'} in a row{w.streak >= 3 ? ', slow down' : ''}</>
                : 'No streak yet'}
          </div>
        </Tile>

        {/* Discipline and journal */}
        <Tile label="Discipline">
          <div className="flex items-center gap-2">
            {w.breaks === 0
              ? <ShieldCheck size={18} style={{ color: 'var(--c-profit)' }} />
              : <ShieldAlert size={18} style={{ color: 'var(--c-loss)' }} />}
            <span className="text-sm font-semibold" style={{ color: 'var(--c-text-1)' }}>
              {w.breaks === 0 ? '10% rule held this week' : `${w.breaks} rule ${w.breaks === 1 ? 'break' : 'breaks'} this week`}
            </span>
          </div>
          <div className="mt-1 ml-[26px] text-[11px] num" style={{ color: 'var(--c-text-3)' }}>{w.n ? `${w.wins} W · ${w.losses} L · ${w.be} BE` : 'no trades yet'}</div>
          {w.toReview ? (
            <button onClick={onReview} className="group mt-3 flex items-center gap-2 text-left">
              <ClipboardCheck size={18} style={{ color: 'var(--c-accent)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--c-text-1)' }}>{w.toReview} to review</span>
              <span className="text-xs group-hover:underline" style={{ color: 'var(--c-accent)' }}>Review now →</span>
            </button>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <ClipboardCheck size={18} style={{ color: 'var(--c-profit)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--c-text-1)' }}>Journal up to date</span>
            </div>
          )}
        </Tile>
      </div>
      <SessionTimeline trades={trades} now={now} />
      <LimitMeters limits={limits} now={now} onSetLimits={onSetLimits} />
    </div>
  )
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-5 border-t xl:border-t-0 md:border-l" style={{ borderColor: 'var(--c-border)' }}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] mb-2.5" style={{ color: 'var(--c-text-3)' }}>{label}</div>
      {children}
    </div>
  )
}
