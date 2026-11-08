import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'
import { Button } from '../../components/ui/Button'
import { PriceInput } from '../../components/ui/PriceInput'
import { TagInput } from '../../components/shared/TagInput'
import { ImageUpload } from '../../components/shared/ImageUpload'
import { useCreateTrade, useUpdateTrade, useUploadScreenshots, useSetupLabels, useDeleteSetupLabel, type Trade } from '../../hooks/useTrades'
import { useTradingAccounts } from '../../hooks/useTradingAccounts'
import { loadTradingSettings, computeFees } from '../../hooks/useTradingSettings'
import { INSTRUMENTS, DIRECTIONS, ORDER_TYPES, MISTAKES } from '../../lib/constants'
import { formatCurrency, fmtSize } from '../../lib/utils'
import { Zap, ChevronRight, Layers, Plus, X, Check, ChevronDown, TrendingUp, TrendingDown } from 'lucide-react'
import { Segmented } from './controls'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { CoinBadge, RBar } from './ui'
import { MAX_DEVIATION_PCT } from '../../components/shared/PnLBadge'

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

// Each entry leg (has SL - you move it when adding); TP legs don't
type EntryLeg = { price: string; size: string; sl: string }
type TPLeg    = { price: string; size: string }

// ─── Quick Fill Parser ────────────────────────────────────────────────────────
function parseQuickFill(text: string): Partial<FormValues> | null {
  const tokens = text.trim().split(/\s+/)
  if (tokens.length < 2) return null

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
    // Same recognition as the form's switch; Crypto if TradingView can't say.
    const sym = (preview.asset || '').trim().toUpperCase()
    const instrument = await api.get(`/api/asset-icons/identify/${encodeURIComponent(sym)}`)
      .then(r => (r.data?.instrument as string | null) ?? 'Crypto').catch(() => (FUTURES_ROOTS.has(sym) ? 'Futures' : 'Crypto'))
    await create.mutateAsync({
      instrument,
      asset:      preview.asset || '',
      direction:  preview.direction || 'Long',
      orderType:  'Market',
      entryPrice: parseFloat(preview.entryPrice || '0'),
      ...(preview.stopLoss  ? { stopLoss:  parseFloat(preview.stopLoss)  } : {}),
      ...(preview.exitPrice ? { exitPrice: parseFloat(preview.exitPrice) } : {}),
      date: new Date().toISOString().split('T')[0],
      time: new Date().toISOString().slice(11, 16),
    } as any)
    setDone(true)
    setText('')
    setPreview(null)
    setTimeout(onClose, 600)
  }

  return (
    <div className="p-4 rounded-xl mb-1" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
      <div className="flex items-center gap-2 mb-2">
        <Zap size={13} style={{ color: 'var(--c-accent)' }} />
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--c-accent)' }}>Quick log</span>
        <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>Logs immediately. Edit later for full detail.</span>
      </div>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={e => handleChange(e.target.value)}
          placeholder="e.g.  BTC 65000 64500  or  BTC 65000 64500 65800"
          className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }}
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

