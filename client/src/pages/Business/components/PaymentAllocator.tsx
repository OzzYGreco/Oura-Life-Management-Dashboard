import { useEffect, useState } from 'react'
import { MiniBtn } from './primitives'
import { ClientPicker } from './ClientPicker'
import {
  usePaymentOptions, useAssignPayment, useInvoiceFromPayment, useRetainerFromPayment, useReleasePayment,
} from '../../../hooks/useBusiness'
import { formatDate } from '../../../lib/utils'
import type { FmtView } from '../../../hooks/useFmtView'
import type { Client } from '../lib/types'

/** Just what the allocator needs to know about a payment, from either list. */
export interface AllocatablePayment {
  id: number
  amountGross: number
  fee: number
  payerName: string | null
  payerEmail?: string | null
  clientId: number | null
  /** Already applied somewhere: this is a move, not a first assignment. */
  decided: boolean
  subscriptionId?: string | null
  billingReason?: string | null
  planAmount?: number | null
  planIntervalDays?: number | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

const intervalWord = (days: number | null | undefined) => {
  const d = days ?? 30
  if (d <= 10) return 'wk'
  if (d <= 45) return 'mo'
  if (d <= 135) return 'qtr'
  return 'yr'
}

/**
 * Say what a payment paid for: whose it is, which invoices, and how much of each.
 *
 * Three things this does that the queue it grew out of could not:
 *
 *   - It offers the sets of invoices that add up to the payment exactly. The
 *     Rivera case was a website billed as deposit, presentation and launch with
 *     the last two paid in one go; nothing matched one invoice, the sets were
 *     never suggested, and the money was raised as a brand new invoice instead.
 *   - Each invoice takes an amount, so one payment can part-pay an invoice and
 *     one invoice can take several payments.
 *   - It works on a payment already applied. Saving releases it from where it
 *     was and applies it to the new choice in one step, so a wrong match is a
 *     two-click fix rather than a permanent mess.
 */
export function PaymentAllocator({
  payment, clients, fmtView, onDone,
}: {
  payment: AllocatablePayment
  clients: Client[]
  fmtView: FmtView
  onDone: () => void
}) {
  const [clientId, setClientId] = useState<number | null>(payment.clientId)
  const [picked, setPicked] = useState<Record<number, string>>({})
  const [edited, setEdited] = useState(false)
  const [adjust, setAdjust] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmRaise, setConfirmRaise] = useState(false)

  const { data: opts, isFetching } = usePaymentOptions(payment.id, clientId)
  const assign = useAssignPayment()
  const raise = useInvoiceFromPayment()
  const setUpRetainer = useRetainerFromPayment()
  const release = useReleasePayment()
  const busy = assign.isPending || raise.isPending || setUpRetainer.isPending || release.isPending

  // Start from what the payment already covers, when it is being moved.
  const currentKey = opts?.invoices.filter(i => i.current > 0).map(i => `${i.id}:${i.current}`).join(',') ?? null
  useEffect(() => {
    if (currentKey == null) return
    setPicked(Object.fromEntries(currentKey.split(',').filter(Boolean).map(x => x.split(':'))))
    setEdited(false)
    setConfirmRaise(false)
  }, [currentKey])

  const invoices = opts?.invoices ?? []
  const chosen = clientId ? clients.find(c => c.id === clientId) ?? null : null

  const allocated = round2(Object.values(picked).reduce((s, v) => s + (Number(v) || 0), 0))
  const gap = round2(payment.amountGross - allocated)
  const pickedIds = Object.keys(picked).map(Number)

  // A single picked invoice a few pence off the payment can be adjusted to match.
  const nearGap = pickedIds.length >= 1 && !edited
    ? round2(payment.amountGross - pickedIds.reduce((s, id) => s + (invoices.find(i => i.id === id)?.owed ?? 0), 0))
    : 0
  const canAdjust = nearGap !== 0 && Math.abs(nearGap) <= 1

  /**
   * Fill picked invoices oldest first, up to what each owes, until the money
   * runs out. An invoice raised from this very payment is only a placeholder,
   * so it fills last and drops out when real invoices take all the money:
   * picking the deposit for a payment that sits on its own raised invoice
   * moves the money, rather than leaving the deposit with nothing.
   */
  const fill = (ids: number[]) => {
    let left = payment.amountGross
    const rows = ids.map(id => invoices.find(i => i.id === id)!).filter(Boolean)
      .sort((a, b) => Number(a.raisedHere) - Number(b.raisedHere)
        || a.issueDate.localeCompare(b.issueDate) || a.id - b.id)
    const next: Record<number, string> = {}
    for (const i of rows) {
      const amt = round2(Math.min(i.owed, Math.max(left, 0)))
      if (amt <= 0 && i.raisedHere) continue
      next[i.id] = String(amt)
      left = round2(left - amt)
    }
    setPicked(next)
    setEdited(false)
  }

