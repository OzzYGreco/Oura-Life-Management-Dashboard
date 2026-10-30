import { MiniBtn } from './primitives'
import { formatDate } from '../../../lib/utils'
import type { FmtView } from '../../../hooks/useFmtView'
import type { StaleCampaign } from '../lib/types'

/**
 * Says out loud that the ad spend figure has stopped being fed.
 *
 * A connector that dies is the one failure the rest of this tab cannot show you.
 * Every other number either changes or stays put; ad spend quietly stops
 * growing, which reads as a good month. Days after the last recorded one count
 * as zero rather than being estimated, so a dead sync pushes costs DOWN and net
 * profit UP, further every day.
 *
 * It happened on 13 September 2026. Meta blocked the app, the sync failed with
 * nothing on screen, and September read about GBP 39 more profitable than it
 * was until the terminal happened to be read two days later.
 *
 * So this leads with the direction of the error, not with "sync failed". The
 * estimate is deliberately conservative: it counts only whole missing days and
 * leaves today out, because today is not over.
 */
function shift(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
const nextDay = (date: string) => shift(date, 1)
const yesterday = () => { const t = new Date(); return shift(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`, -1) }

export function AdSpendStale({
  stale, fmtView, onLogAdSpend,
}: {
  stale?: { campaigns: StaleCampaign[]; estimatedMissing: number }
  fmtView: FmtView
  onLogAdSpend: (campaignId?: number | null, range?: { from: string; to: string } | null) => void
}) {
  const rows = stale?.campaigns ?? []
  if (!rows.length) return null

  const worst = rows.reduce((a, b) => (a.missingDays >= b.missingDays ? a : b))

  return (
    <div className="rounded-xl px-4 py-3"
      style={{ background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.26)' }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-[280px]">
          <p className="text-[12.5px] font-semibold" style={{ color: '#fcd34d' }}>
            Ad spend has stopped updating, so profit is reading too high
          </p>
          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--c-text-2)' }}>
            Roughly <b className="num">{fmtView(stale!.estimatedMissing)}</b> of spend is missing, which
            means every profit figure on this page is overstated by about that much. It grows by around{' '}
            <b className="num">{fmtView(rows.reduce((s, c) => s + c.perDay, 0))}</b> a day until the
            connection is back.
          </p>
        </div>
        <span className="flex gap-1.5">
          {/* Switching ads off looks exactly like a broken sync from here, so it
              gets its own button: one click records every quiet day as zero. */}
          <MiniBtn onClick={() => onLogAdSpend(worst.campaignId, { from: nextDay(worst.lastDay), to: yesterday() })}>
            Ads were off
          </MiniBtn>
          <MiniBtn tone="accent" onClick={() => onLogAdSpend(worst.campaignId)}>
            Enter the missing days
          </MiniBtn>
        </span>
      </div>

      <div className="mt-2.5 pt-2.5 space-y-1" style={{ borderTop: '1px solid rgba(245,158,11,0.18)' }}>
        {rows.map(c => (
          <div key={c.campaignId} className="flex items-baseline gap-3 flex-wrap text-[11px]">
            <span className="font-medium" style={{ color: 'var(--c-text-1)' }}>{c.name}</span>
            <span className="capitalize" style={{ color: 'var(--c-text-3)' }}>{c.platform}</span>
            <span style={{ color: 'var(--c-text-3)' }}>
              last figure <span className="num">{formatDate(c.lastDay)}</span>
              {', '}
              <span className="num">{c.missingDays}</span> day{c.missingDays === 1 ? '' : 's'} missing
            </span>
            <span className="num ml-auto" style={{ color: 'var(--c-loss)' }}>
              about {fmtView(c.estimatedMissing)} unrecorded
            </span>
          </div>
        ))}
      </div>

      <p className="text-[10.5px] mt-2 leading-relaxed" style={{ color: 'var(--c-text-3)' }}>
        Estimated from each campaign's last 14 recorded days. Today is left out because it is still
        running. Nothing has been written to your figures, this is only a warning: a successful sync
        backfills the real amounts and this disappears.
      </p>
    </div>
  )
}
