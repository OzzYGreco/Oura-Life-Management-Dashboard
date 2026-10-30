import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * A piece of view state kept in the address bar instead of in memory.
 *
 * Filters, the date range and search terms used to live in useState, so
 * opening a client and pressing Back reset the list to its defaults. In the
 * address they survive Back, Forward, a refresh and a bookmark.
 *
 * Changes REPLACE the current history entry: flicking through filters should
 * not fill the Back button with every intermediate state.
 */
export function useUrlState(key: string, fallback: string): [string, (v: string) => void]
export function useUrlState<T extends string>(key: string, fallback: T): [T, (v: T) => void]
export function useUrlState<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [params, setParams] = useSearchParams()
  const value = (params.get(key) as T | null) ?? fallback
  const set = useCallback((v: T) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      if (v === fallback || v === '') next.delete(key)
      else next.set(key, v)
      return next
    }, { replace: true })
  }, [key, fallback, setParams])
  return [value, set]
}
