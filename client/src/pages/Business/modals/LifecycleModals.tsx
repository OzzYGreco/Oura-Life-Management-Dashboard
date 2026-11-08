import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import {
  useServices, useUpdateRetainer, useChangeRetainerPrice, usePricePreview, useDeleteRetainer,
  useClients, useRetainerMovePreview, useMoveRetainer,
  useDropPreview, useDropClient, useComeback, useReactivateClient,
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
  const { data: clients = [] } = useClients()
  const move = useMoveRetainer()

  const [f, setF] = useState<any>({})
  const [price, setPrice] = useState('')
  const [from, setFrom] = useState('')
  const [correction, setCorrection] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [moving, setMoving] = useState(false)
  const [moveTo, setMoveTo] = useState('')
  /** Look-alikes the user chose to keep. Every removable one goes unless unticked. */
  const [keepIds, setKeepIds] = useState<number[]>([])
  const { data: movePlan, error: moveError, isFetching: movePlanLoading } =
    useRetainerMovePreview(moving ? retainer?.id ?? null : null, moveTo ? Number(moveTo) : null)

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
    setMoving(false)
    setMoveTo('')
    setKeepIds([])
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
          // The invoices the new price reaches also take the new service.
          ...(serviceChanged ? { serviceId: f.serviceId ? Number(f.serviceId) : null, name: newLabel } : {}),
        })
      }
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not save that')
    }
  }

  const per = retainer.frequency === 'monthly' ? 'mo' : retainer.frequency.slice(0, 2)
  const newService = (services as Service[]).find(sv => String(sv.id) === String(f.serviceId))
  const newLabel = f.name || newService?.name || retainer.name
  const serviceChanged = String(f.serviceId ?? '') !== String(retainer.serviceId ?? '') || (f.name && f.name !== retainer.name)
  const oldLabel = retainer.serviceName ?? retainer.name
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

        <Input id="re-notes" label="Your notes (never shown on invoices)" value={f.notes ?? ''}
          onChange={e => setF({ ...f, notes: e.target.value })} />

        {/* ── Every invoice this touches, past, present and future ─────── */}
        {(priceChanged || correction || serviceChanged) && (
          <div className="rounded-lg px-3.5 py-3 text-[11.5px] space-y-1.5"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-2)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--c-text-3)' }}>
              What saving does
            </div>
            {plan && (priceChanged || correction) ? (
              <>
                <p>
                  <b style={{ color: 'var(--c-text-1)' }}>Earlier invoices</b>{' '}
                  {plan.earlier.length
                    ? <>({plan.earlier.map(i => i.invoiceNumber).join(', ')}) stay exactly as they are: {oldLabel}, at the price they were billed.</>
                    : 'none before this date.'}
                </p>
                {plan.untouchedPaid.length > 0 && (
                  <p>
                    <b style={{ color: 'var(--c-text-1)' }}>{plan.untouchedPaid.map(i => i.invoiceNumber).join(', ')}</b> already
                    paid, so kept at what was collected.
                  </p>
                )}
                <p>
                  <b style={{ color: 'var(--c-text-1)' }}>
                    {plan.repriced.length ? plan.repriced.map(i => i.invoiceNumber).join(', ') : 'No open invoice'}
                  </b>
                  {plan.repriced.length
                    ? <> becomes {serviceChanged ? `${newLabel} ` : ''}<span className="num">{fmtView(newAmount)}</span> (was {fmtView(plan.repriced[0].from)}).</>
                    : ' is affected.'}
                </p>
                <p>
                  <b style={{ color: 'var(--c-text-1)' }}>From {plan.nextInvoiceDate ? formatDate(plan.nextInvoiceDate) : 'the next invoice'}</b>,
                  {' '}every invoice is {newLabel} at <span className="num">{fmtView(newAmount)}/{per}</span>.
                </p>
              </>
            ) : !priceChanged && !correction ? (
              <>
                <p><b style={{ color: 'var(--c-text-1)' }}>Invoices already raised</b> keep {oldLabel}. Nothing is merged or renamed.</p>
                <p>
                  <b style={{ color: 'var(--c-text-1)' }}>From {retainer.nextInvoiceDate ? formatDate(retainer.nextInvoiceDate) : 'the next invoice'}</b>,
                  {' '}invoices say {newLabel}. To move an open invoice too, change the price from its date.
                </p>
              </>
            ) : <p>Working it out...</p>}
          </div>
        )}

        {/* ── Set up on the wrong client ──────────────────────────────── */}
        {moving && (
          <div className="rounded-lg px-3.5 py-3 space-y-2.5"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)' }}>
            <Label>Move to another client</Label>
            <Select id="re-move-to" label="The client it belongs to" value={moveTo}
              onChange={e => setMoveTo(e.target.value)} placeholder="Pick a client"
              options={(clients as any[])
                .filter(c => c.id !== retainer.clientId && c.status !== 'lead')
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(c => ({ value: String(c.id), label: c.company ? `${c.name} (${c.company})` : c.name }))} />
            {moveTo && (moveError ? (
              <Note tone="bad">{(moveError as any)?.response?.data?.error ?? 'It cannot be moved'}</Note>
            ) : !movePlan ? (
              <Note>{movePlanLoading ? 'Working out what moves with it...' : ' '}</Note>
            ) : (
              <Note>
                {movePlan.retainer.name} moves from <b>{movePlan.from.name}</b> to <b>{movePlan.to.name}</b>
                {movePlan.invoices.length
                  ? <>, with {movePlan.invoices.length === 1 ? 'its invoice' : 'its invoices'} {movePlan.invoices.map(i => i.invoiceNumber).join(', ')}</>
                  : null}
                {movePlan.payments.length
                  ? <> and the {movePlan.payments.length === 1 ? 'payment' : 'payments'} that paid {movePlan.invoices.length === 1 ? 'it' : 'them'}{' '}
                    ({movePlan.payments.map(p => `${fmtView(p.amount)} on ${formatDate(p.paidDate)}`).join(', ')})</>
                  : null}.
                {movePlan.movesStripeCustomer && <> Their Stripe customer moves too, so future renewals land on {movePlan.to.name}.</>}
                {' '}Nothing is re-priced or re-issued.
              </Note>
            ))}
            {movePlan && movePlan.duplicates.length > 0 && (
              <div className="space-y-1.5">
                <Note tone="warn">
                  {movePlan.to.name} already has {movePlan.duplicates.length === 1 ? 'this plan' : 'plans like this'}.
                  Moving this one in without removing {movePlan.duplicates.length === 1 ? 'it' : 'them'} would bill them twice.
                </Note>
                {movePlan.duplicates.map(d => d.removable ? (
                  <label key={d.id} htmlFor={`re-dup-${d.id}`} className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: 'var(--c-text-2)' }}>
                    <input id={`re-dup-${d.id}`} type="checkbox" checked={!keepIds.includes(d.id)}
                      onChange={e => setKeepIds(e.target.checked ? keepIds.filter(x => x !== d.id) : [...keepIds, d.id])}
                      className="w-4 h-4 mt-0.5 accent-indigo-500" />
                    <span>
                      Remove their {d.name} <span className="num">{fmtView(d.amount)}</span>, started {formatDate(d.startDate)}
                      {d.invoices.length ? <> and its unpaid {d.invoices.map(i => i.invoiceNumber).join(', ')}</> : null}.
                      It never took any money.
                    </span>
                  </label>
                ) : (
                  <Note key={d.id} tone="bad">
                    Their {d.name} <span className="num">{fmtView(d.amount)}</span> has money on it, so it stays. Cancel it
                    yourself after the move if it is the same plan.
                  </Note>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setMoving(false); setMoveTo('') }}>Never mind</Button>
              <Button size="sm" disabled={!movePlan || move.isPending} onClick={async () => {
                setError(null)
                const replaceIds = movePlan!.duplicates.filter(d => d.removable && !keepIds.includes(d.id)).map(d => d.id)
                try { await move.mutateAsync({ id: retainer.id, clientId: Number(moveTo), replaceIds }); onClose() }
                catch (e: any) { setError(e?.response?.data?.error ?? 'Could not move it') }
              }}>{move.isPending ? 'Moving...' : 'Move it'}</Button>
            </div>
          </div>
        )}

        {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}

        <div className="flex justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
          {!moving && !confirmDelete && (
            <Button variant="ghost" size="sm" onClick={() => setMoving(true)}>Wrong client?</Button>
          )}
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
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
          )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving || (priceChanged && !plan)}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Unpaid invoices, each with a two-way switch: still owed, or not. */
