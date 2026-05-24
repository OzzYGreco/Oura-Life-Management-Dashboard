import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { today } from '../lib/utils'

export function useDashboardSummary(date: string = today()) {
  return useQuery({
    queryKey: ['dashboard', date],
    queryFn: () => api.get('/api/dashboard/summary', { params: { date } }).then(r => r.data),
    staleTime: 0,
    refetchInterval: 8_000,
  })
}