  const toggle = (id: number) => {
    const on = picked[id] != null
    const ids = on ? pickedIds.filter(x => x !== id) : [...pickedIds, id]
    fill(ids)
  }

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try { await fn(); onDone() }
    catch (e: any) { setError(e?.response?.data?.error ?? 'Could not save that') }
  }

  const save = () => run(() => assign.mutateAsync({
    id: payment.id,
    clientId: clientId!,
    ...(edited
      ? { allocations: pickedIds.map(id => ({ invoiceId: id, amount: Number(picked[id]) || 0 })).filter(a => a.amount > 0) }
      : { invoiceIds: pickedIds, adjustToMatch: canAdjust && adjust }),
    remember: true,
  }))

  const isNewSub = !!payment.subscriptionId && payment.billingReason === 'subscription_create'
  const openCount = opts?.openCount ?? 0

  const suggestionLabel = (ids: number[]) => ids
    .map(id => invoices.find(i => i.id === id))
    .filter(Boolean)
    .map(i => `${i!.invoiceNumber}${i!.milestoneLabel ? ` ${i!.milestoneLabel}` : ''}`)
    .join(' + ')

  return (
    <div className="px-4 pb-3.5 pt-1 space-y-2.5">
      {/* Step one: whose payment is it. */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Client</span>
          {chosen && (
            <span className="text-[11px]" style={{ color: 'var(--c-accent)' }}>
              {chosen.name}{chosen.company ? ` · ${chosen.company}` : ''}
            </span>
          )}
        </div>
        <ClientPicker
          clients={clients}
          value={clientId}
          hint={[payment.payerName, payment.payerEmail].filter(Boolean).join(' ')}
          autoFocus={!payment.clientId}
          onPick={cid => { setClientId(cid); setPicked({}) }}
        />
      </div>

      {clientId && (
        <div>
          {/* The sets that add up exactly, one click each. */}
          {(opts?.suggestions.length ?? 0) > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-profit)' }}>
                Adds up exactly
              </span>
              {opts!.suggestions.map(ids => (
                <MiniBtn key={ids.join('-')} tone="good" onClick={() => fill(ids)}>
                  {suggestionLabel(ids)} · {fmtView(payment.amountGross)}
                </MiniBtn>
              ))}
            </div>
          )}

          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
              What did this pay for
            </span>
            <span className="text-[11px] num" style={{ color: gap === 0 ? 'var(--c-profit)' : 'var(--c-text-3)' }}>
              {pickedIds.length
                ? `${fmtView(allocated)} of ${fmtView(payment.amountGross)}${gap === 0 ? ' · all of it'
                  : gap > 0 ? ` · ${fmtView(gap)} not placed` : ` · ${fmtView(-gap)} too much`}`
                : `nothing picked · ${fmtView(payment.amountGross)} to account for`}
            </span>
          </div>

          <div className="rounded-lg max-h-60 overflow-y-auto"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
            {isFetching && !opts ? (
              <p className="px-3 py-4 text-center text-[11px]" style={{ color: 'var(--c-text-3)' }}>Loading their invoices...</p>
            ) : invoices.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                Nothing of theirs is waiting for money. Raise an invoice from this payment to put it in your totals.
              </p>
            ) : invoices.map(i => {
              const on = picked[i.id] != null
              const part = i.owed < i.amount - 0.005
              return (
                <div key={i.id} className="flex items-center gap-3 px-3 py-1.5 text-xs"
                  style={{ background: on ? 'rgb(var(--k-fg) / .1)' : 'transparent' }}>
                  <button type="button" onClick={() => toggle(i.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    <span className="w-3.5 h-3.5 rounded shrink-0"
                      style={on ? { background: 'var(--c-accent)' } : { border: '1.5px solid var(--c-border-strong)' }} />
                    <span className="num w-16 shrink-0" style={{ color: 'var(--c-text-3)' }}>{i.invoiceNumber}</span>
                    <span className="num w-20 shrink-0 text-right font-semibold" style={{ color: 'var(--c-text-1)' }}>
                      {fmtView(i.amount)}
                    </span>
                    <span className="num w-16 shrink-0 text-right" style={{ color: 'var(--c-text-3)' }}>{formatDate(i.issueDate)}</span>
                    <span className="flex-1 truncate" style={{ color: 'var(--c-text-3)' }}>
                      {i.milestoneLabel ? `${i.milestoneLabel} · ` : ''}{i.notes ?? ''}
                    </span>
                    <span className="text-[10px] shrink-0" style={{ color: i.status === 'paid' ? 'var(--c-text-3)' : '#f59e0b' }}>
                      {i.raisedHere ? 'raised from this payment'
                        : part ? `${fmtView(i.owed)} left`
                        : i.status === 'paid' ? 'marked paid, no card fee' : i.status}
                    </span>
                  </button>
                  {on && (
                    <input
                      aria-label={`Amount for ${i.invoiceNumber}`}
                      value={picked[i.id]}
                      onChange={e => { setPicked(p => ({ ...p, [i.id]: e.target.value })); setEdited(true) }}
                      className="w-20 px-2 py-0.5 rounded text-right num text-[11px] outline-none"
                      style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }}
                    />
                  )}
                </div>
              )
            })}
          </div>

          {canAdjust && (
            <label className="flex items-start gap-2 mt-2 text-[11px] cursor-pointer" style={{ color: 'var(--c-text-2)' }}>
              <input type="checkbox" checked={adjust} onChange={e => setAdjust(e.target.checked)}
                className="w-3.5 h-3.5 mt-0.5 accent-[var(--c-accent)]" />
              <span>
                Change the invoice by <span className="num">{fmtView(Math.abs(nearGap))}</span> so it matches the{' '}
                <span className="num">{fmtView(payment.amountGross)}</span> that was paid. Pennies from splitting a
                price into milestones, not money still owed.
              </span>
            </label>
          )}

          {confirmRaise && (
            <div className="mt-2 px-3 py-2 rounded-lg text-[11px]"
              style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#fcd34d' }}>
              {chosen?.name ?? 'They'} {openCount === 1 ? 'has an open invoice' : `have ${openCount} open invoices`}.
              Is this payment for {openCount === 1 ? 'it' : 'one of those'}? Raising a new invoice next to
              them counts the work twice. Pick them above instead, or raise it anyway.
            </div>
          )}

          {error && <p className="text-[11px] mt-2" style={{ color: 'var(--c-loss)' }}>{error}</p>}

          <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
            <span className="text-[10.5px]" style={{ color: 'var(--c-text-3)' }}>
              {pickedIds.length > 1
                ? `The ${fmtView(payment.fee)} fee splits across ${pickedIds.length} invoices by amount.`
                : gap > 0.005 && pickedIds.length
                  ? 'Less than an invoice owes leaves the rest still owed. That is how instalments work.'
                  : payment.decided ? 'Saving moves this payment. Invoices it leaves go back to open.'
                  : 'Pick more than one if this payment settled several.'}
            </span>
            <span className="flex gap-1.5">
              {payment.decided && (
                <MiniBtn disabled={busy} onClick={() => run(() => release.mutateAsync(payment.id))}
                  title="Detach it from everything and put it back in the queue">
                  Back to the queue
                </MiniBtn>
              )}
              {pickedIds.length === 0 && isNewSub && (
                <MiniBtn tone="accent" disabled={busy}
                  onClick={() => run(() => setUpRetainer.mutateAsync({ id: payment.id, clientId: clientId! }))}
                  title="Creates the retainer at Stripe's own price and interval, with this month's invoice already paid">
                  {`Set up a ${fmtView(payment.planAmount ?? payment.amountGross)}/${intervalWord(payment.planIntervalDays)} retainer`}
                </MiniBtn>
              )}
              {pickedIds.length === 0 && (
                <MiniBtn tone={isNewSub ? 'default' : 'accent'} disabled={busy}
                  onClick={() => {
                    if (openCount > 0 && !confirmRaise) { setConfirmRaise(true); return }
                    run(() => raise.mutateAsync({ id: payment.id, clientId: clientId! }))
                  }}
                  title="Creates a paid invoice for this amount, with the fee and date already on it">
                  {confirmRaise ? 'Raise it anyway' : `One-off ${fmtView(payment.amountGross)} invoice`}
                </MiniBtn>
              )}
              <MiniBtn tone="good" disabled={busy || gap < -0.005} onClick={save}>
                {busy ? 'Saving...' : pickedIds.length ? `Assign to ${pickedIds.length}` : 'Client only, no invoice'}
              </MiniBtn>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
