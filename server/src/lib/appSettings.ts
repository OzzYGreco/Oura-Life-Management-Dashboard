import { eq } from 'drizzle-orm'
import { db } from '../db'
import { appSettings } from '../db/schema'

/** App-wide settings with their defaults. Stored as text in `app_settings`. */
export const APP_DEFAULTS = {
  skin: 'next',                         // next (the new layout) | whoop | linear | revolut | things
  notifications: 'on',                  // on | off
  reviewTime: '01:30',                  // when the evening review prompt fires
  quietFrom: '',                        // HH:MM, empty = no quiet hours
  quietTo: '',
  appUrl: 'http://localhost:3001',      // what a notification opens
  navLayout: 'auto',                    // auto (the skin's own) | vertical | horizontal
  navOrder: '',                         // comma-separated tab keys, in the owner's order
  navHidden: '',                        // comma-separated tab keys the owner has hidden
  avatar: '',                           // /uploads/profile/<file>: the owner's picture, on the app and on shared scorecards
  alertLeadMin: '0',                    // reminders fire this many minutes before a window opens (0, 5, 10, 15, 30)
  // Goal settings per horizon, as JSON: max score, success threshold, default points for a new task.
  goalsSettings: JSON.stringify({
    weekly:  { max: 10, threshold: 7, defaultPoints: 1 },
    monthly: { max: 10, threshold: 8, defaultPoints: 1 },
    yearly:  { max: 10, threshold: 8, defaultPoints: 1 },
    '3yr':   { max: 10, threshold: 9, defaultPoints: 1 },
  }),
} as const

export type AppSettingKey = keyof typeof APP_DEFAULTS
export type AppSettings = { [K in AppSettingKey]: string }

export async function getAppSettings(): Promise<AppSettings> {
  const rows = await db.select().from(appSettings)
  const out = { ...APP_DEFAULTS } as AppSettings
  for (const r of rows) if (r.key in APP_DEFAULTS) out[r.key as AppSettingKey] = r.value
  return out
}

export async function setAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in APP_DEFAULTS) || typeof value !== 'string') continue
    const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, key))
    if (existing) await db.update(appSettings).set({ value, updatedAt: new Date().toISOString() }).where(eq(appSettings.key, key))
    else await db.insert(appSettings).values({ key, value })
  }
  return getAppSettings()
}
