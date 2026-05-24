/**
 * Returns the current date as YYYY-MM-DD using the **local** system clock,
 * not UTC. This is a local-only app — the server runs on the same machine as
 * the browser, so local time is always correct and matches what the user sees.
 *
 * Using `new Date().toISOString()` returns the UTC date, which is wrong for
 * users east of UTC (e.g. at 00:30 in UTC+3, UTC is still the previous day).
 */
export function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Converts a Date object to a YYYY-MM-DD string using local time.
 * Use this instead of `d.toISOString().split('T')[0]` when the date
 * represents a calendar day in the user's timezone.
 */
export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
