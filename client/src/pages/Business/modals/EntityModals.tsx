import { useEffect, useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import { Textarea } from '../../../components/ui/Textarea'
import {
  useClients, useProjects, useServices,
  useCreateClient, useUpdateClient,
  useCreateProject, useUpdateProject,
  useCreateInvoice, useUpdateInvoice,
  useCreateRetainer, useLogTime,
  useCreateMeetingNote, useCreateCampaign, useUpdateCampaign, useDeleteCampaign,
  useCampaignSpend,
} from '../../../hooks/useBusiness'
import { useCreateExpense, useUpdateExpense } from '../../../hooks/useFinances'
import { useChangeCostPrice } from '../../../hooks/useBusiness'
import { today } from '../../../lib/utils'
import type { Client, Project, Service } from '../lib/types'

const STAGES = ['discovery', 'design', 'build', 'review', 'launched']
const PROJECT_STATUS = ['active', 'completed', 'paused', 'cancelled']
const PLATFORMS = ['meta', 'tiktok', 'google', 'instagram', 'youtube', 'linkedin', 'x', 'reddit', 'other']

function Footer({ onCancel, onSave, saving, label = 'Save' }: {
  onCancel: () => void; onSave: () => void; saving?: boolean; label?: string
}) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      <Button onClick={onSave} disabled={saving}>{saving ? 'Saving...' : label}</Button>
    </div>
  )
}

// ─── Client ───────────────────────────────────────────────────────────────────

export function ClientModal({ open, client, onClose }: { open: boolean; client?: any; onClose: () => void }) {
  const create = useCreateClient()
  const update = useUpdateClient()
  const [f, setF] = useState<any>({})

  useEffect(() => {
    if (open) setF(client ?? { name: '', status: 'active' })
  }, [open, client])

  const save = async () => {
    const body = {
      name: f.name, company: f.company || null, email: f.email || null, phone: f.phone || null,
      website: f.website || null, notes: f.notes || null, source: f.source || null,
      status: f.status ?? 'active',
    }
    if (client?.id) await update.mutateAsync({ id: client.id, ...body })
    else await create.mutateAsync(body)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={client?.id ? 'Edit client' : 'New client'} size="md">
      <div className="p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input id="c-name" label="Name" value={f.name ?? ''} autoFocus onChange={e => setF({ ...f, name: e.target.value })} />
          <Input id="c-company" label="Company" value={f.company ?? ''} onChange={e => setF({ ...f, company: e.target.value })} />
          <Input id="c-email" label="Email" value={f.email ?? ''} onChange={e => setF({ ...f, email: e.target.value })} />
          <Input id="c-phone" label="Phone" value={f.phone ?? ''} onChange={e => setF({ ...f, phone: e.target.value })} />
          <Input id="c-website" label="Website" value={f.website ?? ''} onChange={e => setF({ ...f, website: e.target.value })} />
          <Select id="c-status" label="Status" value={f.status ?? 'active'} onChange={e => setF({ ...f, status: e.target.value })}
            options={['active', 'lead', 'churned', 'inactive'].map(s => ({ value: s, label: s }))} />
        </div>
        <Textarea id="c-notes" label="What was agreed" rows={3} value={f.notes ?? ''}
          onChange={e => setF({ ...f, notes: e.target.value })}
          placeholder="Website for £299.98 and Local SEO for £149/mo" />
        <Footer onCancel={onClose} onSave={save} saving={create.isPending || update.isPending}
          label={client?.id ? 'Save' : 'Add client'} />
      </div>
    </Modal>
  )
}

// ─── Project ──────────────────────────────────────────────────────────────────

