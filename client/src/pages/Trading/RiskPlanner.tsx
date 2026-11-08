import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUpdateTrade, type Trade } from '../../hooks/useTrades'
import { useTradingAccounts } from '../../hooks/useTradingAccounts'
import { formatCurrency } from '../../lib/utils'

const MULTIPLES = [0.5, 1, 1.5, 2]
const label = (m: number) => (m === 0.5 ? '½R' : `${m}R`)

/**
 * Planned risk against what the stop actually risked.
 *
 * Bybit knows the stop and the size, so it knows what the trade could lose
 * (fees included). It cannot know what the trade was meant to risk: half size,
 * full size or scaled up. That intent is set here, in one click from the
 * account's 1R, and R:R is measured against it. The sync never overwrites it.
 */
export function RiskPlanner({ trade }: { trade: Trade }) {
  const qc = useQueryClient()
  const update = useUpdateTrade()
  const { data: accounts } = useTradingAccounts()
  const fullRisk = accounts?.find(a => a.id === trade.accountId)?.fullRisk ?? null

  // The modal holds a snapshot of the trade, so keep what was saved here.
  const [t, setT] = useState(trade)
  const [custom, setCustom] = useState('')

  const save = (riskDollars: number | null) =>
    update.mutate({ id: t.id, riskDollars: riskDollars as number }, {
      onSuccess: (row: Trade) => {
        setT(x => ({ ...x, ...row })); setCustom('')
        for (const k of ['trades-summary', 'trades-equity']) qc.invalidateQueries({ queryKey: [k] })
      },
    })

  const planned = t.riskDollars ?? null
  const atStop = t.riskAtStop ?? null
  const sized = planned && atStop ? atStop / planned : null
  const multiple = planned && fullRisk ? planned / fullRisk : null
  const isUser = t.riskSource === 'user'

  return (
    <div className="rounded-lg p-3 flex flex-col gap-2 text-sm" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span>
          <span className="text-text-muted text-xs">Planned risk </span>
          <span className="num font-semibold text-text-primary">{planned != null ? formatCurrency(planned) : '—'}</span>
          {multiple != null && <span className="text-xs text-text-muted num"> · {+multiple.toFixed(2)}R</span>}
          {!isUser && planned != null && <span className="text-xs text-text-muted"> (from the stop; not set yet)</span>}
        </span>
        {atStop != null && (
          <span>
            <span className="text-text-muted text-xs">At the stop, incl. fees </span>
            <span className="num text-text-primary">{formatCurrency(atStop)}</span>
            {sized != null && isUser && (
              <span className="text-xs num" style={{ color: Math.abs(sized - 1) <= 0.1 ? 'var(--c-text-3)' : 'var(--c-warn, #f59e0b)' }}>
                {' '}· sized at {Math.round(sized * 100)}% of plan
              </span>
            )}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {fullRisk != null ? MULTIPLES.map(m => {
          const v = +(fullRisk * m).toFixed(2)
          const on = isUser && planned != null && Math.abs(planned - v) < 0.005
          return (
            <button key={m} disabled={update.isPending} onClick={() => save(v)}
              className="px-2 py-0.5 rounded text-xs num"
              style={{ background: on ? 'var(--c-accent)' : 'var(--c-bg-card)', color: on ? 'var(--c-on-accent)' : 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
              {label(m)} <span style={{ opacity: 0.7 }}>{formatCurrency(v)}</span>
            </button>
          )
        }) : (
          <span className="text-xs text-text-muted">Set the account's full risk (1R) under Manage accounts for one-click ½R / 1R / 2R.</span>
        )}
        <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="other $" inputMode="decimal"
          onKeyDown={e => { if (e.key === 'Enter' && custom && !isNaN(Number(custom))) save(Number(custom)) }}
          className="w-20 px-1.5 py-0.5 rounded text-xs num"
          style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)' }} />
        {custom && !isNaN(Number(custom)) && (
          <button onClick={() => save(Number(custom))} className="text-xs hover:underline" style={{ color: 'var(--c-accent)' }}>set</button>
        )}
        {isUser && t.source === 'bybit' && atStop != null && (
          <button onClick={() => save(null)} className="text-xs hover:underline ml-auto text-text-muted">use the stop's risk</button>
        )}
      </div>
    </div>
  )
}
