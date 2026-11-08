import { useState, useMemo } from 'react'
import { useTrades, type Trade } from '../../../hooks/useTrades'
import { useTradingAccounts } from '../../../hooks/useTradingAccounts'
import { Panel } from './Panel'
import { PageLoader } from '../../../components/ui/Spinner'
import { useFmtView } from '../../../hooks/useFmtView'
import { MISTAKES } from '../../../lib/constants'
import { MAX_DEVIATION_PCT } from '../../../components/shared/PnLBadge'
import { applyDateFilter, presetRange, type Preset } from '../../../components/shared/DateFilter'
import { RangePicker, Segmented } from '../controls'
import { dimensions, levers, type Dimension } from './slices'
import { LeverCards, RollingEdge, BreakevenGauge } from './EdgeParts'
import { TradeManagement } from './Management'
import { ChevronDown } from 'lucide-react'
import {
  BE_R, byTime, fmtR, isClosed, mean, median, outcomeOf, pnlOf, stopTiming, sum,
} from '../../../lib/tradeStats'
import {
  AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'

/**
 * Trading analytics as a set of questions, each answered in a sentence and
 * one visual: am I making money, where does it go, is my risk under control,
 * which setups work, when do I trade best, what do my mistakes cost.
 *
 * Counting rules, everywhere on the page:
 *  - only closed trades count; a running position has no result yet
 *  - a result inside ±0.1R is breakeven, not a win or a loss
 *  - R figures use trades with a planned risk; ones without are left out, and said so
 *  - groups under 5 trades are greyed: too few to tell
 */

const C = { profit: 'var(--c-profit)', loss: 'var(--c-loss)', line: 'var(--c-accent)', muted: 'var(--c-chart-tick)' }
const HEX = { profit: 'var(--c-profit)', loss: 'var(--c-loss)' }
const MIN_N = 5
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const rColor = (r: number | null | undefined) => (r == null || Math.abs(r) < 1e-9 ? 'var(--c-text-3)' : r > 0 ? C.profit : C.loss)
const pct = (x: number) => `${Math.round(x * 100)}%`
const mistakeLabel = (k: string) => MISTAKES.find(m => m.key === k)?.label ?? k.replace(/_/g, ' ')
const ttStyle = { background: 'var(--c-bg-card)', border: '1px solid var(--c-border)', borderRadius: 8, fontSize: 12 }

// ── Groups ───────────────────────────────────────────────────────────────────

interface Group { name: string; n: number; wins: number; losses: number; be: number; avgR: number | null; netR: number; pnl: number; curve: number[] }

function group(name: string, ts: Trade[]): Group {
  const rs = ts.filter(t => t.rrRatio != null).map(t => t.rrRatio!)
  let cum = 0
  return {
    name, n: ts.length,
    wins: ts.filter(t => outcomeOf(t) === 'win').length,
    losses: ts.filter(t => outcomeOf(t) === 'loss').length,
    be: ts.filter(t => outcomeOf(t) === 'be').length,
    avgR: mean(rs), netR: sum(rs), pnl: sum(ts.map(t => pnlOf(t) ?? 0)),
    curve: [0, ...[...ts].sort(byTime).filter(t => t.rrRatio != null).map(t => (cum += t.rrRatio!))],
  }
}

function groupBy(ts: Trade[], key: (t: Trade) => string | null): Group[] {
  const m = new Map<string, Trade[]>()
  for (const t of ts) { const k = key(t); if (k == null) continue; m.set(k, [...(m.get(k) ?? []), t]) }
  return [...m].map(([k, v]) => group(k, v))
}

/** The best and worst group with enough trades to mean something. */
function extremes(gs: Group[]) {
  const ok = gs.filter(g => g.n >= MIN_N && g.avgR != null).sort((a, b) => b.avgR! - a.avgR!)
  return ok.length >= 2 ? { best: ok[0], worst: ok[ok.length - 1] } : null
}

// ── Page ─────────────────────────────────────────────────────────────────────

/** The core numbers for a set of closed trades, for the headline and the comparison. */
function core(closed: Trade[]) {
  const rs = closed.filter(t => t.rrRatio != null).map(t => t.rrRatio!)
  const winRs = rs.filter(r => r >= BE_R), lossRs = rs.filter(r => r <= -BE_R)
  const wins = closed.filter(t => outcomeOf(t) === 'win').length
  return {
    n: closed.length, net: sum(closed.map(t => pnlOf(t) ?? 0)), netR: sum(rs), avgR: mean(rs),
    winRate: closed.length ? wins / closed.length : 0,
    pf: lossRs.length ? sum(winRs) / Math.abs(sum(lossRs)) : null,
    avgWinR: mean(winRs), avgLossR: mean(lossRs),
  }
}

/** The equal-length stretch right before a date range, for "vs previous period". */
function previousRange(preset: Preset, customFrom: string, customTo: string): { from: string; to: string } | null {
  const r = preset === 'Custom' ? (customFrom && customTo ? { from: customFrom, to: customTo } : null) : presetRange(preset)
  if (!r) return null
  const day = 86_400_000
  const a = Date.parse(`${r.from}T00:00:00Z`), b = Date.parse(`${r.to}T00:00:00Z`)
  const len = Math.round((b - a) / day) + 1
  const f = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return { from: f(a - len * day), to: f(a - day) }
}

export function TradingAnalytics({ accountId }: { accountId?: number | null }) {
  const { fmtView } = useFmtView('USD', 'trading')
  const { data: trades = [], isPending } = useTrades(accountId ? { accountId: String(accountId) } : {})
  const { data: accounts = [] } = useTradingAccounts()
  const [preset, setPreset] = useState<Preset>('All')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [compare, setCompare] = useState(false)
  const [allMonths, setAllMonths] = useState(false)

  const closed = useMemo(
    () => applyDateFilter(trades, preset, customFrom, customTo).filter(isClosed).sort(byTime),
    [trades, preset, customFrom, customTo],
  )
  const running = useMemo(() => trades.filter(t => t.source === 'bybit' && !isClosed(t)).length, [trades])
  const prevRange = useMemo(() => previousRange(preset, customFrom, customTo), [preset, customFrom, customTo])
  const before = useMemo(() => {
    if (!compare || !prevRange) return null
    const ts = trades.filter(t => isClosed(t) && t.date >= prevRange.from && t.date <= prevRange.to)
    return ts.length ? core(ts) : null
  }, [compare, prevRange, trades])

  const s = useMemo(() => {
    if (!closed.length) return null
    const withR = closed.filter(t => t.rrRatio != null)
    const rs = withR.map(t => t.rrRatio!)
    const c = core(closed)
    const all = group('All', closed)
    const dims = dimensions(closed)

    let cum = 0, peak = 0, maxDD = 0
    const curve = withR.map((t, i) => {
      cum += t.rrRatio!; peak = Math.max(peak, cum); maxDD = Math.max(maxDD, peak - cum)
      return { i: i + 1, r: +cum.toFixed(2), date: t.date, asset: t.asset, tr: t.rrRatio! }
    })

    // Costs: what the price move made, and what fees and funding took from it.
    const gross = sum(closed.map(t => t.realizedPnl ?? pnlOf(t) ?? 0))
    const fees = sum(closed.map(t => (t.entryFeeAmount ?? 0) + (t.exitFeeAmount ?? 0)))
    const funding = sum(closed.map(t => t.fundingFeeAmount ?? 0))
    const costR = mean(withR.filter(t => t.realizedPnl != null && t.riskDollars).map(t => (t.realizedPnl! - pnlOf(t)!) / t.riskDollars!))

    // Risk: what a full stop-out actually costs, and how sizing matched the plan.
    const stopOuts = rs.filter(r => r <= -0.8)
    const pastPlan = withR.filter(t => (t.deviationPct ?? 0) > MAX_DEVIATION_PCT).map(t => t.rrRatio!)
    const sized = closed.filter(t => t.riskSource === 'user' && t.riskAtStop && t.riskDollars && stopTiming(t).kind === 'with-entry')
      .map(t => t.riskAtStop! / t.riskDollars!)
    const lateStops = closed.filter(t => stopTiming(t).kind === 'later')
    const noStop = closed.filter(t => stopTiming(t).kind === 'none')
    const edges = [-1.5, -1, -0.5, 0, 0.5, 1, 2, 3]
    const labels = ['< −1.5', '−1.5 to −1', '−1 to −½', '−½ to 0', '0 to ½', '½ to 1', '1 to 2', '2 to 3', '> 3']
    const dist = labels.map((label, i) => ({ label, n: 0, side: i < 4 ? 'loss' : 'profit' }))
    for (const r of rs) dist[edges.filter(e => r >= e).length].n++
    const worst = [...withR].sort((a, b) => a.rrRatio! - b.rrRatio!).slice(0, 5).filter(t => t.rrRatio! < 0)

    // $ per account, when several are mixed (test size and real size don't add up).
    const perAccount = groupBy(closed, t => accounts.find(a => a.id === t.accountId)?.name ?? 'No account')

    return {
      c, all, withR, noR: closed.length - withR.length, maxDD, curve, dims,
      levers: levers(closed, dims).slice(0, 3),
      gross, fees, funding, costR,
      stopOuts, pastPlan, sized: median(sized), lateStops, noStop, dist, worst,
      perAccount,
      rules: [
        group('Followed my rules', closed.filter(t => t.rulesMet === 1)),
        group('Broke a rule', closed.filter(t => t.rulesMet === 0)),
      ],
      noMistakes: group('No mistakes', closed.filter(t => Array.isArray(t.mistakes) && t.mistakes.length === 0)),
      mistakes: groupBy(closed.flatMap(t => (t.mistakes ?? []).map(m => ({ ...t, setupLabel: m }))), t => t.setupLabel!)
        .map(g => ({ ...g, name: mistakeLabel(g.name) })).sort((a, b) => a.netR - b.netR),
      months: groupBy(closed, t => t.date.slice(0, 7)).sort((a, b) => b.name.localeCompare(a.name)),
    }
  }, [closed, accounts])

  if (isPending) return <PageLoader />

  const d = (now: number | null | undefined, then: number | null | undefined, fmt: (x: number) => string, higherIsBetter = true) =>
    before && now != null && then != null ? { text: `${now - then >= 0 ? '+' : '−'}${fmt(Math.abs(now - then))} vs before`, good: (now - then >= 0) === higherIsBetter } : undefined
  const rollWin = s ? Math.max(10, Math.min(30, Math.floor(s.withR.length / 3))) : 30
  const reviewed = s ? s.rules[0].n + s.rules[1].n : 0

  return (
    <div className="tr-an">
      <div className="flex flex-wrap items-center gap-3">
        <RangePicker preset={preset} onPreset={setPreset} customFrom={customFrom} onCustomFrom={setCustomFrom} customTo={customTo} onCustomTo={setCustomTo} />
        <button type="button" disabled={!prevRange} onClick={() => setCompare(v => !v)}
          title={prevRange ? `Compare with ${prevRange.from} → ${prevRange.to}` : 'Pick a date range to compare it with the one before'}
          className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all disabled:opacity-35"
          style={compare && prevRange
            ? { background: 'color-mix(in srgb, var(--c-accent) 16%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--c-accent) 45%, transparent)', color: 'var(--c-text-1)' }
            : { boxShadow: 'inset 0 0 0 1px var(--c-border)', color: 'var(--c-text-2)' }}>
          vs previous period
        </button>
        <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
          {closed.length} closed trades{running ? ` · ${running} running, not counted yet` : ''}
          {s && s.noR > 0 ? ` · ${s.noR} without a planned risk, left out of R figures` : ''}
          {compare && prevRange ? (before ? ` · compared with ${before.n} trades from ${prevRange.from} to ${prevRange.to}` : ` · no trades from ${prevRange.from} to ${prevRange.to} to compare`) : ''}
        </span>
      </div>

      {!s ? (
        <div className="text-center py-20" style={{ color: 'var(--c-text-3)' }}>No closed trades in the selected period.</div>
      ) : <>

      {/* ── Am I making money? ─────────────────────────────────────── */}
      <Section q="Am I making money?" a={
        <>Over {s.all.n} trades you're {s.c.netR >= 0 ? 'up' : 'down'} <b style={{ color: rColor(s.c.netR) }}>{fmtR(s.c.netR, 1)}</b>:
          {' '}the average trade {s.c.avgR! >= 0 ? 'makes' : 'loses'} <b style={{ color: rColor(s.c.avgR) }}>{fmtR(Math.abs(s.c.avgR ?? 0)).replace(/^[+−]/, '')}</b>.
          {' '}You win {pct(s.c.winRate)} of trades at {fmtR(s.c.avgWinR)} and lose {pct(s.all.losses / s.all.n)} at {fmtR(s.c.avgLossR)}
          {s.all.be ? `; ${s.all.be} were scratches` : ''}.</>
      }>
        <div className="tr-kpis">
          <Kpi label="Net P&L" value={fmtView(s.c.net)} color={rColor(s.c.net)} delta={d(s.c.net, before?.net, x => fmtView(x).replace('-', ''))}
            sub={s.perAccount.length > 1 ? s.perAccount.map(g => `${g.name} ${fmtView(g.pnl)}`).join(' · ') : 'after fees and funding'} />
          <Kpi label="Net R" value={fmtR(s.c.netR, 1)} color={rColor(s.c.netR)} delta={d(s.c.netR, before?.netR, x => `${x.toFixed(1)}R`)} sub={`${s.withR.length} trades with a planned risk`} />
          <Kpi label="Avg trade" value={fmtR(s.c.avgR)} color={rColor(s.c.avgR)} delta={d(s.c.avgR, before?.avgR, x => `${x.toFixed(2)}R`)} sub="your expectancy, per trade" />
          <Kpi label="Win rate" value={pct(s.c.winRate)} delta={d(s.c.winRate, before?.winRate, x => `${Math.round(x * 100)} pts`)} sub={`${s.all.wins} W · ${s.all.losses} L · ${s.all.be} BE (±${BE_R}R)`} />
          <Kpi label="Profit factor" value={s.c.pf != null ? s.c.pf.toFixed(2) : '—'} color={s.c.pf == null ? undefined : s.c.pf >= 1 ? C.profit : C.loss}
            delta={d(s.c.pf, before?.pf, x => x.toFixed(2))} sub={`R won per R lost · deepest dip ${fmtR(-s.maxDD, 1)}`} />
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Panel className="p-4">
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-3)' }}>Cumulative R, trade by trade</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={s.curve} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                  <defs>
                    <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--c-accent)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--c-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--c-chart-grid)" vertical={false} />
                  <XAxis dataKey="i" tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={v => `${v}R`} />
                  <ReferenceLine y={0} stroke="var(--c-border-mid)" />
                  <Tooltip cursor={{ stroke: 'var(--c-border-mid)' }} content={({ active, payload }: any) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0].payload
                    return (
                      <div style={{ ...ttStyle, padding: '8px 12px' }}>
                        <div style={{ color: 'var(--c-text-3)' }}>#{p.i} · {p.date} · {p.asset}</div>
                        <div style={{ color: 'var(--c-text-1)' }}>This trade <b>{fmtR(p.tr)}</b></div>
                        <div style={{ color: 'var(--c-text-1)' }}>Running total <b>{fmtR(p.r, 1)}</b></div>
                      </div>
                    )
                  }} />
                  <Area type="monotone" dataKey="r" stroke={C.line} strokeWidth={2} fill="url(#eqFill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--c-bg-card)' }} isAnimationActive={false} baseValue="dataMin" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <BreakevenGauge winRate={s.c.winRate} avgWin={s.c.avgWinR} avgLoss={s.c.avgLossR} />
        </div>
      </Section>


      {/* ── Am I getting better? ───────────────────────────────────── */}
      <Section q="Am I getting better?" a={(() => {
        const rs = s.withR.map(t => t.rrRatio!)
        if (rs.length <= rollWin) return <>Not enough trades in this range to see a trend ({rs.length}; it takes more than {rollWin}). Switch to a longer range.</>
        const roll = (i: number) => mean(rs.slice(i - rollWin, i))!
        const now = roll(rs.length), vals = Array.from({ length: rs.length - rollWin + 1 }, (_, k) => roll(k + rollWin))
        const best = Math.max(...vals), worstV = Math.min(...vals)
        const then = rs.length >= rollWin * 2 ? roll(rs.length - rollWin) : null
        return <>Your last {rollWin} trades average <b style={{ color: rColor(now) }}>{fmtR(now)}</b>
          {then != null ? <>, {now > then + 0.05 ? 'better than' : now < then - 0.05 ? 'worse than' : 'about the same as'} the {rollWin} before ({fmtR(then)})</> : null}.
          {' '}Best stretch {fmtR(best)}, worst {fmtR(worstV)}.</>
      })()}>
        {s.withR.length > rollWin && <RollingEdge trades={s.withR} window={rollWin} />}
      </Section>


      {/* ── Biggest levers ─────────────────────────────────────────── */}
      <Section q="What moves your results most?" a={s.levers[0] ? <>
        Every way of slicing your trades, ranked by how much it costs or adds against the rest. Slices need {Math.max(15, Math.ceil(s.withR.length * 0.08))}+ trades to count.
      </> : s.withR.length < 30
        ? <>Not enough trades in this range to rank slices ({s.withR.length}; it takes about 30). Switch to 3M or All.</>
        : <>Nothing stands out: no slice of {Math.max(15, Math.ceil(s.withR.length * 0.08))}+ trades does much better or worse than the rest.</>}>
        {s.levers[0] && <LeverCards items={s.levers} holdNote />}
      </Section>


      {/* ── Trade management ───────────────────────────────────────── */}
      <Section q="How do your trades behave while open?" a={<>How far each trade went for you (best point, MFE) and against you (worst point, MAE) before it closed, in R.</>}>
        <TradeManagement trades={closed} />
      </Section>


      {/* ── Is my risk under control? ─────────────────────────────── */}
      <Section q="Is my risk under control?" a={
        s.stopOuts.length ? <>
          A full stop-out costs you <b style={{ color: C.loss }}>{fmtR(mean(s.stopOuts))}</b> on average, not −1R.
          {' '}{s.pastPlan.length} of {s.withR.length} trades broke your {MAX_DEVIATION_PCT}% deviation rule{s.pastPlan.length ? `, worst ${fmtR(Math.min(...s.pastPlan))}` : ''}.
          {s.sized != null && <> Your stop typically risked <b>{pct(s.sized)}</b> of the plan.</>}
          {s.lateStops.length > 0 && <> {s.lateStops.length === 1 ? '1 trade' : `${s.lateStops.length} trades`} got {s.lateStops.length === 1 ? 'its' : 'their'} stop after the entry{s.noStop.length ? `, and ${s.noStop.length} never had one` : ''}.</>}
          {s.lateStops.length === 0 && s.noStop.length > 0 && <> {s.noStop.length === 1 ? '1 trade' : `${s.noStop.length} trades`} never had a stop.</>}
        </> : <>No full stop-outs in this period.</>
      }>
        <div className="grid md:grid-cols-5 gap-4">
          <Panel className="p-4 md:col-span-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-3)' }}>How trades ended, in R</div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.dist} barCategoryGap={2} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--c-chart-grid)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: C.muted }} tickLine={false} axisLine={false} interval={0} />
                  <YAxis tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'rgba(127,127,127,0.08)' }} content={({ active, payload }: any) => active && payload?.length ? (
                    <div style={{ ...ttStyle, padding: '6px 10px', color: 'var(--c-text-1)' }}>{payload[0].payload.label}R: <b>{payload[0].value} trades</b></div>
                  ) : null} />
                  <Bar dataKey="n" radius={[4, 4, 0, 0]}>
                    {s.dist.map((x, i) => <Cell key={i} fill={x.side === 'loss' ? HEX.loss : HEX.profit} fillOpacity={0.85} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel className="p-4 md:col-span-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-3)' }}>Biggest losses</div>
            <table className="w-full text-xs">
              <tbody>
                {s.worst.map(t => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--c-border)' }}>
                    <td className="py-1.5 num" style={{ color: 'var(--c-text-3)' }}>{t.date.slice(2)}</td>
                    <td className="py-1.5" style={{ color: 'var(--c-text-1)' }}>{t.asset} {t.direction}</td>
                    <td className="py-1.5" style={{ color: 'var(--c-text-3)' }}>
                      {stopTiming(t).kind === 'later' ? 'stop added late' : stopTiming(t).kind === 'none' ? 'no stop' : t.mistakes?.length ? t.mistakes.map(mistakeLabel).join(', ') : ''}
                    </td>
                    <td className="py-1.5 num text-right font-semibold" style={{ color: C.loss }}>{fmtR(t.rrRatio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </Section>


      {/* ── Where's my edge? ───────────────────────────────────────── */}
      <Section q="Where is your edge?" a={<>Every way of slicing your trades in one table. Rows under {MIN_N} trades are greyed: too few to tell.</>}>
        <SliceTable closed={closed} dims={s.dims} fmt={fmtView} />
      </Section>


      {/* ── Where does the money go? ───────────────────────────────── */}
      <Section fold="costs" q="Where does the money go?" a={
        <>The price moves {s.gross >= 0 ? 'made' : 'lost'} you <b style={{ color: rColor(s.gross) }}>{fmtView(s.gross)}</b>;
          {' '}fees and funding took <b>{fmtView(s.gross - s.c.net)}</b> more{s.costR != null ? <>, about <b>{s.costR.toFixed(2)}R per trade</b></> : null}.
          {s.gross < 0 && s.c.net < 0 && s.gross - s.c.net > 0 ? <> Costs are {pct((s.gross - s.c.net) / Math.abs(s.c.net))} of what you've lost.</> : null}</>
      }>
        <Panel className="p-4">
          <Waterfall rows={[
            { label: 'Price move (gross)', value: s.gross },
            { label: 'Trading fees', value: -s.fees },
            { label: 'Funding', value: -s.funding },
            { label: 'Net', value: s.c.net, total: true },
          ]} fmt={fmtView} />
          <p className="mt-3 text-[11px]" style={{ color: 'var(--c-text-3)' }}>
            Fees can't be avoided, but they scale with size and with market orders. Limit entries pay 0.02% instead of 0.055%.
          </p>
        </Panel>
      </Section>


      {/* ── Mistakes ───────────────────────────────────────────────── */}
      <Section fold="mistakes" q="What do your mistakes cost?" a={(() => {
        const [ok, broke] = s.rules
        const top = s.mistakes[0]
        if (reviewed < 10) return <>Only {reviewed} reviewed {reviewed === 1 ? 'trade' : 'trades'} in this period. This fills in as you review trades; it needs about 10 to say anything.</>
        return <>
          {ok.n && broke.n ? <>Following your rules averages <b style={{ color: rColor(ok.avgR) }}>{fmtR(ok.avgR)}</b>; breaking one, <b style={{ color: rColor(broke.avgR) }}>{fmtR(broke.avgR)}</b>. </> : null}
          {top && top.netR < 0 ? <>The costliest mistake is <b>{top.name}</b>: {fmtR(top.netR, 1)} over {top.n} trades.</> : null}
        </>
      })()}>
        {reviewed >= 10 && (
          <div className="grid md:grid-cols-2 gap-4">
            <GroupTable title="Rules" groups={s.rules.filter(g => g.n)} fmt={fmtView} />
            <GroupTable title="Mistakes (a trade can have several)" groups={[...(s.noMistakes.n ? [s.noMistakes] : []), ...s.mistakes]} fmt={fmtView} />
          </div>
        )}
      </Section>


      {/* ── Month by month ─────────────────────────────────────────── */}
      <Section fold="months" q="Month by month" a={(() => {
        const [now, ...rest] = s.months
        const best = [...s.months].filter(g => g.n >= 3).sort((a, b) => b.netR - a.netR)[0]
        const label = (k: string) => `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`
        return <>{label(now.name)}: <b style={{ color: rColor(now.netR) }}>{fmtR(now.netR, 1)}</b> over {now.n} {now.n === 1 ? 'trade' : 'trades'}
          {best && rest.length ? <>. Best month: {label(best.name)} at <b style={{ color: rColor(best.netR) }}>{fmtR(best.netR, 1)}</b></> : null}.</>
      })()}>
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <div>
            <GroupTable groups={(allMonths ? s.months : s.months.slice(0, 6)).map(g => ({ ...g, name: `${MONTHS[Number(g.name.slice(5)) - 1]} ${g.name.slice(0, 4)}` }))} fmt={fmtView} showPnl />
            {s.months.length > 6 && (
              <button onClick={() => setAllMonths(v => !v)} className="mt-2 text-xs hover:underline" style={{ color: 'var(--c-accent)' }}>
                {allMonths ? 'Show the last 6 months' : `Show all ${s.months.length} months`}
              </button>
            )}
          </div>
          <CalendarHeatmap trades={closed} />
        </div>
      </Section>
      </>}
    </div>
  )
}

const SLICE_KEY = 'analytics-slice-dim'

/** One table, any cut: hold time, session, setup, coin, weekday, direction, trade # of day, after. */
function SliceTable({ closed, dims, fmt }: { closed: Trade[]; dims: Dimension[]; fmt: (n: number) => string }) {
  const [key, setKey] = useState<string>(() => { try { return localStorage.getItem(SLICE_KEY) ?? 'hold' } catch { return 'hold' } })
  const dim = dims.find(x => x.key === key) ?? dims[0]
  const groups = useMemo(() => {
    let gs = groupBy(closed, dim.bucket)
    if (dim.order) gs.sort((a, b) => dim.order!.indexOf(a.name) - dim.order!.indexOf(b.name))
    else gs.sort((a, b) => b.n - a.n)
    if (dim.key === 'setup' || dim.key === 'coin') {
      // Setups or coins tried once or twice say nothing yet: one row for all of them.
      const small = gs.filter(g => g.n < 3 && g.name !== 'No setup')
      if (small.length > 1) {
        const names = new Set(small.map(g => g.name))
        gs = [...gs.filter(g => !names.has(g.name)), group(`${small.length} others, under 3 trades each`, closed.filter(t => names.has(dim.bucket(t) ?? '')))]
      }
    }
    return gs
  }, [closed, dim])
  const e = extremes(groups.filter(g => !/others|No setup|Outside/.test(g.name)))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented size="sm" value={dim.key} onChange={v => { setKey(v); try { localStorage.setItem(SLICE_KEY, v) } catch { /* private window */ } }}
          options={dims.map(x => ({ value: x.key, label: x.label }))} />
        {e && (
          <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>
            Best: <b>{e.best.name.split(' (')[0]}</b> ({fmtR(e.best.avgR)}). Worst: <b>{e.worst.name.split(' (')[0]}</b> ({fmtR(e.worst.avgR)}).
          </span>
        )}
      </div>
      <GroupTable groups={groups} fmt={fmt} curve />
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/**
 * A numbered question with its one-sentence answer. Reference sections can
 * fold: shut, the answer still shows, so nothing is hidden, just the detail.
 */
function Section({ q, a, fold, children }: { q: string; a?: React.ReactNode; fold?: string; children?: React.ReactNode }) {
  const key = `analytics-open-${fold}`
  const [open, setOpen] = useState(() => { if (!fold) return true; try { return localStorage.getItem(key) === '1' } catch { return false } })
  const toggle = () => setOpen(o => { try { localStorage.setItem(key, o ? '0' : '1') } catch { /* private window */ } return !o })
  const Head = fold ? 'button' : 'div'
  return (
    <section className="tr-sec">
      <Head {...(fold ? { type: 'button' as const, onClick: toggle } : {})} className="w-full flex items-center gap-3 mb-1.5 text-left group">
        <h2 className="text-base font-semibold tracking-tight" style={{ color: 'var(--c-text-1)' }}>{q}</h2>
        <div className="flex-1 h-px" style={{ background: 'var(--c-border)' }} />
        {fold && (
          <span className="flex items-center gap-1 text-[11px] group-hover:text-[var(--c-accent)]" style={{ color: 'var(--c-text-3)' }}>
            {open ? 'Hide' : 'Show'} <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }} />
          </span>
        )}
      </Head>
      {a && <p className="text-sm mb-3 leading-relaxed" style={{ color: 'var(--c-text-2)' }}>{a}</p>}
      {!a && open && <div className="mb-3" />}
      {open && children}
    </section>
  )
}

function Kpi({ label, value, sub, delta, color = 'var(--c-text-1)' }: { label: string; value: React.ReactNode; sub?: string; delta?: { text: string; good: boolean }; color?: string }) {
  return (
    <div className="tr-kpi">
      <span className="l">{label}</span>
      <b className="v num" style={{ color }}>{value}</b>
      {delta && <span className={`d num ${delta.good ? 'good' : 'bad'}`}>{delta.text}</span>}
      {sub && <span className="s num">{sub}</span>}
    </div>
  )
}

/** Gross, minus each cost, to net: horizontal bars on one zero line. */
function Waterfall({ rows, fmt }: { rows: { label: string; value: number; total?: boolean }[]; fmt: (n: number) => string }) {
  const max = Math.max(...rows.map(r => Math.abs(r.value)), 1e-9)
  return (
    <div className="space-y-2">
      {rows.map(r => (
        <div key={r.label} className="grid items-center gap-3" style={{ gridTemplateColumns: '150px 1fr 90px' }}>
          <span className="text-xs" style={{ color: r.total ? 'var(--c-text-1)' : 'var(--c-text-2)', fontWeight: r.total ? 600 : 400 }}>{r.label}</span>
          <div className="relative h-4">
            <div className="absolute inset-y-0" style={{ left: '50%', width: 1, background: 'var(--c-border-mid)' }} />
            <div className="absolute inset-y-0.5 rounded" title={fmt(r.value)} style={{
              background: r.value >= 0 ? HEX.profit : HEX.loss, opacity: r.total ? 0.95 : 0.7,
              width: `${(Math.abs(r.value) / max) * 50}%`,
              ...(r.value >= 0 ? { left: '50%' } : { right: '50%' }),
            }} />
          </div>
          <span className="text-xs num text-right" style={{ color: r.total ? 'var(--c-text-1)' : 'var(--c-text-2)', fontWeight: r.total ? 600 : 400 }}>{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

function Spark({ pts }: { pts: number[] }) {
  if (pts.length < 3) return null
  const W = 80, H = 20, min = Math.min(...pts), max = Math.max(...pts), rng = max - min || 1
  const d = pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H - ((v - min) / rng) * (H - 2) - 1}`).join(' ')
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <polyline points={d} fill="none" stroke={pts[pts.length - 1] >= 0 ? HEX.profit : HEX.loss} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}

/** One row per group: trades, win rate, average R as a bar around zero, net R. */
function GroupTable({ title, groups, fmt, curve, showPnl }: { title?: string; groups: Group[]; fmt: (n: number) => string; curve?: boolean; showPnl?: boolean }) {
  const maxAbs = Math.max(...groups.map(g => Math.abs(g.avgR ?? 0)), 0.5)
  return (
    <Panel className="p-4">
      {title && <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-3)' }}>{title}</div>}
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
            {['', 'Trades', 'Win %', 'Avg R', '', 'Net R', ...(showPnl ? ['P&L'] : []), ...(curve ? ['Over time'] : [])].map((h, i) => (
              <th key={i} className={`pb-1.5 font-semibold uppercase ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: 'var(--c-text-3)', fontSize: 9 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(g => {
            const few = g.n < MIN_N
            const decided = g.wins + g.losses
            return (
              <tr key={g.name} style={{ borderBottom: '1px solid var(--c-border)', opacity: g.n === 0 ? 0.35 : few ? 0.55 : 1 }}
                title={few && g.n ? `Only ${g.n} trades: too few to tell` : undefined}>
                <td className="py-1.5 pr-2 max-w-[220px] truncate" style={{ color: 'var(--c-text-1)' }}>{g.name}</td>
                <td className="py-1.5 num text-right" style={{ color: 'var(--c-text-2)' }}>{g.n || '—'}</td>
                <td className="py-1.5 num text-right" style={{ color: 'var(--c-text-2)' }} title={`${g.wins} W · ${g.losses} L · ${g.be} BE`}>
                  {decided ? pct(g.wins / g.n) : '—'}
                </td>
                <td className="py-1.5 num text-right pl-2" style={{ color: rColor(g.avgR) }}>{g.avgR != null ? fmtR(g.avgR) : '—'}</td>
                <td className="py-1.5 pl-2" style={{ width: 90 }}>
                  {g.avgR != null && (
                    <div className="relative h-2.5">
                      <div className="absolute inset-y-0" style={{ left: '50%', width: 1, background: 'var(--c-border-mid)' }} />
                      <div className="absolute inset-y-0 rounded-sm" style={{
                        background: g.avgR >= 0 ? HEX.profit : HEX.loss, opacity: 0.8,
                        width: `${(Math.abs(g.avgR) / maxAbs) * 50}%`, ...(g.avgR >= 0 ? { left: '50%' } : { right: '50%' }),
                      }} />
                    </div>
                  )}
                </td>
                <td className="py-1.5 num text-right pl-2" style={{ color: rColor(g.netR) }}>{g.n ? fmtR(g.netR, 1) : '—'}</td>
                {showPnl && <td className="py-1.5 num text-right pl-2" style={{ color: rColor(g.pnl) }}>{g.n ? fmt(g.pnl) : '—'}</td>}
                {curve && <td className="py-1.5 pl-3"><div className="flex justify-end"><Spark pts={g.curve} /></div></td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </Panel>
  )
}

/** Net R per day for one month. */
function CalendarHeatmap({ trades }: { trades: Trade[] }) {
  const last = trades[trades.length - 1]?.date ?? new Date().toISOString().slice(0, 10)
  const [ym, setYm] = useState(last.slice(0, 7))
  const months = useMemo(() => [...new Set(trades.map(t => t.date.slice(0, 7)))].sort().reverse(), [trades])
  const [y, m] = ym.split('-').map(Number)
  const dayR = useMemo(() => {
    const out: Record<string, number> = {}
    for (const t of trades) if (t.date.startsWith(ym) && t.rrRatio != null) out[t.date] = (out[t.date] ?? 0) + t.rrRatio
    return out
  }, [trades, ym])
  const first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(null)

  const bg = (r: number) => {
    const a = Math.min(0.15 + Math.abs(r) * 0.15, 0.6)
    return r > 0 ? `rgba(34,197,94,${a})` : r < 0 ? `rgba(239,68,68,${a})` : 'var(--c-bg-input)'
  }

  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Net R by day</span>
        <select value={ym} onChange={e => setYm(e.target.value)} className="text-xs px-2 py-1 rounded-lg outline-none"
          style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }}>
          {(months.includes(ym) ? months : [ym, ...months]).map(k => <option key={k} value={k}>{MONTHS[Number(k.slice(5)) - 1]} {k.slice(0, 4)}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {DAYS.map(d => <div key={d} className="text-center text-[9px] font-bold uppercase" style={{ color: 'var(--c-text-3)' }}>{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />
          const key = `${ym}-${String(d).padStart(2, '0')}`
          const r = dayR[key]
          return (
            <div key={i} className="rounded-md py-1.5 text-center" style={{ background: r != null ? bg(r) : 'var(--c-bg-secondary)', border: '1px solid var(--c-border)' }}
              title={r != null ? `${key}: ${fmtR(r)}` : key}>
              <div className="text-[10px] num" style={{ color: 'var(--c-text-3)' }}>{d}</div>
              <div className="text-[11px] num font-medium" style={{ color: r != null ? 'var(--c-text-1)' : 'transparent' }}>{r != null ? fmtR(r, 1) : '·'}</div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