export function ProjectModal({
  open, project, clientId, onClose,
}: { open: boolean; project?: any; clientId?: number | null; onClose: () => void }) {
  const { data: clients = [] } = useClients()
  const { data: services = [] } = useServices()
  const create = useCreateProject()
  const update = useUpdateProject()
  const [f, setF] = useState<any>({})

  useEffect(() => {
    if (open) setF(project ?? {
      name: '', clientId: clientId ?? null, status: 'active', stage: 'discovery', startDate: today(),
    })
  }, [open, project, clientId])

  const save = async () => {
    const body = {
      name: f.name,
      clientId: f.clientId ? Number(f.clientId) : null,
      description: f.description || null,
      link: f.link || null,
      status: f.status ?? 'active',
      stage: f.stage ?? 'discovery',
      serviceId: f.serviceId ? Number(f.serviceId) : null,
      startDate: f.startDate || null,
      dueDate: f.dueDate || null,
      launchedDate: f.launchedDate || null,
      value: f.value != null && f.value !== '' ? Number(f.value) : null,
    }
    if (project?.id) await update.mutateAsync({ id: project.id, ...body })
    else await create.mutateAsync(body)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={project?.id ? 'Edit website' : 'New website'} size="md">
      <div className="p-5 space-y-3">
        <Input id="p-name" label="Name" value={f.name ?? ''} autoFocus onChange={e => setF({ ...f, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Select id="p-client" label="Client" value={f.clientId ? String(f.clientId) : ''}
            onChange={e => setF({ ...f, clientId: e.target.value })} placeholder="No client"
            options={(clients as Client[]).map(c => ({ value: String(c.id), label: c.name }))} />
          <Select id="p-service" label="Package" value={f.serviceId ? String(f.serviceId) : ''}
            onChange={e => setF({ ...f, serviceId: e.target.value })} placeholder="None"
            options={(services as Service[]).filter(s => s.kind === 'one_off').map(s => ({ value: String(s.id), label: s.name }))} />
          <Select id="p-stage" label="Stage" value={f.stage ?? 'discovery'} onChange={e => setF({ ...f, stage: e.target.value })}
            options={STAGES.map(s => ({ value: s, label: s }))} />
          <Select id="p-status" label="Status" value={f.status ?? 'active'} onChange={e => setF({ ...f, status: e.target.value })}
            options={PROJECT_STATUS.map(s => ({ value: s, label: s }))} />
          <Input id="p-value" label="Value" type="number" step="0.01" value={f.value ?? ''} onChange={e => setF({ ...f, value: e.target.value })} />
          <Input id="p-link" label="Live link" value={f.link ?? ''} onChange={e => setF({ ...f, link: e.target.value })} />
          <Input id="p-start" label="Started" type="date" value={f.startDate ?? ''} onChange={e => setF({ ...f, startDate: e.target.value })} />
          <Input id="p-due" label="Due" type="date" value={f.dueDate ?? ''} onChange={e => setF({ ...f, dueDate: e.target.value })} />
        </div>
        <Footer onCancel={onClose} onSave={save} saving={create.isPending || update.isPending}
          label={project?.id ? 'Save' : 'Create'} />
      </div>
    </Modal>
  )
}

// ─── Invoice ──────────────────────────────────────────────────────────────────

export function InvoiceModal({
  open, invoiceId, clientId, projectId, onClose,
}: {
  open: boolean
  invoiceId?: number | null
  clientId?: number | null
  projectId?: number | null
  onClose: () => void
}) {
  const { data: clients = [] } = useClients()
  const { data: projects = [] } = useProjects()
  const create = useCreateInvoice()
  const update = useUpdateInvoice()
  const [f, setF] = useState<any>({})

  useEffect(() => {
    if (!open) return
    const project = (projects as Project[]).find(p => p.id === projectId)
    setF({
      clientId: clientId ?? project?.clientId ?? '',
      projectId: projectId ?? '',
      amount: '', status: 'unpaid',
      issueDate: today(), dueDate: '', feeAmount: '', notes: '',
    })
  }, [open, clientId, projectId])

  const clientProjects = (projects as Project[]).filter(p => String(p.clientId) === String(f.clientId))

  const save = async () => {
    const body = {
      clientId: Number(f.clientId),
      projectId: f.projectId ? Number(f.projectId) : null,
      amount: Number(f.amount) || 0,
      status: f.status,
      issueDate: f.issueDate || today(),
      dueDate: f.dueDate || undefined,
      feeAmount: f.feeAmount ? Number(f.feeAmount) : undefined,
      paidDate: f.status === 'paid' ? (f.paidDate || today()) : null,
      notes: f.notes || null,
    }
    if (invoiceId) await update.mutateAsync({ id: invoiceId, ...body })
    else await create.mutateAsync(body)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={invoiceId ? 'Edit invoice' : 'New invoice'} size="md">
      <div className="p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Select id="i-client" label="Client" value={String(f.clientId ?? '')}
            onChange={e => setF({ ...f, clientId: e.target.value, projectId: '' })} placeholder="Pick a client"
            options={(clients as Client[]).map(c => ({ value: String(c.id), label: c.name }))} />
          <Select id="i-project" label="Website (optional)" value={String(f.projectId ?? '')}
            onChange={e => setF({ ...f, projectId: e.target.value })} placeholder="None"
            options={clientProjects.map(p => ({ value: String(p.id), label: p.name }))} />
          <Input id="i-amount" label="Amount" type="number" step="0.01" value={f.amount ?? ''}
            onChange={e => setF({ ...f, amount: e.target.value })} />
          <Select id="i-status" label="Status" value={f.status ?? 'unpaid'} onChange={e => setF({ ...f, status: e.target.value })}
            options={['draft', 'unpaid', 'paid'].map(s => ({ value: s, label: s }))} />
          <Input id="i-issue" label="Issued" type="date" value={f.issueDate ?? ''} onChange={e => setF({ ...f, issueDate: e.target.value })} />
          <Input id="i-due" label="Due" type="date" value={f.dueDate ?? ''} onChange={e => setF({ ...f, dueDate: e.target.value })} />
          {f.status === 'paid' && (
            <>
              <Input id="i-paid" label="Paid on" type="date" value={f.paidDate ?? today()} onChange={e => setF({ ...f, paidDate: e.target.value })} />
              <Input id="i-fee" label="Processing fee" type="number" step="0.01" value={f.feeAmount ?? ''}
                onChange={e => setF({ ...f, feeAmount: e.target.value })} />
            </>
          )}
        </div>
        <Input id="i-notes" label="What it is for" value={f.notes ?? ''} onChange={e => setF({ ...f, notes: e.target.value })} />
        <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
          Leave the due date blank for 7-day terms.
        </p>
        <Footer onCancel={onClose} onSave={save} saving={create.isPending || update.isPending}
          label={invoiceId ? 'Save' : 'Create invoice'} />
      </div>
    </Modal>
  )
}

// ─── Retainer ─────────────────────────────────────────────────────────────────

export function RetainerModal({
  open, clientId, presetAmount, onClose,
}: { open: boolean; clientId?: number | null; presetAmount?: number; onClose: () => void }) {
  const { data: clients = [] } = useClients()
  const { data: services = [] } = useServices()
  const create = useCreateRetainer()
  const [f, setF] = useState<any>({})

  useEffect(() => {
    if (!open) return
    const recurring = (services as Service[]).filter(s => s.kind === 'recurring')
    const svc = recurring[0]
    setF({
      clientId: clientId ?? '',
      serviceId: svc ? String(svc.id) : '',
      amount: presetAmount != null ? String(presetAmount) : String(svc?.defaultAmount ?? ''),
      startDate: today(),
      netTermDays: '6',
    })
  }, [open, clientId, presetAmount, services])

  const save = async () => {
    const svc = (services as Service[]).find(s => String(s.id) === String(f.serviceId))
    await create.mutateAsync({
      clientId: Number(f.clientId),
      serviceId: f.serviceId ? Number(f.serviceId) : null,
      name: svc?.name ?? 'Retainer',
      amount: Number(f.amount) || 0,
      frequency: (svc?.defaultFrequency as any) ?? 'monthly',
      startDate: f.startDate || today(),
      netTermDays: Number(f.netTermDays) || 0,
    })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="New retainer" size="sm">
      <div className="p-5 space-y-3">
        <Select id="r-client" label="Client" value={String(f.clientId ?? '')}
          onChange={e => setF({ ...f, clientId: e.target.value })} placeholder="Pick a client"
          options={(clients as Client[]).map(c => ({ value: String(c.id), label: c.name }))} />
        <Select id="r-service" label="Service" value={String(f.serviceId ?? '')}
          onChange={e => {
            const svc = (services as Service[]).find(s => String(s.id) === e.target.value)
            setF({ ...f, serviceId: e.target.value, amount: String(svc?.defaultAmount ?? f.amount) })
          }}
          options={(services as Service[]).filter(s => s.kind === 'recurring').map(s => ({ value: String(s.id), label: s.name }))} />
        <div className="grid grid-cols-2 gap-3">
          <Input id="r-amount" label="Amount per month" type="number" step="0.01" value={f.amount ?? ''}
            onChange={e => setF({ ...f, amount: e.target.value })} />
          <Input id="r-terms" label="Payment terms (days)" type="number" value={f.netTermDays ?? '6'}
            onChange={e => setF({ ...f, netTermDays: e.target.value })} />
        </div>
        <Input id="r-start" label="Starts" type="date" value={f.startDate ?? ''} onChange={e => setF({ ...f, startDate: e.target.value })} />
        <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
          The first invoice is raised for this start date, and one follows every month until you pause or cancel it.
        </p>
        <Footer onCancel={onClose} onSave={save} saving={create.isPending} label="Set up retainer" />
      </div>
    </Modal>
  )
}

// ─── Cost ─────────────────────────────────────────────────────────────────────

const REPEATS = [
  { value: 'once',      label: 'Does not repeat' },
  { value: 'weekly',    label: 'Every week' },
  { value: 'monthly',   label: 'Every month' },
  { value: 'quarterly', label: 'Every quarter' },
  { value: 'yearly',    label: 'Every year' },
]

/** What a repeat costs over twelve months, so a domain and a mailbox compare. */
const PER_YEAR: Record<string, number> = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 }

export function CostModal({
  open, expense, clientId, onClose,
}: { open: boolean; expense?: any; clientId?: number | null; onClose: () => void }) {
  const { data: clients = [] } = useClients()
  const create = useCreateExpense()
  const update = useUpdateExpense()
  const changePrice = useChangeCostPrice()
  const [f, setF] = useState<any>({})
  const [scope, setScope] = useState<'this' | 'future' | 'all'>('future')

  useEffect(() => {
    if (!open) return
    setScope('future')
    setF(expense
      ? {
        ...expense,
        // Editing a commitment means editing what it costs from here on.
        amount: expense.recurringAmount ?? expense.amount,
        repeat: expense.isRecurring ? (expense.frequency ?? 'monthly') : 'once',
      }
      : {
        description: '', amount: '', date: today(), category: 'Business',
        clientId: clientId ?? '', vendor: '', repeat: 'once',
      })
  }, [open, expense, clientId])

  const repeat = f.repeat ?? 'once'
  const recurring = repeat !== 'once'
  const amount = Number(f.amount) || 0
  const perYear = recurring && amount ? amount * (PER_YEAR[repeat] ?? 0) : 0

  // Changing the amount on something that repeats is a different act from
  // editing its description, so it goes through its own endpoint that knows
  // whether the new price applies to one charge or to every future one.
  const currentPrice = expense?.recurringAmount ?? expense?.amount ?? 0
  const priceChanged = !!expense?.id && recurring && Math.abs(amount - currentPrice) > 0.005

  const save = async () => {
    const body = {
      description: f.description,
      amount: priceChanged ? expense.amount : amount,
      date: f.date || today(),
      category: 'Business',
      clientId: f.clientId ? Number(f.clientId) : null,
      vendor: f.vendor || null,
      isRecurring: recurring ? 1 : 0,
      frequency: recurring ? repeat : null,
      notes: f.notes || null,
    }
    if (expense?.id) {
      await update.mutateAsync({ id: expense.id, ...body })
      if (priceChanged) await changePrice.mutateAsync({ id: expense.id, newAmount: amount, scope })
    } else {
      await create.mutateAsync(body)
    }
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={expense?.id ? 'Edit cost' : 'Add a business cost'} size="sm">
      <div className="p-5 space-y-3">
        <Input id="e-desc" label="What it was" value={f.description ?? ''} autoFocus
          onChange={e => setF({ ...f, description: e.target.value })} placeholder="Ken's Squarespace domain" />
        <div className="grid grid-cols-2 gap-3">
          <Input id="e-amount" label="Amount" type="number" step="0.01" value={f.amount ?? ''}
            onChange={e => setF({ ...f, amount: e.target.value })} />
          <Input id="e-date" label={recurring ? 'First charged' : 'Date'} type="date" value={f.date ?? ''}
            onChange={e => setF({ ...f, date: e.target.value })} />
          <Select id="e-client" label="For which client" value={String(f.clientId ?? '')}
            onChange={e => setF({ ...f, clientId: e.target.value })} placeholder="An overhead"
            options={(clients as Client[]).map(c => ({ value: String(c.id), label: c.name }))} />
          <Input id="e-vendor" label="Paid to" value={f.vendor ?? ''} onChange={e => setF({ ...f, vendor: e.target.value })}
            placeholder="Squarespace" />
        </div>

        {/* A domain renews once a year, a mailbox every month. A monthly-only
            checkbox could not say that, so every domain had to be re-entered
            by hand or logged at the wrong cadence. */}
        <Select id="e-repeat" label="Repeats" value={repeat}
          onChange={e => setF({ ...f, repeat: e.target.value })} options={REPEATS} />

        {perYear > 0 && (
          <p className="text-[11px] px-3 py-2 rounded-lg num"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
            {PER_YEAR[repeat]} x {amount.toFixed(2)} = {perYear.toFixed(2)} a year
            {repeat !== 'monthly' && `, about ${(perYear / 12).toFixed(2)} a month`}
          </p>
        )}

        {priceChanged && (
          <div className="rounded-lg px-3.5 py-3"
            style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.22)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-3)' }}>
              The price changed from {currentPrice.toFixed(2)} to {amount.toFixed(2)}
            </div>
            <div className="space-y-1.5">
              {([
                ['future', 'From now on it costs this', 'Past charges stay as they were. Future ones use the new price.'],
                ['this',   'Just this one charge was wrong', 'A correction. What it costs going forward does not change.'],
                ['all',    'It always cost this', 'Every charge on record is rewritten to the new amount.'],
              ] as const).map(([key, label, hint]) => (
                <label key={key} htmlFor={`scope-${key}`} className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    id={`scope-${key}`}
                    type="radio"
                    name="price-scope"
                    checked={scope === key}
                    onChange={() => setScope(key)}
                    className="w-3.5 h-3.5 mt-0.5 accent-indigo-500 shrink-0"
                  />
                  <span>
                    <span className="block text-xs" style={{ color: 'var(--c-text-1)' }}>{label}</span>
                    <span className="block text-[10.5px]" style={{ color: 'var(--c-text-3)' }}>{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
          Attaching a client is what makes their margin real. Left blank, it counts as an overhead.
          Repeats are raised automatically on the date they fall due.
        </p>
        <Footer onCancel={onClose} onSave={save} saving={create.isPending || update.isPending || changePrice.isPending}
          label={expense?.id ? 'Save' : 'Add cost'} />
      </div>
    </Modal>
  )
}

// ─── Time ─────────────────────────────────────────────────────────────────────

export function TimeModal({
  open, projectId, onClose,
}: { open: boolean; projectId: number | null; onClose: () => void }) {
  const { data: projects = [] } = useProjects()
  const log = useLogTime()
  const [f, setF] = useState<any>({})

  useEffect(() => {
    if (open) setF({ projectId: projectId ?? '', hours: '', minutes: '', date: today(), description: '' })
  }, [open, projectId])

  const save = async () => {
    const hours = (Number(f.hours) || 0) + (Number(f.minutes) || 0) / 60
    if (!f.projectId || hours <= 0) return
    await log.mutateAsync({
      projectId: Number(f.projectId),
      hours: Math.round(hours * 100) / 100,
      date: f.date || today(),
      description: f.description || undefined,
    })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Log hours" size="sm">
      <div className="p-5 space-y-3">
        <Select id="t-project" label="Website" value={String(f.projectId ?? '')}
          onChange={e => setF({ ...f, projectId: e.target.value })} placeholder="Pick a website"
          options={(projects as Project[]).map(p => ({ value: String(p.id), label: p.name }))} />
        <div className="grid grid-cols-3 gap-3">
          <Input id="t-hours" label="Hours" type="number" value={f.hours ?? ''} autoFocus
            onChange={e => setF({ ...f, hours: e.target.value })} />
          <Input id="t-mins" label="Minutes" type="number" value={f.minutes ?? ''}
            onChange={e => setF({ ...f, minutes: e.target.value })} />
          <Input id="t-date" label="Date" type="date" value={f.date ?? ''} onChange={e => setF({ ...f, date: e.target.value })} />
        </div>
        <Input id="t-desc" label="What you did" value={f.description ?? ''} onChange={e => setF({ ...f, description: e.target.value })} />
        <Footer onCancel={onClose} onSave={save} saving={log.isPending} label="Log it" />
      </div>
    </Modal>
  )
}

// ─── Meeting note ─────────────────────────────────────────────────────────────

export function NoteModal({
  open, clientId, onClose,
}: { open: boolean; clientId: number | null; onClose: () => void }) {
  const create = useCreateMeetingNote()
  const [f, setF] = useState<any>({})

  useEffect(() => {
    if (open) setF({ title: '', content: '', meetingDate: today(), clientId })
  }, [open, clientId])

  const save = async () => {
    await create.mutateAsync({
      title: f.title, content: f.content || null,
      meetingDate: f.meetingDate || null, clientId: clientId ?? null,
    })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="New note" size="md">
      <div className="p-5 space-y-3">
        <Input id="n-title" label="Title" value={f.title ?? ''} autoFocus onChange={e => setF({ ...f, title: e.target.value })} />
        <Input id="n-date" label="Date" type="date" value={f.meetingDate ?? ''} onChange={e => setF({ ...f, meetingDate: e.target.value })} />
        <Textarea id="n-content" label="Note" rows={6} value={f.content ?? ''} onChange={e => setF({ ...f, content: e.target.value })} />
        <Footer onCancel={onClose} onSave={save} saving={create.isPending} label="Save note" />
      </div>
    </Modal>
  )
}

// ─── Campaign ─────────────────────────────────────────────────────────────────

export function CampaignModal({
  open, campaign, onClose,
}: { open: boolean; campaign?: any; onClose: () => void }) {
  const create = useCreateCampaign()
  const update = useUpdateCampaign()
  const remove = useDeleteCampaign()
  const [f, setF] = useState<any>({})
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setConfirmDelete(false)
    setF(campaign ?? {
      name: '', platform: 'meta', budget: '', spent: '', fundingSource: 'business',
      startDate: today(), status: 'active', objective: 'leads',
    })
  }, [open, campaign])

  // Spend that came from the platform is the truth; typing over it would be
  // undone by the next sync, so the field is locked and says why.
  const synced = !!campaign?.lastSyncedAt
  const { data: daily = [] } = useCampaignSpend(synced ? campaign.id : null)

  const budget = Number(f.budget) || 0
  // Once days are being recorded, the campaign's own `spent` is only a fallback
  // for the era before recording started. Showing it here would be a stale
  // number sitting under a label claiming the platform supplies it.
  const measured = daily.reduce((t: number, d: any) => t + d.spend, 0)
  const spent = campaign?.measuredSpend ?? (synced && daily.length ? measured : Number(f.spent) || 0)
  const left = budget - spent

  const save = async () => {
    const body = {
      name: f.name,
      platform: f.platform,
      objective: f.objective || null,
      budget,
      fundingSource: f.fundingSource,
      startDate: f.startDate || today(),
      endDate: f.endDate || null,
      status: f.status,
      notes: f.notes || null,
      // Only send `spent` when it is still hand-maintained.
      ...(synced ? {} : { spent }),
    }
    if (campaign?.id) await update.mutateAsync({ id: campaign.id, ...body })
    else await create.mutateAsync(body)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={campaign?.id ? 'Edit campaign' : 'New campaign'} size="md">
      <div className="p-5 space-y-3">
        <Input id="ca-name" label="Name" value={f.name ?? ''} autoFocus onChange={e => setF({ ...f, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Select id="ca-platform" label="Platform" value={f.platform ?? 'meta'} onChange={e => setF({ ...f, platform: e.target.value })}
            options={PLATFORMS.map(p => ({ value: p, label: p }))} />
          <Select id="ca-funding" label="Paid by" value={f.fundingSource ?? 'business'}
            onChange={e => setF({ ...f, fundingSource: e.target.value })}
            options={[{ value: 'business', label: 'The business' }, { value: 'personal', label: 'Personal' }]} />
          <Input id="ca-budget" label="Budget" type="number" step="0.01" value={f.budget ?? ''}
            onChange={e => setF({ ...f, budget: e.target.value })} />
          <Input
            id="ca-spent"
            label={synced ? `Spent so far (from ${campaign.externalSource ?? 'the platform'})` : 'Spent so far'}
            type="number" step="0.01"
            className={synced ? 'opacity-50 cursor-not-allowed' : undefined}
            value={synced ? spent.toFixed(2) : (f.spent ?? '')}
            disabled={synced}
            onChange={e => setF({ ...f, spent: e.target.value })} />
          <Select id="ca-status" label="Status" value={f.status ?? 'active'} onChange={e => setF({ ...f, status: e.target.value })}
            options={['active', 'paused', 'completed'].map(v => ({ value: v, label: v }))} />
          <Select id="ca-objective" label="Objective" value={f.objective ?? 'leads'}
            onChange={e => setF({ ...f, objective: e.target.value })}
            options={['awareness', 'leads', 'sales', 'retargeting', 'brand'].map(v => ({ value: v, label: v }))} />
          <Input id="ca-start" label="Started" type="date" value={f.startDate ?? ''} onChange={e => setF({ ...f, startDate: e.target.value })} />
          <Input id="ca-end" label="Ends (optional)" type="date" value={f.endDate ?? ''} onChange={e => setF({ ...f, endDate: e.target.value })} />
        </div>

        {synced && (
          <p className="text-[11px] px-3 py-2 rounded-lg"
            style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', color: 'var(--c-text-2)' }}>
            Spend comes from {campaign.externalSource ?? 'the ad platform'} day by day
            {daily.length ? <> across <span className="num">{daily.length}</span> recorded days</> : null},
            so it is not editable here. Raising the budget is what you want when there is more to spend.
          </p>
        )}

        {budget > 0 && (
          <div className="text-[11px] px-3 py-2 rounded-lg num"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
            {left >= 0
              ? <>{left.toFixed(2)} of {budget.toFixed(2)} left to spend</>
              : <span style={{ color: 'var(--c-loss)' }}>{Math.abs(left).toFixed(2)} over the {budget.toFixed(2)} budget</span>}
          </div>
        )}

        <div className="flex justify-between gap-2 pt-1">
          {campaign?.id ? (
            confirmDelete ? (
              <span className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--c-loss)' }}>
                Delete this campaign and its daily spend?
                <Button variant="danger" size="sm" onClick={async () => { await remove.mutateAsync(campaign.id); onClose() }}>
                  Delete
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Keep</Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
            )
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={create.isPending || update.isPending}>
              {campaign?.id ? 'Save' : 'Create campaign'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
