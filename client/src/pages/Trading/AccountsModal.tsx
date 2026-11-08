import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import {
  useTradingAccounts,
  useCreateTradingAccount,
  useUpdateTradingAccount,
  useDeleteTradingAccount,
  type TradingAccount,
} from '../../hooks/useTradingAccounts'
import { Plus, Edit, Trash2, X, Check, Wallet, Star } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  defaultAccountId: number | null
  onSetDefault: (id: number | null) => void
}

type AccountFormState = {
  name: string
  broker: string
  currency: string
  startingBalance: string
  startingBalanceAt: string   // ISO; set to "now" when the balance changes
  fullRisk: string
  notes: string
  maxLossDay: string
  maxLossWeek: string
  maxLossMonth: string
  lossLimitUnit: 'R' | 'USD'
}

const emptyForm = (): AccountFormState => ({ name: '', broker: '', currency: 'USD', startingBalance: '', startingBalanceAt: '', fullRisk: '', notes: '', maxLossDay: '', maxLossWeek: '', maxLossMonth: '', lossLimitUnit: 'R' })
const str = (n: number | null | undefined) => (n != null ? String(n) : '')
const toForm = (a: TradingAccount): AccountFormState => ({
  name:            a.name,
  broker:          a.broker ?? '',
  currency:        a.currency,
  startingBalance: a.startingBalance != null ? String(a.startingBalance) : '',
  startingBalanceAt: a.startingBalanceAt ?? '',
  fullRisk:        a.fullRisk != null ? String(a.fullRisk) : '',
  notes:           a.notes ?? '',
  maxLossDay:      str(a.maxLossDay),
  maxLossWeek:     str(a.maxLossWeek),
  maxLossMonth:    str(a.maxLossMonth),
  lossLimitUnit:   a.lossLimitUnit ?? 'R',
})

const CURRENCIES = ['USD', 'GBP', 'EUR', 'AUD', 'CAD', 'JPY']

// Shared label style
const labelStyle: React.CSSProperties = { color: 'var(--c-text-3)' }
const inputStyle: React.CSSProperties = { background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }
const inputClass = 'w-full rounded-lg px-3 py-2 text-sm outline-none transition-all duration-150'

