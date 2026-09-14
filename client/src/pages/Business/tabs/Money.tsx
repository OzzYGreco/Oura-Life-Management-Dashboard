import { useMemo, useState } from 'react'
import { Section } from '../../../components/ui/Section'
import { KpiCard } from '../../../components/ui/KpiCard'
import { PageLoader } from '../../../components/ui/Spinner'
import { DateFilter, type Preset, presetRange } from '../../../components/shared/DateFilter'
import { Waterfall } from '../components/Waterfall'
import { RecurringCosts } from '../components/RecurringCosts'
import { OwnerPayPanel } from '../components/OwnerPayPanel'
import {
  Th, Td, TablePanel, THead, Row, TotalRow, MiniBtn, EmptyRow, fmtMonth, fmtHours,
} from '../components/primitives'
import { moneyCell, pillCell } from '../../../lib/chartTheme'
import { useBusinessMetrics, useCampaigns, useProjects, useClients } from '../../../hooks/useBusiness'
import type { OwnerPayOpts } from '../../../hooks/useBusiness'
import { useFinanceExpenses } from '../../../hooks/useFinances'
import { formatDate } from '../../../lib/utils'
import type { FmtView } from '../../../hooks/useFmtView'

const PERIOD_LABEL: Partial<Record<Preset, string>> = {
  '1D': 'today', MTD: 'this month', QTD: 'this quarter', YTD: 'this year',
  '1W': 'in the last 7 days', '1M': 'in the last 30 days', '3M': 'in the last 3 months',
  '6M': 'in the last 6 months', '1Y': 'in the last year', All: 'all time',
}

