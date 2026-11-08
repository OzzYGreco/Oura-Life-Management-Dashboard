/**
 * Money, the one-layout redesign (approved 2026-11-08). Personal money is in
 * EUR. Business receipts arrive in GBP and trading P&L in USD; both are
 * converted at the live rate before they are added, never summed raw.
 *
 * One page, no tabs: the hero answers "what did I keep this month?" with a
 * one-line spending add; the side shows where money comes from this year.
 * Below: cash flow, spending by category with budgets on the same bars,
 * every spending and income entry (editable), then net worth and accounts.
 * Feature inventory of the old Finances page is kept in full (see the
 * summary at the bottom of this file).
 */
import { useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from 'recharts'
import {
  useCashFlow, useCreateAccount, useCreateExpense, useCreateIncome, useDeleteAccount, useDeleteBudget, useDeleteExpense, useDeleteIncome,
  useFinanceAccounts, useFinanceBudgets, useFinanceExpenses, useFinanceIncome, useNetWorth, useUpdateAccount, useUpdateExpense, useUpdateIncome, useUpsertBudget,
} from '../../hooks/useFinances'
import { useFinanceSettings, type FinanceSettings } from '../../hooks/useFinanceSettings'
import { useFmtView } from '../../hooks/useFmtView'
import type { ViewCurrency } from '../../hooks/useViewCurrency'
import { convertAmount } from '../../lib/utils'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../lib/constants'
import { HEX } from '../../lib/chartTheme'
import { MASK, usePrivacy } from '../../core/privacy'
import { api } from '../../lib/api'
import { useQueryClient } from '@tanstack/react-query'
import { PageLoader } from '../../components/ui/Spinner'
import './next.css'
import './roadmap.css'
import './training.css'
import './money.css'

// ─── Types and small helpers ─────────────────────────────────────────────────

type Expense = { id: number; description: string; amount: number; category: string; date: string; isRecurring: number; frequency: string | null; notes: string | null; recurringParentId: number | null }
type Income = { id: number; source: string; amount: number; frequency: string; category: string | null; date: string; notes: string | null; recurringParentId: number | null }
type Account = { id: number; name: string; type: string; balance: number; displayBalance?: number; currency: string; isTrading: number; notes: string | null }
type Flow = { month: string; income: number; tradingPnl: number; invoiceIncome: number; expenses: number }
type Budget = { id: number; category: string; monthlyLimit: number }

const SYM: Record<string, string> = { EUR: '€', GBP: '£', USD: '$' }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const monthOf = (iso: string) => iso.slice(0, 7)
const monthName = (ym: string, o: Intl.DateTimeFormatOptions = { month: 'long' }) => new Date(ym + '-15T12:00:00').toLocaleDateString('en-GB', o)
const shiftMonth = (ym: string, n: number) => { const d = new Date(ym + '-15T12:00:00'); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7) }
const fmtDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
/** Business costs live in the same table and are in GBP; personal ones are EUR. */
const expenseCur = (e: { category: string }) => (e.category === 'Business' ? 'GBP' : 'EUR')
const LIABILITY = new Set(['credit', 'loan'])
const ACCOUNT_TYPES = [
  { v: 'checking', l: 'Current account' }, { v: 'savings', l: 'Savings' }, { v: 'brokerage', l: 'Investments' },
  { v: 'trading', l: 'Trading' }, { v: 'crypto', l: 'Crypto' }, { v: 'credit', l: 'Credit card' }, { v: 'loan', l: 'Loan' }, { v: 'other', l: 'Other' },
]
const bucketOf = (t: string) => (t === 'checking' || t === 'savings' ? 'Liquid' : t === 'brokerage' || t === 'trading' ? 'Invested' : t === 'crypto' ? 'Crypto' : LIABILITY.has(t) ? 'Owed' : 'Other')

