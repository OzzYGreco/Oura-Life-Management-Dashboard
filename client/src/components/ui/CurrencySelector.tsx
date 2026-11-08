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
    <div className="inline-flex items-center p-[2px] rounded-[7px] gap-px" role="radiogroup" aria-label="Display currency"
      style={{ background: 'var(--c-bg-input)', boxShadow: 'inset 0 0 0 0.5px var(--c-border)' }}
      title={!rates ? 'Loading live rates…' : undefined}>
      {CURRENCIES.map(c => {
        const on = viewCurrency === c.code
        return (
          <button key={c.code} onClick={() => setViewCurrency(c.code)} role="radio" aria-checked={on}
            title={c.code}
            className="h-[22px] min-w-[30px] px-2 rounded-[5px] text-[12px] font-medium transition-colors"
            style={{
              background: on ? 'var(--c-seg-on)' : 'transparent',
              boxShadow: on ? 'var(--c-seg-on-shadow)' : 'none',
              color: on ? 'var(--c-text-1)' : 'var(--c-text-2)',
              opacity: !rates && !on ? 0.5 : 1,
            }}>
            {c.symbol}
          </button>
        )
      })}
    </div>
  )
}
