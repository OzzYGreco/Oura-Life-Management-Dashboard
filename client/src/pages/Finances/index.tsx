import { useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useFinanceAccounts, useFinanceIncome, useFinanceExpenses, useNetWorth, useFinanceSummary,
  useCreateIncome, useCreateExpense, useDeleteIncome, useDeleteExpense, useRecurringExpenses,
  useCashFlow, useIncomeStreams, useFinanceBudgets, useUpsertBudget, useDeleteBudget,
} from '../../hooks/useFinances'
import { useFinanceSettings, type FinanceSettings } from '../../hooks/useFinanceSettings'
import { useFmtView, type FmtView } from '../../hooks/useFmtView'
import { CurrencySelector } from '../../components/ui/CurrencySelector'
import { ConversionBanner } from '../../components/ui/ConversionBanner'
import { PageShell } from '../../components/layout/PageShell'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { StatCard } from '../../components/ui/StatCard'
import { Tabs } from '../../components/ui/Tabs'
import { Card } from '../../components/ui/Card'
import { PageLoader } from '../../components/ui/Spinner'
import { EmptyState } from '../../components/ui/EmptyState'
import { formatGBP, formatDate } from '../../lib/utils'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../lib/constants'
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'
import { Plus, Trash2, DollarSign, Settings2, TrendingUp, Repeat, RefreshCw, Info } from 'lucide-react'

// Native currencies: all personal finance amounts are in EUR

// ─── Constants ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'cashflow',  label: 'Cash Flow' },
  { id: 'income',    label: 'Income' },
  { id: 'expenses',  label: 'Expenses' },
  { id: 'budgets',   label: 'Budgets' },
  { id: 'networth',  label: 'Net Worth' },
]

// ─── Finance Settings Modal ───────────────────────────────────────────────────

function FinanceSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, save } = useFinanceSettings()
  const { register, handleSubmit, watch } = useForm<FinanceSettings>({ values: settings })

  const onSubmit = (data: FinanceSettings) => {
    save({
      ...data,
      taxRateTrading:  Number(data.taxRateTrading),
      taxRateBusiness: Number(data.taxRateBusiness),
      taxRateOther:    Number(data.taxRateOther),
    })
    onClose()
  }

  const SH = ({ label }: { label: string }) => (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-accent)' }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: 'var(--c-border)' }} />
    </div>
  )

  const Toggle = ({ name, label, desc }: { name: keyof FinanceSettings; label: string; desc: string }) => {
    const val = watch(name) as boolean
    return (
      <div className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid var(--c-border-subtle)' }}>
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--c-text-1)' }}>{label}</p>
          <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>{desc}</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" className="sr-only" {...register(name as any)} />
          <div className="w-9 h-5 rounded-full transition-colors"
            style={{ background: val ? 'var(--c-accent)' : 'var(--c-border)' }}>
            <div className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
              style={{ transform: val ? 'translateX(20px)' : 'translateX(2px)' }} />
          </div>
        </label>
      </div>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Finance Settings" size="sm">
      <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-5">
        <div>
          <SH label="Income Sources" />
          <p className="text-[11px] mb-3" style={{ color: 'var(--c-text-3)' }}>
            Toggle which sources count toward your income and savings rate calculations.
          </p>
          <Toggle name="includeTrading" label="Include Trading P&L"
            desc="Money is still in the market. Toggle off to exclude unrealised gains." />
          <Toggle name="includePaidInvoices" label="Include Paid Invoices"
            desc="Auto-pull Zavabuild paid invoices as business income" />
          <Toggle name="showTaxReserve" label="Show Tax Reserve"
            desc="Display estimated tax liability based on income and configured rates" />
        </div>

        <div>
          <SH label="Expenses" />
          <Toggle name="excludeBusinessExpenses" label="Exclude Business Expenses"
            desc="Hide category='Business' expenses from your personal finance view (expenses tab, summaries, budgets, cash flow)" />
        </div>

        <div>
          <SH label="Tax Reserve %" />
          <p className="text-[11px] mb-3" style={{ color: 'var(--c-text-3)' }}>
            % of each income stream to set aside for taxes. Shown as a deduction in the summary.
          </p>
          <div className="space-y-2">
            {[
              { key: 'taxRateTrading',  label: 'Trading' },
              { key: 'taxRateBusiness', label: 'Business' },
              { key: 'taxRateOther',    label: 'Other' },
            ].map(f => (
              <div key={f.key} className="flex items-center gap-3">
                <span className="text-xs font-semibold w-16" style={{ color: 'var(--c-text-2)' }}>{f.label}</span>
                <Input type="number" step="0.5" min="0" max="100" {...register(f.key as any)} className="w-20" />
                <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-3" style={{ borderTop: '1px solid var(--c-border)' }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ fmtView }: { fmtView: FmtView }) {
  const { data: summary } = useFinanceSummary()
  const { data: accounts } = useFinanceAccounts()
  const { data: streams } = useIncomeStreams()
  const { settings } = useFinanceSettings()

  const taxReserve = summary ? (
    (summary.manualIncome * (streams?.other?.pct ? settings.taxRateOther / 100 : 0)) +
    (summary.tradingPnl > 0 ? summary.tradingPnl * settings.taxRateTrading / 100 : 0) +
    (summary.invoiceIncome * settings.taxRateBusiness / 100)
  ) : 0

  const STREAM_COLORS = { trading: '#818cf8', business: '#10b981', other: '#f59e0b' }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-5 gap-4">
        <StatCard label="Total Income"   value={fmtView(summary?.totalIncome,   'EUR')} valueColor="text-pnl-profit" />
        <StatCard label="Total Expenses" value={fmtView(summary?.totalExpenses, 'EUR')} valueColor="text-pnl-loss" />
        {(() => {
          const net = (summary?.totalIncome ?? 0) - (summary?.totalExpenses ?? 0)
          return (
            <StatCard label="Net" value={fmtView(net, 'EUR')}
              valueColor={net >= 0 ? 'text-pnl-profit' : 'text-pnl-loss'}
              badge={net >= 0 ? undefined : { text: 'spending > income', color: '#f87171' }} />
          )
        })()}
        <StatCard label="Savings Rate" value={summary?.savingsRate != null ? `${(summary.savingsRate * 100).toFixed(1)}%` : '--'}
          valueColor={summary?.savingsRate > 0 ? 'text-pnl-profit' : 'text-pnl-loss'} />
        <StatCard label="Net Worth" value={fmtView(summary?.netWorth, 'EUR')} icon={<DollarSign size={16} />} />
      </div>

      {/* Tax reserve warning */}
      {settings.showTaxReserve && taxReserve > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl"
          style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
          <Info size={14} style={{ color: '#fbbf24', flexShrink: 0 }} />
          <span className="text-sm" style={{ color: '#fbbf24' }}>
            <strong>{fmtView(taxReserve, 'EUR')}</strong> estimated tax reserve needed based on your current income and configured rates.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Income streams */}
        {streams && (
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--c-text-1)' }}>Income Streams</h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { key: 'trading', label: 'Trading', color: STREAM_COLORS.trading },
                { key: 'business', label: 'Business', color: STREAM_COLORS.business },
                { key: 'other', label: 'Other', color: STREAM_COLORS.other },
              ].map(s => (
                <div key={s.key} className="text-center p-2 rounded-lg" style={{ background: 'var(--c-bg-input)' }}>
                  <div className="text-xs font-bold mb-1" style={{ color: s.color }}>{s.label}</div>
                  <div className="text-sm num font-bold" style={{ color: 'var(--c-text-1)' }}>
                    {fmtView((streams as any)[s.key]?.amount, s.key === 'business' ? 'GBP' : s.key === 'other' ? 'EUR' : 'USD')}
                  </div>
                  <div className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>
                    {((streams as any)[s.key]?.pct ?? 0).toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={[
                    { name: 'Trading', value: streams.trading?.amount ?? 0 },
                    { name: 'Business', value: streams.business?.amount ?? 0 },
                    { name: 'Other', value: streams.other?.amount ?? 0 },
                  ]} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3} dataKey="value">
                    {Object.values(STREAM_COLORS).map((c, i) => <Cell key={i} fill={c} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)', borderRadius: 8, color: 'var(--c-text-1)' }}
                    formatter={(v: any) => fmtView(v, 'EUR')} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        {/* Accounts */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--c-text-1)' }}>Accounts</h3>
          <div className="space-y-2">
            {accounts?.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between py-2"
                style={{ borderBottom: '1px solid var(--c-border-subtle)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--c-text-1)' }}>{a.name}</span>
                  {a.isTrading ? <Badge variant="blue">Trading</Badge> : null}
                </div>
                <span className="num font-bold text-sm" style={{ color: 'var(--c-text-1)' }}>
                  {fmtView(a.displayBalance ?? a.balance, 'EUR')}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

{/* CurrencyConverter removed — use the view-currency selector in the page header */}
    </div>
  )
}

// ─── Cash Flow Tab ─────────────────────────────────────────────────────────────

function CashFlowTab({ fmtView }: { fmtView: FmtView }) {
  const { data: cashflow, isPending } = useCashFlow()

  if (isPending) return <PageLoader />

  const rows: any[] = cashflow ?? []
  const totalNet = rows.reduce((s: number, r: any) => s + r.net, 0)

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--c-text-1)' }}>Monthly Income vs Expenses</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--c-chart-grid)" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--c-chart-tick)' }} axisLine={false} tickLine={false}
                tickFormatter={m => m.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--c-chart-tick)' }} axisLine={false} tickLine={false}
                tickFormatter={v => `$${Math.abs(v) >= 1000 ? (v/1000).toFixed(0)+'k' : v}`} />
              <Tooltip contentStyle={{ background: 'var(--c-chart-tooltip-bg)', border: '1px solid var(--c-border)', borderRadius: 8, color: 'var(--c-text-1)' }}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                formatter={(v: any) => fmtView(v, 'EUR')} />
              <ReferenceLine y={0} stroke="var(--c-border)" />
              <Bar dataKey="totalIncome" name="Income" fill="#34d399" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expenses" name="Expenses" fill="#f87171" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--c-text-1)' }}>Net Cash Flow</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--c-chart-grid)" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--c-chart-tick)' }} axisLine={false} tickLine={false}
                tickFormatter={m => m.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--c-chart-tick)' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: 'var(--c-chart-tooltip-bg)', border: '1px solid var(--c-border)', borderRadius: 8, color: 'var(--c-text-1)' }}
                formatter={(v: any) => fmtView(v, 'EUR')} />
              <ReferenceLine y={0} stroke="var(--c-border)" />
              <Area type="monotone" dataKey="net" name="Net" stroke="var(--c-accent)" fill="var(--c-accent)"
                fillOpacity={0.1} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Monthly table */}
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--c-border)', background: 'var(--c-bg-input)' }}>
              {['Month', 'Income', 'Expenses', 'Net', 'Savings Rate'].map(h => (
                <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wide px-4 py-2.5"
                  style={{ color: 'var(--c-text-3)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.month} style={{ borderBottom: '1px solid var(--c-border-subtle)' }}>
                <td className="px-4 py-2.5 num text-xs font-medium" style={{ color: 'var(--c-text-2)' }}>{r.month}</td>
                <td className="px-4 py-2.5 num" style={{ color: 'var(--c-profit)' }}>{fmtView(r.totalIncome, 'EUR')}</td>
                <td className="px-4 py-2.5 num" style={{ color: 'var(--c-loss)' }}>{fmtView(r.expenses, 'EUR')}</td>
                <td className="px-4 py-2.5 num font-bold" style={{ color: r.net >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>
                  {fmtView(r.net, 'EUR')}
                </td>
                <td className="px-4 py-2.5 num" style={{ color: r.savingsRate >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>
                  {r.savingsRate.toFixed(1)}%
                </td>
              </tr>
            ))}
            <tr style={{ background: 'rgba(99,102,241,0.05)', borderTop: '2px solid rgba(99,102,241,0.2)' }}>
              <td className="px-4 py-2.5 text-xs font-bold uppercase" style={{ color: 'var(--c-text-1)' }}>Total</td>
              <td className="px-4 py-2.5 num font-bold" style={{ color: 'var(--c-profit)' }}>
                {fmtView(rows.reduce((s: number, r: any) => s + r.totalIncome, 0), 'EUR')}
              </td>
              <td className="px-4 py-2.5 num font-bold" style={{ color: 'var(--c-loss)' }}>
                {fmtView(rows.reduce((s: number, r: any) => s + r.expenses, 0), 'EUR')}
              </td>
              <td className="px-4 py-2.5 num font-bold" style={{ color: totalNet >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>
                {fmtView(totalNet, 'EUR')}
              </td>
              <td className="px-4 py-2.5" />
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  )
}

// ─── Income Tab ───────────────────────────────────────────────────────────────

function IncomeTab({ fmtView }: { fmtView: FmtView }) {
  const { data: income, isPending } = useFinanceIncome()
  const createIncome = useCreateIncome()
  const deleteIncome = useDeleteIncome()
  const [open, setOpen] = useState(false)
  const { register, handleSubmit, reset } = useForm({ defaultValues: { source: '', amount: '', frequency: 'one-time', category: '', date: new Date().toISOString().split('T')[0], notes: '' } })

  if (isPending) return <PageLoader />

  const onSubmit = async (data: any) => { await createIncome.mutateAsync({ ...data, amount: parseFloat(data.amount) }); setOpen(false); reset() }

  return (
    <div>
      <div className="flex justify-end mb-4"><Button size="sm" onClick={() => setOpen(true)}><Plus size={14} /> Add Income</Button></div>
      {!income?.length ? <EmptyState title="No income recorded" action={<Button onClick={() => setOpen(true)}><Plus size={14} /> Add Income</Button>} /> : (
        <Card>
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: '1px solid var(--c-border)', background: 'var(--c-bg-input)' }}>
              {['Date', 'Source', 'Category', 'Frequency', 'Amount', ''].map(h =>
                <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wide px-4 py-2.5" style={{ color: 'var(--c-text-3)' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {income.map((i: any) => (
                <tr key={i.id} style={{ borderBottom: '1px solid var(--c-border-subtle)' }}>
                  <td className="px-4 py-2.5 text-xs num" style={{ color: 'var(--c-text-2)' }}>{formatDate(i.date)}</td>
                  <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--c-text-1)' }}>{i.source}</td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--c-text-2)' }}>{i.category || '--'}</td>
                  <td className="px-4 py-2.5"><Badge variant="gray">{i.frequency}</Badge></td>
                  <td className="px-4 py-2.5 num font-semibold" style={{ color: 'var(--c-profit)' }}>+{fmtView(i.amount, 'EUR')}</td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => deleteIncome.mutate(i.id)} className="p-1 rounded" style={{ color: 'var(--c-text-3)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-loss)'}
                      onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)'}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add Income">
        <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-3">
          <Input label="Source" placeholder="Trading, Freelance, Salary..." {...register('source', { required: true })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Amount (€)" type="number" step="any" {...register('amount', { required: true })} />
            <Input label="Date" type="date" {...register('date')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Category" options={INCOME_CATEGORIES.map(c => ({ value: c, label: c }))} placeholder="Select..." {...register('category')} />
            <Select label="Frequency" options={['one-time','monthly','yearly'].map(v => ({ value: v, label: v }))} {...register('frequency')} />
          </div>
          <Textarea label="Notes" rows={2} {...register('notes')} />
          <div className="flex justify-end gap-3 pt-2" style={{ borderTop: '1px solid var(--c-border)' }}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit">Add</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

// ─── Expenses Tab ─────────────────────────────────────────────────────────────

function ExpensesTab({ fmtView }: { fmtView: FmtView }) {
  const { settings } = useFinanceSettings()
  const expParams = settings.excludeBusinessExpenses ? { excludeBusiness: '1' } : {}
  const { data: expenses, isPending } = useFinanceExpenses(expParams)
  const createExpense = useCreateExpense()
  const deleteExpense = useDeleteExpense()
  const [open, setOpen] = useState(false)
  const { register, handleSubmit, reset } = useForm({ defaultValues: { description: '', amount: '', category: '', date: new Date().toISOString().split('T')[0], isRecurring: false, frequency: '', notes: '' } })

  if (isPending) return <PageLoader />

  const byCategory = (expenses || []).reduce((acc: Record<string, number>, e: any) => {
    acc[e.category] = (acc[e.category] || 0) + e.amount; return acc
  }, {})

  const onSubmit = async (data: any) => { await createExpense.mutateAsync({ ...data, amount: parseFloat(data.amount), isRecurring: data.isRecurring ? 1 : 0 }); setOpen(false); reset() }

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="sm" onClick={() => setOpen(true)}><Plus size={14} /> Add Expense</Button></div>
      {Object.keys(byCategory).length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--c-text-1)' }}>By Category</h3>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={Object.entries(byCategory).map(([cat, amt]) => ({ cat, amt }))}>
                <XAxis dataKey="cat" tick={{ fontSize: 10, fill: 'var(--c-chart-tick)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--c-chart-tick)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={{ background: 'var(--c-chart-tooltip-bg)', border: '1px solid var(--c-border)', borderRadius: 8, color: 'var(--c-text-1)' }}
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  formatter={(v: any) => [fmtView(v as number, 'EUR')]} />
                <Bar dataKey="amt" fill="#f87171" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      {!expenses?.length ? <EmptyState title="No expenses recorded" action={<Button onClick={() => setOpen(true)}><Plus size={14} /> Add Expense</Button>} /> : (
        <Card>
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: '1px solid var(--c-border)', background: 'var(--c-bg-input)' }}>
              {['Date', 'Description', 'Category', 'Recurring', 'Amount', ''].map(h =>
                <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wide px-4 py-2.5" style={{ color: 'var(--c-text-3)' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {(expenses || []).map((e: any) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--c-border-subtle)' }}>
                  <td className="px-4 py-2.5 text-xs num" style={{ color: 'var(--c-text-2)' }}>{formatDate(e.date)}</td>
                  <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--c-text-1)' }}>{e.description}</td>
                  <td className="px-4 py-2.5"><Badge variant="gray">{e.category}</Badge></td>
                  <td className="px-4 py-2.5">
                    {e.isRecurring ? <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--c-accent)' }}><Repeat size={11} />{e.frequency}</span> : <span style={{ color: 'var(--c-text-3)' }}>--</span>}
                  </td>
                  <td className="px-4 py-2.5 num font-semibold" style={{ color: 'var(--c-loss)' }}>-{fmtView(e.amount, 'EUR')}</td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => deleteExpense.mutate(e.id)} className="p-1 rounded" style={{ color: 'var(--c-text-3)' }}
                      onMouseEnter={e2 => (e2.currentTarget as HTMLButtonElement).style.color = 'var(--c-loss)'}
                      onMouseLeave={e2 => (e2.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)'}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add Expense">
        <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-3">
          <Input label="Description" placeholder="Netflix, Rent, Groceries..." {...register('description', { required: true })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Amount ($)" type="number" step="any" {...register('amount', { required: true })} />
            <Input label="Date" type="date" {...register('date')} />
          </div>
          <Select label="Category" options={EXPENSE_CATEGORIES.map(c => ({ value: c, label: c }))} placeholder="Select..." {...register('category', { required: true })} />
          <div className="flex items-center gap-3">
            <input type="checkbox" id="recur" {...register('isRecurring')} className="rounded" />
            <label htmlFor="recur" className="text-sm" style={{ color: 'var(--c-text-2)' }}>Recurring expense</label>
            <Select options={['monthly','yearly'].map(v => ({ value: v, label: v }))} {...register('frequency')} className="w-32" placeholder="Frequency" />
          </div>
          <Textarea label="Notes" rows={2} {...register('notes')} />
          <div className="flex justify-end gap-3 pt-2" style={{ borderTop: '1px solid var(--c-border)' }}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit">Add</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

// ─── Budgets Tab ──────────────────────────────────────────────────────────────

function BudgetsTab({ fmtView }: { fmtView: FmtView }) {
  const { settings } = useFinanceSettings()
  const { data: budgets } = useFinanceBudgets()
  const budgetExpParams: Record<string, string> = { from: new Date().toISOString().slice(0, 7) + '-01' }
  if (settings.excludeBusinessExpenses) budgetExpParams.excludeBusiness = '1'
  const { data: expenses } = useFinanceExpenses(budgetExpParams)
  const upsertBudget = useUpsertBudget()
  const deleteBudget = useDeleteBudget()
  const [open, setOpen] = useState(false)
  const { register, handleSubmit, reset } = useForm({ defaultValues: { category: '', monthlyLimit: '' } })

  const currentMonthSpend = (expenses || []).reduce((acc: Record<string, number>, e: any) => {
    acc[e.category] = (acc[e.category] || 0) + e.amount; return acc
  }, {})

  const onSubmit = async (data: any) => { await upsertBudget.mutateAsync({ category: data.category, monthlyLimit: parseFloat(data.monthlyLimit) }); setOpen(false); reset() }

  const trafficLight = (spent: number, limit: number): { color: string; variant: 'green' | 'yellow' | 'red' } => {
    const pct = spent / limit
    if (pct >= 0.9) return { color: 'var(--c-loss)', variant: 'red' }
    if (pct >= 0.7) return { color: '#fbbf24', variant: 'yellow' }
    return { color: 'var(--c-profit)', variant: 'green' }
  }

  const monthlyRecurring = (expenses || []).filter((e: any) => e.isRecurring && e.frequency === 'monthly').reduce((s: number, e: any) => s + e.amount, 0)
  const yearlyRecurring = (expenses || []).filter((e: any) => e.isRecurring && e.frequency === 'yearly').reduce((s: number, e: any) => s + e.amount, 0)

  return (
    <div className="space-y-5">
      {/* Recurring summary */}
      {(monthlyRecurring > 0 || yearlyRecurring > 0) && (
        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Fixed Monthly Costs" value={fmtView(monthlyRecurring, 'EUR')} icon={<RefreshCw size={15} />} iconBg="rgba(248,113,113,0.1)" iconColor="var(--c-loss)" accent="var(--c-loss)" />
          <StatCard label="Annual Recurring" value={fmtView(yearlyRecurring, 'USD')} sub={`${fmtView(yearlyRecurring / 12, 'EUR')}/mo equiv.`} icon={<Repeat size={15} />} iconBg="rgba(251,191,36,0.1)" iconColor="#fbbf24" />
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--c-text-1)' }}>Monthly Category Budgets</h3>
        <Button size="sm" onClick={() => setOpen(true)}><Plus size={14} /> Set Budget</Button>
      </div>

      {!budgets?.length ? (
        <EmptyState title="No budgets set" description="Set monthly limits per category to track overspending"
          action={<Button onClick={() => setOpen(true)}><Plus size={14} /> Set Budget</Button>} />
      ) : (
        <div className="space-y-3">
          {(budgets || []).map((b: any) => {
            const spent = currentMonthSpend[b.category] ?? 0
            const pct = Math.min((spent / b.monthlyLimit) * 100, 100)
            const { color, variant } = trafficLight(spent, b.monthlyLimit)
            return (
              <Card key={b.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm" style={{ color: 'var(--c-text-1)' }}>{b.category}</span>
                    <Badge variant={variant}>{pct.toFixed(0)}%</Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm num font-medium" style={{ color }}>
                      {fmtView(spent, 'USD')} / {fmtView(b.monthlyLimit, 'EUR')}
                    </span>
                    <button onClick={() => deleteBudget.mutate(b.id)} className="p-1 rounded" style={{ color: 'var(--c-text-3)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-loss)'}
                      onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)'}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--c-border)' }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
                </div>
                {spent > b.monthlyLimit && (
                  <p className="text-[11px] mt-1 font-semibold" style={{ color: 'var(--c-loss)' }}>
                    Over budget by {fmtView(spent - b.monthlyLimit, 'EUR')}
                  </p>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Set Monthly Budget">
        <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-3">
          <Select label="Category" options={EXPENSE_CATEGORIES.map(c => ({ value: c, label: c }))} placeholder="Select category..." {...register('category', { required: true })} />
          <Input label="Monthly Limit ($)" type="number" step="any" placeholder="500.00" {...register('monthlyLimit', { required: true })} />
          <div className="flex justify-end gap-3 pt-2" style={{ borderTop: '1px solid var(--c-border)' }}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

// ─── Net Worth Tab ────────────────────────────────────────────────────────────

function NetWorthTab({ fmtView }: { fmtView: FmtView }) {
  const { data: nw } = useNetWorth()
  const { data: accounts } = useFinanceAccounts()

  const breakdown = (accounts || []).reduce((acc: Record<string, number>, a: any) => {
    const group = a.type === 'checking' || a.type === 'savings' ? 'Liquid'
      : a.type === 'brokerage' || a.type === 'trading' ? 'Investments'
      : a.type === 'crypto' ? 'Crypto' : 'Other'
    acc[group] = (acc[group] || 0) + (a.displayBalance ?? a.balance)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {nw?.latest && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Net Worth" value={fmtView(nw.latest.netWorth, 'EUR')} />
          <StatCard label="Total Assets" value={fmtView(nw.latest.totalAssets, 'EUR')} valueColor="text-pnl-profit" />
          <StatCard label="Total Liabilities" value={fmtView(nw.latest.totalLiabilities, 'EUR')} valueColor="text-pnl-loss" />
        </div>
      )}

      {Object.keys(breakdown).length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(breakdown).map(([group, val]) => (
            <Card key={group} className="p-4 text-center">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--c-text-3)' }}>{group}</div>
              <div className="text-xl num font-bold" style={{ color: 'var(--c-text-1)' }}>{fmtView(val as number, 'EUR')}</div>
            </Card>
          ))}
        </div>
      )}

      {nw?.snapshots?.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--c-text-1)' }}>Net Worth Over Time</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={nw.snapshots}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--c-chart-grid)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--c-chart-tick)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--c-chart-tick)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: 'var(--c-chart-tooltip-bg)', border: '1px solid var(--c-border)', borderRadius: 8, color: 'var(--c-text-1)' }} formatter={(v: any) => [fmtView(v, 'EUR'), 'Net Worth']} />
                <Area type="monotone" dataKey="netWorth" stroke="var(--c-accent)" fill="var(--c-accent)" fillOpacity={0.1} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      {!nw?.snapshots?.length && <EmptyState title="No net worth snapshots" description="Add periodic snapshots to track your net worth over time" />}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function FinancesPage() {
  const [tab, setTab]                   = useState('overview')
  const [settingsOpen, setSettingsOpen] = useState(false)
  // All personal finance amounts are native EUR
  const { fmtView } = useFmtView('EUR', 'finance')

  return (
    <PageShell
      title="Finances"
      action={
        <div className="flex items-center gap-2">
          <CurrencySelector pageKey="finance" defaultCurrency="EUR" />

          <button
            onClick={() => setSettingsOpen(true)}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-accent)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-accent)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border)' }}
            title="Finance Settings"
          >
            <Settings2 size={14} />
          </button>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>
      }
    >
      <ConversionBanner native="EUR" pageKey="finance" />

      {tab === 'overview' && <OverviewTab fmtView={fmtView} />}
      {tab === 'cashflow' && <CashFlowTab fmtView={fmtView} />}
      {tab === 'income'   && <IncomeTab   fmtView={fmtView} />}
      {tab === 'expenses' && <ExpensesTab fmtView={fmtView} />}
      {tab === 'budgets'  && <BudgetsTab  fmtView={fmtView} />}
      {tab === 'networth' && <NetWorthTab fmtView={fmtView} />}

      <FinanceSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </PageShell>
  )
}
