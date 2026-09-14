import { useMemo, useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import { useServices, useClients, useCreateDeal } from '../../../hooks/useBusiness'
import { today } from '../../../lib/utils'
import type { Service, Client } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

const SOURCES = ['', 'Meta ads', 'TikTok ads', 'Referral', 'Cold outreach', 'Google', 'Word of mouth', 'Other']

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/**
 * One form for a whole piece of new work.
 *
 * This is the flow that prompted the rebuild. It used to be: new client, then
 * the Projects tab, then a new project re-picking that client, then the Invoices
 * tab, then a new invoice re-picking the client AND the project, then two more
 * invoices doing the same again. Nine clicks, three modals, three tabs, and a
 * long unsorted list at the end of it.
 */
export function NewWorkModal({
  open, onClose, fmtView, presetClientId, onCreated,
}: {
  open: boolean
  onClose: () => void
  fmtView: FmtView
  presetClientId?: number | null
  onCreated: (clientId: number) => void
}) {
  const { data: services = [] } = useServices()
  const { data: clients = [] } = useClients()
  const createDeal = useCreateDeal()

  const [clientId, setClientId] = useState<string>(presetClientId ? String(presetClientId) : '')
  const [newClient, setNewClient] = useState({ name: '', company: '', email: '', phone: '', website: '', source: '' })
  const [picked, setPicked] = useState<Record<number, string>>({})
  const [projectName, setProjectName] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [termDays, setTermDays] = useState('6')
  const [sendFirst, setSendFirst] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isNew = clientId === ''
  const start = today()

  const toggle = (svc: Service) => {
    setPicked(p => {
      const next = { ...p }
      if (next[svc.id] != null) delete next[svc.id]
      else next[svc.id] = String(svc.defaultAmount ?? 0)
      return next
    })
  }

  const chosen = useMemo(
    () => services.filter(s => picked[s.id] != null),
    [services, picked],
  )
  const build = chosen.find(s => s.kind === 'one_off')
  const recurring = chosen.filter(s => s.kind === 'recurring')
  const monthly = recurring.reduce((s, svc) => s + (Number(picked[svc.id]) || 0), 0)

  /** Shown live, so the split is never a surprise after the fact. */
  const milestonePreview = useMemo(() => {
    if (!build) return []
    const total = Number(picked[build.id]) || 0
    const ms = build.milestones?.length ? build.milestones : [{ label: 'Full', pct: 100, offsetDays: 0 }]
    let allocated = 0
    return ms.map((m, i) => {
      const isLast = i === ms.length - 1
      const amount = isLast
        ? Math.round((total - allocated) * 100) / 100
        : Math.round(total * (m.pct / 100) * 100) / 100
      allocated = Math.round((allocated + amount) * 100) / 100
      return { label: m.label, amount, date: addDays(start, m.offsetDays ?? 0) }
    })
  }, [build, picked, start])

  const clientName = isNew
    ? newClient.name
    : (clients as Client[]).find(c => c.id === Number(clientId))?.name ?? ''

  const canSubmit = chosen.length > 0 && (isNew ? newClient.name.trim().length > 0 : true)
    && (!build || projectName.trim().length > 0)

  const submit = async () => {
    setError(null)
    try {
      const res = await createDeal.mutateAsync({
        clientId: isNew ? undefined : Number(clientId),
        client: isNew ? {
          name: newClient.name.trim(),
          company: newClient.company || null,
          email: newClient.email || null,
          phone: newClient.phone || null,
          website: newClient.website || null,
          source: newClient.source || null,
          status: 'active',
        } : undefined,
        project: build ? {
          name: projectName.trim(),
          dueDate: dueDate || null,
          startDate: start,
        } : undefined,
        items: chosen.map(s => ({
          serviceId: s.id,
          amount: Number(picked[s.id]) || 0,
          termDays: Number(termDays) || 0,
          startDate: start,
        })),
        sendFirst,
      })
      reset()
      onCreated(res.clientId)
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Could not create that')
    }
  }

  const reset = () => {
    setClientId(presetClientId ? String(presetClientId) : '')
    setNewClient({ name: '', company: '', email: '', phone: '', website: '', source: '' })
    setPicked({})
    setProjectName('')
    setDueDate('')
    setError(null)
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose() }} title="New work" size="lg">
      <div className="p-5 space-y-5">
        {/* ── Who ──────────────────────────────────────────────────────── */}
        <div>
          <Select
            id="deal-client"
            label="Client"
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            placeholder="New client"
            options={(clients as Client[]).map(c => ({
              value: String(c.id),
              label: c.company ? `${c.name} - ${c.company}` : c.name,
            }))}
          />
          {isNew && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Input id="deal-name" label="Name" value={newClient.name} autoFocus
                onChange={e => setNewClient(v => ({ ...v, name: e.target.value }))} placeholder="Dean Harris" />
              <Input id="deal-company" label="Company" value={newClient.company}
                onChange={e => setNewClient(v => ({ ...v, company: e.target.value }))} placeholder="Frost Coatings" />
              <Input id="deal-email" label="Email" value={newClient.email}
                onChange={e => setNewClient(v => ({ ...v, email: e.target.value }))} />
              <Input id="deal-phone" label="Phone" value={newClient.phone}
                onChange={e => setNewClient(v => ({ ...v, phone: e.target.value }))} />
              <Input id="deal-website" label="Website" value={newClient.website}
                onChange={e => setNewClient(v => ({ ...v, website: e.target.value }))} />
              <Select id="deal-source" label="Where they came from" value={newClient.source}
                onChange={e => setNewClient(v => ({ ...v, source: e.target.value }))}
                placeholder="Not sure"
                options={SOURCES.filter(Boolean).map(s => ({ value: s, label: s }))} />
            </div>
          )}
        </div>

        {/* ── What they are buying ─────────────────────────────────────── */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-3)' }}>
            What they are buying
          </div>
          <div className="space-y-2">
            {services.map(svc => {
              const on = picked[svc.id] != null
              return (
                <div key={svc.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg"
                  style={{
                    background: on ? 'rgba(129,140,248,0.08)' : 'var(--c-bg-input)',
                    border: `1px solid ${on ? 'rgba(129,140,248,0.3)' : 'var(--c-border)'}`,
                  }}>
                  <input
                    id={`svc-${svc.id}`}
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(svc)}
                    className="w-4 h-4 shrink-0 cursor-pointer accent-indigo-500"
                  />
                  <label htmlFor={`svc-${svc.id}`} className="flex-1 text-sm cursor-pointer" style={{ color: 'var(--c-text-1)' }}>
                    {svc.name}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>£</span>
                    <input
                      id={`svc-amount-${svc.id}`}
                      type="number"
                      step="0.01"
                      value={on ? picked[svc.id] : (svc.defaultAmount ?? '')}
                      disabled={!on}
                      onChange={e => setPicked(p => ({ ...p, [svc.id]: e.target.value }))}
                      className="w-24 rounded-md px-2 py-1 text-sm num text-right outline-none disabled:opacity-40"
                      style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }}
                    />
                    <span className="text-[11px] w-8" style={{ color: 'var(--c-text-3)' }}>
                      {svc.kind === 'recurring' ? '/mo' : ''}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── The build, if one was ticked ─────────────────────────────── */}
        {build && (
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Input
                id="deal-project"
                label="Website name"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder={clientName ? `${clientName} website` : 'Website name'}
              />
            </div>
            <Input id="deal-due" label="Due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Input id="deal-terms" label="Payment terms (days)" type="number" value={termDays}
            onChange={e => setTermDays(e.target.value)} />
          {build && (
            <label htmlFor="deal-send" className="col-span-2 flex items-end gap-2 pb-2 text-xs cursor-pointer"
              style={{ color: 'var(--c-text-2)' }}>
              <input id="deal-send" type="checkbox" checked={sendFirst} onChange={e => setSendFirst(e.target.checked)}
                className="w-4 h-4 accent-indigo-500" />
              Send the deposit invoice now. The rest stay as drafts until the work reaches them.
            </label>
          )}
        </div>

        {/* ── What this will create ────────────────────────────────────── */}
        {chosen.length > 0 && (
          <div className="rounded-lg px-3.5 py-3 text-xs"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-3)' }}>
              This will create
            </div>
            <ul className="space-y-1" style={{ color: 'var(--c-text-2)' }}>
              {isNew && <li>1 client, {newClient.name || 'unnamed'}</li>}
              {build && <li>1 website worth <span className="num">{fmtView(Number(picked[build.id]) || 0)}</span></li>}
              {milestonePreview.map(m => (
                <li key={m.label} className="pl-3">
                  {m.label}: <span className="num" style={{ color: 'var(--c-text-1)' }}>{fmtView(m.amount)}</span>
                  <span className="num" style={{ color: 'var(--c-text-3)' }}> on {m.date}</span>
                </li>
              ))}
              {recurring.map(s => (
                <li key={s.id}>
                  {s.name} at <span className="num" style={{ color: 'var(--c-accent)' }}>{fmtView(Number(picked[s.id]) || 0)}/mo</span>,
                  invoicing every month from today
                </li>
              ))}
              {monthly > 0 && (
                <li className="pt-1.5 mt-1.5" style={{ borderTop: '1px solid var(--c-border)', color: 'var(--c-text-1)' }}>
                  MRR goes up by <span className="num" style={{ color: 'var(--c-accent)' }}>{fmtView(monthly)}/mo</span>
                </li>
              )}
            </ul>
          </div>
        )}

        {error && (
          <p className="text-xs px-3 py-2 rounded-lg"
            style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', color: 'var(--c-loss)' }}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit || createDeal.isPending}>
            {createDeal.isPending ? 'Creating...' : 'Create work'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
