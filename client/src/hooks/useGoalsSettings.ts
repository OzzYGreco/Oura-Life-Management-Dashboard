import { useState } from 'react'

export interface GoalsSettings {
  maxScores: {
    weekly: number
    monthly: number
    yearly: number
    '3yr': number
  }
  successThresholds: {
    weekly: number
    monthly: number
    yearly: number
    '3yr': number
  }
}

const DEFAULTS: GoalsSettings = {
  maxScores: {
    weekly:  10,
    monthly: 10,
    yearly:  10,
    '3yr':   10,
  },
  successThresholds: {
    weekly:  7,
    monthly: 8,
    yearly:  8,
    '3yr':   9,
  },
}

const KEY = 'oura-goals-settings'

export function useGoalsSettings() {
  const [settings, setSettings] = useState<GoalsSettings>(() => {
    try {
      const s = localStorage.getItem(KEY)
      if (!s) return DEFAULTS
      const parsed = JSON.parse(s)
      return {
        ...DEFAULTS,
        ...parsed,
        maxScores:         { ...DEFAULTS.maxScores,         ...parsed.maxScores },
        successThresholds: { ...DEFAULTS.successThresholds, ...parsed.successThresholds },
      }
    } catch { return DEFAULTS }
  })

  const save = (next: GoalsSettings) => {
    setSettings(next)
    localStorage.setItem(KEY, JSON.stringify(next))
  }

  return { settings, save }
}

export function loadGoalsSettings(): GoalsSettings {
  try {
    const s = localStorage.getItem(KEY)
    if (!s) return DEFAULTS
    const parsed = JSON.parse(s)
    return {
      ...DEFAULTS,
      ...parsed,
      maxScores:         { ...DEFAULTS.maxScores,         ...parsed.maxScores },
      successThresholds: { ...DEFAULTS.successThresholds, ...parsed.successThresholds },
    }
  } catch { return DEFAULTS }
}
