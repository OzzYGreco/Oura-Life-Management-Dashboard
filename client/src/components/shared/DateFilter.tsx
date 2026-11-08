// Shared date-range filter bar used in Analytics and Trade Log

export type Preset = '1D' | '1W' | '2W' | 'MTD' | 'QTD' | 'YTD' | '1M' | '3M' | '6M' | '1Y' | 'All' | 'Custom'

export const PRESETS: { key: Preset; label: string }[] = [
  { key: '1D',     label: 'Today'    },
  { key: '1W',     label: '1 Week'   },
  { key: '2W',     label: '2 Weeks'  },
  { key: '1M',     label: '1 Month'  },
  { key: '3M',     label: '3 Months' },
  { key: '6M',     label: '6 Months' },
  { key: '1Y',     label: '1 Year'   },
  { key: 'MTD',    label: 'MTD'      },
  { key: 'QTD',    label: 'QTD'      },
  { key: 'YTD',    label: 'YTD'      },
  { key: 'All',    label: 'All time' },
  { key: 'Custom', label: 'Custom'   },
]

const PRESET_DAYS: Partial<Record<Preset, number>> = {
  '1W': 7, '2W': 14, '1M': 30, '3M': 90, '6M': 180, '1Y': 365,
}

export function presetRange(preset: Preset): { from: string; to: string } | null {
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const today = new Date()
  if (preset === '1D') {
    const t = fmt(today)
    return { from: t, to: t }
  }
  if (preset === 'MTD') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1)
    return { from: fmt(from), to: fmt(today) }
  }
  if (preset === 'QTD') {
    const q = Math.floor(today.getMonth() / 3)
    const from = new Date(today.getFullYear(), q * 3, 1)
    return { from: fmt(from), to: fmt(today) }
  }
  if (preset === 'YTD') {
    const from = new Date(today.getFullYear(), 0, 1)
    return { from: fmt(from), to: fmt(today) }
  }
  const days = PRESET_DAYS[preset]
  if (!days) return null
  const to   = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { from: fmt(from), to: fmt(to) }
}

/** Filter an array of objects that have a `date: string` (YYYY-MM-DD) field */
export function applyDateFilter<T extends { date: string }>(
  items: T[],
  preset: Preset,
  customFrom: string,
  customTo: string,
): T[] {
  if (preset === 'All') return items
  if (preset === 'Custom') {
    return items.filter(t =>
      (!customFrom || t.date >= customFrom) &&
      (!customTo   || t.date <= customTo)
    )
  }
  const range = presetRange(preset)
  if (!range) return items
  return items.filter(t => t.date >= range.from && t.date <= range.to)
}

interface DateFilterProps {
  preset: Preset
  onPreset: (p: Preset) => void
  customFrom: string
  customTo: string
  onCustomFrom: (v: string) => void
  onCustomTo: (v: string) => void
}

export function DateFilter({
  preset, onPreset, customFrom, customTo, onCustomFrom, onCustomTo,
}: DateFilterProps) {
  return (
    <div className="bz-dates">
      <div className="tr-seg sm">
        {PRESETS.map(p => <button key={p.key} type="button" className={preset === p.key ? 'on' : ''} aria-pressed={preset === p.key} onClick={() => onPreset(p.key)}>{p.label}</button>)}
      </div>
      {preset === 'Custom' && (
        <span className="bz-custom">
          <input type="date" value={customFrom} onChange={e => onCustomFrom(e.target.value)} aria-label="From" />
          <span>to</span>
          <input type="date" value={customTo} onChange={e => onCustomTo(e.target.value)} aria-label="To" />
        </span>
      )}
    </div>
  )
}
