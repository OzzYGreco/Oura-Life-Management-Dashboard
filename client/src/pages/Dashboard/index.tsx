import { useNavigate } from 'react-router-dom'
import { ChevronRight, CandlestickChart, ListChecks, Briefcase, Target, Check } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useDashboardSummary } from '../../hooks/useDashboard'
import { useToggleChecklistItem } from '../../hooks/useChecklists'
import { PageShell } from '../../components/layout/PageShell'
import { PageLoader } from '../../components/ui/Spinner'
import { CurrencySelector } from '../../components/ui/CurrencySelector'
import { useFmtView, type FmtView } from '../../hooks/useFmtView'
import { today } from '../../lib/utils'

// ─── Types (shape of /api/dashboard/summary) ─────────────────────────────────

type Trade = { id: number; asset: string; direction: string; realizedPnl?: number; rrRatio?: number }
type Item  = { entryId: number; itemId: number; title: string; completed: boolean; time?: string }
type Day   = { date: string; label: string; pnl: number }

// ─── Small helpers ───────────────────────────────────────────────────────────

const tone = (n: number) => (n > 0 ? 'var(--c-profit)' : n < 0 ? 'var(--c-loss)' : 'var(--c-text-2)')
const signed = (fmt: FmtView, n: number, cur?: string) => (n > 0 ? '+' : '') + fmt(n, cur)
const r = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}R`

/** "09:15AM" / "13:30PM" / "01:45AM" → minutes after the day starts (04:00). */
function minutesOf(t?: string): number | null {
  const m = t?.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (!m) return null
  let h = Number(m[1])
  const ampm = m[3]?.toUpperCase()
  if (ampm === 'PM' && h < 12) h += 12
  if (ampm === 'AM' && h === 12) h = 0
  const mins = h * 60 + Number(m[2])
  return mins < 4 * 60 ? mins + 24 * 60 : mins   // after midnight still belongs to today
}
const clock = (mins: number) => {
  const m = mins % (24 * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const nowMinutes = () => {
  const d = new Date()
  const m = d.getHours() * 60 + d.getMinutes()
  return m < 4 * 60 ? m + 24 * 60 : m
}

// ─── Building blocks ─────────────────────────────────────────────────────────

function Section({ icon: Icon, title, to, summary, children, className = '' }: {
  icon: LucideIcon; title: string; to: string; summary?: React.ReactNode
  children: React.ReactNode; className?: string
}) {
  const nav = useNavigate()
  return (
    <section className={`rounded-[12px] p-4 flex flex-col ${className}`}
      style={{ background: 'var(--c-bg-card)', boxShadow: 'var(--c-shadow-card)' }}>
      <button onClick={() => nav(to)}
        className="group flex items-center gap-1.5 self-start -ml-1 px-1 h-6 rounded-[5px] hover:bg-[var(--c-bg-hover)] transition-colors">
        <Icon size={15} strokeWidth={1.75} style={{ color: 'var(--c-accent)' }} aria-hidden />
        <span className="text-[13px] font-semibold" style={{ color: 'var(--c-text-1)' }}>{title}</span>
        <ChevronRight size={13} strokeWidth={2} style={{ color: 'var(--c-text-3)' }} aria-hidden />
      </button>
      {summary && <p className="mt-1 text-[13px] leading-[1.45]" style={{ color: 'var(--c-text-2)' }}>{summary}</p>}
      <div className="mt-4 flex-1 flex flex-col">{children}</div>
    </section>
  )
}

function Figure({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium" style={{ color: 'var(--c-text-2)' }}>{label}</p>
      <p className="num text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] mt-0.5" style={{ color: color ?? 'var(--c-text-1)' }}>
        {value}
      </p>
      {sub && <p className="text-[12px] mt-1" style={{ color: 'var(--c-text-2)' }}>{sub}</p>}
    </div>
  )
}

/** A label/value list with hairline separators, as in System Settings. */
function Rows({ rows }: { rows: { label: React.ReactNode; value: React.ReactNode; color?: string }[] }) {
  return (
    <dl>
      {rows.map((row, i) => (
        <div key={i} className="flex items-baseline justify-between gap-3 py-[7px] text-[13px]"
          style={{ borderTop: i ? '0.5px solid var(--c-border)' : undefined }}>
          <dt style={{ color: 'var(--c-text-2)' }} className="truncate">{row.label}</dt>
          <dd className="num font-medium shrink-0" style={{ color: row.color ?? 'var(--c-text-1)' }}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Seven days of P&L as bars on a zero line, in the manner of Stocks. */
function WeekBars({ days, fmt }: { days: Day[]; fmt: FmtView }) {
  const max = Math.max(1, ...days.map(d => Math.abs(d.pnl)))
  const H = 44
  return (
    <div className="flex items-end gap-2" role="img"
      aria-label={days.map(d => `${d.label} ${fmt(d.pnl, 'USD')}`).join(', ')}>
      {days.map(d => {
        const h = d.pnl === 0 ? 0 : Math.max(3, (Math.abs(d.pnl) / max) * H)
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1.5" title={`${d.label}: ${fmt(d.pnl, 'USD')}`}>
            <div className="w-full flex flex-col justify-end" style={{ height: H * 2 + 1 }}>
              <div style={{ height: H, display: 'flex', alignItems: 'flex-end' }}>
                {d.pnl > 0 && <div className="w-full rounded-t-[3px]" style={{ height: h, background: 'var(--c-profit)' }} />}
              </div>
              <div style={{ height: 1, background: 'var(--c-border-mid)' }} />
              <div style={{ height: H }}>
                {d.pnl < 0 && <div className="w-full rounded-b-[3px]" style={{ height: h, background: 'var(--c-loss)' }} />}
              </div>
            </div>
            <span className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>{d.label.slice(0, 3)}</span>
          </div>
        )
      })}
    </div>
  )
}

function CheckCircle({ checked, onClick, label }: { checked: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} role="checkbox" aria-checked={checked} aria-label={label}
      className="w-[18px] h-[18px] rounded-full shrink-0 flex items-center justify-center transition-colors"
      style={{
        background: checked ? 'var(--c-accent)' : 'transparent',
        boxShadow: checked ? 'none' : 'inset 0 0 0 1.5px var(--c-border-strong)',
      }}>
      {checked && <Check size={11} strokeWidth={3} color="var(--c-on-accent)" />}
    </button>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { data, isPending } = useDashboardSummary(today())
  const { fmtView } = useFmtView('USD', 'dashboard')
  const toggle = useToggleChecklistItem()

  const dateLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const shell = (children: React.ReactNode) => (
    <PageShell title="Summary" subtitle={dateLabel}
      action={<CurrencySelector pageKey="dashboard" defaultCurrency="USD" />}>
      {children}
    </PageShell>
  )
  if (isPending) return shell(<PageLoader />)

  const d = data ?? {}
  const trades = (d.todayTradesDetail ?? []) as Trade[]
  const days = (d.pnlLast7 ?? []) as Day[]
  const items = (d.checklistItems ?? []) as Item[]
  const pnl: number = d.todayPnl ?? 0
  const mtd: number = d.mtdPnl ?? 0
  const avgToday = trades.length ? trades.reduce((s, t) => s + (t.rrRatio ?? 0), 0) / trades.length : 0

  // Checklist: open items first, in time order; overdue ones are marked.
  const now = nowMinutes()
  const done = items.filter(i => i.completed).length
  const open = items.filter(i => !i.completed)
    .map(i => ({ ...i, at: minutesOf(i.time) }))
    .sort((a, b) => (a.at ?? 9999) - (b.at ?? 9999))
  const overdue = open.filter(i => i.at != null && i.at < now).length
  const nextUp = open.find(i => i.at != null && i.at >= now)

  const goal = (d.goalHighlights ?? [])[0]
  const owed = d.nextDue as { invoiceNumber: string; amount: number; dueDate: string; clientName: string } | null
  const owedLate = owed && owed.dueDate < today()
  const fmtDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

  // One-sentence summaries, written from the numbers.
  const tradingLine = trades.length
    ? <>{pnl < 0 ? 'Down' : pnl > 0 ? 'Up' : 'Flat'} <b className="num font-medium" style={{ color: tone(pnl) }}>{fmtView(Math.abs(pnl), 'USD')}</b> today across {trades.length} trade{trades.length > 1 ? 's' : ''}; the month is <b className="num font-medium" style={{ color: tone(mtd) }}>{signed(fmtView, mtd, 'USD')}</b>.</>
    : <>No trades today. The month is <b className="num font-medium" style={{ color: tone(mtd) }}>{signed(fmtView, mtd, 'USD')}</b>.</>
  const checklistLine = items.length === 0
    ? 'Nothing is set up for today.'
    : done === items.length
      ? 'Everything is done for today.'
      : <>{done} of {items.length} done{overdue > 0 && <>, <span style={{ color: 'var(--c-warn)' }}>{overdue} past their time</span></>}.{nextUp && <> Next is {nextUp.title} at {clock(nextUp.at!)}.</>}</>
  const businessLine = <>Recurring revenue is <b className="num font-medium" style={{ color: 'var(--c-text-1)' }}>{fmtView(d.mrr ?? 0, 'GBP')}</b> a month{(d.netNewMrr ?? 0) > 0 && <>, up <b className="num font-medium" style={{ color: 'var(--c-profit)' }}>{fmtView(d.netNewMrr, 'GBP')}</b> this month</>}.</>

  return shell(
    <div className="grid grid-cols-12 gap-4 max-w-[2200px]">

      {/* Trading */}
      <Section icon={CandlestickChart} title="Trading" to="/trading" summary={tradingLine} className="col-span-12 xl:col-span-7">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)] gap-6 items-start">
          <Figure label="Today" value={trades.length ? signed(fmtView, pnl, 'USD') : '—'} color={trades.length ? tone(pnl) : 'var(--c-text-3)'}
            sub={trades.length ? <>{trades.length} trade{trades.length > 1 ? 's' : ''} · avg <span className="num">{r(avgToday)}</span></> : 'No trades yet'} />
          <Rows rows={[
            { label: 'This month', value: signed(fmtView, mtd, 'USD'), color: tone(mtd) },
            { label: 'Trades', value: d.mtdTradeCount ?? 0 },
            { label: 'Win rate', value: `${Math.round(d.winRate ?? 0)}%` },
            { label: 'Average', value: r(d.avgRR ?? 0), color: tone(d.avgRR ?? 0) },
          ]} />
          <div>
            <p className="text-[11px] font-medium mb-2" style={{ color: 'var(--c-text-2)' }}>Last 7 days</p>
            <WeekBars days={days} fmt={fmtView} />
          </div>
        </div>
        {trades.length > 0 && (
          <div className="mt-4" style={{ borderTop: '0.5px solid var(--c-border)' }}>
            {trades.map(t => (
              <div key={t.id} className="flex items-center gap-3 py-2 text-[13px]" style={{ borderBottom: '0.5px solid var(--c-border-subtle)' }}>
                <span className="font-medium w-14" style={{ color: 'var(--c-text-1)' }}>{t.asset}</span>
                <span style={{ color: 'var(--c-text-2)' }}>{t.direction}</span>
                <span className="flex-1" />
                <span className="num w-16 text-right" style={{ color: tone(t.rrRatio ?? 0) }}>{r(t.rrRatio ?? 0)}</span>
                <span className="num w-20 text-right font-medium" style={{ color: tone(t.realizedPnl ?? 0) }}>{signed(fmtView, t.realizedPnl ?? 0, 'USD')}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Checklist */}
      <Section icon={ListChecks} title="Checklist" to="/checklists" summary={checklistLine} className="col-span-12 xl:col-span-5">
        {items.length > 0 && (
          <>
            <div className="h-[4px] rounded-full overflow-hidden mb-3" style={{ background: 'var(--c-bg-input)' }}
              role="progressbar" aria-valuenow={done} aria-valuemax={items.length} aria-label="Checklist progress">
              <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${(done / items.length) * 100}%`, background: 'var(--c-accent)' }} />
            </div>
            <ul>
              {open.slice(0, 7).map((i, idx) => {
                const late = i.at != null && i.at < now
                return (
                  <li key={i.itemId} className="flex items-center gap-3 py-[7px]" style={{ borderTop: idx ? '0.5px solid var(--c-border)' : undefined }}>
                    <CheckCircle checked={false} label={`Mark ${i.title} done`}
                      onClick={() => toggle.mutate({ entryId: i.entryId, itemId: i.itemId, completed: true })} />
                    <span className="flex-1 truncate text-[13px]" style={{ color: 'var(--c-text-1)' }}>{i.title}</span>
                    {i.at != null && (
                      <span className="num text-[12px]" style={{ color: late ? 'var(--c-warn)' : 'var(--c-text-3)' }}>{clock(i.at)}</span>
                    )}
                  </li>
                )
              })}
            </ul>
            {open.length > 7 && (
              <p className="text-[12px] mt-2" style={{ color: 'var(--c-text-3)' }}>and {open.length - 7} more</p>
            )}
          </>
        )}
      </Section>

      {/* Business */}
      <Section icon={Briefcase} title="Business" to="/business" summary={businessLine} className="col-span-12 lg:col-span-6 xl:col-span-4">
        <Rows rows={[
          { label: 'Revenue this month', value: fmtView(d.revenueMTD ?? 0, 'GBP') },
          { label: 'Margin', value: `${(d.marginPct ?? 0).toFixed(1)}%` },
          { label: 'Active clients', value: d.activeClients ?? 0 },
          { label: 'Owed to you', value: fmtView(d.outstandingAmt ?? 0, 'GBP'), color: (d.outstandingAmt ?? 0) > 0 ? 'var(--c-warn)' : undefined },
        ]} />
        {owed && (
          <div className="mt-3 rounded-[8px] px-3 py-2.5 flex items-center gap-3" style={{ background: 'var(--c-bg-input)' }}>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium truncate" style={{ color: 'var(--c-text-1)' }}>{owed.clientName}</p>
              <p className="text-[12px]" style={{ color: owedLate ? 'var(--c-warn)' : 'var(--c-text-2)' }}>
                {owed.invoiceNumber} · {owedLate ? 'overdue since' : 'due'} {fmtDay(owed.dueDate)}
              </p>
            </div>
            <span className="num text-[13px] font-medium" style={{ color: 'var(--c-text-1)' }}>{fmtView(owed.amount, 'GBP')}</span>
          </div>
        )}
      </Section>

      {/* This week */}
      <Section icon={Target} title="This week" to="/goals" className="col-span-12 lg:col-span-6 xl:col-span-4"
        summary={goal ? <>Focus: {goal.focus}.</> : 'No weekly goal set yet.'}>
        <Rows rows={[
          ...(goal ? [{ label: 'Goal period', value: `${fmtDay(goal.periodStart)} – ${fmtDay(goal.periodEnd)}` }] : []),
          { label: 'Workouts', value: d.weekWorkoutsCount ?? 0 },
          ...(d.lastWorkout ? [{ label: 'Last workout', value: `${d.lastWorkout.name} · ${fmtDay(d.lastWorkout.date)}` }] : []),
          ...(d.lastWorkout?.durationMinutes ? [{ label: 'Duration', value: `${d.lastWorkout.durationMinutes} min` }] : []),
        ]} />
      </Section>

      {/* Coming up */}
      <Section icon={ListChecks} title="Coming up" to="/calendar" className="col-span-12 xl:col-span-4"
        summary={(d.upcomingEvents ?? []).length ? undefined : 'Nothing on the calendar this week.'}>
        <Rows rows={(d.upcomingEvents ?? []).slice(0, 5).map((e: { title: string; startDatetime: string }) => ({
          label: e.title, value: fmtDay(e.startDatetime.slice(0, 10)),
        }))} />
      </Section>
    </div>,
  )
}
