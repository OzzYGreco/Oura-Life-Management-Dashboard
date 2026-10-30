/**
 * Business-wide settings that the server itself needs (reminders, summaries),
 * kept by key. Owner-pay preferences stay in the browser as before.
 */
import { db } from '../db'
import { businessSettings } from '../db/schema'

export const SETTING_KEYS = ['businessName', 'signOff', 'bankDetails'] as const
export type SettingKey = (typeof SETTING_KEYS)[number]
export type Settings = Record<SettingKey, string>

const DEFAULTS: Settings = { businessName: 'Zavabuild', signOff: '', bankDetails: '' }

export function getSettings(): Settings {
  const rows = db.select().from(businessSettings).all()
  const out = { ...DEFAULTS }
  for (const r of rows) if ((SETTING_KEYS as readonly string[]).includes(r.key)) out[r.key as SettingKey] = r.value ?? ''
  return out
}

export function saveSettings(patch: Partial<Settings>): Settings {
  db.transaction(tx => {
    for (const [key, value] of Object.entries(patch)) {
      if (!(SETTING_KEYS as readonly string[]).includes(key)) continue
      tx.insert(businessSettings).values({ key, value: value ?? '' })
        .onConflictDoUpdate({ target: businessSettings.key, set: { value: value ?? '', updatedAt: new Date().toISOString() } }).run()
    }
  })
  return getSettings()
}
