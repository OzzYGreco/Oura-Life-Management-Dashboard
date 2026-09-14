import { useEffect, useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import { Th, Td, THead, Row, MiniBtn, EmptyRow } from '../components/primitives'
import {
  useCampaigns, useCampaignSpend, useLogAdSpend, useDeleteAdSpend,
  useAdSpendStatus, useSyncAdSpend,
} from '../../../hooks/useBusiness'
import { formatDate, today } from '../../../lib/utils'
import type { FmtView } from '../../../hooks/useFmtView'

/**
 * Ad spend, a day at a time.
 *
 * Money leaves the ad account daily, but a campaign only ever held one lifetime
 * total, so keeping it current meant opening the campaign and overwriting that
 * number by hand. This records the day instead, which is both less work and
 * what makes a monthly profit figure true rather than pro-rated.
 *
 * Entering the same day twice corrects it rather than adding to it.
 */
export function AdSpendModal({
  open, onClose, fmtView, campaignId,
}: {
  open: boolean
  onClose: () => void
  fmtView: FmtView
  campaignId?: number | null
}) {
  const { data: campaigns = [] } = useCampaigns()
  const { data: status } = useAdSpendStatus()
  const log = useLogAdSpend()
  const del = useDeleteAdSpend()
  const sync = useSyncAdSpend()

  const [selected, setSelected] = useState<string>('')
  const [date, setDate] = useState(today())
  const [spend, setSpend] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [syncNote, setSyncNote] = useState<string | null>(null)

  const business = (campaigns as any[]).filter(c => c.fundingSource === 'business')

  useEffect(() => {
    if (!open) return
    setSelected(String(campaignId ?? business[0]?.id ?? ''))
    setDate(today())
    setSpend('')
    setError(null)
    setSyncNote(null)
  }, [open, campaignId, campaigns.length])

  const { data: rows = [] } = useCampaignSpend(selected ? Number(selected) : null)
  const campaign = business.find(c => String(c.id) === selected)

  const save = async () => {
    setError(null)
    const value = Number(spend)
    if (!selected || !Number.isFinite(value) || value < 0) {
      setError('Pick a campaign and enter what it spent')
      return
    }
    try {
      await log.mutateAsync({ campaignId: Number(selected), date, spend: value })
      setSpend('')
      // Step to the next day so a week can be caught up without re-picking dates.
      const [y, m, d] = date.split('-').map(Number)
      const next = new Date(y, m - 1, d + 1)
      if (next <= new Date()) {
        setDate(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`)
      }
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not save that')
    }
  }

  const runSync = async () => {
    setSyncNote(null)
    setError(null)
    try {
      const res = await sync.mutateAsync(14)
      setSyncNote(res.results.map((r: any) => `${r.platform}: ${r.message}`).join('  '))
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Sync failed')
    }
  }

  const existing = rows.find((r: any) => r.date === date)

  return (
    <Modal open={open} onClose={onClose} title="Ad spend" size="lg">
      <div className="p-5 space-y-4">
        {/* ── Connection state, said plainly ──────────────────────────── */}
        <div className="rounded-lg px-3.5 py-3 text-[11px] leading-relaxed"
          style={{
            background: status?.connected ? 'rgba(52,211,153,0.08)' : 'var(--c-bg-input)',
            border: `1px solid ${status?.connected ? 'rgba(52,211,153,0.22)' : 'var(--c-border)'}`,
            color: 'var(--c-text-2)',
          }}>
          {status?.connected ? (
            <>
              <b style={{ color: 'var(--c-profit)' }}>Connected to {status.platforms.join(' and ')}.</b>{' '}
              Spend is pulled every day, and the last two weeks are re-pulled each
              time in case the platform restates them.
              {status.latestDate && <> Latest day recorded: <span className="num">{formatDate(status.latestDate)}</span>.</>}
            </>
          ) : (
            <>
              <b style={{ color: 'var(--c-text-1)' }}>Nothing connected yet, so spend is entered by hand below.</b>
              <br />
              To pull it automatically, put a Meta system-user token and ad account id in
              {' '}<span className="num">server/.env</span> as
              {' '}<span className="num">META_ACCESS_TOKEN</span> and
              {' '}<span className="num">META_AD_ACCOUNT_ID</span>, then restart the server.
            </>
          )}
        </div>

        {status?.connected && (
          <div className="flex items-center gap-3 flex-wrap">
            <Button size="sm" variant="secondary" onClick={runSync} disabled={sync.isPending}>
              {sync.isPending ? 'Pulling...' : 'Pull the last 14 days now'}
            </Button>
            {syncNote && <span className="text-[11px]" style={{ color: 'var(--c-text-2)' }}>{syncNote}</span>}
          </div>
        )}

        {/* ── Manual entry ────────────────────────────────────────────── */}
        <div className="grid grid-cols-12 gap-3 items-end">
          <div className="col-span-5">
            <Select id="as-campaign" label="Campaign" value={selected}
              onChange={e => setSelected(e.target.value)}
              options={business.map((c: any) => ({ value: String(c.id), label: c.name }))} />
          </div>
          <div className="col-span-3">
            <Input id="as-date" label="Day" type="date" value={date} max={today()}
              onChange={e => setDate(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Input id="as-spend" label="Spent" type="number" step="0.01" value={spend}
              onChange={e => setSpend(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save() }} />
          </div>
          <div className="col-span-2">
            <Button onClick={save} disabled={log.isPending} className="w-full justify-center">
              {existing ? 'Correct' : 'Add'}
            </Button>
          </div>
        </div>

        {existing && (
          <p className="text-[11px]" style={{ color: '#fcd34d' }}>
            {formatDate(date)} already has <span className="num">{fmtView(existing.spend)}</span> recorded.
            Saving replaces it rather than adding to it.
          </p>
        )}
        {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}

        {/* ── What is already recorded ────────────────────────────────── */}
        {campaign && (
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>
                Recorded for {campaign.name}
              </span>
              <span className="text-[11px] num" style={{ color: 'var(--c-text-2)' }}>
                {rows.length} day{rows.length === 1 ? '' : 's'}
                {' · '}{fmtView(rows.reduce((s: number, r: any) => s + r.spend, 0))}
              </span>
            </div>
            <div className="rounded-xl overflow-hidden max-h-64 overflow-y-auto"
              style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
              <table className="w-full">
                <THead>
                  <Th>Day</Th><Th align="right">Spent</Th><Th align="right">Clicks</Th>
                  <Th>Where from</Th><Th />
                </THead>
                <tbody>
                  {rows.length === 0 ? (
                    <EmptyRow colSpan={5}>
                      Nothing recorded day by day yet, so this campaign's spend is still
                      estimated by spreading its lifetime total across the days it ran.
                    </EmptyRow>
                  ) : rows.map((r: any) => (
                    <Row key={r.id}>
                      <Td mono color="var(--c-text-2)">{formatDate(r.date)}</Td>
                      <Td align="right" mono className="font-semibold">{fmtView(r.spend)}</Td>
                      <Td align="right" mono color="var(--c-text-3)">{r.clicks ?? '--'}</Td>
                      <Td color="var(--c-text-3)">{r.source === 'manual' ? 'typed in' : r.source}</Td>
                      <Td align="right">
                        <MiniBtn tone="danger" onClick={() => del.mutate(r.id)}>Remove</MiniBtn>
                      </Td>
                    </Row>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  )
}
