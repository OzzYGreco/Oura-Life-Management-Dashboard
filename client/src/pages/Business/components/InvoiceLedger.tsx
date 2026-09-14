import { Fragment, useMemo, useState } from 'react'
import { Search, ChevronRight, ChevronDown } from 'lucide-react'
import { Section } from '../../../components/ui/Section'
import {
  Th, Td, TablePanel, THead, Row, TotalRow, MiniBtn, StatusDot, EmptyRow, fmtMonthYear,
} from './primitives'
import { formatDate } from '../../../lib/utils'
import type { LedgerRow, LedgerTotals } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

type SortKey = 'issueDate' | 'clientName' | 'gross' | 'net' | 'dueDate' | 'status'
const STATUSES = ['all', 'paid', 'unpaid', 'overdue', 'draft'] as const
const KINDS = [
  { key: 'all', label: 'Any' },
  { key: 'retainer', label: 'Retainer' },
  { key: 'website', label: 'Website' },
  { key: 'oneoff', label: 'One-off' },
] as const

/**
 * The invoice ledger.
 *
 * What it fixes, in order of how much it matters:
 *   1. Money is right-aligned and monospaced, so figures line up on the decimal.
 *   2. One row type, in date order, grouped by month with a subtotal per month.
 *      The old table emitted all 16 retainer groups first and all one-off
 *      invoices after, each block unsorted, which destroyed chronology.
 *   3. A What column naming the service and the kind, so the ledger can be read
 *      without decoding invoice numbers.
 *   4. Gross, fee and net as separate columns, which is where gross volume and
 *      net volume stop being an abstraction.
 *   5. Mark paid is a button you can see without hovering.
 */
