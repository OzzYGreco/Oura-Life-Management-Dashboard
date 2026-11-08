import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from '../../components/ui/Modal'
import { useTradingAccounts } from '../../hooks/useTradingAccounts'
import { useTrades } from '../../hooks/useTrades'
import { accountLimits, fmtLimit } from '../../lib/lossLimits'
import { api } from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import { Copy, Check, ChevronDown } from 'lucide-react'

/**
 * The trader's position size sheet, as it was:
 *   size      = max(min size, round down( (1 + max dev) x risk / (distance + fees per unit) ))
 *   deviation = |loss with fees - risk| / loss with fees      (rule: at most 10%)
 *   leverage  = round up( notional / (portfolio - notional x 0.4%), 0.1 )
 *   funding   = notional x funding rate, + for a long (pays), - for a short
 * Sizing for 1.1 x risk is what keeps the loss with fees inside the 10% rule.
 * One refinement: the entry fee is priced at the entry (the sheet used the stop
 * for both fees); the sheet's own fee rows already did it this way.
 *
 * Learned from the account's own Bybit fills, when there are any:
 *  - fees: what Bybit actually charged on limit (maker) and market (taker)
 *    fills. A stop always exits at market, so the exit pays taker.
 *  - slippage: how far past the trigger this coin's stop-outs have filled,
 *    added to the distance, so a stop-out with a bad fill still stays inside
 *    the rule. Sized for 9 stop-outs in 10 unless set otherwise. The server
 *    weights recent stop-outs most, so it adapts as your fills change.
 */

type EntryKind = 'limit' | 'market'
type SlipMode = 'off' | 'typical' | 'bad'
interface Settings { entryFeePct: number; exitFeePct: number; fundingPct: number; minSize: number; maxDevPct: number; slippagePct: number; entryKind: EntryKind; slipMode: SlipMode }
const DEFAULTS: Settings = { entryFeePct: 0.018, exitFeePct: 0.0495, fundingPct: 0.001, minSize: 0.001, maxDevPct: 10, slippagePct: 0.03, entryKind: 'limit', slipMode: 'bad' }
const KEY = 'oura-size-calculator'
const MULTIPLES = [0.5, 1, 1.5, 2]
const mLabel = (m: number) => (m === 0.5 ? '½R' : `${m}R`)

interface Stored { settings: Settings; portfolio: Record<string, string>; entry: string; stop: string; made: string }
function load(): Stored {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { settings: { ...DEFAULTS, ...s.settings }, portfolio: s.portfolio ?? {}, entry: s.entry ?? '', stop: s.stop ?? '', made: s.made ?? '' }
  } catch { return { settings: DEFAULTS, portfolio: {}, entry: '', stop: '', made: '' } }
}

const num = (s: string) => { const n = Number(String(s).replace(/[,$\s]/g, '')); return String(s).trim() !== '' && isFinite(n) ? n : null }
const decimals = (step: number) => Math.max(0, Math.round(Math.log10(1 / step)))
const roundDown = (x: number, dp: number) => Math.floor(x * 10 ** dp + 1e-9) / 10 ** dp

interface Slip {
  symbol: string; n: number; nEff: number; lastPrice: number; p50: number; p90: number; max: number
  /** Typical fill over the last 10 stop-outs against the ones before. */
  trend: { recent: number; before: number } | null
}
interface FeeRate {
  accountId: number; makerPct: number | null; takerPct: number | null; fills: number
  slippage?: Slip[]; all?: { n: number; p50: number; p90: number } | null; halfLife?: number
  entries?: { n: number; takerShare: number | null }
}

/** The coin this entry is most likely on: the one whose last stop fill is nearest in price (within 30%). */
function slipFor(list: Slip[] | undefined, entry: number | null): Slip | null {
  if (!list?.length || !entry) return null
  const near = list.map(s => ({ s, d: Math.abs(Math.log(entry / s.lastPrice)) })).filter(x => x.d < Math.log(1.3)).sort((a, b) => a.d - b.d)
  return near[0]?.s ?? null
}

