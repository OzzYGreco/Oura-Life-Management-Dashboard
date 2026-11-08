import { forwardRef, useLayoutEffect, useRef, useState } from 'react'
import { ChartCarousel } from './ChartCarousel'
import { useQuery } from '@tanstack/react-query'
import type { Trade } from '../../hooks/useTrades'
import { api } from '../../lib/api'
import { MAX_DEVIATION_PCT } from '../../components/shared/PnLBadge'
import { MISTAKES } from '../../lib/constants'
import { formatCurrency, fmtPrice, fmtSize } from '../../lib/utils'
import { fmtMinutes, fmtR, isClosed, outcomeOf, pnlOf, stopTiming } from '../../lib/tradeStats'
import { CoinBadge, RBar, outcomeColor } from './ui'
import { ArrowUpRight, ArrowDownRight, Layers, Edit, Trash2, Maximize2, ImagePlus, ChevronDown } from 'lucide-react'

interface Leg { time: string; price: number; qty: number; fee: number; orderType: string | null; stopOrderType: string | null }
interface BybitTrade { entries: Leg[]; exits: Leg[]; funding: number; protective: { kind: 'sl' | 'tp'; price: number; at: string; status: string | null }[] }

interface Props {
  t: Trade
  expanded: boolean
  focused: boolean
  accountName: string | null
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onDetails: () => void
}

