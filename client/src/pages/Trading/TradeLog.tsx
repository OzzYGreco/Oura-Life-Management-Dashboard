import { useState, useMemo } from 'react'
import { useTrades, useDeleteTrade, type Trade } from '../../hooks/useTrades'
import { useTradingAccounts } from '../../hooks/useTradingAccounts'
import { TradeModal } from './TradeModal'
import { TradingSettingsModal } from './TradingSettings'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageLoader } from '../../components/ui/Spinner'
import { PnLBadge, RRBadge, DeviationBadge } from '../../components/shared/PnLBadge'
import { formatDate, fmtSize, fmtPrice } from '../../lib/utils'
import { Plus, Trash2, Edit, TrendingUp, Settings2, Layers } from 'lucide-react'
import { TradeDetailModal } from './TradeDetailModal'
import { DateFilter, applyDateFilter, type Preset } from '../../components/shared/DateFilter'

interface Props {
  accountId?: number | null
  defaultAccountId?: number | null
}

export function TradeLog({ accountId, defaultAccountId }: Props) {
  const filters: Record<string, string> = {}
  if (accountId) filters.accountId = String(accountId)

  const { data: trades, isPending } = useTrades(filters)
  const { data: accounts } = useTradingAccounts()
  const deleteTrade = useDeleteTrade()
  const [modalOpen, setModalOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editing, setEditing] = useState<Trade | null>(null)
  const [viewing, setViewing] = useState<Trade | null>(null)

  // ── Date filter ──────────────────────────────────────────────────────────────
  const [preset, setPreset]         = useState<Preset>('All')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')

  const filteredTrades = useMemo(
    () => applyDateFilter(trades ?? [], preset, customFrom, customTo),
    [trades, preset, customFrom, customTo],
  )

  // Show Account column only in "All Accounts" view
  const showAccountCol = accountId == null

  // Build quick lookup: accountId → name
  const accountName = (id?: number | null) => {
    if (!id || !accounts) return null
    return accounts.find(a => a.id === id)?.name ?? null
  }

  if (isPending) return <PageLoader />

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm" style={{ color: 'var(--c-text-2)' }}>
          {filteredTrades.length}
          {filteredTrades.length !== (trades?.length ?? 0) && (
            <span style={{ color: 'var(--c-text-3)' }}> of {trades?.length ?? 0}</span>
          )}
          {' '}trades
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-accent)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-accent)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border)' }}
            title="Trading Settings (fees, lot sizes)"
          >
            <Settings2 size={14} />
          </button>
          <Button onClick={() => { setEditing(null); setModalOpen(true) }} size="sm">
            <Plus size={14} /> New Trade
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <DateFilter
          preset={preset}         onPreset={setPreset}
          customFrom={customFrom} onCustomFrom={setCustomFrom}
          customTo={customTo}     onCustomTo={setCustomTo}
        />
      </div>

      {!trades?.length ? (
        <EmptyState
          icon={<TrendingUp size={32} />}
          title="No trades yet"
          description="Log your first trade to start tracking performance"
          action={<Button onClick={() => setModalOpen(true)}><Plus size={14} /> Add Trade</Button>}
        />
      ) : !filteredTrades.length ? (
        <div className="text-center py-16" style={{ color: 'var(--c-text-3)' }}>
          No trades in the selected period.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bg-border">
                {[
                  'Date', 'Asset', 'Dir', 'Entry', 'Exit', 'Size',
                  'P&L', 'R:R', 'Dev%', 'Rules', 'Setup',
                  ...(showAccountCol ? ['Account'] : []),
                  '',
                ].map(h => (
                  <th key={h} className="text-left text-xs text-text-muted font-medium px-3 py-2 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map(t => (
                <tr key={t.id} className="border-b border-bg-border/50 hover:bg-bg-hover/30 cursor-pointer" onClick={() => setViewing(t)}>
                  <td className="px-3 py-2.5 text-text-secondary num text-xs whitespace-nowrap">{formatDate(t.date)}</td>
                  <td className="px-3 py-2.5 font-medium text-text-primary">
                    <span className="flex items-center gap-1.5">
                      {t.isCompounded ? (
                        <Layers size={10} title="Compounded trade" style={{ color: '#fbbf24', flexShrink: 0 }} />
                      ) : null}
                      {t.asset}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant={t.direction === 'Long' ? 'green' : 'red'}>{t.direction}</Badge>
                  </td>
                  <td className="px-3 py-2.5 num text-text-secondary">{fmtPrice(t.entryPrice)}</td>
                  <td className="px-3 py-2.5 num text-text-secondary">{fmtPrice(t.exitPrice)}</td>
                  <td className="px-3 py-2.5 num text-text-secondary">{fmtSize(t.size, t.instrument)}</td>
                  <td className="px-3 py-2.5"><PnLBadge value={t.netPnl ?? t.realizedPnl} /></td>
                  <td className="px-3 py-2.5"><RRBadge value={t.rrRatio} /></td>
                  <td className="px-3 py-2.5"><DeviationBadge value={t.deviationPct} /></td>
                  <td className="px-3 py-2.5">
                    {t.rulesMet == null
                      ? <span className="text-text-muted text-sm">--</span>
                      : <Badge variant={t.rulesMet ? 'green' : 'red'}>{t.rulesMet ? 'Yes' : 'No'}</Badge>
                    }
                  </td>
                  <td className="px-3 py-2.5 text-text-muted max-w-24 truncate">{t.setupLabel ?? '--'}</td>
                  {showAccountCol && (
                    <td className="px-3 py-2.5">
                      {accountName(t.accountId) ? (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded whitespace-nowrap"
                          style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--c-accent)', border: '1px solid rgba(99,102,241,0.2)' }}>
                          {accountName(t.accountId)}
                        </span>
                      ) : (
                        <span className="text-text-muted text-xs">--</span>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setEditing(t); setModalOpen(true) }} className="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-text-secondary">
                        <Edit size={12} />
                      </button>
                      <button onClick={() => deleteTrade.mutate(t.id)} className="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-pnl-loss">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TradeModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        trade={editing}
        defaultAccountId={defaultAccountId}
      />
      {viewing && <TradeDetailModal trade={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); setModalOpen(true) }} />}
      <TradingSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
