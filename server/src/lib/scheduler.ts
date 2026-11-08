/**
 * The daily loop's clock, running inside the server every minute:
 * - creates today's routine items (no more days that don't exist),
 * - closes past days that were never reviewed, scoring them as they stand,
 * - notifies when an item's window opens, or `alertLeadMin` minutes before,
 * - prompts the evening review.
 * Notifications are keyed, so a restart never repeats one and a window that
 * opened while the Mac slept is announced once on wake if it's still open.
 */
import { dayKey, dayState, ensureDay, ensureWeek, autoCloseOpenDays, parseClock, minutesInto, hhmm, DAY_START_MIN } from './day'
import { getAppSettings } from './appSettings'
import { notifyOnce } from './notify'

const TICK_MS = 60_000

function inQuietHours(nowClock: number, from: string, to: string) {
  const f = parseClock(from), t = parseClock(to)
  if (f == null || t == null || f === t) return false
  return f < t ? nowClock >= f && nowClock < t : nowClock >= f || nowClock < t
}

let running = false

export async function tick(at = new Date()) {
  if (running) return
  running = true
  try {
    const date = dayKey(at)
    await ensureDay(date)
    await ensureWeek(date)
    await autoCloseOpenDays()

    const settings = await getAppSettings()
    if (settings.notifications !== 'on') return
    const clock = at.getHours() * 60 + at.getMinutes()
    if (inQuietHours(clock, settings.quietFrom, settings.quietTo)) return

    const state = await dayState(date)
    if (state.closed) return
    const now = minutesInto(date, at)

    // One alert per item: at its window's start minus the lead time, or on
    // wake if the window is still open. Same key either way, so never twice.
    const lead = [0, 5, 10, 15, 30].includes(Number(settings.alertLeadMin)) ? Number(settings.alertLeadMin) : 0
    for (const item of state.items) {
      if (item.start == null || item.end == null) continue
      if (item.status !== 'open' && item.status !== 'upcoming') continue
      if (now < item.start - lead || now > item.end) continue
      const before = item.start - now
      await notifyOnce({
        key: `open:${date}:${item.id}`,
        title: before > 0 ? `${item.label} opens in ${before} min` : `${item.label} is open`,
        body: before > 0
          ? `At ${hhmm(item.start)}, until ${hhmm(item.end)}. On time earns +${item.points}.`
          : `Until ${hhmm(item.end)} (${item.end - now} min). On time earns +${item.points}.`,
        url: `${settings.appUrl}/?item=${item.id}`,
      })
    }

    // The review prompt, at the review time on the 04:00-04:00 day.
    const review = parseClock(settings.reviewTime)
    if (review != null) {
      const reviewAt = review < DAY_START_MIN ? review + 1440 : review
      if (now >= reviewAt) {
        const missed = state.items.filter(i => i.status === 'overdue' || i.status === 'missed').length
        await notifyOnce({
          key: `review:${date}`,
          title: 'Close the day',
          body: `Score ${state.score ?? 0}. ${missed ? `${missed} missed: give each a reason, ` : 'Nothing missed. '}one line on today, and it's locked.`,
          url: `${settings.appUrl}/?review=1`,
        })
      }
    }
  } catch (e) {
    console.error('[scheduler]', e)
  } finally {
    running = false
  }
}

export function startDayScheduler() {
  tick()
  setInterval(() => tick(), TICK_MS)
}
