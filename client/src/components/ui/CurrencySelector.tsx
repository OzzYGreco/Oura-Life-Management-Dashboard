import { useViewCurrency, type ViewCurrency } from '../../hooks/useViewCurrency'
import { useCurrencyRates } from '../../hooks/useCurrencyRates'

interface Props {
  /** Page key — keeps each page's selection independent */
  pageKey: string
  /** Default currency shown on first visit (should match the page's native currency) */
  defaultCurrency?: ViewCurrency
}

const CURRENCIES: { code: ViewCurrency; symbol: string }[] = [
  { code: 'EUR', symbol: '€' },
  { code: 'GBP', symbol: '£' },
  { code: 'USD', symbol: '$' },
]

export function CurrencySelector({ pageKey, defaultCurrency = 'USD' }: Props) {
  const { viewCurrency, setViewCurrency } = useViewCurrency(pageKey, defaultCurrency)
  const { data: rates } = useCurrencyRates()

  return (
    <div className="flex items-center rounded-lg overflow-hidden"
      style={{ border: '1px solid var(--c-border-mid)', background: 'var(--c-bg-input)' }}
      title={!rates ? 'Loading live rates…' : undefined}>
      {CURRENCIES.map((c, i) => (
        <button key={c.code} onClick={() => setViewCurrency(c.code)}
          className="px-2.5 py-1.5 text-xs font-bold transition-all"
          style={{
            background: viewCurrency === c.code ? 'rgba(129,140,248,0.2)' : 'transparent',
            color:      viewCurrency === c.code ? 'var(--c-accent)' : 'var(--c-text-3)',
            borderRight: i < CURRENCIES.length - 1 ? '1px solid var(--c-border)' : 'none',
            opacity: !rates && c.code !== viewCurrency ? 0.5 : 1,
          }}>
          {c.symbol} {c.code}
        </button>
      ))}
    </div>
  )
}
