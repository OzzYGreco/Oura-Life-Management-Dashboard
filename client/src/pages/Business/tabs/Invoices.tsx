import { useMemo, useState } from 'react'
import { useUrlState } from '../lib/useUrlState'
import { PageLoader } from '../../../components/ui/Spinner'
import { DateFilter, type Preset, presetRange } from '../../../components/shared/DateFilter'
import { InvoiceLedger } from '../components/InvoiceLedger'
import { RetainerTable } from '../components/RetainerTable'
import { PaymentsLedger } from '../components/PaymentsLedger'
import { Question, Figure } from '../components/MoneySections'
import { SplitBar, hoverCard, SERIES } from '../components/charts'
import { MiniBtn } from '../components/primitives'
import { BulkPriceModal } from '../modals/GrowthModals'
import { useLedger, useRetainers, useUnassignedPayments, usePayments, exportUrl } from '../../../hooks/useBusiness'
import type { LedgerRow, Retainer } from '../lib/types'
import type { RetainerAction } from '../components/RetainerTable'
import type { FmtView } from '../../../hooks/useFmtView'

const PER_MONTH: Record<string, number> = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }

export type InvoicesView = 'ledger' | 'payments' | 'retainers'

export function Invoices({
  view, onView, fmtView, onPay, onOpenClient, onEdit, onSend, onNewInvoice, onRetainerAction, onNewRetainer,
}: {
  /** From the address: /business/invoices, /payments or /retainers. */
  view: InvoicesView
  onView: (v: InvoicesView) => void
  fmtView: FmtView
  onPay: (row: LedgerRow) => void
  onOpenClient: (id: number) => void
  onEdit: (row: LedgerRow) => void
  onSend: (row: LedgerRow) => void
  onNewInvoice: () => void
  onRetainerAction: (r: Retainer, action: RetainerAction) => void
  onNewRetainer: () => void
}) {
  const [preset, setPreset] = useUrlState<Preset>('range', 'All')
  const [customFrom, setCustomFrom] = useUrlState('from', '')
  const [customTo, setCustomTo] = useUrlState('to', '')

  const range = useMemo(() => (
    preset === 'All' ? {}
      : preset === 'Custom' ? { from: customFrom || undefined, to: customTo || undefined }
      : presetRange(preset) ?? {}
  ), [preset, customFrom, customTo])

  const { data, isPending } = useLedger(range)
  const { data: retainers = [] } = useRetainers()
  const { data: queue } = useUnassignedPayments()
  const { data: payments } = usePayments()
  const [bulkOpen, setBulkOpen] = useState(false)
  const toAssign = queue?.payments.length ?? 0

  const owedBy = useMemo(() => {
    const by = new Map<string, number>()
    for (const r of data?.rows ?? []) {
      if (['unpaid', 'overdue', 'part-paid'].includes(r.status)) by.set(r.clientName, (by.get(r.clientName) ?? 0) + r.owed)
    }
    const sorted = [...by.entries()].sort((a, b) => b[1] - a[1])
    // Colour follows the client, in a fixed order; past eight they fold into one.
    const top = sorted.slice(0, 7).map(([key, value], i) => ({ key, value, color: SERIES[i] }))
    const rest = sorted.slice(7).reduce((s, [, v]) => s + v, 0)
    return rest > 0 ? [...top, { key: `${sorted.length - 7} others`, value: rest, color: 'var(--c-text-3)' }] : top
  }, [data])

  const monthIn = useMemo(() => {
    const month = new Date().toISOString().slice(0, 7)
    const rows = (payments ?? []).filter(p => p.date.startsWith(month) && p.how !== 'not income')
    const by = (k: string) => rows.filter(p => p.source === k).reduce((s, p) => s + p.gross, 0)
    const parts = [
      { key: 'Stripe', value: by('stripe'), color: SERIES[0] },
      { key: 'Bank transfer', value: by('bank'), color: SERIES[1] },
      { key: 'Cash', value: by('cash'), color: SERIES[2] },
    ].filter(x => x.value > 0)
    return { parts, total: parts.reduce((s, x) => s + x.value, 0), count: rows.length }
  }, [payments])

  const mrr = useMemo(() => {
    const live = retainers.filter(r => r.status === 'active' && r.startDate <= new Date().toISOString().slice(0, 10))
    const by = new Map<string, number>()
    for (const r of live) by.set(r.serviceName, (by.get(r.serviceName) ?? 0) + r.amount * (PER_MONTH[r.frequency] ?? 1))
    const parts = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([key, value], i) => ({ key, value, color: SERIES[i % SERIES.length] }))
    const later = retainers.filter(r => r.status === 'active' && r.startDate > new Date().toISOString().slice(0, 10)).length
    return { parts, total: parts.reduce((s, x) => s + x.value, 0), count: live.length, later }
  }, [retainers])

  if (isPending || !data) return <PageLoader />
  const t = data.totals
  const periodLabel = preset === 'All' ? 'all time' : 'in this period'

  return (
    <div className="space-y-7">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 p-1 rounded-xl w-fit"
          style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
          {(['ledger', 'payments', 'retainers'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => onView(v)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={view === v
                ? {
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(167,139,250,0.12))',
                  border: '1px solid rgba(129,140,248,0.25)', color: 'var(--c-text-1)',
                }
                : { color: 'var(--c-text-2)', border: '1px solid transparent' }}
            >
              {v === 'ledger' ? 'Invoices'
                : v === 'payments' ? `Payments${toAssign ? ` (${toAssign} to assign)` : ''}`
                : `Retainers (${retainers.filter(r => r.status === 'active').length})`}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-1.5 ml-auto">
          <span className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Export</span>
          {(['invoices', 'payments', 'costs'] as const).map(k => (
            <a key={k} href={exportUrl(k, view === 'ledger' ? range : {})} download
              title={`A spreadsheet of ${k}${view === 'ledger' && preset !== 'All' ? ' for this period' : ''}, for the accountant`}
              className="px-2 py-1 rounded-md text-[11px] font-semibold hover:bg-white/5"
              style={{ border: '1px solid var(--c-border-mid)', color: 'var(--c-text-2)' }}>{k}</a>
          ))}
        </span>
        {view === 'ledger' && (
          <DateFilter
            preset={preset} onPreset={setPreset}
            customFrom={customFrom} onCustomFrom={setCustomFrom}
            customTo={customTo} onCustomTo={setCustomTo}
          />
        )}
      </div>

      {view === 'ledger' ? (
        <>
          <Question q="Who owes you?"
            answer={t.outstanding > 0
              ? <><b className="num" style={{ color: '#f59e0b' }}>{fmtView(t.outstanding)}</b> owed by {owedBy.length} client{owedBy.length === 1 ? '' : 's'}
                {t.overdue > 0 ? <>, <b className="num" style={{ color: 'var(--c-loss)' }}>{fmtView(t.overdue)}</b> of it overdue</> : ', none of it late'}.
                {t.onHold ? <> {fmtView(t.onHold)} is on hold.</> : null}
                {t.avgDaysToPay != null ? <> Invoices are paid {t.avgDaysToPay < 1 ? 'within a day' : `${Math.round(t.avgDaysToPay)} days after issue`} on average.</> : null}
                {t.writtenOff ? <> {fmtView(t.writtenOff)} has been written off ({t.writtenOffCount} bill{t.writtenOffCount === 1 ? '' : 's'}), listed under Void.</> : null}</>
              : 'Nobody owes you anything.'}>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)' }}>
              <div className="grid grid-cols-2 gap-3">
                <Figure label="Billed" value={fmtView(t.billed)} sub={`${t.count} invoice${t.count === 1 ? '' : 's'} ${periodLabel}`} />
                <Figure label="Collected" value={fmtView(t.collected)} color="var(--c-profit)"
                  sub={`${t.paidCount} paid${t.fees ? `, after ${fmtView(t.fees)} fees` : ''}`} />
                <Figure label="Owed" value={fmtView(t.outstanding)} color={t.outstanding ? '#f59e0b' : 'var(--c-text-2)'}
                  sub={t.outstanding ? 'waiting to be paid' : 'everyone has paid'} />
                <Figure label="Overdue" value={fmtView(t.overdue)} color={t.overdue ? 'var(--c-loss)' : 'var(--c-text-2)'}
                  sub={t.overdue ? 'past the due date' : 'nothing late'} />
              </div>
              <div className={`rounded-xl p-4 ${hoverCard}`} style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
                <div className="text-[11px] mb-3" style={{ color: 'var(--c-text-3)' }}>Who the {fmtView(t.outstanding)} is owed by</div>
                {owedBy.length
                  ? <SplitBar parts={owedBy} fmtView={fmtView} />
                  : <p className="py-8 text-center text-xs" style={{ color: 'var(--c-text-3)' }}>All paid up.</p>}
              </div>
            </div>
          </Question>

          <InvoiceLedger
            rows={data.rows} totals={t} fmtView={fmtView}
            onPay={onPay} onOpenClient={onOpenClient} onEdit={onEdit} onSend={onSend}
            onNewInvoice={onNewInvoice}
          />
        </>
      ) : view === 'payments' ? (
        <>
          <Question q="What came in?"
            answer={monthIn.total > 0
              ? <><b className="num" style={{ color: 'var(--c-profit)' }}>{fmtView(monthIn.total)}</b> came in this month across {monthIn.count} payment{monthIn.count === 1 ? '' : 's'}{toAssign ? <>, and <b>{toAssign}</b> still {toAssign === 1 ? 'needs' : 'need'} assigning</> : null}.</>
              : 'Nothing has come in this month yet.'}>
            {monthIn.parts.length > 0 && (
              <div className={`rounded-xl p-4 ${hoverCard}`} style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
                <div className="text-[11px] mb-3" style={{ color: 'var(--c-text-3)' }}>This month, by how it was paid</div>
                <SplitBar parts={monthIn.parts} fmtView={fmtView} />
              </div>
            )}
          </Question>
          <PaymentsLedger fmtView={fmtView} onOpenClient={onOpenClient} />
        </>
      ) : (
        <>
        <BulkPriceModal open={bulkOpen} onClose={() => setBulkOpen(false)} fmtView={fmtView} />
        <Question q="What recurs?"
          action={<MiniBtn tone="accent" onClick={() => setBulkOpen(true)} title="One price change for everyone on a service, from a date">Change prices</MiniBtn>}
          answer={mrr.total > 0
            ? <><b className="num" style={{ color: 'var(--c-accent)' }}>{fmtView(mrr.total)}/mo</b> from {mrr.count} retainer{mrr.count === 1 ? '' : 's'}. {mrr.parts[0]?.key} brings {Math.round((mrr.parts[0]?.value ?? 0) / mrr.total * 100)}% of it.{mrr.later ? <> {mrr.later} more start{mrr.later === 1 ? 's' : ''} later.</> : null}</>
            : 'Nothing recurring yet.'}>
          {mrr.parts.length > 0 && (
            <div className={`rounded-xl p-4 ${hoverCard}`} style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
              <div className="text-[11px] mb-3" style={{ color: 'var(--c-text-3)' }}>Monthly income, by service</div>
              <SplitBar parts={mrr.parts} fmtView={fmtView} />
            </div>
          )}
        </Question>
        <RetainerTable
          retainers={retainers} fmtView={fmtView}
          onOpenClient={onOpenClient} onAction={onRetainerAction} onNew={onNewRetainer}
        />
        </>
      )}
    </div>
  )
}
