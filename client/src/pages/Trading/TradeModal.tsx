import { useEffect, useMemo, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'
import { Button } from '../../components/ui/Button'
import { PriceInput } from '../../components/ui/PriceInput'
import { TagInput } from '../../components/shared/TagInput'
import { ImageUpload } from '../../components/shared/ImageUpload'
import { useCreateTrade, useUpdateTrade, useUploadScreenshots, type Trade } from '../../hooks/useTrades'
import { useTradingAccounts } from '../../hooks/useTradingAccounts'
import { loadTradingSettings, computeFees } from '../../hooks/useTradingSettings'
import { INSTRUMENTS, DIRECTIONS, ORDER_TYPES, MISTAKES } from '../../lib/constants'
import { formatCurrency, cn } from '../../lib/utils'
import { Zap, ChevronRight } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  trade?: Trade | null
  defaultAccountId?: number | null
}

type FormValues = {
  accountId: number | null
  date: string
  time: string
  instrument: string
  asset: string
  direction: string
  orderType: string
  exitOrderType: string
  entryPrice: string
  stopLoss: string
  exitPrice: string
  size: string
  riskDollars: string
  expectedLoss: string
  actualPnl: string
  rulesMet: boolean
  setupLabel: string
  quickNote: string
  mistakes: string[]
  mistakesOther: string
  tags: string[]
}

// ─── Quick Fill Parser ────────────────────────────────────────────────────────
function parseQuickFill(text: string): Partial<FormValues> | null {
  const tokens = text.trim().split(/\s+/)
  if (tokens.length < 2) return null

  // First token that is not a number → asset; remaining tokens are prices
  let assetIdx = -1
  const prices: number[] = []

  for (let i = 0; i < tokens.length; i++) {
    const n = parseFloat(tokens[i].replace(/,/g, ''))
    if (!isNaN(n) && n > 0) {
      prices.push(n)
    } else if (assetIdx === -1) {
      assetIdx = i
    }
  }

  if (prices.length < 1) return null

  const asset = assetIdx !== -1 ? tokens[assetIdx].toUpperCase() : ''
  const entry = prices[0]
  const sl    = prices[1] ?? undefined
  const exit  = prices[2] ?? undefined

  // Auto-detect direction
  let direction: string | undefined
  if (sl !== undefined) {
    direction = sl < entry ? 'Long' : 'Short'
  }

  return {
    asset,
    entryPrice: String(entry),
    stopLoss:   sl   !== undefined ? String(sl)   : '',
    exitPrice:  exit !== undefined ? String(exit) : '',
    ...(direction ? { direction } : {}),
  }
}

// ─── QuickFill Component ──────────────────────────────────────────────────────
function QuickFill({ onClose }: { onClose: () => void }) {
  const create = useCreateTrade()
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<Partial<FormValues> | null>(null)
  const [done, setDone] = useState(false)

  const handleChange = (v: string) => {
    setText(v)
    setPreview(parseQuickFill(v))
    setDone(false)
  }

  const submit = async () => {
    if (!preview) return
    await create.mutateAsync({
      instrument: 'Crypto',
      asset:      preview.asset || '',
      direction:  preview.direction || 'Long',
      orderType:  'Market',
      entryPrice: parseFloat(preview.entryPrice || '0'),
      ...(preview.stopLoss  ? { stopLoss:  parseFloat(preview.stopLoss)  } : {}),
      ...(preview.exitPrice ? { exitPrice: parseFloat(preview.exitPrice) } : {}),
      date: new Date().toISOString().split('T')[0],
      time: new Date().toTimeString().slice(0, 5),
    } as any)
    setDone(true)
    setText('')
    setPreview(null)
    setTimeout(onClose, 600)
  }

  return (
    <div className="p-4 rounded-xl mb-1" style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.18)' }}>
      <div className="flex items-center gap-2 mb-2">
        <Zap size={13} style={{ color: 'var(--c-accent)' }} />
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--c-accent)' }}>Quick Log</span>
        <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>Logs immediately. Edit later for full detail.</span>
      </div>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={e => handleChange(e.target.value)}
          placeholder="e.g.  BTC 65000 64500  or  BTC 65000 64500 65800"
          className="flex-1 rounded-lg px-3 py-2 text-sm outline-none font-mono"
          style={{ background: 'var(--c-bg-input)', border: '1px solid rgba(99,102,241,0.25)', color: 'var(--c-text-1)' }}
          onFocus={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)'; e.currentTarget.style.boxShadow = 'none' }}
          onKeyDown={e => { if (e.key === 'Enter' && preview) { e.preventDefault(); submit() } }}
        />
        <Button
          type="button"
          size="sm"
          disabled={!preview || create.isPending}
          onClick={submit}
        >
          {done ? '✓ Logged' : create.isPending ? '…' : <>Log <ChevronRight size={12} /></>}
        </Button>
      </div>

      {preview && (
        <div className="flex gap-3 mt-2 flex-wrap">
          {preview.asset && <Chip label="Asset" value={preview.asset} />}
          {preview.direction && <Chip label="Direction" value={preview.direction} color={preview.direction === 'Long' ? 'var(--c-profit)' : 'var(--c-loss)'} />}
          {preview.entryPrice && <Chip label="Entry" value={`$${Number(preview.entryPrice).toLocaleString()}`} />}
          {preview.stopLoss && <Chip label="SL" value={`$${Number(preview.stopLoss).toLocaleString()}`} color="var(--c-loss)" />}
          {preview.exitPrice && <Chip label="Exit" value={`$${Number(preview.exitPrice).toLocaleString()}`} color="var(--c-profit)" />}
        </div>
      )}
    </div>
  )
}

