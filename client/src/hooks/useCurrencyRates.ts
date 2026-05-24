import { useQuery } from '@tanstack/react-query'

export function useCurrencyRates() {
  return useQuery({
    queryKey: ['currency-rates-gbp'],
    queryFn: async () => {
      const res = await fetch('https://open.er-api.com/v6/latest/GBP')
      if (!res.ok) throw new Error('Failed to fetch rates')
      const data = await res.json()
      if (data.result !== 'success') throw new Error(data['error-type'] ?? 'Unknown error')
      return data.rates as Record<string, number>
    },
    staleTime: 1000 * 60 * 60,       // refetch after 1 hour
    gcTime:    1000 * 60 * 60 * 24,
    retry: 2,
  })
}
