import { useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { useCurrencyRates } from '../../hooks/useCurrencyRates'

export function CurrencyConverter() {
  const { data: rates, isPending, dataUpdatedAt, isError } = useCurrencyRates()
  const [amount, setAmount] = useState('1000')

  const val = parseFloat(amount) || 0
  const usd = rates ? val * (rates['USD'] ?? 0) : null
  const eur = rates ? val * (rates['EUR'] ?? 0) : null
  const updatedMinsAgo = dataUpdatedAt ? Math.round((Date.now() - dataUpdatedAt) / 60000) : null

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ArrowLeftRight size={14} className="text-accent-blue" />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--c-text-1)' }}>Currency Converter</h3>
        </div>
        {updatedMinsAgo !== null && (
          <span className="text-[10px] text-text-muted">
            {updatedMinsAgo < 1 ? 'just updated' : `updated ${updatedMinsAgo}m ago`}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-secondary pointer-events-none">£</span>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="w-full pl-7 pr-3 py-2.5 bg-bg-primary border border-bg-border rounded-lg text-sm num text-text-primary outline-none focus:border-accent-blue transition-colors"
            placeholder="0"
          />
        </div>
        <span className="text-xs font-semibold text-text-muted px-1">GBP</span>
      </div>

      {isPending && <p className="text-xs text-text-muted">Fetching live rates…</p>}
      {isError   && <p className="text-xs text-pnl-loss">Could not load rates. Check connection.</p>}
      {rates && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { code: 'USD', symbol: '$', value: usd, rate: rates['USD'] },
            { code: 'EUR', symbol: '€', value: eur, rate: rates['EUR'] },
          ].map(c => (
            <div key={c.code} className="rounded-xl p-3 bg-bg-secondary" style={{ border: '1px solid var(--c-border)' }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-text-muted">{c.code}</span>
                <span className="text-[10px] num text-text-muted">1£ = {c.symbol}{c.rate?.toFixed(4)}</span>
              </div>
              <p className="text-xl num font-bold" style={{ color: 'var(--c-text-1)' }}>
                {c.symbol}{c.value?.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
