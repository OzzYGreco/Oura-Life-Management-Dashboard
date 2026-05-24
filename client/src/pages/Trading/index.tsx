import { useState } from 'react'
import { PageShell } from '../../components/layout/PageShell'
import { Tabs } from '../../components/ui/Tabs'
import { CurrencySelector } from '../../components/ui/CurrencySelector'
import { ConversionBanner } from '../../components/ui/ConversionBanner'
import { TradeLog } from './TradeLog'
import { TradingAnalytics } from './Analytics'
import { AccountsModal } from './AccountsModal'
import { useTradingAccounts } from '../../hooks/useTradingAccounts'
import { List, BarChart2, Settings2, ChevronDown } from 'lucide-react'

const TABS = [
  { id: 'log',       label: 'Trade Log',  icon: <List size={14} /> },
  { id: 'analytics', label: 'Analytics',  icon: <BarChart2 size={14} /> },
]

const STORAGE_KEY = 'trading-selected-account'

function readStored(): number | null {
  const v = localStorage.getItem(STORAGE_KEY)
  if (v === null || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

export function TradingPage() {
  const [tab, setTab] = useState('log')
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(readStored)
  const [accountsModalOpen, setAccountsModalOpen] = useState(false)
  const { data: accounts } = useTradingAccounts()

  const selectedAccount = accounts?.find(a => a.id === selectedAccountId) ?? null

  const handleSelect = (id: number | null) => {
    setSelectedAccountId(id)
    localStorage.setItem(STORAGE_KEY, id != null ? String(id) : '')
  }

  const handleSetDefault = (id: number | null) => {
    handleSelect(id)   // setting as default also switches to it immediately
  }

  return (
    <PageShell title="Trading Journal" action={
      <div className="flex items-center gap-2">
        <CurrencySelector pageKey="trading" defaultCurrency="USD" />
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>
    }>
      <ConversionBanner native="USD" pageKey="trading" />

      {/* ── Account selector bar ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-5">
        <div className="relative">
          <select
            value={selectedAccountId ?? ''}
            onChange={e => handleSelect(e.target.value !== '' ? Number(e.target.value) : null)}
            className="appearance-none pl-3 pr-8 py-1.5 rounded-lg text-sm font-medium outline-none cursor-pointer"
            style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }}
          >
            <option value="">All Accounts</option>
            {accounts?.map(a => (
              <option key={a.id} value={a.id}>
                {a.name}{a.broker ? ` · ${a.broker}` : ''}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--c-text-3)' }}
          />
        </div>

        <button
          onClick={() => setAccountsModalOpen(true)}
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150"
          style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}
          title="Manage accounts"
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--c-accent)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--c-accent)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--c-text-3)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--c-border)' }}
        >
          <Settings2 size={13} />
        </button>

        {selectedAccount && (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded"
            style={{ background: 'var(--c-bg-input)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}>
            {selectedAccount.currency}
          </span>
        )}

        {selectedAccount?.startingBalance != null && (
          <span className="text-[11px] num" style={{ color: 'var(--c-text-3)' }}>
            Starting balance: {selectedAccount.startingBalance.toLocaleString()} {selectedAccount.currency}
          </span>
        )}
      </div>

      {tab === 'log'       && <TradeLog accountId={selectedAccountId} defaultAccountId={selectedAccountId ?? accounts?.[0]?.id ?? null} />}
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
