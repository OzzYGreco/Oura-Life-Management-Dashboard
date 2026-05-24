import { useEffect } from 'react'
import { api } from '../lib/api'
import { today } from '../lib/utils'

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface NotifSettings {
  enabled: boolean
  /** Minutes before the item's scheduled time to fire the alert. 0 = at time. */
  advanceMinutes: number
}

const SETTINGS_KEY = 'checklist-notif-settings'
const DEFAULTS: NotifSettings = { enabled: false, advanceMinutes: 5 }

export function loadNotifSettings(): NotifSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULTS }
}

export function saveNotifSettings(s: NotifSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

// ─── Time parser ───────────────────────────────────────────────────────────────
// Handles "14:30PM" (24h + redundant suffix), "09:15AM", "9:15 AM", "14:30"

export function parseItemTime(timeStr: string): Date | null {
  if (!timeStr) return null
  const match = timeStr.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i)
  if (!match) return null
  let h = parseInt(match[1])
  const m = parseInt(match[2])
  const period = match[3]?.toUpperCase()
  // Only apply 12h correction when the hour is genuinely < 12 (per CLAUDE.md)
  if (period === 'PM' && h < 12) h += 12
  if (period === 'AM' && h === 12) h = 0
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d
}

// ─── Notification chime ───────────────────────────────────────────────────────
// Two-tone bell generated via Web Audio API — no audio file required.
function playChime() {
  try {
    const ctx = new AudioContext()
    const ping = (freq: number, startTime: number) => {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, startTime)
      gain.gain.setValueAtTime(0, startTime)
      gain.gain.linearRampToValueAtTime(0.25, startTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.6)
      osc.start(startTime)
      osc.stop(startTime + 0.6)
    }
    ping(880,  ctx.currentTime)         // A5
    ping(1109, ctx.currentTime + 0.18)  // C#6 — major third above
    setTimeout(() => ctx.close(), 1500)
  } catch { /* AudioContext blocked or unsupported */ }
}

// ─── Session-level dedup set ───────────────────────────────────────────────────
// Keys: "YYYY-MM-DD:entryItemId:advanceMinutes"
const fired = new Set<string>()

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useChecklistNotifications() {
  useEffect(() => {
    const check = async () => {
      const settings = loadNotifSettings()
      if (!settings.enabled) return
      if (typeof Notification === 'undefined') return
      if (Notification.permission !== 'granted') return

      const dateStr = today()
      let entries: any[]
      try {
        const res = await api.get('/api/checklists/entries', { params: { date: dateStr } })
        entries = res.data
      } catch {
        return
      }

      const now = Date.now()

      for (const entry of entries) {
        for (const item of (entry.items ?? [])) {
          // Skip completed or archived
          if (item.completed || item.archived) continue
          const timeStr: string | null = item.time
          if (!timeStr) continue

          const itemTime = parseItemTime(timeStr)
          if (!itemTime) continue

          const fireAt = itemTime.getTime() - settings.advanceMinutes * 60_000
          // Fire within a 2-minute window so we don't miss a tick
          if (now < fireAt || now >= fireAt + 120_000) continue

          const key = `${dateStr}:${item.id}:${settings.advanceMinutes}`
          if (fired.has(key)) continue
          fired.add(key)

          const title = item.label || 'Checklist item'
          const body = settings.advanceMinutes > 0
            ? `Due in ${settings.advanceMinutes} min (${timeStr})`
            : `Due now (${timeStr})`

          try {
            new Notification(title, { body, tag: key })
            playChime()
          } catch { /* safari may throw */ }
        }
      }
    }

    check()
    const timer = setInterval(check, 60_000)
    return () => clearInterval(timer)
  }, []) // mounts once; reads fresh settings on every tick
}
