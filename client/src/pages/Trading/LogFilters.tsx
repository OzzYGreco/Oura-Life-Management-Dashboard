import { useMemo, useState } from 'react'
import { useIsNext } from '../../skins/isNext'
import type { Trade } from '../../hooks/useTrades'
import { MAX_DEVIATION_PCT } from '../../components/shared/PnLBadge'
import { isClosed, outcomeOf } from '../../lib/tradeStats'
import { CoinBadge } from './ui'
import { Popover } from './controls'
import { Search, ChevronDown, X } from 'lucide-react'

export interface LogFilter {
  q: string
  result: 'win' | 'loss' | 'be' | 'running' | null
  dir: 'Long' | 'Short' | null
  setup: string | null
  coin: string | null
  ruleBreak: boolean
  noChart: boolean
}
export const NO_FILTER: LogFilter = { q: '', result: null, dir: null, setup: null, coin: null, ruleBreak: false, noChart: false }
const NO_SETUP = '— no setup —'

const resultOf = (t: Trade) => (isClosed(t) ? outcomeOf(t) : 'running')
const broke = (t: Trade) => (t.deviationPct ?? 0) > MAX_DEVIATION_PCT
const noChart = (t: Trade) => !(t.screenshots?.length)

/** Every test but the one named, so each chip can count what it would show. */
function passes(t: Trade, f: LogFilter, skip?: keyof LogFilter) {
  const q = f.q.trim().toLowerCase()
  if (skip !== 'q' && q && ![t.asset, t.setupLabel, t.quickNote, t.direction, ...(t.mistakes ?? [])].some(x => x?.toLowerCase().includes(q))) return false
  if (skip !== 'result' && f.result && resultOf(t) !== f.result) return false
  if (skip !== 'dir' && f.dir && t.direction !== f.dir) return false
  if (skip !== 'setup' && f.setup && (t.setupLabel?.trim() || NO_SETUP) !== f.setup) return false
  if (skip !== 'coin' && f.coin && t.asset !== f.coin) return false
  if (skip !== 'ruleBreak' && f.ruleBreak && !broke(t)) return false
  if (skip !== 'noChart' && f.noChart && !noChart(t)) return false
  return true
}

export const applyLogFilter = (ts: Trade[], f: LogFilter) => ts.filter(t => passes(t, f))
export const isFiltered = (f: LogFilter) => JSON.stringify(f) !== JSON.stringify(NO_FILTER)

export function LogFilters({ trades, value: f, onChange }: { trades: Trade[]; value: LogFilter; onChange: (f: LogFilter) => void }) {
  const count = (skip: keyof LogFilter, test: (t: Trade) => boolean) => trades.filter(t => passes(t, f, skip) && test(t)).length
  const set = <K extends keyof LogFilter>(k: K, v: LogFilter[K]) => onChange({ ...f, [k]: f[k] === v ? NO_FILTER[k] : v })

  const setups = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of trades) if (passes(t, f, 'setup')) { const k = t.setupLabel?.trim() || NO_SETUP; m.set(k, (m.get(k) ?? 0) + 1) }
    return [...m].sort((a, b) => b[1] - a[1])
  }, [trades, f])
  const coins = useMemo(() => {
    const m = new Map<string, { n: number; instrument: string }>()
    for (const t of trades) if (passes(t, f, 'coin')) m.set(t.asset, { n: (m.get(t.asset)?.n ?? 0) + 1, instrument: t.instrument })
    return [...m].sort((a, b) => b[1].n - a[1].n)
  }, [trades, f])

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-5">
      <label className="flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-xl text-xs w-52" style={{ background: 'var(--c-bg-input)', boxShadow: 'inset 0 0 0 1px var(--c-border)' }}>
        <Search size={13} style={{ color: 'var(--c-text-3)' }} />
        <input value={f.q} onChange={e => onChange({ ...f, q: e.target.value })} placeholder="Search coin, setup, note…"
          className="flex-1 min-w-0 bg-transparent outline-none" style={{ color: 'var(--c-text-1)' }} />
        {f.q && <button onClick={() => onChange({ ...f, q: '' })} style={{ color: 'var(--c-text-3)' }}><X size={12} /></button>}
      </label>

      <Sep />
      <Chip on={f.result === 'win'} dot="var(--c-profit)" label="Wins" n={count('result', t => resultOf(t) === 'win')} onClick={() => set('result', 'win')} />
      <Chip on={f.result === 'loss'} dot="var(--c-loss)" label="Losses" n={count('result', t => resultOf(t) === 'loss')} onClick={() => set('result', 'loss')} />
      <Chip on={f.result === 'be'} dot="var(--c-text-3)" label="Scratches" n={count('result', t => resultOf(t) === 'be')} onClick={() => set('result', 'be')} />
      {count('result', t => resultOf(t) === 'running') > 0 && (
        <Chip on={f.result === 'running'} dot="var(--c-accent)" label="Running" n={count('result', t => resultOf(t) === 'running')} onClick={() => set('result', 'running')} />
      )}
      <Sep />
      <Chip on={f.dir === 'Long'} label="Long" n={count('dir', t => t.direction === 'Long')} onClick={() => set('dir', 'Long')} />
      <Chip on={f.dir === 'Short'} label="Short" n={count('dir', t => t.direction === 'Short')} onClick={() => set('dir', 'Short')} />
      <Sep />

      <Popover align="left" width={300} trigger={(open, toggle) => (
        <Chip on={!!f.setup} label={f.setup ?? 'Setup'} caret onClick={toggle} active={open} />
      )}>
        {close => <ListMenu items={setups.map(([k, n]) => ({ key: k, label: k, n }))} value={f.setup} onPick={k => { set('setup', k); close() }} placeholder="Find a setup…" />}
      </Popover>
      <Popover align="left" width={240} trigger={(open, toggle) => (
        <Chip on={!!f.coin} label={f.coin ?? 'Coin'} caret onClick={toggle} active={open}
          icon={f.coin ? <CoinBadge asset={f.coin} instrument={coins.find(c => c[0] === f.coin)?.[1].instrument} size={16} /> : undefined} />
      )}>
        {close => <ListMenu items={coins.map(([k, v]) => ({ key: k, label: k, n: v.n, icon: <CoinBadge asset={k} instrument={v.instrument} size={18} /> }))} value={f.coin} onPick={k => { set('coin', k); close() }} placeholder="Find a coin…" />}
      </Popover>
      <Sep />
      <Chip on={f.ruleBreak} dot="var(--c-loss)" label="Rule breaks" n={count('ruleBreak', broke)} onClick={() => onChange({ ...f, ruleBreak: !f.ruleBreak })} />
      <Chip on={f.noChart} label="No chart" n={count('noChart', noChart)} onClick={() => onChange({ ...f, noChart: !f.noChart })} />

      {isFiltered(f) && (
        <button onClick={() => onChange(NO_FILTER)} className="ml-1 text-xs hover:underline" style={{ color: 'var(--c-accent)' }}>Clear</button>
      )}
    </div>
  )
}

