/** Date arithmetic shared by the retainer materializer and the deal builder. */

/** Add n months to a YYYY-MM-DD string, clamping to end-of-month. */
export function addMonths(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const targetYear  = y + Math.floor((m - 1 + n) / 12)
  const targetMonth = ((m - 1 + n) % 12 + 12) % 12 + 1
  const maxDay      = new Date(targetYear, targetMonth, 0).getDate()
  const targetDay   = Math.min(d, maxDay)
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export function advance(dateStr: string, frequency: string): string {
  switch (frequency) {
    case 'weekly':    return addDays(dateStr, 7)
    case 'quarterly': return addMonths(dateStr, 3)
    case 'yearly':    return addMonths(dateStr, 12)
    default:          return addMonths(dateStr, 1)
  }
}
