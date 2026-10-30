import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import {
  useServices, useUpdateRetainer, useChangeRetainerPrice, usePricePreview, useDeleteRetainer,
  useDropPreview, useDropClient,
} from '../../../hooks/useBusiness'
import type { PriceBody } from '../../../hooks/useBusiness'
import { formatDate, today } from '../../../lib/utils'
import type { FmtView } from '../../../hooks/useFmtView'
import type { Retainer, Service } from '../lib/types'

const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly']

/** The tinted note boxes these modals use to say what is about to happen. */
function Note({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'good' | 'bad'; children: React.ReactNode }) {
  const c = {
    info: { bg: 'var(--c-bg-input)', border: 'var(--c-border)', color: 'var(--c-text-2)' },
    warn: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.22)', color: '#fcd34d' },
    good: { bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.25)', color: 'var(--c-profit)' },
    bad:  { bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)', color: 'var(--c-loss)' },
  }[tone]
  return (
    <div className="text-[11px] px-3 py-2 rounded-lg leading-relaxed"
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.color }}>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-3)' }}>
      {children}
    </div>
  )
}

/** Debounce a value so a preview query does not fire on every keystroke. */
function useSettled<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [JSON.stringify(value)])
  return v
}

// ─── Retainer: everything about it, in one place ─────────────────────────────

/**
 * Edit a retainer.
 *
 * Before this, a retainer could only have its price changed, paused or
 * cancelled; its name, terms, cadence and next invoice date were set once and
 * never again. The price section is the part that mattered most: changing it
 * only ever reached the NEXT invoice, so the open one for this month kept the
 * old price. Here the new price starts from a date (defaulting to the start of
 * the period currently open) and the invoices it will re-price are listed
 * before anything is saved.
 */
