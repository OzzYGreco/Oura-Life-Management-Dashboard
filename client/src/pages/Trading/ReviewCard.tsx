import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { ImageViewer } from '../../components/shared/ImageViewer'
import { useUpdateTrade, useUploadScreenshots, useSetupLabels, type Trade } from '../../hooks/useTrades'
import { useTradingAccounts } from '../../hooks/useTradingAccounts'
import { api } from '../../lib/api'
import { MISTAKES } from '../../lib/constants'
import { formatCurrency, fmtPrice, fmtSize } from '../../lib/utils'
import { BE_R, fmtMinutes, fmtR, isClosed, pnlOf, stopTiming } from '../../lib/tradeStats'
import { ImagePlus, X, Settings2 } from 'lucide-react'
import { CoinBadge, outcomeColor } from './ui'

const MULTIPLES = [0.5, 1, 1.5, 2]
const mLabel = (m: number) => (m === 0.5 ? '½R' : `${m}R`)

interface Shot { id: number; filePath: string }

/** The planned risk to start from, and why, so one click usually confirms it. */
function startingRisk(t: Trade, fullRisk: number | null): { value: number | null; why: string } {
  if (t.riskSource === 'user' && t.riskDollars != null) return { value: t.riskDollars, why: 'as you set it' }
  const timing = stopTiming(t)
  if (fullRisk) {
    if (timing.kind === 'with-entry' && t.riskAtStop) {
      const near = MULTIPLES.map(m => m * fullRisk).reduce((a, b) => Math.abs(b - t.riskAtStop!) < Math.abs(a - t.riskAtStop!) ? b : a)
      return { value: +near.toFixed(2), why: `closest to what the stop risked (${formatCurrency(t.riskAtStop)})` }
    }
    if (timing.kind === 'later') return { value: fullRisk, why: `1R: the stop went in ${fmtMinutes(timing.minutes!)} after the open, so it doesn't show the plan` }
    if (timing.kind === 'none') return { value: fullRisk, why: '1R: there was no stop on Bybit' }
    return { value: fullRisk, why: "1R, the account's full risk" }
  }
  return { value: t.riskAtStop ?? null, why: t.riskAtStop != null ? 'what the stop risked' : '' }
}

interface Props {
  /** The trades to go through, in order. */
  queue: Trade[]
  startId?: number
  onClose: () => void
  onManageSetups: () => void
}

/**
 * The journal side of a trade in one card: what Bybit can't know. Bybit's
 * numbers sit on top as read-only facts. A running trade asks only for the
 * setup, a chart and the planned risk; the rest comes once it has closed.
 */
export function ReviewCard({ queue, startId, onClose, onManageSetups }: Props) {
  const [idx, setIdx] = useState(() => Math.max(0, queue.findIndex(t => t.id === startId)))
  const t = queue[idx]
  if (!t) return null
  return (
    <Modal open onClose={onClose} size="lg"
      title={queue.length > 1 ? `Review · ${idx + 1} of ${queue.length}` : isClosed(t) ? 'Review trade' : 'Running trade'}>
      <CardBody key={t.id} trade={t} hasNext={idx < queue.length - 1}
        onDone={() => (idx < queue.length - 1 ? setIdx(i => i + 1) : onClose())}
        onSkip={idx < queue.length - 1 ? () => setIdx(i => i + 1) : undefined}
        onManageSetups={onManageSetups} />
    </Modal>
  )
}