export function InvoiceLedger({
  rows, totals, fmtView, onPay, onOpenClient, onEdit, onSend, onNewInvoice,
}: {
  rows: LedgerRow[]
  totals: LedgerTotals
  fmtView: FmtView
  onPay: (row: LedgerRow) => void
  onOpenClient: (id: number) => void
  onEdit: (row: LedgerRow) => void
  onSend: (row: LedgerRow) => void
  onNewInvoice: () => void
}) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all')
  const [kind, setKind] = useState<(typeof KINDS)[number]['key']>('all')
  const [sort, setSort] = useState<SortKey>('issueDate')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  /**
   * Collapsed months. Null means "not decided yet", which lets the default
   * (the two most recent months open) apply until the first click, without
   * fighting a filter change that brings different months into view.
   */
  const [closed, setClosed] = useState<Set<string> | null>(null)

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    const filtered = rows.filter(r =>
      (status === 'all' || r.status === status) &&
      (kind === 'all' || r.kind === kind) &&
      (!term
        || r.invoiceNumber.toLowerCase().includes(term)
        || r.clientName.toLowerCase().includes(term)
        || r.what.toLowerCase().includes(term)
        || (r.notes ?? '').toLowerCase().includes(term)))

    const mul = dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'clientName': return mul * a.clientName.localeCompare(b.clientName)
        case 'status':     return mul * a.status.localeCompare(b.status)
        case 'gross':      return mul * (a.gross - b.gross)
        case 'net':        return mul * ((a.net ?? 0) - (b.net ?? 0))
        case 'dueDate':    return mul * a.dueDate.localeCompare(b.dueDate)
        default:           return mul * (a.issueDate.localeCompare(b.issueDate) || a.id - b.id)
      }
    })
  }, [rows, q, status, kind, sort, dir])

  /** Month grouping only makes sense while the rows are in date order. */
  const grouped = sort === 'issueDate'
  const months = useMemo(() => {
    if (!grouped) return []
    const map = new Map<string, LedgerRow[]>()
    for (const r of shown) {
      const key = r.issueDate.slice(0, 7)
      const list = map.get(key)
      if (list) list.push(r)
      else map.set(key, [r])
    }
    return [...map.entries()]
  }, [shown, grouped])

  const recentTwo = useMemo(() => new Set(months.slice(0, 2).map(([m]) => m)), [months])
  const isOpen = (month: string) => (closed ? !closed.has(month) : recentTwo.has(month))
  const toggle = (month: string) => setClosed(prev => {
    const base = prev ?? new Set(months.filter(([m]) => !recentTwo.has(m)).map(([m]) => m))
    const next = new Set(base)
    next.has(month) ? next.delete(month) : next.add(month)
    return next
  })
  const openCount = months.filter(([m]) => isOpen(m)).length

  const sums = useMemo(() => ({
    gross: shown.reduce((s, r) => s + r.gross, 0),
    fee:   shown.reduce((s, r) => s + r.fee, 0),
    net:   shown.filter(r => r.status === 'paid').reduce((s, r) => s + (r.net ?? 0), 0),
  }), [shown])

  const head = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <Th align={align} sorted={sort === key ? dir : null}
      onClick={() => { if (sort === key) setDir(d => (d === 'asc' ? 'desc' : 'asc')); else { setSort(key); setDir('desc') } }}>
      {label}
    </Th>
  )

  return (
    <Section
      label="Ledger"
      count={shown.length !== rows.length ? `${shown.length} of ${rows.length}` : undefined}
      action={
        <>
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--c-text-3)' }} />
            <input
              id="ledger-search"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="INV-034, client, service"
              className="pl-7 pr-2.5 py-1 rounded-md text-[11px] w-52 outline-none"
              style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }}
            />
          </div>
          {/* Two filter groups side by side need saying apart, or the two
              "All" buttons read as one broken control. */}
          <div className="flex items-center gap-1.5">
            <span className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Status</span>
            {STATUSES.map(s => (
              <MiniBtn key={s} tone={status === s ? 'accent' : 'default'} onClick={() => setStatus(s)}>
                {s === 'all' ? 'Any' : s}
              </MiniBtn>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Kind</span>
            {KINDS.map(k => (
              <MiniBtn key={k.key} tone={kind === k.key ? 'accent' : 'default'} onClick={() => setKind(k.key)}>
                {k.label}
              </MiniBtn>
            ))}
          </div>
          {grouped && months.length > 1 && (
            <MiniBtn onClick={() => setClosed(openCount > 0 ? new Set(months.map(([m]) => m)) : new Set())}>
              {openCount > 0 ? 'Collapse all' : 'Expand all'}
            </MiniBtn>
          )}
          <MiniBtn tone="accent" onClick={onNewInvoice}>+ New invoice</MiniBtn>
        </>
      }
    >
      <TablePanel>
        <table className="w-full">
          <THead>
            <Th>#</Th>
            {head('clientName', 'Client', 'left')}
            <Th>What</Th>
            {head('gross', 'Gross')}
            <Th align="right">Fee</Th>
            {head('net', 'Net')}
            {head('issueDate', 'Issued')}
            {head('dueDate', 'Due')}
            <Th align="right">Paid</Th>
            {head('status', 'Status', 'left')}
            <Th />
          </THead>
          <tbody>
            {shown.length === 0 ? (
              <EmptyRow colSpan={11}>
                {rows.length ? 'Nothing matches those filters.' : 'No invoices yet.'}
              </EmptyRow>
            ) : grouped ? months.map(([month, list]) => (
              <Fragment key={month}>
                <tr>
                  <td colSpan={11} className="p-0"
                    style={{ background: 'rgba(129,140,248,0.07)', borderTop: '1px solid rgba(129,140,248,0.16)' }}>
                    {/* The whole header is the toggle. A month that is shut still
                        shows its totals, so nothing is hidden, only the detail. */}
                    <button
                      type="button"
                      onClick={() => toggle(month)}
                      aria-expanded={isOpen(month)}
                      className="w-full flex items-baseline justify-between gap-4 flex-wrap px-3 py-2 text-left"
                    >
                      <span className="flex items-center gap-1.5">
                        {isOpen(month)
                          ? <ChevronDown size={12} style={{ color: 'var(--c-accent)' }} />
                          : <ChevronRight size={12} style={{ color: 'var(--c-accent)' }} />}
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-accent)' }}>
                          {fmtMonthYear(month)}
                        </span>
                      </span>
                      <span className="text-[11px] num" style={{ color: 'var(--c-text-2)' }}>
                        {list.length} invoice{list.length === 1 ? '' : 's'}
                        {' · '}{fmtView(list.reduce((s, r) => s + r.gross, 0))} billed
                        {' · '}{fmtView(list.filter(r => r.status === 'paid').reduce((s, r) => s + (r.net ?? 0), 0))} collected
                        {(() => {
                          const owed = list.filter(r => r.status !== 'paid' && r.status !== 'draft')
                            .reduce((s, r) => s + r.gross, 0)
                          return owed > 0
                            ? <span style={{ color: '#f59e0b' }}>{' · '}{fmtView(owed)} owed</span>
                            : null
                        })()}
                      </span>
                    </button>
                  </td>
                </tr>
                {isOpen(month) && list.map(r => (
                  <LedgerTableRow key={r.id} r={r} fmtView={fmtView}
                    onPay={onPay} onOpenClient={onOpenClient} onEdit={onEdit} onSend={onSend} />
                ))}
              </Fragment>
            )) : shown.map(r => (
              <LedgerTableRow key={r.id} r={r} fmtView={fmtView}
                onPay={onPay} onOpenClient={onOpenClient} onEdit={onEdit} onSend={onSend} />
            ))}
          </tbody>
          {shown.length > 0 && (
            <TotalRow>
              <Td colSpan={3}>
                {shown.length} invoice{shown.length === 1 ? '' : 's'}
                {totals.avgDaysToPay != null && (
                  <span className="font-normal ml-2" style={{ color: 'var(--c-text-3)' }}>
                    paid in {totals.avgDaysToPay} days on average
                  </span>
                )}
              </Td>
              <Td align="right" mono>{fmtView(sums.gross)}</Td>
              <Td align="right" mono color="var(--c-text-3)">{fmtView(sums.fee)}</Td>
              <Td align="right" mono color="var(--c-profit)">{fmtView(sums.net)}</Td>
              <Td colSpan={5} />
            </TotalRow>
          )}
        </table>
      </TablePanel>
    </Section>
  )
}

