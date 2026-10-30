import { Fragment, useMemo, useState } from 'react'
import { useUrlState } from '../lib/useUrlState'
import { Search } from 'lucide-react'
import { Section } from '../../../components/ui/Section'
import { Th, Td, TablePanel, THead, Row, TotalRow, MiniBtn, EmptyRow, Pill } from './primitives'
import { PaymentAllocator } from './PaymentAllocator'
import {
  usePayments, useClients, useAssignPayment, useUnignorePayment, useRemoveAllocation,
} from '../../../hooks/useBusiness'
import { formatDate } from '../../../lib/utils'
import type { FmtView } from '../../../hooks/useFmtView'
import type { Client, PaymentRow } from '../lib/types'

const FILTERS = [
  { key: 'all',     label: 'Any' },
  { key: 'assign',  label: 'To assign' },
  { key: 'gap',     label: 'Not fully placed' },
  { key: 'stripe',  label: 'Stripe' },
  { key: 'manual',  label: 'Recorded by hand' },
  { key: 'ignored', label: 'Not income' },
] as const

const HOW_COLOR: Record<PaymentRow['how'], string> = {
  'auto': 'var(--c-text-3)',
  'by hand': 'var(--c-accent)',
  'raised': '#a78bfa',
  'to assign': '#f59e0b',
  'not income': 'var(--c-loss)',
  'recorded': 'var(--c-text-2)',
}

/**
 * Every payment that came in, and what it paid for.
 *
 * Until this existed a payment, once decided, vanished from view: there was no
 * screen listing what Stripe had sent or where each payment had gone, so a wrong
 * match could not even be seen, let alone fixed. This is the other half of the
 * ledger: invoices say what was billed, this says what arrived. "Change" moves
 * a payment, releasing it from where it was in the same step.
 */
