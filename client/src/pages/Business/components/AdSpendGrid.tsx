import { useMemo, useState } from 'react'
import { useCampaignSpend, useLogAdSpendRange, useSaveCampaign } from '../../../hooks/useBusiness'
import { MiniBtn, fmtMonth } from './primitives'
import { today } from '../../../lib/utils'
import type { FmtView } from '../../../hooks/useFmtView'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The last N month keys, oldest first, ending this month. */
function lastMonths(n: number): string[] {
  const now = new Date()
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  })
}
const monthEnd = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  return `${key}-${pad(new Date(y, m, 0).getDate())}`
}
const addDay = (d: string, n: number) => {
  const [y, m, dd] = d.split('-').map(Number)
  return iso(new Date(y, m - 1, dd + n))
}

/**
 * Ad spend as a grid: one row per campaign, one cell per month.
 *
 * Each cell says where its number came from: Meta, typed in, or estimated (the
 * months before day-by-day recording began, spread from the lifetime total).
 * Clicking a cell opens that month's days to fill or correct. "Ads off" on a
 * row is the switch for when ads are paused: it records nothing spent from the
 * chosen day and pauses the campaign, in one go.
 */
export function AdSpendGrid({
  campaigns, fmtView, onEditDays,
}: {
  campaigns: any[]
  fmtView: FmtView
  onEditDays: (campaignId: number, range: { from: string; to: string }) => void
}) {
  const months = useMemo(() => lastMonths(6), [])
  const live = campaigns.filter(c => c.fundingSource === 'business')
  if (!live.length) return null

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ background: 'var(--c-bg-input)', borderBottom: '1px solid var(--c-border)' }}>
              <th className="px-3 py-2 text-left text-[9.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Campaign</th>
              {months.map(m => (
                <th key={m} className="px-3 py-2 text-right text-[9.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
                  {fmtMonth(m)}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {live.map(c => <CampaignRow key={c.id} c={c} months={months} fmtView={fmtView} onEditDays={onEditDays} />)}
          </tbody>
        </table>
      </div>
      <p className="text-[10.5px] px-3 py-2" style={{ color: 'var(--c-text-3)', borderTop: '1px solid var(--c-border)' }}>
        Click a month to fill in or correct its days. Days after recording began with nothing on them count as nothing spent.
      </p>
    </div>
  )
}

function CampaignRow({ c, months, fmtView, onEditDays }: {
  c: any; months: string[]; fmtView: FmtView
  onEditDays: (campaignId: number, range: { from: string; to: string }) => void
}) {
  const { data: days = [] } = useCampaignSpend(c.id)
  const logRange = useLogAdSpendRange()
  const saveCampaign = useSaveCampaign()
  const [offFrom, setOffFrom] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const firstRecorded = days.length ? days.map((d: any) => d.date).sort()[0] : null
  const lastRecorded = days.length ? days.map((d: any) => d.date).sort().at(-1) : null
  const paused = c.status !== 'active'

  const cellFor = (key: string) => {
    const rows = days.filter((d: any) => d.date.startsWith(key))
    const sum = rows.reduce((s: number, d: any) => s + d.spend, 0)
    const started = c.startDate <= monthEnd(key) && (!c.endDate || c.endDate >= `${key}-01`)
    const sources = new Set(rows.map((d: any) => (d.source === 'manual' ? 'typed in' : 'Meta')))
    const estimated = !rows.length && started && (!firstRecorded || `${key}-01` < firstRecorded) && (c.spent ?? 0) > 0
    return { sum, started, source: [...sources].join(' + '), estimated, count: rows.length }
  }

  const turnOff = async () => {
    if (!offFrom) return
    setError(null)
    try {
      const yesterday = addDay(today(), -1)
      if (offFrom <= yesterday) {
        await logRange.mutateAsync({ campaignId: c.id, from: offFrom, to: yesterday, perDay: 0 })
      }
      await saveCampaign.mutateAsync({ id: c.id, status: 'paused' })
      setOffFrom(null)
    } catch (e: any) { setError(e?.response?.data?.error ?? 'Could not save that') }
  }

  return (
    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
      <td className="px-3 py-2 text-xs">
        <span className="font-medium" style={{ color: 'var(--c-text-1)' }}>{c.name}</span>
        <span className="block text-[10.5px] capitalize" style={{ color: paused ? '#f59e0b' : 'var(--c-text-3)' }}>
          {c.platform} · {paused ? 'off' : 'running'}
        </span>
      </td>
      {months.map(key => {
        const x = cellFor(key)
        const to = monthEnd(key) < today() ? monthEnd(key) : today()
        return (
          <td key={key} className="px-1 py-1 text-right">
            {x.started && `${key}-01` <= today() ? (
              <button type="button" onClick={() => onEditDays(c.id, { from: `${key}-01` < c.startDate ? c.startDate : `${key}-01`, to })}
                className="w-full rounded-md px-2 py-1 text-right hover:bg-white/5"
                title={x.count ? `${x.count} days recorded (${x.source}). Click to fill or correct.` : 'Click to enter this month'}>
                <span className="block text-xs num font-semibold" style={{ color: x.sum || x.count ? 'var(--c-text-1)' : 'var(--c-text-3)' }}>
                  {x.count ? fmtView(x.sum) : x.estimated ? 'est.' : '--'}
                </span>
                <span className="block text-[9.5px]" style={{ color: 'var(--c-text-3)' }}>
                  {x.count ? x.source : x.estimated ? 'from total' : 'nothing'}
                </span>
              </button>
            ) : <span className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>{' '}</span>}
          </td>
        )
      })}
      <td className="px-3 py-2 text-right whitespace-nowrap">
        {paused ? (
          <MiniBtn tone="good" disabled={saveCampaign.isPending}
            onClick={() => saveCampaign.mutate({ id: c.id, status: 'active' })}>Ads back on</MiniBtn>
        ) : offFrom != null ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-[11px]" style={{ color: 'var(--c-text-2)' }}>Off from</span>
            <input type="date" value={offFrom} max={today()} onChange={e => setOffFrom(e.target.value)}
              className="rounded px-1.5 py-0.5 text-[11px] num outline-none"
              style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }} />
            <MiniBtn tone="warn" onClick={turnOff} disabled={logRange.isPending || saveCampaign.isPending}>Turn off</MiniBtn>
            <MiniBtn onClick={() => setOffFrom(null)}>Cancel</MiniBtn>
          </span>
        ) : (
          <MiniBtn tone="warn" onClick={() => setOffFrom(lastRecorded ? addDay(lastRecorded, 1) : today())}
            title="Record nothing spent from a day, and pause the campaign">Ads off</MiniBtn>
        )}
        {error && <span className="block text-[10.5px] mt-1" style={{ color: 'var(--c-loss)' }}>{error}</span>}
      </td>
    </tr>
  )
}
