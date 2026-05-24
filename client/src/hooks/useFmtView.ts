import { useCallback } from 'react'
import { useViewCurrency, type ViewCurrency } from './useViewCurrency'
import { useCurrencyRates } from './useCurrencyRates'
import { formatInCurrency, convertAmount } from '../lib/utils'

export type FmtView = (amount: number | null | undefined, nativeCurrency?: string) => string

/**
 * Returns a display formatter scoped to a specific page.
 *
 * @param defaultNative  The page's primary stored currency (e.g. 'GBP' for Business).
 * @param pageKey        Unique page identifier — each page keeps its own view-currency selection.
 */
export function useFmtView(defaultNative: string = 'USD', pageKey: string = 'default') {
  const { viewCurrency, setViewCurrency } = useViewCurrency(pageKey, defaultNative as ViewCurrency)
  const { data: rates } = useCurrencyRates()

  const fmtView = useCallback<FmtView>((amount, nativeCurrency) => {
    const native = nativeCurrency ?? defaultNative
    if (amount == null) return '--'
    if (!rates || native === viewCurrency) return formatInCurrency(amount, viewCurrency)
    const converted = convertAmount(amount, native, viewCurrency, rates)
    return formatInCurrency(converted, viewCurrency)
  }, [rates, viewCurrency, defaultNative])

  return { fmtView, viewCurrency, setViewCurrency, rates }
}
