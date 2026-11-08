import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Plus, ChevronDown } from 'lucide-react'
import { PageShell } from '../../components/layout/PageShell'
import { Tabs } from '../../components/ui/Tabs'
import { CurrencySelector } from '../../components/ui/CurrencySelector'
import { ConversionBanner } from '../../components/ui/ConversionBanner'
import { useIsNext } from '../../skins/isNext'
import { useViewCurrency, type ViewCurrency } from '../../hooks/useViewCurrency'
import { useFmtView } from '../../hooks/useFmtView'
import { useFinanceSettings } from '../../hooks/useFinanceSettings'
import { useFinanceExpenses } from '../../hooks/useFinances'
import { useRetainerLifecycle, useSendInvoice, useDeleteDraw, useProjects, useBusinessMetrics } from '../../hooks/useBusiness'

import { Overview } from './tabs/Overview'
import { BusinessSearch } from './components/BusinessSearch'
import { Clients } from './tabs/Clients'
import { ClientDetail } from './tabs/ClientDetail'
import { Invoices, type InvoicesView } from './tabs/Invoices'
import { Money } from './tabs/Money'

import { NewWorkModal } from './modals/NewWorkModal'
import { BusinessSettingsModal } from './modals/SettingsModal'
import { AdSpendModal } from './modals/AdSpendModal'
import { PayInvoiceModal, RetainerActionModal, DrawModal } from './modals/MoneyModals'
import { RetainerEditModal, DropClientModal, ComebackModal } from './modals/LifecycleModals'
import { ChangePlanModal, RecordPaymentModal } from './modals/ClientActions'
import type { RetainerAction } from './components/RetainerTable'
import {
  ClientModal, ProjectModal, InvoiceModal, RetainerModal,
  CostModal, TimeModal, NoteModal, CampaignModal,
} from './modals/EntityModals'

import type { Retainer, Project } from './lib/types'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'clients',  label: 'Clients' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'money',    label: 'Money' },
]

type Tab = 'overview' | 'clients' | 'invoices' | 'money'

/** Invoices, Payments and Retainers are three views of one tab, each with its own address. */
const INVOICE_VIEWS: Record<string, InvoicesView> = { invoices: 'ledger', payments: 'payments', retainers: 'retainers' }
const VIEW_PATH: Record<InvoicesView, string> = { ledger: 'invoices', payments: 'payments', retainers: 'retainers' }

/**
 * Business.
 *
 * Four surfaces, each answering one question: where the business stands, who it
 * works for, what has been billed, and where the money went. The version this
 * replaces was one 1,966-line file with seven tabs, no types, no memoisation and
 * every row action hidden behind a hover.
 */
