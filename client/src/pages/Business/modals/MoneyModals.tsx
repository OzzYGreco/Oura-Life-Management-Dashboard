import { useEffect, useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import { usePayInvoice, useChangeRetainerPrice, useRetainerLifecycle, useRecordDraw, useOwnerPay } from '../../../hooks/useBusiness'
import { today } from '../../../lib/utils'
import type { LedgerRow, Retainer } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

/**
 * Mark paid, with the fee.
 *
 * The one-click button on the Overview queue covers the common case: paid in
 * full, today. This is for when the date is different or a card fee came off,
 * which is the only way gross volume and net volume ever differ.
 */
export function PayInvoiceModal({
  invoice, onClose, fmtView,
}: { invoice: LedgerRow | null; onClose: () => void; fmtView: FmtView }) {
  const pay = usePayInvoice()
  const [paidDate, setPaidDate] = useState(today())
  const [mode, setMode] = useState<'full' | 'fee' | 'net'>('full')
  const [fee, setFee] = useState('')
  const [net, setNet] = useState('')

  useEffect(() => {
    if (invoice) {
      setPaidDate(today())
      setMode('full')
      setFee('')
      setNet(String(invoice.gross))
    }
  }, [invoice])

  if (!invoice) return null

  const feeValue = mode === 'fee' ? Number(fee) || 0
    : mode === 'net' ? Math.max(invoice.gross - (Number(net) || 0), 0)
    : 0
  const netValue = invoice.gross - feeValue

  const submit = async () => {
    await pay.mutateAsync({
      id: invoice.id,
      paidDate,
      ...(mode === 'fee' ? { feeAmount: Number(fee) || 0 } : {}),
      ...(mode === 'net' ? { netReceived: Number(net) || 0 } : {}),
      ...(mode === 'full' ? { feeAmount: 0 } : {}),
    })
    onClose()
  }

  return (
    <Modal open={!!invoice} onClose={onClose} title={`Record payment for ${invoice.invoiceNumber}`} size="sm">
      <div className="p-5 space-y-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm" style={{ color: 'var(--c-text-2)' }}>{invoice.clientName}</span>
          <span className="text-xl font-bold num" style={{ color: 'var(--c-text-1)' }}>{fmtView(invoice.gross)}</span>
        </div>

        <Input id="pay-date" label="Paid on" type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} />

        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-3)' }}>
            How much landed
          </div>
          <div className="flex gap-1.5">
            {([
              ['full', 'All of it'],
              ['net', 'A different amount'],
              ['fee', 'Minus a fee'],
            ] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setMode(k)}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold"
                style={mode === k
                  ? { background: 'var(--c-accent)', color: '#fff' }
                  : { background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {mode === 'fee' && (
          <Input id="pay-fee" label="Processing fee" type="number" step="0.01" value={fee} autoFocus
            onChange={e => setFee(e.target.value)} placeholder="4.07" />
        )}
        {mode === 'net' && (
          <Input id="pay-net" label="Amount that hit the bank" type="number" step="0.01" value={net} autoFocus
            onChange={e => setNet(e.target.value)} />
        )}

        {feeValue > 0 && (
          <div className="text-[11px] px-3 py-2 rounded-lg num"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
            Gross {fmtView(invoice.gross)} - fee {fmtView(feeValue)} = net {fmtView(netValue)}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={pay.isPending}>
            {pay.isPending ? 'Saving...' : 'Mark paid'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Change a retainer's price, keeping the old one.
 *
 * The change is written to a log rather than overwriting `amount`, which is what
 * makes expansion and contraction MRR computable at all.
 */
export function RetainerActionModal({
  retainer, action, onClose, fmtView,
}: {
  retainer: Retainer | null
  action: 'price' | 'cancel' | null
  onClose: () => void
  fmtView: FmtView
}) {
  const changePrice = useChangeRetainerPrice()
  const lifecycle = useRetainerLifecycle()
  const [amount, setAmount] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(today())
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (retainer) {
      setAmount(String(retainer.amount))
      setEffectiveDate(today())
      setReason('')
      setError(null)
    }
  }, [retainer, action])

  if (!retainer || !action) return null

  const next = Number(amount) || 0
  const delta = next - retainer.amount

  const submit = async () => {
    setError(null)
    try {
      if (action === 'price') {
        await changePrice.mutateAsync({ id: retainer.id, newAmount: next, effectiveDate, reason: reason || undefined })
      } else {
        await lifecycle.mutateAsync({ id: retainer.id, action: 'cancel', endDate: effectiveDate, reason: reason || undefined })
      }
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not save that')
    }
  }

  return (
    <Modal open onClose={onClose} size="sm"
      title={action === 'price' ? `Change price for ${retainer.clientName}` : `Cancel ${retainer.clientName}'s retainer`}>
      <div className="p-5 space-y-4">
        <div className="text-xs" style={{ color: 'var(--c-text-2)' }}>
          {retainer.serviceName}, currently <span className="num" style={{ color: 'var(--c-text-1)' }}>{fmtView(retainer.amount)}/mo</span>
        </div>

        {action === 'price' ? (
          <>
            <Input id="ret-amount" label="New price" type="number" step="0.01" value={amount} autoFocus
              onChange={e => setAmount(e.target.value)} />
            <Input id="ret-date" label="From" type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
            {delta !== 0 && (
              <div className="text-[11px] px-3 py-2 rounded-lg"
                style={{
                  background: delta > 0 ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
                  border: `1px solid ${delta > 0 ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`,
                  color: delta > 0 ? 'var(--c-profit)' : 'var(--c-loss)',
                }}>
                MRR {delta > 0 ? 'goes up' : 'goes down'} by <span className="num">{fmtView(Math.abs(delta))}/mo</span>,
                recorded as {delta > 0 ? 'expansion' : 'contraction'}.
              </div>
            )}
          </>
        ) : (
          <>
            <Input id="ret-end" label="Last day" type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
            <div className="text-[11px] px-3 py-2 rounded-lg"
              style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.22)', color: '#fcd34d' }}>
              Billing stops on this date and MRR drops by <span className="num">{fmtView(retainer.amount)}/mo</span>.
            </div>
          </>
        )}

        <Input id="ret-reason" label="Reason (optional)" value={reason} onChange={e => setReason(e.target.value)}
          placeholder={action === 'price' ? 'Moved to the standard rate' : 'Client closed the business'} />

        {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={action === 'cancel' ? 'danger' : 'primary'} onClick={submit}
            disabled={changePrice.isPending || lifecycle.isPending}>
            {action === 'price' ? 'Save new price' : 'Cancel retainer'}
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
