import { useMemo, useState } from 'react'
import { Section } from '../../../components/ui/Section'
import { KpiCard } from '../../../components/ui/KpiCard'
import { PageLoader } from '../../../components/ui/Spinner'
import { DateFilter, type Preset, presetRange } from '../../../components/shared/DateFilter'
import { MoneyInChart } from '../components/MoneyInChart'
import { NeedsYou } from '../components/NeedsYou'
import { PaymentsToAssign } from '../components/PaymentsToAssign'
import { MiniBtn, Pill, fmtHours } from '../components/primitives'
import { useBusinessMetrics, useNeeds, useActiveProjects, usePayInvoice, useUnpayInvoice, useSendInvoice } from '../../../hooks/useBusiness'
import type { OwnerPayOpts } from '../../../hooks/useBusiness'
import { formatDate } from '../../../lib/utils'
import { STAGES } from '../lib/types'
import type { NeedRow } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

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
  const [preset, setPreset] = useState<Preset>('MTD')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const range = useMemo(() => (
    preset === 'All' ? {}
      : preset === 'Custom' ? { from: customFrom || undefined, to: customTo || undefined }
      : presetRange(preset) ?? {}
  ), [preset, customFrom, customTo])

  const { data: m, isPending } = useBusinessMetrics(range, ownerPayOpts)
  const { data: needs = [] } = useNeeds()
  const { data: builds = [] } = useActiveProjects()

  const payInvoice = usePayInvoice()
  const unpay = useUnpayInvoice()
  const send = useSendInvoice()
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
        case 'invoice':
          if (row.projectId) onInvoiceProject(row.projectId)
          break
        case 'setup':
          if (row.clientId) onSetUpRetainer(row.clientId, row.amount)
          break
        case 'assign':
          if (row.expenseId) onAssignCost(row.expenseId)
          break
      }
    } finally {
      setBusyKey(null)
    }
  }

  if (isPending || !m) return <PageLoader />

  const periodLabel = preset === 'Custom' ? 'selected range' : (PERIOD_LABEL[preset] ?? 'this period')
  const op = m.ownerPay
  const prevMonth = m.volume.byMonth.at(-2)
  const lastMonthNet = prevMonth?.net ?? 0

  return (
    <div className="space-y-8">
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
      <Section label="The business">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
          <KpiCard hero label="MRR" value={`${fmtView(m.mrr.current)}/mo`} color="var(--c-accent)"
            sub={`${m.mrr.activeCount} active retainer${m.mrr.activeCount === 1 ? '' : 's'}${
              m.mrr.netNewThisMonth ? ` · ${m.mrr.netNewThisMonth > 0 ? '+' : ''}${fmtView(m.mrr.netNewThisMonth)} this month` : ''}`} />
          <KpiCard hero label="Gross volume" value={fmtView(m.pnl.grossVolume)}
            sub={`${m.volume.invoiceCount} invoice${m.volume.invoiceCount === 1 ? '' : 's'} ${periodLabel}${
              lastMonthNet ? ` · last month ${fmtView(lastMonthNet)}` : ''}`} />
          <KpiCard hero label="Net volume" value={fmtView(m.pnl.netVolume)} color="var(--c-profit)"
            sub={m.pnl.fees || m.pnl.refunds
              ? `after ${fmtView(m.pnl.fees)} fees and ${fmtView(m.pnl.refunds)} refunds`
              : 'no fees or refunds recorded'} />
          <KpiCard hero label="Owner's pay" value={fmtView(op.drawnPeriod)} color="var(--c-accent-2)"
            sub={op.owners.length
              ? `${op.owners.map(o => `${o.name.split(' ')[0]} ${fmtView(o.period)}`).join(' · ')} · ${fmtView(op.drawnAllTime)} all time`
              : 'no partners set up'} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          <KpiCard label="Net profit" value={fmtView(m.pnl.netProfit)}
            color={m.pnl.netProfit >= 0 ? 'var(--c-profit)' : 'var(--c-loss)'}
            sub={`${m.pnl.marginPct.toFixed(1)}% margin ${periodLabel}`} />
          <KpiCard label="Outstanding" value={fmtView(m.ar.total)}
            color={m.ar.overdueCount ? 'var(--c-loss)' : m.ar.total ? '#f59e0b' : 'var(--c-text-2)'}
            sub={m.ar.total
              ? `${m.ar.count} unpaid · ${m.ar.overdueCount ? `${m.ar.overdueCount} overdue` : 'none overdue'}`
              : 'everyone has paid'} />
          <KpiCard label="Safe to draw" value={fmtView(Math.max(op.safeToDraw, 0))}
            color={op.safeToDraw >= 0 ? 'var(--c-profit)' : 'var(--c-loss)'}
            sub={[
              op.taxReserveEnabled ? `after ${op.taxRatePct}% tax` : 'no tax held back',
              op.bufferMonths > 0 ? `${op.bufferMonths}-month buffer` : 'no buffer',
            ].join(' and a ')} />
          <KpiCard label="Active clients" value={m.clients.active}
            sub={`${m.clients.newInRange} won ${periodLabel}`} />
          <KpiCard label="Average client" value={`${fmtView(m.mrr.arpa)}/mo`}
            sub={`across ${m.mrr.activeCount} retainers`} />
        </div>
      </Section>

      <Section label="Money in" count="12 months"
        action={<MiniBtn onClick={onOpenStats}>Full breakdown</MiniBtn>}>
        <MoneyInChart metrics={m} fmtView={fmtView} />
      </Section>

      <PaymentsToAssign fmtView={fmtView} />

      <NeedsYou rows={needs} fmtView={fmtView} onAct={act} busyKey={busyKey} />

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
                  className="text-left rounded-xl p-3.5 transition-colors"
                  style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(129,140,248,0.4)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--c-border)')}
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
