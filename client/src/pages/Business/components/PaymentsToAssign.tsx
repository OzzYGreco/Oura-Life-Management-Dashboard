import { useMemo, useState } from 'react'
import { Section } from '../../../components/ui/Section'
import { MiniBtn } from './primitives'
import { ClientPicker } from './ClientPicker'
import {
  useUnassignedPayments, useAssignPayment, useIgnorePayment, useClients, useInvoices,
  useInvoiceFromPayment,
} from '../../../hooks/useBusiness'
import { formatDate } from '../../../lib/utils'
import type { FmtView } from '../../../hooks/useFmtView'
import type { Client, Invoice } from '../lib/types'

/**
 * Payments Stripe reported that the app would not attribute on its own.
 *
 * Confident matches are applied before this renders, so what is left is
 * genuinely ambiguous: a generic payer name, a shared card, an amount nobody is
 * owed. Confirming one ties the Stripe customer to the client, and the next
 * payment from them is certain regardless of what they type.
 *
 * Two things this has to get right that a simpler picker would not:
 *
 *   - It offers invoices that are already PAID. A payment for an invoice ticked
 *     off by hand still needs matching, because that is how the real fee lands
 *     on it rather than staying at zero.
 *   - It allows several invoices at once. A new client paying the website and
 *     the first month of SEO together is one payment settling two invoices, and
 *     the fee has to split across them.
 */
