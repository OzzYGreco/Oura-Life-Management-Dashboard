import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import {
  useServices, usePlanChangePreview, useChangePlan, useClientPaymentPreview, useRecordClientPayment, useClientRows,
} from '../../../hooks/useBusiness'
import type { PlanChange, ClientPaymentBody } from '../../../hooks/useBusiness'
import { formatDate, today } from '../../../lib/utils'
import type { FmtView } from '../../../hooks/useFmtView'
import type { Retainer, Service } from '../lib/types'
import { MiniBtn } from '../components/primitives'

const round2 = (n: number) => Math.round(n * 100) / 100

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
          style={{ background: value === k ? 'rgb(var(--k-fg) / .1)' : 'var(--c-bg-input)', border: `1px solid ${value === k ? 'var(--c-border-strong)' : 'var(--c-border)'}` }}>
          <input type="radio" checked={value === k} onChange={() => onChange(k)} className="w-3.5 h-3.5 mt-0.5 accent-[var(--c-accent)] shrink-0" />
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
          style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)' }}>
          {!changed ? <span style={{ color: 'var(--c-text-3)' }}>Change the service or the price to see what happens.</span>
            : previewError ? <span style={{ color: 'var(--c-loss)' }}>{(previewError as any)?.response?.data?.error ?? 'That does not work'}</span>
            : preview && !stale ? preview.sentence
            : <span style={{ color: 'var(--c-text-3)' }}>{isFetching ? 'Working it out...' : ''}</span>}
        </div>

        {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}

        <div className="flex justify-between gap-2 pt-1">
          <span className="flex gap-1.5">
            {r.status === 'active' && <Button variant="warn" size="sm" onClick={() => { onClose(); onPause(r) }}>Pause instead</Button>}
            <Button variant="danger" size="sm" onClick={() => { onClose(); onStop(r) }}>Stop it</Button>
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
 * "They paid me £X." One amount, nothing to look up.
 *
 * Clients who owe money are listed first, with what they owe; pick one and the
 * amount fills in. The money settles their oldest bills first. Anything beyond
 * what they owe, or a payment when they owe nothing, is not refused: say what
 * it was for and it is recorded as a paid invoice in the same step.
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
  const { data: rows = [] } = useClientRows()
  const record = useRecordClientPayment()
  const [clientId, setClientId] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [fee, setFee] = useState('')
  const [method, setMethod] = useState<'bank' | 'cash' | 'stripe'>('bank')
  const [restFor, setRestFor] = useState('')
  // Money over what they owe: their next months paid ahead, or something else.
  const [forElse, setForElse] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setClientId(client?.id ?? null); setQ(''); setAmount(''); setDate(today()); setFee(''); setMethod('bank'); setRestFor(''); setForElse(false); setError(null)
  }, [open, client?.id])

  const chosen = rows.find(r => r.id === clientId) ?? null
  const owes = chosen?.outstanding ?? 0
  // The amount starts at what they owe, the moment they are picked.
  useEffect(() => { if (chosen) setAmount(owes > 0 ? String(owes) : '') }, [chosen?.id])

  const list = useMemo(() => {
    const term = q.trim().toLowerCase()
    return rows
      .filter(r => r.status !== 'lead')
      .filter(r => !term || r.name.toLowerCase().includes(term) || (r.company ?? '').toLowerCase().includes(term))
      .sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name))
  }, [rows, q])

  const monthly = (chosen?.mrr ?? 0) > 0
  const ahead = monthly && !forElse
  const body = useSettled<ClientPaymentBody | null>(clientId && Number(amount) > 0
    ? { amount: Number(amount), date, fee: Number(fee) || 0, method, ahead } : null)
  const { data: plan } = useClientPaymentPreview(clientId, body)
  const extra = plan?.leftOver ?? 0
  const aheadRows = plan?.ahead ?? []
  const over = round2(aheadRows.reduce((s, a) => s + a.pays, 0) + extra)

  if (!open) return null

  const save = async () => {
    if (!clientId) return
    setError(null)
    try {
      await record.mutateAsync({ clientId, amount: Number(amount), date, fee: Number(fee) || 0, method, ahead, restFor: !ahead ? restFor || undefined : undefined })
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not save that')
    }
  }

  return (
    <Modal open onClose={onClose} size="sm" title={chosen ? `${chosen.name} paid` : 'Who paid?'}>
      <div className="p-5 space-y-4">
        {!chosen ? (
          <div>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or company"
              onKeyDown={e => { if (e.key === 'Enter' && list[0]) setClientId(list[0].id) }}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }} />
            <div className="mt-2 rounded-lg overflow-hidden max-h-72 overflow-y-auto" style={{ border: '1px solid var(--c-border)' }}>
              {list.map((r, i) => (
                <button key={r.id} type="button" onClick={() => setClientId(r.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-white/5"
                  style={{ borderTop: i ? '1px solid var(--c-border)' : 'none' }}>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] truncate" style={{ color: 'var(--c-text-1)' }}>{r.name}</span>
                    {r.company && <span className="block text-[11px] truncate" style={{ color: 'var(--c-text-3)' }}>{r.company}</span>}
                  </span>
                  <span className="text-[12px] num shrink-0" style={{ color: r.outstanding > 0 ? '#f59e0b' : 'var(--c-text-3)' }}>
                    {r.outstanding > 0 ? `owes ${fmtView(r.outstanding)}` : 'owes nothing'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg px-3 py-2"
              style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
              <span className="text-[12.5px]" style={{ color: 'var(--c-text-2)' }}>
                {owes > 0 ? <>Owes <b className="num" style={{ color: 'var(--c-text-1)' }}>{fmtView(owes)}</b></> : 'Owes nothing right now'}
              </span>
              {!client && (
                <MiniBtn onClick={() => { setClientId(null); setAmount('') }}>Someone else</MiniBtn>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input id="rp-amount" label="Amount received" type="number" step="0.01" value={amount} autoFocus
                onChange={e => setAmount(e.target.value)} />
              <Input id="rp-date" label="Received on" type="date" value={date} onChange={e => setDate(e.target.value)} />
              <Select id="rp-method" label="How" value={method} onChange={e => setMethod(e.target.value as any)}
                options={[{ value: 'bank', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' }, { value: 'stripe', label: 'Card, not synced' }]} />
              <Input id="rp-fee" label="Fee (optional)" type="number" step="0.01" value={fee} placeholder="0.00"
                onChange={e => setFee(e.target.value)} />
            </div>

            {monthly && (over > 0.005 || forElse) && (
              <div>
                <p className="text-[11.5px] mb-1.5" style={{ color: 'var(--c-text-2)' }}>
                  {owes > 0 ? <>That is <b className="num">{fmtView(over)}</b> more than they owe. It is:</> : 'They owe nothing right now. This is:'}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {[{ v: false, label: 'Their next months, paid ahead' }, { v: true, label: 'For something else' }].map(o => (
                    <button key={String(o.v)} type="button" onClick={() => setForElse(o.v)}
                      className="rounded-lg px-3 py-2 text-[12px] text-left transition-colors"
                      style={{
                        background: forElse === o.v ? 'rgb(var(--k-fg) / .1)' : 'var(--c-bg-input)',
                        border: `1px solid ${forElse === o.v ? 'var(--c-border-strong)' : 'var(--c-border)'}`,
                        color: forElse === o.v ? 'var(--c-text-1)' : 'var(--c-text-2)',
                      }}>{o.label}</button>
                  ))}
                </div>
              </div>
            )}

            {extra > 0.005 && !ahead && (
              <Input id="rp-rest" label={owes > 0 ? `What was the extra ${fmtView(extra)} for?` : 'What was it for?'}
                value={restFor} onChange={e => setRestFor(e.target.value)} placeholder="Website work, a domain, a one-off job" />
            )}

            {plan?.duplicate && (
              <p className="rounded-lg px-3 py-2 text-[11.5px]"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
                You already recorded {fmtView(plan.duplicate.amount)} from them on {formatDate(plan.duplicate.date)}.
                If this is the same payment, cancel rather than record it twice.
              </p>
            )}

            {plan && (plan.splits.length > 0 || aheadRows.length > 0 || extra > 0.005) && (
              <div className="rounded-lg px-3 py-2.5 text-[11.5px] space-y-1"
                style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)', color: 'var(--c-text-2)' }}>
                {plan.splits.map(sp => (
                  <div key={sp.invoiceId} className="flex justify-between gap-3">
                    <span>{sp.invoiceNumber} {sp.settles ? 'paid in full' : `part paid, ${fmtView(sp.owed - sp.amount)} still owed`}</span>
                    <span className="num" style={{ color: 'var(--c-text-1)' }}>{fmtView(sp.amount)}</span>
                  </div>
                ))}
                {aheadRows.map(a => (
                  <div key={`${a.retainerId}-${a.periodStart}`} className="flex justify-between gap-3">
                    <span>{a.name} from {formatDate(a.periodStart)}, paid ahead{a.pays < a.amount - 0.005 ? `, ${fmtView(a.amount - a.pays)} left to pay` : ''}</span>
                    <span className="num" style={{ color: 'var(--c-text-1)' }}>{fmtView(a.pays)}</span>
                  </div>
                ))}
                {extra > 0.005 && (
                  <div className="flex justify-between gap-3">
                    <span>New paid invoice{restFor ? `: ${restFor}` : ''}</span>
                    <span className="num" style={{ color: 'var(--c-text-1)' }}>{fmtView(extra)}</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {chosen && (
            <Button onClick={save} disabled={!plan || Number(amount) <= 0 || record.isPending}>
              {record.isPending ? 'Saving...' : 'Record payment'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
