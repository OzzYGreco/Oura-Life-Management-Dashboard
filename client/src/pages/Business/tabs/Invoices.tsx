import { useMemo, useState } from 'react'
import { PageLoader } from '../../../components/ui/Spinner'
import { DateFilter, type Preset, presetRange } from '../../../components/shared/DateFilter'
import { InvoiceLedger } from '../components/InvoiceLedger'
import { RetainerTable } from '../components/RetainerTable'
import { FactBoard, MiniBtn } from '../components/primitives'
import { useLedger, useRetainers } from '../../../hooks/useBusiness'
import type { LedgerRow, Retainer } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

export function Invoices({
  fmtView, onPay, onOpenClient, onEdit, onSend, onNewInvoice, onRetainerAction, onNewRetainer,
}: {
  fmtView: FmtView
  onPay: (row: LedgerRow) => void
  onOpenClient: (id: number) => void
  onEdit: (row: LedgerRow) => void
  onSend: (row: LedgerRow) => void
  onNewInvoice: () => void
  onRetainerAction: (r: Retainer, action: 'price' | 'pause' | 'resume' | 'cancel') => void
  onNewRetainer: () => void
}) {
  const [view, setView] = useState<'ledger' | 'retainers'>('ledger')
  const [preset, setPreset] = useState<Preset>('All')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const range = useMemo(() => (
    preset === 'All' ? {}
      : preset === 'Custom' ? { from: customFrom || undefined, to: customTo || undefined }
      : presetRange(preset) ?? {}
  ), [preset, customFrom, customTo])

  const { data, isPending } = useLedger(range)
  const { data: retainers = [] } = useRetainers()

  if (isPending || !data) return <PageLoader />
  const t = data.totals

  return (
    <div className="space-y-7">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 p-1 rounded-xl w-fit"
          style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
          {(['ledger', 'retainers'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={view === v
                ? {
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(167,139,250,0.12))',
                  border: '1px solid rgba(129,140,248,0.25)', color: 'var(--c-text-1)',
                }
                : { color: 'var(--c-text-2)', border: '1px solid transparent' }}
            >
              {v === 'ledger' ? 'Invoices' : `Retainers (${retainers.filter(r => r.status === 'active').length})`}
            </button>
          ))}
        </div>
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
          <FactBoard facts={[
            {
              label: 'Billed', value: fmtView(t.billed),
              sub: `${t.count} invoice${t.count === 1 ? '' : 's'}`,
            },
            {
              label: 'Collected', value: fmtView(t.collected), color: 'var(--c-profit)',
              sub: `${t.paidCount} paid${t.fees ? ` · after ${fmtView(t.fees)} fees` : ''}`,
            },
            {
              label: 'Outstanding', value: fmtView(t.outstanding),
              color: t.outstanding ? '#f59e0b' : 'var(--c-text-2)',
              sub: t.outstanding ? 'waiting to be paid' : 'everyone has paid',
            },
            {
              label: 'Overdue', value: fmtView(t.overdue),
              color: t.overdue ? 'var(--c-loss)' : 'var(--c-text-2)',
              sub: t.overdue ? 'past the due date' : 'nothing late',
            },
            {
              label: 'Days to pay',
              value: t.avgDaysToPay != null ? t.avgDaysToPay.toFixed(1) : '--',
              sub: t.avgDaysToPay != null ? 'average from issue to payment' : 'nothing paid yet',
            },
          ]} />

          <InvoiceLedger
            rows={data.rows} totals={t} fmtView={fmtView}
            onPay={onPay} onOpenClient={onOpenClient} onEdit={onEdit} onSend={onSend}
            onNewInvoice={onNewInvoice}
          />
        </>
      ) : (
        <RetainerTable
          retainers={retainers} fmtView={fmtView}
          onOpenClient={onOpenClient} onAction={onRetainerAction} onNew={onNewRetainer}
        />
      )}
    </div>
  )
}