function CardBody({ trade: t, hasNext, onDone, onSkip, onManageSetups }: {
  trade: Trade; hasNext: boolean; onDone: () => void; onSkip?: () => void; onManageSetups: () => void
}) {
  const qc = useQueryClient()
  const update = useUpdateTrade()
  const upload = useUploadScreenshots()
  const { data: setups = [] } = useSetupLabels()
  const { data: accounts } = useTradingAccounts()
  const account = accounts?.find(a => a.id === t.accountId)
  const fullRisk = account?.fullRisk ?? null
  const closed = isClosed(t)
  const timing = stopTiming(t)
  const start = useMemo(() => startingRisk(t, fullRisk), [t, fullRisk])

  const [setup, setSetup] = useState(t.setupLabel ?? '')
  const [query, setQuery] = useState('')
  const [rules, setRules] = useState<number | null>(t.rulesMet ?? null)
  const [mistakes, setMistakes] = useState<string[] | null>(t.mistakes ?? null)
  const [other, setOther] = useState(t.mistakesOther ?? '')
  const [risk, setRisk] = useState<number | null>(start.value)
  const [customRisk, setCustomRisk] = useState('')
  const [note, setNote] = useState(t.quickNote ?? '')
  const [shots, setShots] = useState<Shot[]>(t.screenshots ?? [])
  const fileRef = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<number | null>(null)

  const addFiles = (files: File[]) => {
    const imgs = files.filter(f => f.type.startsWith('image/'))
    if (!imgs.length) return
    upload.mutate({ tradeId: t.id, files: imgs, notes: imgs.map(() => '') }, {
      onSuccess: (rows: Shot[]) => setShots(s => [...s, ...rows]),
    })
  }

  // ⌘V a chart straight from TradingView or a screenshot tool.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])]
      if (files.some(f => f.type.startsWith('image/'))) { e.preventDefault(); addFiles(files) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const removeShot = async (id: number) => {
    await api.delete(`/api/trades/${t.id}/screenshots/${id}`)
    setShots(s => s.filter(x => x.id !== id))
    qc.invalidateQueries({ queryKey: ['trades'] })
  }

  const pnl = pnlOf(t)
  const liveR = closed && pnl != null && risk ? pnl / risk : null
  const fees = (t.entryFeeAmount ?? 0) + (t.exitFeeAmount ?? 0) + (t.fundingFeeAmount ?? 0)

  const save = () => {
    update.mutate({
      id: t.id,
      setupLabel: setup.trim(),
      quickNote: note,
      ...(closed ? { rulesMet: rules, mistakes: mistakes ?? undefined, mistakesOther: mistakes?.includes('other') ? other : '' } : {}),
      ...(risk != null ? { riskDollars: risk, riskConfirmed: true } : {}),
      ...(closed ? { reviewed: true } : {}),
    } as Partial<Trade> & { id: number }, {
      onSuccess: () => { for (const k of ['trading-setups', 'setup-labels']) qc.invalidateQueries({ queryKey: [k] }); onDone() },
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const q = query.trim().toLowerCase()
  const shown = q ? setups.filter(s => s.toLowerCase().includes(q)) : setups.slice(0, 10)
  const exact = setups.some(s => s.toLowerCase() === q)
  const pickQuery = () => { if (!q) return; setSetup(shown[0] && !exact && shown.length === 1 ? shown[0] : exact ? setups.find(s => s.toLowerCase() === q)! : query.trim()); setQuery('') }

  const toggleMistake = (k: string) => setMistakes(m => {
    const cur = m ?? []
    return cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]
  })

  const chip = (on: boolean, color = 'var(--c-accent)'): React.CSSProperties => ({
    background: on ? color : 'var(--c-bg-input)', color: on ? '#fff' : 'var(--c-text-2)',
    border: `1px solid ${on ? color : 'var(--c-border)'}`,
  })

  return (
    <div className="flex flex-col">
      <div className="p-5 space-y-5 overflow-y-auto">
        {/* ── What happened (Bybit's, read-only) ───────────────────────── */}
        <div className="rounded-xl p-3.5" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="self-center"><CoinBadge asset={t.asset} instrument={t.instrument} size={22} /></span>
            <span className="font-semibold text-text-primary">{t.asset}</span>
            <span className="text-sm font-medium" style={{ color: t.direction === 'Long' ? 'var(--c-profit)' : 'var(--c-loss)' }}>{t.direction}</span>
            {account && <span className="text-xs text-text-muted">· {account.name}</span>}
            <span className="text-xs text-text-muted num">· {t.date} {t.time} UTC{t.durationMinutes != null ? ` · held ${fmtMinutes(t.durationMinutes)}` : ''}</span>
            {closed && pnl != null && (
              <span className="ml-auto num font-semibold" style={{ color: outcomeColor(liveR != null ? (liveR >= BE_R ? 'win' : liveR <= -BE_R ? 'loss' : 'be') : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'be') }}>
                {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}{liveR != null && <span className="text-xs font-medium"> · {fmtR(liveR)}</span>}
              </span>
            )}
            {!closed && <span className="ml-auto text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: 'var(--c-bg-hover)', color: 'var(--c-text-1)' }}>Running</span>}
          </div>
          <div className="mt-1.5 text-xs num text-text-muted flex flex-wrap gap-x-4 gap-y-0.5">
            <span>Entry {fmtPrice(t.entryPrice)}{t.exitPrice != null && <> → exit {fmtPrice(t.exitPrice)}</>}</span>
            <span>Size {fmtSize(t.size, t.instrument)}</span>
            <span>
              {t.stopLoss != null ? <>Stop {fmtPrice(t.stopLoss)}</> : 'No stop'}
              {timing.kind === 'with-entry' && ' · set with the entry'}
              {timing.kind === 'later' && <span style={{ color: 'var(--c-warn, #f59e0b)' }}> · added {fmtMinutes(timing.minutes!)} after the open</span>}
              {t.riskAtStop != null && <> · risked {formatCurrency(t.riskAtStop)} incl. fees</>}
            </span>
            {closed && fees !== 0 && <span>Fees and funding {formatCurrency(fees)}</span>}
          </div>
        </div>

        {/* ── Chart ────────────────────────────────────────────────────── */}
        <Field label="Chart" hint="Paste with ⌘V, or click to add">
          <div className="flex flex-wrap gap-2">
            {shots.map(s => (
              <div key={s.id} className="relative group rounded-lg overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
                <button type="button" onClick={() => setView(shots.indexOf(s))} aria-label="Open chart" className="block">
                  <img src={s.filePath} alt="" className="h-20 w-32 object-cover" />
                </button>
                <button type="button" onClick={() => removeShot(s.id)}
                  className="absolute top-1 right-1 rounded p-0.5 opacity-0 group-hover:opacity-100" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
                  <X size={11} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => fileRef.current?.click()}
              className="h-20 w-32 rounded-lg flex flex-col items-center justify-center gap-1 text-xs"
              style={{ border: '1.5px dashed var(--c-border-mid)', color: 'var(--c-text-3)' }}>
              <ImagePlus size={16} />{upload.isPending ? 'Uploading…' : '⌘V or click'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => { addFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
          </div>
        </Field>
        {view !== null && <ImageViewer images={shots} start={view} onClose={() => setView(null)} />}

        {/* ── Setup ────────────────────────────────────────────────────── */}
        <Field label="Setup" action={
          <button type="button" onClick={onManageSetups} className="flex items-center gap-1 text-[11px] hover:underline" style={{ color: 'var(--c-text-3)' }}>
            <Settings2 size={11} /> Clean up setups
          </button>
        }>
          <div className="flex flex-wrap gap-1.5">
            {setup && !shown.includes(setup) && (
              <button type="button" onClick={() => setSetup('')} className="px-2.5 py-1 rounded-lg text-xs" style={chip(true)}>{setup} ×</button>
            )}
            {shown.map(s => (
              <button key={s} type="button" onClick={() => setSetup(setup === s ? '' : s)} className="px-2.5 py-1 rounded-lg text-xs" style={chip(setup === s)}>{s}</button>
            ))}
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={setups.length > 10 ? 'Find or add…' : 'Add a setup…'}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); pickQuery() } }}
              className="px-2.5 py-1 rounded-lg text-xs outline-none w-36"
              style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)' }} />
            {q && !exact && (
              <button type="button" onClick={() => { setSetup(query.trim()); setQuery('') }} className="px-2 py-1 text-xs hover:underline" style={{ color: 'var(--c-accent)' }}>
                + Add “{query.trim()}”
              </button>
            )}
          </div>
        </Field>

        {/* ── Planned risk ─────────────────────────────────────────────── */}
        <Field label="Planned risk" hint={risk === start.value ? start.why : undefined}>
          <div className="flex flex-wrap items-center gap-1.5">
            {fullRisk != null && MULTIPLES.map(m => {
              const v = +(fullRisk * m).toFixed(2)
              return (
                <button key={m} type="button" onClick={() => { setRisk(v); setCustomRisk('') }}
                  className="px-2.5 py-1 rounded-lg text-xs num" style={chip(risk != null && Math.abs(risk - v) < 0.005)}>
                  {mLabel(m)} <span style={{ opacity: 0.75 }}>{formatCurrency(v)}</span>
                </button>
              )
            })}
            <input value={customRisk} inputMode="decimal" placeholder="other $"
              onChange={e => { setCustomRisk(e.target.value); const n = Number(e.target.value); if (e.target.value && !isNaN(n) && n > 0) setRisk(n) }}
              className="w-20 px-2 py-1 rounded-lg text-xs num outline-none"
              style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)' }} />
            {fullRisk == null && (
              <span className="text-[11px] text-text-muted">Set this account's 1R under Manage accounts for one-click ½R / 1R / 2R.</span>
            )}
          </div>
        </Field>

        {closed && <>
          {/* ── Rules ──────────────────────────────────────────────────── */}
          <Field label="Followed my rules?">
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setRules(rules === 1 ? null : 1)} className="px-4 py-1 rounded-lg text-xs font-medium" style={chip(rules === 1, 'var(--c-profit)')}>Yes</button>
              <button type="button" onClick={() => setRules(rules === 0 ? null : 0)} className="px-4 py-1 rounded-lg text-xs font-medium" style={chip(rules === 0, 'var(--c-loss)')}>No</button>
            </div>
          </Field>

          {/* ── Mistakes ───────────────────────────────────────────────── */}
          <Field label="Mistakes">
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setMistakes(m => (m && m.length === 0 ? null : []))}
                className="px-2.5 py-1 rounded-lg text-xs" style={chip(mistakes != null && mistakes.length === 0, 'var(--c-profit)')}>None</button>
              {MISTAKES.map(m => (
                <button key={m.key} type="button" onClick={() => toggleMistake(m.key)}
                  className="px-2.5 py-1 rounded-lg text-xs" style={chip(!!mistakes?.includes(m.key), 'var(--c-loss)')}>{m.label}</button>
              ))}
            </div>
            {mistakes?.includes('other') && (
              <input value={other} onChange={e => setOther(e.target.value)} placeholder="What went wrong?"
                className="mt-2 w-full px-2.5 py-1.5 rounded-lg text-sm outline-none"
                style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)' }} />
            )}
          </Field>
        </>}

        {/* ── Note ─────────────────────────────────────────────────────── */}
        <Field label="Note" hint="Optional">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder={closed ? "What you'd repeat, or do differently" : 'Why you took it'}
            className="w-full px-2.5 py-1.5 rounded-lg text-sm outline-none resize-y"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)' }} />
        </Field>
      </div>

      <div className="flex items-center gap-3 px-5 py-3" style={{ borderTop: '1px solid var(--c-border)' }}>
        <span className="text-[11px] text-text-muted">{closed ? '⌘↵ to save' : 'Rules and mistakes come once it closes.'}</span>
        <div className="ml-auto flex gap-2">
          {onSkip && <Button variant="secondary" onClick={onSkip}>Skip</Button>}
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : closed ? (hasNext ? 'Done, next' : 'Done') : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, action, children }: { label: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>{label}</span>
        {hint && <span className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>{hint}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </div>
  )
}