function Head({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return <div className="nx-head"><h2 className="nx-h">{children}</h2>{aside && <div className="nx-aside">{aside}</div>}</div>
}

/** Converts to EUR and formats in the chosen view currency; respects privacy mode. */
function useMoneyFmt() {
  const { fmtView, viewCurrency, setViewCurrency, rates } = useFmtView('EUR', 'finance')
  const { hidden } = usePrivacy()
  const eur = (n: number, from = 'EUR') => (rates && from !== 'EUR' ? convertAmount(n, from, 'EUR', rates) : n)
  const fmt = (nEur: number) => (hidden ? `${SYM[viewCurrency] ?? ''}${MASK}` : fmtView(nEur, 'EUR'))
  const signed = (nEur: number) => (hidden ? fmt(nEur) : `${nEur > 0 ? '+' : nEur < 0 ? '−' : ''}${fmtView(Math.abs(nEur), 'EUR')}`)
  /** An amount in its own currency, for "from £x" captions. */
  const native = (n: number, cur: string) => (hidden ? `${SYM[cur]}${MASK}` : `${SYM[cur]}${n.toLocaleString('en-GB', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`)
  const rate = rates && viewCurrency !== 'EUR' ? `€1 = ${SYM[viewCurrency]}${convertAmount(1, 'EUR', viewCurrency, rates).toFixed(3)}` : null
  return { eur, fmt, signed, native, viewCurrency, setViewCurrency, rate, ready: !!rates }
}
type M = ReturnType<typeof useMoneyFmt>

/** Tax to set aside on what came in, by the rates in settings. */
function taxOn(s: FinanceSettings, parts: { business: number; trading: number; other: number }) {
  if (!s.showTaxReserve) return 0
  return parts.business * s.taxRateBusiness / 100 + Math.max(0, parts.trading) * s.taxRateTrading / 100 + parts.other * s.taxRateOther / 100
}

// ─── The numbers, worked out once ────────────────────────────────────────────

function useMoneyModel(m: M) {
  const { settings } = useFinanceSettings()
  const flow = useCashFlow()
  const inc = useFinanceIncome()
  const exp = useFinanceExpenses(settings.excludeBusinessExpenses ? { excludeBusiness: '1' } : {})
  const acc = useFinanceAccounts()
  const nw = useNetWorth()
  const bud = useFinanceBudgets()
  const pending = flow.isPending || inc.isPending || exp.isPending

  const income: Income[] = useMemo(() => inc.data ?? [], [inc.data])
  const expenses: Expense[] = useMemo(() => exp.data ?? [], [exp.data])
  const accounts: Account[] = acc.data ?? []
  const rows: Flow[] = flow.data ?? []
  const now = monthOf(today())

  // Each month in EUR: manual income by stream, business receipts, trading, spending.
  const months = rows.map(r => {
    const mi = income.filter(i => monthOf(i.date) === r.month)
    const biz = mi.filter(i => i.category === 'Business' || i.category === 'Freelance').reduce((s, i) => s + i.amount, 0) + m.eur(r.invoiceIncome, 'GBP')
    const trd = mi.filter(i => i.category === 'Trading').reduce((s, i) => s + i.amount, 0) + m.eur(r.tradingPnl, 'USD')
    const oth = mi.filter(i => i.category !== 'Business' && i.category !== 'Freelance' && i.category !== 'Trading').reduce((s, i) => s + i.amount, 0)
    const out = expenses.filter(e => monthOf(e.date) === r.month).reduce((s, e) => s + m.eur(e.amount, expenseCur(e)), 0)
    const into = biz + trd + oth
    const tax = taxOn(settings, { business: biz, trading: trd, other: oth })
    return { month: r.month, biz, trd, oth, into, out, tax, net: into - out, rate: into > 0 ? ((into - out) / into) * 100 : 0 }
  })
  const cur = months.find(x => x.month === now) ?? { month: now, biz: 0, trd: 0, oth: 0, into: 0, out: 0, tax: 0, net: 0, rate: 0 }
  const year = months.filter(x => x.month.startsWith(now.slice(0, 4)))
  const ytd = {
    biz: year.reduce((s, x) => s + x.biz, 0), trd: year.reduce((s, x) => s + x.trd, 0), oth: year.reduce((s, x) => s + x.oth, 0),
    tax: year.reduce((s, x) => s + x.tax, 0), invoiceGbp: rows.filter(r => r.month.startsWith(now.slice(0, 4))).reduce((s, r) => s + r.invoiceIncome, 0),
  }

  // Runway: liquid money over the average spend of the last three full months.
  const bal = (a: Account) => m.eur(a.displayBalance ?? a.balance, a.currency || 'EUR')
  const liquid = accounts.filter(a => bucketOf(a.type) === 'Liquid').reduce((s, a) => s + bal(a), 0)
  const last3 = months.filter(x => x.month < now).slice(-3)
  const avgOut = last3.length ? last3.reduce((s, x) => s + x.out, 0) / last3.length : cur.out
  const runway = accounts.length && avgOut > 0 ? liquid / avgOut : null

  return { settings, pending, income, expenses, accounts, budgets: (bud.data ?? []) as Budget[], netWorth: nw.data, months, cur, ytd, liquid, avgOut, runway, bal, now }
}
type Model = ReturnType<typeof useMoneyModel>

// ─── Page ────────────────────────────────────────────────────────────────────

export function NextMoney() {
  const m = useMoneyFmt()
  const d = useMoneyModel(m)
  const [settings, setSettings] = useState(false)
  if (d.pending) return <PageLoader />
  return (
    <div className="wh-page nx nmo skin-enter">
      <div className="nx-wrap">
        <div className="nmo-bar">
          <h1 className="nmo-title">Money</h1>
          <span className="nmo-rule">Personal money in euros. Business and trading are converted at today's rate.</span>
          <span className="nr-grow" />
          {m.rate && <span className="nmo-rate num">{m.rate}</span>}
          <div className="nx-cur" role="radiogroup" aria-label="Show amounts in">
            {(['EUR', 'GBP', 'USD'] as ViewCurrency[]).map(c => (
              <button key={c} type="button" role="radio" aria-checked={m.viewCurrency === c} aria-label={c} className={m.viewCurrency === c ? 'on' : ''}
                disabled={!m.ready && c !== 'EUR'} onClick={() => m.setViewCurrency(c)}>{SYM[c]}</button>
            ))}
          </div>
          <button className="nx-btn ghost sm" onClick={() => setSettings(true)}>Settings</button>
        </div>
        <div className="nx-top">
          <Hero m={m} d={d} />
          <Sources m={m} d={d} />
        </div>
        <div className="nmo-row">
          <CashFlow m={m} d={d} />
          <Categories m={m} d={d} />
        </div>
        <div className="nmo-row">
          <Spending m={m} d={d} />
          <IncomeList m={m} d={d} />
        </div>
        <div className="nmo-row">
          <NetWorth m={m} d={d} />
          <Accounts m={m} d={d} />
        </div>
      </div>
      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
    </div>
  )
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function Hero({ m, d }: { m: M; d: Model }) {
  const { cur } = d
  const kept = cur.into - cur.tax - cur.out
  const [kick, tone] = cur.into === 0 && cur.out === 0 ? ['Nothing logged this month', '']
    : kept >= 0 ? ['Saving', 'good'] : cur.into === 0 ? ['Spending, nothing in yet', 'warn'] : ['Spending more than comes in', 'bad']
  const prev = d.months.find(x => x.month === shiftMonth(d.now, -1))
  return (
    <section className="nx-hero nmo-hero" aria-label="This month">
      <div className="nmo-top">
        <p className={`nx-state ${tone}`}>{kick}</p>
        <h1 className="nmo-h1"><span className={`num ${kept < 0 ? 'bad' : ''}`}>{m.signed(kept)}</span> kept in {monthName(d.now)}</h1>
        <p className="nmo-sub">
          {m.fmt(cur.into)} in{d.settings.showTaxReserve ? <>, {m.fmt(cur.tax)} set aside for tax</> : null}, {m.fmt(cur.out)} spent.
          {prev && prev.out > 0 && <> Spending is {cur.out <= prev.out ? <span className="good">{m.fmt(prev.out - cur.out)} under</span> : <span className="warn">{m.fmt(cur.out - prev.out)} over</span>} {monthName(prev.month)} so far.</>}
        </p>
        <QuickSpend d={d} m={m} />
      </div>
      <div className="nmo-facts">
        <div><span>Came in</span><b className="num">{m.fmt(cur.into)}</b></div>
        {d.settings.showTaxReserve && <div><span>Tax to keep aside</span><b className="num">{m.fmt(cur.tax)}</b></div>}
        <div><span>Spent</span><b className="num">{m.fmt(cur.out)}</b></div>
        <div><span>Savings rate</span><b className={`num ${cur.into > 0 ? (cur.rate >= 0 ? 'good' : 'bad') : ''}`}>{cur.into > 0 ? `${cur.rate.toFixed(0)}%` : '–'}</b></div>
        <div><span>Runway</span><b className="num">{d.runway != null ? <>{d.runway >= 99 ? '99+' : d.runway.toFixed(1)}<small> months</small></> : '–'}</b>
          {d.runway == null && <small className="nmo-hint">{d.accounts.length ? 'no spending to measure yet' : 'add a bank balance below'}</small>}</div>
      </div>
    </section>
  )
}

/**
 * Spending in one line: "Groceries 45 food", "Netflix 12.99 monthly",
 * "Taxi 18 yesterday". The category comes from a word in the line, then from
 * the last time the same thing was logged; with neither it asks, never guesses.
 */
function parseSpend(line: string, history: Expense[]) {
  let rest = ` ${line.trim()} `
  const amt = rest.match(/\s€?(\d+(?:[.,]\d{1,2})?)\s/)
  const amount = amt ? parseFloat(amt[1].replace(',', '.')) : null
  if (amt) rest = rest.replace(amt[0], ' ')
  let date = today()
  if (/\syesterday\s/i.test(rest)) { const x = new Date(); x.setDate(x.getDate() - 1); date = x.toISOString().slice(0, 10); rest = rest.replace(/\syesterday\s/i, ' ') }
  const freq = rest.match(/\s(monthly|yearly)\s/i)
  if (freq) rest = rest.replace(freq[0], ' ')
  const words = rest.trim().split(/\s+/)
  let category: string | null = null
  for (const w of [...words].reverse()) {
    const hit = EXPENSE_CATEGORIES.find(c => c.toLowerCase() === w.toLowerCase() || (w.length >= 4 && c.toLowerCase().startsWith(w.toLowerCase())))
    if (hit && words.length > 1) { category = hit; words.splice(words.lastIndexOf(w), 1); break }
  }
  const description = words.join(' ').trim()
  const known = !category && description ? history.find(e => e.description.toLowerCase() === description.toLowerCase()) : undefined
  return { description, amount, date, category: category ?? known?.category ?? null, guessed: !category && !!known, frequency: freq ? freq[1].toLowerCase() : null }
}

function QuickSpend({ d, m }: { d: Model; m: M }) {
  const create = useCreateExpense()
  const [line, setLine] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const history = useMemo(() => [...d.expenses].sort((a, b) => b.date.localeCompare(a.date)), [d.expenses])
  const p = line.trim() ? parseSpend(line, history) : null
  const category = cat ?? p?.category ?? null
  const ok = p && p.description && p.amount && p.amount > 0 && category
  // What you log most, latest amount, so a repeat is one click and Enter.
  const usual = useMemo(() => {
    const seen = new Map<string, { e: Expense; n: number }>()
    for (const e of history) {
      if (e.recurringParentId || e.category === 'Business') continue
      const k = e.description.trim().toLowerCase()
      const x = seen.get(k); if (x) x.n++; else seen.set(k, { e, n: 1 })
    }
    return [...seen.values()].sort((a, b) => b.n - a.n || b.e.date.localeCompare(a.e.date)).slice(0, 6).map(x => x.e)
  }, [history])
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!ok) return
    create.mutate({ description: p.description, amount: p.amount, category, date: p.date, isRecurring: p.frequency ? 1 : 0, frequency: p.frequency, notes: '' },
      { onSuccess: () => { setLine(''); setCat(null) } })
  }
  return (
    <form className="nmo-quick" onSubmit={submit}>
      <input className="nr-in" value={line} onChange={e => { setLine(e.target.value); setCat(null) }} placeholder="Add spending: Groceries 45 food, or Netflix 12.99 monthly" aria-label="Add spending in one line" />
      {!p && usual.length > 0 && (
        <div className="nmo-usual" aria-label="Log again">
          <span>Again</span>
          {usual.map(u => (
            <button key={u.description} type="button" onClick={() => setLine(`${u.description} ${u.amount} ${u.category}`)} title={`Fills the line; press Enter to add`}>
              {u.description} <b className="num">{m.fmt(m.eur(u.amount, expenseCur(u)))}</b>
            </button>
          ))}
        </div>
      )}
      {p && (
        <div className="nmo-parse">
          <span>{p.description || <i>what was it?</i>}</span>
          <span className="num">{p.amount ? m.fmt(p.amount) : <i>how much?</i>}</span>
          <select className={`nmo-cat ${!category ? 'need' : ''}`} value={category ?? ''} onChange={e => setCat(e.target.value || null)} aria-label="Category">
            <option value="">Pick a category</option>
            {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {p.guessed && !cat && <span className="mute">as last time</span>}
          <span className="mute">{p.date === today() ? 'today' : fmtDay(p.date)}{p.frequency ? `, ${p.frequency}` : ''}</span>
          <button className="nx-btn sm" type="submit" disabled={!ok || create.isPending}>Add <kbd>↵</kbd></button>
        </div>
      )}
    </form>
  )
}

// ─── Side: where it comes from this year ─────────────────────────────────────

function Sources({ m, d }: { m: M; d: Model }) {
  const { ytd, settings } = d
  const parts = [
    { k: 'Business', v: ytd.biz, c: 'var(--k-ink2)', note: ytd.invoiceGbp > 0 ? `includes ${m.native(ytd.invoiceGbp, 'GBP')} received by the business` : settings.includePaidInvoices ? '' : 'business receipts are off in settings' },
    { k: 'Trading', v: ytd.trd, c: '#6E9FE0', note: settings.includeTrading ? 'realised P&L, from USD' : 'off in settings: the money is still in the market' },
    { k: 'Other', v: ytd.oth, c: 'var(--k-faint)', note: '' },
  ]
  const total = parts.reduce((s, p) => s + Math.max(0, p.v), 0)
  return (
    <section className="nx-sec nmo-src">
      <Head aside={new Date().getFullYear()}>Where it comes from</Head>
      <div className="nmo-total"><b className="num">{m.fmt(total)}</b><span>this year</span></div>
      <div className="nmo-split" aria-hidden>{parts.filter(p => p.v > 0).map(p => <i key={p.k} style={{ flex: p.v, background: p.c }} />)}</div>
      <div className="nx-rows">
        {parts.map(p => (
          <div key={p.k} className="nx-line">
            <span className="k"><i className="nx-dot" style={{ color: p.c }} />{p.k}{p.note && <small className="nmo-note">{p.note}</small>}</span>
            <span className="v"><b className="num">{m.fmt(p.v)}</b><span className="num">{total > 0 ? `${Math.round((Math.max(0, p.v) / total) * 100)}%` : ''}</span></span>
          </div>
        ))}
      </div>
      {settings.showTaxReserve && (
        <div className="nmo-tax">
          <span>Tax to keep aside this year</span>
          <b className="num warn">{m.fmt(ytd.tax)}</b>
          <small>Business {settings.taxRateBusiness}%, trading {settings.taxRateTrading}%, other {settings.taxRateOther}%. Change in Settings.</small>
        </div>
      )}
    </section>
  )
}

// ─── Cash flow: twelve months, in against out ────────────────────────────────

const tick = { fill: 'var(--k-faint)', fontSize: 11, fontFamily: 'var(--k-font)' }
const tip = {
  contentStyle: { background: 'var(--k-card2)', border: '1px solid var(--k-line2)', borderRadius: 12, fontSize: 12.5, padding: '6px 10px' },
  labelStyle: { color: 'var(--k-mute)', marginBottom: 2 }, itemStyle: { padding: 0 },
}

function CashFlow({ m, d }: { m: M; d: Model }) {
  const [table, setTable] = useState(false)
  const { hidden } = usePrivacy()
  const rows = d.months.map(x => ({ ...x, label: monthName(x.month, { month: 'short' }), outNeg: -x.out }))
  const totIn = rows.reduce((s, x) => s + x.into, 0), totOut = rows.reduce((s, x) => s + x.out, 0)
  const good = rows.filter(x => x.into > 0 || x.out > 0)
  const best = [...good].sort((a, b) => b.net - a.net)[0]
  return (
    <section className="nx-sec nmo-flow">
      <Head aside={<button className="ntr-lnk" onClick={() => setTable(t => !t)} aria-expanded={table}>{table ? 'Show the chart' : 'Show the months'}</button>}>Cash flow</Head>
      <p className="nmo-cap">
        Last 12 months: {m.fmt(totIn)} in, {m.fmt(totOut)} out, <b className={totIn - totOut >= 0 ? 'good' : 'bad'}>{m.signed(totIn - totOut)}</b> net.
        {best && best.net > 0 && <> Best month {monthName(best.month)}, {m.signed(best.net)}.</>}
      </p>
      {!table ? (
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={rows} margin={{ top: 10, right: 4, bottom: 0, left: 0 }} stackOffset="sign">
            <CartesianGrid vertical={false} stroke="rgb(var(--k-fg) / .05)" />
            <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
            <YAxis tick={tick} axisLine={false} tickLine={false} width={52} tickFormatter={v => (hidden ? '' : `${Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v)}`)} />
            <Tooltip {...tip} cursor={{ fill: 'rgb(var(--k-fg) / .03)' }} labelFormatter={(_, p) => (p?.[0] ? monthName(p[0].payload.month, { month: 'long', year: 'numeric' }) : '')}
              formatter={(v, n) => [m.fmt(Math.abs(Number(v))), n === 'into' ? 'In' : n === 'outNeg' ? 'Out' : 'Net']} />
            <Bar dataKey="into" stackId="f" fill={HEX.profit} fillOpacity={0.75} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="outNeg" stackId="f" fill={HEX.loss} fillOpacity={0.75} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Line dataKey="net" stroke="var(--k-ink)" strokeWidth={1.6} dot={{ r: 2, fill: 'var(--k-ink)', strokeWidth: 0 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <table className="nmo-table">
          <thead><tr><th>Month</th><th>In</th><th>Out</th><th>Net</th><th>Savings rate</th></tr></thead>
          <tbody>
            {[...rows].reverse().map(x => (
              <tr key={x.month}>
                <td>{monthName(x.month, { month: 'short', year: 'numeric' })}</td>
                <td className="num">{m.fmt(x.into)}</td>
                <td className="num">{m.fmt(x.out)}</td>
                <td className={`num ${x.net > 0 ? 'good' : x.net < 0 ? 'bad' : ''}`}>{m.signed(x.net)}</td>
                <td className="num">{x.into > 0 ? `${x.rate.toFixed(1)}%` : '–'}</td>
              </tr>
            ))}
            <tr className="tot"><td>Total</td><td className="num">{m.fmt(totIn)}</td><td className="num">{m.fmt(totOut)}</td><td className={`num ${totIn - totOut >= 0 ? 'good' : 'bad'}`}>{m.signed(totIn - totOut)}</td><td /></tr>
          </tbody>
        </table>
      )}
      {!table && <div className="nmo-legend"><span><i style={{ background: HEX.profit }} />In</span><span><i style={{ background: HEX.loss }} />Out</span><span><i style={{ background: 'var(--k-ink)' }} />Net</span></div>}
    </section>
  )
}

// ─── Spending by category, budgets on the same bars ──────────────────────────

function Categories({ m, d }: { m: M; d: Model }) {
  const upsert = useUpsertBudget()
  const del = useDeleteBudget()
  const [editing, setEditing] = useState<string | null>(null)
  const [val, setVal] = useState('')
  const [adding, setAdding] = useState(false)
  const month = d.expenses.filter(e => monthOf(e.date) === d.now)
  const prevM = d.expenses.filter(e => monthOf(e.date) === shiftMonth(d.now, -1))
  const by = new Map<string, number>()
  for (const e of month) by.set(e.category, (by.get(e.category) ?? 0) + m.eur(e.amount, expenseCur(e)))
  for (const b of d.budgets) if (!by.has(b.category)) by.set(b.category, 0)
  const cats = [...by.entries()].sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...cats.map(([c, v]) => Math.max(v, d.budgets.find(b => b.category === c)?.monthlyLimit ?? 0)))
  const total = month.reduce((s, e) => s + m.eur(e.amount, expenseCur(e)), 0)
  const prevTotal = prevM.reduce((s, e) => s + m.eur(e.amount, expenseCur(e)), 0)
  // Recurring costs: the templates (not their generated copies).
  const rec = d.expenses.filter(e => e.isRecurring && !e.recurringParentId)
  const fixedMonthly = rec.filter(e => e.frequency === 'monthly').reduce((s, e) => s + m.eur(e.amount, expenseCur(e)), 0)
  const yearly = rec.filter(e => e.frequency === 'yearly').reduce((s, e) => s + m.eur(e.amount, expenseCur(e)), 0)
  const oneOff = month.filter(e => !e.isRecurring && !e.recurringParentId).reduce((s, e) => s + m.eur(e.amount, expenseCur(e)), 0)

  const save = (category: string) => {
    const v = parseFloat(val.replace(',', '.'))
    if (!(v > 0)) return
    upsert.mutate({ category, monthlyLimit: v }, { onSuccess: () => { setEditing(null); setAdding(false); setVal('') } })
  }
  const unbudgeted = EXPENSE_CATEGORIES.filter(c => !d.budgets.some(b => b.category === c))

  return (
    <section className="nx-sec nmo-cats">
      <Head aside={<span className="num">{m.fmt(total)}</span>}>Spending in {monthName(d.now)}</Head>
      <p className="nmo-cap">{prevTotal > 0 ? <>{monthName(shiftMonth(d.now, -1))} was {m.fmt(prevTotal)} in all.</> : 'Largest first. Click a category to set its budget.'}</p>
      <div className="nmo-bars">
        {cats.length === 0 && <p className="nx-answer">Nothing spent yet this month.</p>}
        {cats.map(([c, v]) => {
          const b = d.budgets.find(x => x.category === c)
          const pct = b ? v / b.monthlyLimit : 0
          const tone = !b ? '' : pct >= 0.9 ? 'bad' : pct >= 0.7 ? 'warn' : 'good'
          return (
            <div key={c} className="nmo-bar-row">
              <button className="hd" onClick={() => { setEditing(editing === c ? null : c); setVal(b ? String(b.monthlyLimit) : '') }} aria-expanded={editing === c}>
                <span>{c}</span>
                <span className="num">{m.fmt(v)}{b && <small className={tone}> of {m.fmt(b.monthlyLimit)}</small>}</span>
              </button>
              <div className="track">
                <i className={tone} style={{ width: `${(v / max) * 100}%` }} />
                {b && <em style={{ left: `${(b.monthlyLimit / max) * 100}%` }} title={`Budget ${m.fmt(b.monthlyLimit)}`} />}
              </div>
              {b && v > b.monthlyLimit && <small className="bad">Over by {m.fmt(v - b.monthlyLimit)}</small>}
              {editing === c && (
                <form className="nmo-inline" onSubmit={e => { e.preventDefault(); save(c) }}>
                  <input className="nr-in num" inputMode="decimal" value={val} onChange={e => setVal(e.target.value)} placeholder="Monthly budget in €" aria-label={`Monthly budget for ${c}`} autoFocus />
                  <button className="nx-btn sm" type="submit" disabled={upsert.isPending}>{b ? 'Save' : 'Set budget'}</button>
                  {b && <button type="button" className="nx-btn ghost sm" onClick={() => del.mutate(b.id, { onSuccess: () => setEditing(null) })}>Remove budget</button>}
                </form>
              )}
            </div>
          )
        })}
      </div>
      {adding ? (
        <form className="nmo-inline" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); save(String(f.get('c'))) }}>
          <select name="c" className="nr-in" aria-label="Category" defaultValue={unbudgeted[0]}>{unbudgeted.map(c => <option key={c}>{c}</option>)}</select>
          <input className="nr-in num" inputMode="decimal" value={val} onChange={e => setVal(e.target.value)} placeholder="€ a month" aria-label="Monthly budget" autoFocus />
          <button className="nx-btn sm" type="submit">Set</button>
        </form>
      ) : <button className="ntr-lnk nmo-add" onClick={() => { setAdding(true); setVal('') }}>{d.budgets.length ? 'Set a budget for another category' : 'Set a monthly budget'}</button>}
      <div className="nx-figs nmo-figs">
        <div><span>Fixed monthly</span><b className="num">{m.fmt(fixedMonthly)}</b></div>
        <div><span>Yearly costs</span><b className="num">{m.fmt(yearly)}</b>{yearly > 0 && <small className="nmo-hint">{m.fmt(yearly / 12)} a month</small>}</div>
        <div><span>One-off this month</span><b className="num">{m.fmt(oneOff)}</b></div>
      </div>
    </section>
  )
}

