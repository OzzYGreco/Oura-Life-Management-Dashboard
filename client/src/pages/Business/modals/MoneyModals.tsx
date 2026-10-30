import { useEffect, useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import {
  usePayInvoice, useRetainerLifecycle, useRecordDraw, useOwnerPay, useInvoice, useRemoveAllocation, useCancelPreview,
} from '../../../hooks/useBusiness'
import { formatDate, today } from '../../../lib/utils'
import type { Retainer } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

/**
 * Record a payment against an invoice: all of what is left, or part of it.
 *
 * The amount received and the card fee are two separate questions here. The
 * form this replaces had "a different amount landed", which booked the whole
 * difference as a processing fee, so a client who paid half read as a client
 * who paid in full with a 50% card fee. Now less than what is owed leaves the
 * invoice part-paid and the rest still owed, which is what an instalment is.
 */
export function PayInvoiceModal({
  invoice, onClose, fmtView,
}: { invoice: { id: number; invoiceNumber: string; clientName?: string } | null; onClose: () => void; fmtView: FmtView }) {
  const pay = usePayInvoice()
  const removeAlloc = useRemoveAllocation()
  const { data: detail } = useInvoice(invoice?.id ?? null)
  const [paidDate, setPaidDate] = useState(today())
  const [amount, setAmount] = useState('')
  const [fee, setFee] = useState('')
  const [method, setMethod] = useState<'bank' | 'cash' | 'stripe'>('bank')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!invoice) return
    setPaidDate(today()); setFee(''); setMethod('bank'); setError(null); setAmount('')
  }, [invoice?.id])
  useEffect(() => { if (detail && amount === '') setAmount(String(detail.owed)) }, [detail?.owed])

  if (!invoice) return null

  const owed = detail?.owed ?? 0
  const value = Number(amount) || 0
  const feeValue = Number(fee) || 0
  const short = detail ? Math.round((owed - value) * 100) / 100 : 0

  const submit = async () => {
    setError(null)
    try {
      await pay.mutateAsync({ id: invoice.id, paidDate, amount: value, feeAmount: feeValue, method })
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not save that')
    }
  }

  return (
    <Modal open onClose={onClose} title={`Record a payment for ${invoice.invoiceNumber}`} size="sm">
      <div className="p-5 space-y-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm" style={{ color: 'var(--c-text-2)' }}>{invoice.clientName ?? ''}</span>
          <span className="text-right">
            <span className="block text-xl font-bold num" style={{ color: 'var(--c-text-1)' }}>{fmtView(detail?.amount ?? 0)}</span>
            {detail && detail.applied > 0 && (
              <span className="block text-[11px] num" style={{ color: '#38bdf8' }}>
                {fmtView(detail.applied)} paid so far, {fmtView(owed)} left
              </span>
            )}
          </span>
        </div>

        {detail?.status === 'void' && (
          <div className="text-[11px] px-3 py-2 rounded-lg"
            style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.22)', color: 'var(--c-text-2)' }}>
            This invoice was voided{detail.voidReason ? ` (${detail.voidReason.toLowerCase()})` : ''}. Recording the payment
            brings it back as paid, under the same number. No new invoice is raised.
          </div>
        )}

        {detail && detail.allocations.length > 0 && (
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
            {detail.allocations.map((a, i) => (
              <div key={a.id} className="flex items-center gap-3 px-3 py-1.5 text-[11px]"
                style={{ borderTop: i ? '1px solid var(--c-border)' : 'none', background: 'var(--c-bg-input)' }}>
                <span className="num w-16" style={{ color: 'var(--c-text-3)' }}>{formatDate(a.date)}</span>
                <span className="flex-1" style={{ color: 'var(--c-text-2)' }}>
                  {a.paymentId ? `Stripe${a.payerName ? `, ${a.payerName}` : ''}` : a.method === 'cash' ? 'Cash' : 'Bank transfer'}
                </span>
                <span className="num font-semibold" style={{ color: 'var(--c-text-1)' }}>{fmtView(a.amount)}</span>
                {!a.paymentId && (
                  <button type="button" className="text-[10.5px] hover:underline" style={{ color: 'var(--c-loss)' }}
                    onClick={() => removeAlloc.mutate(a.id)}>remove</button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input id="pay-amount" label="Amount received" type="number" step="0.01" value={amount} autoFocus
            onChange={e => setAmount(e.target.value)} />
          <Input id="pay-date" label="Received on" type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} />
          <Input id="pay-fee" label="Card or bank fee" type="number" step="0.01" value={fee} placeholder="0.00"
            onChange={e => setFee(e.target.value)} />
          <Select id="pay-method" label="How" value={method} onChange={e => setMethod(e.target.value as any)}
            options={[
              { value: 'bank', label: 'Bank transfer' },
              { value: 'cash', label: 'Cash' },
              { value: 'stripe', label: 'Card, not synced' },
            ]} />
        </div>

        {detail && value > 0 && short > 0.005 && (
          <div className="text-[11px] px-3 py-2 rounded-lg num"
            style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.25)', color: 'var(--c-text-2)' }}>
            A part payment: {fmtView(short)} stays owed on {invoice.invoiceNumber}.
          </div>
        )}
        {detail && value > owed + 0.005 && (
          <p className="text-[11px]" style={{ color: 'var(--c-loss)' }}>
            Only {fmtView(owed)} is left on this invoice. If they paid more, change the invoice amount first.
          </p>
        )}
        {feeValue > 0 && value > 0 && (
          <div className="text-[11px] px-3 py-2 rounded-lg num"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
            Received {fmtView(value)} - fee {fmtView(feeValue)} = {fmtView(value - feeValue)} in the bank
          </div>
        )}

        {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!detail || pay.isPending || value <= 0 || value > owed + 0.005}>
            {pay.isPending ? 'Saving...' : short > 0.005 ? 'Record part payment' : 'Mark paid'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Pause, resume or cancel a retainer, saying first what happens to its invoices.
 *
 * Cancel takes a last day, which is usually in the past, and voids every open
 * invoice for a period from that day on: before, a backdated cancel left those
 * invoices in place, owed by a client who had already gone.
 */
export function RetainerActionModal({
  retainer, action, onClose, fmtView,
}: {
  retainer: Retainer | null
  action: 'cancel' | 'pause' | 'resume' | null
  onClose: () => void
  fmtView: FmtView
}) {
  const lifecycle = useRetainerLifecycle()
  const [date, setDate] = useState(today())
  const [reason, setReason] = useState('')
  const [voidOpen, setVoidOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { data: preview } = useCancelPreview(action === 'cancel' ? retainer?.id ?? null : null, action === 'cancel' ? date : null)

  useEffect(() => {
    if (retainer) { setDate(today()); setReason(''); setVoidOpen(true); setError(null) }
  }, [retainer, action])

  if (!retainer || !action) return null

  const submit = async () => {
    setError(null)
    try {
      if (action === 'cancel') await lifecycle.mutateAsync({ id: retainer.id, action, endDate: date, reason: reason || undefined })
      else if (action === 'pause') await lifecycle.mutateAsync({ id: retainer.id, action, voidOpen })
      else await lifecycle.mutateAsync({ id: retainer.id, action, date })
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not save that')
    }
  }

  const title = action === 'cancel' ? `Cancel ${retainer.clientName}'s retainer`
    : action === 'pause' ? `Pause ${retainer.clientName}'s retainer`
    : `Resume ${retainer.clientName}'s retainer`

  return (
    <Modal open onClose={onClose} size="sm" title={title}>
      <div className="p-5 space-y-4">
        <div className="text-xs" style={{ color: 'var(--c-text-2)' }}>
          {retainer.serviceName}, <span className="num" style={{ color: 'var(--c-text-1)' }}>{fmtView(retainer.amount)}/mo</span>
        </div>

        {action === 'cancel' && (
          <>
            <Input id="ret-end" label="Last day" type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} />
            <div className="text-[11px] px-3 py-2 rounded-lg"
              style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.22)', color: '#fcd34d' }}>
              Billing stops and MRR drops by <span className="num">{fmtView(retainer.amount)}/mo</span> from this day.
              {preview?.voided.length
                ? <> Voids {preview.voided.map(i => `${i.invoiceNumber} (${fmtView(i.amount)})`).join(', ')}, billed for after it.</>
                : ' No open invoice is billed for after it.'}
            </div>
            <Input id="ret-reason" label="Reason (optional)" value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Client closed the business" />
          </>
        )}

        {action === 'pause' && (
          <>
            <p className="text-[11px]" style={{ color: 'var(--c-text-2)' }}>
              Billing stops from today and the retainer stops counting in MRR until it is resumed.
            </p>
            <label htmlFor="ret-voidopen" className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: 'var(--c-text-2)' }}>
              <input id="ret-voidopen" type="checkbox" checked={voidOpen} onChange={e => setVoidOpen(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-indigo-500" />
              <span>Also void its unpaid invoices, so they stop showing as owed. Ones with money on them are kept.</span>
            </label>
          </>
        )}

        {action === 'resume' && (
          <>
            <Input id="ret-resume" label="First invoice on" type="date" value={date} onChange={e => setDate(e.target.value)} />
            <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
              The paused months are never billed. The first invoice after the pause is raised on this day.
            </p>
          </>
        )}

        {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Back</Button>
          <Button variant={action === 'cancel' ? 'danger' : 'primary'} onClick={submit} disabled={lifecycle.isPending}>
            {action === 'cancel' ? 'Cancel retainer' : action === 'pause' ? 'Pause' : 'Resume'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Record money the partners took out. */
export function DrawModal({
  open, onClose, fmtView,
}: { open: boolean; onClose: () => void; fmtView: FmtView }) {
  const { data: op } = useOwnerPay()
  const record = useRecordDraw()
  const [ownerId, setOwnerId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [postToFinances, setPost] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && op?.owners.length && !ownerId) setOwnerId(String(op.owners[0].id))
  }, [open, op])

  const safe = op ? Math.max(op.safeToDraw, 0) : 0
  const value = Number(amount) || 0
  const over = op ? value > safe : false

  const submit = async () => {
    setError(null)
    try {
      await record.mutateAsync({
        ownerId: Number(ownerId),
        amount: value,
        date,
        notes: notes || undefined,
        postToFinances,
      })
      setAmount(''); setNotes('')
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not save that')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Record a draw" size="sm">
      <div className="p-5 space-y-4">
        {op && (
          <div className="rounded-lg px-3 py-2.5 text-[11px]"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
            Safe to draw this month: <span className="num font-semibold" style={{ color: 'var(--c-profit)' }}>{fmtView(safe)}</span>
            <span style={{ color: 'var(--c-text-3)' }}>
              {' '}after {op.taxRatePct}% tax and a {op.bufferMonths}-month buffer
            </span>
          </div>
        )}

        <Select id="draw-owner" label="Partner" value={ownerId} onChange={e => setOwnerId(e.target.value)}
          options={(op?.owners ?? []).map(o => ({ value: String(o.id), label: `${o.name} (${o.sharePct}%)` }))} />

        <Input id="draw-amount" label="Amount" type="number" step="0.01" value={amount} autoFocus
          onChange={e => setAmount(e.target.value)} placeholder="700.00" />

        <Input id="draw-date" label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} />

        <Input id="draw-notes" label="Note (optional)" value={notes} onChange={e => setNotes(e.target.value)} />

        <label htmlFor="draw-post" className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: 'var(--c-text-2)' }}>
          <input id="draw-post" type="checkbox" checked={postToFinances} onChange={e => setPost(e.target.checked)}
            className="w-4 h-4 mt-0.5 accent-indigo-500" />
          <span>
            Also record this as income in Finances, so the money shows on both sides of the transfer.
          </span>
        </label>

        {over && value > 0 && (
          <div className="text-[11px] px-3 py-2 rounded-lg"
            style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.22)', color: '#fcd34d' }}>
            That is <span className="num">{fmtView(value - safe)}</span> more than was safe this month. It will come out of
            retained cash, which is fine as long as it is deliberate.
          </div>
        )}

        {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!ownerId || value <= 0 || record.isPending}>
            {record.isPending ? 'Saving...' : 'Record draw'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
