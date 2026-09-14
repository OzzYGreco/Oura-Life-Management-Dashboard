import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Section } from '../../../components/ui/Section'
import { PageLoader } from '../../../components/ui/Spinner'
import { Sparkline } from '../../../components/ui/Sparkline'
import { Th, Td, TablePanel, THead, Row, TotalRow, MiniBtn, EmptyRow } from '../components/primitives'
import { useClientRows } from '../../../hooks/useBusiness'
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
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all')
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

  if (isPending) return <PageLoader />

  return (
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
                {s === 'all' ? 'Any' : s}
              </MiniBtn>
            ))}
          </div>
          <MiniBtn tone="accent" onClick={onNewClient}>+ New client</MiniBtn>
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
  )
}

function ClientTableRow({ r, fmtView, onOpen }: { r: ClientRow; fmtView: FmtView; onOpen: () => void }) {
  const hasRevenue = r.lifetime > 0
  return (
    <Row onClick={onOpen}>
      <Td><span className="font-medium">{r.name}</span></Td>
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
          <Sparkline points={r.spark} color={r.mrr ? '#818cf8' : '#4b4b6b'} height={20} />
        </div>
      </Td>
      <Td align="right"><MiniBtn onClick={onOpen}>Open</MiniBtn></Td>
    </Row>
  )
}
