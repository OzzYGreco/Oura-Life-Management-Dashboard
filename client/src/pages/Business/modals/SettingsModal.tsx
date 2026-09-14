import { useEffect, useState } from 'react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { useFinanceSettings } from '../../../hooks/useFinanceSettings'
import type { FmtView } from '../../../hooks/useFmtView'

/**
 * How much of profit the business holds back before the partners draw.
 *
 * Both rules are guesses until the real figures are known, so both are
 * adjustable and the tax reserve can be switched off entirely. A reserve set to
 * a rate nobody has verified is worse than no reserve at all, because it reads
 * as a fact.
 */
export function BusinessSettingsModal({
  open, onClose, netProfit, monthlyCosts, fmtView,
}: {
  open: boolean
  onClose: () => void
  /** Used only to show what the current rules would hold back right now. */
  netProfit: number
  monthlyCosts: number
  fmtView: FmtView
}) {
  const { settings, save } = useFinanceSettings()
  const [taxOn, setTaxOn] = useState(true)
  const [rate, setRate] = useState('25')
  const [months, setMonths] = useState('1')

  useEffect(() => {
    if (!open) return
    setTaxOn(settings.showTaxReserve)
    setRate(String(settings.taxRateBusiness ?? 25))
    setMonths(String(settings.businessBufferMonths ?? 1))
  }, [open, settings])

  const rateNum = Math.min(Math.max(Number(rate) || 0, 0), 100)
  const monthsNum = Math.min(Math.max(Number(months) || 0, 0), 24)
  const reserve = taxOn ? Math.max(netProfit, 0) * (rateNum / 100) : 0
  const buffer = monthlyCosts * monthsNum
  const safe = netProfit - reserve - buffer

  const apply = () => {
    save({
      ...settings,
      showTaxReserve: taxOn,
      taxRateBusiness: rateNum,
      businessBufferMonths: monthsNum,
    })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="What to hold back" size="sm">
      <div className="p-5 space-y-4">
        {/* ── Tax reserve ─────────────────────────────────────────────── */}
        <div className="rounded-lg px-3.5 py-3"
          style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
          <label htmlFor="set-tax-on" className="flex items-start gap-2.5 cursor-pointer">
            <input
              id="set-tax-on"
              type="checkbox"
              checked={taxOn}
              onChange={e => setTaxOn(e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-indigo-500 shrink-0"
            />
            <span>
              <span className="block text-xs font-semibold" style={{ color: 'var(--c-text-1)' }}>
                Hold back a tax reserve
              </span>
              <span className="block text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--c-text-3)' }}>
                Off until you know the real rate. The step disappears from the waterfall rather than
                sitting there reading zero, and nothing is held back before you draw.
              </span>
            </span>
          </label>

          {taxOn && (
            <div className="mt-3 pl-6">
              <Input
                id="set-tax-rate"
                label="Rate"
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={rate}
                onChange={e => setRate(e.target.value)}
              />
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--c-text-3)' }}>
                A guess is fine. Change it whenever the real number turns up, and every past month
                re-reads against the new rate.
              </p>
            </div>
          )}
        </div>

        {/* ── Cash buffer ─────────────────────────────────────────────── */}
        <div className="rounded-lg px-3.5 py-3"
          style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
          <Input
            id="set-buffer"
            label="Cash buffer, in months of running costs"
            type="number"
            min={0}
            max={24}
            step="0.5"
            value={months}
            onChange={e => setMonths(e.target.value)}
          />
          <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: 'var(--c-text-3)' }}>
            Your costs average <span className="num">{fmtView(monthlyCosts)}</span> a month, so this
            keeps <span className="num">{fmtView(buffer)}</span> in the business.
            Set it to 0 to hold nothing back.
          </p>
        </div>

        {/* ── What the rules do right now ─────────────────────────────── */}
        <div className="rounded-lg px-3.5 py-3 text-[11px] space-y-1"
          style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.2)' }}>
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--c-text-3)' }}>
            With these settings, right now
          </div>
          <Line label="Net profit" value={fmtView(netProfit)} />
          {taxOn && <Line label={`Tax reserve at ${rateNum}%`} value={`- ${fmtView(reserve)}`} />}
          <Line label={monthsNum ? `Buffer, ${monthsNum} month${monthsNum === 1 ? '' : 's'} of costs` : 'No buffer'}
            value={`- ${fmtView(buffer)}`} />
          <div className="flex justify-between gap-3 pt-1.5 mt-1.5 font-semibold"
            style={{ borderTop: '1px solid var(--c-border)', color: 'var(--c-text-1)' }}>
            <span>Safe to draw</span>
            <span className="num" style={{ color: safe >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>
              {fmtView(Math.max(safe, 0))}
            </span>
          </div>
        </div>

        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--c-text-3)' }}>
          The tax reserve switch and rate are shared with the Finances tab, so the two cannot
          disagree about what you owe.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={apply}>Save</Button>
        </div>
      </div>
    </Modal>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3" style={{ color: 'var(--c-text-2)' }}>
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  )
}
