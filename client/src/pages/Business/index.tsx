import { useEffect, useRef, useState } from 'react'
import { Plus, ChevronDown } from 'lucide-react'
import { PageShell } from '../../components/layout/PageShell'
import { Tabs } from '../../components/ui/Tabs'
import { CurrencySelector } from '../../components/ui/CurrencySelector'
import { ConversionBanner } from '../../components/ui/ConversionBanner'
import { useFmtView } from '../../hooks/useFmtView'
import { useFinanceSettings } from '../../hooks/useFinanceSettings'
import { useRetainerLifecycle, useSendInvoice, useDeleteDraw, useProjects, useBusinessMetrics } from '../../hooks/useBusiness'

import { Overview } from './tabs/Overview'
import { Clients } from './tabs/Clients'
import { ClientDetail } from './tabs/ClientDetail'
import { Invoices } from './tabs/Invoices'
import { Money } from './tabs/Money'

import { NewWorkModal } from './modals/NewWorkModal'
import { BusinessSettingsModal } from './modals/SettingsModal'
import { AdSpendModal } from './modals/AdSpendModal'
import { PayInvoiceModal, RetainerActionModal, DrawModal } from './modals/MoneyModals'
import {
  ClientModal, ProjectModal, InvoiceModal, RetainerModal,
  CostModal, TimeModal, NoteModal, CampaignModal,
} from './modals/EntityModals'

import type { LedgerRow, Retainer, Project } from './lib/types'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'clients',  label: 'Clients' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'money',    label: 'Money' },
]

type Tab = 'overview' | 'clients' | 'invoices' | 'money'

/**
 * Business.
 *
 * Four surfaces, each answering one question: where the business stands, who it
 * works for, what has been billed, and where the money went. The version this
 * replaces was one 1,966-line file with seven tabs, no types, no memoisation and
 * every row action hidden behind a hover.
 */
