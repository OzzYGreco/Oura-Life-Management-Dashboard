import { useState } from 'react'

export interface TradingSettings {
  makerFeePercent: number
  takerFeePercent: number
  cryptoMinPosition: number
  stocksLotSize: number
  futuresTickValue: number
}

const DEFAULTS: TradingSettings = {
  makerFeePercent: 0.02,
  takerFeePercent: 0.05,
  cryptoMinPosition: 0.001,
  stocksLotSize: 1,
  futuresTickValue: 50,
}

const KEY = 'oura-trading-settings'

export function useTradingSettings() {
  const [settings, setSettings] = useState<TradingSettings>(() => {
    try {
      const stored = localStorage.getItem(KEY)
      return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : DEFAULTS
    } catch {
      return DEFAULTS
    }
  })

  const save = (next: TradingSettings) => {
    setSettings(next)
    localStorage.setItem(KEY, JSON.stringify(next))
  }

  return { settings, save }
}

export function loadTradingSettings(): TradingSettings {
  try {
    const stored = localStorage.getItem(KEY)
    return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function computeFees(
  settings: TradingSettings,
  entryPrice: number,
  exitPrice: number,
  size: number,
  entryOrderType: string,
  exitOrderType: string,
) {
  const entryFeeRate = entryOrderType === 'Limit' ? settings.makerFeePercent : settings.takerFeePercent
  const exitFeeRate  = exitOrderType  === 'Limit' ? settings.makerFeePercent : settings.takerFeePercent

  const entryFee = (entryPrice * size * entryFeeRate) / 100
  const exitFee  = (exitPrice  * size * exitFeeRate)  / 100

  return { entryFee, exitFee }
}
