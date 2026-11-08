import { useEffect, useRef, useState } from 'react'
import type { Trade } from '../../hooks/useTrades'
import { fmtR, outcomeOf, type Outcome } from '../../lib/tradeStats'

/**
 * Small visual pieces shared by the trading pages: coin badges, the R-bar
 * (where a trade landed between the stop and the targets), the form guide
 * and a count-up for headline numbers.
 */

const COINS: Record<string, string> = {
  BTC: '#f7931a', ETH: '#627eea', SOL: '#9945ff', HYPE: '#50e3c2', XRP: '#23292f', DOGE: '#c2a633',
  ADA: '#0033ad', AVAX: '#e84142', LINK: '#2a5ada', BNB: '#f3ba2f', SUI: '#4da2ff', WIF: '#b07b4f', TAO: '#7d7d7d',
}
const FALLBACK = ['#818cf8', '#f472b6', '#22d3ee', '#fb923c', '#a3e635', '#e879f9']

export function coinColor(asset: string) {
  const a = asset.toUpperCase()
  if (COINS[a]) return COINS[a]
  let h = 0
  for (const c of a) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return FALLBACK[h % FALLBACK.length]
}

/** Assets whose logo failed to load this session: don't ask again. */
const noLogo = new Set<string>()

/** The asset's logo as TradingView shows it (fetched and cached by the server), else a letter badge. */
export function CoinBadge({ asset, instrument = 'Crypto', size = 26 }: { asset: string; instrument?: string; size?: number }) {
  const kind = instrument.toLowerCase()
  const key = `${kind}/${asset.toUpperCase()}`
  // Failure is tracked per asset, so a badge whose asset changes (the trade form) tries again.
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const failed = noLogo.has(key) || failedKey === key
  const c = coinColor(asset)
  if (!failed) {
    return (
      <img src={`/api/asset-icons/${key}?v=tv2`} alt={asset} width={size} height={size} loading="lazy"
        onError={() => { noLogo.add(key); setFailedKey(key) }}
        className="rounded-full shrink-0 object-cover"
        style={{ width: size, height: size, boxShadow: `0 0 0 1px var(--c-border), 0 0 12px ${c}33` }} />
    )
  }
  const GLYPH: Record<string, string> = { BTC: '₿', ETH: 'Ξ', SOL: '◎' }
  const a = asset.toUpperCase().replace(/^1000/, '')
  const label = GLYPH[a] ?? a.slice(0, 2)
  return (
    <span className="inline-flex items-center justify-center rounded-full font-bold shrink-0 num"
      style={{
        width: size, height: size, fontSize: size * (label.length > 1 ? 0.36 : 0.5),
        background: `radial-gradient(circle at 30% 25%, ${c}55, ${c}22 70%)`,
        color: c, boxShadow: `inset 0 0 0 1px ${c}55`,
      }}>
      {label}
    </span>
  )
}

export const outcomeColor = (o: Outcome | null) =>
  o === 'win' ? 'var(--c-profit)' : o === 'loss' ? 'var(--c-loss)' : 'var(--c-text-3)'

/**
 * Where the result sits on a track from -1.5R to +3R, with ticks at the stop
 * (-1R) and at 0. A loss past -1R pushes into the warning zone on the left.
 */
const LO = -1.5, HI = 3
export function RBar({ r, width = 120, height = 6 }: { r: number | null | undefined; width?: number; height?: number }) {
  const pos = (x: number) => ((Math.max(LO, Math.min(HI, x)) - LO) / (HI - LO)) * 100
  const zero = pos(0)
  if (r == null) return <div style={{ width, height }} />
  const end = pos(r)
  const win = r >= 0
  return (
    <div className="relative" style={{ width, height }} title={fmtR(r)}>
      <div className="absolute inset-0 rounded-full" style={{ background: 'var(--c-bg-input)', boxShadow: 'inset 0 0 0 1px var(--c-border)' }} />
      {/* past the stop */}
      <div className="absolute inset-y-0 rounded-l-full" style={{ left: 0, width: `${pos(-1)}%`, background: 'repeating-linear-gradient(135deg, transparent 0 3px, rgba(248,113,113,0.12) 3px 5px)' }} />
      <div className="absolute inset-y-0 rounded-full" style={{
        left: `${Math.min(zero, end)}%`, width: `${Math.max(Math.abs(end - zero), 1.5)}%`,
        background: win ? 'linear-gradient(90deg, rgba(52,211,153,0.35), var(--c-profit))' : 'linear-gradient(270deg, rgba(248,113,113,0.35), var(--c-loss))',
      }} />
      <div className="absolute" style={{ left: `${pos(-1)}%`, top: -2, bottom: -2, width: 1, background: 'var(--c-border-strong)' }} />
      <div className="absolute" style={{ left: `${zero}%`, top: -3, bottom: -3, width: 1.5, background: 'var(--c-text-3)' }} />
      {(r < LO || r > HI) && (
        <div className="absolute rounded-full" style={{ [r < LO ? 'left' : 'right']: -2, top: '50%', width: 4, height: 4, marginTop: -2, background: win ? 'var(--c-profit)' : 'var(--c-loss)' }} />
      )}
    </div>
  )
}

/** The last N results as dots, oldest on the left. */
export function FormGuide({ trades, n = 10 }: { trades: Trade[]; n?: number }) {
  const last = trades.slice(-n)
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: n - last.length }).map((_, i) => (
        <span key={`e${i}`} className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--c-bg-input)', boxShadow: 'inset 0 0 0 1px var(--c-border)' }} />
      ))}
      {last.map(t => {
        const o = outcomeOf(t)
        return (
          <span key={t.id} className="w-2.5 h-2.5 rounded-full" title={`${t.date} ${t.asset} ${fmtR(t.rrRatio)}`}
            style={{ background: outcomeColor(o), opacity: o === 'be' ? 0.6 : 1, boxShadow: o !== 'be' ? `0 0 6px ${o === 'win' ? 'rgba(52,211,153,0.5)' : 'rgba(248,113,113,0.45)'}` : undefined }} />
        )
      })}
    </div>
  )
}

/** Eases a number to its new value; skipped when the user prefers less motion. */
export function useCountUp(value: number, ms = 700) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce || from.current === value) { setShown(value); from.current = value; return }
    const start = performance.now(), a = from.current
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - p, 3)
      setShown(a + (value - a) * e)
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); from.current = value }
  }, [value, ms])
  return shown
}
