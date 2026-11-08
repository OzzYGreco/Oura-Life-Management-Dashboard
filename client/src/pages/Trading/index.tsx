import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageShell } from '../../components/layout/PageShell'
import { Segmented } from './controls'
import { useViewCurrency, type ViewCurrency } from '../../hooks/useViewCurrency'
import { ConversionBanner } from '../../components/ui/ConversionBanner'
import { TradeLog } from './TradeLog'
import { TradingAnalytics } from './Analytics'
import { AccountsModal } from './AccountsModal'
import { BybitPanel } from './BybitPanel'
import { TradingPulse } from './TradingPulse'
import { useTradingAccounts } from '../../hooks/useTradingAccounts'
import { List, BarChart2, Settings2 } from 'lucide-react'

/** The page's view currency, in the same segmented style as the rest. */
function CurrencySwitch() {
  const { viewCurrency, setViewCurrency } = useViewCurrency('trading', 'USD')
  return (
    <Segmented size="sm" value={viewCurrency} onChange={v => setViewCurrency(v as ViewCurrency)}
      options={[{ value: 'EUR', label: '€' }, { value: 'GBP', label: '£' }, { value: 'USD', label: '$' }]} />
  )
}

const STORAGE_KEY = 'trading-selected-account'

function readStored(): number | null {
  const v = localStorage.getItem(STORAGE_KEY)
  if (v === null || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

export function TradingPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'analytics' ? 'analytics' : 'log'
  const setTab = (t: string) => setParams(p => { if (t === 'log') p.delete('tab'); else p.set('tab', t); return p })
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(readStored)
  const [accountsModalOpen, setAccountsModalOpen] = useState(false)
  const [reviewSignal, setReviewSignal] = useState(0)
  const { data: accounts } = useTradingAccounts()

  const handleSelect = (id: number | null) => {
    setSelectedAccountId(id)
    localStorage.setItem(STORAGE_KEY, id != null ? String(id) : '')
  }

  const handleSetDefault = (id: number | null) => {
    handleSelect(id)   // setting as default also switches to it immediately
  }

  return (
    <PageShell title="Trading Journal" action={
      <div className="flex items-center gap-2.5">
        <CurrencySwitch />
        <Segmented value={tab} onChange={setTab} options={[
          { value: 'log', label: <><List size={14} /> Journal</> },
          { value: 'analytics', label: <><BarChart2 size={14} /> Analytics</> },
        ]} />
      </div>
    }>
      <ConversionBanner native="USD" pageKey="trading" />

      {/* ── Accounts and connection ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Segmented keep value={String(selectedAccountId ?? 'all')} onChange={v => handleSelect(v === 'all' ? null : Number(v))}
          options={[
            { value: 'all', label: 'All accounts' },
            ...(accounts ?? []).map(a => ({
              value: String(a.id),
              title: [a.broker, a.startingBalance != null ? `started at ${a.startingBalance.toLocaleString()} ${a.currency}` : null].filter(Boolean).join(' · ') || undefined,
              label: <>{a.name}{a.fullRisk ? <span className="font-medium num" style={{ color: 'var(--c-text-3)' }}>1R ${a.fullRisk}</span> : null}</>,
            })),
          ]} />
        <button onClick={() => setAccountsModalOpen(true)} title="Accounts, 1R and loss limits"
          className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:text-[var(--c-accent)]"
          style={{ background: 'var(--c-bg-input)', boxShadow: 'inset 0 0 0 1px var(--c-border)', color: 'var(--c-text-3)' }}>
          <Settings2 size={14} />
        </button>
        <div className="ml-auto"><BybitPanel accountId={selectedAccountId} /></div>
      </div>

      <TradingPulse accountId={selectedAccountId} onReview={() => { setTab('log'); setReviewSignal(n => n + 1) }} onSetLimits={() => setAccountsModalOpen(true)} />

      {tab === 'log'       && <TradeLog accountId={selectedAccountId} defaultAccountId={selectedAccountId ?? accounts?.[0]?.id ?? null} reviewSignal={reviewSignal} />}
      {tab === 'analytics' && <TradingAnalytics accountId={selectedAccountId} />}

      <AccountsModal
        open={accountsModalOpen}
        onClose={() => setAccountsModalOpen(false)}
        defaultAccountId={selectedAccountId}
        onSetDefault={handleSetDefault}
      />
    </PageShell>
  )
}
