import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { PnLBadge, RRBadge, DeviationBadge } from '../../components/shared/PnLBadge'
import { formatDate, fmtSize, fmtPrice } from '../../lib/utils'
import { useFmtView } from '../../hooks/useFmtView'
import { type Trade } from '../../hooks/useTrades'
import { MISTAKES } from '../../lib/constants'
import { RiskPlanner } from './RiskPlanner'
import { ImageViewer } from '../../components/shared/ImageViewer'
import { Edit, Layers } from 'lucide-react'

interface Props {
  trade: Trade
  onClose: () => void
  onEdit: () => void
}

function fmt(n: number | undefined | null, prefix = '$') {
  if (n == null) return '--'
  return `${prefix}${n.toLocaleString(undefined, { maximumFractionDigits: 6 })}`
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-xs text-text-muted uppercase tracking-wide">{children}</span>
      <div className="flex-1 h-px bg-bg-border" />
    </div>
  )
}

export function TradeDetailModal({ trade, onClose, onEdit }: Props) {
  const { fmtView } = useFmtView('USD', 'trading')
  const isCompounded = !!trade.isCompounded
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  // Derive avg entry / exit from legs (or fall back to stored values)
  const entries    = trade.entries    ?? []
  const takeProfits = trade.takeProfits ?? []

  const totalEntrySize = entries.reduce((s, e) => s + e.size, 0)
  const totalTPSize    = takeProfits.reduce((s, t) => s + t.size, 0)

  return (
    <Modal open onClose={onClose} title={
      <span className="flex items-center gap-2">
        {trade.asset} · {formatDate(trade.date)}{trade.time ? ` · ${trade.time} UTC` : ''}
        {trade.infoUnavailable ? (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-md" style={{ background: 'var(--c-bg-input)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}
            title="No notes or charts from the time, so setup, rules and mistakes stay empty. Not counted as needing info.">
            No info from the time
          </span>
        ) : null}
        {isCompounded && (
          <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md"
            style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24' }}>
            <Layers size={9} /> Compounded
          </span>
        )}
      </span>
    } size="lg">
      <div className="p-5 space-y-5">

        {/* ── Header stats ──────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-bg-secondary rounded-lg p-3 text-center">
            <div className="text-xs text-text-muted mb-1">P&L</div>
            <PnLBadge value={trade.netPnl ?? trade.realizedPnl} className="text-xl" />
          </div>
          <div className="bg-bg-secondary rounded-lg p-3 text-center">
            <div className="text-xs text-text-muted mb-1">R:R</div>
            <RRBadge value={trade.rrRatio} />
          </div>
          <div className="bg-bg-secondary rounded-lg p-3 text-center">
            <div className="text-xs text-text-muted mb-1">Deviation</div>
            <DeviationBadge value={trade.deviationPct} />
          </div>
        </div>

        {/* ── Compounded: Entry Legs ────────────────────────────────── */}
        {isCompounded && entries.length > 0 && (
          <div>
            <SectionLabel>Entry legs</SectionLabel>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--c-border)', background: 'var(--c-bg-input)' }}>
                    {['#', 'Entry Price', 'Size', 'SL moved to', 'Weight'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: h === 'SL moved to' ? 'rgba(248,113,113,0.7)' : 'var(--c-text-3)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => {
                    const weight = totalEntrySize > 0 ? ((e.size / totalEntrySize) * 100).toFixed(1) : '--'
                    return (
                      <tr key={i} style={{ borderBottom: i < entries.length - 1 ? '1px solid var(--c-border)' : undefined }}>
                        <td className="px-3 py-2 text-xs num" style={{ color: 'var(--c-text-3)' }}>#{i + 1}</td>
                        <td className="px-3 py-2 text-sm num font-medium" style={{ color: 'var(--c-text-1)' }}>${e.price.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                        <td className="px-3 py-2 text-sm num" style={{ color: 'var(--c-text-2)' }}>{fmtSize(e.size, trade.instrument)}</td>
                        <td className="px-3 py-2 text-sm num" style={{ color: e.sl != null ? 'var(--c-loss)' : 'var(--c-text-3)' }}>
                          {e.sl != null ? `$${e.sl.toLocaleString(undefined, { maximumFractionDigits: 6 })}` : '--'}
                        </td>
                        <td className="px-3 py-2 text-xs num" style={{ color: 'var(--c-text-3)' }}>{weight}%</td>
                      </tr>
                    )
                  })}
                  {/* Avg row */}
                  <tr style={{ background: 'rgba(251,191,36,0.06)', borderTop: '1px solid rgba(251,191,36,0.15)' }}>
                    <td className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#fbbf24' }}>Avg</td>
                    <td className="px-3 py-2 text-sm num font-bold" style={{ color: '#fbbf24' }}>${trade.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                    <td className="px-3 py-2 text-sm num font-bold" style={{ color: '#fbbf24' }}>{fmtSize(totalEntrySize, trade.instrument)}</td>
                    <td className="px-3 py-2 text-xs num" style={{ color: 'var(--c-text-3)' }}>
                      {/* Last SL = current active stop */}
                      {trade.stopLoss != null ? `$${trade.stopLoss.toLocaleString(undefined, { maximumFractionDigits: 6 })}` : '--'}
                    </td>
                    <td className="px-3 py-2" />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Compounded: TP Legs ───────────────────────────────────── */}
        {isCompounded && takeProfits.length > 0 && (
          <div>
            <SectionLabel>Take-profit legs</SectionLabel>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--c-border)', background: 'var(--c-bg-input)' }}>
                    {['#', 'Price', 'Size', 'Weight'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {takeProfits.map((t, i) => {
                    const weight = totalTPSize > 0 ? ((t.size / totalTPSize) * 100).toFixed(1) : '--'
                    return (
                      <tr key={i} style={{ borderBottom: i < takeProfits.length - 1 ? '1px solid var(--c-border)' : undefined }}>
                        <td className="px-3 py-2 text-xs num" style={{ color: 'var(--c-text-3)' }}>TP{i + 1}</td>
                        <td className="px-3 py-2 text-sm num font-medium" style={{ color: 'var(--c-profit)' }}>${t.price.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                        <td className="px-3 py-2 text-sm num" style={{ color: 'var(--c-text-2)' }}>{fmtSize(t.size, trade.instrument)}</td>
                        <td className="px-3 py-2 text-xs num" style={{ color: 'var(--c-text-3)' }}>{weight}%</td>
                      </tr>
                    )
                  })}
                  {/* Avg row */}
                  {trade.exitPrice != null && (
                    <tr style={{ background: 'rgba(52,211,153,0.06)', borderTop: '1px solid rgba(52,211,153,0.15)' }}>
                      <td className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-profit)' }} colSpan={1}>Avg</td>
                      <td className="px-3 py-2 text-sm num font-bold" style={{ color: 'var(--c-profit)' }}>${trade.exitPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                      <td className="px-3 py-2 text-sm num font-bold" style={{ color: 'var(--c-profit)' }}>{fmtSize(totalTPSize, trade.instrument)}</td>
                      <td className="px-3 py-2" />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <RiskPlanner trade={trade} />

        {/* ── Trade details grid ────────────────────────────────────── */}
        <div>
          {!isCompounded && <SectionLabel>Details</SectionLabel>}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {[
              ['Instrument', trade.instrument],
              ['Direction', <Badge variant={trade.direction === 'Long' ? 'green' : 'red'}>{trade.direction}</Badge>],
              ['Order Type', trade.orderType],
              ['Rules Met', <Badge variant={trade.rulesMet ? 'green' : 'red'}>{trade.rulesMet ? 'Yes' : 'No'}</Badge>],
              ['Entry', isCompounded ? `${fmtPrice(trade.entryPrice)} (avg)` : fmtPrice(trade.entryPrice)],
              ['Stop Loss', fmtPrice(trade.stopLoss)],
              ['Exit', isCompounded && trade.exitPrice != null
                ? `${fmtPrice(trade.exitPrice)} (avg)`
                : fmtPrice(trade.exitPrice)],
              ['Size', isCompounded ? `${fmtSize(trade.size, trade.instrument)} (total)` : fmtSize(trade.size, trade.instrument)],
              ['Planned risk', fmtView(trade.riskDollars)],
              ['Expected Loss', fmtView(trade.expectedLoss)],
              ...(trade.netPnl != null ? [['Net P&L', fmtView(trade.netPnl)]] : []),
            ].map(([k, v]) => (
              <div key={String(k)} className="flex items-center justify-between py-1 border-b border-bg-border/30">
                <span className="text-text-muted">{k}</span>
                <span className="text-text-primary num">{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Fees breakdown ────────────────────────────────────────── */}
        {(trade.entryFeeAmount != null || trade.exitFeeAmount != null || trade.fundingFeeAmount != null) && (
          <div>
            <SectionLabel>Fees</SectionLabel>
            <div className="grid grid-cols-3 gap-2 text-sm">
              {trade.entryFeeAmount != null && (
                <div className="bg-bg-secondary rounded p-2 text-center">
                  <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Entry fee</div>
                  <div className="num text-text-secondary">{fmt(trade.entryFeeAmount)}</div>
                </div>
              )}
              {trade.exitFeeAmount != null && (
                <div className="bg-bg-secondary rounded p-2 text-center">
                  <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Exit fee</div>
                  <div className="num text-text-secondary">{fmt(trade.exitFeeAmount)}</div>
                </div>
              )}
              {trade.fundingFeeAmount != null && (
                <div className="bg-bg-secondary rounded p-2 text-center">
                  <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Funding fee</div>
                  {/* Same sign as the other fees: positive = paid, negative = received */}
                  <div className="num" style={{ color: trade.fundingFeeAmount > 0 ? 'var(--c-loss)' : trade.fundingFeeAmount < 0 ? 'var(--c-profit)' : undefined }}>
                    {trade.fundingFeeAmount > 0 ? '-' : trade.fundingFeeAmount < 0 ? '+' : ''}{fmt(Math.abs(trade.fundingFeeAmount))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Mistakes ──────────────────────────────────────────────── */}
        {trade.mistakes?.length ? (
          <div>
            <div className="text-xs text-text-muted uppercase tracking-wide mb-2">Mistakes</div>
            <div className="flex flex-wrap gap-1.5">
              {trade.mistakes.map(m => {
                const label = MISTAKES.find(x => x.key === m)?.label || m
                return <Badge key={m} variant="red">{label}</Badge>
              })}
              {trade.mistakesOther && <Badge variant="red">{trade.mistakesOther}</Badge>}
            </div>
          </div>
        ) : null}

        {/* ── Tags ──────────────────────────────────────────────────── */}
        {trade.tags?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {trade.tags.map(t => <Badge key={t} variant="blue">{t}</Badge>)}
          </div>
        ) : null}

        {/* ── Note ──────────────────────────────────────────────────── */}
        {trade.quickNote && (
          <div>
            <div className="text-xs text-text-muted uppercase tracking-wide mb-2">Note</div>
            <p className="text-sm text-text-secondary bg-bg-secondary rounded p-3">{trade.quickNote}</p>
          </div>
        )}

        {/* ── Screenshots ───────────────────────────────────────────── */}
        {trade.screenshots?.length ? (
          <div>
            <div className="text-xs text-text-muted uppercase tracking-wide mb-2">
              Screenshots
              {trade.screenshots.length > 1 && (
                <span className="ml-1.5 normal-case" style={{ color: 'var(--c-text-3)' }}>
                  · click to open · ← → to browse
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {trade.screenshots.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setLightboxIdx(i)}
                  className="rounded-lg overflow-hidden text-left transition-colors border border-[var(--c-border)] hover:border-[var(--c-accent)]"
                >
                  <img src={s.filePath} alt="" className="w-full h-36 object-cover" />
                  {s.note && (
                    <p className="text-xs text-text-muted px-2 py-1 bg-bg-secondary">{s.note}</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Lightbox */}
        {lightboxIdx !== null && trade.screenshots && (
          <ImageViewer images={trade.screenshots} start={lightboxIdx} onClose={() => setLightboxIdx(null)} />
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-bg-border">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={onEdit}><Edit size={13} /> Edit</Button>
        </div>
      </div>
    </Modal>
  )
}