export function PaymentsToAssign({ fmtView }: { fmtView: FmtView }) {
  const { data } = useUnassignedPayments()
  const { data: clients = [] } = useClients()
  const { data: invoices = [] } = useInvoices()
  const assign = useAssignPayment()
  const ignore = useIgnorePayment()
  const raise = useInvoiceFromPayment()

  const [openRow, setOpenRow] = useState<number | null>(null)
  const [clientId, setClientId] = useState<number | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState<number | null>(null)

  const payments = data?.payments ?? []
  const taken = useMemo(() => new Set(data?.takenInvoiceIds ?? []), [data])

  if (!payments.length) return null

  const availableFor = (cid: number) => (invoices as Invoice[])
    .filter(i => i.clientId === cid && !taken.has(i.id))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate))

  const reset = () => { setOpenRow(null); setClientId(null); setPicked([]) }

  const submit = async (p: any) => {
    if (!clientId) return
    setBusy(p.id)
    try {
      await assign.mutateAsync({
        id: p.id,
        clientId,
        invoiceIds: picked.length ? picked : undefined,
        invoiceId: picked.length === 1 ? picked[0] : null,
        remember: true,
      })
      reset()
    } finally { setBusy(null) }
  }

  /**
   * Put the money on the books when there is no invoice to attach it to.
   *
   * Assigning to a client alone used to end here, and the payment then counted
   * for nothing: gross volume, fees and profit are all built from paid invoices,
   * so real money sat against a client and showed up in no figure at all.
   */
  const raiseInvoice = async (p: any) => {
    if (!clientId) return
    setBusy(p.id)
    try {
      await raise.mutateAsync({ id: p.id, clientId })
      reset()
    } finally { setBusy(null) }
  }

  const quickConfirm = async (p: any) => {
    const cid = p.matchedClientId
    if (!cid) return
    setBusy(p.id)
    try {
      const exact = availableFor(cid).find(i => Math.abs(i.amount - p.amountGross) < 0.01)
      await assign.mutateAsync({ id: p.id, clientId: cid, invoiceId: exact?.id ?? null, remember: true })
    } finally { setBusy(null) }
  }

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
          const chosen = clientId ? (clients as Client[]).find(c => c.id === clientId) ?? null : null
          const rows = clientId ? availableFor(clientId) : []
          const selected = rows.filter(i => picked.includes(i.id))
          const total = selected.reduce((s, i) => s + i.amount, 0)
          const gap = Math.round((p.amountGross - total) * 100) / 100

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
                  {p.suggestedClientName
                    ? <>likely <b style={{ color: 'var(--c-text-2)' }}>{p.suggestedClientName}</b> · {p.matchReason}</>
                    : p.matchReason}
                </span>
                <span className="flex gap-1.5 shrink-0">
                  {p.matchedClientId && !isOpen && (
                    <MiniBtn tone="good" disabled={busy === p.id} onClick={() => quickConfirm(p)}>
                      {busy === p.id ? '...' : `Yes, ${String(p.suggestedClientName ?? '').split(' ')[0]}`}
                    </MiniBtn>
                  )}
                  <MiniBtn onClick={() => {
                    if (isOpen) reset()
                    else { setOpenRow(p.id); setClientId(p.matchedClientId ?? null); setPicked([]) }
                  }}>
                    {isOpen ? 'Close' : p.matchedClientId ? 'Choose invoices' : 'Pick a client'}
                  </MiniBtn>
                  <MiniBtn tone="danger" onClick={() => ignore.mutate(p.id)} title="Not business income">
                    Not income
                  </MiniBtn>
                </span>
              </div>

              {isOpen && (
                <div className="px-4 pb-3.5 pt-1 space-y-2.5">
                  {/* Step one: whose payment is it. */}
                  <div>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
                        Client
                      </span>
                      {chosen && (
                        <span className="text-[11px]" style={{ color: 'var(--c-accent)' }}>
                          {chosen.name}{chosen.company ? ` · ${chosen.company}` : ''}
                        </span>
                      )}
                    </div>
                    <ClientPicker
                      clients={clients as Client[]}
                      value={clientId}
                      hint={[p.payerName, p.payerEmail].filter(Boolean).join(' ')}
                      onPick={cid => { setClientId(cid); setPicked([]) }}
                    />
                  </div>

                  {/* Step two: which of their invoices it settled. Paid ones are
                      offered too, because attaching the fee is the whole point. */}
                  {clientId && (
                    <div>
                      <div className="flex items-baseline justify-between mb-1.5">
                        <span className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
                          Which invoices did this settle
                        </span>
                        <span className="text-[11px] num" style={{ color: gap === 0 ? 'var(--c-profit)' : 'var(--c-text-3)' }}>
                          {selected.length
                            ? `${fmtView(total)} of ${fmtView(p.amountGross)}${gap === 0 ? ' · exact' : ` · ${gap > 0 ? fmtView(gap) + ' short' : fmtView(-gap) + ' over'}`}`
                            : `nothing picked · ${fmtView(p.amountGross)} to account for`}
                        </span>
                      </div>

                      <div className="rounded-lg max-h-52 overflow-y-auto"
                        style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
                        {rows.length === 0 ? (
                          <p className="px-3 py-4 text-center text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                            {(invoices as Invoice[]).some(i => i.clientId === clientId)
                              ? 'Every invoice of theirs already has a payment against it.'
                              : 'They have no invoices yet, so there is nothing to attach this to.'}
                            {' '}Assigning the client alone records who paid and clears this from the queue.
                          </p>
                        ) : rows.map(i => {
                          const on = picked.includes(i.id)
                          const exact = Math.abs(i.amount - p.amountGross) < 0.01
                          return (
                            <button
                              key={i.id}
                              type="button"
                              onClick={() => setPicked(prev => on ? prev.filter(x => x !== i.id) : [...prev, i.id])}
                              className="w-full flex items-center gap-3 px-3 py-1.5 text-left text-xs"
                              style={{ background: on ? 'rgba(129,140,248,0.12)' : 'transparent' }}
                            >
                              <span className="w-3.5 h-3.5 rounded shrink-0"
                                style={on
                                  ? { background: 'var(--c-accent)' }
                                  : { border: '1.5px solid var(--c-border-strong)' }} />
                              <span className="num w-20" style={{ color: 'var(--c-text-3)' }}>{i.invoiceNumber}</span>
                              <span className="num w-20 text-right font-semibold"
                                style={{ color: exact ? 'var(--c-profit)' : 'var(--c-text-1)' }}>
                                {fmtView(i.amount)}
                              </span>
                              <span className="num w-20 text-right" style={{ color: 'var(--c-text-3)' }}>
                                {formatDate(i.issueDate)}
                              </span>
                              <span className="flex-1 truncate" style={{ color: 'var(--c-text-3)' }}>
                                {i.notes ?? ''}
                              </span>
                              <span className="text-[10px]" style={{ color: i.status === 'paid' ? 'var(--c-text-3)' : '#f59e0b' }}>
                                {i.status === 'paid' ? 'paid, no fee recorded' : i.status}
                              </span>
                            </button>
                          )
                        })}
                      </div>

                      <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
                        <span className="text-[10.5px]" style={{ color: 'var(--c-text-3)' }}>
                          {picked.length > 1
                            ? `The ${fmtView(p.fee)} fee splits across ${picked.length} invoices by amount.`
                            : rows.length === 0
                              ? 'Raising an invoice is what puts this money into your totals.'
                              : 'Pick more than one if this payment settled several.'}
                        </span>
                        <span className="flex gap-1.5">
                          {picked.length === 0 && (
                            <MiniBtn tone="accent" disabled={busy === p.id || !clientId}
                              onClick={() => raiseInvoice(p)}
                              title="Creates a paid invoice for this amount, with the fee and date already on it">
                              {busy === p.id ? '...' : `Raise a ${fmtView(p.amountGross)} invoice`}
                            </MiniBtn>
                          )}
                          <MiniBtn tone="good" disabled={busy === p.id || !clientId} onClick={() => submit(p)}>
                            {busy === p.id ? 'Saving...' : picked.length ? `Assign ${picked.length}` : 'Client only, no invoice'}
                          </MiniBtn>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--c-text-3)' }}>
        The fee on each of these is already exact, so nothing is lost by leaving one here.
      </p>
    </Section>
  )
}