// ─── Every entry: spending and income, edit in place ─────────────────────────

function Spending({ m, d }: { m: M; d: Model }) {
  // This month when it has a few entries; otherwise everything, so the list is never empty for nothing.
  const [month, setMonth] = useState<string | null>(() => (d.expenses.filter(e => monthOf(e.date) === d.now).length >= 5 ? d.now : null))
  const [open, setOpen] = useState<number | null>(null)
  const [limit, setLimit] = useState(25)
  const list = [...d.expenses].filter(e => !month || monthOf(e.date) === month).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  const total = list.reduce((s, e) => s + m.eur(e.amount, expenseCur(e)), 0)
  return (
    <section className="nx-sec nmo-list">
      <Head aside={
        <span className="nmo-month">
          <button onClick={() => setMonth(x => shiftMonth(x ?? d.now, -1))} aria-label="Previous month">‹</button>
          <b>{month ? monthName(month, { month: 'long', year: 'numeric' }) : 'All time'}</b>
          <button onClick={() => setMonth(x => (x && x < d.now ? shiftMonth(x, 1) : x))} disabled={!month || month >= d.now} aria-label="Next month">›</button>
          <button className="ntr-lnk" onClick={() => setMonth(x => (x ? null : d.now))}>{month ? 'All' : 'This month'}</button>
        </span>
      }>All spending</Head>
      <p className="nmo-cap">{list.length} entr{list.length === 1 ? 'y' : 'ies'}, {m.fmt(total)}.{d.settings.excludeBusinessExpenses ? ' Business costs are hidden (Settings).' : ' Business costs are included, from GBP.'}</p>
      <div className="nmo-rows">
        {list.slice(0, limit).map(e => open === e.id
          ? <ExpenseEdit key={e.id} e={e} onDone={() => setOpen(null)} />
          : (
            <button key={e.id} className="nmo-item" onClick={() => setOpen(e.id)} aria-label={`Edit ${e.description}`}>
              <span className="d num">{fmtDay(e.date)}</span>
              <span className="n">{e.description}{e.isRecurring || e.recurringParentId ? <small> repeats {e.frequency ?? 'monthly'}</small> : null}</span>
              <span className="c">{e.category}</span>
              <span className="a num">−{m.fmt(m.eur(e.amount, expenseCur(e)))}</span>
            </button>
          ))}
        {!list.length && <p className="nx-answer">Nothing logged{month ? ` in ${monthName(month)}` : ''}. Use the line at the top to add spending.</p>}
      </div>
      {list.length > limit && <button className="nx-btn ghost sm ntr-more" onClick={() => setLimit(l => l + 50)}>Show {Math.min(50, list.length - limit)} more</button>}
    </section>
  )
}

