import { useMemo, useState } from 'react'
import { Th, Td, TablePanel, THead, Row, TotalRow, MiniBtn, EmptyRow } from './primitives'
import { formatDate } from '../../../lib/utils'
import type { FmtView } from '../../../hooks/useFmtView'

/** How many times a year each cadence is charged. */
const PER_YEAR: Record<string, number> = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 }
const CADENCE: Record<string, string> = {
  weekly: 'every week', monthly: 'every month', quarterly: 'every quarter', yearly: 'every year',
}

function addPeriod(date: string, frequency: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (frequency === 'weekly') dt.setDate(dt.getDate() + 7)
  else if (frequency === 'quarterly') dt.setMonth(dt.getMonth() + 3)
  else if (frequency === 'yearly') dt.setFullYear(dt.getFullYear() + 1)
  else dt.setMonth(dt.getMonth() + 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/**
 * Everything the business pays on a schedule: domains, mailboxes, tools.
 *
 * These have always been in the ledger, but only ever as a flat list of
 * individual charges mixed in with one-off purchases, so there was no way to
 * ask "what do I pay for every year, and who is it for?". A domain charged
 * once a year was effectively invisible for eleven months at a time.
 */
export function RecurringCosts({
  expenses, clients, fmtView, onEdit,
}: {
  expenses: any[]
  clients: { id: number; name: string }[]
  fmtView: FmtView
  onEdit: (expense: any) => void
}) {
  const [showAll, setShowAll] = useState(false)

  const rows = useMemo(() => {
    const clientName = (id: number | null) => clients.find(c => c.id === id)?.name ?? null

    // One row per commitment, not per charge: the template is the commitment,
    // and its generated children are just the times it has been paid.
    return expenses
      .filter(e => e.isRecurring && !e.recurringParentId && e.frequency)
      .map(e => {
        const charges = expenses.filter(c => c.recurringParentId === e.id || c.id === e.id)
        const lastCharged = charges.map(c => c.date).sort().at(-1) ?? e.date
        // What was actually billed most recently. If it differs from the
        // recurring amount, the next charge will revert to the old price and
        // nothing would otherwise say so.
        const latest = [...charges].sort((a, b) => a.date.localeCompare(b.date)).at(-1)
        // The price the next charge will use, which is not always what the
        // template row itself was charged.
        const ongoing = (e.recurringAmount ?? e.amount) as number
        const drift = latest && Math.abs((latest.amount ?? 0) - ongoing) > 0.005
          ? latest.amount as number
          : null
        return {
          drift,
          id: e.id,
          description: e.description,
          vendor: e.vendor as string | null,
          clientName: clientName(e.clientId ?? null),
          amount: ongoing,
          frequency: e.frequency as string,
          perYear: ongoing * (PER_YEAR[e.frequency] ?? 12),
          since: e.date as string,
          lastCharged,
          nextDue: addPeriod(lastCharged, e.frequency),
          timesPaid: charges.length,
          raw: e,
        }
      })
      .sort((a, b) => b.perYear - a.perYear)
  }, [expenses, clients])

  const shown = showAll ? rows : rows.slice(0, 10)
  const totalYear = rows.reduce((s, r) => s + r.perYear, 0)
  const attributed = rows.filter(r => r.clientName).reduce((s, r) => s + r.perYear, 0)

  const drifted = rows.filter(r => r.drift != null)

  return (
    <>
      {drifted.length > 0 && (
        <div className="mb-2.5 px-3.5 py-2.5 rounded-lg text-[11px] leading-relaxed"
          style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.22)', color: '#fcd34d' }}>
          {drifted.length === 1
            ? <><b>{drifted[0].description}</b> was last charged <span className="num">{fmtView(drifted[0].drift!)}</span> but
              still repeats at <span className="num">{fmtView(drifted[0].amount)}</span>.</>
            : <><b>{drifted.length} costs</b> were last charged a different amount from the one they repeat at.</>}
          {' '}The next charge will use the repeating amount, so fix the price if the plan changed.
        </div>
      )}
    <TablePanel>
      <table className="w-full">
        <THead>
          <Th>What you pay for</Th>
          <Th>Paid to</Th>
          <Th>For</Th>
          <Th align="right">Amount</Th>
          <Th>Repeats</Th>
          <Th align="right">A year</Th>
          <Th align="right">Since</Th>
          <Th align="right">Next due</Th>
          <Th />
        </THead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={9}>
              Nothing repeating yet. Domains, mailboxes and tools belong here so they are not
              re-entered by hand every renewal.
            </EmptyRow>
          ) : shown.map(r => (
            <Row key={r.id}>
              <Td><span className="font-medium">{r.description}</span></Td>
              <Td color="var(--c-text-3)">{r.vendor ?? '--'}</Td>
              <Td color={r.clientName ? 'var(--c-text-2)' : 'var(--c-text-3)'}>
                {r.clientName ?? 'the business'}
              </Td>
              <Td align="right" mono className="font-semibold">
                {fmtView(r.amount)}
                {r.drift != null && (
                  <span className="block text-[10px] font-normal" style={{ color: '#fbbf24' }}>
                    last charged {fmtView(r.drift)}
                  </span>
                )}
              </Td>
              <Td color="var(--c-text-2)">{CADENCE[r.frequency] ?? r.frequency}</Td>
              <Td align="right" mono color="var(--c-loss)">{fmtView(r.perYear)}</Td>
              <Td align="right" mono color="var(--c-text-3)">{formatDate(r.since)}</Td>
              <Td align="right" mono color="var(--c-text-2)">{formatDate(r.nextDue)}</Td>
              <Td align="right">
                <MiniBtn tone={r.drift != null ? 'accent' : 'default'} onClick={() => onEdit(r.raw)}>
                  {r.drift != null ? 'Fix price' : 'Edit'}
                </MiniBtn>
              </Td>
            </Row>
          ))}
          {rows.length > shown.length && (
            <tr>
              <td colSpan={9} className="px-4 py-2.5 text-center">
                <MiniBtn onClick={() => setShowAll(true)}>Show all {rows.length}</MiniBtn>
              </td>
            </tr>
          )}
        </tbody>
        {rows.length > 0 && (
          <TotalRow>
            <Td colSpan={2}>{rows.length} commitment{rows.length === 1 ? '' : 's'}</Td>
            <Td color="var(--c-text-2)" className="font-normal">
              {fmtView(attributed)} of it for clients
            </Td>
            <Td colSpan={2} />
            <Td align="right" mono color="var(--c-loss)">{fmtView(totalYear)}</Td>
            <Td colSpan={3} className="font-normal" color="var(--c-text-3)">
              about {fmtView(totalYear / 12)} a month
            </Td>
          </TotalRow>
        )}
      </table>
    </TablePanel>
    </>
  )
}