// ─── Entry leg row (price + size + SL moved to) ───────────────────────────────
function EntryLegRow({
  leg, index, total, onChange, onRemove, showHeaders,
}: {
  leg: EntryLeg
  index: number
  total: number
  onChange: (field: 'price' | 'size' | 'sl', value: string) => void
  onRemove: () => void
  showHeaders: boolean
}) {
  const inputBase: React.CSSProperties = {
    background: 'var(--c-bg-input)',
    border: '1px solid var(--c-border-mid)',
    color: 'var(--c-text-1)',
  }
  const slBase: React.CSSProperties = {
    ...inputBase,
    border: '1px solid rgba(248,113,113,0.25)',
  }
  const priceInput = (value: string, onChg: (v: string) => void, style = inputBase) => (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold pointer-events-none num" style={{ color: 'var(--c-text-3)' }}>$</span>
      <input
        type="text" inputMode="decimal" placeholder="0.00"
        value={value}
        onChange={e => onChg(e.target.value.replace(/[^0-9.]/g, ''))}
        className="w-full rounded-lg pl-7 pr-3 py-2 text-sm num outline-none transition-all duration-150"
        style={style}
      />
    </div>
  )

  return (
    <div>
      {showHeaders && (
        <div className="grid gap-2 mb-1" style={{ gridTemplateColumns: '1fr 100px 1fr 28px' }}>
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Entry price</span>
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Size</span>
          <span className="text-[10px] font-semibold uppercase tracking-widest flex items-center gap-1" style={{ color: 'rgba(248,113,113,0.7)' }}>
            SL moved to
            <span className="text-[9px] normal-case font-normal" style={{ color: 'var(--c-text-3)' }}>(after this add)</span>
          </span>
          <span />
        </div>
      )}
      <div className="grid gap-2 items-center" style={{ gridTemplateColumns: '1fr 100px 1fr 28px' }}>
        {priceInput(leg.price, v => onChange('price', v))}
        {/* Size */}
        <input
          type="number" step="any" placeholder="1.0"
          value={leg.size}
          onChange={e => onChange('size', e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm num outline-none transition-all duration-150"
          style={inputBase}
        />
        {/* SL moved to */}
        {priceInput(leg.sl, v => onChange('sl', v), slBase)}
        {/* Remove */}
        <button
          type="button" onClick={onRemove} disabled={total === 1}
          className="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150"
          style={total === 1
            ? { color: 'var(--c-text-3)', opacity: 0.3, cursor: 'not-allowed' }
            : { color: 'var(--c-text-3)', background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)' }}
          title={`Remove entry #${index + 1}`}
        >
          <X size={11} />
        </button>
      </div>
    </div>
  )
}

// ─── TP leg row (price + size only) ──────────────────────────────────────────
function TPLegRow({
  leg, index, total, onChange, onRemove, showHeaders,
}: {
  leg: TPLeg
  index: number
  total: number
  onChange: (field: 'price' | 'size', value: string) => void
  onRemove: () => void
  showHeaders: boolean
}) {
  const inputBase: React.CSSProperties = {
    background: 'var(--c-bg-input)',
    border: '1px solid var(--c-border-mid)',
    color: 'var(--c-text-1)',
  }

  return (
    <div>
      {showHeaders && (
        <div className="grid gap-2 mb-1" style={{ gridTemplateColumns: '1fr 120px 28px' }}>
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>TP Price</span>
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Size</span>
          <span />
        </div>
      )}
      <div className="grid gap-2 items-center" style={{ gridTemplateColumns: '1fr 120px 28px' }}>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold pointer-events-none num" style={{ color: 'var(--c-text-3)' }}>$</span>
          <input
            type="text" inputMode="decimal" placeholder="0.00"
            value={leg.price}
            onChange={e => onChange('price', e.target.value.replace(/[^0-9.]/g, ''))}
            className="w-full rounded-lg pl-7 pr-3 py-2 text-sm num outline-none transition-all duration-150"
            style={inputBase}
          />
        </div>
        <input
          type="number" step="any" placeholder="1.0"
          value={leg.size}
          onChange={e => onChange('size', e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm num outline-none transition-all duration-150"
          style={inputBase}
        />
        <button
          type="button" onClick={onRemove} disabled={total === 1}
          className="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150"
          style={total === 1
            ? { color: 'var(--c-text-3)', opacity: 0.3, cursor: 'not-allowed' }
            : { color: 'var(--c-text-3)', background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)' }}
          title={`Remove TP #${index + 1}`}
        >
          <X size={11} />
        </button>
      </div>
    </div>
  )
}

// ─── Sub-section header (used inside Prices & Size when compounded) ───────────
function SubHeader({ label, onAdd, addLabel }: { label: string; onAdd: () => void; addLabel: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: 'var(--c-border)' }} />
      <button
        type="button"
        onClick={onAdd}
        className="ui-btn secondary sm"
      >
        <Plus size={13} /> {addLabel}
      </button>
    </div>
  )
}

// ─── Summary pill row ─────────────────────────────────────────────────────────
function LegSummary({ items }: { items: { label: string; value: string; highlight?: boolean }[] }) {
  return (
    <div className="flex gap-3 flex-wrap mt-2">
      {items.map(({ label, value, highlight }) => (
        <span key={label} className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md"
          style={{
            background: highlight ? 'rgba(251,191,36,0.08)' : 'var(--c-bg-input)',
            border: `1px solid ${highlight ? 'rgba(251,191,36,0.2)' : 'var(--c-border)'}`,
            color: 'var(--c-text-3)',
          }}>
          {label}:&nbsp;
          <span className="font-semibold num" style={{ color: highlight ? '#fbbf24' : 'var(--c-text-1)' }}>{value}</span>
        </span>
      ))}
    </div>
  )
}

// ─── System Name Combobox ─────────────────────────────────────────────────────
function SystemCombobox({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: string[]
}) {
  const [open, setOpen]         = useState(false)
  const [query, setQuery]       = useState('')
  const [pending, setPending]   = useState<string | null>(null) // label awaiting delete confirm
  const ref                     = useRef<HTMLDivElement>(null)
  const deleteLabel             = useDeleteSetupLabel()

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setPending(null)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const filtered = options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
  const showCreate = query.trim() && !options.some(o => o.toLowerCase() === query.toLowerCase())

  const pick = (v: string) => { onChange(v); setOpen(false); setQuery(''); setPending(null) }

  const handleDelete = (e: React.MouseEvent, label: string) => {
    e.stopPropagation()
    if (pending === label) {
      // Second click - confirm delete
      deleteLabel.mutate(label, {
        onSuccess: () => setPending(null),
      })
    } else {
      setPending(label)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)',
  }

  return (
    <div className="flex flex-col gap-1.5" ref={ref} style={{ position: 'relative' }}>
      <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>System name</label>
      <button type="button" onClick={() => { setOpen(o => !o); setPending(null) }}
        className="h-[38px] w-full flex items-center justify-between px-3 rounded-lg text-sm text-left transition-all"
        style={{ ...inputStyle, color: value ? 'var(--c-text-1)' : 'var(--c-text-3)' }}>
        <span className="truncate">{value || 'Select or create a system…'}</span>
        <ChevronDown size={14} style={{ color: 'var(--c-text-3)', flexShrink: 0, marginLeft: 8 }} />
      </button>

      {open && (
        <div className="absolute z-[200] w-full rounded-xl shadow-2xl overflow-hidden"
          style={{ top: 'calc(100% + 4px)', background: 'var(--c-bg-card)', border: '1px solid var(--c-border)', minWidth: 220 }}>
          {/* Search input */}
          <div className="p-2" style={{ borderBottom: '1px solid var(--c-border)' }}>
            <input
              autoFocus
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setPending(null) }}
              placeholder="Search or type new system…"
              className="w-full px-2.5 py-1.5 text-sm rounded-lg outline-none"
              style={inputStyle}
            />
          </div>
          {/* Options list */}
          <div className="overflow-auto" style={{ maxHeight: 220 }}>
            {filtered.map(o => {
              const isSelected  = o === value
              const isPending   = o === pending
              return (
                <div key={o}
                  className={`flex items-center group transition-colors ${isSelected ? 'bg-[var(--c-bg-hover)]' : 'hover:bg-[var(--c-bg-hover)]'}`}>
                  {/* Select area */}
                  <button type="button" onClick={() => pick(o)}
                    className="flex-1 text-left px-3 py-2.5 text-sm flex items-center gap-2.5"
                    style={{ color: isSelected ? 'var(--c-accent)' : 'var(--c-text-1)', background: 'transparent' }}>
                    <span className="w-3 shrink-0">{isSelected && <Check size={12} />}</span>
                    <span className="truncate">{o}</span>
                  </button>
                  {/* Delete button - single click arms it (red), second click confirms */}
                  <button
                    type="button"
                    onClick={e => handleDelete(e, o)}
                    title={isPending ? 'Click again to archive (its trades keep it)' : 'Archive system'}
                    className="shrink-0 mr-2 px-2 py-1 rounded text-xs font-semibold transition-all opacity-0 group-hover:opacity-100"
                    style={{
                      background: isPending ? 'rgba(239,68,68,0.15)' : 'transparent',
                      color: isPending ? '#f87171' : 'var(--c-text-3)',
                      border: isPending ? '1px solid rgba(239,68,68,0.3)' : '1px solid transparent',
                    }}>
                    {isPending ? 'Archive?' : <X size={11} />}
                  </button>
                </div>
              )
            })}
            {showCreate && (
              <button type="button" onClick={() => pick(query.trim())}
                className="w-full text-left px-3 py-2.5 text-sm flex items-center gap-2.5 transition-colors hover:bg-[var(--c-bg-hover)]"
                style={{ color: 'var(--c-accent)', borderTop: '1px solid var(--c-border)' }}>
                <Plus size={12} className="shrink-0" />
                Create &ldquo;{query.trim()}&rdquo;
              </button>
            )}
            {filtered.length === 0 && !showCreate && (
              <div className="px-3 py-4 text-xs text-center" style={{ color: 'var(--c-text-3)' }}>No systems yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main TradeModal ──────────────────────────────────────────────────────────
export function TradeModal({ open, onClose, trade, defaultAccountId }: Props) {
  const create = useCreateTrade()
  const update = useUpdateTrade()
  const uploadScreenshots = useUploadScreenshots()
  const { data: accounts } = useTradingAccounts()
  const { data: setupLabels = [] } = useSetupLabels()
  const [images, setImages] = useState<{ file?: File; preview: string; note?: string }[]>([])

  // ── Compounded state ────────────────────────────────────────────────────────
  const [isCompounded, setIsCompounded] = useState(false)
  const [entries, setEntries]       = useState<EntryLeg[]>([{ price: '', size: '', sl: '' }])
  const [takeProfits, setTakeProfits] = useState<TPLeg[]>([{ price: '', size: '' }])

  const { register, handleSubmit, watch, control, reset, setValue } = useForm<FormValues>({
    defaultValues: {
      accountId: defaultAccountId ?? null,
      date: new Date().toISOString().split('T')[0],
      time: new Date().toISOString().slice(11, 16),
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
      setIsCompounded(!!trade.isCompounded)
      setEntries(
        trade.entries?.length
          ? trade.entries.map(e => ({ price: String(e.price), size: String(e.size), sl: e.sl != null ? String(e.sl) : '' }))
          : [{ price: '', size: '', sl: '' }]
      )
      setTakeProfits(
        trade.takeProfits?.length
          ? trade.takeProfits.map(t => ({ price: String(t.price), size: String(t.size) }))
          : [{ price: '', size: '' }]
      )
      setImages(trade.screenshots?.map(s => ({ preview: s.filePath, note: s.note ?? '' })) || [])
    } else {
      reset({
        accountId: defaultAccountId ?? null,
        date: new Date().toISOString().split('T')[0],
        time: new Date().toISOString().slice(11, 16),
        instrument: 'Crypto',
        direction: 'Long',
        orderType: 'Market',
        exitOrderType: 'Market',
        mistakes: [],
        tags: [],
      })
      setIsCompounded(false)
      setEntries([{ price: '', size: '', sl: '' }])
      setTakeProfits([{ price: '', size: '' }])
      setImages([])
    }
  }, [trade, open])

  const [entry, exit_, size, direction, riskDollars, orderType, exitOrderType, actualPnl, instrument] = watch([
    'entryPrice', 'exitPrice', 'size', 'direction', 'riskDollars', 'orderType', 'exitOrderType', 'actualPnl', 'instrument',
  ])

  // ── Simple trade computed (unchanged) ───────────────────────────────────────
  const computed = useMemo(() => {
    if (isCompounded) return null
    const e = parseFloat(entry), x = parseFloat(exit_), s = parseFloat(size)
    const r = parseFloat(riskDollars)
    if (!e || !x || !s) return null

    const mult = direction === 'Long' ? 1 : -1
    const grossPnl = (x - e) * s * mult

    const settings = loadTradingSettings()
    const { entryFee, exitFee } = computeFees(settings, e, x, s, orderType || 'Market', exitOrderType || 'Market')

    const actual = actualPnl !== '' && actualPnl !== undefined ? parseFloat(actualPnl) : null
    const slippage = actual !== null ? (grossPnl - entryFee - exitFee - actual) : null
    const netPnl = actual !== null ? actual : (grossPnl - entryFee - exitFee)

    const rr = r > 0 ? netPnl / r : null
    const absNet = Math.abs(netPnl)
    const dev = r > 0
      ? (netPnl >= 0 || absNet <= r ? 0 : (absNet - r) / absNet * 100)
      : null

    return { grossPnl, entryFee, exitFee, slippage, netPnl, rr, dev, hasActual: actual !== null }
  }, [isCompounded, entry, exit_, size, direction, riskDollars, orderType, exitOrderType, actualPnl])

  // ── Compounded trade computed ───────────────────────────────────────────────
  const compoundedComputed = useMemo(() => {
    if (!isCompounded) return null

    const validEntries = entries.filter(e => parseFloat(e.price) > 0 && parseFloat(e.size) > 0)
    if (!validEntries.length) return null

    const totalSize = validEntries.reduce((s, e) => s + parseFloat(e.size), 0)
    const avgEntry  = validEntries.reduce((s, e) => s + parseFloat(e.price) * parseFloat(e.size), 0) / totalSize

    // Current SL = the SL set on the last (most recent) entry leg
    const lastSLStr   = validEntries[validEntries.length - 1].sl
    const currentSL   = lastSLStr ? parseFloat(lastSLStr) : NaN
    const mult        = direction === 'Long' ? 1 : -1
    const riskIfStop  = !isNaN(currentSL) && currentSL > 0
      ? (avgEntry - currentSL) * totalSize * mult   // negative = loss if stopped
      : null

    const r = parseFloat(riskDollars)

    // Helper: compute full P&L breakdown given an exit price + closed size
    const computeFromExit = (exitP: number, closedSize: number) => {
      const grossPnl = (exitP - avgEntry) * closedSize * mult
      const settings = loadTradingSettings()
      const { entryFee, exitFee } = computeFees(settings, avgEntry, exitP, totalSize, orderType || 'Market', exitOrderType || 'Market')
      const actual   = actualPnl !== '' && actualPnl !== undefined ? parseFloat(actualPnl) : null
      const slippage = actual !== null ? (grossPnl - entryFee - exitFee - actual) : null
      const netPnl   = actual !== null ? actual : (grossPnl - entryFee - exitFee)
      const rr       = r > 0 ? netPnl / r : null
      const absNet   = Math.abs(netPnl)
      const dev      = r > 0
        ? (netPnl >= 0 || absNet <= r ? 0 : (absNet - r) / absNet * 100)
        : null
      return { grossPnl, entryFee, exitFee, slippage, netPnl, rr, dev, hasActual: actual !== null }
    }

    const validTPs = takeProfits.filter(t => parseFloat(t.price) > 0 && parseFloat(t.size) > 0)

    if (!validTPs.length) {
      // No TP legs - check for manual exit price (SL hit / stopped out)
      const manualExit = parseFloat(exit_)
      if (!manualExit || manualExit <= 0) {
        return { avgEntry, totalSize, currentSL: isNaN(currentSL) ? null : currentSL, riskIfStop, hasTPData: false as const, hasExit: false as const }
      }
      const pnl = computeFromExit(manualExit, totalSize)
      return {
        avgEntry, totalSize, currentSL: isNaN(currentSL) ? null : currentSL, riskIfStop,
        avgExit: manualExit, totalTPSize: totalSize,
        hasTPData: false as const, hasExit: true as const,
        ...pnl,
      }
    }

    // Has TP legs
    const totalTPSize = validTPs.reduce((s, t) => s + parseFloat(t.size), 0)
    const avgExit     = validTPs.reduce((s, t) => s + parseFloat(t.price) * parseFloat(t.size), 0) / totalTPSize
    const pnl = computeFromExit(avgExit, totalTPSize)

    return {
      avgEntry, totalSize, currentSL: isNaN(currentSL) ? null : currentSL, riskIfStop,
      avgExit, totalTPSize,
      hasTPData: true as const, hasExit: true as const,
      ...pnl,
    }
  }, [isCompounded, entries, takeProfits, direction, riskDollars, orderType, exitOrderType, exit_, actualPnl])

  const mistakes = watch('mistakes')

  // ── Instrument follows what TradingView recognises the ticker as ─────────
  // Typing ES flips the switch to Futures, NVDA to Stocks, HYPE to Crypto.
  // Flipping it by hand wins for that ticker and changes nothing else in the
  // form; typing a different ticker hands the switch back to recognition.
  const assetTyped = String(watch('asset') ?? '').trim().toUpperCase()
  const ticker = useDebounced(assetTyped, 500)
  const [pickedFor, setPickedFor] = useState<string | null>(trade ? (trade.asset ?? '').toUpperCase() : null)
  const { data: known, isFetching: identifying, isError: identifyFailed } = useQuery({
    queryKey: ['identify-asset', ticker],
    queryFn: () => api.get(`/api/asset-icons/identify/${encodeURIComponent(ticker)}`).then(r => r.data as { instrument: string | null; name: string | null; exchange: string | null; why: string }),
    enabled: /^[A-Z0-9.!]{1,20}$/.test(ticker),
    staleTime: 3_600_000,
    retry: false,
  })
  const recognised = known?.instrument ?? (identifyFailed && FUTURES_ROOTS.has(ticker) ? 'Futures' : null)
  const handPicked = pickedFor != null && pickedFor === ticker
  useEffect(() => {
    if (!recognised || handPicked || ticker !== assetTyped) return
    if (watch('instrument') !== recognised) setValue('instrument', recognised as FormValues['instrument'])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recognised, handPicked, ticker, assetTyped])

  // ── Leg helpers ─────────────────────────────────────────────────────────────
  const updateEntryLeg = (idx: number, field: 'price' | 'size' | 'sl', value: string) =>
    setEntries(prev => prev.map((leg, i) => i === idx ? { ...leg, [field]: value } : leg))

  const updateTPLeg = (idx: number, field: 'price' | 'size', value: string) =>
    setTakeProfits(prev => prev.map((leg, i) => i === idx ? { ...leg, [field]: value } : leg))

  const removeEntryLeg = (idx: number) => setEntries(prev => prev.filter((_, i) => i !== idx))
  const removeTPLeg    = (idx: number) => setTakeProfits(prev => prev.filter((_, i) => i !== idx))

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 })

  // ── Submit ──────────────────────────────────────────────────────────────────
  const onSubmit = async (data: FormValues) => {
    const r = parseFloat(data.riskDollars || '0')

    const payload: any = {
      ...data,
      accountId:    data.accountId ?? undefined,
      stopLoss:     data.stopLoss ? parseFloat(data.stopLoss) : undefined,
      riskDollars:  r || undefined,
      expectedLoss: data.expectedLoss ? parseFloat(data.expectedLoss) : undefined,
      rulesMet:     data.rulesMet ? 1 : 0,
    }

    if (isCompounded) {
      const validEntries = entries.filter(e => parseFloat(e.price) > 0 && parseFloat(e.size) > 0)
      const validTPs     = takeProfits.filter(t => parseFloat(t.price) > 0 && parseFloat(t.size) > 0)

      const totalSize = validEntries.reduce((s, e) => s + parseFloat(e.size), 0)
      const avgEntry  = totalSize > 0
        ? validEntries.reduce((s, e) => s + parseFloat(e.price) * parseFloat(e.size), 0) / totalSize
        : 0

      // stopLoss = the SL set on the last entry (current active stop)
      const lastLegSL = validEntries.length > 0 ? validEntries[validEntries.length - 1].sl : ''

      payload.isCompounded = 1
      payload.entries      = validEntries.map(e => ({
        price: parseFloat(e.price),
        size:  parseFloat(e.size),
        ...(e.sl ? { sl: parseFloat(e.sl) } : {}),
      }))
      payload.takeProfits  = validTPs.length
        ? validTPs.map(t => ({ price: parseFloat(t.price), size: parseFloat(t.size) }))
        : null
      payload.entryPrice   = avgEntry
      payload.size         = totalSize
      payload.stopLoss     = lastLegSL ? parseFloat(lastLegSL) : undefined

      if (validTPs.length > 0) {
        const totalTPSize = validTPs.reduce((s, t) => s + parseFloat(t.size), 0)
        const avgExit     = validTPs.reduce((s, t) => s + parseFloat(t.price) * parseFloat(t.size), 0) / totalTPSize
        payload.exitPrice = avgExit
      } else {
        // SL hit - use manual exit price if provided
        payload.exitPrice = data.exitPrice ? parseFloat(data.exitPrice) : undefined
      }

      if (compoundedComputed?.hasExit) {
        payload.entryFeeAmount = compoundedComputed.entryFee
        payload.exitFeeAmount  = compoundedComputed.exitFee
        payload.slippageAmount = compoundedComputed.slippage ?? undefined
        payload.netPnl         = compoundedComputed.netPnl
      }
    } else {
      const e = parseFloat(data.entryPrice || '0')
      const x = parseFloat(data.exitPrice || '0')
      const s = parseFloat(data.size || '0')

      payload.isCompounded = 0
      payload.entries      = null
      payload.takeProfits  = null
      payload.entryPrice   = e
      payload.exitPrice    = x || undefined
      payload.size         = s || undefined

      if (computed) {
        payload.entryFeeAmount = computed.entryFee
        payload.exitFeeAmount  = computed.exitFee
        payload.slippageAmount = computed.slippage ?? undefined
        payload.netPnl         = computed.netPnl
      }
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
  const SectionHeader = ({ label, n, children }: { label: string; n?: number; children?: React.ReactNode }) => (
    <div className="flex items-center gap-2.5 mb-3.5">
      {n != null && (
        <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold num"
          style={{ color: 'var(--c-accent)', background: 'color-mix(in srgb, var(--c-accent) 12%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>{n}</span>
      )}
      <span className="text-sm font-semibold" style={{ color: 'var(--c-text-1)' }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: 'var(--c-border)' }} />
      {children}
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title={trade ? 'Edit trade' : 'Log a trade'} size="2xl">
      <form onSubmit={handleSubmit(onSubmit)} className="grid lg:grid-cols-[1fr_320px] min-h-0 overflow-y-auto lg:overflow-hidden">
      <div className="p-6 space-y-7 lg:overflow-y-auto lg:max-h-[calc(90vh-64px)]">

        {/* ── Quick Fill ─────────────────────────────────────────────── */}
        <QuickFill onClose={onClose} />

        {/* ── Section 1: Trade Info ──────────────────────────────────── */}
        <div>
          <SectionHeader n={1} label="The trade" />
          {trade?.source === 'bybit' && (
            <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
              Synced from Bybit: times, prices, size, fees and P&L come from the exchange and stay as Bybit has them.
              What you change here that counts is your planned risk, stop, setup, notes, mistakes and rules.
            </p>
          )}
          <div className="grid grid-cols-4 gap-3">
            {/* Account */}
            <Controller name="accountId" control={control} render={({ field }) => (
              <div className="flex flex-col gap-1.5 col-span-4">
                <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Account</label>
                <Segmented fill value={String(field.value ?? '')} onChange={v => field.onChange(v ? Number(v) : null)}
                  options={[...(accounts ?? []).map(a => ({ value: String(a.id), label: a.name })), { value: '', label: 'None' }]} />
              </div>
            )} />
            <Controller name="instrument" control={control} render={({ field }) => (
              <div className="flex flex-col gap-1.5 col-span-2">
                <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Instrument</label>
                <Segmented fill value={field.value} onChange={v => { setPickedFor(assetTyped || null); field.onChange(v) }} options={INSTRUMENTS.map(v => ({ value: v, label: v }))} />
                <InstrumentHint ticker={ticker} typing={ticker !== assetTyped || identifying} known={known} current={field.value}
                  handPicked={handPicked} onUse={v => { setPickedFor(null); field.onChange(v) }} />
              </div>
            )} />
            <Input label="Asset" placeholder="BTC, ETH, ES, AAPL…" {...register('asset', { required: true })} />
            {/* Direction */}
            <Controller name="direction" control={control} render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Direction</label>
                <div className="ui-seg fill" role="radiogroup" aria-label="Direction">
                  {(['Long', 'Short'] as const).map(d => (
                    <button key={d} type="button" role="radio" aria-checked={field.value === d} onClick={() => field.onChange(d)}
                      className={field.value === d ? `on ${d === 'Long' ? 'good' : 'bad'}` : ''}>
                      {d === 'Long' ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}{d}
                    </button>
                  ))}
                </div>
              </div>
            )} />
            <Select label="Entry order type" options={ORDER_TYPES.map(v => ({ value: v, label: v }))} {...register('orderType')} />
            <Select label="Exit order type" options={ORDER_TYPES.map(v => ({ value: v, label: v }))} {...register('exitOrderType')} />
            <div className="grid grid-cols-2 gap-3 col-span-2">
              <Input label="Date" type="date" {...register('date', { required: true })} />
              <Input label="Time (UTC)" type="time" {...register('time')} />
            </div>
          </div>
        </div>

        {/* ── Section 2: Prices & Size ───────────────────────────────── */}
        <div>
          <SectionHeader n={2} label="Prices and size">
            {/* Compounded toggle */}
            <button
              type="button"
              onClick={() => setIsCompounded(c => !c)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all duration-150"
              style={isCompounded ? {
                background: 'rgba(251,191,36,0.12)',
                border: '1px solid rgba(251,191,36,0.35)',
                color: '#fbbf24',
              } : {
                background: 'var(--c-bg-input)',
                border: '1px solid var(--c-border-mid)',
                color: 'var(--c-text-3)',
              }}
              title="Toggle compounded / pyramided trade mode"
            >
              <Layers size={10} />
              {isCompounded ? 'Compounded' : 'Simple'}
            </button>
          </SectionHeader>

          {isCompounded ? (
            /* ── Compounded mode ──────────────────────────────────────── */
            <div className="space-y-5">

              {/* ── Entries (price + size + SL moved to) ─────────────── */}
              <div>
                <SubHeader
                  label="Entries"
                  onAdd={() => setEntries(prev => [...prev, { price: '', size: '', sl: '' }])}
                  addLabel="Add entry"
                />
                <div className="mt-2 space-y-2">
                  {entries.map((leg, i) => (
                    <EntryLegRow
                      key={i}
                      leg={leg}
                      index={i}
                      total={entries.length}
                      showHeaders={i === 0}
                      onChange={(field, value) => updateEntryLeg(i, field, value)}
                      onRemove={() => removeEntryLeg(i)}
                    />
                  ))}
                </div>
                {compoundedComputed && (
                  <LegSummary items={[
                    { label: 'Avg Entry',   value: `$${fmt(compoundedComputed.avgEntry)}`, highlight: true },
                    { label: 'Total Size',  value: fmtSize(compoundedComputed.totalSize, instrument) },
                    ...(compoundedComputed.currentSL != null ? [
                      { label: 'Current SL', value: `$${fmt(compoundedComputed.currentSL)}` },
                    ] : []),
                    ...(compoundedComputed.riskIfStop != null ? [
                      {
                        label: 'Risk if stopped',
                        value: `${compoundedComputed.riskIfStop > 0 ? '+' : ''}${formatCurrency(compoundedComputed.riskIfStop)}`,
                      },
                    ] : []),
                  ]} />
                )}
              </div>

              {/* ── Take Profits ─────────────────────────────────────── */}
              <div>
                <SubHeader label="Take-profits" onAdd={() => setTakeProfits(prev => [...prev, { price: '', size: '' }])} addLabel="Add take-profit" />
                <div className="mt-2 space-y-2">
                  {takeProfits.map((leg, i) => (
                    <TPLegRow
                      key={i}
                      leg={leg}
                      index={i}
                      total={takeProfits.length}
                      showHeaders={i === 0}
                      onChange={(field, value) => updateTPLeg(i, field, value)}
                      onRemove={() => removeTPLeg(i)}
                    />
                  ))}
                </div>
                {compoundedComputed?.hasTPData && (
                  <LegSummary items={[
                    { label: 'Avg Exit',     value: `$${fmt(compoundedComputed.avgExit)}` },
                    { label: 'Total Closed', value: fmt(compoundedComputed.totalTPSize) },
                  ]} />
                )}
              </div>

              {/* ── Exit / SL Hit ─────────────────────────────────────── */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(248,113,113,0.7)' }}>SL Hit / Exit</span>
                  <div className="flex-1 h-px" style={{ background: 'var(--c-border)' }} />
                  <span className="text-[9px]" style={{ color: 'var(--c-text-3)' }}>Full position stopped out - leave blank when all size closed via TPs above</span>
                </div>
                <Controller name="exitPrice" control={control} render={({ field }) => (
                  <PriceInput label="Exit price (if stopped out)" placeholder="0.00" value={field.value} onChange={field.onChange} />
                )} />
              </div>
            </div>
          ) : (
            /* ── Simple mode (original) ───────────────────────────────── */
            <div className="grid grid-cols-4 gap-3">
              <Controller name="entryPrice" control={control} render={({ field }) => (
                <PriceInput label="Entry price" placeholder="0.00" value={field.value} onChange={field.onChange} />
              )} />
              <Controller name="stopLoss" control={control} render={({ field }) => (
                <PriceInput label="Stop loss" placeholder="0.00" value={field.value} onChange={field.onChange} />
              )} />
              <Controller name="exitPrice" control={control} render={({ field }) => (
                <PriceInput label="Exit price" placeholder="0.00" value={field.value} onChange={field.onChange} />
              )} />
              <Input label="Size or lots" type="number" step="any" placeholder="1" {...register('size', { required: true })} />
            </div>
          )}
        </div>

        {/* ── Section 3: Risk + Computed ────────────────────────────── */}
        <div>
          <SectionHeader n={3} label="Risk" />
          <div className="grid grid-cols-3 gap-3 mb-3">
            <Controller name="riskDollars" control={control} render={({ field }) => (
              <PriceInput label="Risk ($)" placeholder="0.00" value={field.value} onChange={field.onChange} />
            )} />
            <Controller name="expectedLoss" control={control} render={({ field }) => (
              <PriceInput label="Expected loss ($)" placeholder="0.00" value={field.value} onChange={field.onChange} />
            )} />
            {/* Actual broker P&L - shown for both simple and compounded trades */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>
                Actual P&L (broker)
              </label>
              <input
                type="number"
                step="any"
                placeholder="e.g. −426.13"
                {...register('actualPnl')}
                className="rounded-lg px-3 py-2 text-sm num outline-none transition-all duration-150"
                style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }}
              />
              <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>
                Enter to back-calculate slippage
              </span>
            </div>
          </div>

        </div>

        {/* ── Section 4: Rules & Setup ──────────────────────────────── */}
        <div>
          <SectionHeader n={4} label="Setup and rules" />
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Controller name="setupLabel" control={control} render={({ field }) => (
              <SystemCombobox
                value={field.value ?? ''}
                onChange={field.onChange}
                options={setupLabels}
              />
            )} />

            <Controller name="rulesMet" control={control} render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Rules met?</label>
                <div className="ui-seg fill" role="radiogroup" aria-label="Rules met?">
                  <button type="button" role="radio" aria-checked={!field.value} onClick={() => field.onChange(false)} className={!field.value ? 'on bad' : ''}>
                    <X size={14} aria-hidden />No
                  </button>
                  <button type="button" role="radio" aria-checked={!!field.value} onClick={() => field.onChange(true)} className={field.value ? 'on good' : ''}>
                    <Check size={14} aria-hidden />Yes
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
          <SectionHeader n={5} label="Mistakes" />
          <Controller name="mistakes" control={control} render={({ field }) => (
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => field.onChange(field.value && field.value.length === 0 ? null : [])}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={field.value && field.value.length === 0
                  ? { background: 'rgba(52,211,153,0.14)', boxShadow: 'inset 0 0 0 1px rgba(52,211,153,0.4)', color: 'var(--c-profit)' }
                  : { background: 'var(--c-bg-input)', boxShadow: 'inset 0 0 0 1px var(--c-border)', color: 'var(--c-text-3)' }}>
                None
              </button>
              {MISTAKES.map(m => {
                const selected = field.value?.includes(m.key)
                return (
                  <button key={m.key} type="button"
                    onClick={() => field.onChange(selected
                      ? field.value.filter((k: string) => k !== m.key)
                      : [...(field.value || []), m.key]
                    )}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-left transition-all duration-150"
                    style={selected ? {
                      background: 'rgba(248,113,113,0.12)',
                      border: '1px solid rgba(248,113,113,0.3)',
                      color: 'var(--c-loss)',
                    } : {
                      background: 'var(--c-bg-input)',
                      border: '1px solid var(--c-border-mid)',
                      color: 'var(--c-text-3)',
                    }}>
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
          <SectionHeader n={6} label="Notes and charts" />
          <Textarea label="Quick note" rows={3} placeholder="Setup context, execution notes, what you'd do differently…" {...register('quickNote')} />
          <div className="mt-3">
            <ImageUpload images={images} onChange={setImages} label="Screenshots" />
          </div>
        </div>

      </div>

      <TradeTicket
        asset={watch('asset')} direction={direction} instrument={instrument}
        account={accounts?.find(a => a.id === watch('accountId'))?.name ?? null}
        c={isCompounded ? (compoundedComputed?.hasExit ? compoundedComputed : null) : computed}
        risk={riskDollars ? Number(riskDollars) : null}
        saving={isPending} editing={!!trade} onCancel={onClose} />
      </form>
    </Modal>
  )
}

/**
 * The live summary beside the form: what this trade is and what it did,
 * recomputed as you type. Save lives here, so it's always in reach.
 */
/** CME, CBOT, NYMEX, COMEX and ICE roots, minis and micros included. */
const FUTURES_ROOTS = new Set(('ES MES NQ MNQ YM MYM RTY M2K EMD NKD CL MCL QM BZ NG QG RB HO GC MGC SI SIL HG MHG PL PA ' +
  'ZB ZN ZF ZT UB TN ZC ZS ZW ZM ZL ZO KE LE HE GF 6E M6E 6J 6B M6B 6A M6A 6C 6S 6N 6M DX VX BTC1! MBT ETH1! MET').split(' '))

/** One line under the switch: what TradingView says, and a way back if you overrode it. */
function InstrumentHint({ ticker, typing, known, current, handPicked, onUse }: {
  ticker: string; typing: boolean; known?: { instrument: string | null; name: string | null; exchange: string | null; why: string }
  current: string; handPicked: boolean; onUse: (v: string) => void
}) {
  if (!ticker) return null
  if (typing) return <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>Looking up {ticker}…</span>
  if (!known?.instrument) return <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>TradingView doesn't know {ticker}; pick the instrument yourself</span>
  const what = known.name ? `${known.name}${known.exchange ? ` · ${known.exchange}` : ''}` : known.why
  if (known.instrument !== current && handPicked) {
    return (
      <span className="text-[10px]" style={{ color: '#f59e0b' }}>
        TradingView has {ticker} as {known.instrument.toLowerCase()} ({what}); keeping {current.toLowerCase()}.{' '}
        <button type="button" onClick={() => onUse(known.instrument!)} className="underline">Use {known.instrument}</button>
      </span>
    )
  }
  return <span className="text-[10px] truncate" style={{ color: 'var(--c-text-3)' }}>✓ {what}</span>
}

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}

function TradeTicket({ asset: liveAsset, direction, instrument, account, c, risk, saving, editing, onCancel }: {
  asset?: string; direction?: string; instrument?: string; account: string | null
  c: { grossPnl: number; entryFee: number; exitFee: number; slippage: number | null; netPnl: number; rr: number | null; dev: number | null; hasActual: boolean } | null
  risk: number | null; saving: boolean; editing: boolean; onCancel: () => void
}) {
  // Fetch the logo once typing stops, not for every partial ticker.
  const asset = useDebounced(liveAsset?.trim(), 600)
  const long = direction !== 'Short'
  const net = c?.netPnl ?? null
  const dev = c?.dev ?? null
  const row = (k: string, v: string, color?: string) => (
    <div className="flex items-center justify-between py-1.5 text-xs" style={{ borderTop: '1px solid var(--c-border-subtle)' }}>
      <span style={{ color: 'var(--c-text-3)' }}>{k}</span><span className="num" style={{ color: color ?? 'var(--c-text-2)' }}>{v}</span>
    </div>
  )
  return (
    <aside className="flex flex-col p-5 lg:max-h-[calc(90vh-64px)]" style={{ background: 'linear-gradient(180deg, var(--c-bg-elevated), var(--c-bg-card))', borderLeft: '1px solid var(--c-border)' }}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: 'var(--c-text-3)' }}>Ticket</div>
      <div className="flex items-center gap-3">
        {asset ? <CoinBadge asset={asset.toUpperCase()} instrument={instrument} size={38} /> : <span className="w-[38px] h-[38px] rounded-full" style={{ background: 'var(--c-bg-input)', boxShadow: 'inset 0 0 0 1px var(--c-border)' }} />}
        <div>
          <div className="text-lg font-bold leading-tight" style={{ color: 'var(--c-text-1)' }}>{liveAsset?.trim() ? liveAsset.trim().toUpperCase() : 'Asset'}</div>
          <div className="text-xs font-semibold" style={{ color: long ? 'var(--c-profit)' : 'var(--c-loss)' }}>
            {long ? '▲ Long' : '▼ Short'}<span className="font-normal" style={{ color: 'var(--c-text-3)' }}>{account ? ` · ${account}` : ''}</span>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--c-text-3)' }}>{c?.hasActual ? 'Net P&L (broker)' : 'Net P&L (estimated)'}</div>
        <div className="text-3xl font-bold num tracking-tight mt-1" style={{ color: net == null ? 'var(--c-text-3)' : net >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>
          {net == null ? '—' : `${net >= 0 ? '+' : ''}${formatCurrency(net)}`}
        </div>
        <div className="mt-2 flex items-center gap-3" style={{ display: c ? undefined : 'none' }}>
          <RBar r={c?.rr ?? null} width={150} height={7} />
          <span className="text-sm font-semibold num" style={{ color: c?.rr == null ? 'var(--c-text-3)' : c.rr >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>
            {c?.rr == null ? (risk ? '—' : 'set a risk') : `${c.rr >= 0 ? '+' : ''}${c.rr.toFixed(2)}R`}
          </span>
        </div>
        {dev != null && dev > 0 && (
          <div className="mt-2 text-[11px] px-2 py-1 rounded-md inline-block"
            style={dev > MAX_DEVIATION_PCT ? { background: 'rgba(248,113,113,0.12)', color: 'var(--c-loss)' } : { background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
            {dev.toFixed(1)}% past plan · {dev > MAX_DEVIATION_PCT ? 'breaks' : 'within'} your {MAX_DEVIATION_PCT}% rule
          </div>
        )}
      </div>

      <div className="mt-5">
        {c ? <>
          {row('Price move', formatCurrency(c.grossPnl), c.grossPnl >= 0 ? 'var(--c-profit)' : 'var(--c-loss)')}
          {row('Entry fee', `−${formatCurrency(c.entryFee)}`)}
          {row('Exit fee', `−${formatCurrency(c.exitFee)}`)}
          {row(c.hasActual ? 'Slippage (from broker P&L)' : 'Slippage', c.slippage == null ? '—' : `${c.slippage < 0 ? '+' : '−'}${formatCurrency(Math.abs(c.slippage))}`)}
          {row('Planned risk', risk ? formatCurrency(risk) : '—')}
        </> : (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--c-text-3)' }}>Fill in entry, exit and size to see the result, fees and R here as you type.</p>
        )}
      </div>

      <div className="mt-auto pt-6 flex flex-col gap-2">
        <button type="submit" disabled={saving}
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, var(--c-accent), var(--c-accent-2))', boxShadow: 'var(--c-shadow-btn)', color: 'var(--c-on-accent)' }}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Log trade'}
        </button>
        <button type="button" onClick={onCancel} className="w-full py-2 rounded-xl text-xs" style={{ color: 'var(--c-text-3)' }}>Cancel</button>
      </div>
    </aside>
  )
}