export function PaymentsLedger({ fmtView, onOpenClient }: { fmtView: FmtView; onOpenClient: (id: number) => void }) {
  const { data: rows = [], isPending } = usePayments()
  const { data: clients = [] } = useClients()
  const assign = useAssignPayment()
  const unignore = useUnignorePayment()
  const removeAlloc = useRemoveAllocation()

  const [q, setQ] = useUrlState('q', '')
  const [filter, setFilter] = useUrlState<(typeof FILTERS)[number]['key']>('show', 'all')
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const gapOf = (r: PaymentRow) => r.source === 'stripe' && r.how !== 'not income' && r.how !== 'to assign' && r.settled.length > 0
    ? r.unallocated : 0

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return rows.filter(r =>
      (filter === 'all'
        || (filter === 'assign' && r.how === 'to assign')
        || (filter === 'gap' && gapOf(r) > 0.005)
        || (filter === 'stripe' && r.source === 'stripe')
        || (filter === 'manual' && r.source !== 'stripe')
        || (filter === 'ignored' && r.how === 'not income'))
      && (!term
        || (r.payer ?? '').toLowerCase().includes(term)
        || (r.clientName ?? '').toLowerCase().includes(term)
        || r.settled.some(s => s.invoiceNumber.toLowerCase().includes(term))))
  }, [rows, q, filter])

  const sums = useMemo(() => {
    const counted = shown.filter(r => r.how !== 'not income')
    return {
      gross: counted.reduce((s, r) => s + r.gross, 0),
      fee: counted.reduce((s, r) => s + r.fee, 0),
      net: counted.reduce((s, r) => s + r.net, 0),
    }
  }, [shown])

  const gaps = rows.filter(r => gapOf(r) > 0.005)

  /** Old payments recorded at a different amount than Stripe charged: close the pennies. */
  const matchStripe = async (r: PaymentRow) => {
    setError(null)
    try {
      await assign.mutateAsync({
        id: r.paymentId!, clientId: r.clientId!, invoiceIds: r.settled.map(s => s.invoiceId), adjustToMatch: true,
      })
    } catch (e: any) { setError(e?.response?.data?.error ?? 'Could not save that') }
  }

  return (
    <Section
      label="Payments"
      count={shown.length !== rows.length ? `${shown.length} of ${rows.length}` : rows.length || undefined}
      action={
        <>
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--c-text-3)' }} />
            <input
              id="payments-search"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Payer, client, INV-034"
              className="pl-7 pr-2.5 py-1 rounded-md text-[11px] w-48 outline-none"
              style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }}
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {FILTERS.map(f => (
              <MiniBtn key={f.key} tone={filter === f.key ? 'accent' : 'default'} onClick={() => setFilter(f.key)}>
                {f.label}
              </MiniBtn>
            ))}
          </div>
        </>
      }
    >
      {gaps.length > 0 && filter !== 'gap' && (
        <div className="mb-3 px-4 py-2.5 rounded-xl text-[11px] flex items-center justify-between gap-3 flex-wrap"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.22)', color: 'var(--c-text-2)' }}>
          <span>
            <b className="num">{gaps.length}</b> payment{gaps.length === 1 ? '' : 's'} took more than the invoice{gaps.length === 1 ? '' : 's'} it
            settled says, <b className="num">{fmtView(gaps.reduce((s, r) => s + gapOf(r), 0))}</b> in all. Usually an
            invoice recorded net of the card fee. Making them match adds that to gross volume.
          </span>
          <MiniBtn onClick={() => setFilter('gap')}>Show them</MiniBtn>
        </div>
      )}
      {error && <p className="text-xs mb-2" style={{ color: 'var(--c-loss)' }}>{error}</p>}

      <TablePanel>
        <table className="w-full">
          <THead>
            <Th>Date</Th><Th>From</Th><Th>Client</Th>
            <Th align="right">Gross</Th><Th align="right">Fee</Th><Th align="right">Net</Th>
            <Th>Paid for</Th><Th>How</Th><Th />
          </THead>
          <tbody>
            {isPending ? (
              <EmptyRow colSpan={9}>Loading payments...</EmptyRow>
            ) : shown.length === 0 ? (
              <EmptyRow colSpan={9}>{rows.length ? 'Nothing matches that.' : 'No payments recorded yet.'}</EmptyRow>
            ) : shown.map(r => {
              const isOpen = open === r.key
              const gap = gapOf(r)
              return (
                <Fragment key={r.key}>
                  <Row dim={r.how === 'not income'}>
                    <Td mono color="var(--c-text-3)">{formatDate(r.date)}</Td>
                    <Td color="var(--c-text-2)" className="max-w-[160px] truncate">
                      {r.source === 'stripe' ? (r.payer ?? 'no name given') : r.source === 'cash' ? 'Cash' : 'Bank transfer'}
                    </Td>
                    <Td>
                      {r.clientId ? (
                        <button type="button" onClick={() => onOpenClient(r.clientId!)}
                          className="font-medium hover:underline text-left" style={{ color: 'var(--c-text-1)' }}>
                          {r.clientName}
                        </button>
                      ) : <span style={{ color: 'var(--c-text-3)' }}>--</span>}
                    </Td>
                    <Td align="right" mono className="font-semibold">{fmtView(r.gross)}</Td>
                    <Td align="right" mono color="var(--c-text-3)">{r.fee ? fmtView(r.fee) : '--'}</Td>
                    <Td align="right" mono color="var(--c-profit)">{fmtView(r.net)}</Td>
                    <Td>
                      <span className="flex items-center gap-1 flex-wrap">
                        {r.settled.length === 0 && r.how !== 'to assign' && r.how !== 'not income' && (
                          <span className="text-[11px]" style={{ color: '#f59e0b' }}>no invoice, not in totals</span>
                        )}
                        {r.settled.map(s => (
                          <span key={s.allocationId} className="num text-[10.5px] px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}
                            title={s.amount < s.invoiceAmount - 0.005 ? `${fmtView(s.amount)} of ${fmtView(s.invoiceAmount)}` : undefined}>
                            {s.invoiceNumber}{s.amount < s.invoiceAmount - 0.005 ? ` · ${fmtView(s.amount)}` : ''}
                          </span>
                        ))}
                        {gap > 0.005 && (
                          <span className="num text-[10.5px]" style={{ color: '#f59e0b' }}>{fmtView(gap)} not placed</span>
                        )}
                      </span>
                    </Td>
                    <Td>
                      <Pill color={HOW_COLOR[r.how]}>{r.how}</Pill>
                    </Td>
                    <Td align="right">
                      <div className="flex gap-1.5 justify-end">
                        {gap > 0.005 && gap <= 1 && r.clientId && (
                          <MiniBtn tone="accent" disabled={assign.isPending} onClick={() => matchStripe(r)}
                            title="Change the invoice to what Stripe actually charged">
                            Match Stripe
                          </MiniBtn>
                        )}
                        {r.source === 'stripe' && r.how === 'not income' && (
                          <MiniBtn onClick={() => unignore.mutate(r.paymentId!)}>It is income</MiniBtn>
                        )}
                        {r.source === 'stripe' && r.how !== 'not income' && (
                          <MiniBtn tone={r.how === 'to assign' ? 'good' : 'default'} onClick={() => setOpen(isOpen ? null : r.key)}>
                            {isOpen ? 'Close' : r.how === 'to assign' ? 'Assign' : 'Change'}
                          </MiniBtn>
                        )}
                        {r.source !== 'stripe' && r.allocationId && (
                          <MiniBtn tone="danger" disabled={removeAlloc.isPending}
                            onClick={() => removeAlloc.mutate(r.allocationId!)}
                            title="Remove this payment; the invoice goes back to owing it">
                            Remove
                          </MiniBtn>
                        )}
                      </div>
                    </Td>
                  </Row>
                  {isOpen && r.paymentId && (
                    <tr>
                      <td colSpan={9} style={{ background: 'rgba(129,140,248,0.04)' }}>
                        <PaymentAllocator
                          payment={{
                            id: r.paymentId, amountGross: r.gross, fee: r.fee,
                            payerName: r.payer, clientId: r.clientId, decided: r.how !== 'to assign',
                          }}
                          clients={clients as Client[]}
                          fmtView={fmtView}
                          onDone={() => setOpen(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
          {shown.length > 0 && (
            <TotalRow>
              <Td colSpan={3}>{shown.length} payment{shown.length === 1 ? '' : 's'}</Td>
              <Td align="right" mono>{fmtView(sums.gross)}</Td>
              <Td align="right" mono color="var(--c-text-3)">{fmtView(sums.fee)}</Td>
              <Td align="right" mono color="var(--c-profit)">{fmtView(sums.net)}</Td>
              <Td colSpan={3} />
            </TotalRow>
          )}
        </table>
      </TablePanel>
      <p className="text-[11px] mt-2.5 leading-relaxed" style={{ color: 'var(--c-text-3)' }}>
        Moving a payment releases it from the invoices it was on, which go back to open, and applies it to the new
        ones in the same step. An invoice that only existed because of the payment is voided when the payment leaves it.
      </p>
    </Section>
  )
}
