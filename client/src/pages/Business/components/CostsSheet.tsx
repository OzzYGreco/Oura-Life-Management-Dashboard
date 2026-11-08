import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useSaveCost, useDeleteCost, useChangeCostPrice } from '../../../hooks/useBusiness'
import { MiniBtn } from './primitives'
import { formatDate, today } from '../../../lib/utils'
import type { FmtView } from '../../../hooks/useFmtView'

const REPEATS = [
  { value: 'once', label: 'Once' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
] as const
const PER_MONTH: Record<string, number> = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }

const cell = 'px-2 py-1.5 text-xs'
const input = 'w-full bg-transparent outline-none rounded px-1.5 py-1 text-xs border border-transparent focus:border-[var(--c-border-strong)] focus:bg-[var(--c-bg-input)]'
const inputStyle = { color: 'var(--c-text-1)' } as const

interface Draft { description: string; vendor: string; clientId: string; amount: string; date: string; repeat: string; paidBy: string }
const empty = (): Draft => ({ description: '', vendor: '', clientId: '', amount: '', date: today(), repeat: 'once', paidBy: '' })

/**
 * Business costs, logged like a spreadsheet.
 *
 * The top row is always empty and ready: type what it was, the amount, press
 * Enter, and it is saved; the row clears for the next one. Every saved cell
 * edits in place and saves when you leave it. A repeating cost's amount
 * changes from now on, keeping what it charged before; a single charge's
 * amount changes just that charge.
 */