export function AccountsModal({ open, onClose, defaultAccountId, onSetDefault }: Props) {
  const { data: accounts } = useTradingAccounts()
  const create = useCreateTradingAccount()
  const update = useUpdateTradingAccount()
  const deleteMut = useDeleteTradingAccount()

  const [editingId, setEditingId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<AccountFormState>(emptyForm())
  const [error, setError] = useState<string | null>(null)

  const setField = (key: keyof AccountFormState, value: string) =>
    setForm(f => ({ ...f, [key]: value }))

  const startEdit = (a: TradingAccount) => {
    setAdding(false)
    setEditingId(a.id)
    setForm(toForm(a))
    setError(null)
  }

  const startAdd = () => {
    setEditingId(null)
    setAdding(true)
    setForm(emptyForm())
    setError(null)
  }

  const cancel = () => {
    setEditingId(null)
    setAdding(false)
    setError(null)
  }

  const save = async () => {
    if (!form.name.trim()) { setError('Account name is required'); return }
    setError(null)
    const payload = {
      name:            form.name.trim(),
      broker:          form.broker.trim() || null,
      currency:        form.currency,
      startingBalance: form.startingBalance !== '' ? Number(form.startingBalance) : null,
      startingBalanceAt: form.startingBalance === '' ? null : form.startingBalanceAt || new Date().toISOString(),
      fullRisk:        form.fullRisk !== '' ? Number(form.fullRisk) : null,
      notes:           form.notes.trim() || null,
      maxLossDay:      form.maxLossDay,
      maxLossWeek:     form.maxLossWeek,
      maxLossMonth:    form.maxLossMonth,
      lossLimitUnit:   form.lossLimitUnit,
    }
    if (editingId != null) {
      await update.mutateAsync({ id: editingId, ...payload })
    } else {
      await create.mutateAsync(payload)
    }
    cancel()
  }

  const handleDelete = async (id: number) => {
    setError(null)
    try {
      await deleteMut.mutateAsync(id)
      setConfirmDeleteId(null)
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to delete account')
      setConfirmDeleteId(null)
    }
  }

  const isPending = create.isPending || update.isPending || deleteMut.isPending

  // Inlined form JSX - NOT a component, so typing never causes unmount
  const formJsx = (
    <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-widest" style={labelStyle}>Account Name *</label>
          <input
            className={inputClass}
            style={inputStyle}
            placeholder="Prop Firm A, Binance, IB…"
            value={form.name}
            onChange={e => setField('name', e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-widest" style={labelStyle}>Broker / Platform</label>
          <input
            className={inputClass}
            style={inputStyle}
            placeholder="FTMO, Binance, IBKR…"
            value={form.broker}
            onChange={e => setField('broker', e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-widest" style={labelStyle}>Currency</label>
          <select
            className={inputClass}
            style={inputStyle}
            value={form.currency}
            onChange={e => setField('currency', e.target.value)}
          >
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-widest flex items-center gap-1.5" style={labelStyle}
            title="What the account held at a point in time. Its balance is this plus every trade closed after it.">
            Balance
            <span className="normal-case tracking-normal font-normal">
              as of{' '}
              <input type="date" value={form.startingBalanceAt.slice(0, 10)}
                onChange={e => setField('startingBalanceAt', e.target.value ? `${e.target.value}T00:00:00.000Z` : '')}
                className="bg-transparent outline-none num" style={{ color: 'var(--c-text-2)', colorScheme: 'dark' }} />
            </span>
          </label>
          <input
            type="number"
            step="any"
            className={inputClass}
            style={inputStyle}
            placeholder="e.g. 10000"
            value={form.startingBalance}
            onChange={e => setForm(f => ({ ...f, startingBalance: e.target.value, startingBalanceAt: new Date().toISOString() }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-widest" style={labelStyle} title="Your full-size risk per trade. Trades get ½R / 1R / 1.5R / 2R buttons from it.">Full risk (1R)</label>
          <input
            type="number"
            step="any"
            className={inputClass}
            style={inputStyle}
            placeholder="e.g. 7"
            value={form.fullRisk}
            onChange={e => setField('fullRisk', e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-widest" style={labelStyle}
            title="The most this account may lose in a day, a week (Mon–Sun, UTC) or a calendar month. The trading page warns you as you get close and tells you to stop when you hit one.">
            Max loss
          </label>
          <div className="flex rounded-md overflow-hidden text-[10px] font-semibold" style={{ border: '1px solid var(--c-border-mid)' }}>
            {(['R', 'USD'] as const).map(u => (
              <button key={u} type="button" onClick={() => setForm(f => ({ ...f, lossLimitUnit: u }))} className="px-2 py-0.5"
                style={{ background: form.lossLimitUnit === u ? 'var(--c-accent)' : 'transparent', color: form.lossLimitUnit === u ? 'var(--c-on-accent)' : 'var(--c-text-3)' }}>
                {u === 'R' ? 'in R' : 'in $'}
              </button>
            ))}
          </div>
          {form.lossLimitUnit === 'R' && !form.fullRisk && <span className="text-[10px]" style={{ color: '#f59e0b' }}>needs Full risk (1R) set</span>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {([['maxLossDay', 'Day'], ['maxLossWeek', 'Week'], ['maxLossMonth', 'Month']] as const).map(([k, l]) => (
            <div key={k} className="relative">
              <input type="number" step="any" min="0" className={inputClass + ' pl-14'} style={inputStyle}
                placeholder={form.lossLimitUnit === 'R' ? 'e.g. 3' : 'e.g. 100'} value={form[k]} onChange={e => setField(k, e.target.value)} />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: 'var(--c-text-3)' }}>{l}</span>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: 'var(--c-text-3)' }}>{form.lossLimitUnit === 'R' ? 'R' : '$'}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-widest" style={labelStyle}>Notes</label>
        <textarea
          rows={2}
          className={inputClass + ' resize-none'}
          style={inputStyle}
          placeholder="Max drawdown rules, account type, notes…"
          value={form.notes}
          onChange={e => setField('notes', e.target.value)}
        />
      </div>
      {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}
      <div className="flex items-center gap-2 justify-end">
        <Button type="button" variant="secondary" size="sm" onClick={cancel}><X size={13} /> Cancel</Button>
        <Button type="button" size="sm" disabled={isPending} onClick={save}>
          <Check size={13} /> {editingId != null ? 'Save Changes' : 'Add Account'}
        </Button>
      </div>
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title="Trading accounts" size="lg">
      <div className="p-5 space-y-4">
        <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
          Star an account to make it load by default on refresh. Your last viewed account is also remembered automatically.
        </p>

        {/* Account list */}
        {!accounts?.length ? (
          <div className="text-center py-8" style={{ color: 'var(--c-text-3)' }}>
            <Wallet size={28} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">No accounts yet. Add one below.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {accounts.map(a => (
              <div key={a.id}>
                {editingId === a.id ? formJsx : (
                  <div
                    className="flex items-center gap-3 px-4 py-3 rounded-xl"
                    style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: 'var(--c-bg-hover)', color: 'var(--c-text-2)' }}>
                      <Wallet size={15} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm" style={{ color: 'var(--c-text-1)' }}>{a.name}</span>
                        {a.broker && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--c-bg-hover)', color: 'var(--c-text-1)', border: '1px solid var(--c-border)' }}>
                            {a.broker}
                          </span>
                        )}
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--c-bg-input)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}>
                          {a.currency}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {a.startingBalance != null && (
                          <span className="text-[11px] num" style={{ color: 'var(--c-text-3)' }}>
                            Starting: {a.startingBalance.toLocaleString()} {a.currency}
                          </span>
                        )}
                        <span className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                          {a.tradeCount} {a.tradeCount === 1 ? 'trade' : 'trades'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {confirmDeleteId === a.id ? (
                        <>
                          <span className="text-xs mr-1" style={{ color: 'var(--c-text-3)' }}>Delete?</span>
                          <button
                            onClick={() => handleDelete(a.id)}
                            disabled={isPending}
                            className="px-2 py-1 rounded text-xs font-medium transition-all"
                            style={{ background: 'rgba(248,113,113,0.15)', color: 'var(--c-loss)', border: '1px solid rgba(248,113,113,0.3)' }}
                          >Yes</button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 rounded text-xs font-medium transition-all"
                            style={{ background: 'var(--c-bg-input)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}
                          >No</button>
                        </>
                      ) : (
                        <>
                          {/* Star = set as default */}
                          <button
                            onClick={() => onSetDefault(defaultAccountId === a.id ? null : a.id)}
                            className={`ui-icon warn ${defaultAccountId === a.id ? 'on' : ''}`}
                            title={defaultAccountId === a.id ? 'Remove as default' : 'Set as default (loads on refresh)'}
                            aria-pressed={defaultAccountId === a.id}
                          >
                            <Star size={14} fill={defaultAccountId === a.id ? 'currentColor' : 'none'} />
                          </button>
                          <button
                            onClick={() => startEdit(a)}
                            className="ui-icon" title="Edit" aria-label={`Edit ${a.name}`}
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(a.id)}
                            className="ui-icon danger" title="Delete" aria-label={`Delete ${a.name}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Error from delete */}
        {error && !editingId && !adding && (
          <p className="text-xs px-1" style={{ color: 'var(--c-loss)' }}>{error}</p>
        )}

        {/* Add account form or button */}
        {adding ? formJsx : (
          <button
            onClick={startAdd}
            className="ui-btn secondary md w-full"
          >
            <Plus size={14} /> Add account
          </button>
        )}
      </div>
    </Modal>
  )
}