function Sep() {
  const nx = useIsNext()
  return nx ? <span className="tr-sep" /> : <span className="w-px h-4 mx-1" style={{ background: 'var(--c-border-mid)' }} />
}

function Chip({ on, label, n, dot, icon, caret, active, onClick }: {
  on: boolean; label: string; n?: number; dot?: string; icon?: React.ReactNode; caret?: boolean; active?: boolean; onClick: () => void
}) {
  const dim = n === 0 && !on
  const nx = useIsNext()
  if (nx) {
    return (
      <button type="button" onClick={onClick} disabled={dim} aria-pressed={on} className={`tr-chip ${on ? 'on' : ''} ${active ? 'act' : ''}`}>
        {icon}
        {dot && <i style={{ background: dot }} />}
        <span className="lb">{label}</span>
        {n != null && <span className="n num">{n}</span>}
        {caret && <ChevronDown size={12} />}
      </button>
    )
  }
  return (
    <button type="button" onClick={onClick} disabled={dim}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all duration-150 disabled:opacity-35"
      style={on
        ? { background: 'color-mix(in srgb, var(--c-accent) 16%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--c-accent) 45%, transparent)', color: 'var(--c-text-1)' }
        : { background: active ? 'var(--c-bg-hover)' : 'transparent', boxShadow: 'inset 0 0 0 1px var(--c-border)', color: 'var(--c-text-2)' }}>
      {icon}
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />}
      <span className="max-w-[160px] truncate">{label}</span>
      {n != null && <span className="num" style={{ color: 'var(--c-text-3)' }}>{n}</span>}
      {caret && <ChevronDown size={12} style={{ color: 'var(--c-text-3)' }} />}
    </button>
  )
}

function ListMenu({ items, value, onPick, placeholder }: {
  items: { key: string; label: string; n: number; icon?: React.ReactNode }[]; value: string | null; onPick: (k: string) => void; placeholder: string
}) {
  const [q, setQ] = useState('')
  const shown = items.filter(i => i.label.toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      {items.length > 8 && (
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder}
          className="w-full mb-1 px-2.5 py-1.5 rounded-lg text-xs outline-none"
          style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)' }} />
      )}
      <div className="max-h-72 overflow-y-auto">
        {shown.map(i => (
          <button key={i.key} onClick={() => onPick(i.key)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-[var(--c-bg-hover)]"
            style={{ color: value === i.key ? 'var(--c-accent)' : 'var(--c-text-1)' }}>
            {i.icon}
            <span className="flex-1 truncate">{i.label}</span>
            <span className="num" style={{ color: 'var(--c-text-3)' }}>{i.n}</span>
          </button>
        ))}
        {!shown.length && <div className="px-2.5 py-3 text-xs" style={{ color: 'var(--c-text-3)' }}>Nothing matches</div>}
      </div>
    </div>
  )
}