export function BusinessPage() {
  const nx = useIsNext()
  // Where you are is the address, not memory: /business/clients/12, and Back,
  // Forward and refresh all land on the same view with the same filters.
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const parts = pathname.replace(/^\/business\/?/, '').split('/').filter(Boolean)
  const section = parts[0] ?? ''
  const tab: Tab = section === 'clients' ? 'clients'
    : section in INVOICE_VIEWS ? 'invoices'
    : section === 'money' ? 'money'
    : 'overview'
  const invoicesView: InvoicesView = INVOICE_VIEWS[section] ?? 'ledger'
  const openClientId = section === 'clients' && parts[1] ? Number(parts[1]) : null
  const setTab = (t: Tab) => navigate(t === 'overview' ? '/business' : `/business/${t}`)
  const { fmtView } = useFmtView('GBP', 'business')
  const { settings } = useFinanceSettings()

  /** One object so every surface asks the server the same question. */
  const ownerPayOpts = {
    taxReserveEnabled: settings.showTaxReserve,
    taxRatePct:        settings.taxRateBusiness ?? 25,
    bufferMonths:      settings.businessBufferMonths ?? 1,
  }

  const { data: projects = [] } = useProjects()
  // So "Assign" on a cost in Needs you opens THAT cost, not a blank form.
  const { data: businessCosts = [] } = useFinanceExpenses({ category: 'Business' })
  // All-time figures, only so the settings dialog can show what its rules would
  // hold back right now. Same query key as the Money tab, so it costs nothing.
  const { data: metrics } = useBusinessMetrics({}, ownerPayOpts)
  const recentCostMonths = (metrics?.pnlByMonth ?? []).filter(r => r.totalCosts > 0).slice(-3)
  const monthlyCosts = recentCostMonths.length
    ? recentCostMonths.reduce((s2, r) => s2 + r.totalCosts, 0) / recentCostMonths.length
    : 0
  const sendInvoice = useSendInvoice()
  const lifecycle = useRetainerLifecycle()
  const deleteDraw = useDeleteDraw()

  // ── Modal state ────────────────────────────────────────────────────────────
  const [newWork, setNewWork] = useState(false)
  const [payRow, setPayRow] = useState<{ id: number; invoiceNumber: string; clientName?: string } | null>(null)
  const [retainerAction, setRetainerAction] = useState<{ r: Retainer; a: 'cancel' | 'pause' | 'resume' } | null>(null)
  const [editRetainer, setEditRetainer] = useState<Retainer | null>(null)
  const [dropClient, setDropClient] = useState<{ id: number; name: string } | null>(null)
  const [comeback, setComeback] = useState<{ id: number; name: string } | null>(null)
  const [changePlan, setChangePlan] = useState<Retainer[] | null>(null)
  const [recordPayment, setRecordPayment] = useState<{ open: boolean; client: { id: number; name: string } | null }>({ open: false, client: null })
  const [drawOpen, setDrawOpen] = useState(false)
  const [clientModal, setClientModal] = useState<{ open: boolean; client?: any }>({ open: false })
  const [projectModal, setProjectModal] = useState<{ open: boolean; clientId?: number | null; project?: any }>({ open: false })
  const [invoiceModal, setInvoiceModal] = useState<{ open: boolean; clientId?: number | null; projectId?: number | null; invoiceId?: number | null }>({ open: false })
  const [retainerModal, setRetainerModal] = useState<{ open: boolean; clientId?: number | null; amount?: number }>({ open: false })
  const [costModal, setCostModal] = useState<{ open: boolean; clientId?: number | null; expense?: any }>({ open: false })
  const [timeModal, setTimeModal] = useState<{ open: boolean; projectId: number | null }>({ open: false, projectId: null })
  const [noteModal, setNoteModal] = useState<{ open: boolean; clientId: number | null; note?: any }>({ open: false, clientId: null })
  const [campaignModal, setCampaignModal] = useState<{ open: boolean; campaign?: any }>({ open: false })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adSpend, setAdSpend] = useState<{ open: boolean; campaignId?: number | null; range?: { from: string; to: string; fill?: boolean } | null }>({ open: false })

  const openClient = (id: number) => navigate(`/business/clients/${id}`)

  /** Invoicing an unbilled job from the queue: preselect its client and project. */
  const invoiceProject = (projectId: number) => {
    const p = (projects as Project[]).find(x => x.id === projectId)
    setInvoiceModal({ open: true, projectId, clientId: p?.clientId ?? null })
  }

  const handleRetainerAction = async (r: Retainer, action: RetainerAction) => {
    if (action === 'edit') setEditRetainer(r)
    else if (action === 'reinstate') await lifecycle.mutateAsync({ id: r.id, action })
    else setRetainerAction({ r, a: action })
  }

  return (
    <PageShell
      title="Business: Zavabuild"
      action={
        <div className="flex items-center gap-2">
          <BusinessSearch
            fmtView={fmtView}
            onOpenClient={openClient}
            onOpenInvoice={invoiceId => setInvoiceModal({ open: true, invoiceId })}
          />
          {nx ? <QuietCurrency /> : <CurrencySelector pageKey="business" defaultCurrency="GBP" />}
          {nx
            ? <div className="tr-seg">{TABS.map(t => <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} aria-pressed={tab === t.id} onClick={() => setTab(t.id as Tab)}>{t.label}</button>)}</div>
            : <Tabs tabs={TABS} active={tab} onChange={t => setTab(t as Tab)} />}
          <NewMenu
            onNewWork={() => setNewWork(true)}
            onRecordPayment={() => setRecordPayment({ open: true, client: null })}
            onAddCost={() => setCostModal({ open: true })}
            onLogAdSpend={() => setAdSpend({ open: true })}
            onRecordDraw={() => setDrawOpen(true)}
          />
        </div>
      }
    >
      <ConversionBanner native="GBP" pageKey="business" />
      <div className={nx ? 'bz' : undefined}>

      {tab === 'overview' && (
        <Overview
          fmtView={fmtView}
          ownerPayOpts={ownerPayOpts}
          onOpenClient={openClient}
          onOpenStats={() => setTab('money')}
          onInvoiceProject={invoiceProject}
          onSetUpRetainer={(clientId, amount) => setRetainerModal({ open: true, clientId, amount })}
          onAssignCost={expenseId => setCostModal({ open: true, expense: (businessCosts as any[]).find(e => e.id === expenseId) })}
        />
      )}

      {tab === 'clients' && (openClientId ? (
        <ClientDetail
          clientId={openClientId}
          fmtView={fmtView}
          onBack={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/business/clients'))}
          onEdit={client => setClientModal({ open: true, client })}
          onAddRetainer={clientId => setRetainerModal({ open: true, clientId })}
          onAddProject={clientId => setProjectModal({ open: true, clientId })}
          onAddInvoice={clientId => setInvoiceModal({ open: true, clientId })}
          onAddCost={clientId => setCostModal({ open: true, clientId })}
          onAddNote={clientId => setNoteModal({ open: true, clientId })}
          onRetainerAction={handleRetainerAction}
          onPay={setPayRow}
          onLogTime={projectId => setTimeModal({ open: true, projectId })}
          onEditInvoice={invoiceId => setInvoiceModal({ open: true, invoiceId })}
          onEditProject={project => setProjectModal({ open: true, project })}
          onEditNote={note => setNoteModal({ open: true, clientId: note.clientId, note })}
          onDrop={setDropClient}
          onComeback={setComeback}
          onChangePlan={setChangePlan}
          onRecordPayment={client => setRecordPayment({ open: true, client })}
        />
      ) : (
        <Clients
          fmtView={fmtView}
          onOpenClient={openClient}
          onNewClient={() => setClientModal({ open: true })}
        />
      ))}

      {tab === 'invoices' && (
        <Invoices
          view={invoicesView}
          onView={v => navigate(`/business/${VIEW_PATH[v]}`)}
          fmtView={fmtView}
          onPay={setPayRow}
          onOpenClient={openClient}
          onEdit={row => setInvoiceModal({ open: true, invoiceId: row.id, clientId: row.clientId })}
          onSend={row => sendInvoice.mutate(row.id)}
          onNewInvoice={() => setInvoiceModal({ open: true })}
          onRetainerAction={handleRetainerAction}
          onNewRetainer={() => setRetainerModal({ open: true })}
        />
      )}

      {tab === 'money' && (
        <Money
          fmtView={fmtView}
          ownerPayOpts={ownerPayOpts}
          onRecordDraw={() => setDrawOpen(true)}
          onDeleteDraw={id => deleteDraw.mutate(id)}
          onEditCost={expense => setCostModal({ open: true, expense })}
          onNewCampaign={() => setCampaignModal({ open: true })}
          onEditCampaign={campaign => setCampaignModal({ open: true, campaign })}
          onSettings={() => setSettingsOpen(true)}
          onLogAdSpend={(campaignId, range) => setAdSpend({ open: true, campaignId, range })}
        />
      )}

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      <NewWorkModal
        open={newWork}
        onClose={() => setNewWork(false)}
        fmtView={fmtView}
        onCreated={clientId => { setNewWork(false); openClient(clientId) }}
      />
      <PayInvoiceModal invoice={payRow} onClose={() => setPayRow(null)} fmtView={fmtView} />
      <RetainerActionModal
        retainer={retainerAction?.r ?? null}
        action={retainerAction?.a ?? null}
        onClose={() => setRetainerAction(null)}
        fmtView={fmtView}
      />
      <DrawModal open={drawOpen} onClose={() => setDrawOpen(false)} fmtView={fmtView} />
      <ClientModal open={clientModal.open} client={clientModal.client} onClose={() => setClientModal({ open: false })} />
      <ProjectModal open={projectModal.open} clientId={projectModal.clientId} project={projectModal.project}
        onClose={() => setProjectModal({ open: false })} />
      <InvoiceModal
        open={invoiceModal.open}
        invoiceId={invoiceModal.invoiceId}
        clientId={invoiceModal.clientId}
        projectId={invoiceModal.projectId}
        onClose={() => setInvoiceModal({ open: false })}
        onRecordPayment={setPayRow}
      />
      <RetainerEditModal retainer={editRetainer} onClose={() => setEditRetainer(null)} fmtView={fmtView} />
      <DropClientModal client={dropClient} onClose={() => setDropClient(null)} fmtView={fmtView} />
      <ComebackModal client={comeback} onClose={() => setComeback(null)} fmtView={fmtView} />
      <ChangePlanModal
        retainers={changePlan}
        onClose={() => setChangePlan(null)}
        onPause={r => setRetainerAction({ r, a: 'pause' })}
        onStop={r => setRetainerAction({ r, a: 'cancel' })}
        fmtView={fmtView}
      />
      <RecordPaymentModal open={recordPayment.open} client={recordPayment.client}
        onClose={() => setRecordPayment({ open: false, client: null })} fmtView={fmtView} />
      <RetainerModal
        open={retainerModal.open}
        clientId={retainerModal.clientId}
        presetAmount={retainerModal.amount}
        onClose={() => setRetainerModal({ open: false })}
      />
      <CostModal open={costModal.open} clientId={costModal.clientId} expense={costModal.expense}
        onClose={() => setCostModal({ open: false })} />
      <TimeModal open={timeModal.open} projectId={timeModal.projectId}
        onClose={() => setTimeModal({ open: false, projectId: null })} />
      <NoteModal open={noteModal.open} clientId={noteModal.clientId} note={noteModal.note}
        onClose={() => setNoteModal({ open: false, clientId: null })} />
      <CampaignModal open={campaignModal.open} campaign={campaignModal.campaign} onClose={() => setCampaignModal({ open: false })} />
      <AdSpendModal
        open={adSpend.open}
        campaignId={adSpend.campaignId}
        range={adSpend.range}
        onClose={() => setAdSpend({ open: false })}
        fmtView={fmtView}
      />
      <BusinessSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        netProfit={metrics?.pnl.netProfit ?? 0}
        monthlyCosts={monthlyCosts}
        fmtView={fmtView}
      />
      </div>
    </PageShell>
  )
}