function ExpenseEdit({ e, onDone }: { e: Expense; onDone: () => void }) {
  const upd = useUpdateExpense()
  const del = useDeleteExpense()
  const [f, setF] = useState({ description: e.description, amount: String(e.amount), category: e.category, date: e.date, isRecurring: !!e.isRecurring, frequency: e.frequency ?? 'monthly', notes: e.notes ?? '' })
  const [confirm, setConfirm] = useState(false)
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }))
  const save = (ev: React.FormEvent) => {
    ev.preventDefault()
    const amount = parseFloat(f.amount.replace(',', '.'))
    if (!f.description.trim() || !(amount > 0)) return
    upd.mutate({ id: e.id, description: f.description.trim(), amount, category: f.category, date: f.date, isRecurring: f.isRecurring ? 1 : 0, frequency: f.isRecurring ? f.frequency : null, notes: f.notes }, { onSuccess: onDone })
  }
  return (
    <form className="nmo-edit" onSubmit={save} onKeyDown={ev => { if (ev.key === 'Escape') onDone() }}>
      <div className="g">
        <input className="nr-in" value={f.description} onChange={ev => set({ description: ev.target.value })} aria-label="Description" autoFocus />
        <input className="nr-in num" inputMode="decimal" value={f.amount} onChange={ev => set({ amount: ev.target.value })} aria-label={`Amount in ${expenseCur(f)}`} />
        <select className="nr-in" value={f.category} onChange={ev => set({ category: ev.target.value })} aria-label="Category">{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
        <input className="nr-in" type="date" value={f.date} onChange={ev => set({ date: ev.target.value })} aria-label="Date" />
      </div>
      <div className="g2">
        <label className="nmo-chk"><input type="checkbox" checked={f.isRecurring} onChange={ev => set({ isRecurring: ev.target.checked })} /> Repeats</label>
        {f.isRecurring && <select className="nr-in sm" value={f.frequency} onChange={ev => set({ frequency: ev.target.value })} aria-label="How often">{['weekly', 'monthly', 'quarterly', 'yearly'].map(x => <option key={x}>{x}</option>)}</select>}
        <input className="nr-in" value={f.notes} onChange={ev => set({ notes: ev.target.value })} placeholder="Note" aria-label="Note" />
      </div>
      <div className="ft">
        {confirm
          ? <span className="nmo-del">Delete this entry? <button type="button" className="nx-btn ghost sm" onClick={() => setConfirm(false)}>Keep</button><button type="button" className="nx-btn sm danger" onClick={() => del.mutate(e.id, { onSuccess: onDone })}>Delete</button></span>
          : <button type="button" className="nx-btn ghost sm" onClick={() => setConfirm(true)}>Delete</button>}
        <span className="nr-grow" />
        <button type="button" className="nx-btn ghost sm" onClick={onDone}>Cancel</button>
        <button type="submit" className="nx-btn sm" disabled={upd.isPending}>Save</button>
      </div>
    </form>
  )
}

