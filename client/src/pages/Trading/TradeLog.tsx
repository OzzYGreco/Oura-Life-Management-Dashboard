import { useState, useMemo, useEffect, useRef } from 'react'
import { TradeRow } from './TradeRow'
import { LogFilters, applyLogFilter, NO_FILTER, type LogFilter } from './LogFilters'
import { useTrades, useDeleteTrade, type Trade } from '../../hooks/useTrades'
import { useTradingAccounts } from '../../hooks/useTradingAccounts'
import { TradeModal } from './TradeModal'
import { TradingSettingsModal } from './TradingSettings'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageLoader } from '../../components/ui/Spinner'

import { Plus, TrendingUp, Settings2, Calculator, Tags } from 'lucide-react'
import { ReviewCard } from './ReviewCard'
import { SetupsModal } from './SetupsModal'
import { SizeCalculator } from './SizeCalculator'
import { byTime, isClosed, fmtR, pnlOf, sum } from '../../lib/tradeStats'
import { FormGuide } from './ui'
import { formatCurrency } from '../../lib/utils'
import { TradeDetailModal } from './TradeDetailModal'
import { applyDateFilter, type Preset } from '../../components/shared/DateFilter'
import { RangePicker, ToolTray, ToolButton, PrimaryButton } from './controls'
import { useIsNext } from '../../skins/isNext'

interface Props {
  accountId?: number | null
  defaultAccountId?: number | null
  /** Bumped by the page's "Review now" to open the review queue here. */
  reviewSignal?: number
}

