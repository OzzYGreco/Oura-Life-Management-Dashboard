import { useMemo, useState } from 'react'
import { HEX } from '../../../lib/chartTheme'
import { useUrlState } from '../lib/useUrlState'
import { Search, Plus } from 'lucide-react'
import { Section } from '../../../components/ui/Section'
import { PageLoader } from '../../../components/ui/Spinner'
import { Sparkline } from '../../../components/ui/Sparkline'
import { Question } from '../components/MoneySections'
import { SplitBar, hoverCard, SERIES } from '../components/charts'
import { Th, Td, TablePanel, THead, Row, TotalRow, MiniBtn, EmptyRow } from '../components/primitives'
import { useBusinessMetrics, useClientRows } from '../../../hooks/useBusiness'
import type { ClientRow } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

type SortKey = 'name' | 'mrr' | 'lifetime' | 'costs' | 'marginPct' | 'outstanding' | 'since'

const STATUSES = ['all', 'active', 'lead', 'churned', 'inactive'] as const

export function Clients({
  fmtView, onOpenClient, onNewClient,
}: {
  fmtView: FmtView
  onOpenClient: (id: number) => void
  onNewClient: () => void
}) {
  const { data: rows = [], isPending } = useClientRows()
  // Churn and lifetime: already worked out by the metrics, over the last 12 months.
  const { data: metrics } = useBusinessMetrics()
  const churn = metrics?.churn
  const [q, setQ] = useUrlState('q', '')
  // Clients who left are history, not the working list.
  const [status, setStatus] = useUrlState<(typeof STATUSES)[number]>('status', 'active')
  const [sort, setSort] = useState<SortKey>('mrr')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    const filtered = rows.filter(r =>
      (status === 'all' || r.status === status) &&
      (!term || r.name.toLowerCase().includes(term) || (r.company ?? '').toLowerCase().includes(term)))

    const mul = dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sort === 'name')  return mul * a.name.localeCompare(b.name)
      if (sort === 'since') return mul * (a.since ?? '').localeCompare(b.since ?? '')
      return mul * ((a[sort] as number) - (b[sort] as number)) || b.lifetime - a.lifetime
    })
  }, [rows, q, status, sort, dir])

  const totals = useMemo(() => shown.reduce(
    (acc, r) => ({
      mrr: acc.mrr + r.mrr, lifetime: acc.lifetime + r.lifetime,
      costs: acc.costs + r.costs, outstanding: acc.outstanding + r.outstanding,
      paying: acc.paying + (r.mrr > 0 ? 1 : 0),
    }),
    { mrr: 0, lifetime: 0, costs: 0, outstanding: 0, paying: 0 },
  ), [shown])

  const head = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <Th align={align} sorted={sort === key ? dir : null}
      onClick={() => { if (sort === key) setDir(d => (d === 'asc' ? 'desc' : 'asc')); else { setSort(key); setDir(key === 'name' ? 'asc' : 'desc') } }}>
      {label}
    </Th>
  )

  // Who the monthly income actually rests on, biggest first. Independent of
  // the filters above, because the answer is about the business, not the view.
  const payers = useMemo(() => {
    const paying = rows.filter(r => r.mrr > 0).sort((a, b) => b.mrr - a.mrr)
    const top = paying.slice(0, 7).map((r, i) => ({ key: r.name, value: r.mrr, color: SERIES[i], note: r.company ?? undefined }))
    const rest = paying.slice(7).reduce((s, r) => s + r.mrr, 0)
    const parts = rest > 0 ? [...top, { key: `${paying.length - 7} others`, value: rest, color: 'var(--c-text-3)' }] : top
    const total = paying.reduce((s, r) => s + r.mrr, 0)
    const owing = rows.filter(r => r.outstanding > 0)
    return { parts, total, count: paying.length, topShare: total ? (paying.slice(0, 3).reduce((s, r) => s + r.mrr, 0) / total) * 100 : 0, owing }
  }, [rows])

  if (isPending) return <PageLoader />

  return (
    <div className="space-y-8">
    <Question q="Who pays you?"
      answer={payers.total > 0
        ? <>{payers.count} client{payers.count === 1 ? '' : 's'} pay <b className="num" style={{ color: 'var(--c-accent)' }}>{fmtView(payers.total)}/mo</b>.
          {payers.count > 3 ? <> The top three bring {Math.round(payers.topShare)}% of it.</> : null}
          {payers.owing.length ? <> {payers.owing.length} owe{payers.owing.length === 1 ? 's' : ''} you money.</> : <> Nobody owes you anything.</>}
          {churn && <> {churn.cancelledCount ? `${churn.cancelledCount} retainer${churn.cancelledCount === 1 ? '' : 's'} ended in the last 12 months` : 'No retainer ended in the last 12 months'}
            {churn.logoChurnPct > 0 ? ` (${churn.logoChurnPct.toFixed(1)}% churn, ${churn.revenueChurnPct.toFixed(1)}% of revenue)` : ''}
            {churn.avgLifetimeMonths != null ? `; at that rate a client stays about ${Math.round(churn.avgLifetimeMonths)} months` : ''}.</>}</>
        : 'Nobody pays monthly yet.'}>
      {payers.parts.length > 0 && (
        <div className={`rounded-xl p-4 ${hoverCard}`} style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
          <div className="text-[11px] mb-3" style={{ color: 'var(--c-text-3)' }}>Monthly income, by client</div>
          <SplitBar parts={payers.parts} fmtView={fmtView} />
        </div>
      )}
    </Question>
    <Section
      label="Clients"
      count={`${shown.length}${shown.length !== rows.length ? ` of ${rows.length}` : ''}`}
      action={
        <>
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--c-text-3)' }} />
            <input
              id="client-search"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search clients"
              className="pl-7 pr-2.5 py-1 rounded-md text-[11px] w-44 outline-none"
              style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Status</span>
            {STATUSES.map(s => (
              <MiniBtn key={s} tone={status === s ? 'accent' : 'default'} onClick={() => setStatus(s)}>
                {s === 'all' ? 'Any' : s === 'churned' ? `left (${rows.filter(r => r.status === 'churned').length})` : s}
              </MiniBtn>
            ))}
          </div>
          <MiniBtn tone="accent" onClick={onNewClient}><Plus size={13} aria-hidden />New client</MiniBtn>
        </>
      }
    >
      <TablePanel>
        <table className="w-full">
          <THead>
            {head('name', 'Client', 'left')}
            <Th>Company</Th>
            {head('since', 'Since')}
            {head('mrr', 'MRR')}
            {head('lifetime', 'Lifetime')}
            {head('costs', 'Costs')}
            {head('marginPct', 'Margin')}
            {head('outstanding', 'Open')}
            <Th align="right">12 months</Th>
            <Th />
          </THead>
          <tbody>
            {shown.length === 0 ? (
              <EmptyRow colSpan={10}>
                {rows.length ? 'No client matches that search.' : 'No clients yet.'}
              </EmptyRow>
            ) : shown.map(r => <ClientTableRow key={r.id} r={r} fmtView={fmtView} onOpen={() => onOpenClient(r.id)} />)}
          </tbody>
          {shown.length > 0 && (
            <TotalRow>
              <Td>{shown.length} client{shown.length === 1 ? '' : 's'}</Td>
              <Td color="var(--c-text-2)">{totals.paying} paying monthly</Td>
              <Td />
              <Td align="right" mono color="var(--c-accent)">{fmtView(totals.mrr)}</Td>
              <Td align="right" mono>{fmtView(totals.lifetime)}</Td>
              <Td align="right" mono>{fmtView(totals.costs)}</Td>
              <Td align="right" mono color="var(--c-text-2)">
                {totals.lifetime > 0 ? `${Math.round(((totals.lifetime - totals.costs) / totals.lifetime) * 100)}%` : '--'}
              </Td>
              <Td align="right" mono color={totals.outstanding ? '#f59e0b' : 'var(--c-text-3)'}>
                {totals.outstanding ? fmtView(totals.outstanding) : '--'}
              </Td>
              <Td colSpan={2} />
            </TotalRow>
          )}
        </table>
      </TablePanel>
    </Section>
    </div>
  )
}

