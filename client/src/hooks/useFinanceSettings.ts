import { useState } from 'react'

export interface FinanceSettings {
  includeTrading:          boolean
  includePaidInvoices:     boolean
  showTaxReserve:          boolean
  taxRateTrading:          number
  taxRateBusiness:         number
  taxRateOther:            number
  excludeBusinessExpenses: boolean
}

const DEFAULTS: FinanceSettings = {
  includeTrading:          false,
  includePaidInvoices:     true,
  showTaxReserve:          true,
  taxRateTrading:          30,
  taxRateBusiness:         25,
  taxRateOther:            20,
  excludeBusinessExpenses: true,
}

const KEY = 'oura-finance-settings'

export function useFinanceSettings() {
  const [settings, setSettings] = useState<FinanceSettings>(() => {
    try {
      const s = localStorage.getItem(KEY)
      return s ? { ...DEFAULTS, ...JSON.parse(s) } : DEFAULTS
    } catch { return DEFAULTS }
  })

  const save = (next: FinanceSettings) => {
    setSettings(next)
    localStorage.setItem(KEY, JSON.stringify(next))
  }

  return { settings, save }
}

export function loadFinanceSettings(): FinanceSettings {
  try {
    const s = localStorage.getItem(KEY)
    return s ? { ...DEFAULTS, ...JSON.parse(s) } : DEFAULTS
  } catch { return DEFAULTS }
}
