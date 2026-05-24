import { useDashboardSummary } from '../../hooks/useDashboard'
import { PageShell } from '../../components/layout/PageShell'
import { PageLoader } from '../../components/ui/Spinner'
import { CurrencySelector } from '../../components/ui/CurrencySelector'
import { ConversionBanner } from '../../components/ui/ConversionBanner'
import { formatDate, pnlColor, today } from '../../lib/utils'
import { useFmtView } from '../../hooks/useFmtView'
import {
  TrendingUp, CheckSquare, Target, Briefcase,
  Dumbbell, Flame, CalendarDays, Clock, ArrowRight,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function NavLink({ label, to }: { label: string; to: string }) {
  const nav = useNavigate()
  return (
    <button onClick={() => nav(to)}
      className="flex items-center gap-1 text-[11px] font-medium transition-colors"
      style={{ color: 'var(--c-text-3)' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--c-accent)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--c-text-3)'}>
      {label} <ArrowRight size={10} />
    </button>
  )
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl ${className}`}
      style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--c-text-3)' }}>
      {children}
    </p>
  )
}

const tooltipStyle = {
  background: 'var(--c-chart-tooltip-bg)', border: '1px solid var(--c-border-mid)',
  borderRadius: 8, fontSize: 11,
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { data, isPending } = useDashboardSummary(today())
  const { fmtView } = useFmtView('USD', 'dashboard')
  const nav = useNavigate()

  if (isPending) return <PageShell title="Dashboard"><PageLoader /></PageShell>

  const d = data ?? {}

  // Derived values
  const pnl         = d.todayPnl   ?? 0
  const mtdPnl      = d.mtdPnl     ?? 0
  const checkTotal  = d.checklistProgress?.total ?? 0
  const checkDone   = d.checklistProgress?.completed ?? 0
  const checkPct    = checkTotal > 0 ? Math.round((checkDone / checkTotal) * 100) : null
  const pnlLast7    = (d.pnlLast7 ?? []) as { date: string; label: string; pnl: number }[]
  const todayTrades = (d.todayTradesDetail ?? []) as { id: number; asset: string; direction: string; realizedPnl?: number; rrRatio?: number; setupLabel?: string }[]

  // Today's date label
  const todayLabel  = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  // Checklist completion colour
  const checkColor  = checkPct == null ? 'var(--c-text-3)'
    : checkPct === 100 ? '#34d399'
    : checkPct >= 60   ? '#818cf8'
    : '#fbbf24'

  return (
    <PageShell title="Dashboard" action={<CurrencySelector pageKey="dashboard" defaultCurrency="USD" />}>
      <ConversionBanner native="USD" pageKey="dashboard" detail="Trading in USD · Business in GBP · Finance in EUR" />
      <div className="space-y-4">

        {/* ════════════════════════════════════════════════════════════════
            ZONE 1 — THE DAY  (most important — eyes land here first)
        ════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-5 gap-4">

          {/* ── TODAY: P&L + trades ───────────────────────────── 2 cols */}
          <Panel className="col-span-2 p-5 flex flex-col gap-4">
            {/* Date */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: 'var(--c-text-3)' }}>{todayLabel}</span>
              <NavLink label="Journal" to="/trading" />
            </div>

            {/* Big P&L */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--c-text-3)' }}>
                Today's P&L
              </p>
              <p className={`text-5xl font-black num leading-none ${pnl === 0 && todayTrades.length === 0 ? 'text-text-muted' : pnlColor(pnl)}`}>
                {todayTrades.length === 0 ? '--' : fmtView(pnl)}
              </p>
              <p className="text-xs mt-1.5" style={{ color: 'var(--c-text-3)' }}>
                {todayTrades.length === 0
                  ? 'No trades logged today'
                  : `${todayTrades.length} trade${todayTrades.length > 1 ? 's' : ''} today`}
              </p>
            </div>

            {/* Today's trade list */}
            {todayTrades.length > 0 ? (
              <div className="space-y-1.5">
                {todayTrades.map(t => (
                  <div key={t.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
                    style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
                    <span className="text-xs font-bold" style={{ color: 'var(--c-text-1)' }}>{t.asset}</span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{
                        background: t.direction === 'Long' ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
                        color: t.direction === 'Long' ? '#34d399' : '#f87171',
                      }}>
                      {t.direction}
                    </span>
                    {t.setupLabel && (
                      <span className="text-[11px] truncate flex-1" style={{ color: 'var(--c-text-3)' }}>{t.setupLabel}</span>
                    )}
                    <span className={`text-xs num font-bold ml-auto flex-shrink-0 ${pnlColor(t.realizedPnl ?? 0)}`}>
                      {t.realizedPnl != null
                        ? `${t.realizedPnl >= 0 ? '+' : ''}${fmtView(t.realizedPnl)}`
                        : '--'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <button onClick={() => nav('/trading')}
                className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all duration-150"
                style={{ border: '1px dashed var(--c-border-mid)', color: 'var(--c-text-3)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--c-accent)'; (e.currentTarget as HTMLElement).style.color = 'var(--c-accent)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--c-border-mid)'; (e.currentTarget as HTMLElement).style.color = 'var(--c-text-3)' }}>
                <TrendingUp size={13} /> Log a trade
              </button>
            )}
          </Panel>

          {/* ── PROCESS: Checklist ────────────────────────────── 3 cols */}
          <Panel className="col-span-3 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckSquare size={14} style={{ color: checkColor }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--c-text-1)' }}>Today's Checklist</span>
              </div>
              <div className="flex items-center gap-3">
                {checkPct != null && (
                  <span className="text-2xl font-black num" style={{ color: checkColor }}>
                    {checkPct}%
                  </span>
                )}
                <NavLink label="Checklists" to="/checklists" />
              </div>
            </div>

            {/* Progress bar */}
            {checkTotal > 0 && (
              <div className="h-1.5 rounded-full overflow-hidden mb-4" style={{ background: 'var(--c-bg-input)' }}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${checkPct}%`, background: checkColor }} />
              </div>
            )}

            {/* Items */}
            {(d.checklistItems ?? []).length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No checklist for today.</p>
                <button onClick={() => nav('/checklists')}
                  className="text-xs mt-1 hover:underline" style={{ color: 'var(--c-accent)' }}>
                  Set one up →
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                {(d.checklistItems as any[]).map((item: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 min-w-0">
                    <div className="w-4 h-4 rounded-md flex-shrink-0 flex items-center justify-center"
                      style={{
                        background: item.completed ? 'var(--c-profit)' : 'var(--c-bg-input)',
                        border: item.completed ? 'none' : '1px solid var(--c-border-strong)',
                      }}>
                      {item.completed && (
                        <svg width="9" height="9" viewBox="0 0 8 8">
                          <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                        </svg>
                      )}
                    </div>
                    <span className={`text-xs truncate ${item.completed ? 'line-through' : ''}`}
                      style={{ color: item.completed ? 'var(--c-text-3)' : 'var(--c-text-2)' }}>
                      {item.title}
                    </span>
                    {item.time && (
                      <span className="text-[10px] num ml-auto flex-shrink-0" style={{ color: 'var(--c-text-3)' }}>
                        {item.time}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* ════════════════════════════════════════════════════════════════
            ZONE 2 — THIS MONTH  (monthly context + trend chart)
        ════════════════════════════════════════════════════════════════ */}
        <Panel className="p-5">
          <div className="flex items-start justify-between mb-4">
            <SectionLabel>This Month</SectionLabel>
            <NavLink label="Analytics" to="/trading" />
          </div>

          {/* MTD stat strip */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              {
                label: 'MTD P&L',
                value: fmtView(mtdPnl),
                color: mtdPnl === 0 ? 'var(--c-text-3)' : mtdPnl > 0 ? '#34d399' : '#f87171',
              },
              {
                label: 'Win Rate',
                value: d.winRate != null ? `${d.winRate}%` : '--',
                color: d.winRate == null ? 'var(--c-text-3)' : d.winRate >= 50 ? '#34d399' : '#f87171',
              },
              {
                label: 'Avg R:R',
                value: d.avgRR != null ? `${d.avgRR.toFixed(2)}R` : '--',
                color: d.avgRR == null ? 'var(--c-text-3)' : d.avgRR >= 1 ? '#34d399' : d.avgRR > 0 ? '#fbbf24' : '#f87171',
              },
              {
                label: 'Trades',
                value: d.mtdTradeCount ?? 0,
                color: 'var(--c-text-1)',
              },
            ].map(s => (
              <div key={s.label} className="rounded-xl px-4 py-3 text-center"
                style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--c-text-3)' }}>
                  {s.label}
                </p>
                <p className="text-xl font-black num" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* 7-day chart */}
          {pnlLast7.every(d => d.pnl === 0) ? (
            <div className="h-24 flex items-center justify-center rounded-xl"
              style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
              <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>No P&L data yet. Log trade exits to see this chart.</p>
            </div>
          ) : (
            <div className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pnlLast7} barSize={22} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
                  <XAxis dataKey="label" tick={{ fill: '#4b4b6b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#4b4b6b', fontSize: 10 }} axisLine={false} tickLine={false}
                    tickFormatter={v => `$${Math.abs(v) >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`} />
                  <ReferenceLine y={0} stroke="var(--c-chart-grid)" />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#eeeef5' }}
                    formatter={(v: any) => [fmtView(v as number), 'P&L']} />
                  <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                    {pnlLast7.map((entry, i) => (
                      <Cell key={i} fill={entry.pnl >= 0 ? '#34d399' : '#f87171'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        {/* ════════════════════════════════════════════════════════════════
            ZONE 3 — CONTEXT  (business · calendar · goals)
        ════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-3 gap-4">

          {/* ── Business ─────────────────────────────────────────────── */}
          <Panel className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Briefcase size={13} style={{ color: '#34d399' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--c-text-1)' }}>Business</span>
              </div>
              <NavLink label="Zavabuild" to="/business" />
            </div>

            <div className="space-y-0">
              {[
                { label: 'Total Revenue',  value: fmtView(d.totalRevenue ?? 0, 'GBP'), color: '#34d399' },
                { label: 'Outstanding',    value: fmtView(d.outstandingAmt ?? 0, 'GBP'), color: d.outstandingAmt > 0 ? '#fbbf24' : 'var(--c-text-3)' },
                { label: 'Active Clients', value: d.activeClients ?? 0,                  color: '#818cf8' },
              ].map((row, i, arr) => (
                <div key={row.label} className="flex items-center justify-between py-2.5"
                  style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--c-border)' : 'none' }}>
                  <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>{row.label}</span>
                  <span className="text-sm font-bold num" style={{ color: row.color }}>{row.value}</span>
                </div>
              ))}
            </div>

            {d.nextDue && (
              <div className="rounded-xl p-3 mt-3"
                style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#fbbf24' }}>Next Invoice Due</p>
                <p className="text-sm font-bold num" style={{ color: 'var(--c-text-1)' }}>{fmtView(d.nextDue.amount, 'GBP')}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>{formatDate(d.nextDue.dueDate)}</p>
              </div>
            )}
          </Panel>

          {/* ── Upcoming ─────────────────────────────────────────────── */}
          <Panel className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CalendarDays size={13} style={{ color: '#818cf8' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--c-text-1)' }}>Upcoming</span>
              </div>
              <NavLink label="Calendar" to="/calendar" />
            </div>

            {(d.upcomingEvents ?? []).length === 0 ? (
              <p className="text-sm py-4 text-center" style={{ color: 'var(--c-text-3)' }}>Nothing scheduled. All clear.</p>
            ) : (
              <div className="space-y-2">
                {(d.upcomingEvents as any[]).map((e: any) => {
                  const col = e.color || '#818cf8'
                  const dateStr = e.startDatetime?.split('T')[0] ?? ''
                  const timeStr = e.startDatetime?.includes('T')
                    ? new Date(e.startDatetime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                    : null
                  return (
                    <div key={e.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                      style={{ background: col + '10', border: `1px solid ${col}22` }}>
                      <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: col }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate" style={{ color: 'var(--c-text-1)' }}>{e.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] num" style={{ color: col }}>{formatDate(dateStr)}</span>
                          {timeStr && (
                            <>
                              <span style={{ color: 'var(--c-text-3)', fontSize: 10 }}>·</span>
                              <span className="text-[10px] num flex items-center gap-1" style={{ color: 'var(--c-text-3)' }}>
                                <Clock size={9} />{timeStr}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>

          {/* ── Goals ────────────────────────────────────────────────── */}
          <Panel className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Target size={13} style={{ color: '#a78bfa' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--c-text-1)' }}>Goals</span>
              </div>
              <NavLink label="All goals" to="/goals" />
            </div>

            {(d.goalHighlights ?? []).length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No active goals.</p>
                <button onClick={() => nav('/goals')} className="text-xs mt-1 hover:underline" style={{ color: 'var(--c-accent)' }}>
                  Set your first goal →
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {(d.goalHighlights as any[]).map((g: any) => {
                  const pct = Math.round(g.progressPct ?? 0)
                  const col = pct >= 80 ? '#34d399' : pct >= 40 ? '#818cf8' : '#a78bfa'
                  return (
                    <div key={g.id}>
                      <div className="flex items-start justify-between mb-2">
                        <div className="min-w-0 flex-1 mr-2">
                          <p className="text-xs font-semibold truncate" style={{ color: 'var(--c-text-1)' }}>{g.focus}</p>
                          <p className="text-[10px] capitalize" style={{ color: 'var(--c-text-3)' }}>{g.horizon}</p>
                        </div>
                        <span className="text-sm num font-bold flex-shrink-0" style={{ color: col }}>{pct}%</span>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--c-bg-input)' }}>
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: col }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </div>

        {/* ════════════════════════════════════════════════════════════════
            ZONE 4 — SUPPORTING  (finance · training — compact)
        ════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-2 gap-4">

          {/* Finance MTD */}
          <Panel className="p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold" style={{ color: 'var(--c-text-1)' }}>Finance: This Month</span>
              <NavLink label="Finances" to="/finances" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(() => {
                const inc = d.totalIncMTD ?? 0
                const exp = d.totalExpMTD ?? 0
                const net = inc - exp
                return [
                  { label: 'Income',   value: fmtView(inc, 'EUR'), color: '#34d399' },
                  { label: 'Expenses', value: fmtView(exp, 'EUR'), color: '#f87171' },
                  { label: 'Net',      value: `${net >= 0 ? '+' : ''}${fmtView(net, 'EUR')}`, color: net >= 0 ? '#34d399' : '#f87171' },
                ].map(s => (
                  <div key={s.label} className="rounded-xl px-3 py-3 text-center"
                    style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--c-text-3)' }}>{s.label}</p>
                    <p className="text-sm font-bold num" style={{ color: s.color }}>{s.value}</p>
                  </div>
                ))
              })()}
            </div>
          </Panel>

          {/* Training */}
          <Panel className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Dumbbell size={13} style={{ color: '#818cf8' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--c-text-1)' }}>Training</span>
              </div>
              <NavLink label="Log workout" to="/training" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  label: 'This Week',
                  value: `${d.weekWorkoutsCount ?? 0} sessions`,
                  color: '#818cf8',
                  icon: <Dumbbell size={12} />,
                },
                {
                  label: 'Streak',
                  value: d.trainingStreak > 0 ? `${d.trainingStreak} days` : '--',
                  color: '#f87171',
                  icon: <Flame size={12} />,
                },
                {
                  label: 'Last Workout',
                  value: d.lastWorkout ? d.lastWorkout.name : '--',
                  color: 'var(--c-text-2)',
                  icon: null,
                  small: true,
                },
              ].map(s => (
                <div key={s.label} className="rounded-xl px-3 py-3 text-center"
                  style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--c-text-3)' }}>{s.label}</p>
                  <p className={`font-bold num ${s.small ? 'text-xs' : 'text-sm'} truncate`} style={{ color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>
          </Panel>
        </div>

      </div>
    </PageShell>
  )
}
