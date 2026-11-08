import { useViewCurrency, type ViewCurrency } from '../../hooks/useViewCurrency'
import { useCurrencyRates } from '../../hooks/useCurrencyRates'

interface Props {
  /** Page key - keeps each page's selection independent */
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
    <div className="ui-seg" role="radiogroup" aria-label="Display currency"
      title={!rates ? 'Loading live rates…' : undefined}>
      {CURRENCIES.map(c => {
        const on = viewCurrency === c.code
        return (
          <button key={c.code} onClick={() => setViewCurrency(c.code)} role="radio" aria-checked={on}
            title={c.code} className={on ? 'on' : ''} style={{ opacity: !rates && !on ? 0.5 : undefined }}>
            {c.symbol}
          </button>
        )
      })}
    </div>
  )
}
