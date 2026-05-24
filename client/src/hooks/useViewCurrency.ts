import { useState, useEffect } from 'react'

export type ViewCurrency = 'USD' | 'EUR' | 'GBP'

// ─── Per-page module-level stores ────────────────────────────────────────────
// Each pageKey has its own current value and its own listener set.
// This keeps Dashboard, Trading, Finance and Business completely independent.

const _state:     Record<string, ViewCurrency>    = {}
const _listeners: Record<string, Set<() => void>> = {}

function _storageKey(pageKey: string) { return `view-currency-${pageKey}` }

function _init(pageKey: string, defaultCurrency: ViewCurrency) {
  if (_state[pageKey] !== undefined) return
  try {
    _state[pageKey] = (localStorage.getItem(_storageKey(pageKey)) as ViewCurrency) || defaultCurrency
  } catch {
    _state[pageKey] = defaultCurrency
  }
  _listeners[pageKey] = new Set()
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useViewCurrency(pageKey: string, defaultCurrency: ViewCurrency = 'USD') {
  _init(pageKey, defaultCurrency)

  const [, rerender] = useState(0)

  useEffect(() => {
    const notify = () => rerender(n => n + 1)
    _listeners[pageKey].add(notify)
    return () => { _listeners[pageKey].delete(notify) }
  }, [pageKey])

  const setViewCurrency = (c: ViewCurrency) => {
    _state[pageKey] = c
    try { localStorage.setItem(_storageKey(pageKey), c) } catch {}
    _listeners[pageKey].forEach(fn => fn())
  }

  return { viewCurrency: _state[pageKey] as ViewCurrency, setViewCurrency }
}