/** Income in one line: "Parents 100 monthly", "Kostas 50 freelance". */
function parseIncome(line: string, history: Income[]) {
  let rest = ` ${line.trim()} `
  const amt = rest.match(/\s€?(\d+(?:[.,]\d{1,2})?)\s/)
  const amount = amt ? parseFloat(amt[1].replace(',', '.')) : null
  if (amt) rest = rest.replace(amt[0], ' ')
  const freq = rest.match(/\s(monthly|yearly)\s/i)
  if (freq) rest = rest.replace(freq[0], ' ')
  const words = rest.trim().split(/\s+/)
  let category: string | null = null
  for (const w of [...words].reverse()) {
    const hit = INCOME_CATEGORIES.find(c => c.toLowerCase() === w.toLowerCase())
    if (hit && words.length > 1) { category = hit; words.splice(words.lastIndexOf(w), 1); break }
  }
  const source = words.join(' ').trim()
  const known = !category && source ? history.find(i => i.source.toLowerCase() === source.toLowerCase()) : undefined
  return { source, amount, category: category ?? known?.category ?? null, frequency: freq ? freq[1].toLowerCase() : 'one-time' }
}

function IncomeList({ m, d }: { m: M; d: Model }) {
  const create = useCreateIncome()
  const [line, setLine] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [limit, setLimit] = useState(12)
  const sorted = useMemo(() => [...d.income].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id), [d.income])
  const p = line.trim() ? parseIncome(line, sorted) : null
  const category = cat ?? p?.category ?? null
  const ok = p && p.source && p.amount && p.amount > 0 && category
  const add = (e: React.FormEvent) => {
    e.preventDefault(); if (!ok) return
    create.mutate({ source: p.source, amount: p.amount, category, frequency: p.frequency, date: today(), notes: '' }, { onSuccess: () => { setLine(''); setCat(null) } })
  }
  const monthly = d.income.filter(i => i.frequency === 'monthly' && !i.recurringParentId).reduce((s, i) => s + i.amount, 0)
  return (
    <section className="nx-sec nmo-list nmo-inc">
      <Head aside={monthly > 0 ? <span className="num">{m.fmt(monthly)} a month repeats</span> : undefined}>Income</Head>
      <form className="nmo-quick sm" onSubmit={add}>
        <input className="nr-in" value={line} onChange={e => { setLine(e.target.value); setCat(null) }} placeholder="Parents 100 monthly" aria-label="Add income in one line" />
        {p && (
          <div className="nmo-parse">
            <span className="num">{p.amount ? m.fmt(p.amount) : <i>how much?</i>}</span>
            <select className={`nmo-cat ${!category ? 'need' : ''}`} value={category ?? ''} onChange={e => setCat(e.target.value || null)} aria-label="Category">
              <option value="">Pick a category</option>
              {INCOME_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <span className="mute">{p.frequency}</span>
            <button className="nx-btn sm" type="submit" disabled={!ok || create.isPending}>Add</button>
          </div>
        )}
      </form>
      <div className="nmo-rows">
        {sorted.slice(0, limit).map(i => open === i.id
          ? <IncomeEdit key={i.id} i={i} onDone={() => setOpen(null)} />
          : (
            <button key={i.id} className="nmo-item inc" onClick={() => setOpen(i.id)} aria-label={`Edit ${i.source}`}>
              <span className="d num">{fmtDay(i.date)}</span>
              <span className="n">{i.source}<small>{[i.category, i.frequency !== 'one-time' || i.recurringParentId ? 'repeats' : ''].filter(Boolean).join(', ')}</small></span>
              <span className="a num good">+{m.fmt(i.amount)}</span>
            </button>
          ))}
        {!sorted.length && <p className="nx-answer">No income logged. Business receipts come in on their own when they are on in Settings.</p>}
      </div>
      {sorted.length > limit && <button className="nx-btn ghost sm ntr-more" onClick={() => setLimit(l => l + 30)}>Show {Math.min(30, sorted.length - limit)} more</button>}
    </section>
  )
}

