import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUrlState } from '../lib/useUrlState'
import { Section } from '../../../components/ui/Section'
import { KpiCard } from '../../../components/ui/KpiCard'
import { PageLoader } from '../../../components/ui/Spinner'
import { DateFilter, type Preset, presetRange } from '../../../components/shared/DateFilter'
import { MoneyInChart } from '../components/MoneyInChart'
import { Question } from '../components/MoneySections'
import { hoverCard } from '../components/charts'
import { NeedsYou, type DismissHow } from '../components/NeedsYou'
import { PaymentsToAssign } from '../components/PaymentsToAssign'
import { MiniBtn, Pill, fmtHours } from '../components/primitives'
import { useIsNext } from '../../../skins/isNext'
import { AtAGlance } from '../components/AtAGlance'
import { Sparkline } from '../../../components/ui/Sparkline'
import {
  useBusinessMetrics, useNeeds, useActiveProjects, usePayInvoice, useUnpayInvoice, useSendInvoice, useVoidInvoice,
  useSaveProject, useHoldInvoice, useSettleInvoice, useSaveCost, useDismissFailedCharges,
} from '../../../hooks/useBusiness'
import type { OwnerPayOpts } from '../../../hooks/useBusiness'
import { formatDate } from '../../../lib/utils'
import { STAGES } from '../lib/types'
import type { NeedRow } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

const DISMISSED_KEY = 'oura.business.dismissedNeeds'

const PERIOD_LABEL: Partial<Record<Preset, string>> = {
  '1D': 'today', MTD: 'this month', QTD: 'this quarter', YTD: 'this year',
  '1W': 'last 7 days', '2W': 'last 14 days', '1M': 'last 30 days',
  '3M': 'last 3 months', '6M': 'last 6 months', '1Y': 'last year', All: 'all time',
}