export function BusinessPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [openClientId, setOpenClientId] = useState<number | null>(null)
  const { fmtView } = useFmtView('GBP', 'business')
  const { settings } = useFinanceSettings()

  /** One object so every surface asks the server the same question. */
  const ownerPayOpts = {
    taxReserveEnabled: settings.showTaxReserve,
    taxRatePct:        settings.taxRateBusiness ?? 25,
    bufferMonths:      settings.businessBufferMonths ?? 1,
  }

  const { data: projects = [] } = useProjects()
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
  const [payRow, setPayRow] = useState<LedgerRow | null>(null)
  const [retainerAction, setRetainerAction] = useState<{ r: Retainer; a: 'price' | 'cancel' } | null>(null)
  const [drawOpen, setDrawOpen] = useState(false)
  const [clientModal, setClientModal] = useState<{ open: boolean; client?: any }>({ open: false })
  const [projectModal, setProjectModal] = useState<{ open: boolean; clientId?: number | null }>({ open: false })
  const [invoiceModal, setInvoiceModal] = useState<{ open: boolean; clientId?: number | null; projectId?: number | null; invoiceId?: number | null }>({ open: false })
  const [retainerModal, setRetainerModal] = useState<{ open: boolean; clientId?: number | null; amount?: number }>({ open: false })
  const [costModal, setCostModal] = useState<{ open: boolean; clientId?: number | null; expense?: any }>({ open: false })
  const [timeModal, setTimeModal] = useState<{ open: boolean; projectId: number | null }>({ open: false, projectId: null })
  const [noteModal, setNoteModal] = useState<{ open: boolean; clientId: number | null }>({ open: false, clientId: null })
  const [campaignModal, setCampaignModal] = useState<{ open: boolean; campaign?: any }>({ open: false })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adSpend, setAdSpend] = useState<{ open: boolean; campaignId?: number | null }>({ open: false })

  const openClient = (id: number) => { setOpenClientId(id); setTab('clients') }

  /** Invoicing an unbilled job from the queue: preselect its client and project. */
  const invoiceProject = (projectId: number) => {
    const p = (projects as Project[]).find(x => x.id === projectId)
    setInvoiceModal({ open: true, projectId, clientId: p?.clientId ?? null })
  }

  const handleRetainerAction = async (r: Retainer, action: 'price' | 'pause' | 'resume' | 'cancel') => {
    if (action === 'pause' || action === 'resume') await lifecycle.mutateAsync({ id: r.id, action })
    else setRetainerAction({ r, a: action })
  }

  return (
    <PageShell
      title="Business: Zavabuild"
      action={
        <div className="flex items-center gap-2">
          <CurrencySelector pageKey="business" defaultCurrency="GBP" />
          <Tabs tabs={TABS} active={tab} onChange={t => { setTab(t as Tab); if (t !== 'clients') setOpenClientId(null) }} />
          <NewMenu
            onNewWork={() => setNewWork(true)}
            onNewClient={() => setClientModal({ open: true })}
            onNewInvoice={() => setInvoiceModal({ open: true })}
            onAddCost={() => setCostModal({ open: true })}
            onLogAdSpend={() => setAdSpend({ open: true })}
            onLogTime={() => setTimeModal({ open: true, projectId: null })}
            onRecordDraw={() => setDrawOpen(true)}
          />
        </div>
      }
    >
      <ConversionBanner native="GBP" pageKey="business" />

      {tab === 'overview' && (
        <Overview
          fmtView={fmtView}
          ownerPayOpts={ownerPayOpts}
          onOpenClient={openClient}
          onOpenStats={() => setTab('money')}
          onInvoiceProject={invoiceProject}
          onSetUpRetainer={(clientId, amount) => setRetainerModal({ open: true, clientId, amount })}
          onAssignCost={() => setCostModal({ open: true })}
        />
      )}

      {tab === 'clients' && (openClientId ? (
        <ClientDetail
          clientId={openClientId}
          fmtView={fmtView}
          onBack={() => setOpenClientId(null)}
          onEdit={client => setClientModal({ open: true, client })}
          onAddRetainer={clientId => setRetainerModal({ open: true, clientId })}
          onAddProject={clientId => setProjectModal({ open: true, clientId })}
          onAddInvoice={clientId => setInvoiceModal({ open: true, clientId })}
          onAddCost={clientId => setCostModal({ open: true, clientId })}
          onAddNote={clientId => setNoteModal({ open: true, clientId })}
          onRetainerAction={handleRetainerAction}
          onPay={invoiceId => setInvoiceModal({ open: true, invoiceId })}
          onLogTime={projectId => setTimeModal({ open: true, projectId })}
        />
      ) : (
        <Clients
          fmtView={fmtView}
          onOpenClient={setOpenClientId}
          onNewClient={() => setClientModal({ open: true })}
        />
      ))}

      {tab === 'invoices' && (
        <Invoices
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
          onAddCost={() => setCostModal({ open: true })}
          onEditCost={expense => setCostModal({ open: true, expense })}
          onNewCampaign={() => setCampaignModal({ open: true })}
          onEditCampaign={campaign => setCampaignModal({ open: true, campaign })}
          onSettings={() => setSettingsOpen(true)}
          onLogAdSpend={campaignId => setAdSpend({ open: true, campaignId })}
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
      <ProjectModal open={projectModal.open} clientId={projectModal.clientId} onClose={() => setProjectModal({ open: false })} />
      <InvoiceModal
        open={invoiceModal.open}
        invoiceId={invoiceModal.invoiceId}
        clientId={invoiceModal.clientId}
        projectId={invoiceModal.projectId}
        onClose={() => setInvoiceModal({ open: false })}
      />
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
      <NoteModal open={noteModal.open} clientId={noteModal.clientId}
        onClose={() => setNoteModal({ open: false, clientId: null })} />
      <CampaignModal open={campaignModal.open} campaign={campaignModal.campaign} onClose={() => setCampaignModal({ open: false })} />
      <AdSpendModal
        open={adSpend.open}
        campaignId={adSpend.campaignId}
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
    </PageShell>
  )
}

/** The five things worth doing from anywhere on the tab. */
function NewMenu({
  onNewWork, onNewClient, onNewInvoice, onAddCost, onLogAdSpend, onLogTime, onRecordDraw,
}: Record<'onNewWork' | 'onNewClient' | 'onNewInvoice' | 'onAddCost' | 'onLogAdSpend' | 'onLogTime' | 'onRecordDraw', () => void>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const items: [string, () => void, string?][] = [
    ['New work', onNewWork, 'Client, website, invoices and retainer in one go'],
    ['New client', onNewClient],
    ['New invoice', onNewInvoice],
    ['Add a cost', onAddCost],
    ['Log ad spend', onLogAdSpend, 'A day at a time, or pull it from Meta'],
    ['Log hours', onLogTime],
    ['Record a draw', onRecordDraw],
  ]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white"
        style={{ background: 'linear-gradient(135deg,#6366f1,#a78bfa)', boxShadow: '0 2px 10px rgba(99,102,241,0.3)' }}
      >
        <Plus size={14} /> New <ChevronDown size={12} />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1.5 w-64 rounded-xl overflow-hidden z-50"
          style={{ background: 'var(--c-bg-elevated)', border: '1px solid var(--c-border-mid)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}
        >
          {items.map(([label, fn, hint], i) => (
            <button
              key={label}
              type="button"
              onClick={() => { setOpen(false); fn() }}
              className="w-full text-left px-3.5 py-2.5"
              style={{ borderTop: i ? '1px solid var(--c-border)' : 'none' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--c-bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span className="block text-xs font-semibold" style={{ color: 'var(--c-text-1)' }}>{label}</span>
              {hint && <span className="block text-[10.5px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>{hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default BusinessPage