function OwedRows({
  rows, off, offLabel, onToggle, fmtView,
}: {
  rows: { id: number; invoiceNumber: string; owed: number; dueDate: string }[]
  off: (id: number) => boolean
  offLabel: string
  onToggle: (id: number, off: boolean) => void
  fmtView: FmtView
}) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
      {rows.map((i, idx) => {
        const isOff = off(i.id)
        return (
          <div key={i.id} className="flex items-center gap-3 px-3 py-2 text-xs"
            style={{ borderTop: idx ? '1px solid var(--c-border)' : 'none', background: 'var(--c-bg-input)' }}>
            <span className="num w-16" style={{ color: 'var(--c-text-3)' }}>{i.invoiceNumber}</span>
            <span className="num w-20 text-right font-semibold"
              style={{ color: isOff ? 'var(--c-text-3)' : 'var(--c-text-1)', textDecoration: isOff ? 'line-through' : undefined }}>
              {fmtView(i.owed)}
            </span>
            <span className="num flex-1" style={{ color: 'var(--c-text-3)' }}>due {formatDate(i.dueDate)}</span>
            <span className="flex gap-1">
              {([false, true] as const).map(k => (
                <button key={String(k)} type="button" onClick={() => onToggle(i.id, k)}
                  className="px-2 py-0.5 rounded text-[10.5px] font-semibold"
                  style={k === isOff
                    ? { background: 'var(--c-accent)', color: 'var(--c-on-accent)' }
                    : { border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                  {k ? offLabel : 'Still owed'}
                </button>
              ))}
            </span>
          </div>
        )
      })}
    </div>
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
  /** Invoices from after the last day that stand anyway, e.g. if the client comes back. */
  const [keepOwed, setKeepOwed] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const drop = useDropClient()

  useEffect(() => {
    if (!client) return
    setEndDate(today()); setReason(''); setWriteOff(new Set()); setKeepOwed(new Set()); setError(null)
  }, [client?.id])

  const settledDate = useSettled(endDate)
  const { data: plan, error: planError } = useDropPreview(client?.id ?? null, settledDate || null)
  const notice = endDate > today()

  const owedTotal = useMemo(() =>
    (plan?.stillOwed ?? []).filter(i => !writeOff.has(i.id)).reduce((s, i) => s + i.owed, 0)
    + (plan?.voided ?? []).filter(i => keepOwed.has(i.id)).reduce((s, i) => s + i.owed, 0),
  [plan, writeOff, keepOwed])

  if (!client) return null

  const submit = async () => {
    setError(null)
    try {
      await drop.mutateAsync({
        id: client.id, endDate, reason: reason || undefined,
        writeOffInvoiceIds: [...writeOff],
        keepOwedInvoiceIds: [...keepOwed].filter(id => plan?.voided.some(v => v.id === id && v.canKeep)),
      })
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not save that')
    }
  }

  return (
    <Modal open onClose={onClose} size="md" title={notice ? `${client.name} is leaving` : `${client.name} left`}>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input id="drop-end" label="Last day as a client" type="date" value={endDate}
            onChange={e => setEndDate(e.target.value)} />
          <Input id="drop-reason" label="Why (optional)" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Closed the business" />
        </div>
        <p className="text-[10.5px] -mt-1" style={{ color: 'var(--c-text-3)' }}>
          {notice
            ? 'A day ahead is notice: they stay a client, and keep being billed, until then. On the day they are ended on their own.'
            : 'Backdate it if they actually stopped earlier: MRR history then shows them leaving in the right month. Pick a day ahead if they have given notice.'}
        </p>

        {planError ? (
          <Note tone="bad">{(planError as any)?.response?.data?.error ?? 'That date does not work'}</Note>
        ) : !plan ? (
          <Note>Working out what this changes...</Note>
        ) : (
          <div className="space-y-2.5">
            {plan.notice && (
              <Note>
                {plan.stillToBill?.length
                  ? <>Still billed before they go: {plan.stillToBill.map(b => `${b.name} on ${formatDate(b.periodStart)} (${fmtView(b.amount)})`).join(', ')}.</>
                  : 'Nothing more is billed before they go.'}
                {' '}Changed their mind? "They are staying" on their page takes the notice back.
              </Note>
            )}
            <Note tone={plan.retainers.length ? 'bad' : 'info'}>
              {plan.retainers.length ? (
                <>
                  Ends {plan.retainers.map(r => `${r.name} (${fmtView(r.amount)}/${r.frequency === 'monthly' ? 'mo' : r.frequency})`).join(', ')}.
                  {plan.mrrLost > 0 && <> MRR {plan.notice ? 'will drop' : 'drops'} by <span className="num">{fmtView(plan.mrrLost)}/mo</span>, counted as churn on{' '}
                    <span className="num">{formatDate(plan.endDate)}</span>.</>}
                  {plan.endsEarlier?.length ? <> Already cancelled until{' '}
                    <span className="num">{formatDate(plan.endsEarlier[0].from)}</span>; that moves back to{' '}
                    <span className="num">{formatDate(plan.endDate)}</span> so the churn counts on the day they left.</> : null}
                </>
              ) : 'They have no retainer running, so MRR does not change.'}
            </Note>

            {plan.voided.some(i => !i.canKeep) && (
              <Note tone="warn">
                Voids {plan.voided.filter(i => !i.canKeep).map(i => `${i.invoiceNumber} (${fmtView(i.amount)})`).join(', ')}:
                {' '}never sent, so never owed.
              </Note>
            )}

            {plan.voided.some(i => i.canKeep) && (
              <div>
                <Label>Billed for after they left</Label>
                <OwedRows
                  rows={plan.voided.filter(i => i.canKeep)}
                  off={id => !keepOwed.has(id)}
                  offLabel="Void"
                  onToggle={(id, off) => setKeepOwed(prev => {
                    const next = new Set(prev)
                    if (off) next.delete(id)
                    else next.add(id)
                    return next
                  })}
                  fmtView={fmtView}
                />
                <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--c-text-3)' }}>
                  {plan.stillOwed.length === 0 && owedTotal > 0 && (
                    <><span className="num">{fmtView(owedTotal)}</span> stays in Outstanding. </>
                  )}
                  Voided by default, since they cover time after the last day. Keep one as still owed if the bill stands
                  anyway, for example because they will pay it if they come back. Churn still counts from the last day.
                </p>
              </div>
            )}

            {plan.projects.length > 0 && (
              <Note>Marks {plan.projects.map(p => p.name).join(', ')} as cancelled.</Note>
            )}

            {plan.stillOwed.length > 0 && (
              <div>
                <Label>Unpaid from while they were a client</Label>
                <OwedRows
                  rows={plan.stillOwed}
                  off={id => writeOff.has(id)}
                  offLabel="Write off"
                  onToggle={(id, off) => setWriteOff(prev => {
                    const next = new Set(prev)
                    if (off) next.add(id)
                    else next.delete(id)
                    return next
                  })}
                  fmtView={fmtView}
                />
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
            {drop.isPending ? 'Saving...' : notice ? `Record their notice` : `End ${client.name.split(' ')[0]}`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── They are back ───────────────────────────────────────────────────────────

/**
 * A client who left comes back, and can pick up where they were.
 *
 * Everything voided when they left is listed, ticked by default: those were
 * real bills, voided only so they would stop counting while the client was
 * gone, and a client who returns usually settles them. Ended retainers can be
 * picked up too; they bill from today, never for the months away.
 */
export function ComebackModal({
  client, onClose, fmtView,
}: { client: { id: number; name: string } | null; onClose: () => void; fmtView: FmtView }) {
  const { data } = useComeback(client?.id ?? null)
  const reactivate = useReactivateClient()
  const [invoices, setInvoices] = useState<Set<number>>(new Set())
  const [retainers, setRetainers] = useState<Set<number>>(new Set())
  // They may come back on new terms, and from a set day.
  const [prices, setPrices] = useState<Record<number, string>>({})
  const [startDate, setStartDate] = useState(today())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!data) return
    setInvoices(new Set(data.invoices.map(i => i.id)))
    setRetainers(new Set())
    setPrices(Object.fromEntries(data.retainers.map(r => [r.id, String(r.amount)])))
    setStartDate(today())
    setError(null)
  }, [data])

  if (!client) return null

  const flip = (set: Set<number>, id: number) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }
  const owed = (data?.invoices ?? []).filter(i => invoices.has(i.id)).reduce((s, i) => s + i.amount, 0)

  const submit = async () => {
    setError(null)
    try {
      await reactivate.mutateAsync({
        id: client.id, restoreInvoiceIds: [...invoices], reinstateRetainerIds: [...retainers], startDate,
        prices: Object.fromEntries([...retainers].filter(id => Number(prices[id]) > 0).map(id => [String(id), Number(prices[id])])),
      })
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not save that')
    }
  }

  const row = (on: boolean, onToggle: () => void, main: React.ReactNode, side: React.ReactNode, key: number, idx: number) => (
    <label key={key} className="flex items-center gap-3 px-3 py-2 text-xs cursor-pointer"
      style={{ borderTop: idx ? '1px solid var(--c-border)' : 'none', background: 'var(--c-bg-input)' }}>
      <input type="checkbox" checked={on} onChange={onToggle} className="w-3.5 h-3.5 accent-indigo-500" />
      <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--c-text-2)' }}>{main}</span>
      <span className="num" style={{ color: 'var(--c-text-1)' }}>{side}</span>
    </label>
  )

  return (
    <Modal open onClose={onClose} size="md" title={`${client.name} is back`}>
      <div className="p-5 space-y-4">
        {!data ? <Note>Looking up what they had...</Note> : (
          <>
            {data.invoices.length > 0 ? (
              <div>
                <Label>Voided invoices, restore as owed</Label>
                <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
                  {data.invoices.map((i, idx) => row(
                    invoices.has(i.id), () => setInvoices(flip(invoices, i.id)),
                    <><span className="num" style={{ color: 'var(--c-text-3)' }}>{i.invoiceNumber}</span>{' '}
                      issued {formatDate(i.issueDate)}{i.voidReason ? ` · ${i.voidReason.toLowerCase()}` : ''}</>,
                    fmtView(i.amount), i.id, idx))}
                </div>
                <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--c-text-3)' }}>
                  {owed > 0
                    ? <><span className="num">{fmtView(owed)}</span> goes back into Outstanding, under the same invoice numbers.</>
                    : 'Nothing is restored; they stay void.'}
                </p>
              </div>
            ) : <Note>Nothing of theirs was voided, so there is no old debt to restore.</Note>}

            {data.retainers.length > 0 && (
              <div>
                <Label>Pick a retainer back up</Label>
                <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
                  {data.retainers.map((r, idx) => row(
                    retainers.has(r.id), () => setRetainers(flip(retainers, r.id)),
                    <>{r.name}{r.endDate ? ` · ended ${formatDate(r.endDate)}` : ''}</>,
                    `${fmtView(r.amount)}/${r.frequency === 'monthly' ? 'mo' : r.frequency}`, r.id, idx))}
                </div>
                {retainers.size > 0 && (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <Input id="cb-start" label="Billing starts" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                    {data.retainers.filter(r => retainers.has(r.id)).map(r => (
                      <Input key={r.id} id={`cb-price-${r.id}`} label={`${r.name}, new price`} type="number" step="0.01"
                        value={prices[r.id] ?? ''} onChange={e => setPrices({ ...prices, [r.id]: e.target.value })} />
                    ))}
                  </div>
                )}
                <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--c-text-3)' }}>
                  A retainer picked back up bills from the start day, never for the months they were away, and counts as
                  returning MRR. Change the price if they came back on different terms.
                </p>
              </div>
            )}
          </>
        )}

        {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!data || reactivate.isPending}>
            {reactivate.isPending ? 'Saving...' : `Welcome ${client.name.split(' ')[0]} back`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
