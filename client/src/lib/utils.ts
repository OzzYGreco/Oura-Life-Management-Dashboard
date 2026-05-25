import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(n: number | null | undefined): string {
  if (n == null) return '--'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)
}

export function formatGBP(n: number | null | undefined): string {
  if (n == null) return '--'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n)
}

export function formatEUR(n: number | null | undefined): string {
  if (n == null) return '--'
  return new Intl.NumberFormat('en-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(n)
}

/** Format an amount in any currency code */
export function formatInCurrency(n: number, code: string): string {
  if (code === 'GBP') return formatGBP(n)
  if (code === 'EUR') return formatEUR(n)
  return formatCurrency(n) // USD default
}

/**
 * Convert amount between currencies using rates relative to GBP.
 * rates['USD'] = USD per 1 GBP, rates['EUR'] = EUR per 1 GBP, etc.
 */
export function convertAmount(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount
  const inGBP = from === 'GBP' ? amount : amount / (rates[from] ?? 1)
  return to === 'GBP' ? inGBP : inGBP * (rates[to] ?? 1)
}

export function formatPnl(n: number | null | undefined): string {
  if (n == null) return '--'
  const s = formatCurrency(Math.abs(n))
  return n >= 0 ? `+${s}` : `-${s}`
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return '--'
  try { return format(parseISO(d), 'MMM d, yyyy') } catch { return d }
}

export function formatDateShort(d: string | null | undefined): string {
  if (!d) return '--'
  try { return format(parseISO(d), 'MM/dd') } catch { return d }
}

export function formatPct(n: number | null | undefined): string {
  if (n == null) return '--'
  return `${n.toFixed(1)}%`
}

export function pnlColor(n: number | null | undefined): string {
  if (n == null) return 'text-text-secondary'
  return n >= 0 ? 'text-pnl-profit' : 'text-pnl-loss'
}

/**
 * Format a price with $ prefix and thousand separators.
 * Keeps up to 6 decimal places so tiny prices (e.g. 0.06296993) stay readable.
 */
export function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '--'
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 6 })
}

/**
 * Format a position size.
 * Crypto: up to 3 decimal places (e.g. 0.402, 1.899, 34083).
 * Everything else: raw number (integers for stocks, etc.).
 */
export function fmtSize(n: number | null | undefined, instrument?: string | null): string {
  if (n == null) return '--'
  if (instrument === 'Crypto') {
    return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
  }
  return String(n)
}

/** Returns today's date in YYYY-MM-DD using LOCAL time, not UTC.
 *  Using toISOString() would return the UTC date, which is wrong for
 *  users east of UTC — e.g. at 00:37 in UTC+3, UTC is still the previous day. */
export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
