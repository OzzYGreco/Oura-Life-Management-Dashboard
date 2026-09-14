import { useState, useEffect } from 'react'

export interface FinanceSettings {
  includeTrading:          boolean
  includePaidInvoices:     boolean
  showTaxReserve:          boolean
  taxRateTrading:          number
  taxRateBusiness:         number
  taxRateOther:            number
  excludeBusinessExpenses: boolean
  /**
   * Months of running costs the Business tab holds back before calling money
   * safe to draw. It lives here rather than in its own store so there is one
   * place money rules are set.
   */
  businessBufferMonths:    number
}

const DEFAULTS: FinanceSettings = {
  includeTrading:          false,
  includePaidInvoices:     true,
  showTaxReserve:          true,
  taxRateTrading:          30,
  taxRateBusiness:         25,
  taxRateOther:            20,
  excludeBusinessExpenses: true,
  businessBufferMonths:    1,
}

const KEY = 'oura-finance-settings'

// ─── One module-level store, following useViewCurrency ───────────────────────
//
// These settings were previously plain `useState` inside the hook, which gave
// every caller its own private copy. Saving from a settings dialog updated the
// dialog and nothing else: the Finances page reads them in four places and the
// Business page in one, and none of them heard about the change until a reload.

let _state: FinanceSettings | null = null
const _listeners = new Set<() => void>()

function read(): FinanceSettings {
  if (_state) return _state
  let loaded: FinanceSettings = DEFAULTS
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) loaded = { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    loaded = DEFAULTS
  }
  _state = loaded
  return loaded
}

export function useFinanceSettings() {
  const settings = read()
  const [, rerender] = useState(0)

  useEffect(() => {
    const notify = () => rerender(n => n + 1)
    _listeners.add(notify)
    return () => { _listeners.delete(notify) }
  }, [])

  const save = (next: FinanceSettings) => {
    _state = next
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch {}
    _listeners.forEach(fn => fn())
  }

  return { settings, save }
}

/** For non-component callers, such as the query-param builders in useFinances. */
export function loadFinanceSettings(): FinanceSettings {
  return read()
}