export function Money({
  fmtView, ownerPayOpts, onRecordDraw, onDeleteDraw, onAddCost, onEditCost, onNewCampaign, onEditCampaign, onSettings, onLogAdSpend,
}: {
  fmtView: FmtView
  ownerPayOpts: OwnerPayOpts
  onRecordDraw: () => void
  onDeleteDraw: (id: number) => void
  onAddCost: () => void
  onEditCost: (expense: any) => void
  onNewCampaign: () => void
  onEditCampaign: (campaign: any) => void
  onSettings: () => void
  onLogAdSpend: (campaignId?: number | null) => void
}) {
  const [preset, setPreset] = useState<Preset>('All')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const range = useMemo(() => (
    preset === 'All' ? {}
      : preset === 'Custom' ? { from: customFrom || undefined, to: customTo || undefined }
      : presetRange(preset) ?? {}
  ), [preset, customFrom, customTo])

  const { data: m, isPending } = useBusinessMetrics(range, ownerPayOpts)
  const { data: campaigns = [] } = useCampaigns()
  const { data: expenses = [] } = useFinanceExpenses({ category: 'Business' })
  const { data: projects = [] } = useProjects()
  const { data: clients = [] } = useClients()

  if (isPending || !m) return <PageLoader />

  const periodLabel = preset === 'Custom' ? 'in the selected range' : (PERIOD_LABEL[preset] ?? 'this period')
  const drawnByMonth = new Map(m.ownerPay.byMonth.map(r => [r.month, r.drawn]))
  const pnlRows = m.pnlByMonth.filter(r => r.netVolume || r.totalCosts || drawnByMonth.get(r.month))
  const bizCampaigns = (campaigns as any[]).filter(c => c.fundingSource === 'business')
  const recentCosts = [...(expenses as any[])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12)

  const totals = pnlRows.reduce((a, r) => ({
    net: a.net + r.netVolume, ads: a.ads + r.adSpend,
    tools: a.tools + r.overheads, client: a.client + r.clientCosts,
    profit: a.profit + r.netProfit, drawn: a.drawn + (drawnByMonth.get(r.month) ?? 0),
  }), { net: 0, ads: 0, tools: 0, client: 0, profit: 0, drawn: 0 })

  return (
    <div className="space-y-8">
      <DateFilter
        preset={preset} onPreset={setPreset}
        customFrom={customFrom} onCustomFrom={setCustomFrom}
        customTo={customTo} onCustomTo={setCustomTo}
      />

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(280px, 360px) 1fr' }}>
        <Section label="Where the money went">
          <Waterfall metrics={m} fmtView={fmtView} />
        </Section>

        <Section label="Month by month">
          <TablePanel>
            <table className="w-full">
              <THead>
                <Th>Month</Th><Th align="right">In</Th><Th align="right">Ads</Th><Th align="right">Tools</Th>
                <Th align="right">Client</Th><Th align="right">Profit</Th><Th align="right">Margin</Th>
                <Th align="right">Drawn</Th><Th align="right">Kept</Th>
              </THead>
              <tbody>
                {pnlRows.length === 0 ? (
                  <EmptyRow colSpan={9}>Nothing in this window.</EmptyRow>
                ) : pnlRows.map(r => {
                  const drawn = drawnByMonth.get(r.month) ?? 0
                  const kept = r.netProfit - drawn
                  return (
                    <Row key={r.month}>
                      <Td mono color="var(--c-text-2)">{fmtMonth(r.month)}</Td>
                      <Td align="right" mono>{r.netVolume ? fmtView(r.netVolume) : '--'}</Td>
                      <Td align="right" mono color="var(--c-text-3)">{r.adSpend ? fmtView(r.adSpend) : '--'}</Td>
                      <Td align="right" mono color="var(--c-text-3)">{r.overheads ? fmtView(r.overheads) : '--'}</Td>
                      <Td align="right" mono color="var(--c-text-3)">{r.clientCosts ? fmtView(r.clientCosts) : '--'}</Td>
                      <Td align="right">
                        <span className="num text-xs font-semibold" style={{ ...moneyCell(r.netProfit), ...pillCell }}>
                          {fmtView(r.netProfit)}
                        </span>
                      </Td>
                      <Td align="right" mono color="var(--c-text-3)">
                        {r.netVolume ? `${r.marginPct.toFixed(0)}%` : '--'}
                      </Td>
                      <Td align="right" mono color={drawn ? 'var(--c-accent)' : 'var(--c-text-3)'}>
                        {drawn ? fmtView(drawn) : '--'}
                      </Td>
                      <Td align="right" mono color={kept >= 0 ? 'var(--c-text-1)' : 'var(--c-loss)'}>
                        {fmtView(kept)}
                      </Td>
                    </Row>
                  )
                })}
              </tbody>
              {pnlRows.length > 0 && (
                <TotalRow>
                  <Td>Total</Td>
                  <Td align="right" mono>{fmtView(totals.net)}</Td>
                  <Td align="right" mono>{fmtView(totals.ads)}</Td>
                  <Td align="right" mono>{fmtView(totals.tools)}</Td>
                  <Td align="right" mono>{fmtView(totals.client)}</Td>
                  <Td align="right" mono color={totals.profit >= 0 ? 'var(--c-profit)' : 'var(--c-loss)'}>
                    {fmtView(totals.profit)}
                  </Td>
                  <Td align="right" mono>{totals.net ? `${Math.round((totals.profit / totals.net) * 100)}%` : '--'}</Td>
                  <Td align="right" mono color="var(--c-accent)">{fmtView(totals.drawn)}</Td>
                  <Td align="right" mono>{fmtView(totals.profit - totals.drawn)}</Td>
                </TotalRow>
              )}
            </table>
          </TablePanel>
        </Section>
      </div>

      <OwnerPayPanel
        ownerPay={m.ownerPay} fmtView={fmtView}
        periodLabel={preset === 'All' ? 'all time' : periodLabel.replace(/^in /, '')}
        onRecordDraw={onRecordDraw} onDeleteDraw={onDeleteDraw} onSettings={onSettings}
      />

      <Section label="Costs" count={fmtView(m.costs.total)}
        action={<MiniBtn tone="accent" onClick={onAddCost}>+ Add cost</MiniBtn>}>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
          <KpiCard label="Ad spend" value={fmtView(m.costs.adSpend)} color="var(--c-loss)"
            sub={m.costs.total ? `${Math.round((m.costs.adSpend / m.costs.total) * 100)}% of all costs` : undefined} />
          <KpiCard label="Tools and overheads" value={fmtView(m.costs.overheads)}
            sub={m.costs.unattributedCount ? `${m.costs.unattributedCount} not tied to a client` : 'all attributed'} />
          <KpiCard label="Client delivery" value={fmtView(m.costs.clientCosts)}
            sub="citations, hosting, domains" />
          <KpiCard label="Cost per client won" value={m.clients.total ? fmtView(m.costs.total / m.clients.total) : '--'}
            sub={`all costs across ${m.clients.total} clients`} />
        </div>

        <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-3)' }}>
          What repeats
        </div>
        <RecurringCosts
          expenses={expenses as any[]}
          clients={clients as { id: number; name: string }[]}
          fmtView={fmtView}
          onEdit={onEditCost}
        />

        <div className="text-[10px] font-semibold uppercase tracking-widest mt-5 mb-2" style={{ color: 'var(--c-text-3)' }}>
          Recent charges
        </div>
        <TablePanel>
          <table className="w-full">
            <THead>
              <Th>Description</Th><Th>Paid to</Th><Th>For</Th><Th align="right">Amount</Th>
              <Th align="right">Date</Th><Th>Type</Th><Th />
            </THead>
            <tbody>
              {recentCosts.length === 0 ? (
                <EmptyRow colSpan={7}>No business costs recorded.</EmptyRow>
              ) : recentCosts.map((e: any) => (
                <Row key={e.id}>
                  <Td>{e.description}</Td>
                  <Td color="var(--c-text-3)">{e.vendor ?? '--'}</Td>
                  <Td color={e.clientId ? 'var(--c-text-2)' : 'var(--c-text-3)'}>
                    {(clients as any[]).find(c => c.id === e.clientId)?.name ?? 'the business'}
                  </Td>
                  <Td align="right" mono color="var(--c-loss)">{fmtView(e.amount)}</Td>
                  <Td align="right" mono color="var(--c-text-3)">{formatDate(e.date)}</Td>
                  <Td color="var(--c-text-3)">
                    {e.isRecurring ? (e.recurringParentId ? `${e.frequency ?? 'recurring'} renewal` : e.frequency ?? 'recurring') : 'one-off'}
                  </Td>
                  <Td align="right"><MiniBtn onClick={() => onEditCost(e)}>Edit</MiniBtn></Td>
                </Row>
              ))}
            </tbody>
          </table>
        </TablePanel>
        <p className="text-[11px] mt-2.5 leading-relaxed" style={{ color: 'var(--c-text-3)' }}>
          Ad spend is pro-rated across each campaign's running days. Charging a campaign's whole
          lifetime spend to every month it touches is what used to make a profitable month read as a loss.
        </p>
      </Section>

      <Section label="Marketing" count={`${bizCampaigns.length} campaign${bizCampaigns.length === 1 ? '' : 's'}`}
        action={
          <>
            <MiniBtn tone="good" onClick={() => onLogAdSpend(null)}>Log ad spend</MiniBtn>
            <MiniBtn tone="accent" onClick={onNewCampaign}>+ New campaign</MiniBtn>
          </>
        }>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
          <KpiCard label="Spent" value={fmtView(m.costs.adSpend)} sub={periodLabel} />
          <KpiCard label="Cost per client" value={m.clients.cac ? fmtView(m.clients.cac) : '--'}
            sub={m.clients.newInRange ? `${m.clients.newInRange} won ${periodLabel}` : 'no clients won in this window'} />
          <KpiCard label="Average client value" value={fmtView(m.clients.ltv)}
            sub="realised margin per client to date" />
          <KpiCard label="Value to cost" value={m.clients.ltvToCac ? `${m.clients.ltvToCac.toFixed(1)}x` : '--'}
            color={(m.clients.ltvToCac ?? 0) >= 3 ? 'var(--c-profit)' : 'var(--c-text-1)'}
            sub="3x or better is healthy" />
        </div>
        <TablePanel>
          <table className="w-full">
            <THead>
              <Th>Campaign</Th><Th>Platform</Th><Th align="right">Budget</Th><Th align="right">Spent</Th>
              <Th align="right">Used</Th><Th align="right">Started</Th><Th>Status</Th><Th />
            </THead>
            <tbody>
              {bizCampaigns.length === 0 ? (
                <EmptyRow colSpan={8}>No business-funded campaigns.</EmptyRow>
              ) : bizCampaigns.map((c: any) => {
                // Measured days win over the hand-maintained lifetime total.
                const spent = c.measuredSpend ?? c.spent ?? 0
                const pct = c.budget > 0 ? Math.min((spent / c.budget) * 100, 100) : 0
                return (
                  <Row key={c.id}>
                    <Td><span className="font-medium">{c.name}</span></Td>
                    <Td color="var(--c-text-2)" className="capitalize">{c.platform}</Td>
                    <Td align="right" mono color="var(--c-text-3)">{fmtView(c.budget)}</Td>
                    <Td align="right" mono color="var(--c-loss)">
                      {fmtView(spent)}
                      {c.spendDays > 0 && (
                        <span className="block text-[10px] font-normal" style={{ color: 'var(--c-text-3)' }}>
                          {c.spendDays} days measured
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      <div className="w-16 ml-auto h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--c-border)' }}>
                        <div className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: pct >= 90 ? 'var(--c-loss)' : pct >= 70 ? '#f59e0b' : 'var(--c-profit)' }} />
                      </div>
                    </Td>
                    <Td align="right" mono color="var(--c-text-3)">{formatDate(c.startDate)}</Td>
                    <Td color="var(--c-text-2)" className="capitalize">{c.status}</Td>
                    <Td align="right">
                      <div className="flex gap-1.5 justify-end">
                        <MiniBtn onClick={() => onLogAdSpend(c.id)}>
                          {c.lastSyncedAt ? 'Spend by day' : 'Log spend'}
                        </MiniBtn>
                        <MiniBtn onClick={() => onEditCampaign(c)}>Edit</MiniBtn>
                      </div>
                    </Td>
                  </Row>
                )
              })}
            </tbody>
          </table>
        </TablePanel>
        {m.clients.bySource.length <= 1 && (
          <p className="text-[11px] mt-2.5 leading-relaxed" style={{ color: 'var(--c-text-3)' }}>
            No client has a recorded source yet, so there is no way to say which campaign won which
            client. Cost per client is ad spend divided by clients won, and nothing here pretends to
            be attribution. The new-work form now asks where a client came from.
          </p>
        )}
      </Section>

      <Section label="Delivery">
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-3">
          <KpiCard label="Websites launched" value={m.work.launchedCount} sub={`${m.work.activeProjects} in progress`} />
          <KpiCard label="Average build" value={m.work.avgBuildDays != null ? `${m.work.avgBuildDays.toFixed(0)} days` : '--'}
            sub={m.work.avgHoursPerBuild != null ? `${fmtHours(m.work.avgHoursPerBuild)} of logged time each` : undefined} />
          <KpiCard label="Effective rate" value={m.work.effectiveRate != null ? `${fmtView(m.work.effectiveRate)}/h` : '--'}
            color="var(--c-profit)" sub={`across ${fmtHours(m.work.totalHours)} logged`} />
          <KpiCard label="On time" value={m.work.onTimePct != null ? `${m.work.onTimePct.toFixed(0)}%` : '--'}
            sub="launched on or before the due date" />
          <KpiCard label="Unbilled work" value={fmtView(m.actions.unbilledTotal)}
            color={m.actions.unbilledTotal ? '#f59e0b' : 'var(--c-profit)'}
            sub={m.actions.unbilledTotal ? `${m.actions.unbilledProjects.length} jobs never invoiced` : 'everything is billed'} />
        </div>

        <TablePanel>
          <table className="w-full">
            <THead>
              <Th>Project</Th><Th align="right">Value</Th><Th align="right">Collected</Th>
              <Th align="right">Unbilled</Th><Th align="right">Hours</Th><Th align="right">Rate</Th><Th>Stage</Th>
            </THead>
            <tbody>
              {(projects as any[]).length === 0 ? (
                <EmptyRow colSpan={7}>No projects.</EmptyRow>
              ) : [...(projects as any[])]
                .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
                .slice(0, 16)
                .map((p: any) => {
                  const collected = m.work.collectedByProject[p.id] ?? 0
                  const hours = m.work.hoursByProject[p.id] ?? 0
                  const unbilled = m.work.unbilledByProject[p.id] ?? 0
                  const rate = hours > 0 ? collected / hours : null
                  return (
                    <Row key={p.id}>
                      <Td><span className="font-medium">{p.name}</span></Td>
                      <Td align="right" mono>{p.value ? fmtView(p.value) : '--'}</Td>
                      <Td align="right" mono color={collected ? 'var(--c-profit)' : 'var(--c-text-3)'}>
                        {collected ? fmtView(collected) : '--'}
                      </Td>
                      <Td align="right" mono color={unbilled ? '#f59e0b' : 'var(--c-text-3)'}>
                        {unbilled ? fmtView(unbilled) : '--'}
                      </Td>
                      <Td align="right" mono color="var(--c-text-3)">{fmtHours(hours)}</Td>
                      <Td align="right" mono color="var(--c-text-2)">{rate ? `${fmtView(rate)}/h` : '--'}</Td>
                      <Td color="var(--c-text-3)" className="capitalize">{p.stage}</Td>
                    </Row>
                  )
                })}
            </tbody>
          </table>
        </TablePanel>
      </Section>
    </div>
  )
}