function ClientTableRow({ r, fmtView, onOpen }: { r: ClientRow; fmtView: FmtView; onOpen: () => void }) {
  const hasRevenue = r.lifetime > 0
  return (
    <Row onClick={onOpen} dim={r.status === 'churned'}>
      <Td>
        <span className="font-medium">{r.name}</span>
        {r.status === 'churned' && <span className="ml-1.5 text-[10px]" style={{ color: 'var(--c-text-3)' }}>left</span>}
      </Td>
      <Td color="var(--c-text-2)">{r.company ?? '--'}</Td>
      <Td align="right" mono color="var(--c-text-3)">
        {r.since ? new Date(r.since).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : '--'}
      </Td>
      <Td align="right" mono color={r.mrr ? 'var(--c-accent)' : 'var(--c-text-3)'}>
        {r.mrr ? fmtView(r.mrr) : '--'}
      </Td>
      <Td align="right" mono>{hasRevenue ? fmtView(r.lifetime) : '--'}</Td>
      <Td align="right" mono color="var(--c-text-3)">{r.costs ? fmtView(r.costs) : '--'}</Td>
      <Td align="right">
        {hasRevenue ? (
          <span className="num text-[11px] font-semibold px-1.5 py-0.5 rounded inline-block"
            style={r.marginPct >= 50
              ? { background: 'rgba(52,211,153,0.15)', color: 'var(--c-profit)' }
              : { background: 'rgba(248,113,113,0.15)', color: 'var(--c-loss)' }}>
            {r.marginPct.toFixed(0)}%
          </span>
        ) : <span style={{ color: 'var(--c-text-3)' }}>--</span>}
      </Td>
      <Td align="right" mono color={r.outstanding ? '#f59e0b' : 'var(--c-text-3)'}>
        {r.outstanding ? fmtView(r.outstanding) : '--'}
      </Td>
      <Td align="right">
        <div className="w-20 ml-auto">
          <Sparkline points={r.spark} color={r.mrr ? HEX.accent : '#4b4b6b'} height={20} />
        </div>
      </Td>
      <Td align="right"><MiniBtn onClick={onOpen}>Open</MiniBtn></Td>
    </Row>
  )
}
