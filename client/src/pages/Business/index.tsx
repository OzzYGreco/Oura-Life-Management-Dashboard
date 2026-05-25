import { useState, Fragment } from 'react'
import { useForm } from 'react-hook-form'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts'
import {
  useClients, useProjects, useProjectTasks, useInvoices, useMeetingNotes,
  useCreateClient, useUpdateClient, useDeleteClient,
  useCreateProject, useUpdateProject, useDeleteProject,
  useCreateInvoice, useUpdateInvoice, useDeleteInvoice,
  useCreateMeetingNote, useUpdateMeetingNote, useDeleteMeetingNote,
  useUpdateTask, useCreateTask, useDeleteTask,
  useTimeEntries, useCreateTimeEntry, useDeleteTimeEntry, useAllTimeEntries,
  useCampaigns, useCreateCampaign, useUpdateCampaign, useDeleteCampaign,
} from '../../hooks/useBusiness'
import { PageShell } from '../../components/layout/PageShell'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Tabs } from '../../components/ui/Tabs'
import { StatCard } from '../../components/ui/StatCard'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageLoader } from '../../components/ui/Spinner'
import { useFinanceExpenses, useCreateExpense, useUpdateExpense, useDeleteExpense } from '../../hooks/useFinances'
import { formatDate, today } from '../../lib/utils'
import { useFmtView } from '../../hooks/useFmtView'
import { CurrencySelector } from '../../components/ui/CurrencySelector'
import { ConversionBanner } from '../../components/ui/ConversionBanner'
import { TASK_STATUSES, INVOICE_STATUSES } from '../../lib/constants'
import { Plus, Briefcase, Pencil, Trash2, ExternalLink, Check, TrendingUp, Clock, Search, ChevronDown, ChevronUp, Repeat, Megaphone, Wallet, Building2 } from 'lucide-react'

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'clients',    label: 'Clients' },
  { id: 'projects',   label: 'Projects' },
  { id: 'invoices',   label: 'Invoices' },
  { id: 'revenue',    label: 'Revenue' },
  { id: 'marketing',  label: 'Marketing' },
  { id: 'notes',      label: 'Notes' },
]

// ─── Marketing constants ───────────────────────────────────────────────────────
const PLATFORMS: { value: string; label: string; color: string }[] = [
  { value: 'google',    label: 'Google Ads',  color: '#4285f4' },
  { value: 'meta',      label: 'Meta',        color: '#818cf8' },
  { value: 'tiktok',    label: 'TikTok',      color: '#e879f9' },
  { value: 'linkedin',  label: 'LinkedIn',    color: '#22d3ee' },
  { value: 'youtube',   label: 'YouTube',     color: '#f87171' },
  { value: 'pinterest', label: 'Pinterest',   color: '#fb923c' },
  { value: 'snapchat',  label: 'Snapchat',    color: '#fbbf24' },
  { value: 'x',         label: 'X / Twitter', color: '#8b8baa' },
  { value: 'other',     label: 'Other',       color: '#6b7280' },
]
const OBJECTIVES = ['awareness', 'leads', 'sales', 'retargeting', 'brand']
const CAMPAIGN_STATUSES = ['active', 'paused', 'completed']

function platformMeta(value: string) {
  return PLATFORMS.find(p => p.value === value) ?? { label: value, color: '#6b7280' }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function last6Months() {
  const now = new Date()
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('default', { month: 'short' }),
    }
  })
}

function clientInitials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function ConfirmDelete({ id, onConfirm, onCancel }: { id: number; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={onConfirm} className="text-[10px] text-pnl-loss hover:underline">confirm</button>
      <button onClick={onCancel} className="text-[10px] text-text-muted hover:underline">cancel</button>
    </div>
  )
}

// ─── Overview Tab ──────────────────────────────────────────────────────────