function LedgerTableRow({
  r, fmtView, onPay, onOpenClient, onEdit, onSend,
}: {
  r: LedgerRow
  fmtView: FmtView
  onPay: (r: LedgerRow) => void
  onOpenClient: (id: number) => void
  onEdit: (r: LedgerRow) => void
  onSend: (r: LedgerRow) => void
}) {
  const paid = r.status === 'paid'
  return (
    <Row dim={r.status === 'draft'}>
      <Td mono color="var(--c-text-3)">{r.invoiceNumber}</Td>
      <Td>
        <button type="button" onClick={() => onOpenClient(r.clientId)}
          className="font-medium hover:underline text-left" style={{ color: 'var(--c-text-1)' }}>
          {r.clientName}
        </button>
      </Td>
      <Td color="var(--c-text-2)">{r.what}</Td>
      <Td align="right" mono className="font-semibold">{fmtView(r.gross)}</Td>
      <Td align="right" mono color="var(--c-text-3)">{r.fee ? fmtView(r.fee) : paid ? fmtView(0) : '--'}</Td>
      <Td align="right" mono color={paid ? 'var(--c-profit)' : 'var(--c-text-3)'}>
        {r.net != null ? fmtView(r.net) : '--'}
      </Td>
      <Td align="right" mono color="var(--c-text-3)">{formatDate(r.issueDate)}</Td>
      <Td align="right" mono color={r.status === 'overdue' ? 'var(--c-loss)' : paid ? 'var(--c-text-3)' : '#f59e0b'}>
        {formatDate(r.dueDate)}
      </Td>
      <Td align="right" mono color="var(--c-text-3)">{r.paidDate ? formatDate(r.paidDate) : '--'}</Td>
      <Td><StatusDot status={r.status} /></Td>
      <Td align="right">
        <div className="flex gap-1.5 justify-end">
          {r.status === 'draft' && <MiniBtn tone="accent" onClick={() => onSend(r)}>Send</MiniBtn>}
          {!paid && <MiniBtn tone="good" onClick={() => onPay(r)}>Mark paid</MiniBtn>}
          <MiniBtn onClick={() => onEdit(r)} title="Edit, or record a card fee">Edit</MiniBtn>
        </div>
      </Td>
    </Row>
  )
}
