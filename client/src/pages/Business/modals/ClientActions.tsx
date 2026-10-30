import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import { ClientPicker } from '../components/ClientPicker'
import {
  useServices, usePlanChangePreview, useChangePlan, useClientPaymentPreview, useRecordClientPayment, useClients,
} from '../../../hooks/useBusiness'
import type { PlanChange, ClientPaymentBody } from '../../../hooks/useBusiness'
import { formatDate, today } from '../../../lib/utils'
import type { FmtView } from '../../../hooks/useFmtView'
import type { Client, Retainer, Service } from '../lib/types'

/** Debounce a value so a preview does not fire on every keystroke. */
function useSettled<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  const key = JSON.stringify(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [key])
  return v
}

function Choice<K extends string>({ value, options, onChange }: {
  value: K; options: readonly (readonly [K, string, string?])[]; onChange: (k: K) => void
}) {
  return (
    <div className="space-y-1.5">
      {options.map(([k, label, hint]) => (
        <label key={k} className="flex items-start gap-2.5 cursor-pointer px-3 py-2 rounded-lg"
          style={{ background: value === k ? 'rgba(129,140,248,0.1)' : 'var(--c-bg-input)', border: `1px solid ${value === k ? 'rgba(129,140,248,0.35)' : 'var(--c-border)'}` }}>
          <input type="radio" checked={value === k} onChange={() => onChange(k)} className="w-3.5 h-3.5 mt-0.5 accent-indigo-500 shrink-0" />
          <span>
            <span className="block text-xs" style={{ color: 'var(--c-text-1)' }}>{label}</span>
            {hint && <span className="block text-[10.5px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>{hint}</span>}
          </span>
        </label>
      ))}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-3)' }}>{children}</div>
}

// ─── Change plan ─────────────────────────────────────────────────────────────

/**
 * Change what a client pays, in one form.
 *
 * Price, service or both; from this month's invoice or the next one; and if it
 * starts next month, whether this month's open invoice is still owed or
 * written off. What used to be three separate operations (cancel, void, new
 * retainer) is one save, and the server says what will happen as a sentence
 * before anything does. Pause and Stop are one click away for the other cases.
 */
export function ChangePlanModal({
  retainers, onClose, onPause, onStop, fmtView,
}: {
  /** The client's live retainers; null closes the form. */
  retainers: Retainer[] | null
  onClose: () => void
  onPause: (r: Retainer) => void
  onStop: (r: Retainer) => void
  fmtView: FmtView
}) {
  const { data: services = [] } = useServices()
  const change = useChangePlan()
  const [retainerId, setRetainerId] = useState<number | null>(null)
  const [serviceId, setServiceId] = useState('')
  const [amount, setAmount] = useState('')
  const [from, setFrom] = useState<'now' | 'next'>('next')
  const [openInvoice, setOpenInvoice] = useState<'keep' | 'writeoff'>('keep')
  const [error, setError] = useState<string | null>(null)

  const r = retainers?.find(x => x.id === retainerId) ?? retainers?.[0] ?? null
  useEffect(() => {
    if (!retainers?.length) return
    const first = retainers[0]
    setRetainerId(first.id)
    setServiceId(first.serviceId ? String(first.serviceId) : '')
    setAmount(String(first.amount))
    setFrom('next'); setOpenInvoice('keep'); setError(null)
  }, [retainers])

  const changed = !!r && (Math.abs((Number(amount) || 0) - r.amount) > 0.005 || String(r.serviceId ?? '') !== serviceId)
  const body = useSettled<PlanChange | null>(changed ? {
    newAmount: Number(amount) || 0,
    serviceId: serviceId ? Number(serviceId) : null,
    from, openInvoice,
  } : null)
  const { data: preview, error: previewError, isFetching } = usePlanChangePreview(r?.id ?? null, body)
  const live = changed ? JSON.stringify({ newAmount: Number(amount) || 0, serviceId: serviceId ? Number(serviceId) : null, from, openInvoice }) : null
  const stale = live !== (body ? JSON.stringify(body) : null)

  if (!retainers || !r) return null

  const recurring = (services as Service[]).filter(s => s.kind === 'recurring')
  const per = r.frequency === 'monthly' ? 'month' : r.frequency.replace(/ly$/, '')

  const save = async () => {
    setError(null)
    try {
      await change.mutateAsync({ id: r.id, newAmount: Number(amount) || 0, serviceId: serviceId ? Number(serviceId) : null, from, openInvoice })
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not save that')
    }
  }

  return (
    <Modal open onClose={onClose} size="md" title={`Change ${r.clientName}'s plan`}>
      <div className="p-5 space-y-4">
        {retainers.length > 1 && (
          <Select id="cp-retainer" label="Which plan" value={String(r.id)}
            onChange={e => {
              const next = retainers.find(x => x.id === Number(e.target.value))!
              setRetainerId(next.id); setServiceId(next.serviceId ? String(next.serviceId) : ''); setAmount(String(next.amount))
            }}
            options={retainers.map(x => ({ value: String(x.id), label: `${x.serviceName} · ${fmtView(x.amount)}` }))} />
        )}

        <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--c-bg-input)', color: 'var(--c-text-2)' }}>
          Now: <b style={{ color: 'var(--c-text-1)' }}>{r.serviceName}</b> at{' '}
          <span className="num" style={{ color: 'var(--c-text-1)' }}>{fmtView(r.amount)}/{per}</span>
          {r.nextInvoiceDate && <> · next invoice {formatDate(r.nextInvoiceDate)}</>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select id="cp-service" label="Service" value={serviceId} onChange={e => setServiceId(e.target.value)}
            placeholder="None"
            options={recurring.map(s => ({ value: String(s.id), label: s.name }))} />
          <Input id="cp-amount" label={`Price per ${per}`} type="number" step="0.01" value={amount} autoFocus
            onChange={e => setAmount(e.target.value)} />
        </div>

        <div>
          <Label>Starting</Label>
          <Choice value={from} onChange={setFrom} options={[
            ['now', "From this month's invoice", 'The invoice already raised for this month changes too.'],
            ['next', `From the next invoice${r.nextInvoiceDate ? ` (${formatDate(r.nextInvoiceDate)})` : ''}`, 'This month stays as it was billed.'],
          ] as const} />
        </div>

        {from === 'next' && (preview?.leftOpen.length ?? 0) > 0 && (
          <div>
            <Label>This month's unpaid invoice ({preview!.leftOpen.map(i => `${i.invoiceNumber}, ${fmtView(i.amount)}`).join('; ')})</Label>
            <Choice value={openInvoice} onChange={setOpenInvoice} options={[
              ['keep', 'They still owe it'],
              ['writeoff', 'Write it off', 'Taken out of what is owed. Mark paid still works on their page if they pay it.'],
            ] as const} />
          </div>
        )}

        <div className="rounded-lg px-3.5 py-3 text-[12px] leading-relaxed"
          style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.25)', color: 'var(--c-text-1)' }}>
          {!changed ? <span style={{ color: 'var(--c-text-3)' }}>Change the service or the price to see what happens.</span>
            : previewError ? <span style={{ color: 'var(--c-loss)' }}>{(previewError as any)?.response?.data?.error ?? 'That does not work'}</span>
            : preview && !stale ? preview.sentence
            : <span style={{ color: 'var(--c-text-3)' }}>{isFetching ? 'Working it out...' : ''}</span>}
        </div>

        {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}

        <div className="flex justify-between gap-2 pt-1">
          <span className="flex gap-1.5">
            {r.status === 'active' && <Button variant="ghost" size="sm" onClick={() => { onClose(); onPause(r) }}>Pause instead</Button>}
            <Button variant="ghost" size="sm" onClick={() => { onClose(); onStop(r) }}>Stop it</Button>
          </span>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            {/* Never save on a preview that has not caught up with the form. */}
            <Button onClick={save} disabled={!changed || !preview || isFetching || stale || change.isPending}>
              {change.isPending ? 'Saving...' : 'Save'}
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  )
}

