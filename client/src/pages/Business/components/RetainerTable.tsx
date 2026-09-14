import { useMemo } from 'react'
import { Section } from '../../../components/ui/Section'
import { Th, Td, TablePanel, THead, Row, TotalRow, MiniBtn, StatusDot, EmptyRow } from './primitives'
import { formatDate } from '../../../lib/utils'
import type { Retainer } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

const PER_MONTH: Record<string, number> = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }

function monthsBetween(from: string, to: Date): number {
  const d = new Date(from)
  return Math.max(0, (to.getFullYear() - d.getFullYear()) * 12 + (to.getMonth() - d.getMonth()))
}

/**
 * The subscription book.
 *
 * Change price is the important button here. Nothing in the app could record one
 * before, so `business_retainer_changes` was empty and expansion and contraction
 * MRR were permanently zero. Cancel matters for a different reason: the old
 * generator had no end-date check, so a cancelled retainer billed forever.
 */
export function RetainerTable({
  retainers, fmtView, onOpenClient, onAction, onNew,
}: {
  retainers: Retainer[]
  fmtView: FmtView
  onOpenClient: (id: number) => void
  onAction: (r: Retainer, action: 'price' | 'pause' | 'resume' | 'cancel') => void
  onNew: () => void
}) {
  const now = new Date()
  const active = retainers.filter(r => r.status === 'active')
  const totalMrr = useMemo(
    () => active.reduce((s, r) => s + r.amount * (PER_MONTH[r.frequency] ?? 1), 0),
    [retainers],
  )
  const sorted = useMemo(() => [...retainers].sort((a, b) => {
    const rank = (r: Retainer) => (r.status === 'active' ? 0 : r.status === 'paused' ? 1 : 2)
    return rank(a) - rank(b) || b.amount - a.amount
  }), [retainers])

  return (
    <Section
      label="Retainers"
      count={`${active.length} active${retainers.length !== active.length ? ` of ${retainers.length}` : ''}`}
      action={<MiniBtn tone="accent" onClick={onNew}>+ New retainer</MiniBtn>}
    >
      <TablePanel>
        <table className="w-full">
          <THead>
            <Th>Client</Th><Th>Service</Th><Th align="right">Amount</Th><Th align="right">Started</Th>
            <Th align="right">Tenure</Th><Th align="right">Next invoice</Th><Th align="right">Share of MRR</Th>
            <Th>Status</Th><Th />
          </THead>
          <tbody>
            {sorted.length === 0 ? (
              <EmptyRow colSpan={9}>
                No retainers yet. A retainer is what turns one-off work into income that arrives without asking.
              </EmptyRow>
            ) : sorted.map(r => {
              const monthly = r.amount * (PER_MONTH[r.frequency] ?? 1)
              const tenure = monthsBetween(r.startDate, now)
              const isActive = r.status === 'active'
              return (
                <Row key={r.id} dim={r.status === 'cancelled'}>
                  <Td>
                    <button type="button" onClick={() => onOpenClient(r.clientId)}
                      className="font-medium hover:underline text-left" style={{ color: 'var(--c-text-1)' }}>
                      {r.clientName}
                    </button>
                  </Td>
                  <Td color="var(--c-text-2)">{r.serviceName}</Td>
                  <Td align="right" mono className="font-semibold" color="var(--c-accent)">
                    {fmtView(r.amount)}
                    {r.frequency !== 'monthly' && <span className="ml-1" style={{ color: 'var(--c-text-3)' }}>/{r.frequency.slice(0, 2)}</span>}
                  </Td>
                  <Td align="right" mono color="var(--c-text-3)">{formatDate(r.startDate)}</Td>
                  <Td align="right" mono color="var(--c-text-2)">{tenure} mo</Td>
                  <Td align="right" mono color={isActive ? 'var(--c-text-1)' : 'var(--c-text-3)'}>
                    {isActive && r.nextInvoiceDate ? formatDate(r.nextInvoiceDate)
                      : r.endDate ? `ended ${formatDate(r.endDate)}`
                      : r.status === 'paused' ? 'paused' : '--'}
                  </Td>
                  <Td align="right" mono color="var(--c-text-3)">
                    {isActive && totalMrr > 0 ? `${((monthly / totalMrr) * 100).toFixed(1)}%` : '--'}
                  </Td>
                  <Td>
                    <StatusDot status={isActive ? 'paid' : r.status === 'paused' ? 'unpaid' : 'draft'} />
                  </Td>
                  <Td align="right">
                    <div className="flex gap-1.5 justify-end">
                      {r.status !== 'cancelled' && <MiniBtn onClick={() => onAction(r, 'price')}>Change price</MiniBtn>}
                      {isActive && <MiniBtn onClick={() => onAction(r, 'pause')}>Pause</MiniBtn>}
                      {r.status === 'paused' && <MiniBtn tone="good" onClick={() => onAction(r, 'resume')}>Resume</MiniBtn>}
                      {r.status !== 'cancelled' && <MiniBtn tone="danger" onClick={() => onAction(r, 'cancel')}>Cancel</MiniBtn>}
                    </div>
                  </Td>
                </Row>
              )
            })}
          </tbody>
          {active.length > 0 && (
            <TotalRow>
              <Td colSpan={2}>{active.length} active</Td>
              <Td align="right" mono color="var(--c-accent)">{fmtView(totalMrr)}/mo</Td>
              <Td colSpan={3} />
              <Td align="right" mono>100%</Td>
              <Td colSpan={2} />
            </TotalRow>
          )}
        </table>
      </TablePanel>
    </Section>
  )
}