function IncomeEdit({ i, onDone }: { i: Income; onDone: () => void }) {
  const upd = useUpdateIncome()
  const del = useDeleteIncome()
  const [f, setF] = useState({ source: i.source, amount: String(i.amount), category: i.category ?? 'Other', date: i.date, frequency: i.frequency, notes: i.notes ?? '' })
  const [confirm, setConfirm] = useState(false)
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }))
  const save = (ev: React.FormEvent) => {
    ev.preventDefault()
    const amount = parseFloat(f.amount.replace(',', '.'))
    if (!f.source.trim() || !(amount > 0)) return
    upd.mutate({ id: i.id, ...f, source: f.source.trim(), amount }, { onSuccess: onDone })
  }
  return (
    <form className="nmo-edit" onSubmit={save} onKeyDown={ev => { if (ev.key === 'Escape') onDone() }}>
      <div className="g two">
        <input className="nr-in" value={f.source} onChange={ev => set({ source: ev.target.value })} aria-label="Source" autoFocus />
        <input className="nr-in num" inputMode="decimal" value={f.amount} onChange={ev => set({ amount: ev.target.value })} aria-label="Amount in euros" />
        <select className="nr-in" value={f.category} onChange={ev => set({ category: ev.target.value })} aria-label="Category">{INCOME_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
        <select className="nr-in" value={f.frequency} onChange={ev => set({ frequency: ev.target.value })} aria-label="How often">{['one-time', 'monthly', 'yearly'].map(x => <option key={x}>{x}</option>)}</select>
        <input className="nr-in" type="date" value={f.date} onChange={ev => set({ date: ev.target.value })} aria-label="Date" />
        <input className="nr-in" value={f.notes} onChange={ev => set({ notes: ev.target.value })} placeholder="Note" aria-label="Note" />
      </div>
      <div className="ft">
        {confirm
          ? <span className="nmo-del">Delete? <button type="button" className="nx-btn ghost sm" onClick={() => setConfirm(false)}>Keep</button><button type="button" className="nx-btn sm danger" onClick={() => del.mutate(i.id, { onSuccess: onDone })}>Delete</button></span>
          : <button type="button" className="nx-btn ghost sm" onClick={() => setConfirm(true)}>Delete</button>}
        <span className="nr-grow" />
        <button type="button" className="nx-btn ghost sm" onClick={onDone}>Cancel</button>
        <button type="submit" className="nx-btn sm" disabled={upd.isPending}>Save</button>
      </div>
    </form>
  )
}