function OverviewTab() {
  const { fmtView } = useFmtView('GBP', 'business')
  const { data: invoices   = [] } = useInvoices()
  const { data: clients    = [] } = useClients()
  const { data: projects   = [] } = useProjects()
  const { data: allTime    = [] } = useAllTimeEntries()
  const { data: campaigns  = [] } = useCampaigns()

  const totalRevenue       = invoices.filter((i: any) => i.status === 'paid').reduce((s: number, i: any) => s + i.amount, 0)
  const outstanding        = invoices.filter((i: any) => ['unpaid','overdue'].includes(i.status)).reduce((s: number, i: any) => s + i.amount, 0)
  const activeProjects     = projects.filter((p: any) => p.status === 'active').length
  const activeClients      = clients.filter((c: any) => c.status === 'active').length
  const businessAdSpend    = (campaigns as any[]).filter(c => c.fundingSource === 'business').reduce((s: number, c: any) => s + (c.spent ?? 0), 0)
  const netRevenue         = totalRevenue - businessAdSpend

  const months   = last6Months()
  const chartData = months.map(m => ({
    month:   m.label,
    revenue: invoices.filter((i: any) => i.status === 'paid' && i.paidDate?.startsWith(m.key)).reduce((s: number, i: any) => s + i.amount, 0),
  }))

  const upcoming = [...invoices]
    .filter((i: any) => ['unpaid','overdue'].includes(i.status))
    .sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 7)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Net Revenue"
          value={fmtView(netRevenue)}
          valueColor="text-pnl-profit"
          iconBg="from-emerald-500/20 to-teal-500/20"
          iconColor="text-pnl-profit"
          sub={businessAdSpend > 0 ? `${fmtView(totalRevenue)} gross · ${fmtView(businessAdSpend)} ad spend` : undefined}
        />
        <StatCard label="Outstanding"      value={fmtView(outstanding)}   valueColor="text-amber-400"   iconBg="from-amber-500/20 to-orange-500/20"  iconColor="text-amber-400" />
        <StatCard label="Active Projects"  value={activeProjects}                                              iconBg="from-indigo-500/20 to-violet-500/20" iconColor="text-accent-blue" />
        <StatCard label="Active Clients"   value={activeClients}                                               iconBg="from-cyan-500/20 to-sky-500/20"      iconColor="text-accent-cyan" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-bg-card border border-bg-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-4">Monthly Revenue</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barSize={30}>
                <CartesianGrid vertical={false} stroke="var(--c-chart-grid)" />
                <XAxis dataKey="month" tick={{ fill: '#8b8baa', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8b8baa', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: any) => `£${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                <Tooltip
                  formatter={(v: any) => [fmtView(v as number), 'Revenue']}
                  contentStyle={{ background: 'var(--c-chart-tooltip-bg)', border: '1px solid var(--c-border-mid)', borderRadius: 8, color: 'var(--c-text-1)' }}
                  labelStyle={{ color: '#eeeef5' }}
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                />
                <Bar dataKey="revenue" fill="#818cf8" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-bg-card border border-bg-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3">Upcoming Invoices</h3>
          {upcoming.length === 0 ? (
            <p className="text-xs text-text-muted">No outstanding invoices</p>
          ) : (
            <div className="space-y-2">
              {upcoming.map((i: any) => {
                const client  = clients.find((c: any) => c.id === i.clientId)
                const overdue = i.status === 'overdue' || new Date(i.dueDate) < new Date()
                return (
                  <div key={i.id} className="flex items-center justify-between py-1.5 border-b border-bg-border/50 last:border-0">
                    <div>
                      <p className="text-xs font-medium text-text-primary">{client?.name || '--'}</p>
                      <p className="text-[11px] text-text-muted num">{i.invoiceNumber} · due {formatDate(i.dueDate)}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-xs num font-semibold ${overdue ? 'text-pnl-loss' : 'text-amber-400'}`}>{fmtView(i.amount)}</p>
                      {overdue && <p className="text-[10px] text-pnl-loss">overdue</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Profitability */}
      {(() => {
        // Paid invoice totals keyed by projectId
        const collectedByProject = (invoices as any[])
          .filter(i => i.status === 'paid' && i.projectId)
          .reduce((acc: Record<number, number>, i) => {
            acc[i.projectId] = (acc[i.projectId] || 0) + i.amount
            return acc
          }, {})

        const trackedProjects = projects.filter((p: any) =>
          p.value || allTime.some((e: any) => e.projectId === p.id) || collectedByProject[p.id]
        )
        if (!trackedProjects.length) return null
        return (
          <div className="bg-bg-card border border-bg-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-bg-border">
              <h3 className="text-sm font-semibold text-text-primary">Project Profitability</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bg-border/50">
                  {['Project', 'Client', 'Collected', 'Value', 'Hours Logged', 'Effective Rate', 'Status'].map(h => (
                    <th key={h} className="text-left text-xs text-text-muted font-medium px-4 py-2 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trackedProjects.map((p: any) => {
                  const client      = clients.find((c: any) => c.id === p.clientId)
                  const hours       = allTime.filter((e: any) => e.projectId === p.id).reduce((s: number, e: any) => s + e.hours, 0)
                  const rate        = p.value && hours > 0 ? p.value / hours : null
                  const rateColor   = !rate ? 'text-text-muted' : rate >= 75 ? 'text-pnl-profit' : rate >= 35 ? 'text-amber-400' : 'text-pnl-loss'
                  const collected   = collectedByProject[p.id] ?? 0
                  const pct         = p.value && collected > 0 ? Math.min((collected / p.value) * 100, 100) : 0
                  return (
                    <tr key={p.id} className="border-b border-bg-border/30 hover:bg-bg-hover/20">
                      <td className="px-4 py-2.5 font-medium text-text-primary">{p.name}</td>
                      <td className="px-4 py-2.5 text-text-secondary">{client?.name || '--'}</td>

                      {/* Collected — with progress bar when value is known */}
                      <td className="px-4 py-2.5">
                        {collected > 0 ? (
                          <div>
                            <p className="num font-semibold text-pnl-profit leading-tight">{fmtView(collected)}</p>
                            {p.value && (
                              <>
                                <p className="text-[11px] text-text-muted num mt-0.5">of {fmtView(p.value)}</p>
                                <div className="mt-1 h-1 rounded-full overflow-hidden bg-bg-border w-20">
                                  <div className="h-full rounded-full bg-pnl-profit transition-all" style={{ width: `${pct}%` }} />
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <span className="text-text-muted text-xs">none yet</span>
                        )}
                      </td>

                      <td className="px-4 py-2.5 num text-text-secondary">
                        {p.value ? fmtView(p.value) : <span className="text-text-muted">--</span>}
                      </td>
                      <td className="px-4 py-2.5 num text-text-secondary">{hours > 0 ? `${hours.toFixed(1)}h` : <span className="text-text-muted">--</span>}</td>
                      <td className="px-4 py-2.5 num font-semibold">
                        {rate
                          ? <span className={rateColor}>{fmtView(rate)}/h</span>
                          : <span className="text-text-muted text-xs">{!p.value ? 'no value set' : 'no time logged'}</span>
                        }
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={p.status === 'active' ? 'blue' : p.status === 'completed' ? 'green' : 'gray'}>{p.status}</Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Client Detail Modal ───────────────────────────────────────────────────

function ClientDetailModal({ client, onClose }: { client: any; onClose: () => void }) {
  const { fmtView } = useFmtView('GBP', 'business')
  const [innerTab, setInnerTab] = useState('projects')
  const { data: projects = [] } = useProjects()
  const { data: invoices = [] } = useInvoices()
  const { data: notes    = [] } = useMeetingNotes()

  const cp = projects.filter((p: any) => p.clientId === client.id)
  const ci = invoices.filter((i: any) => i.clientId === client.id)
  const cn = notes.filter((n: any) => n.clientId === client.id)
  const totalEarned   = ci.filter((i: any) => i.status === 'paid').reduce((s: number, i: any) => s + i.amount, 0)
  const outstanding   = ci.filter((i: any) => ['unpaid','overdue'].includes(i.status)).reduce((s: number, i: any) => s + i.amount, 0)

  const innerTabs = [
    { id: 'projects', label: `Projects (${cp.length})` },
    { id: 'invoices', label: `Invoices (${ci.length})` },
    { id: 'notes',    label: `Notes (${cn.length})` },
  ]

  return (
    <Modal open onClose={onClose} title={client.name} size="lg">
      <div className="p-5">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-base font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #818cf8, #a78bfa)' }}>
            {clientInitials(client.name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              {client.company && <p className="text-sm text-text-muted">{client.company}</p>}
              <Badge variant={client.status === 'active' ? 'green' : client.status === 'lead' ? 'yellow' : 'gray'}>{client.status}</Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-text-muted flex-wrap">
              {client.email   && <span>{client.email}</span>}
              {client.phone   && <span>{client.phone}</span>}
              {client.website && (
                <a href={client.website} target="_blank" rel="noopener noreferrer" className="text-accent-blue flex items-center gap-1 hover:underline">
                  <ExternalLink size={10} />{client.website.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>
            {client.notes && <p className="text-xs text-text-secondary mt-1 italic">{client.notes}</p>}
          </div>
          <div className="flex gap-5 text-right flex-shrink-0">
            <div>
              <p className="text-[11px] text-text-muted uppercase tracking-wide">Earned</p>
              <p className="text-base num font-semibold text-pnl-profit">{fmtView(totalEarned)}</p>
            </div>
            {outstanding > 0 && (
              <div>
                <p className="text-[11px] text-text-muted uppercase tracking-wide">Owed</p>
                <p className="text-base num font-semibold text-amber-400">{fmtView(outstanding)}</p>
              </div>
            )}
          </div>
        </div>

        <Tabs tabs={innerTabs} active={innerTab} onChange={setInnerTab} />

        <div className="mt-4 space-y-2">
          {innerTab === 'projects' && (cp.length === 0 ? <p className="text-sm text-text-muted py-2">No projects yet</p> : cp.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between bg-bg-secondary rounded-lg px-4 py-3">
              <div>
                <p className="text-sm font-medium text-text-primary">{p.name}</p>
                {p.description && <p className="text-xs text-text-muted">{p.description}</p>}
              </div>
              <div className="flex items-center gap-3">
                {p.value && <span className="text-xs num text-pnl-profit font-medium">{fmtView(p.value)}</span>}
                <Badge variant={p.status === 'active' ? 'blue' : p.status === 'completed' ? 'green' : 'gray'}>{p.status}</Badge>
                {p.link && <a href={p.link} target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:opacity-70"><ExternalLink size={13} /></a>}
              </div>
            </div>
          )))}

          {innerTab === 'invoices' && (ci.length === 0 ? <p className="text-sm text-text-muted py-2">No invoices yet</p> : ci.map((i: any) => (
            <div key={i.id} className="flex items-center justify-between bg-bg-secondary rounded-lg px-4 py-3">
              <div>
                <p className="text-sm font-medium text-text-primary num">{i.invoiceNumber}</p>
                <p className="text-xs text-text-muted num">Due {formatDate(i.dueDate)}{i.paidDate ? ` · Paid ${formatDate(i.paidDate)}` : ''}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm num font-semibold text-text-primary">{fmtView(i.amount)}</span>
                <Badge variant={i.status === 'paid' ? 'green' : i.status === 'overdue' ? 'red' : 'yellow'}>{i.status}</Badge>
              </div>
            </div>
          )))}

          {innerTab === 'notes' && (cn.length === 0 ? <p className="text-sm text-text-muted py-2">No notes yet</p> : cn.map((n: any) => (
            <div key={n.id} className="bg-bg-secondary rounded-lg px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-text-primary">{n.title}</p>
                <span className="text-xs text-text-muted num">{formatDate(n.meetingDate)}</span>
              </div>
              {n.content && <p className="text-xs text-text-secondary line-clamp-2">{n.content}</p>}
            </div>
          )))}
        </div>
      </div>
    </Modal>
  )
}

// ─── Client Modal (create / edit) ─────────────────────────────────────────

function ClientModal({ client, onClose }: { client?: any; onClose: () => void }) {
  const initialStatus = 'active'
  const createClient = useCreateClient()
  const updateClient = useUpdateClient()
  const { register, handleSubmit } = useForm({
    defaultValues: client
      ? { name: client.name, email: client.email || '', phone: client.phone || '', company: client.company || '', website: client.website || '', notes: client.notes || '', status: client.status }
      : { name: '', email: '', phone: '', company: '', website: '', notes: '', status: initialStatus },
  })

  const onSubmit = async (data: any) => {
    if (client) await updateClient.mutateAsync({ id: client.id, ...data })
    else        await createClient.mutateAsync(data)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={client ? 'Edit Client' : 'New Client'}>
      <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Name" {...register('name', { required: true })} />
          <Input label="Company" {...register('company')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Email" type="email" {...register('email')} />
          <Input label="Phone" {...register('phone')} />
        </div>
        <Input label="Website" placeholder="https://..." {...register('website')} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Status" options={['active','lead','inactive'].map(v => ({ value: v, label: v }))} {...register('status')} />
          <div />
        </div>
        <Textarea label="Notes" rows={2} {...register('notes')} />
        <div className="flex justify-end gap-3 pt-2 border-t border-bg-border">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">{client ? 'Save Changes' : 'Add Client'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Clients Tab ───────────────────────────────────────────────────────────

function ClientsTab() {
  const { fmtView } = useFmtView('GBP', 'business')
  const { data: clients, isPending } = useClients()
  const { data: invoices = [] }      = useInvoices()
  const { data: projects = [] }      = useProjects()
  const deleteClient = useDeleteClient()
  const [editClient,    setEditClient]    = useState<any>(null)
  const [viewClient,    setViewClient]    = useState<any>(null)
  const [createOpen,    setCreateOpen]    = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  if (isPending) return <PageLoader />

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} /> New Client</Button>
      </div>
      {!clients?.length ? (
        <EmptyState icon={<Briefcase size={32} />} title="No clients yet" action={<Button onClick={() => setCreateOpen(true)}><Plus size={14} /> Add Client</Button>} />
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {clients.map((c: any) => {
            const earned      = invoices.filter((i: any) => i.clientId === c.id && i.status === 'paid').reduce((s: number, i: any) => s + i.amount, 0)
            const outstanding = invoices.filter((i: any) => i.clientId === c.id && ['unpaid','overdue'].includes(i.status)).reduce((s: number, i: any) => s + i.amount, 0)
            const projectCount = projects.filter((p: any) => p.clientId === c.id).length
            return (
              <div key={c.id} className="bg-bg-card border border-bg-border rounded-xl p-4 hover:border-accent-blue/20 transition-colors flex flex-col">
                <div className="flex items-start gap-2.5 mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #818cf8, #a78bfa)' }}>
                    {clientInitials(c.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="font-semibold text-text-primary text-sm truncate">{c.name}</p>
                      <Badge variant={c.status === 'active' ? 'green' : c.status === 'lead' ? 'yellow' : 'gray'}>{c.status}</Badge>
                    </div>
                    {c.company && <p className="text-xs text-text-muted truncate">{c.company}</p>}
                  </div>
                </div>

                <div className="space-y-1 text-xs mb-3">
                  {c.email && <p className="text-text-muted">{c.email}</p>}
                  {c.website && (
                    <a href={c.website} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-accent-blue flex items-center gap-1 hover:underline w-fit">
                      <ExternalLink size={10} />{c.website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </div>

                <div className="flex items-center justify-between py-2.5 border-t border-bg-border text-xs mt-auto">
                  <span className="text-text-muted">{projectCount} project{projectCount !== 1 ? 's' : ''}</span>
                  <div className="text-right">
                    {earned > 0      && <p className="num font-semibold text-pnl-profit">{fmtView(earned)}</p>}
                    {outstanding > 0 && <p className="num text-amber-400">{fmtView(outstanding)} owed</p>}
                  </div>
                </div>

                <div className="flex items-center justify-between mt-2">
                  <button onClick={() => setViewClient(c)} className="text-xs text-text-muted hover:text-accent-blue transition-colors">View details →</button>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setEditClient(c)} className="p-1 text-text-muted hover:text-text-primary rounded transition-colors"><Pencil size={12} /></button>
                    {confirmDelete === c.id
                      ? <ConfirmDelete id={c.id} onConfirm={() => { deleteClient.mutate(c.id); setConfirmDelete(null) }} onCancel={() => setConfirmDelete(null)} />
                      : <button onClick={() => setConfirmDelete(c.id)} className="p-1 text-text-muted hover:text-pnl-loss rounded transition-colors"><Trash2 size={12} /></button>
                    }
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {createOpen  && <ClientModal onClose={() => setCreateOpen(false)} />}
      {editClient  && <ClientModal client={editClient} onClose={() => setEditClient(null)} />}
      {viewClient  && <ClientDetailModal client={viewClient} onClose={() => setViewClient(null)} />}
    </div>
  )
}

// ─── Project Modal (create / edit) ────────────────────────────────────────

function ProjectModal({ project, clients, onClose }: { project?: any; clients: any[]; onClose: () => void }) {
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()
  const { register, handleSubmit } = useForm({
    defaultValues: project
      ? { name: project.name, clientId: String(project.clientId || ''), status: project.status, description: project.description || '', link: project.link || '', startDate: project.startDate || '', dueDate: project.dueDate || '', value: project.value ?? '' }
      : { name: '', clientId: '', status: 'active', description: '', link: '', startDate: '', dueDate: '', value: '' },
  })

  const onSubmit = async (data: any) => {
    const payload = { ...data, value: data.value ? parseFloat(data.value) : null, clientId: data.clientId ? parseInt(data.clientId) : null }
    if (project) await updateProject.mutateAsync({ id: project.id, ...payload })
    else         await createProject.mutateAsync(payload)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={project ? 'Edit Project' : 'New Project'}>
      <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-3">
        <Input label="Project Name" {...register('name', { required: true })} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Client" placeholder="Select..." options={clients.map((c: any) => ({ value: String(c.id), label: c.name }))} {...register('clientId')} />
          <Select label="Status" options={['active','completed','paused','cancelled'].map(v => ({ value: v, label: v }))} {...register('status')} />
        </div>
        <Input label="Description" placeholder="Brief project description..." {...register('description')} />
        <Input label="Project Link / URL" placeholder="https://..." {...register('link')} />
        <div className="grid grid-cols-3 gap-3">
          <Input label="Start Date" type="date" {...register('startDate')} />
          <Input label="Due Date"   type="date" {...register('dueDate')} />
          <Input label="Value (£)"  type="number" step="any" {...register('value')} />
        </div>
        <div className="flex justify-end gap-3 pt-2 border-t border-bg-border">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">{project ? 'Save Changes' : 'Create'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Project Detail (Tasks + Time) ────────────────────────────────────────

function ProjectDetailModal({ project, onClose, initialTab = 'tasks' }: any) {
  const { fmtView } = useFmtView('GBP', 'business')
  const [pTab, setPTab] = useState<'tasks' | 'time'>(initialTab)

  // Tasks
  const { data: tasks = [] }  = useProjectTasks(project.id)
  const createTask = useCreateTask(project.id)
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const [addingTask, setAddingTask] = useState(false)
  const { register: regTask, handleSubmit: submitTask, reset: resetTask } = useForm({ defaultValues: { title: '', dueDate: '' } })
  const onAddTask = async (data: any) => { await createTask.mutateAsync(data); setAddingTask(false); resetTask() }

  // Time
  const { data: timeEntries = [] } = useTimeEntries(project.id)
  const createTime = useCreateTimeEntry(project.id)
  const deleteTime = useDeleteTimeEntry()
  const [addingTime, setAddingTime] = useState(false)
  const { register: regTime, handleSubmit: submitTime, reset: resetTime } = useForm({
    defaultValues: { date: today(), hours: '', minutes: '', description: '', billable: '1' },
  })
  const onAddTime = async (data: any) => {
    const h = Math.max(parseInt(data.hours  || '0', 10) || 0, 0)
    const m = Math.max(parseInt(data.minutes || '0', 10) || 0, 0)
    const totalHours = h + m / 60
    if (totalHours <= 0) return
    await createTime.mutateAsync({ ...data, hours: totalHours, billable: parseInt(data.billable) })
    setAddingTime(false); resetTime()
  }

  const totalHours    = timeEntries.reduce((s: number, e: any) => s + e.hours, 0)
  const billableHours = timeEntries.filter((e: any) => e.billable).reduce((s: number, e: any) => s + e.hours, 0)
  const effectiveRate = project.value && totalHours > 0 ? project.value / totalHours : null

  /** Convert decimal hours → "2h 30m", "45m", "3h" etc. */
  function fmtHours(h: number): string {
    const total = Math.round(h * 60)
    const hrs   = Math.floor(total / 60)
    const mins  = total % 60
    if (hrs === 0)  return `${mins}m`
    if (mins === 0) return `${hrs}h`
    return `${hrs}h ${mins}m`
  }

  const cols = ['todo', 'in-progress', 'done']
  const detailTabs = [
    { id: 'tasks', label: 'Tasks' },
    { id: 'time',  label: `Time${totalHours > 0 ? ` · ${fmtHours(totalHours)}` : ''}` },
  ]

  return (
    <Modal open onClose={onClose} title={project.name} size="lg">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4">
          {project.description && <p className="text-sm text-text-muted flex-1">{project.description}</p>}
          {project.link && (
            <a href={project.link} target="_blank" rel="noopener noreferrer" className="text-xs text-accent-blue flex items-center gap-1 hover:underline ml-auto">
              <ExternalLink size={12} /> Site
            </a>
          )}
        </div>

        <Tabs tabs={detailTabs} active={pTab} onChange={id => setPTab(id as 'tasks' | 'time')} />

        <div className="mt-4">
          {/* ── Tasks ── */}
          {pTab === 'tasks' && (
            <>
              <div className="flex justify-end mb-3">
                <Button size="sm" onClick={() => setAddingTask(true)}><Plus size={14} /> Add Task</Button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {cols.map(col => {
                  const st = TASK_STATUSES.find(s => s.value === col)!
                  const colTasks = tasks.filter((t: any) => t.status === col)
                  return (
                    <div key={col} className="bg-bg-secondary rounded-lg p-3">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-medium uppercase tracking-wide" style={{ color: st.color }}>{st.label}</h4>
                        <span className="text-xs text-text-muted">{colTasks.length}</span>
                      </div>
                      <div className="space-y-2">
                        {colTasks.map((t: any) => (
                          <div key={t.id} className="bg-bg-card border border-bg-border rounded p-2.5 group">
                            <div className="flex items-start justify-between gap-1">
                              <p className="text-sm text-text-primary flex-1">{t.title}</p>
                              <button onClick={() => deleteTask.mutate(t.id)} className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-pnl-loss transition-all flex-shrink-0"><Trash2 size={11} /></button>
                            </div>
                            {t.dueDate && <p className="text-xs text-text-muted mt-1 num">{formatDate(t.dueDate)}</p>}
                            <div className="flex gap-2 mt-1.5 flex-wrap">
                              {cols.filter(c => c !== col).map(c => (
                                <button key={c} onClick={() => updateTask.mutate({ id: t.id, status: c })} className="text-xs text-text-muted hover:text-accent-blue transition-colors">→ {c.replace('-', ' ')}</button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              {addingTask && (
                <form onSubmit={submitTask(onAddTask)} className="mt-3 flex gap-2">
                  <input {...regTask('title', { required: true })} placeholder="Task title..." className="flex-1 bg-bg-secondary border border-bg-border rounded px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue" />
                  <input {...regTask('dueDate')} type="date" className="bg-bg-secondary border border-bg-border rounded px-2 py-2 text-sm text-text-primary outline-none focus:border-accent-blue" />
                  <Button type="submit" size="sm">Add</Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => { setAddingTask(false); resetTask() }}>×</Button>
                </form>
              )}
            </>
          )}

          {/* ── Time ── */}
          {pTab === 'time' && (
            <>
              {totalHours > 0 && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-bg-secondary rounded-lg p-3 text-center">
                    <p className="text-[11px] text-text-muted uppercase tracking-wide mb-1">Total Time</p>
                    <p className="text-2xl num font-bold text-text-primary">{fmtHours(totalHours)}</p>
                  </div>
                  <div className="bg-bg-secondary rounded-lg p-3 text-center">
                    <p className="text-[11px] text-text-muted uppercase tracking-wide mb-1">Billable</p>
                    <p className="text-2xl num font-bold text-pnl-profit">{fmtHours(billableHours)}</p>
                  </div>
                  <div className="bg-bg-secondary rounded-lg p-3 text-center">
                    <p className="text-[11px] text-text-muted uppercase tracking-wide mb-1">Effective Rate</p>
                    <p className="text-2xl num font-bold text-accent-blue">
                      {effectiveRate ? `${fmtView(effectiveRate)}/h` : <span className="text-sm text-text-muted">no value set</span>}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-end mb-3">
                <Button size="sm" onClick={() => setAddingTime(true)}><Clock size={14} /> Log Time</Button>
              </div>

              {addingTime && (
                <form onSubmit={submitTime(onAddTime)} className="flex gap-2 mb-4 p-3 bg-bg-secondary rounded-lg flex-wrap items-center">
                  <input {...regTime('date', { required: true })} type="date"
                    className="bg-bg-card border border-bg-border rounded px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-blue" />
                  {/* Hours + minutes as separate integer fields */}
                  <div className="flex items-center gap-1">
                    <input
                      {...regTime('hours')}
                      type="number" min="0" max="23" step="1" placeholder="0"
                      className="w-12 bg-bg-card border border-bg-border rounded px-2 py-1.5 text-sm text-text-primary text-center outline-none focus:border-accent-blue"
                    />
                    <span className="text-xs text-text-muted">h</span>
                    <input
                      {...regTime('minutes')}
                      type="number" min="0" max="59" step="1" placeholder="0"
                      className="w-12 bg-bg-card border border-bg-border rounded px-2 py-1.5 text-sm text-text-primary text-center outline-none focus:border-accent-blue"
                    />
                    <span className="text-xs text-text-muted">m</span>
                  </div>
                  <input {...regTime('description')} placeholder="What did you work on?"
                    className="flex-1 min-w-40 bg-bg-card border border-bg-border rounded px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue" />
                  <select {...regTime('billable')} className="bg-bg-card border border-bg-border rounded px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-blue">
                    <option value="1">Billable</option>
                    <option value="0">Non-billable</option>
                  </select>
                  <Button type="submit" size="sm">Add</Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => { setAddingTime(false); resetTime() }}>×</Button>
                </form>
              )}

              {timeEntries.length === 0 ? (
                <p className="text-center text-sm text-text-muted py-8">No time logged yet</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-bg-border">
                      {['Date', 'Description', 'Hours', 'Type', ''].map(h => (
                        <th key={h} className="text-left text-xs text-text-muted font-medium px-2 py-2 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...timeEntries].sort((a: any, b: any) => b.date.localeCompare(a.date)).map((e: any) => (
                      <tr key={e.id} className="border-b border-bg-border/30 hover:bg-bg-hover/20 group">
                        <td className="px-2 py-2.5 text-text-secondary text-xs num">{formatDate(e.date)}</td>
                        <td className="px-2 py-2.5 text-text-primary">{e.description || <span className="text-text-muted">--</span>}</td>
                        <td className="px-2 py-2.5 num font-semibold text-text-primary">{fmtHours(e.hours)}</td>
                        <td className="px-2 py-2.5">
                          <Badge variant={e.billable ? 'green' : 'gray'}>{e.billable ? 'billable' : 'non-billable'}</Badge>
                        </td>
                        <td className="px-2 py-2.5">
                          <button onClick={() => deleteTime.mutate(e.id)} className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-pnl-loss transition-all"><Trash2 size={12} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ─── Projects Tab ──────────────────────────────────────────────────────────

function ProjectsTab() {
  const { fmtView } = useFmtView('GBP', 'business')
  const { data: projects, isPending } = useProjects()
  const { data: clients  = [] }       = useClients()
  const { data: allTime  = [] }       = useAllTimeEntries()
  const { data: invoices = [] }       = useInvoices()
  const deleteProject = useDeleteProject()

  // Paid totals per project from invoices assigned to a project
  const collectedByProject = (invoices as any[])
    .filter(i => i.status === 'paid' && i.projectId)
    .reduce((acc: Record<number, number>, i) => {
      acc[i.projectId] = (acc[i.projectId] || 0) + i.amount
      return acc
    }, {})
  const [editProject,   setEditProject]   = useState<any>(null)
  const [viewProject,   setViewProject]   = useState<any>(null)
  const [viewProjectTab, setViewProjectTab] = useState<'tasks' | 'time'>('tasks')
  const [createOpen,    setCreateOpen]    = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const openProject = (p: any, tab: 'tasks' | 'time' = 'tasks') => { setViewProject(p); setViewProjectTab(tab) }

  if (isPending) return <PageLoader />

  return (
    <div>
      <div className="flex justify-end mb-4"><Button size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} /> New Project</Button></div>
      {!projects?.length
        ? <EmptyState title="No projects" action={<Button onClick={() => setCreateOpen(true)}><Plus size={14} /> Add Project</Button>} />
        : (
          <div className="grid grid-cols-3 gap-3">
            {projects.map((p: any) => {
              const client        = clients.find((c: any) => c.id === p.clientId)
              const projectTime   = allTime.filter((e: any) => e.projectId === p.id)
              const totalHours    = projectTime.reduce((s: number, e: any) => s + e.hours, 0)
              const effectiveRate = p.value && totalHours > 0 ? p.value / totalHours : null
              const rateColor     = !effectiveRate ? '' : effectiveRate >= 75 ? 'text-pnl-profit' : effectiveRate >= 35 ? 'text-amber-400' : 'text-pnl-loss'
              const collected     = collectedByProject[p.id] ?? 0
              const pct           = p.value && collected > 0 ? Math.min((collected / p.value) * 100, 100) : 0
              return (
                <div key={p.id} className="bg-bg-card border border-bg-border rounded-xl p-4 hover:border-accent-blue/20 transition-colors flex flex-col">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-text-primary truncate flex-1">{p.name}</h3>
                    <Badge variant={p.status === 'active' ? 'blue' : p.status === 'completed' ? 'green' : 'gray'} className="ml-2 flex-shrink-0">{p.status}</Badge>
                  </div>
                  {client        && <p className="text-xs text-text-muted mb-1">{client.name}</p>}
                  {p.description && <p className="text-xs text-text-secondary mb-2 line-clamp-2">{p.description}</p>}

                  {/* Value / collected progress */}
                  {(p.value || collected > 0) && (
                    <div className="mb-2">
                      <div className="flex items-baseline justify-between text-xs mb-1">
                        {collected > 0 ? (
                          <>
                            <span className="num font-semibold text-pnl-profit">{fmtView(collected)}</span>
                            {p.value && <span className="num text-text-muted">/ {fmtView(p.value)}</span>}
                          </>
                        ) : (
                          <>
                            <span className="num text-text-muted">£0 collected</span>
                            <span className="num text-pnl-profit font-semibold">{fmtView(p.value)}</span>
                          </>
                        )}
                      </div>
                      {p.value && (
                        <div className="h-1 rounded-full overflow-hidden bg-bg-border">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${pct}%`,
                              background: pct >= 100 ? '#34d399' : pct >= 50 ? '#818cf8' : '#f59e0b',
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs mb-1">
                    {p.dueDate && <span className="text-text-muted num">Due {formatDate(p.dueDate)}</span>}
                  </div>
                  {totalHours > 0 && (
                    <div className="flex items-center gap-1.5 text-xs mb-2">
                      <Clock size={11} className="text-text-muted" />
                      <span className="num text-text-muted">{totalHours.toFixed(1)}h logged</span>
                      {effectiveRate && <span className={`num font-semibold ${rateColor}`}>· {fmtView(effectiveRate)}/h</span>}
                    </div>
                  )}
                  {p.link && (
                    <a href={p.link} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-xs text-accent-blue flex items-center gap-1 hover:underline mb-2 w-fit">
                      <ExternalLink size={10} />{p.link.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                  <div className="flex items-center justify-between border-t border-bg-border pt-2.5 mt-auto">
                    <button onClick={() => openProject(p)} className="text-xs text-text-muted hover:text-accent-blue transition-colors">View tasks →</button>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openProject(p, 'time')} title="Log time" className="p-1 text-text-muted hover:text-accent-blue rounded transition-colors"><Clock size={12} /></button>
                      <button onClick={() => setEditProject(p)} className="p-1 text-text-muted hover:text-text-primary rounded transition-colors"><Pencil size={12} /></button>
                      {confirmDelete === p.id
                        ? <ConfirmDelete id={p.id} onConfirm={() => { deleteProject.mutate(p.id); setConfirmDelete(null) }} onCancel={() => setConfirmDelete(null)} />
                        : <button onClick={() => setConfirmDelete(p.id)} className="p-1 text-text-muted hover:text-pnl-loss rounded transition-colors"><Trash2 size={12} /></button>
                      }
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      }
      {createOpen  && <ProjectModal clients={clients} onClose={() => setCreateOpen(false)} />}
      {editProject && <ProjectModal project={editProject} clients={clients} onClose={() => setEditProject(null)} />}
      {viewProject && <ProjectDetailModal project={viewProject} initialTab={viewProjectTab} onClose={() => setViewProject(null)} />}
    </div>
  )
}

// ─── Invoice Modal (create / edit) ────────────────────────────────────────

function InvoiceModal({ invoice, clients, nextNumber = 'INV-001', onClose }: { invoice?: any; clients: any[]; nextNumber?: string; onClose: () => void }) {
  const createInvoice = useCreateInvoice()
  const updateInvoice = useUpdateInvoice()
  const { data: projects = [] } = useProjects()
  const isChild = !!(invoice?.recurringParentId)  // auto-generated child — can't edit recurrence
  const { register, handleSubmit, watch } = useForm({
    defaultValues: invoice
      ? { invoiceNumber: invoice.invoiceNumber, clientId: String(invoice.clientId), projectId: invoice.projectId ? String(invoice.projectId) : '', amount: invoice.amount, status: invoice.status, issueDate: invoice.issueDate, dueDate: invoice.dueDate, paidDate: invoice.paidDate || '', notes: invoice.notes || '', isRecurring: invoice.isRecurring ? '1' : '0', frequency: invoice.frequency || 'monthly' }
      : { invoiceNumber: nextNumber, clientId: '', projectId: '', amount: '', status: 'unpaid', issueDate: today(), dueDate: '', paidDate: '', notes: '', isRecurring: '0', frequency: 'monthly' },
  })
  const isRecurring     = watch('isRecurring') === '1'
  const watchedClientId = watch('clientId')
  const clientProjects  = watchedClientId
    ? projects.filter((p: any) => p.clientId === parseInt(watchedClientId))
    : []

  const onSubmit = async (data: any) => {
    const payload = {
      ...data,
      amount:      parseFloat(data.amount),
      clientId:    parseInt(data.clientId),
      projectId:   data.projectId ? parseInt(data.projectId) : null,
      paidDate:    data.paidDate || null,
      isRecurring: data.isRecurring === '1' ? 1 : 0,
      frequency:   data.isRecurring === '1' ? data.frequency : null,
    }
    if (invoice) await updateInvoice.mutateAsync({ id: invoice.id, ...payload })
    else         await createInvoice.mutateAsync(payload)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={invoice ? 'Edit Invoice' : 'New Invoice'}>
      <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Invoice #" placeholder="INV-001" {...register('invoiceNumber', { required: true })} />
          <Select label="Client" placeholder="Select..." options={clients.map((c: any) => ({ value: String(c.id), label: c.name }))} {...register('clientId', { required: true })} />
        </div>
        {/* Project — optional, filtered to the selected client */}
        {clientProjects.length > 0 && (
          <Select
            label="Project (optional)"
            placeholder="No project"
            options={clientProjects.map((p: any) => ({ value: String(p.id), label: p.name }))}
            {...register('projectId')}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Amount (£)" type="number" step="any" {...register('amount', { required: true })} />
          <Select label="Status" options={INVOICE_STATUSES.map(s => ({ value: s.value, label: s.label }))} {...register('status')} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Input label="Issue Date" type="date" {...register('issueDate')} />
          <Input label="Due Date"   type="date" {...register('dueDate', { required: true })} />
          <Input label="Paid Date"  type="date" {...register('paidDate')} />
        </div>

        {/* Recurring — only editable on templates (not auto-generated children) */}
        {!isChild && (
          <div className="flex items-center gap-3">
            <Select
              label="Recurring?"
              options={[{ value: '0', label: 'One-time' }, { value: '1', label: 'Recurring' }]}
              {...register('isRecurring')}
            />
            {isRecurring && (
              <Select
                label="Frequency"
                options={['monthly', 'quarterly', 'yearly'].map(v => ({ value: v, label: v }))}
                {...register('frequency')}
              />
            )}
          </div>
        )}
        {isRecurring && !isChild && (
          <p className="text-[11px] text-text-muted flex items-center gap-1.5">
            <Repeat size={11} className="text-accent-blue" />
            New invoices will be auto-generated on schedule with auto-incremented numbers.
          </p>
        )}

        <Textarea label="Notes" rows={2} {...register('notes')} />
        <div className="flex justify-end gap-3 pt-2 border-t border-bg-border">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">{invoice ? 'Save Changes' : 'Create'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Invoices Tab ──────────────────────────────────────────────────────────

function InvoicesTab() {
  const { fmtView } = useFmtView('GBP', 'business')
  const { data: invoices, isPending } = useInvoices()
  const { data: clients = [] }        = useClients()
  const updateInvoice  = useUpdateInvoice()
  const deleteInvoice  = useDeleteInvoice()
  const [editInvoice,    setEditInvoice]    = useState<any>(null)
  const [createOpen,     setCreateOpen]     = useState(false)
  const [confirmDelete,  setConfirmDelete]  = useState<number | null>(null)
  // groups start collapsed — user expands to see individual payment rows
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set())
  // groups showing total earned instead of per-period amount
  const [totalGroups, setTotalGroups] = useState<Set<number>>(new Set())
  const toggleTotal = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setTotalGroups(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  if (isPending) return <PageLoader />

  const allInvoices = invoices || []

  // Partition: recurring templates / auto-generated children / one-time invoices
  const templates   = allInvoices.filter((i: any) =>  i.isRecurring && !i.recurringParentId)
  const childrenAll = allInvoices.filter((i: any) =>  i.isRecurring &&  i.recurringParentId)
  const standalones = allInvoices.filter((i: any) => !i.isRecurring)

  // Build one group per template (template + all its auto-generated occurrences)
  const groups = templates.map((t: any) => ({
    template:    t,
    occurrences: [t, ...childrenAll.filter((c: any) => c.recurringParentId === t.id)]
      .sort((a: any, b: any) => a.issueDate.localeCompare(b.issueDate)),
  }))

  const totalOwed = allInvoices.filter((i: any) => ['unpaid','overdue'].includes(i.status)).reduce((s: number, i: any) => s + i.amount, 0)
  const totalPaid = allInvoices.filter((i: any) => i.status === 'paid').reduce((s: number, i: any) => s + i.amount, 0)

  // Compute next sequential invoice number from all existing invoices
  const nextInvoiceNumber = (() => {
    if (!allInvoices.length) return 'INV-001'
    let maxNum = 0, prefix = 'INV-', padWidth = 3
    for (const inv of allInvoices) {
      const m = (inv as any).invoiceNumber.match(/^(.*?)(\d+)$/)
      if (m) {
        const num = parseInt(m[2], 10)
        if (num > maxNum) { maxNum = num; prefix = m[1]; padWidth = Math.max(m[2].length, 3) }
      }
    }
    return `${prefix}${String(maxNum + 1).padStart(padWidth, '0')}`
  })()

  const markPaid    = (i: any) => updateInvoice.mutate({ id: i.id, status: 'paid', paidDate: today() })
  const toggleGroup = (id: number) => setExpandedGroups(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s
  })

  // Shared row renderer — used for standalones and for expanded occurrences
  const invoiceRow = (i: any, indent = false) => {
    const client  = clients.find((c: any) => c.id === i.clientId)
    const st      = INVOICE_STATUSES.find(s => s.value === i.status)!
    const canPay  = i.status === 'unpaid' || i.status === 'overdue'
    return (
      <tr key={i.id}
        className="border-b border-bg-border/30 hover:bg-bg-hover/20 group"
        style={indent ? { borderLeft: '2px solid rgba(129,140,248,0.15)' } : undefined}
      >
        <td className={`${indent ? 'pl-5' : 'px-3'} pr-3 py-2 text-text-muted text-xs num`}>{i.invoiceNumber}</td>
        <td className="px-3 py-2 text-text-primary">{client?.name || '--'}</td>
        <td className="px-3 py-2 num font-medium text-text-primary">{fmtView(i.amount)}</td>
        <td className="px-3 py-2">
          <Badge variant={i.status === 'paid' ? 'green' : i.status === 'overdue' ? 'red' : i.status === 'unpaid' ? 'yellow' : 'gray'}>
            {st.label}
          </Badge>
        </td>
        <td className="px-3 py-2 text-text-secondary text-xs num">{formatDate(i.issueDate)}</td>
        <td className="px-3 py-2 text-text-secondary text-xs num">{formatDate(i.dueDate)}</td>
        <td className="px-3 py-2 text-text-secondary text-xs num">{i.paidDate ? formatDate(i.paidDate) : '--'}</td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {canPay && (
              <button onClick={() => markPaid(i)} title="Mark as paid"
                className="p-1 text-text-muted hover:text-pnl-profit rounded transition-colors">
                <Check size={13} />
              </button>
            )}
            <button onClick={() => setEditInvoice(i)}
              className="p-1 text-text-muted hover:text-text-primary rounded transition-colors">
              <Pencil size={12} />
            </button>
            {confirmDelete === i.id
              ? <ConfirmDelete id={i.id}
                  onConfirm={() => { deleteInvoice.mutate(i.id); setConfirmDelete(null) }}
                  onCancel={() => setConfirmDelete(null)} />
              : <button onClick={() => setConfirmDelete(i.id)}
                  className="p-1 text-text-muted hover:text-pnl-loss rounded transition-colors">
                  <Trash2 size={12} />
                </button>
            }
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Paid"     value={fmtView(totalPaid)} valueColor="text-pnl-profit" iconBg="from-emerald-500/20 to-teal-500/20" iconColor="text-pnl-profit" />
        <StatCard label="Outstanding"    value={fmtView(totalOwed)} valueColor="text-amber-400"  iconBg="from-amber-500/20 to-orange-500/20"  iconColor="text-amber-400" />
        <StatCard label="Total Invoices" value={allInvoices.length} />
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} /> New Invoice</Button>
      </div>

      {!allInvoices.length ? (
        <EmptyState title="No invoices" action={<Button onClick={() => setCreateOpen(true)}><Plus size={14} /> Create Invoice</Button>} />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bg-border">
              {['#', 'Client', 'Amount', 'Status', 'Issue', 'Due', 'Paid', ''].map(h => (
                <th key={h} className="text-left text-xs text-text-muted font-medium px-3 py-2 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>

            {/* ── Recurring retainer groups ─────────────────────────────── */}
            {groups.map(({ template, occurrences }) => {
              const isExpanded = expandedGroups.has(template.id)
              const client     = clients.find((c: any) => c.id === template.clientId)
              const paidOccs   = occurrences.filter((i: any) => i.status === 'paid')
              const unpaidOccs = occurrences.filter((i: any) => ['unpaid', 'overdue'].includes(i.status))
              const nextUnpaid = unpaidOccs[0]
              const firstNum   = occurrences[0]?.invoiceNumber
              const lastNum    = occurrences[occurrences.length - 1]?.invoiceNumber
              const paidTotal    = paidOccs.reduce((s: number, i: any) => s + i.amount, 0)
              const owedTotal    = unpaidOccs.reduce((s: number, i: any) => s + i.amount, 0)
              const lastPaidDate = paidOccs.length > 0
                ? paidOccs.map((i: any) => i.paidDate).filter(Boolean).sort().at(-1)
                : null

              return (
                <Fragment key={`grp-${template.id}`}>

                  {/* ── Group summary row — column-aligned, same widths as regular rows ── */}
                  <tr
                    className="cursor-pointer transition-colors group/grp"
                    style={{
                      background:   'rgba(129,140,248,0.05)',
                      borderBottom: isExpanded
                        ? '1px solid rgba(129,140,248,0.08)'
                        : '1px solid var(--c-border)',
                      borderLeft:   '2px solid rgba(129,140,248,0.35)',
                    }}
                    onClick={() => toggleGroup(template.id)}
                  >
                    {/* # — chevron + invoice range */}
                    <td className="pl-2 pr-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-text-muted flex-shrink-0">
                          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </span>
                        <span className="text-[11px] text-text-muted num whitespace-nowrap">
                          {firstNum}{occurrences.length > 1 ? `–${lastNum}` : ''}
                        </span>
                      </div>
                    </td>

                    {/* CLIENT — name + frequency tag */}
                    <td className="px-3 py-3">
                      <p className="font-medium text-text-primary text-sm">{client?.name || '--'}</p>
                      <p className="flex items-center gap-1 mt-0.5 text-[11px]" style={{ color: '#818cf8' }}>
                        <Repeat size={9} />{template.frequency} retainer · {occurrences.length} invoice{occurrences.length !== 1 ? 's' : ''}
                      </p>
                    </td>

                    {/* AMOUNT — toggle between per-period and total earned */}
                    <td className="px-3 py-3">
                      {totalGroups.has(template.id) ? (
                        <button
                          onClick={(e) => toggleTotal(template.id, e)}
                          title="Show per-period amount"
                          className="text-left"
                        >
                          <p className="num font-semibold text-pnl-profit">{fmtView(paidTotal)}</p>
                          <p className="text-[11px] text-pnl-profit/60 mt-0.5">total earned</p>
                        </button>
                      ) : (
                        <button
                          onClick={(e) => toggleTotal(template.id, e)}
                          title="Show total earned"
                          className="text-left"
                        >
                          <p className="num font-semibold text-text-primary">{fmtView(template.amount)}</p>
                          <p className="text-[11px] text-text-muted mt-0.5">per {template.frequency?.replace('ly','')}</p>
                        </button>
                      )}
                    </td>

                    {/* STATUS — paid / outstanding counts */}
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-0.5">
                        {paidOccs.length > 0 && (
                          <span className="text-[11px] num text-pnl-profit leading-tight">
                            {paidOccs.length} paid
                          </span>
                        )}
                        {unpaidOccs.length > 0 && (
                          <span className="text-[11px] num text-amber-400 leading-tight">
                            {unpaidOccs.length} outstanding
                          </span>
                        )}
                      </div>
                    </td>

                    {/* ISSUE — series start date */}
                    <td className="px-3 py-3 text-text-secondary text-xs num">
                      {formatDate(occurrences[0].issueDate)}
                    </td>

                    {/* DUE — next unpaid due date */}
                    <td className="px-3 py-3 text-xs num">
                      {nextUnpaid
                        ? <span className="text-amber-400">{formatDate(nextUnpaid.dueDate)}</span>
                        : <span className="text-text-muted">--</span>
                      }
                    </td>

                    {/* PAID — most recent payment date */}
                    <td className="px-3 py-3 text-text-secondary text-xs num">
                      {lastPaidDate
                        ? formatDate(lastPaidDate)
                        : <span className="text-text-muted">--</span>
                      }
                    </td>

                    {/* ACTIONS */}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover/grp:opacity-100 transition-opacity">
                        <button
                          title="Edit retainer template"
                          onClick={e => { e.stopPropagation(); setEditInvoice(template) }}
                          className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* ── Expanded individual payment rows ── */}
                  {isExpanded && occurrences.map((i: any) => invoiceRow(i, true))}

                </Fragment>
              )
            })}

            {/* ── One-time / standalone invoices ───────────────────────── */}
            {standalones.map((i: any) => invoiceRow(i))}

          </tbody>
        </table>
      )}

      {createOpen  && <InvoiceModal clients={clients} nextNumber={nextInvoiceNumber} onClose={() => setCreateOpen(false)} />}
      {editInvoice && <InvoiceModal invoice={editInvoice} clients={clients} onClose={() => setEditInvoice(null)} />}
    </div>
  )
}

// ─── Pipeline Tab ─────────────────────────────────────────────────────────

// ─── Note Modal (create / edit) ───────────────────────────────────────────

function NoteModal({ note, clients, onClose }: { note?: any; clients: any[]; onClose: () => void }) {
  const createNote = useCreateMeetingNote()
  const updateNote = useUpdateMeetingNote()
  const { data: projects = [] } = useProjects()
  const { register, handleSubmit, watch } = useForm({
    defaultValues: note
      ? { title: note.title, content: note.content || '', meetingDate: note.meetingDate, clientId: String(note.clientId || ''), projectId: String(note.projectId || '') }
      : { title: '', content: '', meetingDate: today(), clientId: '', projectId: '' },
  })
  const watchedClientId = watch('clientId')
  const clientProjects  = watchedClientId
    ? projects.filter((p: any) => p.clientId === parseInt(watchedClientId))
    : projects

  const onSubmit = async (data: any) => {
    const payload = { ...data, clientId: data.clientId ? parseInt(data.clientId) : null, projectId: data.projectId ? parseInt(data.projectId) : null }
    if (note) await updateNote.mutateAsync({ id: note.id, ...payload })
    else      await createNote.mutateAsync(payload)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={note ? 'Edit Note' : 'Meeting Note'}>
      <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-3">
        <Input label="Title" placeholder="Call with client, Kickoff meeting..." {...register('title', { required: true })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" {...register('meetingDate')} />
          <Select label="Client" placeholder="None" options={clients.map((c: any) => ({ value: String(c.id), label: c.name }))} {...register('clientId')} />
        </div>
        {clientProjects.length > 0 && (
          <Select label="Project (optional)" placeholder="None" options={clientProjects.map((p: any) => ({ value: String(p.id), label: p.name }))} {...register('projectId')} />
        )}
        <Textarea label="Notes" rows={6} placeholder="What was discussed, decisions made, action items..." {...register('content')} />
        <div className="flex justify-end gap-3 pt-2 border-t border-bg-border">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Notes Tab ─────────────────────────────────────────────────────────────

function NotesTab() {
  const { data: notes, isPending } = useMeetingNotes()
  const { data: clients  = [] }    = useClients()
  const { data: projects = [] }    = useProjects()
  const deleteNote = useDeleteMeetingNote()
  const [editNote,      setEditNote]      = useState<any>(null)
  const [createOpen,    setCreateOpen]    = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [search,        setSearch]        = useState('')
  const [filterClient,  setFilterClient]  = useState('')
  const [expanded,      setExpanded]      = useState<Set<number>>(new Set())

  if (isPending) return <PageLoader />

  const filtered = (notes || []).filter((n: any) => {
    if (filterClient && n.clientId !== parseInt(filterClient)) return false
    if (search) {
      const q = search.toLowerCase()
      if (!n.title.toLowerCase().includes(q) && !(n.content || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const toggle = (id: number) => setExpanded(prev => {
    const s = new Set(prev)
    s.has(id) ? s.delete(id) : s.add(id)
    return s
  })

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search notes..."
            className="w-full bg-bg-card border border-bg-border rounded-lg pl-8 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue transition-colors"
          />
        </div>
        <select
          value={filterClient}
          onChange={e => setFilterClient(e.target.value)}
          className="bg-bg-card border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue transition-colors"
        >
          <option value="">All Clients</option>
          {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} /> New Note</Button>
      </div>

      {!filtered.length ? (
        <EmptyState
          title={search || filterClient ? 'No matching notes' : 'No meeting notes'}
          action={!search && !filterClient ? <Button onClick={() => setCreateOpen(true)}><Plus size={14} /> Add Note</Button> : undefined}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((n: any) => {
            const client  = clients.find((c: any) => c.id === n.clientId)
            const project = projects.find((p: any) => p.id === n.projectId)
            const isExp   = expanded.has(n.id)
            const long    = (n.content || '').length > 220
            return (
              <div key={n.id} className="bg-bg-card border border-bg-border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="font-semibold text-text-primary">{n.title}</h3>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-text-muted num">{formatDate(n.meetingDate)}</span>
                    <button onClick={() => setEditNote(n)} className="p-1 text-text-muted hover:text-text-primary rounded transition-colors"><Pencil size={12} /></button>
                    {confirmDelete === n.id
                      ? <ConfirmDelete id={n.id} onConfirm={() => { deleteNote.mutate(n.id); setConfirmDelete(null) }} onCancel={() => setConfirmDelete(null)} />
                      : <button onClick={() => setConfirmDelete(n.id)} className="p-1 text-text-muted hover:text-pnl-loss rounded transition-colors"><Trash2 size={12} /></button>
                    }
                  </div>
                </div>
                {(client || project) && (
                  <div className="flex items-center gap-2 mb-2">
                    {client  && <Badge variant="blue">{client.name}</Badge>}
                    {project && <Badge variant="gray">{project.name}</Badge>}
                  </div>
                )}
                {n.content && (
                  <>
                    <p className={`text-sm text-text-secondary whitespace-pre-line ${!isExp && long ? 'line-clamp-3' : ''}`}>{n.content}</p>
                    {long && (
                      <button onClick={() => toggle(n.id)} className="mt-1.5 flex items-center gap-1 text-xs text-text-muted hover:text-accent-blue transition-colors">
                        {isExp ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show more</>}
                      </button>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
      {createOpen && <NoteModal clients={clients} onClose={() => setCreateOpen(false)} />}
      {editNote   && <NoteModal note={editNote} clients={clients} onClose={() => setEditNote(null)} />}
    </div>
  )
}

// ─── Expense Entry Modal ───────────────────────────────────────────────────

function ExpenseEntryModal({ entry, onClose }: { entry?: any; onClose: () => void }) {
  const createExpense = useCreateExpense()
  const updateExpense = useUpdateExpense()
  const { register, handleSubmit, watch } = useForm({
    defaultValues: entry
      ? { description: entry.description, amount: entry.amount, date: entry.date, category: 'Business', isRecurring: entry.isRecurring ? '1' : '0', frequency: entry.frequency || 'monthly', notes: entry.notes || '' }
      : { description: '', amount: '', date: today(), category: 'Business', isRecurring: '0', frequency: 'monthly', notes: '' },
  })
  const isRecurring = watch('isRecurring') === '1'
  const onSubmit = async (data: any) => {
    const payload = { ...data, amount: parseFloat(data.amount), isRecurring: data.isRecurring === '1' ? 1 : 0, frequency: data.isRecurring === '1' ? data.frequency : null }
    if (entry) await updateExpense.mutateAsync({ id: entry.id, ...payload })
    else        await createExpense.mutateAsync(payload)
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={entry ? 'Edit Expense' : 'Add Expense'}>
      <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-3">
        <Input label="Description" placeholder="Software subscription, contractor, hosting..." {...register('description', { required: true })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Amount (£)" type="number" step="any" {...register('amount', { required: true })} />
          <Input label="Date" type="date" {...register('date', { required: true })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Recurring?"
            options={[{ value: '0', label: 'One-time' }, { value: '1', label: 'Recurring' }]}
            {...register('isRecurring')}
          />
          {isRecurring && (
            <Select label="Frequency"
              options={['monthly','weekly','quarterly','yearly'].map(v => ({ value: v, label: v }))}
              {...register('frequency')}
            />
          )}
        </div>
        <Textarea label="Notes" rows={2} {...register('notes')} />
        <div className="flex justify-end gap-3 pt-2 border-t border-bg-border">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">{entry ? 'Save Changes' : 'Add Expense'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Revenue Tab ───────────────────────────────────────────────────────────

function RevenueTab() {
  const { fmtView } = useFmtView('GBP', 'business')
  const { data: expenses   = [] } = useFinanceExpenses({ category: 'Business' })
  const { data: invoices   = [] } = useInvoices()
  const { data: clients    = [] } = useClients()
  const { data: campaigns  = [] } = useCampaigns()
  const deleteExpense = useDeleteExpense()

  const [expenseOpen,   setExpenseOpen]   = useState(false)
  const [editExpense,   setEditExpense]   = useState<any>(null)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const paidInvoices       = [...invoices]
    .filter((i: any) => i.status === 'paid')
    .sort((a: any, b: any) => (b.paidDate || b.issueDate).localeCompare(a.paidDate || a.issueDate))

  const totalRevenue       = paidInvoices.reduce((s: number, i: any) => s + i.amount, 0)
  const totalExpenses      = expenses.reduce((s: number, e: any) => s + e.amount, 0)
  const businessAdSpend    = (campaigns as any[])
    .filter(c => c.fundingSource === 'business')
    .reduce((s: number, c: any) => s + (c.spent ?? 0), 0)
  const totalCosts         = totalExpenses + businessAdSpend
  const netProfit          = totalRevenue - totalCosts
  const margin             = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

  const businessCampaigns  = (campaigns as any[]).filter(c => c.fundingSource === 'business' && c.spent > 0)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Revenue"      value={fmtView(totalRevenue)}  valueColor="text-pnl-profit" iconBg="from-emerald-500/20 to-teal-500/20"  iconColor="text-pnl-profit" />
        <StatCard label="Expenses"     value={fmtView(totalExpenses)} valueColor="text-pnl-loss"   iconBg="from-red-500/20 to-rose-500/20"      iconColor="text-pnl-loss" />
        <StatCard label="Ad Spend"     value={fmtView(businessAdSpend)} valueColor="text-pnl-loss" iconBg="from-fuchsia-500/20 to-purple-500/20" iconColor="text-pnl-loss"
          sub={businessAdSpend > 0 ? 'business-funded campaigns' : 'no business-funded spend'} />
        <StatCard label="Net Profit"   value={fmtView(netProfit)}     valueColor={netProfit >= 0 ? 'text-pnl-profit' : 'text-pnl-loss'} iconBg={netProfit >= 0 ? 'from-emerald-500/20 to-teal-500/20' : 'from-red-500/20 to-rose-500/20'} iconColor={netProfit >= 0 ? 'text-pnl-profit' : 'text-pnl-loss'}
          badge={{ text: `${margin.toFixed(1)}% margin`, color: margin >= 50 ? '#34d399' : margin > 0 ? '#fbbf24' : '#f87171' }} />
      </div>

      {/* Revenue — paid invoices */}
      <div className="bg-bg-card border border-bg-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
          <div className="flex items-center gap-2">
            <TrendingUp size={15} className="text-pnl-profit" />
            <h3 className="text-sm font-semibold text-text-primary">Revenue</h3>
            <span className="text-xs text-text-muted">paid invoices · manage from the Invoices tab</span>
          </div>
          <span className="text-xs num font-semibold text-pnl-profit">{paidInvoices.length} paid</span>
        </div>
        {paidInvoices.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">No paid invoices yet. Mark invoices as paid from the Invoices tab.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bg-border/50">
                {['Invoice', 'Client', 'Paid', 'Amount'].map(h => (
                  <th key={h} className="text-left text-xs text-text-muted font-medium px-4 py-2 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paidInvoices.map((i: any) => {
                const client = clients.find((c: any) => c.id === i.clientId)
                return (
                  <tr key={i.id} className="border-b border-bg-border/30 hover:bg-bg-hover/20">
                    <td className="px-4 py-2.5 num text-text-secondary text-xs">{i.invoiceNumber}</td>
                    <td className="px-4 py-2.5 text-text-primary">{client?.name || '--'}</td>
                    <td className="px-4 py-2.5 text-text-secondary text-xs num">{formatDate(i.paidDate || i.issueDate)}</td>
                    <td className="px-4 py-2.5 num font-semibold text-pnl-profit">{fmtView(i.amount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Ad Spend (business-funded campaigns) */}
      {businessCampaigns.length > 0 && (
        <div className="bg-bg-card border border-bg-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
            <div className="flex items-center gap-2">
              <Megaphone size={15} className="text-pnl-loss" />
              <h3 className="text-sm font-semibold text-text-primary">Ad Spend</h3>
              <span className="text-xs text-text-muted">business-funded campaigns · manage from the Marketing tab</span>
            </div>
            <span className="text-xs num font-semibold text-pnl-loss">{fmtView(businessAdSpend)}</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bg-border/50">
                {['Campaign', 'Platform', 'Objective', 'Budget', 'Spent', 'Status'].map(h => (
                  <th key={h} className="text-left text-xs text-text-muted font-medium px-4 py-2 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {businessCampaigns.map((c: any) => {
                const pm = platformMeta(c.platform)
                const pct = c.budget > 0 ? Math.min((c.spent / c.budget) * 100, 100) : 0
                const over = c.spent > c.budget
                const barColor = over ? '#f87171' : pct >= 80 ? '#fbbf24' : '#34d399'
                const statusColor = c.status === 'active' ? '#34d399' : c.status === 'paused' ? '#fbbf24' : '#8b8baa'
                return (
                  <tr key={c.id} className="border-b border-bg-border/30 hover:bg-bg-hover/20">
                    <td className="px-4 py-2.5 font-medium text-text-primary">{c.name}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold"
                        style={{ background: pm.color + '1a', color: pm.color, border: `1px solid ${pm.color}30` }}>
                        {pm.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs capitalize text-text-secondary">{c.objective || '--'}</td>
                    <td className="px-4 py-2.5 num text-text-secondary text-xs">{fmtView(c.budget)}</td>
                    <td className="px-4 py-2.5 min-w-[120px]">
                      <div className="flex items-baseline gap-1 mb-1">
                        <span className="num font-semibold text-pnl-loss text-xs">{fmtView(c.spent)}</span>
                        {over && <span className="text-[10px] text-pnl-loss">over</span>}
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--c-bg-input)' }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold capitalize" style={{ color: statusColor }}>
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusColor }} />
                        {c.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Expenses */}
      <div className="bg-bg-card border border-bg-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
          <div className="flex items-center gap-2">
            <TrendingUp size={15} className="text-pnl-loss rotate-180" />
            <h3 className="text-sm font-semibold text-text-primary">Expenses</h3>
            <span className="text-xs text-text-muted">subscriptions, tools, purchases</span>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setExpenseOpen(true)}><Plus size={14} /> Add Expense</Button>
        </div>
        {expenses.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">No expenses yet. Add subscriptions, software, contractor payments…</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bg-border/50">
                {['Description', 'Date', 'Amount', 'Type', ''].map(h => (
                  <th key={h} className="text-left text-xs text-text-muted font-medium px-4 py-2 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...expenses].sort((a: any, b: any) => b.date.localeCompare(a.date)).map((e: any) => (
                <tr key={e.id} className="border-b border-bg-border/30 hover:bg-bg-hover/30 group">
                  <td className="px-4 py-2.5 text-text-primary">{e.description}</td>
                  <td className="px-4 py-2.5 text-text-secondary text-xs num">{formatDate(e.date)}</td>
                  <td className="px-4 py-2.5 num font-medium text-pnl-loss">{fmtView(e.amount)}</td>
                  <td className="px-4 py-2.5">
                    {!!e.isRecurring
                      ? <Badge variant="blue">{e.frequency || 'recurring'}</Badge>
                      : <span className="text-xs text-text-muted">one-time</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 w-20">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setEditExpense(e)} className="p-1 text-text-muted hover:text-text-primary rounded transition-colors"><Pencil size={12} /></button>
                      {confirmDelete === e.id
                        ? <ConfirmDelete id={e.id} onConfirm={() => { deleteExpense.mutate(e.id); setConfirmDelete(null) }} onCancel={() => setConfirmDelete(null)} />
                        : <button onClick={() => setConfirmDelete(e.id)} className="p-1 text-text-muted hover:text-pnl-loss rounded transition-colors"><Trash2 size={12} /></button>
                      }
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(expenseOpen || editExpense) && <ExpenseEntryModal entry={editExpense} onClose={() => { setExpenseOpen(false); setEditExpense(null) }} />}
    </div>
  )
}

// ─── Campaign Modal ────────────────────────────────────────────────────────

function CampaignModal({ entry, onClose }: { entry?: any; onClose: () => void }) {
  const create = useCreateCampaign()
  const update = useUpdateCampaign()
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm({
    defaultValues: entry ?? {
      name: '', platform: 'google', objective: 'awareness', budget: '', spent: '',
      fundingSource: 'business', startDate: today(), endDate: '', status: 'active', notes: '',
    },
  })
  const watchedPlatform = watch('platform')
  const watchedFunding  = watch('fundingSource')

  const onSubmit = (data: any) => {
    const payload = { ...data, budget: parseFloat(data.budget) || 0, spent: parseFloat(data.spent) || 0 }
    const action  = entry ? update.mutateAsync({ id: entry.id, ...payload }) : create.mutateAsync(payload)
    action.then(onClose)
  }

  const pm = platformMeta(watchedPlatform)

  return (
    <Modal open onClose={onClose} title={entry ? 'Edit Campaign' : 'New Campaign'} size="sm">
      <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-4">

        {/* Name */}
        <Input label="Campaign name" placeholder="e.g. Spring Instagram Push" {...register('name', { required: true })} />
        {errors.name && <p className="text-xs text-pnl-loss -mt-2">Required</p>}

        {/* Platform */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-2">Platform</label>
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map(p => {
              const active = watchedPlatform === p.value
              return (
                <button key={p.value} type="button"
                  onClick={() => setValue('platform', p.value)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: active ? p.color + '22' : 'var(--c-bg-input)',
                    border: `1px solid ${active ? p.color + '60' : 'var(--c-border-mid)'}`,
                    color: active ? p.color : 'rgba(139,139,170,0.8)',
                    boxShadow: active ? `0 0 0 1px ${p.color}30` : 'none',
                  }}>
                  {p.label}
                </button>
              )
            })}
          </div>
          <input type="hidden" {...register('platform')} />
        </div>

        {/* Objective */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1.5">Objective</label>
          <div className="flex flex-wrap gap-1.5">
            {OBJECTIVES.map(o => {
              const active = watch('objective') === o
              return (
                <button key={o} type="button"
                  onClick={() => setValue('objective', o)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-all"
                  style={{
                    background: active ? pm.color + '18' : 'var(--c-bg-input)',
                    border: `1px solid ${active ? pm.color + '50' : 'var(--c-border-mid)'}`,
                    color: active ? pm.color : 'rgba(139,139,170,0.8)',
                  }}>
                  {o}
                </button>
              )
            })}
          </div>
          <input type="hidden" {...register('objective')} />
        </div>

        {/* Budget + Spent */}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Budget (£)" type="number" step="0.01" placeholder="0.00" {...register('budget', { required: true })} />
          <Input label="Spent so far (£)" type="number" step="0.01" placeholder="0.00" {...register('spent')} />
        </div>

        {/* Funding source */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1.5">Funded from</label>
          <div className="flex gap-2">
            {[{ v: 'business', label: 'Business account', icon: <Building2 size={12} />, color: '#34d399' },
              { v: 'personal', label: 'Personal pocket',  icon: <Wallet size={12} />,   color: '#fbbf24' }].map(f => {
              const active = watchedFunding === f.v
              return (
                <button key={f.v} type="button"
                  onClick={() => setValue('fundingSource', f.v)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: active ? f.color + '18' : 'var(--c-bg-input)',
                    border: `1px solid ${active ? f.color + '50' : 'var(--c-border-mid)'}`,
                    color: active ? f.color : 'rgba(139,139,170,0.8)',
                  }}>
                  {f.icon}{f.label}
                </button>
              )
            })}
          </div>
          <input type="hidden" {...register('fundingSource')} />
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start date" type="date" {...register('startDate', { required: true })} />
          <Input label="End date (optional)" type="date" {...register('endDate')} />
        </div>

        {/* Status */}
        <Select label="Status" {...register('status')}
          options={CAMPAIGN_STATUSES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))} />

        {/* Notes */}
        <Textarea label="Notes" rows={2} placeholder="Campaign details, target audience, ad copy…" {...register('notes')} />

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">{entry ? 'Save' : 'Create Campaign'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Marketing Tab ─────────────────────────────────────────────────────────

function MarketingTab() {
  const { fmtView } = useFmtView('GBP', 'business')
  const { data: campaigns = [], isPending } = useCampaigns()
  const deleteCampaign = useDeleteCampaign()

  const [modal,         setModal]         = useState<null | 'new' | any>(null)
  const [filterPlatform,setFilterPlatform] = useState('')
  const [filterFunding, setFilterFunding]  = useState('')
  const [filterStatus,  setFilterStatus]   = useState('')
  const [confirmDel,    setConfirmDel]     = useState<number | null>(null)

  const filtered = (campaigns as any[]).filter(c =>
    (!filterPlatform || c.platform   === filterPlatform) &&
    (!filterFunding  || c.fundingSource === filterFunding) &&
    (!filterStatus   || c.status     === filterStatus),
  )

  const totalBudget  = filtered.reduce((s: number, c: any) => s + (c.budget  ?? 0), 0)
  const totalSpent   = filtered.reduce((s: number, c: any) => s + (c.spent   ?? 0), 0)
  const totalRemain  = totalBudget - totalSpent
  const activeCount  = (campaigns as any[]).filter((c: any) => c.status === 'active').length
  const businessSpent = filtered.filter((c: any) => c.fundingSource === 'business').reduce((s: number, c: any) => s + (c.spent ?? 0), 0)
  const personalSpent = filtered.filter((c: any) => c.fundingSource === 'personal').reduce((s: number, c: any) => s + (c.spent ?? 0), 0)

  if (isPending) return <PageLoader />

  return (
    <div className="p-6 space-y-6">

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Budget"    value={fmtView(totalBudget)}  iconBg="rgba(129,140,248,0.12)" iconColor="#818cf8" accent="#818cf8" icon={<Megaphone size={16} />} />
        <StatCard label="Total Spent"     value={fmtView(totalSpent)}   iconBg="rgba(248,113,113,0.12)" iconColor="#f87171" accent="#f87171" icon={<TrendingUp size={16} />} />
        <StatCard label="Remaining"       value={fmtView(Math.max(0, totalRemain))} iconBg="rgba(52,211,153,0.12)" iconColor="#34d399" accent="#34d399" icon={<Check size={16} />} />
        <StatCard label="Active Campaigns" value={activeCount}            iconBg="rgba(251,191,36,0.12)"  iconColor="#fbbf24" accent="#fbbf24" icon={<Megaphone size={16} />} />
      </div>

      {/* Business vs Personal split */}
      {totalSpent > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-3">Spend by Funding Source</p>
          <div className="flex gap-6 mb-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: 'var(--c-profit)' }} />
              <span className="text-xs text-text-secondary">Business</span>
              <span className="text-sm font-semibold num text-text-primary ml-1">{fmtView(businessSpent)}</span>
              {totalSpent > 0 && <span className="text-xs text-text-muted">({((businessSpent / totalSpent) * 100).toFixed(0)}%)</span>}
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: '#fbbf24' }} />
              <span className="text-xs text-text-secondary">Personal</span>
              <span className="text-sm font-semibold num text-text-primary ml-1">{fmtView(personalSpent)}</span>
              {totalSpent > 0 && <span className="text-xs text-text-muted">({((personalSpent / totalSpent) * 100).toFixed(0)}%)</span>}
            </div>
          </div>
          {/* Two-segment bar — each segment reflects actual proportion */}
          <div className="h-2 rounded-full overflow-hidden flex" style={{ background: 'var(--c-bg-input)' }}>
            {businessSpent > 0 && (
              <div className="h-full transition-all" style={{ width: `${(businessSpent / totalSpent) * 100}%`, background: 'var(--c-profit)' }} />
            )}
            {personalSpent > 0 && (
              <div className="h-full transition-all" style={{ width: `${(personalSpent / totalSpent) * 100}%`, background: '#fbbf24' }} />
            )}
          </div>
        </div>
      )}

      {/* Filters + Add button */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}
          className="text-xs rounded-lg px-3 py-1.5 text-text-secondary outline-none transition-colors"
          style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)' }}>
          <option value="">All Platforms</option>
          {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select value={filterFunding} onChange={e => setFilterFunding(e.target.value)}
          className="text-xs rounded-lg px-3 py-1.5 text-text-secondary outline-none transition-colors"
          style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)' }}>
          <option value="">All Sources</option>
          <option value="business">Business</option>
          <option value="personal">Personal</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="text-xs rounded-lg px-3 py-1.5 text-text-secondary outline-none transition-colors"
          style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)' }}>
          <option value="">All Statuses</option>
          {CAMPAIGN_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <button onClick={() => setModal('new')}
          className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #818cf8, #a78bfa)' }}>
          <Plus size={14} /> New Campaign
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState icon={<Megaphone size={28} />} title="No campaigns yet" description="Add your first ad campaign to start tracking spend and ROI." />
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--c-bg-input)' }}>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Campaign</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Platform</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Objective</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Budget / Spent</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Source</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Status</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Dates</th>
                <th className="px-4 py-3 w-16" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c: any) => {
                const pm        = platformMeta(c.platform)
                const pct       = c.budget > 0 ? Math.min((c.spent / c.budget) * 100, 100) : 0
                const over      = c.spent > c.budget
                const barColor  = over ? '#f87171' : pct >= 80 ? '#fbbf24' : '#34d399'
                const statusColor = c.status === 'active' ? '#34d399' : c.status === 'paused' ? '#fbbf24' : '#8b8baa'
                return (
                  <tr key={c.id} className="border-t border-bg-border/40 hover:bg-bg-hover/20 group transition-colors">
                    {/* Name */}
                    <td className="px-4 py-3">
                      <p className="font-medium text-text-primary leading-tight">{c.name}</p>
                      {c.notes && <p className="text-[11px] text-text-muted mt-0.5 truncate max-w-[180px]">{c.notes}</p>}
                    </td>
                    {/* Platform */}
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold"
                        style={{ background: pm.color + '1a', color: pm.color, border: `1px solid ${pm.color}30` }}>
                        {pm.label}
                      </span>
                    </td>
                    {/* Objective */}
                    <td className="px-4 py-3">
                      <span className="text-xs capitalize text-text-secondary">{c.objective || '--'}</span>
                    </td>
                    {/* Budget / Spent with progress bar */}
                    <td className="px-4 py-3 min-w-[140px]">
                      <div className="flex items-baseline gap-1 mb-1">
                        <span className="text-xs num font-semibold text-text-primary">{fmtView(c.spent)}</span>
                        <span className="text-[11px] text-text-muted">/ {fmtView(c.budget)}</span>
                        {over && <span className="text-[10px] text-pnl-loss font-semibold ml-1">over</span>}
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--c-bg-input)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                      </div>
                      <p className="text-[10px] text-text-muted mt-0.5">{pct.toFixed(0)}%</p>
                    </td>
                    {/* Funding source */}
                    <td className="px-4 py-3">
                      {c.fundingSource === 'business'
                        ? <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: '#34d399' }}><Building2 size={11} />Business</span>
                        : <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: '#fbbf24' }}><Wallet size={11} />Personal</span>
                      }
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold capitalize"
                        style={{ color: statusColor }}>
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusColor }} />
                        {c.status}
                      </span>
                    </td>
                    {/* Dates */}
                    <td className="px-4 py-3">
                      <p className="text-[11px] text-text-secondary num">{formatDate(c.startDate)}</p>
                      {c.endDate && <p className="text-[11px] text-text-muted num">→ {formatDate(c.endDate)}</p>}
                    </td>
                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setModal(c)} className="p-1 text-text-muted hover:text-text-primary rounded transition-colors"><Pencil size={12} /></button>
                        {confirmDel === c.id
                          ? <ConfirmDelete id={c.id} onConfirm={() => { deleteCampaign.mutate(c.id); setConfirmDel(null) }} onCancel={() => setConfirmDel(null)} />
                          : <button onClick={() => setConfirmDel(c.id)} className="p-1 text-text-muted hover:text-pnl-loss rounded transition-colors"><Trash2 size={12} /></button>
                        }
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && <CampaignModal entry={modal === 'new' ? undefined : modal} onClose={() => setModal(null)} />}
    </div>
  )
}

// ─── Root ──────────────────────────────────────────────────────────────────

export function BusinessPage() {
  const [tab, setTab] = useState('overview')
  return (
    <PageShell title="Business: Zavabuild" action={<div className="flex items-center gap-2"><CurrencySelector pageKey="business" defaultCurrency="GBP" /><Tabs tabs={TABS} active={tab} onChange={setTab} /></div>}>
      <ConversionBanner native="GBP" pageKey="business" />
      {tab === 'overview'  && <OverviewTab />}
      {tab === 'clients'   && <ClientsTab />}
      {tab === 'projects'  && <ProjectsTab />}
      {tab === 'invoices'  && <InvoicesTab />}
      {tab === 'revenue'   && <RevenueTab />}
      {tab === 'marketing' && <MarketingTab />}
      {tab === 'notes'     && <NotesTab />}
    </PageShell>
  )
}