export function RetainerEditModal({
  retainer, onClose, fmtView,
}: { retainer: Retainer | null; onClose: () => void; fmtView: FmtView }) {
  const { data: services = [] } = useServices()
  const update = useUpdateRetainer()
  const changePrice = useChangeRetainerPrice()
  const remove = useDeleteRetainer()

  const [f, setF] = useState<any>({})
  const [price, setPrice] = useState('')
  const [from, setFrom] = useState('')
  const [correction, setCorrection] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!retainer) return
    setF({
      serviceId: retainer.serviceId ? String(retainer.serviceId) : '',
      name: retainer.name,
      frequency: retainer.frequency,
      netTermDays: String(retainer.netTermDays ?? 0),
      startDate: retainer.startDate,
      nextInvoiceDate: retainer.nextInvoiceDate ?? '',
      autoInvoice: retainer.autoInvoice === 1,
      notes: retainer.notes ?? '',
    })
    setPrice(String(retainer.amount))
    setFrom('')
    setCorrection(false)
    setReason('')
    setError(null)
    setConfirmDelete(false)
  }, [retainer])

  const newAmount = Number(price) || 0
  const priceChanged = !!retainer && Math.abs(newAmount - retainer.amount) > 0.005
  const body = useSettled<PriceBody | null>(priceChanged || correction
    ? { newAmount, effectiveDate: from || undefined, correction }
    : null)
  const { data: plan, error: planError, isFetching } = usePricePreview(retainer?.id ?? null, body)

  // Show the date the server picked as the default once it has said.
  useEffect(() => { if (plan && !from) setFrom(plan.effectiveDate) }, [plan?.effectiveDate])

  if (!retainer) return null

  const save = async () => {
    setError(null)
    try {
      const svc = (services as Service[]).find(s => String(s.id) === String(f.serviceId))
      await update.mutateAsync({
        id: retainer.id,
        serviceId: f.serviceId ? Number(f.serviceId) : null,
        name: f.name || svc?.name || retainer.name,
        frequency: f.frequency,
        netTermDays: Number(f.netTermDays) || 0,
        startDate: f.startDate,
        nextInvoiceDate: f.nextInvoiceDate || null,
        autoInvoice: f.autoInvoice ? 1 : 0,
        notes: f.notes || null,
      })
      if (priceChanged) {
        await changePrice.mutateAsync({
          id: retainer.id, newAmount, effectiveDate: from || undefined, correction, reason: reason || undefined,
        })
      }
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not save that')
    }
  }

  const per = retainer.frequency === 'monthly' ? 'mo' : retainer.frequency.slice(0, 2)
  const saving = update.isPending || changePrice.isPending

  return (
    <Modal open onClose={onClose} size="md" title={`${retainer.clientName}: ${retainer.serviceName}`}>
      <div className="p-5 space-y-4">
        {/* ── Price ─────────────────────────────────────────────────── */}
        <div>
          <Label>Price</Label>
          <div className="grid grid-cols-2 gap-3">
            <Input id="re-price" label={`Price per ${retainer.frequency.replace(/ly$/, '')}`} type="number" step="0.01"
              value={price} onChange={e => setPrice(e.target.value)} />
            <Input id="re-from" label="New price applies from" type="date" value={from}
              disabled={correction} onChange={e => setFrom(e.target.value)} />
          </div>
          <label htmlFor="re-correction" className="flex items-start gap-2 mt-2.5 text-xs cursor-pointer" style={{ color: 'var(--c-text-2)' }}>
            <input id="re-correction" type="checkbox" checked={correction} onChange={e => setCorrection(e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-indigo-500" />
            <span>
              It was always this price. A correction, not a price change: MRR history is fixed rather than showing
              an increase or decrease.
            </span>
          </label>

          {(priceChanged || correction) && (
            <div className="mt-2.5 space-y-2">
              {planError ? (
                <Note tone="bad">{(planError as any)?.response?.data?.error ?? 'That date does not work'}</Note>
              ) : !plan ? (
                <Note>{isFetching ? 'Working out what this changes...' : 'Enter the new price'}</Note>
              ) : (
                <>
                  <Note tone={plan.correction ? 'info' : plan.mrrDelta >= 0 ? 'good' : 'bad'}>
                    {plan.correction
                      ? <>Corrected to <span className="num">{fmtView(plan.newAmount)}/{per}</span>. No increase or decrease is recorded.</>
                      : <>From <span className="num">{formatDate(plan.effectiveDate)}</span> MRR {plan.mrrDelta >= 0 ? 'goes up' : 'goes down'} by{' '}
                        <span className="num">{fmtView(Math.abs(plan.mrrDelta))}/mo</span>, recorded as {plan.mrrDelta >= 0 ? 'expansion' : 'contraction'}.</>}
                  </Note>
                  {plan.repriced.length > 0 ? (
                    <Note tone="warn">
                      Re-prices {plan.repriced.length === 1 ? 'this open invoice' : `these ${plan.repriced.length} open invoices`}:{' '}
                      {plan.repriced.map(i => `${i.invoiceNumber} (${fmtView(i.from)} → ${fmtView(i.to)})`).join(', ')}.
                    </Note>
                  ) : (
                    <Note>No open invoice is affected. The next one is raised at the new price.</Note>
                  )}
                  {plan.untouchedPaid.length > 0 && (
                    <Note>
                      {plan.untouchedPaid.map(i => i.invoiceNumber).join(', ')} {plan.untouchedPaid.length === 1 ? 'is' : 'are'} already
                      paid, so {plan.untouchedPaid.length === 1 ? 'it stays' : 'they stay'} at what was actually collected.
                    </Note>
                  )}
                </>
              )}
              {!correction && (
                <Input id="re-reason" label="Reason (optional)" value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="Moved to the standard rate" />
              )}
            </div>
          )}
        </div>

        {/* ── Everything else ───────────────────────────────────────── */}
        <div>
          <Label>Details</Label>
          <div className="grid grid-cols-2 gap-3">
            <Select id="re-service" label="Service" value={String(f.serviceId ?? '')}
              onChange={e => {
                const svc = (services as Service[]).find(s => String(s.id) === e.target.value)
                setF({ ...f, serviceId: e.target.value, name: svc?.name ?? f.name })
              }}
              placeholder="None"
              options={(services as Service[]).filter(s => s.kind === 'recurring').map(s => ({ value: String(s.id), label: s.name }))} />
            <Input id="re-name" label="Name on invoices" value={f.name ?? ''} onChange={e => setF({ ...f, name: e.target.value })} />
            <Select id="re-freq" label="Billed" value={f.frequency ?? 'monthly'} onChange={e => setF({ ...f, frequency: e.target.value })}
              options={FREQUENCIES.map(v => ({ value: v, label: v }))} />
            <Input id="re-terms" label="Payment terms (days)" type="number" value={f.netTermDays ?? '0'}
              onChange={e => setF({ ...f, netTermDays: e.target.value })} />
            <Input id="re-start" label="Started" type="date" value={f.startDate ?? ''} onChange={e => setF({ ...f, startDate: e.target.value })} />
            <Input id="re-next" label="Next invoice" type="date" value={f.nextInvoiceDate ?? ''}
              onChange={e => setF({ ...f, nextInvoiceDate: e.target.value })} />
          </div>
          <label htmlFor="re-auto" className="flex items-center gap-2 mt-2.5 text-xs cursor-pointer" style={{ color: 'var(--c-text-2)' }}>
            <input id="re-auto" type="checkbox" checked={!!f.autoInvoice} onChange={e => setF({ ...f, autoInvoice: e.target.checked })}
              className="w-4 h-4 accent-indigo-500" />
            Raise invoices automatically
          </label>
          <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--c-text-3)' }}>
            Move the next invoice date to skip or shift a month. A period that already has an invoice, even a void one,
            is never billed twice.
          </p>
        </div>

        <Input id="re-notes" label="Notes" value={f.notes ?? ''} onChange={e => setF({ ...f, notes: e.target.value })} />

        {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}

        <div className="flex justify-between gap-2 pt-1">
          {confirmDelete ? (
            <span className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--c-loss)' }}>
              Delete it? Only works if it never billed.
              <Button variant="danger" size="sm" onClick={async () => {
                try { await remove.mutateAsync(retainer.id); onClose() }
                catch (e: any) { setError(e?.response?.data?.error ?? 'Could not delete it'); setConfirmDelete(false) }
              }}>Delete</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Keep</Button>
            </span>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving || (priceChanged && !plan)}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── Client left ─────────────────────────────────────────────────────────────

/**
 * End a client, all of it at once.
 *
 * "Churned" used to be a label in the edit form, and setting it changed nothing:
 * their retainers stayed active, MRR kept counting them and invoices kept
 * coming. This ends their retainers from the last day (which may be in the past,
 * so the churn lands in the month it happened), voids what was billed after it,
 * and lets each unpaid invoice from before be kept as owed or written off.
 *
 * Every line on this screen comes from the server's own dry run of the same
 * action, so what is shown is exactly what happens.
 */
export function DropClientModal({
  client, onClose, fmtView,
}: { client: { id: number; name: string } | null; onClose: () => void; fmtView: FmtView }) {
  const [endDate, setEndDate] = useState(today())
  const [reason, setReason] = useState('')
  const [writeOff, setWriteOff] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const drop = useDropClient()

  useEffect(() => {
    if (!client) return
    setEndDate(today()); setReason(''); setWriteOff(new Set()); setError(null)
  }, [client?.id])

  const settledDate = useSettled(endDate)
  const { data: plan, error: planError } = useDropPreview(client?.id ?? null, settledDate || null)

  const owedTotal = useMemo(() => (plan?.stillOwed ?? []).filter(i => !writeOff.has(i.id)).reduce((s, i) => s + i.owed, 0), [plan, writeOff])

  if (!client) return null

  const submit = async () => {
    setError(null)
    try {
      await drop.mutateAsync({ id: client.id, endDate, reason: reason || undefined, writeOffInvoiceIds: [...writeOff] })
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not save that')
    }
  }

  return (
    <Modal open onClose={onClose} size="md" title={`${client.name} left`}>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input id="drop-end" label="Last day as a client" type="date" value={endDate} max={today()}
            onChange={e => setEndDate(e.target.value)} />
          <Input id="drop-reason" label="Why (optional)" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Closed the business" />
        </div>
        <p className="text-[10.5px] -mt-1" style={{ color: 'var(--c-text-3)' }}>
          Backdate it if they actually stopped earlier: MRR history then shows them leaving in the right month.
        </p>

        {planError ? (
          <Note tone="bad">{(planError as any)?.response?.data?.error ?? 'That date does not work'}</Note>
        ) : !plan ? (
          <Note>Working out what this changes...</Note>
        ) : (
          <div className="space-y-2.5">
            <Note tone={plan.retainers.length ? 'bad' : 'info'}>
              {plan.retainers.length ? (
                <>
                  Ends {plan.retainers.map(r => `${r.name} (${fmtView(r.amount)}/${r.frequency === 'monthly' ? 'mo' : r.frequency})`).join(', ')}.
                  {plan.mrrLost > 0 && <> MRR drops by <span className="num">{fmtView(plan.mrrLost)}/mo</span>, counted as churn on{' '}
                    <span className="num">{formatDate(plan.endDate)}</span>.</>}
                </>
              ) : 'They have no retainer running, so MRR does not change.'}
            </Note>

            {plan.voided.length > 0 && (
              <Note tone="warn">
                Voids {plan.voided.length === 1 ? 'an invoice' : `${plan.voided.length} invoices`} for after they left or never sent:{' '}
                {plan.voided.map(i => `${i.invoiceNumber} (${fmtView(i.amount)})`).join(', ')}.
              </Note>
            )}

            {plan.projects.length > 0 && (
              <Note>Marks {plan.projects.map(p => p.name).join(', ')} as cancelled.</Note>
            )}

            {plan.stillOwed.length > 0 && (
              <div>
                <Label>Unpaid from while they were a client</Label>
                <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
                  {plan.stillOwed.map((i, idx) => {
                    const off = writeOff.has(i.id)
                    return (
                      <div key={i.id} className="flex items-center gap-3 px-3 py-2 text-xs"
                        style={{ borderTop: idx ? '1px solid var(--c-border)' : 'none', background: 'var(--c-bg-input)' }}>
                        <span className="num w-16" style={{ color: 'var(--c-text-3)' }}>{i.invoiceNumber}</span>
                        <span className="num w-20 text-right font-semibold" style={{ color: off ? 'var(--c-text-3)' : 'var(--c-text-1)', textDecoration: off ? 'line-through' : undefined }}>
                          {fmtView(i.owed)}
                        </span>
                        <span className="num flex-1" style={{ color: 'var(--c-text-3)' }}>due {formatDate(i.dueDate)}</span>
                        <span className="flex gap-1">
                          {(['owed', 'off'] as const).map(k => (
                            <button key={k} type="button"
                              onClick={() => setWriteOff(prev => {
                                const next = new Set(prev)
                                if (k === 'off') next.add(i.id)
                                else next.delete(i.id)
                                return next
                              })}
                              className="px-2 py-0.5 rounded text-[10.5px] font-semibold"
                              style={(k === 'off') === off
                                ? { background: 'var(--c-accent)', color: '#fff' }
                                : { border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                              {k === 'owed' ? 'Still owed' : 'Write off'}
                            </button>
                          ))}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--c-text-3)' }}>
                  {owedTotal > 0
                    ? <><span className="num">{fmtView(owedTotal)}</span> stays in Outstanding until it is paid or written off later.</>
                    : 'Nothing stays owed.'}
                </p>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={submit} disabled={!plan || drop.isPending}>
            {drop.isPending ? 'Saving...' : `End ${client.name.split(' ')[0]}`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
