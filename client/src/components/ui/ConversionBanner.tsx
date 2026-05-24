import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useViewCurrency, type ViewCurrency } from '../../hooks/useViewCurrency'
import { useCurrencyRates } from '../../hooks/useCurrencyRates'

interface Props {
  /** The page's native / stored currency — banner hides when view = native */
  native: string
  /** Page key — must match the CurrencySelector and useFmtView on the same page */
  pageKey: string
  /** Optional extra detail shown after the main message */
  detail?: string
}

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' }

function timeAgoMins(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

export function ConversionBanner({ native, pageKey, detail }: Props) {
  const { viewCurrency }                          = useViewCurrency(pageKey, native as ViewCurrency)
  const { data: rates, dataUpdatedAt, isFetching } = useCurrencyRates()
  const qc                                        = useQueryClient()

  if (viewCurrency === native || !rates) return null

  const sym       = SYMBOL[viewCurrency] ?? viewCurrency
  const updatedAt = dataUpdatedAt ? timeAgoMins(dataUpdatedAt) : null

  const refresh = () => qc.invalidateQueries({ queryKey: ['currency-rates-gbp'] })

  return (
    <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
      style={{ background: 'rgba(129,140,248,0.07)', border: '1px solid rgba(129,140,248,0.15)', color: 'rgba(139,139,170,0.8)' }}>
      <span style={{ color: '#818cf8' }}>ℹ</span>
      <span className="flex-1">
        Showing in{' '}
        <strong style={{ color: '#818cf8' }}>{sym} {viewCurrency}</strong>
        {', converted from '}
        <strong style={{ color: '#818cf8' }}>{SYMBOL[native] ?? ''} {native}</strong>
        {detail ? `. ${detail}` : '.'}
        {' '}Rates update in real time{updatedAt ? ` · last refreshed ${updatedAt}` : ''}.
        {' '}Display only. Logged values are unchanged.
      </span>
      <button
        onClick={refresh}
        disabled={isFetching}
        title="Refresh exchange rate"
        className="flex-shrink-0 rounded p-1 transition-colors hover:bg-white/5 disabled:opacity-40"
        style={{ color: '#818cf8' }}
      >
        <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
      </button>
    </div>
  )
}