const mondayOf = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7))
  return x.toISOString().slice(0, 10)
}
function isoWeek(monday: string) {
  const d = new Date(`${monday}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 3)
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)
}
function weekRange(monday: string) {
  const a = new Date(`${monday}T12:00:00Z`), b = new Date(a); b.setUTCDate(a.getUTCDate() + 6)
  const f = (d: Date, m: boolean) => d.toLocaleDateString('en-GB', { day: 'numeric', ...(m ? { month: 'short' } : {}), timeZone: 'UTC' })
  const yr = a.getUTCFullYear() !== new Date().getUTCFullYear() ? ` ${a.getUTCFullYear()}` : ''
  return `${f(a, a.getUTCMonth() !== b.getUTCMonth())} – ${f(b, true)}${yr}`
}
function summarise(date: string, trades: Trade[]) {
  const done = trades.filter(isClosed)
  return { date, trades, closed: done.length, r: sum(done.filter(t => t.rrRatio != null).map(t => t.rrRatio!)), pnl: sum(done.map(t => pnlOf(t) ?? 0)) }
}

const dayLabel = (d: string) => {
  const today = new Date().toISOString().slice(0, 10)
  const y = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const nice = new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: d.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric', timeZone: 'UTC' })
  return d === today ? `Today · ${nice}` : d === y ? `Yesterday · ${nice}` : nice
}

export function TradeLog({ accountId, defaultAccountId, reviewSignal }: Props) {
  const nx = useIsNext()
  const filters: Record<string, string> = {}
  if (accountId) filters.accountId = String(accountId)

  const { data: trades, isPending } = useTrades(filters)
  const { data: accounts } = useTradingAccounts()
  const deleteTrade = useDeleteTrade()
  // ?new=1 opens the form straight away (a link for logging a trade).
  const [modalOpen, setModalOpen] = useState(() => new URLSearchParams(location.search).get('new') === '1')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editing, setEditing] = useState<Trade | null>(null)
  const [viewing, setViewing] = useState<Trade | null>(null)

  // ── Date filter ──────────────────────────────────────────────────────────────
  const [preset, setPreset]         = useState<Preset>('All')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')

  // ── Review queue: running trades, and closed ones not reviewed yet ─────────
  const [reviewing, setReviewing] = useState<{ queue: Trade[]; startId?: number } | null>(null)
  const [setupsOpen, setSetupsOpen] = useState(false)
  const [sizeOpen, setSizeOpen] = useState(false)
  const running = useMemo(() => (trades ?? []).filter(t => t.source === 'bybit' && !isClosed(t)).sort(byTime), [trades])
  const toReview = useMemo(() => (trades ?? []).filter(t => isClosed(t) && !t.reviewedAt).sort(byTime), [trades])
  useEffect(() => {
    if (reviewSignal && toReview.length) setReviewing({ queue: toReview })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewSignal])
  // Shortcuts: N new trade, S size calculator (not while typing or in a dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return
      if (modalOpen || reviewing || sizeOpen || setupsOpen || settingsOpen || viewing) return
      if (e.key === 'n') { e.preventDefault(); setEditing(null); setModalOpen(true) }
      if (e.key === 's') { e.preventDefault(); setSizeOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalOpen, reviewing, sizeOpen, setupsOpen, settingsOpen, viewing])
  /** Synced trades are edited in the review card: Bybit owns the rest. */
  const openEdit = (t: Trade) => {
    if (t.source === 'bybit') setReviewing({ queue: [t], startId: t.id })
    else { setEditing(t); setModalOpen(true) }
  }

  const filteredTrades = useMemo(() => {
    return applyDateFilter(trades ?? [], preset, customFrom, customTo)
  }, [trades, preset, customFrom, customTo])

  // ── Filters, then weeks of days, newest first ─────────────────────────────
  const [filter, setFilter] = useState<LogFilter>(NO_FILTER)
  const shown = useMemo(() => applyLogFilter(filteredTrades, filter), [filteredTrades, filter])
  const weeks = useMemo(() => {
    const byDay = new Map<string, Trade[]>()
    for (const t of shown) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t])
    const days = [...byDay].sort(([a], [b]) => b.localeCompare(a)).map(([date, ts]) => summarise(date, [...ts].sort(byTime).reverse()))
    const m = new Map<string, typeof days>()
    for (const d of days) { const k = mondayOf(d.date); m.set(k, [...(m.get(k) ?? []), d]) }
    return [...m].map(([monday, ds]) => ({ monday, days: ds, ...summarise(monday, ds.flatMap(d => d.trades)) }))
  }, [shown])
  const order = useMemo(() => weeks.flatMap(w => w.days.flatMap(d => d.trades)), [weeks])

  // ── Expand in place, J/K to move, Enter to open, E to review ─────────────
  const rowRefs = useRef(new Map<number, HTMLDivElement>())
  // ?trade=<id> opens that trade (a link to it); the address follows what's open.
  const [expanded, setExpandedRaw] = useState<number | null>(() => Number(new URLSearchParams(location.search).get('trade')) || null)
  const [focus, setFocus] = useState<number | null>(expanded)
  const setExpanded = (v: number | null | ((x: number | null) => number | null)) => setExpandedRaw(x => {
    const next = typeof v === 'function' ? v(x) : v
    const u = new URL(location.href)
    if (next == null) u.searchParams.delete('trade'); else u.searchParams.set('trade', String(next))
    history.replaceState(history.state, '', u)
    return next
  })
  useEffect(() => {
    if (expanded != null) setTimeout(() => rowRefs.current.get(expanded)?.scrollIntoView({ block: 'center' }), 50)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return
      if (modalOpen || reviewing || sizeOpen || setupsOpen || settingsOpen || viewing || !order.length) return
      const i = order.findIndex(t => t.id === focus)
      const go = (j: number) => {
        const t = order[Math.max(0, Math.min(order.length - 1, j))]
        setFocus(t.id); if (expanded != null) setExpanded(t.id)
        rowRefs.current.get(t.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
      if (e.key === 'j') { e.preventDefault(); go(i + 1) }
      else if (e.key === 'k') { e.preventDefault(); go(i < 0 ? 0 : i - 1) }
      else if (e.key === 'Enter' && focus != null) { e.preventDefault(); setExpanded(x => (x === focus ? null : focus)) }
      else if (e.key === 'Escape' && expanded != null) setExpanded(null)
      else if (e.key === 'e' && focus != null) { const t = order[i]; if (t) { e.preventDefault(); openEdit(t) } }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Show Account column only in "All Accounts" view
  const showAccountCol = accountId == null

  // Build quick lookup: accountId → name
  const accountName = (id?: number | null) => {
    if (!id || !accounts) return null
    return accounts.find(a => a.id === id)?.name ?? null
  }

  if (isPending) return <PageLoader />

  return (
    <div className={nx ? 'tr-log' : undefined}>
      <div className={nx ? 'tr-toolbar' : 'flex flex-wrap items-center gap-3 mb-5'}>
        <RangePicker preset={preset} onPreset={setPreset} customFrom={customFrom} onCustomFrom={setCustomFrom} customTo={customTo} onCustomTo={setCustomTo} />
        <span className="text-xs num" style={{ color: 'var(--c-text-3)' }}>
          {shown.length}{shown.length !== (trades?.length ?? 0) ? ` of ${trades?.length ?? 0}` : ''} trades
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ToolTray>
            <ToolButton icon={<Calculator size={14} />} label="Size" title="Position size calculator" kbd="S" onClick={() => setSizeOpen(true)} />
            <ToolButton icon={<Tags size={14} />} label="Setups" title="Rename, merge or archive setups" onClick={() => setSetupsOpen(true)} />
            <ToolButton icon={<Settings2 size={14} />} title="Trading settings (fees, lot sizes)" onClick={() => setSettingsOpen(true)} />
          </ToolTray>
          <PrimaryButton kbd="N" onClick={() => { setEditing(null); setModalOpen(true) }}><Plus size={14} /> New trade</PrimaryButton>
        </div>
      </div>

      <LogFilters trades={filteredTrades} value={filter} onChange={f => { setFilter(f); setExpanded(null) }} />

      {running.length > 0 && (
        <div className={nx ? 'tr-running' : 'mb-4 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center gap-2'}
          style={nx ? undefined : { background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.25)' }}>
          {running.map(t => (
            <button key={t.id} onClick={() => setReviewing({ queue: [t] })}
              className="flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs"
              style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)' }}>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: 'var(--c-accent)' }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: 'var(--c-accent)' }} />
              </span>
              <b>{t.asset} {t.direction}</b>
              <span style={{ color: 'var(--c-text-3)' }}>running{t.setupLabel ? ` · ${t.setupLabel}` : ' · add setup & chart'}</span>
            </button>
          ))}
        </div>
      )}


      {!trades?.length ? (
        <EmptyState
          icon={<TrendingUp size={32} />}
          title="No trades yet"
          description="Log your first trade to start tracking performance"
          action={<Button onClick={() => setModalOpen(true)}><Plus size={14} /> Add Trade</Button>}
        />
      ) : !filteredTrades.length ? (
        <div className="text-center py-16" style={{ color: 'var(--c-text-3)' }}>
          No trades in the selected period.
        </div>
      ) : (
        <div className={nx ? 'tr-weeks' : 'space-y-9'}>
          {!shown.length && (
            <div className="text-center py-16 text-sm" style={{ color: 'var(--c-text-3)' }}>
              No trades match these filters. <button onClick={() => setFilter(NO_FILTER)} className="hover:underline" style={{ color: 'var(--c-accent)' }}>Clear filters</button>
            </div>
          )}
          {weeks.map(w => (
            <section key={w.monday}>
              {nx ? (
                <div className="tr-week">
                  <b className="num">Week {isoWeek(w.monday)}</b>
                  <span className="rg">{weekRange(w.monday)}</span>
                  <span className="ct num">{w.trades.length} {w.trades.length === 1 ? 'trade' : 'trades'}</span>
                  <span className="sp" />
                  <FormGuide trades={[...w.trades].filter(isClosed).sort(byTime)} n={Math.min(10, Math.max(1, w.closed))} />
                  {w.closed > 0 && <>
                    <span className={`pnl num ${w.pnl >= 0 ? 'good' : 'bad'}`}>{w.pnl >= 0 ? '+' : ''}{formatCurrency(w.pnl)}</span>
                    <span className={`r num ${w.r >= 0 ? 'good' : 'bad'}`}>{fmtR(w.r)}</span>
                  </>}
                </div>
              ) : (
              <div className="sticky top-0 z-[5] -mx-1 px-1 py-2 mb-3 flex items-center gap-3 backdrop-blur-md"
                style={{ background: 'color-mix(in srgb, var(--c-bg-primary) 82%, transparent)' }}>
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] px-2 py-1 rounded-md num"
                  style={{ color: 'var(--c-accent)', background: 'color-mix(in srgb, var(--c-accent) 10%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--c-accent) 25%, transparent)' }}>
                  Week {isoWeek(w.monday)}
                </span>
                <span className="text-sm font-semibold" style={{ color: 'var(--c-text-1)' }}>{weekRange(w.monday)}</span>
                <span className="text-xs num" style={{ color: 'var(--c-text-3)' }}>{w.trades.length} {w.trades.length === 1 ? 'trade' : 'trades'}</span>
                <div className="flex-1" />
                <FormGuide trades={[...w.trades].filter(isClosed).sort(byTime)} n={Math.min(10, Math.max(1, w.closed))} />
                {w.closed > 0 && <>
                  <span className="text-xs num" style={{ color: w.pnl >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>{w.pnl >= 0 ? '+' : ''}{formatCurrency(w.pnl)}</span>
                  <span className="text-sm num font-bold px-2.5 py-0.5 rounded-lg"
                    style={{ background: w.r >= 0 ? 'rgba(52,211,153,0.14)' : 'rgba(248,113,113,0.14)', color: w.r >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>
                    {fmtR(w.r)}
                  </span>
                </>}
              </div>
              )}
              <div className="space-y-4">
                {w.days.map(day => (
                  <div key={day.date} className={nx ? 'tr-day' : undefined}>
                    {nx ? (
                      <div className="tr-dayh">
                        <span>{dayLabel(day.date).replace(' · ', ', ')}</span>
                        {day.closed > 0 && <span className="v num"><span>{day.pnl >= 0 ? '+' : ''}{formatCurrency(day.pnl)}</span><b className={day.r >= 0 ? 'good' : 'bad'}>{fmtR(day.r)}</b></span>}
                      </div>
                    ) : (
                    <div className="flex items-baseline gap-3 px-1 mb-1.5">
                      <span className="text-xs font-semibold" style={{ color: 'var(--c-text-2)' }}>{dayLabel(day.date)}</span>
                      <div className="flex-1 h-px self-center" style={{ background: 'var(--c-border-subtle)' }} />
                      {day.closed > 0 && <>
                        <span className="text-[11px] num" style={{ color: 'var(--c-text-3)' }}>{day.pnl >= 0 ? '+' : ''}{formatCurrency(day.pnl)}</span>
                        <span className="text-[11px] num font-semibold" style={{ color: day.r >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>{fmtR(day.r)}</span>
                      </>}
                    </div>
                    )}
                    <div className={nx ? 'tr-rows' : 'rounded-xl overflow-hidden'} style={nx ? undefined : { background: 'var(--c-bg-card)', border: '1px solid var(--c-border)', boxShadow: 'var(--c-shadow-card)' }}>
                      {day.trades.map((t, i) => (
                        <TradeRow key={t.id} t={t} first={i === 0}
                          ref={el => { if (el) rowRefs.current.set(t.id, el); else rowRefs.current.delete(t.id) }}
                          expanded={expanded === t.id} focused={focus === t.id}
                          accountName={showAccountCol ? accountName(t.accountId) : null}
                          onToggle={() => { setFocus(t.id); setExpanded(x => (x === t.id ? null : t.id)) }}
                          onEdit={() => openEdit(t)}
                          onDelete={() => { if (confirm(`Delete this ${t.asset} trade?`)) deleteTrade.mutate(t.id) }}
                          onDetails={() => setViewing(t)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {shown.length > 0 && nx && (
            <p className="tr-keys"><kbd>J</kbd><kbd>K</kbd> move, <kbd>Enter</kbd> open, <kbd>E</kbd> review, <kbd>N</kbd> new trade, <kbd>S</kbd> size</p>
          )}
          {shown.length > 0 && !nx && (
            <p className="text-center text-[11px]" style={{ color: 'var(--c-text-3)' }}>
              <kbd className="px-1 rounded" style={{ border: '1px solid var(--c-border-mid)' }}>J</kbd> <kbd className="px-1 rounded" style={{ border: '1px solid var(--c-border-mid)' }}>K</kbd> move ·{' '}
              <kbd className="px-1 rounded" style={{ border: '1px solid var(--c-border-mid)' }}>↵</kbd> open ·{' '}
              <kbd className="px-1 rounded" style={{ border: '1px solid var(--c-border-mid)' }}>E</kbd> review ·{' '}
              <kbd className="px-1 rounded" style={{ border: '1px solid var(--c-border-mid)' }}>N</kbd> new trade
            </p>
          )}
        </div>
      )}

      <TradeModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        trade={editing}
        defaultAccountId={defaultAccountId}
      />
      {viewing && <TradeDetailModal trade={viewing} onClose={() => setViewing(null)} onEdit={() => { const t = viewing; setViewing(null); openEdit(t) }} />}
      {reviewing && <ReviewCard queue={reviewing.queue} startId={reviewing.startId} onClose={() => setReviewing(null)} onManageSetups={() => setSetupsOpen(true)} />}
      <SetupsModal open={setupsOpen} onClose={() => setSetupsOpen(false)} />
      {sizeOpen && <SizeCalculator open onClose={() => setSizeOpen(false)} accountId={accountId ?? defaultAccountId ?? null} />}
      <TradingSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