export function SizeCalculator({ open, onClose, accountId }: { open: boolean; onClose: () => void; accountId: number | null }) {
  const { data: accounts = [] } = useTradingAccounts()
  const { data: charged = [] } = useQuery({ queryKey: ['bybit-fee-rates'], queryFn: () => api.get('/api/bybit/fee-rates').then(r => r.data as FeeRate[]), staleTime: 600_000 })
  const [stored] = useState(load)
  const [acct, setAcct] = useState<number | null>(accountId ?? accounts.find(a => a.fullRisk)?.id ?? accounts[0]?.id ?? null)
  const account = accounts.find(a => a.id === acct)
  const fullRisk = account?.fullRisk ?? null

  const [settings, setSettings] = useState<Settings>(stored.settings)
  const [portfolios, setPortfolios] = useState<Record<string, string>>(stored.portfolio)
  const [entry, setEntry] = useState(stored.entry)
  const [stop, setStop] = useState(stored.stop)
  const [riskStr, setRiskStr] = useState('')
  const [made, setMade] = useState(stored.made)
  const [showSettings, setShowSettings] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ settings, portfolio: portfolios, entry, stop, made })) } catch { /* private window */ }
  }, [settings, portfolios, entry, stop, made])

  const portfolioStr = portfolios[String(acct)] ?? (account?.startingBalance != null ? String(account.startingBalance) : '')
  const portfolio = num(portfolioStr)
  const E = num(entry), S = num(stop), risk = num(riskStr) ?? fullRisk
  const rate = charged.find(c => c.accountId === acct)
  // Fees: what Bybit charged this account, else the settings. A stop exits at market.
  const makerPct = rate?.makerPct ?? settings.entryFeePct
  const takerPct = rate?.takerPct ?? settings.exitFeePct
  const fromFills = rate?.makerPct != null || rate?.takerPct != null
  const fe = (settings.entryKind === 'market' ? takerPct : makerPct) / 100, fx = takerPct / 100
  // Slippage: this coin's stop-outs on this account, else the setting.
  const coin = slipFor(rate?.slippage, E)
  const learned = coin ?? rate?.all ?? null
  const slipPct = settings.slipMode === 'off' ? 0
    : learned ? (settings.slipMode === 'bad' ? learned.p90 : learned.p50)
    : settings.slipMode === 'bad' ? settings.slippagePct : settings.slippagePct / 2
  // Has the typical fill moved by at least a third, and by a meaningful amount?
  const drift = coin?.trend && Math.abs(coin.trend.recent - coin.trend.before) >= Math.max(0.003, coin.trend.before / 3)
    ? (coin.trend.recent > coin.trend.before ? 'worse' : 'better') : null
  const fs = slipPct / 100
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings(x => ({ ...x, [k]: v }))
  const dp = decimals(settings.minSize)

  let r: null | {
    size: number; long: boolean; dist: number; expLoss: number; entryFee: number; exitFee: number; slip: number; lossFees: number
    deviation: number; leverage: number | null; expR: number; funding: number; notional: number; wonR: number | null; inside: number
  } = null
  if (E && S && risk && risk > 0 && E !== S) {
    const dist = Math.abs(E - S)
    const perUnit = dist + E * fe + S * fx + S * fs
    const size = Math.max(settings.minSize, roundDown(((1 + settings.maxDevPct / 100) * risk) / perUnit, dp))
    const entryFee = size * E * fe, exitFee = size * S * fx, slip = size * S * fs, expLoss = dist * size
    const lossFees = expLoss + entryFee + exitFee + slip
    const notional = size * E
    const long = E > S
    const m = num(made)
    r = {
      size, long, dist, expLoss, entryFee, exitFee, slip, lossFees, notional,
      deviation: Math.abs(lossFees - risk) / lossFees,
      leverage: portfolio && portfolio > notional * 0.004 ? Math.ceil((notional / (portfolio - notional * 0.004)) * 10 - 1e-9) / 10 : null,
      expR: lossFees / risk,
      funding: notional * (settings.fundingPct / 100) * (long ? 1 : -1),
      wonR: m != null ? m / risk : null,
      inside: Math.max(settings.minSize, roundDown(risk / perUnit, dp)),
    }
  }
  const off = r != null && r.deviation * 100 > settings.maxDevPct + 1e-9
  const breaks = off && r!.lossFees > (risk ?? 0)          // over plan: the rule is broken
  const under = off && !breaks                              // size steps leave it well under plan
  // The tightest loss limit left right now, in $, to check the risk against.
  const { data: allTrades = [] } = useTrades({})
  const lim = account ? accountLimits(account, allTrades) : null
  const room = lim?.periods.map(p => ({ p, usd: (p.limit - p.used) * (lim.unit === 'R' ? (fullRisk ?? 0) : 1) })).sort((a, b) => a.usd - b.usd)[0]
  const overLimit = room && r ? r.lossFees > room.usd + 1e-9 : false

  const style = { background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)' }
  const inputCls = 'w-full px-2.5 py-1.5 rounded-lg text-sm num outline-none'
  const lbl = 'text-[10px] font-semibold uppercase tracking-widest mb-1 block'

  return (
    <Modal open={open} onClose={onClose} title="Position size calculator" size="xl">
      <div className="p-5 grid md:grid-cols-2 gap-6 overflow-y-auto">
        {/* ── Inputs ─────────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className={lbl} style={{ color: 'var(--c-text-3)' }}>Account</span>
              <select value={acct ?? ''} onChange={x => { setAcct(Number(x.target.value)); setRiskStr('') }} className={inputCls} style={style}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label>
              <span className={lbl} style={{ color: 'var(--c-text-3)' }}>Portfolio size</span>
              <input value={portfolioStr} onChange={x => setPortfolios(p => ({ ...p, [String(acct)]: x.target.value }))} inputMode="decimal" placeholder="$" className={inputCls} style={style} />
            </label>
            <label>
              <span className={lbl} style={{ color: 'var(--c-text-3)' }}>Entry price</span>
              <input autoFocus value={entry} onChange={x => setEntry(x.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} style={style} />
            </label>
            <label>
              <span className={lbl} style={{ color: 'var(--c-text-3)' }}>Stop loss price</span>
              <input value={stop} onChange={x => setStop(x.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} style={style} />
            </label>
          </div>

          <div>
            <span className={lbl} style={{ color: 'var(--c-text-3)' }}>Desired risk{fullRisk ? ` · 1R = ${formatCurrency(fullRisk)}` : ''}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {fullRisk != null && MULTIPLES.map(m => {
                const v = +(fullRisk * m).toFixed(2), on = risk != null && Math.abs(risk - v) < 0.005
                return (
                  <button key={m} type="button" onClick={() => setRiskStr(String(v))} className="px-2.5 py-1 rounded-lg text-xs num"
                    style={{ background: on ? 'var(--c-accent)' : 'var(--c-bg-input)', color: on ? 'var(--c-on-accent)' : 'var(--c-text-2)', border: '1px solid var(--c-border)' }}>
                    {mLabel(m)} <span style={{ opacity: 0.75 }}>{formatCurrency(v)}</span>
                  </button>
                )
              })}
              <input value={riskStr} onChange={x => setRiskStr(x.target.value)} inputMode="decimal" placeholder={fullRisk ? 'other $' : 'risk $'}
                className="w-24 px-2 py-1 rounded-lg text-xs num outline-none" style={style} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={lbl} style={{ color: 'var(--c-text-3)' }}>Entry order</span>
              <div className="ui-seg fill" role="radiogroup" aria-label="Entry order">
                {([['limit', 'Limit'], ['market', 'Market']] as const).map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={settings.entryKind === k} className={settings.entryKind === k ? 'on' : ''}
                    onClick={() => set('entryKind', k)}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <span className={lbl} style={{ color: 'var(--c-text-3)' }}>Plan for slippage</span>
              <div className="ui-seg fill" role="radiogroup" aria-label="Plan for slippage">
                {([['off', 'None'], ['typical', 'Typical'], ['bad', '9 in 10']] as const).map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={settings.slipMode === k} className={settings.slipMode === k ? 'on' : ''}
                    onClick={() => set('slipMode', k)}>{l}</button>
                ))}
              </div>
            </div>
            <p className="col-span-2 text-[12px] leading-relaxed -mt-1" style={{ color: 'var(--c-text-3)' }}>
              Entry fee {fmtPct(settings.entryKind === 'market' ? takerPct : makerPct)}, stop exit {fmtPct(takerPct)}{fromFills ? ', as Bybit charged you' : ''}. {settings.entryKind === 'limit' && rate?.entries?.takerShare != null && rate.entries.takerShare >= 0.2
                ? <>{Math.round(rate.entries.takerShare * 100)}% of your entries paid the market fee even as limits (they filled instantly). Pick Market if this one will. </>
                : null}
              {settings.slipMode === 'off' ? 'Sized as if the stop fills exactly at its price.'
                : coin ? <>
                    Learned from your {coin.n} {coin.symbol.replace(/USDT$/, '')} stop-out{coin.n === 1 ? '' : 's'}, newest counting most:
                    {' '}{fmtPct(coin.p50)} past the trigger typically, {fmtPct(coin.p90)} or less 9 times in 10. Using {fmtPct(slipPct)}.
                    {coin.nEff < 10 && ' Few of your own yet, so it leans on your other stop-outs.'}
                    {drift && coin.trend && <span style={{ color: drift === 'worse' ? 'var(--c-warn)' : 'var(--c-profit)' }}>
                      {' '}Fills are getting {drift}: {fmtPct(coin.trend.recent)} over your last 10 against {fmtPct(coin.trend.before)} before.</span>}
                  </>
                : learned ? <>No stop-outs near this price, so your typical fill across every coin: using {fmtPct(slipPct)}.</>
                : <>No stop-out history yet, so {fmtPct(slipPct)} from settings.</>}
            </p>
          </div>

          <label className="block">
            <span className={lbl} style={{ color: 'var(--c-text-3)' }}>($) Made <span className="normal-case tracking-normal font-normal">· optional, after it closes</span></span>
            <input value={made} onChange={x => setMade(x.target.value)} inputMode="decimal" placeholder="e.g. 12.40 or -7.10" className={inputCls} style={style} />
          </label>

          {/* ── Settings ─────────────────────────────────────────────────── */}
          <div className="rounded-xl" style={{ border: '1px solid var(--c-border)' }}>
            <button type="button" onClick={() => setShowSettings(v => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-xs" style={{ color: 'var(--c-text-2)' }}>
              <span className="font-semibold uppercase tracking-widest text-[10px]" style={{ color: 'var(--c-text-3)' }}>Settings</span>
              <span className="num" style={{ color: 'var(--c-text-3)' }}>
                {fromFills ? 'fees from your fills' : `entry ${settings.entryFeePct}% · exit ${settings.exitFeePct}%`} · funding {settings.fundingPct}% · min {settings.minSize} · max dev {settings.maxDevPct}%
              </span>
              <ChevronDown size={13} className="ml-auto" style={{ transform: showSettings ? 'rotate(180deg)' : undefined }} />
            </button>
            {showSettings && (
              <div className="px-3 pb-3 grid grid-cols-2 gap-2.5">
                {([
                  ['entryFeePct', 'Entry fee (%)'], ['exitFeePct', 'Exit fee (%)'], ['fundingPct', 'Funding rate (%)'],
                  ['minSize', 'Minimum position size'], ['maxDevPct', 'Max deviation (%)'], ['slippagePct', 'Slippage, no history (%)'],
                ] as [keyof Settings, string][]).map(([k, l]) => (
                  <label key={k}>
                    <span className="text-[10px] mb-0.5 block" style={{ color: 'var(--c-text-3)' }}>{l}</span>
                    <input defaultValue={settings[k]} inputMode="decimal" className="w-full px-2 py-1 rounded text-xs num outline-none" style={style}
                      onChange={x => { const n = num(x.target.value); if (n != null && n >= 0 && (k !== 'minSize' || n > 0)) setSettings(s => ({ ...s, [k]: n })) }} />
                  </label>
                ))}
                {rate && (rate.makerPct != null || rate.takerPct != null) && (
                  <p className="col-span-2 text-[11px] leading-relaxed" style={{ color: 'var(--c-text-3)' }}>
                    Bybit charged {account?.name} {rate.makerPct != null ? `${+rate.makerPct.toFixed(4)}% on limit fills` : ''}
                    {rate.makerPct != null && rate.takerPct != null ? ' and ' : ''}
                    {rate.takerPct != null ? `${+rate.takerPct.toFixed(4)}% on market fills` : ''} over the last 90 days.
                    {' '}These are used instead of the fee settings above.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Results ────────────────────────────────────────────────────── */}
        <div>
          {!r ? (
            <div className="h-full flex items-center justify-center text-sm text-center px-6" style={{ color: 'var(--c-text-3)' }}>
              {!E ? 'Entry required' : !S ? 'Stop loss required' : !risk ? 'Desired risk required' : 'Entry and stop must differ'}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl p-4" style={{ background: 'var(--c-bg-input)', border: `1px solid ${breaks ? 'var(--c-loss)' : 'var(--c-border)'}` }}>
                <div className="flex items-baseline gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Position size</span>
                  <span className="text-3xl font-bold num" style={{ color: 'var(--c-text-1)' }}>{r.size.toFixed(dp)}</span>
                  <button type="button" title="Copy" onClick={() => { navigator.clipboard?.writeText(r!.size.toFixed(dp)); setCopied(true); setTimeout(() => setCopied(false), 1200) }}
                    style={{ color: 'var(--c-text-3)' }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
                  <span className="ml-auto text-sm font-semibold" style={{ color: r.long ? 'var(--c-profit)' : 'var(--c-loss)' }}>{r.long ? 'Long' : 'Short'}</span>
                </div>
                <div className="mt-2 text-sm" style={{ color: breaks ? 'var(--c-loss)' : 'var(--c-text-2)' }}>
                  {breaks
                    ? <>Breaks your {settings.maxDevPct}% rule: the minimum size {settings.minSize} risks {formatCurrency(r.lossFees)} with fees. Widen the risk or skip it.</>
                    : under ? <span style={{ color: '#f59e0b' }}>Size steps of {settings.minSize} leave this {(r.deviation * 100).toFixed(0)}% under plan: you'd lose {formatCurrency(r.lossFees)} with fees.</span>
                    : <>Stopped out, you lose <b style={{ color: 'var(--c-text-1)' }}>{formatCurrency(r.lossFees)}</b> with fees{r.slip > 0 ? ' and slippage' : ''}: {fmtX(r.expR)}R, deviation {(r.deviation * 100).toFixed(1)}% (max {settings.maxDevPct}%).</>}
                </div>
              </div>

              {room && (
                <div className="text-xs px-3 py-2 rounded-lg" style={overLimit
                  ? { background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.35)', color: 'var(--c-loss)' }
                  : { background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
                  {room.p.state === 'hit'
                    ? <>Your {room.p.label.toLowerCase()} loss limit is already hit. No new trades.</>
                    : overLimit
                      ? <>A stop-out ({formatCurrency(r.lossFees)}) would break your {room.p.period === 'day' ? 'daily' : room.p.period === 'week' ? 'weekly' : 'monthly'} limit: only {formatCurrency(room.usd)} left. Size down or skip.</>
                      : <>{formatCurrency(room.usd)} left in your {room.p.period === 'day' ? 'daily' : room.p.period === 'week' ? 'weekly' : 'monthly'} limit ({fmtLimit(room.p.limit - room.p.used, lim!.unit)} of {fmtLimit(room.p.limit, lim!.unit)}). This trade fits.</>}
                </div>
              )}

              <Rows rows={[
                ['Expected loss', formatCurrency(r.expLoss), `${r.dist.toLocaleString(undefined, { maximumFractionDigits: 8 })} × ${r.size.toFixed(dp)}`],
                [r.slip > 0 ? 'Expected loss with fees and slippage' : 'Expected loss with fees', formatCurrency(r.lossFees),
                  `+ ${formatCurrency(r.entryFee)} entry + ${formatCurrency(r.exitFee)} exit${r.slip > 0 ? ` + ${formatCurrency(r.slip)} slippage` : ''}`],
                [`${settings.maxDevPct}% deviation`, `${(r.deviation * 100).toFixed(1)}%`, breaks ? 'over the limit' : under ? 'under plan' : 'within the limit', breaks ? 'var(--c-loss)' : under ? '#f59e0b' : 'var(--c-profit)'],
                ['Leverage', r.leverage != null ? `${r.leverage.toFixed(1)}x` : '—', portfolio ? `on ${formatCurrency(portfolio)}` : 'needs portfolio size'],
                ['Expected (R) lost', `${fmtX(r.expR)} R`, ''],
                ['R won after fees', r.wonR != null ? `${fmtX(r.wonR)} R` : '—', r.wonR != null ? `${formatCurrency(num(made)!)} made` : 'enter $ made'],
                ['Funding fee', formatCurrency(r.funding), `per funding interval, ${r.long ? 'paid' : 'received'} at ${settings.fundingPct}%`],
                ['Notional value', formatCurrency(r.notional), ''],
              ]} />

              {Math.abs(r.inside - r.size) > 1e-12 && (
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--c-text-3)' }}>
                  To keep fees{r.slip > 0 ? ' and slippage' : ''} inside the risk instead (exactly 1R at the stop), size {r.inside.toFixed(dp)}.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

const fmtX = (x: number) => x.toFixed(2)
const fmtPct = (x: number) => `${+x.toFixed(3)}%`

function Rows({ rows }: { rows: [string, string, string, string?][] }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
      {rows.map(([k, v, hint, color], i) => (
        <div key={k} className="grid items-baseline gap-3 px-3 py-2" style={{ gridTemplateColumns: '1fr auto', borderTop: i ? '1px solid var(--c-border)' : undefined }}>
          <div>
            <div className="text-xs" style={{ color: 'var(--c-text-2)' }}>{k}</div>
            {hint && <div className="text-[10px] num" style={{ color: 'var(--c-text-3)' }}>{hint}</div>}
          </div>
          <div className="text-sm num font-semibold text-right" style={{ color: color ?? 'var(--c-text-1)' }}>{v}</div>
        </div>
      ))}
    </div>
  )
}
