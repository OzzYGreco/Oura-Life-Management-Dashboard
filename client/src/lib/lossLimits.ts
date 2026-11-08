import type { Trade } from '../hooks/useTrades'
import type { TradingAccount } from '../hooks/useTradingAccounts'
import { isClosed, pnlOf, sum } from './tradeStats'

/**
 * Loss limits per account: how much of today's, this week's and this month's
 * allowance is used. A loss counts on the day the trade closed (UTC), net of
 * fees. Limits in R are measured against the account's full risk (1R), so
 * a $-loss of 2 x 1R is 2R whatever each trade planned. Running trades are
 * reported separately: what the limit would look like if they all stopped out.
 */

export type Period = 'day' | 'week' | 'month'
export type LimitState = 'ok' | 'caution' | 'warning' | 'hit'

export interface PeriodUse {
  period: Period
  label: string
  limit: number            // in unit
  used: number             // loss so far, in unit (0 when up)
  net: number              // period result, in unit (negative = loss)
  atRisk: number           // running trades' loss at their stops, in unit
  pct: number              // used / limit
  state: LimitState
  /** Full 1R losses still allowed before the limit (R accounts, or when 1R is known). */
  fullLossesLeft: number | null
  resetsAt: Date
}

export interface AccountLimits { account: TradingAccount; unit: 'R' | 'USD'; periods: PeriodUse[] }

const closedOn = (t: Trade) => (t.closedAt ? t.closedAt.slice(0, 10) : t.date)

export function periodStart(p: Period, now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if (p === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  if (p === 'month') d.setUTCDate(1)
  return d
}

function periodEnd(p: Period, start: Date): Date {
  const d = new Date(start)
  if (p === 'day') d.setUTCDate(d.getUTCDate() + 1)
  if (p === 'week') d.setUTCDate(d.getUTCDate() + 7)
  if (p === 'month') d.setUTCMonth(d.getUTCMonth() + 1)
  return d
}

const LABEL: Record<Period, string> = { day: 'Today', week: 'This week', month: 'This month' }

export function accountLimits(account: TradingAccount, trades: Trade[], now = new Date()): AccountLimits | null {
  const unit = account.lossLimitUnit ?? 'R'
  const oneR = account.fullRisk ?? null
  const limits: [Period, number | null | undefined][] = [['day', account.maxLossDay], ['week', account.maxLossWeek], ['month', account.maxLossMonth]]
  if (!limits.some(([, l]) => l) || (unit === 'R' && !oneR)) return null

  const mine = trades.filter(t => t.accountId === account.id)
  const toUnit = (usd: number) => (unit === 'R' ? usd / oneR! : usd)
  const running = mine.filter(t => t.source === 'bybit' && !isClosed(t))
  const atRiskUsd = sum(running.map(t => t.riskAtStop ?? 0))

  const periods = limits.filter(([, l]) => l).map(([period, limit]): PeriodUse => {
    const start = periodStart(period, now)
    const from = start.toISOString().slice(0, 10)
    const netUsd = sum(mine.filter(t => isClosed(t) && closedOn(t) >= from).map(t => pnlOf(t) ?? 0))
    const net = toUnit(netUsd)
    const used = Math.max(0, -net)
    const pct = used / limit!
    const left = Math.max(0, limit! - used)
    return {
      period, label: LABEL[period], limit: limit!, used, net, atRisk: toUnit(atRiskUsd), pct,
      state: pct >= 1 ? 'hit' : pct >= 0.75 ? 'warning' : pct >= 0.5 ? 'caution' : 'ok',
      fullLossesLeft: oneR ? Math.floor((unit === 'R' ? left : left / oneR) + 1e-9) : null,
      resetsAt: periodEnd(period, start),
    }
  })
  return { account, unit, periods }
}

export const fmtLimit = (v: number, unit: 'R' | 'USD') =>
  unit === 'R' ? `${+v.toFixed(2)}R` : `$${v.toLocaleString(undefined, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export function untilText(at: Date, now = new Date()) {
  const m = Math.max(0, Math.round((at.getTime() - now.getTime()) / 60_000))
  if (m < 60) return `${m}m`
  if (m < 48 * 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${Math.round(m / 1440)} days`
}

/** Used allowance is never good news: neutral slate, then yellow, amber, red. */
export const STATE_COLOR: Record<LimitState, string> = {
  ok: '#94a3b8', caution: '#eab308', warning: '#f59e0b', hit: 'var(--c-loss)',
}