// ─── Net worth and accounts ──────────────────────────────────────────────────

function NetWorth({ m, d }: { m: M; d: Model }) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const assets = d.accounts.filter(a => !LIABILITY.has(a.type)).reduce((s, a) => s + d.bal(a), 0)
  const owed = d.accounts.filter(a => LIABILITY.has(a.type)).reduce((s, a) => s + Math.abs(d.bal(a)), 0)
  const now = assets - owed
  const buckets = ['Liquid', 'Invested', 'Crypto', 'Other'].map(k => ({ k, v: d.accounts.filter(a => bucketOf(a.type) === k).reduce((s, a) => s + d.bal(a), 0) }))
  const snaps: { date: string; netWorth: number; totalAssets: number; totalLiabilities: number }[] = d.netWorth?.snapshots ?? []
  const last = snaps[snaps.length - 1]
  const snapToday = last?.date === today()
  const snapshot = async () => {
    setSaving(true)
    try {
      await api.post('/api/finance/net-worth/snapshot', { date: today(), totalAssets: Math.round(assets * 100) / 100, totalLiabilities: Math.round(owed * 100) / 100, netWorth: Math.round(now * 100) / 100 })
      await qc.invalidateQueries({ queryKey: ['net-worth'] }); await qc.invalidateQueries({ queryKey: ['finance-summary'] })
    } finally { setSaving(false) }
  }
  return (
    <section className="nx-sec nmo-nw">
      <Head aside={last ? <span>Last snapshot {fmtDay(last.date)}</span> : 'No snapshots yet'}>Net worth</Head>
      <div className="nmo-nw-top">
        <div className="nmo-total"><b className={`num ${now < 0 ? 'bad' : ''}`}>{d.accounts.length ? m.fmt(now) : '–'}</b><span>{d.accounts.length ? 'from your accounts today' : 'add accounts to see it'}</span></div>
        <div className="nx-figs">
          {buckets.map(b => <div key={b.k}><span>{b.k}</span><b className="num">{m.fmt(b.v)}</b></div>)}
          <div><span>Owed</span><b className={`num ${owed > 0 ? 'bad' : ''}`}>{m.fmt(owed)}</b></div>
        </div>
      </div>
      {last && <p className="nmo-cap">Since the last snapshot: <b className={now - last.netWorth >= 0 ? 'good' : 'bad'}>{m.signed(now - last.netWorth)}</b>.</p>}
      {snaps.length > 1 && (
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={snaps} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="rgb(var(--k-fg) / .05)" />
            <XAxis dataKey="date" tick={tick} axisLine={false} tickLine={false} tickFormatter={fmtDay} minTickGap={30} />
            <YAxis tick={tick} axisLine={false} tickLine={false} width={52} tickFormatter={v => `${Math.round(v / 1000)}k`} />
            <Tooltip {...tip} labelFormatter={l => fmtDay(String(l))} formatter={v => [m.fmt(Number(v)), 'Net worth']} />
            <Area dataKey="netWorth" stroke="var(--k-ink)" strokeWidth={1.8} fill="var(--k-ink)" fillOpacity={0.06} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
      <div className="nmo-acts">
        <button className="nx-btn ghost sm" onClick={snapshot} disabled={!d.accounts.length || saving}>{saving ? 'Saving…' : snapToday ? "Update today's snapshot" : 'Take a snapshot'}</button>
        <span className="nmo-hint">A snapshot saves today's total so the line above can show the trend. Once a month is enough.</span>
      </div>
    </section>
  )
}

function Accounts({ m, d }: { m: M; d: Model }) {
  const [open, setOpen] = useState<number | 'new' | null>(null)
  return (
    <section className="nx-sec nmo-acc">
      <Head aside={d.accounts.length ? <span className="num">{d.accounts.length}</span> : undefined}>Accounts</Head>
      <p className="nmo-cap">Balances feed runway and net worth. A trading account adds its realised P&L on top.</p>
      <div className="nmo-rows">
        {d.accounts.map(a => open === a.id
          ? <AccountEdit key={a.id} a={a} onDone={() => setOpen(null)} />
          : (
            <button key={a.id} className="nmo-item acc" onClick={() => setOpen(a.id)} aria-label={`Edit ${a.name}`}>
              <span className="n">{a.name}<small>{ACCOUNT_TYPES.find(t => t.v === a.type)?.l ?? a.type}{a.currency !== 'EUR' ? `, in ${a.currency}` : ''}</small></span>
              <span className={`a num ${LIABILITY.has(a.type) ? 'bad' : ''}`}>{m.fmt(d.bal(a))}</span>
            </button>
          ))}
      </div>
      {open === 'new' ? <AccountEdit onDone={() => setOpen(null)} /> : <button className="nx-btn ghost sm ntr-more" onClick={() => setOpen('new')}>Add an account</button>}
    </section>
  )
}

function AccountEdit({ a, onDone }: { a?: Account; onDone: () => void }) {
  const create = useCreateAccount()
  const upd = useUpdateAccount()
  const del = useDeleteAccount()
  const [f, setF] = useState({ name: a?.name ?? '', type: a?.type ?? 'checking', balance: a ? String(a.balance) : '', currency: a?.currency ?? 'EUR', isTrading: !!a?.isTrading })
  const [confirm, setConfirm] = useState(false)
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }))
  const save = (ev: React.FormEvent) => {
    ev.preventDefault()
    const balance = parseFloat(f.balance.replace(',', '.'))
    if (!f.name.trim() || !Number.isFinite(balance)) return
    const body = { name: f.name.trim(), type: f.type, balance, currency: f.currency, isTrading: f.isTrading || f.type === 'trading' ? 1 : 0 }
    if (a) upd.mutate({ id: a.id, ...body }, { onSuccess: onDone }); else create.mutate(body, { onSuccess: onDone })
  }
  return (
    <form className="nmo-edit" onSubmit={save} onKeyDown={ev => { if (ev.key === 'Escape') onDone() }}>
      <div className="g two">
        <input className="nr-in" value={f.name} onChange={ev => set({ name: ev.target.value })} placeholder="Name, e.g. Revolut" aria-label="Account name" autoFocus />
        <select className="nr-in" value={f.type} onChange={ev => set({ type: ev.target.value })} aria-label="Type">{ACCOUNT_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}</select>
        <input className="nr-in num" inputMode="decimal" value={f.balance} onChange={ev => set({ balance: ev.target.value })} placeholder={LIABILITY.has(f.type) ? 'Amount owed' : 'Balance'} aria-label="Balance" />
        <select className="nr-in" value={f.currency} onChange={ev => set({ currency: ev.target.value })} aria-label="Currency">{['EUR', 'GBP', 'USD'].map(c => <option key={c}>{c}</option>)}</select>
      </div>
      <div className="ft">
        {a && (confirm
          ? <span className="nmo-del">Delete? <button type="button" className="nx-btn ghost sm" onClick={() => setConfirm(false)}>Keep</button><button type="button" className="nx-btn sm danger" onClick={() => del.mutate(a.id, { onSuccess: onDone })}>Delete</button></span>
          : <button type="button" className="nx-btn ghost sm" onClick={() => setConfirm(true)}>Delete</button>)}
        <span className="nr-grow" />
        <button type="button" className="nx-btn ghost sm" onClick={onDone}>Cancel</button>
        <button type="submit" className="nx-btn sm" disabled={create.isPending || upd.isPending}>{a ? 'Save' : 'Add account'}</button>
      </div>
    </form>
  )
}

