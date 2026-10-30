import { useMemo } from 'react'
import { useUrlState } from '../lib/useUrlState'
import { KpiCard } from '../../../components/ui/KpiCard'
import { PageLoader } from '../../../components/ui/Spinner'
import { DateFilter, type Preset, presetRange } from '../../../components/shared/DateFilter'
import { Waterfall } from '../components/Waterfall'
import { OwnerPayPanel } from '../components/OwnerPayPanel'
import { AdSpendStale } from '../components/AdSpendStale'
import { Profitable, WhatWeCanTake, WhereItGoes, Fold, AdSpendBars } from '../components/MoneySections'
import { CostsSheet } from '../components/CostsSheet'
import { AdSpendGrid } from '../components/AdSpendGrid'
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
  fmtView, ownerPayOpts, onRecordDraw, onDeleteDraw, onEditCost, onNewCampaign, onEditCampaign, onSettings, onLogAdSpend,
}: {
  fmtView: FmtView
  ownerPayOpts: OwnerPayOpts
  onRecordDraw: () => void
  onDeleteDraw: (id: number) => void
  onEditCost: (expense: any) => void
  onNewCampaign: () => void
  onEditCampaign: (campaign: any) => void
  onSettings: () => void
  onLogAdSpend: (campaignId?: number | null, range?: { from: string; to: string; fill?: boolean } | null) => void
}) {
  const [preset, setPreset] = useUrlState<Preset>('range', 'All')
  const [customFrom, setCustomFrom] = useUrlState('from', '')
  const [customTo, setCustomTo] = useUrlState('to', '')

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

      <AdSpendStale stale={m.adStale} fmtView={fmtView} onLogAdSpend={onLogAdSpend} />

      {/* The three questions, in the order they get asked. */}
      <Profitable m={m} fmtView={fmtView} periodLabel={periodLabel} />

      <WhatWeCanTake op={m.ownerPay} fmtView={fmtView} periodLabel={periodLabel}
        onRecordDraw={onRecordDraw} onDeleteDraw={onDeleteDraw} onSettings={onSettings} />
      {(m.ownerPay.owedBack?.length ?? 0) > 0 && (
        <p className="-mt-4 rounded-lg px-3 py-2 text-[11.5px]"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: 'var(--c-text-2)' }}>
          Owed back to partners for costs they paid personally:{' '}
          {m.ownerPay.owedBack!.map(o => `${o.name.split(' ')[0]} ${fmtView(o.amount)}`).join(', ')}.
          {' '}It is a repayment, not a draw, and is cleared from "Needs you" once paid.
        </p>
      )}

      <WhereItGoes m={m} expenses={expenses as any[]} campaigns={campaigns as any[]}
        fmtView={fmtView} periodLabel={periodLabel} range={range} />

      {/* Everything else, closed until asked for, each saying its answer while shut. */}
      <div className="space-y-2.5">
        <Fold id="costs" title="Costs"
          summary={`${fmtView(m.costs.total)} ${periodLabel} · ${(expenses as any[]).filter((e: any) => e.isRecurring && !e.recurringParentId).length} repeating · type in a row to add one`}>
          <CostsSheet expenses={expenses as any[]} clients={clients as { id: number; name: string }[]} owners={m.ownerPay.owners}
            fmtView={fmtView} onOpenFull={onEditCost} />
        </Fold>

        <Fold id="marketing" title="Marketing"
          summary={`${fmtView(m.costs.adSpend)} on ads ${periodLabel} · ${m.clients.cac ? `${fmtView(m.clients.cac)} per client won` : 'no clients won in this window'}`}
          action={<>
            <MiniBtn tone="good" onClick={() => onLogAdSpend(null)}>Log ad spend</MiniBtn>
            <MiniBtn tone="accent" onClick={onNewCampaign}>+ New campaign</MiniBtn>
          </>}>
          <div className="mb-3"><AdSpendBars m={m} fmtView={fmtView} /></div>
          <div className="mb-3">
            <AdSpendGrid campaigns={campaigns as any[]} fmtView={fmtView}
              onEditDays={(campaignId, r) => onLogAdSpend(campaignId, { ...r, fill: true })} />
          </div>
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
        </Fold>

        <Fold id="months" title="Month by month"
          summary={`${pnlRows.length} months · ${fmtView(totals.profit)} profit · ${fmtView(totals.drawn)} drawn`}>
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
        </Fold>

        <Fold id="ownerpay" title="Owner pay, every figure"
          summary={`${fmtView(m.ownerPay.drawnAllTime)} taken all time · ${fmtView(m.ownerPay.retained)} kept in the business`}>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(280px, 360px) 1fr' }}>
            <Waterfall metrics={m} fmtView={fmtView} />
            <OwnerPayPanel
              ownerPay={m.ownerPay} fmtView={fmtView}
              periodLabel={preset === 'All' ? 'all time' : periodLabel.replace(/^in /, '')}
              onRecordDraw={onRecordDraw} onDeleteDraw={onDeleteDraw} onSettings={onSettings}
            />
          </div>
        </Fold>

        <Fold id="delivery" title="Delivery"
          summary={`${m.work.launchedCount} websites launched · ${m.work.activeProjects} in progress${m.work.effectiveRate != null ? ` · ${fmtView(m.work.effectiveRate)}/h` : ''}`}>
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
        </Fold>
      </div>
    </div>
  )
}
