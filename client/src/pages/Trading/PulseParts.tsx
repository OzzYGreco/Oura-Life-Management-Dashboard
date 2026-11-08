import { useMemo } from 'react'
import type { Trade } from '../../hooks/useTrades'
import type { TradingAccount } from '../../hooks/useTradingAccounts'
import { byTime, fmtR, isClosed, openedMs, outcomeOf, pnlOf, sum } from '../../lib/tradeStats'
import { outcomeColor, useCountUp } from './ui'
import { loadSessions, windowsBetween, clockIn } from '../../lib/sessions'

// ─── Account ─────────────────────────────────────────────────────────────────

const closedMs = (t: Trade) => (t.closedAt ? Date.parse(t.closedAt) : openedMs(t) + (t.durationMinutes ?? 0) * 60_000)

interface AccountView {
  account: TradingAccount
  mode: 'balance' | 'r'
  value: number                 // balance ($) or net R since the start
  change: number                // $ or R since the anchor / start
  changePct: number | null      // % on the starting balance
  fromPeak: number              // ≤ 0, $ or R
  month: number                 // this month, $ or R
  curve: number[]
  since: string | null          // anchor date
}

/**
 * Where an account stands. With a balance and its date: the balance now
 * (that amount plus every trade closed after it), % since, distance from the
 * peak, and the curve from that day. Without one: the same in R.
 */
function accountView(a: TradingAccount, trades: Trade[]): AccountView {
  const mine = trades.filter(t => t.accountId === a.id && isClosed(t)).sort((x, y) => closedMs(x) - closedMs(y))
  const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)
  if (a.startingBalance != null && a.startingBalanceAt) {
    const from = Date.parse(a.startingBalanceAt)
    const after = mine.filter(t => closedMs(t) > from)
    let bal = a.startingBalance, peak = bal
    const curve = [bal]
    for (const t of after) { bal += pnlOf(t) ?? 0; peak = Math.max(peak, bal); curve.push(bal) }
    return {
      account: a, mode: 'balance', value: bal, change: bal - a.startingBalance, changePct: (bal - a.startingBalance) / a.startingBalance,
      fromPeak: bal - peak, month: sum(after.filter(t => closedMs(t) >= monthStart).map(t => pnlOf(t) ?? 0)), curve, since: a.startingBalanceAt.slice(0, 10),
    }
  }
  const rs = mine.filter(t => t.rrRatio != null)
  let cum = 0, peak = 0
  const curve = [0]
  for (const t of rs) { cum += t.rrRatio!; peak = Math.max(peak, cum); curve.push(cum) }
  const cutoff = Date.now() - 30 * 86_400_000
  const recent = rs.filter(t => closedMs(t) >= cutoff).length
  return {
    account: a, mode: 'r', value: cum, change: cum, changePct: null, fromPeak: cum - peak,
    month: sum(rs.filter(t => closedMs(t) >= monthStart).map(t => t.rrRatio!)),
    curve: recent ? curve.slice(-(recent + 1)) : [cum, cum], since: null,
  }
}

