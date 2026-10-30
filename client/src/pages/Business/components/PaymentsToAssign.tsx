import { useState } from 'react'
import { Section } from '../../../components/ui/Section'
import { MiniBtn } from './primitives'
import { PaymentAllocator } from './PaymentAllocator'
import { useUnassignedPayments, useIgnorePayment, useClients } from '../../../hooks/useBusiness'
import { formatDate } from '../../../lib/utils'
import type { FmtView } from '../../../hooks/useFmtView'
import type { Client } from '../lib/types'

/**
 * Payments Stripe reported that the app would not attribute on its own.
 *
 * Confident matches are applied before this renders, so what is left is
 * genuinely ambiguous: a generic payer name, a shared card, an amount nobody is
 * owed. Confirming one ties the Stripe customer to the client, and the next
 * payment from them is certain regardless of what they type.
 *
 * The picking itself lives in PaymentAllocator, shared with the Payments view
 * where an assigned payment can be moved after the fact.
 */
export function PaymentsToAssign({ fmtView }: { fmtView: FmtView }) {
  const { data } = useUnassignedPayments()
  const { data: clients = [] } = useClients()
  const ignore = useIgnorePayment()
  const [openRow, setOpenRow] = useState<number | null>(null)

  const payments = data?.payments ?? []
  if (!payments.length) return null

  return (
    <Section
      label="Payments to assign"
      count={payments.length}
      action={<span className="text-[10.5px]" style={{ color: 'var(--c-text-3)' }}>
        Confirming one ties that Stripe customer to the client, so it never asks again
      </span>}
    >
      <div className="rounded-xl overflow-hidden"
        style={{ background: 'var(--c-bg-card)', border: '1px solid rgba(245,158,11,0.25)' }}>
        {payments.map((p: any, idx: number) => {
          const isOpen = openRow === p.id
          return (
            <div key={p.id} style={{ borderTop: idx ? '1px solid rgba(255,255,255,0.045)' : 'none' }}>
              <div className="flex items-center gap-4 px-4 py-2.5 flex-wrap">
                <span className="w-24 shrink-0 text-[13px] font-semibold num" style={{ color: 'var(--c-text-1)' }}>
                  {fmtView(p.amountGross)}
                </span>
                <span className="w-20 shrink-0 text-[11px] num" style={{ color: 'var(--c-text-3)' }}>
                  {p.fee ? `${fmtView(p.fee)} fee` : ''}
                </span>
                <span className="w-40 shrink-0 text-xs truncate" style={{ color: 'var(--c-text-2)' }}>
                  {p.payerName || p.payerEmail || 'no name given'}
                </span>
                <span className="w-20 shrink-0 text-[11px] num" style={{ color: 'var(--c-text-3)' }}>
                  {formatDate(p.paidDate)}
                </span>
                <span className="flex-1 min-w-[180px] text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                  {p.subscriptionId && (
                    <b style={{ color: '#34d399' }}>
                      {p.billingReason === 'subscription_create' ? 'new subscription' : 'subscription renewal'}
                      {' · '}
                    </b>
                  )}
                  {p.suggestedClientName
                    ? <>likely <b style={{ color: 'var(--c-text-2)' }}>{p.suggestedClientName}</b> · {p.matchReason}</>
                    : p.matchReason}
                </span>
                <span className="flex gap-1.5 shrink-0">
                  <MiniBtn tone={p.matchedClientId && !isOpen ? 'good' : 'default'}
                    onClick={() => setOpenRow(isOpen ? null : p.id)}>
                    {isOpen ? 'Close' : p.matchedClientId
                      ? `Yes, ${String(p.suggestedClientName ?? '').split(' ')[0]}...`
                      : 'Pick a client'}
                  </MiniBtn>
                  <MiniBtn tone="danger" onClick={() => ignore.mutate(p.id)} title="Not business income">
                    Not income
                  </MiniBtn>
                </span>
              </div>

              {isOpen && (
                <PaymentAllocator
                  payment={{
                    id: p.id, amountGross: p.amountGross, fee: p.fee,
                    payerName: p.payerName, payerEmail: p.payerEmail,
                    clientId: p.matchedClientId ?? null, decided: false,
                    subscriptionId: p.subscriptionId, billingReason: p.billingReason,
                    planAmount: p.planAmount, planIntervalDays: p.planIntervalDays,
                  }}
                  clients={clients as Client[]}
                  fmtView={fmtView}
                  onDone={() => setOpenRow(null)}
                />
              )}
            </div>
          )
        })}
      </div>
      <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--c-text-3)' }}>
        The fee on each of these is already exact, so nothing is lost by leaving one here. Anything assigned
        can be moved later from Invoices, Payments.
      </p>
    </Section>
  )
}