// ─── Record a payment from a client ──────────────────────────────────────────

/**
 * "They paid me £X." Recorded once, spread over what they owe, oldest first.
 *
 * Opened from a client's page with the client already chosen, or from the New
 * menu with a picker. No invoice to hunt for: the preview lists which bills
 * the money settles before it is saved.
 */
export function RecordPaymentModal({
  client, open, onClose, fmtView,
}: {
  /** Preset client, or null to pick one. */
  client: { id: number; name: string } | null
  open: boolean
  onClose: () => void
  fmtView: FmtView
}) {
  const { data: clients = [] } = useClients()
  const record = useRecordClientPayment()
  const [clientId, setClientId] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [fee, setFee] = useState('')
  const [method, setMethod] = useState<'bank' | 'cash' | 'stripe'>('bank')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setClientId(client?.id ?? null); setAmount(''); setDate(today()); setFee(''); setMethod('bank'); setError(null)
  }, [open, client?.id])

  const owedQuery = useSettled<ClientPaymentBody | null>(clientId ? { amount: 1_000_000 } : null, 0)
  const { data: owed } = useClientPaymentPreview(clientId, owedQuery)
  // Default the amount to everything they owe, once it is known.
  useEffect(() => { if (owed && amount === '') setAmount(owed.owedTotal ? String(owed.owedTotal) : '') }, [owed?.owedTotal])

  const body = useSettled<ClientPaymentBody | null>(clientId && Number(amount) > 0
    ? { amount: Number(amount), date, fee: Number(fee) || 0, method } : null)
  const { data: plan } = useClientPaymentPreview(clientId, body)

  const chosen = useMemo(() => (clients as Client[]).find(c => c.id === clientId), [clients, clientId])

  if (!open) return null

  const save = async () => {
    if (!clientId) return
    setError(null)
    try {
      await record.mutateAsync({ clientId, amount: Number(amount), date, fee: Number(fee) || 0, method })
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not save that')
    }
  }

  return (
    <Modal open onClose={onClose} size="sm" title={chosen ? `${chosen.name} paid` : 'Record a payment'}>
      <div className="p-5 space-y-4">
        {!client && (
          <ClientPicker clients={clients as Client[]} value={clientId} onPick={id => { setClientId(id); setAmount('') }} />
        )}

        {clientId && owed && owed.owedTotal === 0 ? (
          <p className="text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--c-bg-input)', color: 'var(--c-text-2)' }}>
            {chosen?.name ?? 'They'} owe nothing right now. For money with no invoice behind it, raise an invoice first.
          </p>
        ) : clientId && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Input id="rp-amount" label="Amount received" type="number" step="0.01" value={amount} autoFocus
                onChange={e => setAmount(e.target.value)} />
              <Input id="rp-date" label="Received on" type="date" value={date} onChange={e => setDate(e.target.value)} />
              <Select id="rp-method" label="How" value={method} onChange={e => setMethod(e.target.value as any)}
                options={[{ value: 'bank', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' }, { value: 'stripe', label: 'Card, not synced' }]} />
              <Input id="rp-fee" label="Fee (optional)" type="number" step="0.01" value={fee} placeholder="0.00"
                onChange={e => setFee(e.target.value)} />
            </div>

            {plan && (
              <div className="rounded-lg px-3 py-2.5 text-[11.5px] space-y-1"
                style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                {plan.splits.map(sp => (
                  <div key={sp.invoiceId} className="flex justify-between gap-3">
                    <span>{sp.invoiceNumber} {sp.settles ? 'paid in full' : `part paid, ${fmtView(sp.owed - sp.amount)} still owed`}</span>
                    <span className="num" style={{ color: 'var(--c-text-1)' }}>{fmtView(sp.amount)}</span>
                  </div>
                ))}
                {plan.leftOver > 0.005 && (
                  <p style={{ color: 'var(--c-loss)' }}>
                    {fmtView(plan.leftOver)} more than they owe ({fmtView(plan.owedTotal)}). Raise an invoice for it first.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!clientId || !plan || plan.leftOver > 0.005 || !plan.splits.length || record.isPending}>
            {record.isPending ? 'Saving...' : 'Record payment'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