const money = (v: number, sign = false) => `${sign && v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtV = (v: number, mode: 'balance' | 'r', sign = false) => (mode === 'balance' ? money(v, sign) : fmtR(v, 1))
const tone = (v: number) => (v > 1e-9 ? 'var(--c-profit)' : v < -1e-9 ? 'var(--c-loss)' : 'var(--c-text-2)')

function Spark({ pts, w = 140, h = 40, fill = true }: { pts: number[]; w?: number; h?: number; fill?: boolean }) {
  const p = pts.length >= 2 ? pts : [pts[0] ?? 0, pts[0] ?? 0]
  const min = Math.min(...p), max = Math.max(...p), rng = max - min || 1
  const xy = p.map((v, i) => [(i / (p.length - 1)) * w, h - 3 - ((v - min) / rng) * (h - 6)])
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
  const delta = p[p.length - 1] - p[0]
  const c = Math.abs(delta) < 1e-9 ? 'var(--c-text-3)' : delta > 0 ? 'var(--c-profit)' : 'var(--c-loss)'
  const id = `sp${Math.round(Math.abs(p.reduce((s, v) => s + v, 0)) * 1000) % 99999}${p.length}`
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity={0.28} /><stop offset="100%" stopColor={c} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && <path d={`${d}L${w},${h}L0,${h}Z`} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={c} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r={2.5} fill={c} />
    </svg>
  )
}

export function AccountTile({ accounts, trades, accountId }: { accounts: TradingAccount[]; trades: Trade[]; accountId: number | null }) {
  const views = useMemo(() => (accountId ? accounts.filter(a => a.id === accountId) : accounts).map(a => accountView(a, trades)), [accounts, trades, accountId])
  if (views.length === 1) return <AccountHero v={views[0]} />
  return (
    <div className="p-5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: 'var(--c-text-3)' }}>Accounts</div>
      <div className="space-y-3">
        {views.map(v => (
          <div key={v.account.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs truncate" style={{ color: 'var(--c-text-2)' }}>{v.account.name}</div>
              <div className="text-lg font-bold num leading-tight" style={{ color: v.mode === 'balance' ? 'var(--c-text-1)' : tone(v.value) }}>{fmtV(v.value, v.mode)}</div>
              <div className="text-[10px] num" style={{ color: 'var(--c-text-3)' }}>
                {v.mode === 'balance'
                  ? <><span style={{ color: tone(v.change) }}>{money(v.change, true)}{v.changePct != null ? ` (${(v.changePct * 100).toFixed(1)}%)` : ''}</span> since {v.since}</>
                  : 'net R · no balance set'}
              </div>
            </div>
            <Spark pts={v.curve} w={84} h={30} />
          </div>
        ))}
      </div>
    </div>
  )
}

function AccountHero({ v }: { v: AccountView }) {
  const shown = useCountUp(v.value)
  return (
    <div className="p-5 flex flex-col h-full">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--c-text-3)' }}>
        {v.account.name} · {v.mode === 'balance' ? 'balance' : 'net since start'}
      </div>
      <div className="flex items-end gap-4 mt-1.5">
        <div className="min-w-0">
          <div className="text-4xl font-bold num leading-none tracking-tight" style={{ color: v.mode === 'balance' ? 'var(--c-text-1)' : tone(v.value) }}>
            {fmtV(shown, v.mode)}
          </div>
          <div className="mt-2 text-xs num" style={{ color: 'var(--c-text-3)' }}>
            {v.mode === 'balance'
              ? <><span style={{ color: tone(v.change) }}>{money(v.change, true)}{v.changePct != null ? ` · ${v.changePct >= 0 ? '+' : ''}${(v.changePct * 100).toFixed(2)}%` : ''}</span> since {v.since}</>
              : <>Set a balance under accounts to track it in $</>}
          </div>
        </div>
        <div className="ml-auto shrink-0"><Spark pts={v.curve} w={130} h={46} /></div>
      </div>
      <div className="mt-3 flex gap-4 text-[11px] num" style={{ color: 'var(--c-text-3)' }}>
        <span>This month <b style={{ color: tone(v.month) }}>{fmtV(v.month, v.mode, true)}</b></span>
        <span>From peak <b style={{ color: v.fromPeak < -1e-9 ? 'var(--c-loss)' : 'var(--c-text-2)' }}>{v.fromPeak < -1e-9 ? fmtV(v.fromPeak, v.mode) : 'at the high'}</b></span>
      </div>
    </div>
  )
}

// ─── Session timeline ────────────────────────────────────────────────────────

/**
 * A UTC day as a strip: your sessions shaded where they really were that day
 * (each exchange's daylight saving applied), each trade a bar from open to
 * close in its result's colour, running trades still growing, and "now".
 * Shows today, or the last day you traded if today has nothing yet.
 */
export function SessionTimeline({ trades, now }: { trades: Trade[]; now: Date }) {
  const today = now.toISOString().slice(0, 10)
  const { day, rows, isToday } = useMemo(() => {
    const running = trades.filter(t => t.source === 'bybit' && !isClosed(t))
    const has = (d: string) => trades.some(t => t.date === d || (t.closedAt ?? '').startsWith(d)) || (d === today && running.length > 0)
    const last = [...trades].sort(byTime).pop()?.date
    const day = has(today) ? today : last ?? today
    const start = Date.parse(`${day}T00:00:00Z`), end = start + 86_400_000
    const items = trades
      .map(t => ({ t, a: openedMs(t), b: isClosed(t) ? closedMs(t) : now.getTime(), open: !isClosed(t) }))
      .filter(x => x.b >= start && x.a < end)
      .sort((x, y) => x.a - y.a)
    const lanes: number[] = []
    const rows = items.map(x => {
      let lane = lanes.findIndex(endAt => endAt <= x.a)
      if (lane < 0) { lane = lanes.length; lanes.push(0) }
      lanes[lane] = x.b + 75 * 60_000   // room for the label beside a short bar
      return { ...x, lane, l: Math.max(0, (x.a - start) / 864_000), r: Math.min(100, (x.b - start) / 864_000) }
    })
    return { day, rows, isToday: day === today }
  }, [trades, now, today])

  const lanes = Math.max(1, ...rows.map(r => r.lane + 1))
  const dayStart = Date.parse(`${day}T00:00:00Z`)
  const bands = useMemo(() => windowsBetween(loadSessions(), dayStart, dayStart + 86_400_000), [dayStart])
  const nowPct = ((now.getTime() - Date.parse(`${day}T00:00:00Z`)) / 864_000)
  const dayR = sum(rows.filter(r => !r.open && r.t.rrRatio != null).map(r => r.t.rrRatio!))
  const label = isToday ? 'Today' : new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })

  return (
    <div className="px-5 pt-3.5 pb-4" style={{ borderTop: '1px solid var(--c-border)' }}>
      <div className="flex items-baseline gap-3 mb-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--c-text-3)' }}>Session · {label}</span>
        <span className="text-[11px] num" style={{ color: 'var(--c-text-3)' }}>
          {rows.length ? `${rows.length} ${rows.length === 1 ? 'trade' : 'trades'}` : 'no trades yet'}
          {rows.some(r => !r.open) && <> · <span style={{ color: tone(dayR) }}>{fmtR(dayR)}</span></>}
        </span>
        <span className="ml-auto text-[10px]" style={{ color: 'var(--c-text-3)' }}>UTC</span>
      </div>
      <div className="relative rounded-lg overflow-hidden" style={{ height: 22 + lanes * 22, background: 'var(--c-bg-input)', boxShadow: 'inset 0 0 0 1px var(--c-border)' }}>
        {bands.map((w, i) => {
          const l = Math.max(0, (w.start - dayStart) / 864_000), r = Math.min(100, (w.end - dayStart) / 864_000)
          const prevL = i ? Math.max(0, (bands[i - 1].start - dayStart) / 864_000) : -100
          const row = l - prevL < 9 ? 1 : 0   // two starts close together: drop this label a line
          const c = w.session.color
          return (
            <div key={`${w.session.id}${w.start}`} className="absolute top-0 bottom-0"
              title={`${w.session.name} ${clockIn('UTC', w.start)}–${clockIn('UTC', w.end)} UTC`}
              style={{ left: `${l}%`, width: `${r - l}%`, background: `color-mix(in srgb, ${c} 7%, transparent)`, borderLeft: `1px dashed color-mix(in srgb, ${c} 45%, transparent)` }}>
              <span className="absolute left-1.5 text-[9px] font-semibold uppercase tracking-wider whitespace-nowrap"
                style={{ top: 2 + row * 11, color: `color-mix(in srgb, ${c} 75%, var(--c-text-3))` }}>
                {w.session.name} <span className="num normal-case font-normal">{clockIn('UTC', w.start)}</span>
              </span>
            </div>
          )
        })}
        {rows.map(r => {
          const o = outcomeOf(r.t)
          const c = r.open ? 'var(--c-accent)' : outcomeColor(o)
          const wide = r.r - r.l > 7
          return (
            <div key={r.t.id}>
            {!wide && (
              <span className="absolute text-[10px] font-semibold num whitespace-nowrap pointer-events-none"
                style={{ left: `calc(${r.r}% + 6px)`, top: 21 + r.lane * 22, color: c }}>
                {r.t.asset} {r.open ? 'running' : fmtR(r.t.rrRatio)}
              </span>
            )}
            <div className="absolute rounded-md flex items-center overflow-hidden"
              title={`${r.t.asset} ${r.t.direction} · ${r.t.time} → ${r.open ? 'running' : new Date(r.b).toISOString().slice(11, 16)}${r.open ? '' : ` · ${fmtR(r.t.rrRatio)}`}`}
              style={{
                left: `${r.l}%`, width: `max(4px, ${r.r - r.l}%)`, top: 20 + r.lane * 22, height: 16,
                background: r.open
                  ? `repeating-linear-gradient(135deg, color-mix(in srgb, ${c} 55%, transparent) 0 6px, color-mix(in srgb, ${c} 30%, transparent) 6px 12px)`
                  : `linear-gradient(90deg, color-mix(in srgb, ${c} 35%, transparent), color-mix(in srgb, ${c} 70%, transparent))`,
                boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 70%, transparent)`,
              }}>
              {wide && <span className="px-1.5 text-[10px] font-semibold num whitespace-nowrap" style={{ color: 'var(--c-text-1)' }}>
                {r.t.asset} {r.open ? 'running' : fmtR(r.t.rrRatio)}
              </span>}
            </div>
            </div>
          )
        })}
        {isToday && nowPct >= 0 && nowPct <= 100 && (
          <div className="absolute top-0 bottom-0" style={{ left: `${nowPct}%`, width: 1.5, background: 'var(--c-accent)', boxShadow: '0 0 8px var(--c-accent)' }}>
            <span className="absolute -top-px -translate-x-1/2 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--c-accent)', left: '50%' }} />
          </div>
        )}
      </div>
      <div className="relative h-3 mt-1">
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => (
          <span key={h} className="absolute text-[9px] num -translate-x-1/2" style={{ left: `${(h / 24) * 100}%`, color: 'var(--c-text-3)' }}>
            {h === 24 ? '' : String(h).padStart(2, '0')}
          </span>
        ))}
      </div>
    </div>
  )
}