/** One trade: a scannable line that opens in place into the whole story. */
export const TradeRow = forwardRef<HTMLDivElement, Props>(function TradeRow({ t, expanded, focused, accountName, onToggle, onEdit, onDelete, onDetails }, ref) {
  const open = !isClosed(t)
  const o = outcomeOf(t)
  const pnl = pnlOf(t)
  const shot = t.screenshots?.[0]
  const dev = t.deviationPct ?? 0
  return (
    <div ref={ref} className={`tr-row ${expanded ? 'open' : ''}`}>
      <div onClick={onToggle}
        className="group relative flex items-center gap-4 pl-4 pr-3 py-2.5 cursor-pointer transition-colors hover:bg-[var(--c-bg-hover)]"
        style={{ boxShadow: focused ? 'inset 0 0 0 1px color-mix(in srgb, var(--c-accent) 55%, transparent)' : undefined }}>
        <span className="w-11 shrink-0 text-xs num" style={{ color: 'var(--c-text-3)' }}>{t.time ?? '—'}</span>
        <CoinBadge asset={t.asset} instrument={t.instrument} size={30} />
        <div className="w-28 shrink-0 min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--c-text-1)' }}>
            {t.asset}
            {t.isCompounded ? <Layers size={10} aria-label="Added to the position" style={{ color: '#fbbf24' }} /> : null}
          </div>
          <div className="flex items-center gap-1 text-[11px] font-medium" style={{ color: t.direction === 'Long' ? 'var(--c-profit)' : 'var(--c-loss)' }}>
            {t.direction === 'Long' ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}{t.direction}
            {open && <span className="ml-1 flex items-center gap-1" style={{ color: 'var(--c-accent)' }}>
              <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-70" style={{ background: 'var(--c-accent)' }} /><span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: 'var(--c-accent)' }} /></span>
              running
            </span>}
          </div>
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {t.setupLabel
            ? <span className="inline-block max-w-full truncate text-xs px-2 py-0.5 rounded-md" style={{ background: 'var(--c-bg-input)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>{t.setupLabel}</span>
            : t.source === 'bybit' && !t.reviewedAt && !open ? <span className="text-xs" style={{ color: 'var(--c-accent)' }}>to review</span> : null}
          {accountName && <span className="text-[10px] font-medium truncate" style={{ color: 'var(--c-text-3)' }}>{accountName}</span>}
        </div>
        <div className="hidden xl:block w-48 shrink-0 text-xs num text-right" style={{ color: 'var(--c-text-2)' }}>
          {fmtPrice(t.entryPrice)}<span style={{ color: 'var(--c-text-3)' }}> → </span>{t.exitPrice != null ? fmtPrice(t.exitPrice) : '…'}
          <div className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>{fmtSize(t.size, t.instrument)}{t.durationMinutes != null ? ` · ${fmtMinutes(t.durationMinutes)}` : ''}</div>
        </div>
        <div className="hidden md:block shrink-0"><RBar r={open ? null : t.rrRatio} width={110} /></div>
        <div className="w-16 shrink-0 text-right text-sm font-semibold num" style={{ color: open ? 'var(--c-text-3)' : outcomeColor(o) }}>
          {open ? '—' : fmtR(t.rrRatio)}
        </div>
        <div className="w-20 shrink-0 text-right">
          <div className="text-xs num" style={{ color: pnl == null || open ? 'var(--c-text-3)' : outcomeColor(o) }}>
            {pnl == null ? '' : `${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)}`}
          </div>
          {dev > 0 && (
            <div className="text-[10px] num" title={dev > MAX_DEVIATION_PCT ? 'Broke your 10% rule' : 'Past plan, within your 10% rule'}
              style={{ color: dev > MAX_DEVIATION_PCT ? 'var(--c-loss)' : '#f59e0b' }}>
              {dev.toFixed(1)}% past
            </div>
          )}
        </div>
        <div className="hidden lg:block w-12 shrink-0">
          {shot && !expanded && <img src={shot.filePath} alt="" className="w-12 h-8 rounded object-cover" style={{ border: '1px solid var(--c-border)' }} />}
        </div>
        <ChevronDown size={14} className="shrink-0 transition-transform duration-200" style={{ color: 'var(--c-text-3)', transform: expanded ? 'rotate(180deg)' : undefined }} />
      </div>
      {expanded && <Expanded t={t} onEdit={onEdit} onDelete={onDelete} onDetails={onDetails} />}
    </div>
  )
})

function Expanded({ t, onEdit, onDelete, onDetails }: { t: Trade; onEdit: () => void; onDelete: () => void; onDetails: () => void }) {
  const { data: bt } = useQuery({
    queryKey: ['bybit-trade', t.id, t.updatedAt],
    queryFn: () => api.get(`/api/bybit/trade/${t.id}`).then(r => r.data as BybitTrade),
    enabled: t.source === 'bybit',
    staleTime: 60_000,
  })
  const shots = t.screenshots ?? []
  const pnl = pnlOf(t)
  const fees = (t.entryFeeAmount ?? 0) + (t.exitFeeAmount ?? 0)
  const timing = stopTiming(t)
  const mistakes = (t.mistakes ?? []).map(k => MISTAKES.find(m => m.key === k)?.label ?? k)

  return (
    <div className="px-4 pb-4 pt-1 grid gap-4 lg:grid-cols-[1.25fr_1fr] animate-[popIn_160ms_ease-out]" style={{ background: 'var(--c-bg-hover)' }}>
      {/* Chart */}
      <div>
        {shots.length ? (
          <ChartCarousel shots={shots} />
        ) : (
          <button onClick={onEdit} className="w-full h-48 rounded-xl flex flex-col items-center justify-center gap-2 text-xs transition-colors hover:text-[var(--c-accent)]"
            style={{ border: '1.5px dashed var(--c-border-mid)', color: 'var(--c-text-3)' }}>
            <ImagePlus size={20} /> No chart yet. Add one (paste with ⌘V)
          </button>
        )}
        {(t.quickNote || mistakes.length > 0 || t.rulesMet != null) && (
          <div className="mt-3 space-y-1.5 text-xs">
            <div className="flex flex-wrap gap-1.5">
              {t.rulesMet != null && <Pill color={t.rulesMet ? 'var(--c-profit)' : 'var(--c-loss)'}>{t.rulesMet ? 'Followed my rules' : 'Broke a rule'}</Pill>}
              {t.mistakes && t.mistakes.length === 0 && <Pill color="var(--c-profit)">No mistakes</Pill>}
              {mistakes.map(m => <Pill key={m} color="var(--c-loss)">{m}</Pill>)}
            </div>
            {t.quickNote && <p className="leading-relaxed" style={{ color: 'var(--c-text-2)' }}>{t.quickNote}</p>}
            {t.mistakesOther && <p style={{ color: 'var(--c-text-3)' }}>{t.mistakesOther}</p>}
          </div>
        )}
      </div>

      {/* Numbers */}
      <div className="space-y-3">
        <PriceLadder t={t} bt={bt} />
        <div className="grid grid-cols-3 gap-px rounded-xl overflow-hidden" style={{ background: 'var(--c-border)' }}>
          <Fact k="Planned risk" v={t.riskDollars != null ? formatCurrency(t.riskDollars) : '—'} sub={t.riskSource === 'user' ? 'set by you' : 'from the stop'} />
          <Fact k="Risk at stop" v={t.riskAtStop != null ? formatCurrency(t.riskAtStop) : '—'}
            sub={timing.kind === 'later' ? `stop ${fmtMinutes(timing.minutes!)} late` : timing.kind === 'none' ? 'no stop' : 'incl. fees'} warn={timing.kind !== 'with-entry' && timing.kind !== 'unknown'} />
          <Fact k="Result" v={pnl != null ? `${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)}` : '–'} sub={t.rrRatio != null ? fmtR(t.rrRatio) : ''} color={pnl == null ? undefined : outcomeColor(outcomeOf(t))} />
          <Fact k="Fees" v={formatCurrency(fees)} sub={t.riskDollars ? `${(fees / t.riskDollars).toFixed(2)}R` : ''} />
          <Fact k="Funding" v={Math.abs(t.fundingFeeAmount ?? 0) < 0.005 ? '$0.00' : formatCurrency(-(t.fundingFeeAmount ?? 0))} sub={(t.fundingFeeAmount ?? 0) > 0 ? 'paid' : (t.fundingFeeAmount ?? 0) < 0 ? 'received' : ''} />
          <Fact k="Held" v={t.durationMinutes != null ? fmtMinutes(t.durationMinutes) : '—'} sub={`opened ${t.time ?? ''} UTC`} />
        </div>
        {bt && (bt.entries.length + bt.exits.length) > 0 && (
          <div className="rounded-xl p-2.5" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] mb-1.5 px-1" style={{ color: 'var(--c-text-3)' }}>Fills on Bybit</div>
            {[...bt.entries.map(l => ({ ...l, side: 'in' as const })), ...bt.exits.map(l => ({ ...l, side: 'out' as const }))]
              .sort((a, b) => a.time.localeCompare(b.time)).map((l, i) => (
                <div key={i} className="flex items-center gap-2 px-1 py-0.5 text-[11px] num">
                  <span className="w-9" style={{ color: 'var(--c-text-3)' }}>{l.time.slice(11, 16)}</span>
                  <span className="w-8 font-semibold" style={{ color: l.side === 'in' ? 'var(--c-text-1)' : outcomeColor(outcomeOf(t)) }}>{l.side === 'in' ? 'IN' : 'OUT'}</span>
                  <span className="flex-1" style={{ color: 'var(--c-text-2)' }}>{l.qty} @ {fmtPrice(l.price)}</span>
                  <span style={{ color: 'var(--c-text-3)' }}>{/Stop/.test(l.stopOrderType ?? '') ? 'stop' : /TakeProfit/.test(l.stopOrderType ?? '') ? 'target' : (l.orderType ?? '').toLowerCase()}</span>
                  <span className="w-14 text-right" style={{ color: 'var(--c-text-3)' }}>fee {l.fee.toFixed(2)}</span>
                </div>
              ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: 'color-mix(in srgb, var(--c-accent) 16%, transparent)', color: 'var(--c-text-1)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
            <Edit size={12} /> {t.source === 'bybit' ? 'Review' : 'Edit'}
          </button>
          <button onClick={onDetails} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs" style={{ color: 'var(--c-text-2)', boxShadow: 'inset 0 0 0 1px var(--c-border)' }}>
            <Maximize2 size={12} /> All details
          </button>
          <button onClick={onDelete} className="ml-auto p-1.5 rounded-lg hover:bg-[var(--c-bg-hover)]" title="Delete" style={{ color: 'var(--c-text-3)' }}><Trash2 size={13} /></button>
        </div>
      </div>
    </div>
  )
}

/** The element's width in px, kept current as it resizes. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/**
 * Stop, entry, exit and targets to scale on one line, with the move from
 * entry to exit shaded and each level's distance in R. Stops moved during
 * the trade show as faint ticks.
 */
function PriceLadder({ t, bt }: { t: Trade; bt?: BybitTrade }) {
  const [box, width] = useWidth()
  const stop = t.stopLoss ?? null
  const tps = bt ? bt.protective.filter(p => p.kind === 'tp').map(p => p.price) : (t.takeProfits ?? []).map(x => x.price)
  const movedStops = bt ? [...new Set(bt.protective.filter(p => p.kind === 'sl' && p.price !== stop).map(p => p.price))] : []
  const levels = [t.entryPrice, t.exitPrice, stop, ...tps, ...movedStops].filter((x): x is number => x != null && isFinite(x))
  if (levels.length < 2) return null
  let lo = Math.min(...levels), hi = Math.max(...levels)
  const pad = (hi - lo) * 0.08 || t.entryPrice * 0.002
  lo -= pad; hi += pad
  const long = t.direction === 'Long'
  // Price up is to the right for a long and to the left for a short, so profit always points right.
  const x = (p: number) => { const f = (p - lo) / (hi - lo); return (long ? f : 1 - f) * 100 }
  const per = stop != null ? Math.abs(t.entryPrice - stop) : null
  const rAt = (p: number) => (per ? ((long ? p - t.entryPrice : t.entryPrice - p) / per) : null)
  const win = t.exitPrice != null && (long ? t.exitPrice >= t.entryPrice : t.exitPrice <= t.entryPrice)

  type Lvl = { p: number; label: string; color: string; strong: boolean; rank: number }
  const exitColor = win ? 'var(--c-profit)' : 'var(--c-loss)'
  // rank: who keeps the spot when prices sit too close to all be written out.
  const lvls: Lvl[] = [
    { p: t.entryPrice, label: 'Entry', color: 'var(--c-text-1)', strong: true, rank: 0 },
    ...(t.exitPrice != null ? [{ p: t.exitPrice, label: 'Exit', color: exitColor, strong: true, rank: 1 }] : []),
    ...(stop != null ? [{ p: stop, label: 'Stop', color: 'var(--c-loss)', strong: true, rank: 2 }] : []),
    ...tps.map(p => {
      const r = rAt(p)
      return { p, label: r != null ? `Target ${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}R` : 'Target', color: 'var(--c-profit)', strong: true, rank: 3 }
    }),
    ...movedStops.map(p => ({ p, label: 'Moved stop', color: 'var(--c-loss)', strong: false, rank: 4 })),
  ]

  return (
    <div className="rounded-xl px-4 pt-3 pb-2" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
      <div ref={box} className="relative h-[62px]">
        <div className="absolute left-0 right-0 top-[22px] h-[6px] rounded-full" style={{ background: 'var(--c-bg-input)' }} />
        {stop != null && (
          <div className="absolute top-[22px] h-[6px]" style={{ left: `${Math.min(x(stop), x(t.entryPrice))}%`, width: `${Math.abs(x(stop) - x(t.entryPrice))}%`, background: 'repeating-linear-gradient(135deg, rgba(248,113,113,0.35) 0 3px, transparent 3px 6px)' }} />
        )}
        {t.exitPrice != null && (
          <div className="absolute top-[22px] h-[6px] rounded-full" style={{
            left: `${Math.min(x(t.exitPrice), x(t.entryPrice))}%`, width: `${Math.max(0.5, Math.abs(x(t.exitPrice) - x(t.entryPrice)))}%`,
            background: exitColor, opacity: 0.8,
          }} />
        )}
        {/* Ticks above and below the line, faint for stops that were moved away from. */}
        {[...lvls].reverse().map(l => (
          <span key={`t${l.label}${l.p}`} aria-hidden className="absolute -translate-x-1/2" style={{ left: `${x(l.p)}%`, top: 18, width: l.strong ? 2 : 1, height: 14, background: l.color, opacity: l.strong ? 1 : 0.5 }} />
        ))}
        {lvls.filter(l => l.strong).map(l => (
          <span key={`b${l.label}${l.p}`} aria-hidden className="absolute -translate-x-1/2" style={{ left: `${x(l.p)}%`, top: 34, width: 2, height: 14, background: l.label === 'Exit' ? 'var(--c-text-1)' : l.color }} />
        ))}
        {/* Names: levels too close to write apart share one label. */}
        {clusters(lvls.map(l => ({ ...l, at: x(l.p), w: l.label.length * 6.6 })), width, ' · '.length * 6.6).map(c => (
          <span key={`n${c.at}`} className="absolute top-0 text-[12px] font-medium whitespace-nowrap leading-[14px]" style={{ left: `${c.left}%`, transform: `translateX(${c.shift})` }}
            title={c.items.map(l => `${l.label} ${fmtPrice(l.p)}`).join(', ')}>
            {c.items.map((l, i) => <span key={i}>{i > 0 && <span style={{ color: 'var(--c-text-3)' }}> · </span>}<span style={{ color: l.color }}>{l.label}</span></span>)}
          </span>
        ))}
        {/* Prices: where two crowd each other, the more important one is written. */}
        {clusters(lvls.filter(l => l.strong).map(l => ({ ...l, at: x(l.p), w: fmtPrice(l.p).length * 6.2 })), width, 0, true).map(c => {
          const l = c.items.reduce((a, b) => (b.rank < a.rank ? b : a))
          return (
            <span key={`p${l.label}${l.p}`} className="absolute text-[12px] num whitespace-nowrap leading-[14px]" style={{ top: 48, left: `${x(l.p)}%`, transform: `translateX(${edgeShift(x(l.p), l.w, width)})`, color: 'var(--c-text-2)' }}>
              {fmtPrice(l.p)}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** Centred on its point, but kept inside the line's box at either end. */
function edgeShift(at: number, w: number, width: number): string {
  if (!width) return '-50%'
  const px = (at / 100) * width
  if (px - w / 2 < 0) return `-${px}px`
  if (px + w / 2 > width) return `${width - px - w}px`
  return '-50%'
}

/**
 * Groups labels (positions in %, widths in px) that would overlap, left to
 * right. A group sits at the middle of its points; `single` keeps each group's
 * own width (only one of its labels is written) instead of adding them up.
 */
function clusters<T extends { at: number; w: number }>(items: T[], width: number, gap: number, single = false) {
  const sorted = [...items].sort((a, b) => a.at - b.at)
  const out: { items: T[]; at: number; w: number; left: number; shift: string }[] = []
  for (const it of sorted) {
    const last = out[out.length - 1]
    const px = (v: number) => (v / 100) * width
    if (last && width && px(it.at) - it.w / 2 < px(last.at) + last.w / 2 + 10) {
      last.items.push(it)
      last.w = single ? Math.max(last.w, it.w) : last.w + gap + it.w
      last.at = last.items.reduce((s, i) => s + i.at, 0) / last.items.length
    } else out.push({ items: [it], at: it.at, w: it.w, left: 0, shift: '' })
  }
  for (const c of out) { c.left = c.at; c.shift = edgeShift(c.at, c.w, width) }
  return out
}

function Fact({ k, v, sub, color, warn }: { k: string; v: string; sub?: string; color?: string; warn?: boolean }) {
  return (
    <div className="px-3 py-2" style={{ background: 'var(--c-bg-card)' }}>
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--c-text-3)' }}>{k}</div>
      <div className="text-sm font-semibold num mt-0.5" style={{ color: color ?? 'var(--c-text-1)' }}>{v}</div>
      {sub && <div className="text-[10px] num" style={{ color: warn ? '#f59e0b' : 'var(--c-text-3)' }}>{sub}</div>}
    </div>
  )
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="px-2 py-0.5 rounded-md text-[11px] font-medium"
      style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 30%, transparent)` }}>
      {children}
    </span>
  )
}