export function Overview({
  fmtView, ownerPayOpts, onOpenClient, onOpenStats, onInvoiceProject, onSetUpRetainer, onAssignCost,
}: {
  fmtView: FmtView
  ownerPayOpts: OwnerPayOpts
  onOpenClient: (id: number) => void
  onOpenStats: () => void
  onInvoiceProject: (projectId: number) => void
  onSetUpRetainer: (clientId: number, amount: number) => void
  onAssignCost: (expenseId: number) => void
}) {
  const [preset, setPreset] = useUrlState<Preset>('range', 'MTD')
  const [customFrom, setCustomFrom] = useUrlState('from', '')
  const [customTo, setCustomTo] = useUrlState('to', '')

  const range = useMemo(() => (
    preset === 'All' ? {}
      : preset === 'Custom' ? { from: customFrom || undefined, to: customTo || undefined }
      : presetRange(preset) ?? {}
  ), [preset, customFrom, customTo])

  const { data: m, isPending } = useBusinessMetrics(range, ownerPayOpts)
  // Safe to draw is a running balance, so the figure to act on is all time, whatever the range.
  const { data: allTime } = useBusinessMetrics({}, ownerPayOpts)
  const { data: allNeeds = [] } = useNeeds()
  const navigate = useNavigate()
  const saveProject = useSaveProject()
  // "Not needed" on a row with no record to change (a fee spotted in notes, a
  // cost that only looks like a client's) is remembered here, per browser.
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') } catch { return [] }
  })
  const needs = allNeeds.filter(r => !dismissed.includes(r.key))
  const { data: builds = [] } = useActiveProjects()

  const payInvoice = usePayInvoice()
  const unpay = useUnpayInvoice()
  const send = useSendInvoice()
  const voidInvoice = useVoidInvoice()
  const hold = useHoldInvoice()
  const settle = useSettleInvoice()
  const saveCost = useSaveCost()
  const dismissCard = useDismissFailedCharges()
  const [undo, setUndo] = useState<{ id: number; label: string } | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const act = async (row: NeedRow) => {
    setBusyKey(row.key)
    try {
      switch (row.action) {
        case 'paid':
          if (!row.invoiceId) break
          await payInvoice.mutateAsync({ id: row.invoiceId })
          setUndo({ id: row.invoiceId, label: `${row.clientName} marked paid` })
          setTimeout(() => setUndo(u => (u?.id === row.invoiceId ? null : u)), 6000)
          break
        case 'send':
          if (row.invoiceId) await send.mutateAsync(row.invoiceId)
          break
        case 'void':
          // A draft for a retainer that has stopped: never sent, never owed.
          if (row.invoiceId) await voidInvoice.mutateAsync({ id: row.invoiceId, reason: 'Draft for a stopped retainer' })
          break
        case 'invoice':
          if (row.projectId) onInvoiceProject(row.projectId)
          break
        case 'setup':
          if (row.clientId) onSetUpRetainer(row.clientId, row.amount)
          break
        case 'assign':
          if (row.expenseId) onAssignCost(row.expenseId)
          break
        case 'open':
        case 'card':
          if (row.clientId) onOpenClient(row.clientId)
          break
        case 'repay':
          if (row.expenseId) await saveCost.mutateAsync({ id: row.expenseId, reimbursedAt: new Date().toISOString().slice(0, 10) })
          break
      }
    } finally {
      setBusyKey(null)
    }
  }

  /** The second answer on a row. Each one does the real thing where there is one. */
  const dismiss = async (row: NeedRow, how: DismissHow = 'writeoff') => {
    setBusyKey(row.key)
    try {
      if (row.action === 'paid' && row.invoiceId && how === 'hold') {
        const until = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
        await hold.mutateAsync({ id: row.invoiceId, until, reason: 'Agreed to wait' })
      } else if (row.action === 'paid' && row.invoiceId && how === 'settle') {
        if (!window.confirm(`Accept what ${row.clientName} has paid as payment in full? The ${fmtView(row.amount)} left is recorded as a discount.`)) return
        await settle.mutateAsync({ id: row.invoiceId })
      } else if (row.action === 'paid' && row.invoiceId) {
        if (!window.confirm(`Write off ${row.clientName}'s ${fmtView(row.amount)}? It is voided, and can still be marked paid later from their page.`)) return
        await voidInvoice.mutateAsync({ id: row.invoiceId, reason: 'Written off' })
      } else if (row.action === 'card' && row.failedChargeIds?.length) {
        await dismissCard.mutateAsync(row.failedChargeIds)
      } else if (row.action === 'send' && row.invoiceId) {
        await voidInvoice.mutateAsync({ id: row.invoiceId, reason: 'Not needed' })
      } else if (row.action === 'invoice' && row.projectId) {
        await saveProject.mutateAsync({ id: row.projectId, status: 'cancelled' })
      } else {
        const next = [...dismissed, row.key]
        setDismissed(next)
        try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)) } catch { /* private window */ }
      }
    } finally {
      setBusyKey(null)
    }
  }

  const nx = useIsNext()
  if (isPending || !m) return <PageLoader />

  const periodLabel = preset === 'Custom' ? 'selected range' : (PERIOD_LABEL[preset] ?? 'this period')
  const op = m.ownerPay
  const safeAll = allTime?.ownerPay.safeToDraw ?? op.safeToDraw
  // Who owes, by how late: the buckets the metrics already work out.
  const aging = [
    { k: 'not due', v: m.ar.current, c: 'var(--c-text-3)' },
    { k: '1–30 days', v: m.ar.d1_30, c: 'var(--c-warn)' },
    { k: '31–60 days', v: m.ar.d31_60, c: '#f0883e' },
    { k: '61–90 days', v: m.ar.d61_90, c: 'var(--c-loss)' },
    { k: '90+ days', v: m.ar.d90plus, c: 'var(--c-loss)' },
  ].filter(b => b.v > 0)
  const agingText = aging.map(b => `${fmtView(b.v)} ${b.k === 'not due' ? 'not due yet' : `${b.k} late`}`).join(', ')
  const prevMonth = m.volume.byMonth.at(-2)
  const lastMonthNet = prevMonth?.net ?? 0

  return (
    <div className={nx ? 'bz-over' : 'space-y-8'}>
      <DateFilter
        preset={preset} onPreset={setPreset}
        customFrom={customFrom} onCustomFrom={setCustomFrom}
        customTo={customTo} onCustomTo={setCustomTo}
      />

      {undo && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs"
          style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: 'var(--c-profit)' }}>
          <span className="flex-1">{undo.label}</span>
          <MiniBtn onClick={async () => { await unpay.mutateAsync(undo.id); setUndo(null) }}>Undo</MiniBtn>
        </div>
      )}

      {/*
        The five figures the tab was rebuilt for sit in the first row, visible on
        arrival. Point-in-time facts (MRR, retainers, what is owed) ignore the
        date filter; period facts name their period in the sub-line.
      */}
      <Question q="How is the business doing?"
        answer={<>
          <b className="num" style={{ color: nx ? 'var(--c-text-1)' : 'var(--c-accent)' }}>{fmtView(m.mrr.current)}/mo</b> recurring
          {m.mrr.netNewThisMonth ? <> ({m.mrr.netNewThisMonth > 0 ? 'up' : 'down'} {fmtView(Math.abs(m.mrr.netNewThisMonth))} this month)</> : null},{' '}
          <b className="num" style={{ color: m.pnl.netProfit >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>{fmtView(m.pnl.netProfit)}</b> profit {periodLabel}
          {m.ar.total ? <>, and <b className="num" style={{ color: '#f59e0b' }}>{fmtView(m.ar.total)}</b> still owed</> : <>, and nobody owes you</>}.
        </>}>
        {nx ? (
          <div className="bz-kgrid">
            {([
              { k: 'mrr', label: 'Recurring (MRR)', value: <>{fmtView(m.mrr.current)}<small>/mo</small></>, big: true, spark: m.mrr.movement.map(r => r.endingMrr), sparkColor: 'var(--k-ink2)', go: '/business/retainers',
                sub: `${m.mrr.activeCount} active retainer${m.mrr.activeCount === 1 ? '' : 's'}${m.mrr.netNewThisMonth ? `, ${m.mrr.netNewThisMonth > 0 ? '+' : ''}${fmtView(m.mrr.netNewThisMonth)} this month` : ''}` },
              { k: 'net', label: 'Net volume', value: fmtView(m.pnl.netVolume), big: true, color: 'var(--c-profit)', spark: m.volume.byMonth.map(r => r.net), sparkColor: 'var(--k-good)', go: '/business/money',
                sub: m.pnl.fees || m.pnl.refunds ? `after ${fmtView(m.pnl.fees)} fees and ${fmtView(m.pnl.refunds)} refunds` : 'no fees or refunds recorded' },
              { k: 'profit', label: 'Net profit', value: fmtView(m.pnl.netProfit), big: true, color: m.pnl.netProfit >= 0 ? 'var(--c-profit)' : 'var(--c-loss)', spark: m.pnlByMonth.map(r => r.netProfit), sparkColor: 'var(--k-good)', go: '/business/money',
                sub: `${m.pnl.marginPct.toFixed(1)}% margin ${periodLabel}` },
              { k: 'gross', label: 'Gross volume', value: fmtView(m.pnl.grossVolume), go: '/business/money',
                sub: `${m.volume.invoiceCount} invoice${m.volume.invoiceCount === 1 ? '' : 's'} ${periodLabel}${lastMonthNet ? `, last month ${fmtView(lastMonthNet)}` : ''}` },
              { k: 'owed', label: 'Outstanding', value: fmtView(m.ar.total), color: m.ar.overdueCount ? 'var(--c-loss)' : m.ar.total ? 'var(--c-warn)' : 'var(--c-text-2)', go: '/business/invoices?status=open',
                sub: m.ar.total ? `${m.ar.count} unpaid: ${agingText}` : 'everyone has paid',
                extra: m.ar.total > 0 ? <span className="bz-aging" aria-hidden>{aging.map(b => <i key={b.k} style={{ flex: b.v, background: b.c }} />)}</span> : null },
              { k: 'draw', label: 'Safe to draw, all time', value: fmtView(Math.max(safeAll, 0)), color: safeAll > 0 ? 'var(--c-profit)' : 'var(--c-text-1)', go: '/business/money',
                sub: `this month ${fmtView(Math.max(op.safeToDraw, 0))}, ${[op.taxReserveEnabled ? `after ${op.taxRatePct}% tax` : 'no tax held back', op.bufferMonths > 0 ? `${op.bufferMonths}-month buffer` : 'no buffer'].join(' and a ')}` },
              { k: 'pay', label: "Owner's pay", value: fmtView(op.drawnPeriod), go: '/business/money',
                sub: op.owners.length ? `${op.owners.map(o => `${o.name.split(' ')[0]} ${fmtView(o.period)}`).join(', ')}, ${fmtView(op.drawnAllTime)} all time` : 'no partners set up' },
              { k: 'clients', label: 'Active clients', value: m.clients.active, go: '/business/clients', sub: `${m.clients.newInRange} won ${periodLabel}` },
              { k: 'avg', label: 'Average client', value: <>{fmtView(m.mrr.arpa)}<small>/mo</small></>, go: '/business/retainers', sub: `across ${m.mrr.activeCount} retainers` },
            ] as { k: string; label: string; value: React.ReactNode; sub: string; big?: boolean; color?: string; spark?: number[]; sparkColor?: string; go: string; extra?: React.ReactNode }[]).map(f => (
              <button key={f.k} type="button" className={f.big ? 'big' : ''} onClick={() => navigate(f.go)}>
                <span className="l">{f.label}</span>
                <b className="v num" style={{ color: f.color }}>{f.value}</b>
                <span className="s">{f.sub}</span>
                {f.extra}
                {f.spark && f.spark.some(v => v !== 0) && <span className="sp"><Sparkline points={f.spark} color={f.sparkColor ?? 'var(--k-ink2)'} height={26} /></span>}
              </button>
            ))}
          </div>
        ) : <>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
          <KpiCard spark={m.mrr.movement.map(r => r.endingMrr)} sparkColor="#818cf8" onClick={() => navigate('/business/retainers')} hero label="MRR" value={`${fmtView(m.mrr.current)}/mo`} color="var(--c-accent)"
            sub={`${m.mrr.activeCount} active retainer${m.mrr.activeCount === 1 ? '' : 's'}${
              m.mrr.netNewThisMonth ? ` · ${m.mrr.netNewThisMonth > 0 ? '+' : ''}${fmtView(m.mrr.netNewThisMonth)} this month` : ''}`} />
          <KpiCard onClick={() => navigate('/business/money')} hero label="Gross volume" value={fmtView(m.pnl.grossVolume)}
            sub={`${m.volume.invoiceCount} invoice${m.volume.invoiceCount === 1 ? '' : 's'} ${periodLabel}${
              lastMonthNet ? ` · last month ${fmtView(lastMonthNet)}` : ''}`} />
          <KpiCard spark={m.volume.byMonth.map(r => r.net)} sparkColor="#34d399" onClick={() => navigate('/business/money')} hero label="Net volume" value={fmtView(m.pnl.netVolume)} color="var(--c-profit)"
            sub={m.pnl.fees || m.pnl.refunds
              ? `after ${fmtView(m.pnl.fees)} fees and ${fmtView(m.pnl.refunds)} refunds`
              : 'no fees or refunds recorded'} />
          <KpiCard onClick={() => navigate('/business/money')} hero label="Owner's pay" value={fmtView(op.drawnPeriod)} color="var(--c-accent-2)"
            sub={op.owners.length
              ? `${op.owners.map(o => `${o.name.split(' ')[0]} ${fmtView(o.period)}`).join(' · ')} · ${fmtView(op.drawnAllTime)} all time`
              : 'no partners set up'} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          <KpiCard spark={m.pnlByMonth.map(r => r.netProfit)} sparkColor="#34d399" onClick={() => navigate('/business/money')} label="Net profit" value={fmtView(m.pnl.netProfit)}
            color={m.pnl.netProfit >= 0 ? 'var(--c-profit)' : 'var(--c-loss)'}
            sub={`${m.pnl.marginPct.toFixed(1)}% margin ${periodLabel}`} />
          <KpiCard onClick={() => navigate('/business/invoices?status=open')} label="Outstanding" value={fmtView(m.ar.total)}
            color={m.ar.overdueCount ? 'var(--c-loss)' : m.ar.total ? '#f59e0b' : 'var(--c-text-2)'}
            sub={m.ar.total
              ? `${m.ar.count} unpaid · ${agingText}`
              : 'everyone has paid'} />
          <KpiCard onClick={() => navigate('/business/money')} label="Safe to draw, all time" value={fmtView(Math.max(safeAll, 0))}
            color={safeAll >= 0 ? 'var(--c-profit)' : 'var(--c-loss)'}
            sub={`this month ${fmtView(Math.max(op.safeToDraw, 0))} · ` + [
              op.taxReserveEnabled ? `after ${op.taxRatePct}% tax` : 'no tax held back',
              op.bufferMonths > 0 ? `${op.bufferMonths}-month buffer` : 'no buffer',
            ].join(' and a ')} />
          <KpiCard onClick={() => navigate('/business/clients')} label="Active clients" value={m.clients.active}
            sub={`${m.clients.newInRange} won ${periodLabel}`} />
          <KpiCard onClick={() => navigate('/business/retainers')} label="Average client" value={`${fmtView(m.mrr.arpa)}/mo`}
            sub={`across ${m.mrr.activeCount} retainers`} />
        </div>
        </>}
        <AtAGlance fmtView={fmtView} />
      </Question>

      <Question q="Is money coming in?"
        answer={prevMonth ? <><b className="num" style={{ color: 'var(--c-profit)' }}>{fmtView(lastMonthNet)}</b> came in last month after fees.</> : 'The last 12 months of money in.'}
        action={<MiniBtn onClick={onOpenStats}>Full breakdown</MiniBtn>}>
        <MoneyInChart metrics={m} fmtView={fmtView} />
      </Question>

      <PaymentsToAssign fmtView={fmtView} />

      <NeedsYou rows={needs} fmtView={fmtView} onAct={act} onDismiss={dismiss} busyKey={busyKey} />

      {builds.length > 0 && (
        <Section label="Websites in progress" count={builds.length}>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
            {builds.map(b => {
              const stage = STAGES.find(s => s.key === b.stage)
              const paused = b.status === 'paused'
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => b.clientId && onOpenClient(b.clientId)}
                  className={`text-left rounded-xl p-3.5 border border-[var(--c-border)] ${hoverCard}`}
                  style={{ background: 'var(--c-bg-card)' }}
                >
                  <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--c-text-1)' }}>{b.name}</div>
                  <div className="text-[11px] mb-2.5" style={{ color: 'var(--c-text-3)' }}>{b.clientName}</div>

                  <div className="flex items-baseline justify-between gap-2 mb-2">
                    <span className="text-base font-bold num" style={{ color: 'var(--c-text-1)' }}>{fmtView(b.value)}</span>
                    <Pill color={paused ? '#f59e0b' : stage?.color ?? 'var(--c-text-3)'}>
                      {paused ? 'paused' : stage?.label ?? b.stage}
                    </Pill>
                  </div>

                  <div className="flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--c-text-3)' }}>
                    {[0, 1, 2].map(i => (
                      <span key={i} className="w-2 h-2 rounded-full shrink-0"
                        style={i < b.milestonesBilled
                          ? { background: 'var(--c-profit)' }
                          : { border: '1.4px solid var(--c-border-strong)' }} />
                    ))}
                    <span className="ml-1">
                      {b.billed ? `${fmtView(b.billed)} billed` : 'nothing billed'}
                    </span>
                  </div>

                  <div className="flex justify-between text-[10.5px] mt-2.5 pt-2.5"
                    style={{ borderTop: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}>
                    <span className="num">{fmtHours(b.hours)} logged</span>
                    <span className="num" style={{ color: b.overdue ? 'var(--c-loss)' : 'var(--c-text-3)' }}>
                      {b.dueDate ? `due ${formatDate(b.dueDate)}` : 'no due date'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </Section>
      )}
    </div>
  )
}
