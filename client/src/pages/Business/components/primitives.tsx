import type { ReactNode, CSSProperties } from 'react'
import { STATUS_COLOR } from '../lib/types'

/**
 * Table and row parts shared across the Business tab.
 *
 * The rule these encode: money is right-aligned and monospaced. On the page this
 * replaces, the invoice Amount column was left-aligned, so £19.28 and £225.00
 * never lined up on the decimal and a 59-row ledger was unreadable at a glance.
 */

export function Th({
  children, align = 'left', width, onClick, sorted,
}: {
  children?: ReactNode
  align?: 'left' | 'right' | 'center'
  width?: string
  onClick?: () => void
  sorted?: 'asc' | 'desc' | null
}) {
  return (
    <th
      className={`text-[9.5px] font-bold uppercase tracking-wider px-3 py-2.5 whitespace-nowrap ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      } ${onClick ? 'cursor-pointer select-none' : ''}`}
      style={{ color: 'var(--c-text-3)', width }}
      onClick={onClick}
      {...(onClick ? { role: 'button', tabIndex: 0, onKeyDown: (e: any) => (e.key === 'Enter' || e.key === ' ') && onClick() } : {})}
    >
      {children}
      {sorted && <span className="ml-1" style={{ color: 'var(--c-accent)' }}>{sorted === 'asc' ? '↑' : '↓'}</span>}
    </th>
  )
}

export function Td({
  children, align = 'left', mono, color, className = '', colSpan, style,
}: {
  children?: ReactNode
  align?: 'left' | 'right' | 'center'
  mono?: boolean
  color?: string
  className?: string
  colSpan?: number
  style?: CSSProperties
}) {
  return (
    <td
      colSpan={colSpan}
      className={`px-3 py-2 text-xs whitespace-nowrap ${mono ? 'num' : ''} ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''
      } ${className}`}
      style={{ color: color ?? 'var(--c-text-1)', ...style }}
    >
      {children}
    </td>
  )
}

/** A table wrapped in the app's card chrome, with a tinted header row. */
export function TablePanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bz-table ${className}`}><div className="overflow-x-auto">{children}</div></div>
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr style={{ borderBottom: '1px solid var(--c-border-mid)' }}>{children}</tr>
    </thead>
  )
}

export function Row({ children, onClick, dim, tint }: {
  children: ReactNode; onClick?: () => void; dim?: boolean; tint?: string
}) {
  return (
    <tr
      onClick={onClick}
      className={`transition-colors ${onClick ? 'cursor-pointer' : ''} ${tint ? '' : 'hover:bg-[var(--c-bg-hover)]'}`}
      style={{
        borderBottom: '1px solid var(--c-border)',
        opacity: dim ? 0.4 : 1,
        background: tint,
      }}
    >
      {children}
    </tr>
  )
}

/** The accent-tinted totals row. */
export function TotalRow({ children }: { children: ReactNode }) {
  return (
    <tfoot>
      <tr style={{ borderTop: '1px solid var(--c-border-strong)' }}>
        {children}
      </tr>
    </tfoot>
  )
}

/** An action that is visible at rest. No hover-only buttons anywhere in this tab. */
/**
 * The one small button. Its colour says what pressing it does, everywhere:
 *
 *   accent  create, send, or the main next step
 *   good    money in, or something coming back (Mark paid, Resume, They are back)
 *   warn    caution: it holds, pauses or undoes something, and can be reversed
 *   danger  removes, voids, cancels or ends something
 *   default looking, editing, opening
 */
export type Tone = 'default' | 'good' | 'warn' | 'danger' | 'accent'

export function MiniBtn({
  children, onClick, tone = 'default', title, disabled,
}: {
  children: ReactNode
  onClick?: (e: React.MouseEvent) => void
  tone?: Tone
  title?: string
  disabled?: boolean
}) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={e => { e.stopPropagation(); onClick?.(e) }}
      className={`bz-mini ${tone}`}>
      {children}
    </button>
  )
}

export function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? 'var(--c-text-3)'
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold capitalize" style={{ color }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
      {status}
    </span>
  )
}

export function Pill({ children, color, bg }: { children: ReactNode; color: string; bg?: string }) {
  return <span className="bz-pill" style={{ color, background: bg ?? color + '1f' }}>{children}</span>
}

export function EmptyRow({ children, colSpan }: { children: ReactNode; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-xs" style={{ color: 'var(--c-text-3)' }}>
        {children}
      </td>
    </tr>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Short month label from a YYYY-MM key. Spelled out rather than taken from
 * toLocaleDateString, which renders September as "Sept" in newer ICU and makes
 * one column in a table wider than the rest.
 */
export function fmtMonth(key: string): string {
  return MONTHS[Number(key.split('-')[1]) - 1] ?? key
}

export function fmtMonthYear(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export function fmtHours(h: number): string {
  if (!h) return '0h'
  const whole = Math.floor(h)
  const mins = Math.round((h - whole) * 60)
  return mins ? `${whole}h ${mins}m` : `${whole}h`
}
