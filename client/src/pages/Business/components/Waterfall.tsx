import type { BusinessMetrics } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

function WRow({
  label, value, fmtView, indent, weight, color, rule,
}: {
  label: string
  value: number
  fmtView: FmtView
  indent?: boolean
  weight?: 'normal' | 'total' | 'final'
  color?: string
  rule?: 'thin' | 'thick'
}) {
  const size = weight === 'final' ? 'text-[15px] font-extrabold'
    : weight === 'total' ? 'text-[13.5px] font-bold'
    : 'text-xs'
  return (
    <div
      className={`flex justify-between gap-4 ${indent ? 'pl-3.5' : ''} ${size}`}
      style={{
        paddingTop: rule ? 9 : 5,
        paddingBottom: 5,
        marginTop: rule ? 4 : 0,
        borderTop: rule === 'thick' ? '2px solid rgba(99,102,241,0.3)'
          : rule === 'thin' ? '1px solid var(--c-border)' : undefined,
      }}
    >
      <span style={{ color: indent ? 'var(--c-text-2)' : color ?? 'var(--c-text-1)' }}>{label}</span>
      <span className="num" style={{ color: color ?? (indent ? 'var(--c-text-2)' : 'var(--c-text-1)') }}>
        {fmtView(value)}
      </span>
    </div>
  )
}

/**
 * Gross volume down to what is actually left in the business.
 *
 * The last two steps are the ones that did not exist before: a tax reserve, and
 * owner's pay taken out BELOW net profit rather than charged as a cost above it.
 */
export function Waterfall({
  metrics, fmtView,
}: { metrics: BusinessMetrics; fmtView: FmtView }) {
  const p = metrics.pnl
  const op = metrics.ownerPay

  return (
    <div className="rounded-xl px-4 py-3.5" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
      <WRow label="Gross volume" value={p.grossVolume} fmtView={fmtView} weight="total" />
      <WRow label="Processing fees" value={-p.fees} fmtView={fmtView} indent />
      <WRow label="Refunds" value={-p.refunds} fmtView={fmtView} indent />

      <WRow label="Net volume" value={p.netVolume} fmtView={fmtView} weight="total" color="var(--c-profit)" rule="thin" />
      <WRow label="Ad spend" value={-p.adSpend} fmtView={fmtView} indent />
      <WRow label="Tools and overheads" value={-p.overheads} fmtView={fmtView} indent />
      <WRow label="Client delivery costs" value={-p.clientCosts} fmtView={fmtView} indent />

      <WRow label="Net profit" value={p.netProfit} fmtView={fmtView} weight="total" rule="thin"
        color={p.netProfit >= 0 ? 'var(--c-profit)' : 'var(--c-loss)'} />
      {/* Skipped rather than shown as zero: a row that always reads nothing
          is noise, and a reserve at an unverified rate reads as a fact. */}
      {op.taxReserveEnabled && (
        <>
          <WRow label={`Tax reserve at ${op.taxRatePct}%`} value={-op.taxReserve} fmtView={fmtView} indent />
          <WRow label="Distributable" value={op.distributable} fmtView={fmtView} weight="total" rule="thin" />
        </>
      )}
      <WRow label="Owner's pay" value={-op.drawnPeriod} fmtView={fmtView} indent />

      <WRow label="Retained in the business" value={op.netProfit - op.drawnPeriod} fmtView={fmtView}
        weight="final" rule="thick"
        color={op.netProfit - op.drawnPeriod >= 0 ? 'var(--c-text-1)' : 'var(--c-loss)'} />

      <p className="text-[11px] leading-relaxed mt-3 px-3 py-2 rounded-lg"
        style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.18)', color: 'var(--c-text-2)' }}>
        A draw is a share of profit, so it comes out below the line. Filed as a business expense it
        would sit above net profit and make the business look less profitable than it is.
      </p>
    </div>
  )
}
