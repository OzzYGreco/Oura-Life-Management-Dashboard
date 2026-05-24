import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { PnLBadge, RRBadge, DeviationBadge } from '../../components/shared/PnLBadge'
import { formatDate } from '../../lib/utils'
import { useFmtView } from '../../hooks/useFmtView'
import { type Trade } from '../../hooks/useTrades'
import { MISTAKES } from '../../lib/constants'
import { Edit } from 'lucide-react'

interface Props {
  trade: Trade
  onClose: () => void
  onEdit: () => void
}

export function TradeDetailModal({ trade, onClose, onEdit }: Props) {
  const { fmtView } = useFmtView('USD', 'trading')
  return (
    <Modal open onClose={onClose} title={`${trade.asset} · ${formatDate(trade.date)}`} size="lg">
      <div className="p-5 space-y-5">
        {/* Header stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-bg-secondary rounded-lg p-3 text-center">
            <div className="text-xs text-text-muted mb-1">P&L</div>
            <PnLBadge value={trade.realizedPnl} className="text-xl" />
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

        {/* Trade details */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {[
            ['Instrument', trade.instrument],
            ['Direction', <Badge variant={trade.direction === 'Long' ? 'green' : 'red'}>{trade.direction}</Badge>],
            ['Order Type', trade.orderType],
            ['Rules Met', <Badge variant={trade.rulesMet ? 'green' : 'red'}>{trade.rulesMet ? 'Yes' : 'No'}</Badge>],
            ['Entry', trade.entryPrice],
            ['Stop Loss', trade.stopLoss ?? '--'],
            ['Exit', trade.exitPrice ?? '--'],
            ['Size', trade.size],
            ['Risk $', fmtView(trade.riskDollars)],
            ['Expected Loss', fmtView(trade.expectedLoss)],
          ].map(([k, v]) => (
            <div key={String(k)} className="flex items-center justify-between py-1 border-b border-bg-border/30">
              <span className="text-text-muted">{k}</span>
              <span className="text-text-primary num">{v}</span>
            </div>
          ))}
        </div>

        {/* Mistakes */}
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

        {/* Tags */}
        {trade.tags?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {trade.tags.map(t => <Badge key={t} variant="blue">{t}</Badge>)}
          </div>
        ) : null}

        {/* Note */}
        {trade.quickNote && (
          <div>
            <div className="text-xs text-text-muted uppercase tracking-wide mb-2">Note</div>
            <p className="text-sm text-text-secondary bg-bg-secondary rounded p-3">{trade.quickNote}</p>
          </div>
        )}

        {/* Screenshots */}
        {trade.screenshots?.length ? (
          <div>
            <div className="text-xs text-text-muted uppercase tracking-wide mb-2">Screenshots</div>
            <div className="grid grid-cols-2 gap-2">
              {trade.screenshots.map(s => (
                <div key={s.id} className="rounded-lg overflow-hidden border border-bg-border">
                  <img src={s.filePath} alt="" className="w-full h-36 object-cover" />
                  {s.note && <p className="text-xs text-text-muted px-2 py-1 bg-bg-secondary">{s.note}</p>}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2 border-t border-bg-border">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={onEdit}><Edit size={13} /> Edit</Button>
        </div>
      </div>
    </Modal>
  )
}
