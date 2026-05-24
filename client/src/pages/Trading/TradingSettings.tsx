import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useTradingSettings, type TradingSettings } from '../../hooks/useTradingSettings'
import { Info } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
}

export function TradingSettingsModal({ open, onClose }: Props) {
  const { settings, save } = useTradingSettings()
  const { register, handleSubmit } = useForm<TradingSettings>({ values: settings })

  const onSubmit = (data: TradingSettings) => {
    save({
      makerFeePercent:   Number(data.makerFeePercent),
      takerFeePercent:   Number(data.takerFeePercent),
      cryptoMinPosition: Number(data.cryptoMinPosition),
      stocksLotSize:     Number(data.stocksLotSize),
      futuresTickValue:  Number(data.futuresTickValue),
    })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Trading Settings" size="sm">
      <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-5">

        <section>
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--c-accent)' }}>Fees</span>
            <div className="flex-1 h-px" style={{ background: 'var(--c-border)' }} />
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Maker Fee (%)" type="number" step="0.00001" placeholder="0.02000" {...register('makerFeePercent')} />
              <Input label="Taker Fee (%)" type="number" step="0.00001" placeholder="0.05000" {...register('takerFeePercent')} />
            </div>
          </div>
          <p className="flex items-start gap-1.5 mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--c-text-3)' }}>
            <Info size={11} className="mt-0.5 shrink-0" style={{ color: 'var(--c-accent)' }} />
            Maker = Limit orders, Taker = Market orders. Slippage is calculated per-trade from your actual broker P&L.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--c-accent)' }}>Position Sizing</span>
            <div className="flex-1 h-px" style={{ background: 'var(--c-border)' }} />
          </div>
          <div className="space-y-3">
            <Input label="Crypto: Min Position Size" type="number" step="any" placeholder="0.001" {...register('cryptoMinPosition')} />
            <Input label="Stocks: Lot Size (shares)" type="number" step="0.1" placeholder="1.0" {...register('stocksLotSize')} />
            <Input label="Futures: Tick / Point Value ($)" type="number" step="any" placeholder="50" {...register('futuresTickValue')} />
          </div>
        </section>

        <div className="flex justify-end gap-3 pt-1 border-t" style={{ borderColor: 'var(--c-border)' }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save Settings</Button>
        </div>
      </form>
    </Modal>
  )
}
