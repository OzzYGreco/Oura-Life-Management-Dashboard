import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import { Textarea } from '../../../components/ui/Textarea'
import { MiniBtn } from '../components/primitives'
import {
  useReminder, usePaymentLink, useBusinessSettings, useSaveBusinessSettings, useBulkPricePreview, useBulkPrice, useMonthSummary, useServices,
  type BulkPriceBody, type OwnerPayOpts,
} from '../../../hooks/useBusiness'
import { formatDate, today } from '../../../lib/utils'
import type { FmtView } from '../../../hooks/useFmtView'

function useSettledValue<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [JSON.stringify(value)])
  return v
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

// ─── Reminder ────────────────────────────────────────────────────────────────

/**
 * A reminder for one invoice, ready to send from your own email: the message
 * can be edited here, copied, or opened in the mail app. A card payment link
 * can be made from here and is put into the message.
 */
export function ReminderModal({ invoice, onClose }: {
  invoice: { id: number; invoiceNumber: string } | null
  onClose: () => void
}) {
  const { data, refetch, isFetching } = useReminder(invoice?.id ?? null)
  const link = usePaymentLink()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // What every reminder signs off with and how to pay by bank, kept once.
  const { data: settings } = useBusinessSettings()
  const saveSettings = useSaveBusinessSettings()
  const [editing, setEditing] = useState(false)
  const [sets, setSets] = useState({ businessName: '', signOff: '', bankDetails: '' })
  useEffect(() => { if (settings) setSets(settings) }, [settings])

  useEffect(() => { if (data) { setSubject(data.subject); setBody(data.body) } }, [data])
  useEffect(() => { setNote(null); setError(null) }, [invoice?.id])
  if (!invoice) return null

  const makeLink = async () => {
    setError(null)
    try {
      const r = await link.mutateAsync({ id: invoice.id })
      await copy(r.url)
      setNote(r.reused ? 'The existing payment link is copied and in the message.' : 'Payment link made, copied, and added to the message.')
      await refetch()
    } catch (e: any) { setError(e?.response?.data?.error ?? 'Could not make a payment link') }
  }
  const mailto = `mailto:${encodeURIComponent(data?.to ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

  return (
    <Modal open onClose={onClose} size="md" title={`Remind about ${invoice.invoiceNumber}`}>
      <div className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 text-[11.5px]" style={{ color: 'var(--c-text-2)' }}>
          <span>To <b>{data?.to || 'no email saved for this client'}</b></span>
          <MiniBtn onClick={() => setEditing(v => !v)}>{editing ? 'Done' : data && !data.hasBank ? 'Add bank details' : 'Sign-off and bank details'}</MiniBtn>
        </div>
        {editing && (
          <div className="rounded-lg p-3 space-y-2.5" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
            <div className="grid grid-cols-2 gap-2.5">
              <Input id="rem-biz" label="Business name" value={sets.businessName} onChange={e => setSets({ ...sets, businessName: e.target.value })} />
              <Input id="rem-sign" label="Sign off as" value={sets.signOff} placeholder="Your name" onChange={e => setSets({ ...sets, signOff: e.target.value })} />
            </div>
            <Textarea id="rem-bank" label="Bank details (account name, sort code, account number)" rows={3}
              value={sets.bankDetails} onChange={e => setSets({ ...sets, bankDetails: e.target.value })} />
            <div className="flex justify-end">
              <MiniBtn tone="accent" disabled={saveSettings.isPending}
                onClick={async () => { await saveSettings.mutateAsync(sets); setEditing(false); await refetch() }}>
                Save for every reminder
              </MiniBtn>
            </div>
          </div>
        )}
        <Input id="rem-subject" label="Subject" value={subject} onChange={e => setSubject(e.target.value)} />
        <Textarea id="rem-body" label="Message" rows={13} value={body} onChange={e => setBody(e.target.value)} />
        {note && <p className="text-[11.5px]" style={{ color: 'var(--c-profit)' }}>{note}</p>}
        {error && <p className="text-[11.5px]" style={{ color: 'var(--c-loss)' }}>{error}</p>}
        <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
          <MiniBtn tone="accent" onClick={makeLink} disabled={link.isPending || isFetching}
            title="A Stripe link for what is still owed; the payment matches this invoice by itself">
            {link.isPending ? 'Making...' : data?.hasLink ? 'Copy payment link' : '+ Card payment link'}
          </MiniBtn>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="secondary" onClick={async () => setNote(await copy(`${subject}\n\n${body}`) ? 'Message copied.' : 'Could not copy; select the text instead.')}>
              Copy message
            </Button>
            <Button onClick={() => { window.location.href = mailto }} disabled={!data}>Open in email</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── Change prices for everyone ──────────────────────────────────────────────

/**
 * "Local SEO goes to £169 from 1 January for everyone on £149." Each client is
 * listed with the bill that is the first at the new price, and anyone can be
 * left out. Nothing already billed changes.
 */
export function BulkPriceModal({ open, onClose, fmtView }: { open: boolean; onClose: () => void; fmtView: FmtView }) {
  const { data: services = [] } = useServices()
  const recurring = services.filter(s => s.kind === 'recurring')
  const [serviceId, setServiceId] = useState('')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [from, setFrom] = useState('')
  const [exclude, setExclude] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const save = useBulkPrice()

  useEffect(() => {
    if (!open) return
    const first = recurring[0]
    setServiceId(first ? String(first.id) : ''); setCurrent(first?.defaultAmount ? String(first.defaultAmount) : '')
    setNext(''); setExclude([]); setError(null)
    const d = new Date(); setFrom(new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString('en-CA'))
  }, [open])

  const body = useSettledValue<BulkPriceBody | null>(serviceId && Number(next) > 0 && from ? {
    serviceId: Number(serviceId), currentAmount: current ? Number(current) : null, newAmount: Number(next), from, exclude,
  } : null)
  const { data: plan, error: planError, isFetching } = useBulkPricePreview(body)
  if (!open) return null

  const apply = async () => {
    if (!body) return
    setError(null)
    try { await save.mutateAsync(body); onClose() }
    catch (e: any) { setError(e?.response?.data?.error ?? 'Could not save that') }
  }
  const toggle = (id: number) => setExclude(x => (x.includes(id) ? x.filter(i => i !== id) : [...x, id]))

  return (
    <Modal open onClose={onClose} size="md" title="Change a price for everyone">
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Select id="bp-service" label="Service" value={serviceId} onChange={e => setServiceId(e.target.value)}
            options={recurring.map(s => ({ value: String(s.id), label: s.name }))} />
          <Input id="bp-from" label="From" type="date" value={from} min={today()} onChange={e => setFrom(e.target.value)} />
          <Input id="bp-current" label="For those paying (blank: everyone)" type="number" step="0.01" value={current} onChange={e => setCurrent(e.target.value)} />
          <Input id="bp-new" label="New price" type="number" step="0.01" value={next} autoFocus onChange={e => setNext(e.target.value)} />
        </div>
        <p className="text-[11px] -mt-1" style={{ color: 'var(--c-text-3)' }}>
          Each client changes from their first bill on or after this day. Nothing already billed changes.
        </p>

        {planError ? (
          <p className="text-[11.5px]" style={{ color: 'var(--c-loss)' }}>{(planError as any)?.response?.data?.error ?? 'That does not work'}</p>
        ) : plan && (
          <div>
            <p className="text-[12px] mb-2" style={{ color: 'var(--c-text-2)' }}>
              <b>{plan.count}</b> client{plan.count === 1 ? '' : 's'} move to {fmtView(Number(next))}.
              {plan.mrrDelta ? <> Monthly income {plan.mrrDelta > 0 ? 'rises' : 'falls'} by <b className="num">{fmtView(Math.abs(plan.mrrDelta))}</b> once all are through.</> : null}
            </p>
            <div className="rounded-lg overflow-hidden max-h-64 overflow-y-auto" style={{ border: '1px solid var(--c-border)' }}>
              {plan.rows.map((r, i) => (
                <label key={r.retainerId} className="flex items-center gap-3 px-3 py-1.5 text-[12px] cursor-pointer"
                  style={{ borderTop: i ? '1px solid var(--c-border)' : 'none', background: 'var(--c-bg-input)', opacity: r.included ? 1 : 0.5 }}>
                  <input type="checkbox" checked={r.included} disabled={!!r.why && !exclude.includes(r.retainerId)}
                    onChange={() => toggle(r.retainerId)} className="w-3.5 h-3.5 accent-[var(--c-accent)]" />
                  <span className="flex-1" style={{ color: 'var(--c-text-1)' }}>{r.clientName}</span>
                  <span style={{ color: 'var(--c-text-3)' }}>{r.why ?? `from ${formatDate(r.from)}`}</span>
                  <span className="num w-36 text-right" style={{ color: 'var(--c-text-2)' }}>
                    {fmtView(r.oldAmount)} {r.included ? <>to <b style={{ color: 'var(--c-text-1)' }}>{fmtView(r.newAmount)}</b></> : null}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={apply} disabled={!plan || !plan.count || isFetching || save.isPending}>
            {save.isPending ? 'Saving...' : `Change ${plan?.count ?? ''} price${plan?.count === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Month summary ───────────────────────────────────────────────────────────

/** One month on a page, for the partners: read it here, or copy it to send. */
export function MonthSummaryModal({ open, onClose, fmtView, ownerPayOpts }: {
  open: boolean; onClose: () => void; fmtView: FmtView; ownerPayOpts: OwnerPayOpts
}) {
  const months = useMemo(() => {
    const d = new Date()
    return Array.from({ length: 12 }, (_, i) => {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1)
      const key = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
      return { value: key, label: x.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + (i === 0 ? ' (so far)' : '') }
    })
  }, [])
  const [month, setMonth] = useState(months[1].value)
  const [copied, setCopied] = useState(false)
  const { data: s } = useMonthSummary(open ? month : null, ownerPayOpts)
  if (!open) return null

  const change = (now: number, before: number) => {
    if (!before) return null
    const up = now >= before
    return <span style={{ color: up ? 'var(--c-profit)' : 'var(--c-loss)' }}> {up ? 'up' : 'down'} {fmtView(Math.abs(now - before))}</span>
  }
  const Fig = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) => (
    <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
      <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>{label}</div>
      <div className="text-base font-bold num mt-0.5" style={{ color: 'var(--c-text-1)' }}>{value}</div>
      {sub && <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>{sub}</div>}
    </div>
  )

  return (
    <Modal open onClose={onClose} size="md" title="Month summary">
      <div className="p-5 space-y-4">
        <Select id="ms-month" label="Month" value={month} onChange={e => { setMonth(e.target.value); setCopied(false) }} options={months} />
        {!s ? <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Adding it up...</p> : (
          <>
            <div className="grid grid-cols-3 gap-2.5">
              <Fig label="Money in" value={fmtView(s.moneyIn)} sub={<>after fees{change(s.moneyIn, s.previous.moneyIn)}</>} />
              <Fig label="Costs" value={fmtView(s.costs)} sub={`ads ${fmtView(s.adSpend)}`} />
              <Fig label="Profit" value={<span style={{ color: s.profit >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>{fmtView(s.profit)}</span>}
                sub={<>{s.marginPct.toFixed(0)}% margin{change(s.profit, s.previous.profit)}</>} />
              <Fig label="Monthly recurring" value={fmtView(s.mrr.end)} sub={`from ${fmtView(s.mrr.start)}`} />
              <Fig label="Owed to you now" value={fmtView(s.owedNow)} sub={s.writtenOff ? `${fmtView(s.writtenOff)} written off` : 'nothing written off'} />
              <Fig label="Safe to take" value={fmtView(s.safeToDraw)} sub={s.draws.map(d => `${d.name.split(' ')[0]} took ${fmtView(d.taken)}`).join(', ')} />
            </div>
            <div className="text-[12px] space-y-1" style={{ color: 'var(--c-text-2)' }}>
              <p><b style={{ color: 'var(--c-text-1)' }}>Joined:</b> {s.joined.length ? s.joined.map(c => c.name).join(', ') : 'nobody'}</p>
              <p><b style={{ color: 'var(--c-text-1)' }}>Left:</b> {s.left.length ? s.left.map(c => c.name).join(', ') : 'nobody'}</p>
              {s.top.length > 0 && <p><b style={{ color: 'var(--c-text-1)' }}>Top paying:</b> {s.top.map(c => `${c.name} ${fmtView(c.amount)}`).join(', ')}</p>}
              <p><b style={{ color: 'var(--c-text-1)' }}>VAT:</b> {fmtView(s.vat.rolling12)} billed in the last 12 months, {s.vat.pct.toFixed(0)}% of the {fmtView(s.vat.threshold)} threshold.</p>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="secondary" onClick={() => window.print()} disabled={!s}>Print</Button>
          <Button onClick={async () => { if (s) setCopied(await copy(s.text)) }} disabled={!s}>{copied ? 'Copied' : 'Copy as text'}</Button>
        </div>
      </div>
    </Modal>
  )
}

/** A Remind button that brings its own reminder window, for any invoice row. */
export function RemindButton({ invoice, label = 'Remind' }: { invoice: { id: number; invoiceNumber: string }; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <MiniBtn tone="warn" onClick={() => setOpen(true)} title="A ready message to chase it, with a card payment link if you want one">{label}</MiniBtn>
      {open && <ReminderModal invoice={invoice} onClose={() => setOpen(false)} />}
    </>
  )
}
