import { useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface BybitAccountStatus {
  accountId: number
  name: string
  configured: boolean
  reviewed: boolean
  syncFrom: string | null
  lastSyncAt: string | null
  lastError: string | null
  keyExpiresAt: string | null
  live: boolean
}

export interface BybitStatus { lastChangeAt: number; accounts: BybitAccountStatus[] }

export interface FieldDiff { field: string; logged: unknown; bybit: unknown }
export interface ReviewMatch { tradeId: number; externalId: string; symbol: string; direction: string; openedAt: string; diffs: FieldDiff[] }
export interface ReviewMissing { externalId: string; symbol: string; direction: string; openedAt: string; closedAt: string | null; size: number; avgEntry: number; avgExit: number | null; net: number | null; risk: number | null; suggestAccountId: number | null }
export interface ReviewUnmatched { tradeId: number; date: string; time: string | null; instrument: string; asset: string; direction: string; entryPrice: number; size: number | null; netPnl: number | null; samePositionAs: number | null }
export interface BybitReview {
  accountId: number
  name: string
  applied: boolean
  syncFrom: string | null
  firstPositionAt: string | null
  otherAccounts: { accountId: number; name: string; firstFillAt: string | null }[]
  matches: ReviewMatch[]
  missing: ReviewMissing[]
  unmatched: ReviewUnmatched[]
  notOnBybit: ReviewUnmatched[]
}

/** Every query a synced trade can change. */
function invalidateTradeViews(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['trades', 'trades-summary', 'trades-equity', 'trades-mistakes', 'trading-accounts', 'dashboard', 'calendar']) {
    qc.invalidateQueries({ queryKey: [key] })
  }
}

/**
 * Sync status, polled. When the server says a trade changed (a fill came in,
 * a position closed), every trade view reloads, so a new trade shows up
 * without touching the page.
 */
export function useBybitStatus() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['bybit-status'],
    queryFn: () => api.get('/api/bybit/status').then(r => r.data as BybitStatus),
    refetchInterval: 4_000,
  })
  const seen = useRef<number | null>(null)
  useEffect(() => {
    const stamp = q.data?.lastChangeAt
    if (stamp == null) return
    if (seen.current != null && stamp !== seen.current) invalidateTradeViews(qc)
    seen.current = stamp
  }, [q.data?.lastChangeAt, qc])
  return q
}

export function useBybitSyncNow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (accountId?: number) => api.post('/api/bybit/sync', { accountId }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bybit-status'] }); qc.invalidateQueries({ queryKey: ['bybit-review'] }); invalidateTradeViews(qc) },
  })
}

export function useBybitReview(accountId: number | null) {
  return useQuery({
    queryKey: ['bybit-review', accountId],
    queryFn: () => api.get(`/api/bybit/review/${accountId}`).then(r => r.data as BybitReview),
    enabled: accountId != null,
  })
}

export function useApplyBybitReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ accountId, ...body }: { accountId: number; syncFrom: string; deleteTradeIds: number[]; moves: { externalId: string; accountId: number }[] }) =>
      api.post(`/api/bybit/review/${accountId}/apply`, body).then(r => r.data as { created: number; updated: number }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bybit-status'] }); qc.invalidateQueries({ queryKey: ['bybit-review'] }); invalidateTradeViews(qc) },
  })
}