function Chip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md"
      style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: color || 'var(--c-text-2)' }}>
      <span style={{ color: 'var(--c-text-3)' }}>{label}:</span> {value}
    </span>
  )
}

// ─── Main TradeModal ──────────────────────────────────────────────────────────
export function TradeModal({ open, onClose, trade, defaultAccountId }: Props) {
  const create = useCreateTrade()
  const update = useUpdateTrade()
  const uploadScreenshots = useUploadScreenshots()
  const { data: accounts } = useTradingAccounts()
  const [images, setImages] = useState<{ file?: File; preview: string; note?: string }[]>([])

  const { register, handleSubmit, watch, control, reset } = useForm<FormValues>({
    defaultValues: {
      accountId: defaultAccountId ?? null,
      date: new Date().toISOString().split('T')[0],
      time: new Date().toTimeString().slice(0, 5),
      instrument: 'Crypto',
      direction: 'Long',
      orderType: 'Market',
      exitOrderType: 'Market',
      actualPnl: '',
      mistakes: [],
      tags: [],
    },
  })

  useEffect(() => {
    if (trade) {
      reset({
        accountId:     trade.accountId ?? defaultAccountId ?? null,
        date:          trade.date,
        time:          trade.time || '',
        instrument:    trade.instrument,
        asset:         trade.asset,
        direction:     trade.direction,
        orderType:     trade.orderType,
        exitOrderType: (trade as any).exitOrderType || 'Market',
        entryPrice:    String(trade.entryPrice),
        stopLoss:      String(trade.stopLoss ?? ''),
        exitPrice:     String(trade.exitPrice ?? ''),
        size:          String(trade.size),
        riskDollars:   String(trade.riskDollars ?? ''),
        expectedLoss:  String(trade.expectedLoss ?? ''),
        actualPnl:     trade.netPnl != null ? String(trade.netPnl) : '',
        rulesMet:      !!trade.rulesMet,
        setupLabel:    trade.setupLabel ?? '',
        quickNote:     trade.quickNote ?? '',
        mistakes:      trade.mistakes ?? [],
        mistakesOther: trade.mistakesOther ?? '',
        tags:          trade.tags ?? [],
      })
      setImages(trade.screenshots?.map(s => ({ preview: s.filePath, note: s.note ?? '' })) || [])
    } else {
      reset({
        accountId: defaultAccountId ?? null,
        date: new Date().toISOString().split('T')[0],
        time: new Date().toTimeString().slice(0, 5),
        instrument: 'Crypto',
        direction: 'Long',
        orderType: 'Market',
        exitOrderType: 'Market',
        mistakes: [],
        tags: [],
      })
      setImages([])
    }
  }, [trade, open])

  const [entry, exit_, size, direction, riskDollars, orderType, exitOrderType, actualPnl] = watch([
    'entryPrice', 'exitPrice', 'size', 'direction', 'riskDollars', 'orderType', 'exitOrderType', 'actualPnl',
  ])

  const computed = useMemo(() => {
    const e = parseFloat(entry), x = parseFloat(exit_), s = parseFloat(size)
    const r = parseFloat(riskDollars)
    if (!e || !x || !s) return null

    const mult = direction === 'Long' ? 1 : -1
    const grossPnl = (x - e) * s * mult

    const settings = loadTradingSettings()
    const { entryFee, exitFee } = computeFees(settings, e, x, s, orderType || 'Market', exitOrderType || 'Market')

    // If user entered their actual broker P&L, back-calculate slippage
    const actual = actualPnl !== '' && actualPnl !== undefined ? parseFloat(actualPnl) : null
    const slippage = actual !== null ? (grossPnl - entryFee - exitFee - actual) : null
    const netPnl = actual !== null ? actual : (grossPnl - entryFee - exitFee)

    const rr = r > 0 ? netPnl / r : null
    const loss = Math.min(grossPnl, 0)
    const dev = r > 0 ? Math.abs((loss / r - 1) * 100) : null

    return { grossPnl, entryFee, exitFee, slippage, netPnl, rr, dev, hasActual: actual !== null }
  }, [entry, exit_, size, direction, riskDollars, orderType, exitOrderType, actualPnl])

  const mistakes = watch('mistakes')


  const onSubmit = async (data: FormValues) => {
    const e = parseFloat(data.entryPrice || '0')
    const x = parseFloat(data.exitPrice || '0')
    const s = parseFloat(data.size || '0')
    const r = parseFloat(data.riskDollars || '0')

    const payload: any = {
      ...data,
      accountId:     data.accountId ?? undefined,
      entryPrice:    e,
      stopLoss:      data.stopLoss ? parseFloat(data.stopLoss) : undefined,
      exitPrice:     x || undefined,
      size:          s || undefined,
      riskDollars:   r || undefined,
      expectedLoss:  data.expectedLoss ? parseFloat(data.expectedLoss) : undefined,
      rulesMet:      data.rulesMet ? 1 : 0,
    }

    if (computed) {
      payload.entryFeeAmount = computed.entryFee
      payload.exitFeeAmount  = computed.exitFee
      payload.slippageAmount = computed.slippage ?? undefined
      payload.netPnl         = computed.netPnl
    }

    let savedTrade: Trade
    if (trade) {
      savedTrade = await update.mutateAsync({ id: trade.id, ...payload })
    } else {
      savedTrade = await create.mutateAsync(payload)
    }
    const newFiles = images.filter(i => i.file).map(i => i.file!)
    const newNotes = images.filter(i => i.file).map(i => i.note || '')
    if (newFiles.length) {
      await uploadScreenshots.mutateAsync({ tradeId: savedTrade.id, files: newFiles, notes: newNotes })
    }
    onClose()
  }

  const isPending = create.isPending || update.isPending

  // Section header helper
  const SectionHeader = ({ label }: { label: string }) => (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: 'var(--c-border)' }} />
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title={trade ? 'Edit Trade' : 'New Trade'} size="xl">
      <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-5">

        {/* ── Quick Fill ─────────────────────────────────────────────── */}
        <QuickFill onClose={onClose} />

        {/* ── Section 1: Trade Info ──────────────────────────────────── */}
        <div>
          <SectionHeader label="Trade Info" />
          <div className="grid grid-cols-4 gap-3">
            {/* Account selector */}
            <Controller name="accountId" control={control} render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Account</label>
                <select
                  value={field.value ?? ''}
                  onChange={e => field.onChange(e.target.value !== '' ? Number(e.target.value) : null)}
                  className="rounded-lg px-3 py-2 text-sm outline-none transition-all duration-150"
                  style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)' }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--c-border-mid)'; e.currentTarget.style.boxShadow = 'none' }}
                >
                  <option value="">No account</option>
                  {accounts?.map(a => (
                    <option key={a.id} value={a.id}>{a.name}{a.broker ? ` · ${a.broker}` : ''}</option>
                  ))}
                </select>
              </div>
            )} />
            <Select label="Instrument" options={INSTRUMENTS.map(v => ({ value: v, label: v }))} {...register('instrument')} />
            <Input label="Asset" placeholder="BTC, ETH, ES, AAPL…" {...register('asset', { required: true })} />
            {/* Direction — explicit YES/NO style */}
            <Controller name="direction" control={control} render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Direction</label>
                <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--c-border-mid)' }}>
                  {(['Long', 'Short'] as const).map(d => (
                    <button key={d} type="button" onClick={() => field.onChange(d)}
                      className="flex-1 py-2 text-sm font-semibold transition-all duration-150"
                      style={field.value === d ? {
                        background: d === 'Long' ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)',
                        color: d === 'Long' ? 'var(--c-profit)' : 'var(--c-loss)',
                      } : { color: 'var(--c-text-3)', background: 'var(--c-bg-input)' }}>
                      {d === 'Long' ? '▲ Long' : '▼ Short'}
                    </button>
                  ))}
                </div>
              </div>
            )} />
            <Select label="Entry Order Type" options={ORDER_TYPES.map(v => ({ value: v, label: v }))} {...register('orderType')} />
            <Select label="Exit Order Type" options={ORDER_TYPES.map(v => ({ value: v, label: v }))} {...register('exitOrderType')} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Date" type="date" {...register('date', { required: true })} />
              <Input label="Time (UTC)" type="time" {...register('time')} />
            </div>
          </div>
        </div>

        {/* ── Section 2: Prices ─────────────────────────────────────── */}
        <div>
          <SectionHeader label="Prices & Size" />
          <div className="grid grid-cols-4 gap-3">
            <Controller name="entryPrice" control={control} render={({ field }) => (
              <PriceInput label="Entry Price" placeholder="0.00" value={field.value} onChange={field.onChange} />
            )} />
            <Controller name="stopLoss" control={control} render={({ field }) => (
              <PriceInput label="Stop Loss" placeholder="0.00" value={field.value} onChange={field.onChange} />
            )} />
            <Controller name="exitPrice" control={control} render={({ field }) => (
              <PriceInput label="Exit Price" placeholder="0.00" value={field.value} onChange={field.onChange} />
            )} />
            <Input label="Size / Lots" type="number" step="any" placeholder="1" {...register('size', { required: true })} />
          </div>
        </div>

        {/* ── Section 3: Risk + Computed ────────────────────────────── */}
        <div>
          <SectionHeader label="Risk & P&L" />
          <div className="grid grid-cols-3 gap-3 mb-3">
            <Controller name="riskDollars" control={control} render={({ field }) => (
              <PriceInput label="Risk ($)" placeholder="0.00" value={field.value} onChange={field.onChange} />
            )} />
            <Controller name="expectedLoss" control={control} render={({ field }) => (
              <PriceInput label="Expected Loss ($)" placeholder="0.00" value={field.value} onChange={field.onChange} />
            )} />
            {/* Actual broker P&L — can be negative, so plain Input */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>
                Actual P&L (broker)
              </label>
              <input
                type="number"
                step="any"
                placeholder="e.g. 41.47"
                {...register('actualPnl')}
                className="rounded-lg px-3 py-2 text-sm num outline-none transition-all duration-150"
                style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--c-border-mid)'; e.currentTarget.style.boxShadow = 'none' }}
              />
              <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>
                Enter to back-calculate slippage
              </span>
            </div>
          </div>

          {computed && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
              {/* Top row: Gross → fees → slippage */}
              <div className="grid grid-cols-4" style={{ borderBottom: '1px solid var(--c-border)' }}>
                {[
                  { label: 'Gross P&L', value: formatCurrency(computed.grossPnl), color: computed.grossPnl >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' },
                  { label: 'Entry Fee', value: `-${formatCurrency(computed.entryFee)}`, color: 'var(--c-text-3)' },
                  { label: 'Exit Fee',  value: `-${formatCurrency(computed.exitFee)}`, color: 'var(--c-text-3)' },
                  {
                    label: computed.hasActual ? 'Slippage (calc.)' : 'Slippage',
                    value: computed.slippage != null ? `${computed.slippage < 0 ? '+' : '-'}${formatCurrency(Math.abs(computed.slippage))}` : '--',
                    color: computed.slippage == null ? 'var(--c-text-3)' : computed.slippage > 0 ? 'var(--c-loss)' : 'var(--c-profit)',
                  },
                ].map(({ label, value, color }, i) => (
                  <div key={label} className="p-3 text-center" style={{ background: 'var(--c-bg-input)', borderRight: i < 3 ? '1px solid var(--c-border)' : undefined }}>
                    <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--c-text-3)' }}>{label}</div>
                    <div className="text-sm num font-semibold" style={{ color }}>{value}</div>
                  </div>
                ))}
              </div>
              {/* Bottom row: Net P&L + R:R + Deviation */}
              <div className="grid grid-cols-3">
                {[
                  { label: computed.hasActual ? 'Net P&L (actual)' : 'Net P&L (est.)', value: formatCurrency(computed.netPnl), color: computed.netPnl >= 0 ? 'var(--c-profit)' : 'var(--c-loss)', big: true },
                  { label: 'R:R Ratio', value: computed.rr != null ? `${computed.rr >= 0 ? '+' : ''}${computed.rr.toFixed(2)}R` : '--', color: computed.rr != null && computed.rr >= 0 ? 'var(--c-profit)' : 'var(--c-loss)', big: false },
                  { label: 'Deviation', value: computed.dev != null ? `${computed.dev.toFixed(1)}%` : '--', color: computed.dev != null && computed.dev <= 10 ? 'var(--c-profit)' : 'var(--c-loss)', big: false },
                ].map(({ label, value, color, big }, i) => (
                  <div key={label} className="p-3 text-center" style={{ borderRight: i < 2 ? '1px solid var(--c-border)' : undefined }}>
                    <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--c-text-3)' }}>{label}</div>
                    <div className={cn('num font-bold', big ? 'text-lg' : 'text-sm')} style={{ color }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Section 4: Rules & Setup ──────────────────────────────── */}
        <div>
          <SectionHeader label="Rules & Setup" />
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Input label="System Name" placeholder="Breakout, ICT, SMC, Mean Rev…" {...register('setupLabel')} />

            {/* Rules Met — clear YES / NO pill toggle */}
            <Controller name="rulesMet" control={control} render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Rules Met?</label>
                <div className="flex rounded-lg overflow-hidden h-[38px]" style={{ border: '1px solid var(--c-border-mid)' }}>
                  <button type="button" onClick={() => field.onChange(false)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold transition-all duration-150"
                    style={!field.value ? {
                      background: 'rgba(248,113,113,0.15)',
                      color: 'var(--c-loss)',
                      borderRight: '1px solid rgba(248,113,113,0.2)',
                    } : { color: 'var(--c-text-3)', background: 'var(--c-bg-input)', borderRight: '1px solid var(--c-border)' }}>
                    <span style={{ fontSize: 15 }}>✗</span> No
                  </button>
                  <button type="button" onClick={() => field.onChange(true)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold transition-all duration-150"
                    style={field.value ? {
                      background: 'rgba(52,211,153,0.15)',
                      color: 'var(--c-profit)',
                    } : { color: 'var(--c-text-3)', background: 'var(--c-bg-input)' }}>
                    <span style={{ fontSize: 15 }}>✓</span> Yes
                  </button>
                </div>
              </div>
            )} />
          </div>
          <Controller name="tags" control={control} render={({ field }) => (
            <TagInput value={field.value} onChange={field.onChange} label="Tags" placeholder="breakout, trend, reversal…" />
          )} />
        </div>

        {/* ── Section 5: Mistakes ───────────────────────────────────── */}
        <div>
          <SectionHeader label="Mistakes" />
          <Controller name="mistakes" control={control} render={({ field }) => (
            <div className="grid grid-cols-3 gap-2">
              {MISTAKES.map(m => {
                const selected = field.value?.includes(m.key)
                return (
                  <button key={m.key} type="button"
                    onClick={() => field.onChange(selected
                      ? field.value.filter((k: string) => k !== m.key)
                      : [...(field.value || []), m.key]
                    )}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-all duration-150"
                    style={selected ? {
                      background: 'rgba(248,113,113,0.12)',
                      border: '1px solid rgba(248,113,113,0.3)',
                      color: 'var(--c-loss)',
                    } : {
                      background: 'var(--c-bg-input)',
                      border: '1px solid var(--c-border-mid)',
                      color: 'var(--c-text-3)',
                    }}>
                    <span className="w-4 h-4 rounded flex items-center justify-center shrink-0 text-xs"
                      style={selected ? { background: 'rgba(248,113,113,0.3)' } : { background: 'var(--c-border)' }}>
                      {selected ? '✗' : ''}
                    </span>
                    {m.label}
                  </button>
                )
              })}
            </div>
          )} />
          {mistakes?.includes('other') && (
            <div className="mt-2">
              <Input placeholder="Describe the mistake…" {...register('mistakesOther')} />
            </div>
          )}
        </div>

        {/* ── Section 6: Notes & Screenshots ───────────────────────── */}
        <div>
          <SectionHeader label="Notes & Screenshots" />
          <Textarea label="Quick Note" rows={3} placeholder="Setup context, execution notes, what you'd do differently…" {...register('quickNote')} />
          <div className="mt-3">
            <ImageUpload images={images} onChange={setImages} label="Screenshots" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3" style={{ borderTop: '1px solid var(--c-border)' }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : trade ? 'Save Changes' : 'Log Trade'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