// ─── Settings ────────────────────────────────────────────────────────────────

function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { settings, save } = useFinanceSettings()
  const [f, setF] = useState(settings)
  const set = (p: Partial<FinanceSettings>) => setF(x => ({ ...x, ...p }))
  const toggles: { k: 'includePaidInvoices' | 'includeTrading' | 'showTaxReserve' | 'excludeBusinessExpenses'; l: string; s: string }[] = [
    { k: 'includePaidInvoices', l: 'Count business receipts as income', s: 'Payments the business receives, converted from GBP.' },
    { k: 'includeTrading', l: 'Count trading P&L as income', s: 'Realised P&L, converted from USD. Off while the money stays in the market.' },
    { k: 'showTaxReserve', l: 'Show the tax to keep aside', s: 'Worked out from the rates below.' },
    { k: 'excludeBusinessExpenses', l: 'Hide business costs', s: 'Business category costs stay on the Business tab.' },
  ]
  return (
    <div className="nr-sheet-bg" onMouseDown={onClose}>
      <div className="nr-sheet" role="dialog" aria-label="Money settings" onMouseDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
        <div className="hd"><div><h2>Money settings</h2><p>What counts as income, and how much to keep for tax.</p></div><button className="nx-btn ghost sm" onClick={onClose}>Close</button></div>
        {toggles.map(t => (
          <label key={t.k} className="nmo-tog">
            <span><b>{t.l}</b><small>{t.s}</small></span>
            <input type="checkbox" role="switch" checked={!!f[t.k]} onChange={e => set({ [t.k]: e.target.checked } as Partial<FinanceSettings>)} />
          </label>
        ))}
        <div className="nmo-rates">
          <span>Tax to keep aside</span>
          {([['taxRateBusiness', 'Business'], ['taxRateTrading', 'Trading'], ['taxRateOther', 'Other']] as const).map(([k, l]) => (
            <label key={k}>{l}<input className="nr-in num" type="number" step="0.5" min="0" max="100" value={f[k]} onChange={e => set({ [k]: Number(e.target.value) } as Partial<FinanceSettings>)} /><em>%</em></label>
          ))}
        </div>
        <div className="nmo-sheet-ft"><button className="nx-btn ghost sm" onClick={onClose}>Cancel</button><button className="nx-btn sm" onClick={() => { save(f); onClose() }}>Save</button></div>
      </div>
    </div>
  )
}

/*
 * Feature inventory, old Finances page -> here:
 * currency selector + conversion (bar), settings: 3 income toggles, business-cost toggle, 3 tax rates (Settings);
 * overview totals, savings rate, net worth, tax reserve (hero, Sources, Net worth); income streams (Sources);
 * accounts list (Accounts, now editable); cash flow bars, net line, monthly table with totals and savings rate (Cash flow);
 * income table, add, delete (Income, plus edit); spending by category chart, table, add, recurring, delete
 * (Spending in month + All spending, plus edit); budgets with fixed monthly and yearly totals, per-category bars,
 * set, delete, over-budget note (Spending in month); net worth assets, liabilities, buckets, snapshot chart
 * (Net worth, plus Take a snapshot).
 */