/**
 * The five things worth starting from anywhere on the tab. Everything else
 * starts where it belongs: an invoice on the client, hours on the website.
 */
function NewMenu({
  onNewWork, onRecordPayment, onAddCost, onLogAdSpend, onRecordDraw,
}: Record<'onNewWork' | 'onRecordPayment' | 'onAddCost' | 'onLogAdSpend' | 'onRecordDraw', () => void>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const nx = useIsNext()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const items: { label: string; hint: string; run: () => void }[] = [
    { label: 'New client or work', hint: 'Client, website, invoices and a monthly plan in one go', run: onNewWork },
    { label: 'Record a payment', hint: 'Someone paid by bank or cash: pick them, enter the amount', run: onRecordPayment },
    { label: 'Add a cost', hint: 'A tool, a client cost, or a bill', run: onAddCost },
    { label: 'Log ad spend', hint: 'A day, several days, or ads switched off', run: onLogAdSpend },
    { label: 'Owner draw', hint: 'Money one of you took out', run: onRecordDraw },
  ]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className={nx ? 'nx-btn tr-primary' : 'flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white'}
        style={nx ? undefined : { background: 'linear-gradient(135deg,#6366f1,#a78bfa)', boxShadow: '0 2px 10px rgba(99,102,241,0.3)' }}
      >
        <Plus size={14} /> New <ChevronDown size={12} />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1.5 w-72 rounded-xl overflow-hidden z-50"
          style={{ background: 'var(--c-bg-elevated)', border: '1px solid var(--c-border-mid)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}
        >
          {items.map((it, i) => (
            <div key={it.label} className="flex items-stretch" style={{ borderTop: i ? '1px solid var(--c-border)' : 'none' }}>
              <button
                type="button"
                onClick={() => { setOpen(false); it.run() }}
                className="flex-1 text-left px-3.5 py-2.5"
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--c-bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span className="block text-xs font-semibold" style={{ color: 'var(--c-text-1)' }}>{it.label}</span>
                <span className="block text-[10.5px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>{it.hint}</span>
              </button>

            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default BusinessPage

/** The redesign's currency switch: three quiet symbols, GBP first for the business. */
function QuietCurrency() {
  const { viewCurrency, setViewCurrency } = useViewCurrency('business', 'GBP')
  const opts: { v: ViewCurrency; s: string }[] = [{ v: 'GBP', s: '£' }, { v: 'USD', s: '$' }, { v: 'EUR', s: '€' }]
  return (
    <div className="nx-cur" role="radiogroup" aria-label="Show amounts in">
      {opts.map(o => <button key={o.v} type="button" role="radio" aria-checked={viewCurrency === o.v} aria-label={o.v} className={viewCurrency === o.v ? 'on' : ''} onClick={() => setViewCurrency(o.v)}>{o.s}</button>)}
    </div>
  )
}
