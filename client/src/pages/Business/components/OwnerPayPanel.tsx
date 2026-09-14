import { Section } from '../../../components/ui/Section'
import { Th, Td, TablePanel, THead, Row, TotalRow, MiniBtn, EmptyRow } from './primitives'
import { formatDate } from '../../../lib/utils'
import type { OwnerPay } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

/**
 * What the partners have taken, and what it was safe to take.
 *
 * Safe to draw is a recommendation, not a rule: collected, minus what it cost to
 * earn, minus a tax reserve, minus a buffer of running costs. Drawing more is a
 * decision rather than an error, but nothing in the app said so before, and the
 * Dashboard reported the money as if it were still in the business.
 */
export function OwnerPayPanel({
  ownerPay, fmtView, periodLabel, onRecordDraw, onDeleteDraw, onSettings,
}: {
  ownerPay: OwnerPay
  fmtView: FmtView
  periodLabel: string
  onRecordDraw: () => void
  onDeleteDraw: (id: number) => void
  onSettings: () => void
}) {
  const op = ownerPay
  const safe = Math.max(op.safeToDraw, 0)

  return (
    <Section
      label="Owner's pay"
      action={
        <>
          <MiniBtn onClick={onSettings}>What to hold back</MiniBtn>
          <MiniBtn tone="good" onClick={onRecordDraw}>+ Record a draw</MiniBtn>
        </>
      }
    >
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(260px, 340px) 1fr' }}>
        <div className="rounded-xl px-4 py-4" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-3)' }}>
            Safe to draw {periodLabel}
          </div>
          <div className="text-3xl font-extrabold num tracking-tight leading-none"
            style={{ color: op.safeToDraw >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>
            {fmtView(safe)}
          </div>

          <div className="text-[11px] mt-3 space-y-1" style={{ color: 'var(--c-text-3)' }}>
            <Line label="Net profit" value={fmtView(op.netProfit)} />
            {op.taxReserveEnabled && (
              <Line label={`Tax reserve at ${op.taxRatePct}%`} value={`- ${fmtView(op.taxReserve)}`} />
            )}
            {op.bufferMonths > 0 && (
              <Line label={`Buffer, ${op.bufferMonths} month${op.bufferMonths === 1 ? '' : 's'} of costs`}
                value={`- ${fmtView(op.buffer)}`} />
            )}
            {!op.taxReserveEnabled && (
              <p className="pt-1" style={{ color: 'var(--c-text-3)' }}>
                No tax is being held back. Turn the reserve on once you know your rate.
              </p>
            )}
          </div>

          {op.overdrawn > 0 && (
            <div className="mt-3 px-3 py-2 rounded-lg text-[11px] leading-relaxed"
              style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.22)', color: '#fcd34d' }}>
              You drew <b className="num">{fmtView(op.drawnPeriod)}</b> against <b className="num">{fmtView(safe)}</b> safe
              {' '}{periodLabel}, so <b className="num">{fmtView(op.overdrawn)}</b> came out of retained cash.
            </div>
          )}
        </div>

        <TablePanel>
          <table className="w-full">
            <THead>
              <Th>Partner</Th>
              <Th align="right">Share</Th>
              <Th align="right">{periodLabel === 'all time' ? 'This period' : periodLabel}</Th>
              <Th align="right">All time</Th>
              <Th align="right">Their share of profit</Th>
              <Th align="right">Left to draw</Th>
            </THead>
            <tbody>
              {op.owners.length === 0 ? (
                <EmptyRow colSpan={6}>No partners set up.</EmptyRow>
              ) : op.owners.map(o => {
                return (
                  <Row key={o.id}>
                    <Td><span className="font-medium">{o.name}</span></Td>
                    <Td align="right" mono color="var(--c-text-3)">{o.sharePct}%</Td>
                    <Td align="right" mono>{o.period ? fmtView(o.period) : '--'}</Td>
                    <Td align="right" mono className="font-semibold">{fmtView(o.lifetime)}</Td>
                    <Td align="right" mono color="var(--c-text-3)">{fmtView(o.entitled)}</Td>
                    <Td align="right">
                      <span className="num text-[11px] font-semibold px-1.5 py-0.5 rounded inline-block"
                        style={o.delta > 0
                          ? { background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }
                          : { background: 'rgba(52,211,153,0.15)', color: 'var(--c-profit)' }}>
                        {o.delta > 0 ? `${fmtView(o.delta)} over` : fmtView(o.leftToDraw)}
                      </span>
                    </Td>
                  </Row>
                )
              })}
            </tbody>
            {op.owners.length > 0 && (
              <TotalRow>
                <Td colSpan={2}>Taken</Td>
                <Td align="right" mono>{fmtView(op.drawnPeriod)}</Td>
                <Td align="right" mono>{fmtView(op.drawnAllTime)}</Td>
                <Td align="right" mono>{fmtView(op.allTimeDistributable)}</Td>
                <Td align="right" mono color="var(--c-text-3)">
                  {op.allTimeDistributable > 0
                    ? `${Math.round((op.drawnAllTime / op.allTimeDistributable) * 100)}% drawn`
                    : '--'}
                </Td>
              </TotalRow>
            )}
          </table>

          {op.recent.length > 0 && (
            <div style={{ borderTop: '1px solid var(--c-border)' }}>
              <div className="px-3 pt-3 pb-1 text-[9.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
                Recent draws
              </div>
              <table className="w-full">
                <tbody>
                  {op.recent.slice(0, 6).map(d => (
                    <Row key={d.id}>
                      <Td mono color="var(--c-text-3)">{formatDate(d.date)}</Td>
                      <Td>{d.ownerName}</Td>
                      <Td color="var(--c-text-3)">{d.notes ?? d.method ?? 'transfer'}</Td>
                      <Td color="var(--c-text-3)">
                        {d.postedToFinances ? 'also in Finances' : 'business only'}
                      </Td>
                      <Td align="right" mono className="font-semibold">{fmtView(d.amount)}</Td>
                      <Td align="right"><MiniBtn tone="danger" onClick={() => onDeleteDraw(d.id)}>Remove</MiniBtn></Td>
                    </Row>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TablePanel>
      </div>
    </Section>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="num" style={{ color: 'var(--c-text-2)' }}>{value}</span>
    </div>
  )
}