export function CostsSheet({
  expenses, clients, owners = [], fmtView, onOpenFull,
}: {
  expenses: any[]
  clients: { id: number; name: string }[]
  /** Partners, for a cost one of them paid out of their own pocket. */
  owners?: { id: number; name: string }[]
  fmtView: FmtView
  /** The full form, for anything the sheet does not do (notes, other price scopes). */
  onOpenFull: (expense: any) => void
}) {
  const save = useSaveCost()
  const remove = useDeleteCost()
  const changePrice = useChangeCostPrice()
  const [draft, setDraft] = useState<Draft>(empty)
  const [show, setShow] = useState<'repeating' | 'all'>('all')
  const [limit, setLimit] = useState(25)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)

  const rows = useMemo(() => [...expenses]
    .filter(e => show === 'all' || (e.isRecurring && !e.recurringParentId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id), [expenses, show])

  const add = async () => {
    setError(null)
    const amount = Number(draft.amount)
    if (!draft.description.trim() || !(amount > 0)) { setError('A description and an amount are enough to save a cost.'); return }
    const repeats = draft.repeat !== 'once'
    try {
      await save.mutateAsync({
        description: draft.description.trim(), vendor: draft.vendor || null,
        clientId: draft.clientId ? Number(draft.clientId) : null,
        paidByOwnerId: draft.paidBy ? Number(draft.paidBy) : null,
        amount, date: draft.date || today(), category: 'Business',
        isRecurring: repeats ? 1 : 0, frequency: repeats ? draft.repeat : null,
      })
      setDraft(d => ({ ...empty(), date: d.date }))
      first.current?.focus()
    } catch (e: any) { setError(e?.response?.data?.error ?? 'Could not save that') }
  }
  const onEnter = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); add() } }

  /** Save one field of a saved row, when it actually changed. */
  const patch = async (row: any, field: string, raw: string) => {
    setError(null)
    try {
      if (field === 'amount') {
        const amount = Number(raw)
        const current = row.recurringAmount ?? row.amount
        if (!(amount > 0) || Math.abs(amount - current) < 0.005) return
        if (row.isRecurring && !row.recurringParentId) {
          await changePrice.mutateAsync({ id: row.id, newAmount: amount, scope: 'future' })
        } else {
          await save.mutateAsync({ id: row.id, amount })
        }
        return
      }
      if (field === 'repeat') {
        const repeats = raw !== 'once'
        await save.mutateAsync({ id: row.id, isRecurring: repeats ? 1 : 0, frequency: repeats ? raw : null })
        return
      }
      if (field === 'paidByOwnerId') {
        // Switching who paid starts the "owed back" over: not yet repaid.
        await save.mutateAsync({ id: row.id, paidByOwnerId: raw ? Number(raw) : null, reimbursedAt: null })
        return
      }
      const value = field === 'clientId' ? (raw ? Number(raw) : null) : raw || null
      if ((row[field] ?? null) === value) return
      if (field === 'description' && !raw.trim()) return
      await save.mutateAsync({ id: row.id, [field]: value })
    } catch (e: any) { setError(e?.response?.data?.error ?? 'Could not save that') }
  }

  const total = rows.reduce((s, e) => s + e.amount, 0)
  const monthly = expenses.filter(e => e.isRecurring && !e.recurringParentId)
    .reduce((s, e) => s + (e.recurringAmount ?? e.amount) * (PER_MONTH[e.frequency] ?? 0), 0)

  const ClientSelect = ({ value, onChange, onBlur, autoSave }: { value: string; onChange: (v: string) => void; onBlur?: () => void; autoSave?: boolean }) => (
    <select value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur}
      className={input} style={{ ...inputStyle, color: value ? 'var(--c-text-1)' : 'var(--c-text-3)' }}
      data-autosave={autoSave ? '1' : undefined}>
      <option value="">The business</option>
      {clients.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
    </select>
  )

  const PaidBySelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select aria-label="Paid from" value={value} onChange={e => onChange(e.target.value)}
      className={input} style={{ ...inputStyle, color: value ? '#f59e0b' : 'var(--c-text-3)' }}
      title="A partner who paid this personally is owed it back">
      <option value="">Business</option>
      {owners.map(o => <option key={o.id} value={String(o.id)}>{o.name.split(' ')[0]}, personally</option>)}
    </select>
  )

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <p className="text-[11.5px]" style={{ color: 'var(--c-text-2)' }}>
          Repeating costs come to <b className="num" style={{ color: 'var(--c-text-1)' }}>{fmtView(monthly)}</b> a month.
          {' '}Type in the top row and press Enter. Click any cell to change it.
        </p>
        <div className="flex gap-1.5">
          {(['all', 'repeating'] as const).map(k => (
            <MiniBtn key={k} tone={show === k ? 'accent' : 'default'} onClick={() => setShow(k)}>
              {k === 'all' ? 'Every charge' : 'Repeating only'}
            </MiniBtn>
          ))}
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col /><col style={{ width: '15%' }} /><col style={{ width: '16%' }} /><col style={{ width: 100 }} />
              <col style={{ width: 132 }} /><col style={{ width: 110 }} /><col style={{ width: 128 }} /><col style={{ width: 96 }} /><col style={{ width: 128 }} />
            </colgroup>
            <thead>
              <tr style={{ background: 'var(--c-bg-input)', borderBottom: '1px solid var(--c-border)' }}>
                {['What it was', 'Paid to', 'For', 'Amount', 'Date', 'Repeats', 'Paid from', 'A month', ''].map((h, i) => (
                  <th key={i} className={`${cell} text-[9.5px] font-bold uppercase tracking-wider ${[3, 4, 7].includes(i) ? 'text-right' : 'text-left'}`}
                    style={{ color: 'var(--c-text-3)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* The ready row. */}
              <tr style={{ background: 'var(--c-bg-input)', borderBottom: '1px solid var(--c-border)' }}>
                <td className={cell}><input ref={first} aria-label="What it was" placeholder="New cost: what it was" value={draft.description}
                  onChange={e => setDraft({ ...draft, description: e.target.value })} onKeyDown={onEnter}
                  className={input} style={inputStyle} /></td>
                <td className={cell}><input aria-label="Paid to" placeholder="Paid to" value={draft.vendor}
                  onChange={e => setDraft({ ...draft, vendor: e.target.value })} onKeyDown={onEnter}
                  className={input} style={inputStyle} /></td>
                <td className={cell}><ClientSelect value={draft.clientId} onChange={v => setDraft({ ...draft, clientId: v })} /></td>
                <td className={cell}><input aria-label="Amount" placeholder="0.00" type="number" step="0.01" value={draft.amount}
                  onChange={e => setDraft({ ...draft, amount: e.target.value })} onKeyDown={onEnter}
                  className={`${input} text-right num`} style={inputStyle} /></td>
                <td className={cell}><input aria-label="Date" type="date" value={draft.date}
                  onChange={e => setDraft({ ...draft, date: e.target.value })} onKeyDown={onEnter}
                  className={`${input} num`} style={inputStyle} /></td>
                <td className={cell}>
                  <select aria-label="Repeats" value={draft.repeat} onChange={e => setDraft({ ...draft, repeat: e.target.value })} onKeyDown={onEnter}
                    className={input} style={inputStyle}>
                    {REPEATS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </td>
                <td className={cell}><PaidBySelect value={draft.paidBy} onChange={v => setDraft({ ...draft, paidBy: v })} /></td>
                <td className={`${cell} text-right num`} style={{ color: 'var(--c-text-3)' }}>
                  {draft.repeat !== 'once' && Number(draft.amount) > 0 ? fmtView(Number(draft.amount) * (PER_MONTH[draft.repeat] ?? 0)) : ''}
                </td>
                <td className={`${cell} text-right`}>
                  <MiniBtn tone="accent" onClick={add} disabled={save.isPending}>Add</MiniBtn>
                </td>
              </tr>

              {rows.slice(0, limit).map(e => {
                const isTemplate = e.isRecurring && !e.recurringParentId
                const repeat = e.isRecurring ? (e.frequency ?? 'monthly') : 'once'
                const amount = isTemplate ? (e.recurringAmount ?? e.amount) : e.amount
                return (
                  <tr key={`${e.id}:${e.description}:${amount}:${e.vendor}:${e.clientId}:${repeat}:${e.paidByOwnerId}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.045)" }}>
                    <td className={cell}>
                      <input aria-label="What it was" defaultValue={e.description}
                        onBlur={ev => patch(e, 'description', ev.target.value)}
                        onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
                        className={input} style={inputStyle} />
                    </td>
                    <td className={cell}>
                      <input aria-label="Paid to" defaultValue={e.vendor ?? ''} placeholder="--"
                        onBlur={ev => patch(e, 'vendor', ev.target.value)}
                        onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
                        className={input} style={{ ...inputStyle, color: 'var(--c-text-2)' }} />
                    </td>
                    <td className={cell}>
                      <ClientSelect value={e.clientId ? String(e.clientId) : ''} onChange={v => patch(e, 'clientId', v)} />
                    </td>
                    <td className={cell}>
                      <input aria-label="Amount" type="number" step="0.01" defaultValue={amount}
                        onBlur={ev => patch(e, 'amount', ev.target.value)}
                        onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
                        title={isTemplate ? 'A new amount applies from now on; past charges keep theirs' : 'Changes this charge only'}
                        className={`${input} text-right num`} style={{ ...inputStyle, color: 'var(--c-loss)' }} />
                    </td>
                    <td className={`${cell} text-right num`} style={{ color: 'var(--c-text-3)' }}>
                      {formatDate(e.date)}
                    </td>
                    <td className={cell}>
                      {e.recurringParentId ? (
                        <span className="px-1.5 text-[11px]" style={{ color: 'var(--c-text-3)' }}>{repeat} renewal</span>
                      ) : (
                        <select aria-label="Repeats" value={repeat} onChange={ev => patch(e, 'repeat', ev.target.value)}
                          className={input} style={{ ...inputStyle, color: 'var(--c-text-2)' }}>
                          {REPEATS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      )}
                    </td>
                    <td className={cell} title={e.paidByOwnerId ? (e.reimbursedAt ? `Paid back ${formatDate(e.reimbursedAt)}` : 'Not paid back yet') : undefined}>
                      <PaidBySelect value={e.paidByOwnerId ? String(e.paidByOwnerId) : ''} onChange={v => patch(e, 'paidByOwnerId', v)} />
                    </td>
                    <td className={`${cell} text-right num`} style={{ color: 'var(--c-text-3)' }}>
                      {isTemplate ? fmtView(amount * (PER_MONTH[repeat] ?? 0)) : ''}
                    </td>
                    <td className={`${cell} text-right whitespace-nowrap`}>
                      <span className="inline-flex gap-1">
                        <MiniBtn title="Notes and the other price options" onClick={() => onOpenFull(e)}>More</MiniBtn>
                        <MiniBtn tone="danger" onClick={() => { if (window.confirm(`Delete "${e.description}" (${fmtView(e.amount)})?`)) remove.mutate(e.id) }}>Delete</MiniBtn>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--c-bg-input)', borderTop: '2px solid var(--c-border-strong)' }}>
                <td className={`${cell} font-semibold`} colSpan={3} style={{ color: 'var(--c-text-1)' }}>
                  {rows.length} {show === 'all' ? 'charges' : 'repeating costs'}
                </td>
                <td className={`${cell} text-right num font-semibold`} style={{ color: 'var(--c-text-1)' }}>{fmtView(total)}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      {error && <p className="text-xs mt-2" style={{ color: 'var(--c-loss)' }}>{error}</p>}
      {rows.length > limit && (
        <div className="mt-2"><MiniBtn onClick={() => setLimit(l => l + 50)}>Show {Math.min(50, rows.length - limit)} more</MiniBtn></div>
      )}
    </div>
  )
}
