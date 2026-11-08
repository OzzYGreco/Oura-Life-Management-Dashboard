import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { Popover } from './controls'
import { Button } from '../../components/ui/Button'
import { formatCurrency } from '../../lib/utils'
import {
  useBybitStatus, useBybitSyncNow, useBybitReview, useApplyBybitReview,
  type BybitAccountStatus, type BybitReview, type ReviewMissing,
} from '../../hooks/useBybit'

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const utc = (iso: string) => iso.slice(0, 16).replace('T', ' ')
const n = (v: unknown) => typeof v === 'number' ? (Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(+v.toPrecision(6))) : v == null ? '—' : String(v)

/**
 * Bybit's state as one small button: a dot (live, warning, error) and when it
 * last synced. The menu holds each account's status, the check against Bybit,
 * key expiry and "Sync now".
 */
export function BybitPanel({ accountId }: { accountId: number | null }) {
  const { data } = useBybitStatus()
  const sync = useBybitSyncNow()
  const [reviewing, setReviewing] = useState<number | null>(null)

  const accounts = (data?.accounts ?? []).filter(a => a.configured && (accountId == null || a.accountId === accountId))
  if (!accounts.length) return null
  const problem = accounts.some(a => a.lastError) ? 'error'
    : accounts.some(a => !a.reviewed || expiresIn(a) != null && expiresIn(a)! <= 14) ? 'warn'
    : accounts.every(a => a.live) ? 'live' : 'idle'
  const dot = { error: 'var(--c-loss)', warn: '#f59e0b', live: 'var(--c-profit)', idle: 'var(--c-text-3)' }[problem]
  const latest = accounts.map(a => a.lastSyncAt).filter(Boolean).sort().pop() ?? null

  return (
    <>
      <Popover width={360} trigger={(open, toggle) => (
        <button type="button" onClick={toggle}
          className="flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-xl text-xs transition-colors"
          style={{ background: open ? 'var(--c-bg-hover)' : 'var(--c-bg-input)', boxShadow: 'inset 0 0 0 1px var(--c-border)', color: 'var(--c-text-2)' }}>
          <span className="relative flex h-2 w-2">
            {problem === 'live' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50" style={{ background: dot }} />}
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: dot }} />
          </span>
          <span className="font-semibold" style={{ color: 'var(--c-text-1)' }}>Bybit</span>
          <span style={{ color: 'var(--c-text-3)' }}>
            {problem === 'error' ? 'sync error' : problem === 'warn' ? 'needs attention' : problem === 'live' ? `live · ${ago(latest)}` : ago(latest)}
          </span>
          <ChevronDown size={12} style={{ color: 'var(--c-text-3)', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }} />
        </button>
      )}>
        {close => (
          <div>
            {accounts.map(a => <AccountLine key={a.accountId} a={a} onReview={() => { setReviewing(a.accountId); close() }} />)}
            <div className="flex items-center gap-2 mt-1 px-2.5 py-2" style={{ borderTop: '1px solid var(--c-border)' }}>
              <span className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>All times are UTC</span>
              <button onClick={() => sync.mutate(accountId ?? undefined)} disabled={sync.isPending}
                className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-50"
                style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)' }}>
                <RefreshCw size={12} className={sync.isPending ? 'animate-spin' : ''} /> {sync.isPending ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
          </div>
        )}
      </Popover>
      {reviewing != null && <ReviewModal accountId={reviewing} onClose={() => setReviewing(null)} />}
    </>
  )
}

const expiresIn = (a: BybitAccountStatus) => (a.keyExpiresAt ? Math.floor((Date.parse(a.keyExpiresAt) - Date.now()) / 86400_000) : null)

function AccountLine({ a, onReview }: { a: BybitAccountStatus; onReview: () => void }) {
  const exp = expiresIn(a)
  const dot = a.lastError ? 'var(--c-loss)' : a.live ? 'var(--c-profit)' : 'var(--c-text-3)'
  return (
    <div className="px-2.5 py-2 rounded-xl text-xs hover:bg-[var(--c-bg-hover)]">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />
        <span className="font-semibold" style={{ color: 'var(--c-text-1)' }}>{a.name}</span>
        <span style={{ color: 'var(--c-text-3)' }}>{a.live ? 'live' : 'not connected'} · synced {ago(a.lastSyncAt)}</span>
        <button onClick={onReview} className="ml-auto hover:underline" style={{ color: a.reviewed ? 'var(--c-text-3)' : 'var(--c-accent)', fontWeight: a.reviewed ? 400 : 600 }}>
          {a.reviewed ? 'Check against Bybit' : 'Review before syncing →'}
        </button>
      </div>
      {a.lastError && (
        <div className="mt-1 ml-3.5 flex items-center gap-1" style={{ color: 'var(--c-loss)' }}><AlertTriangle size={11} /> {a.lastError}</div>
      )}
      {exp != null && exp <= 14 && (
        <div className="mt-1 ml-3.5" style={{ color: '#f59e0b' }}>API key {exp < 0 ? 'expired' : `expires in ${exp}d`}: make a new read-only key</div>
      )}
      {exp != null && exp > 14 && <div className="mt-0.5 ml-3.5" style={{ color: 'var(--c-text-3)' }}>Read-only key, valid {exp} more days</div>}
    </div>
  )
}

// ─── Review ──────────────────────────────────────────────────────────────────

function ReviewModal({ accountId, onClose }: { accountId: number; onClose: () => void }) {
  const { data: rv, isLoading } = useBybitReview(accountId)
  return (
    <Modal open onClose={onClose} size="xl" title={`Check ${rv?.name ?? 'account'} against Bybit`}>
      {isLoading || !rv ? <div className="py-10 text-center text-sm" style={{ color: 'var(--c-text-3)' }}>Reading Bybit history…</div>
        : <ReviewBody rv={rv} onClose={onClose} />}
    </Modal>
  )
}

function ReviewBody({ rv, onClose }: { rv: BybitReview; onClose: () => void }) {
  const apply = useApplyBybitReview()

  const earliestLogged = useMemo(() => {
    const dates = [...rv.matches.map(m => m.openedAt.slice(0, 10)), ...rv.unmatched.map(u => u.date)].sort()
    return dates[0] ?? rv.firstPositionAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
  }, [rv])
  const [syncFrom, setSyncFrom] = useState(rv.syncFrom ?? earliestLogged)
  const [remove, setRemove] = useState<Set<number>>(() => new Set(rv.unmatched.filter(u => u.samePositionAs != null).map(u => u.tradeId)))
  useEffect(() => { if (rv.syncFrom) setSyncFrom(rv.syncFrom) }, [rv.syncFrom])

  // Where each unlogged position goes: this account, or another one (real
  // trades taken here before the other account existed on Bybit).
  const [dest, setDest] = useState<Map<string, number>>(() => new Map(
    rv.missing.filter(p => p.suggestAccountId != null).map(p => [p.externalId, p.suggestAccountId!])))
  const setDestFor = (id: string, acct: number) => setDest(m => { const x = new Map(m); acct === rv.accountId ? x.delete(id) : x.set(id, acct); return x })

  const changed = rv.matches.filter(m => m.diffs.length)
  const moved = rv.missing.filter(p => dest.has(p.externalId))
  const added = rv.missing.filter(p => !dest.has(p.externalId) && p.openedAt.slice(0, 10) >= syncFrom)
  const left = rv.missing.filter(p => !dest.has(p.externalId) && p.openedAt.slice(0, 10) < syncFrom)
  const accountName = (id: number) => id === rv.accountId ? rv.name : rv.otherAccounts.find(o => o.accountId === id)?.name ?? `#${id}`
  const movedTo = [...new Set(moved.map(p => dest.get(p.externalId)!))]
  const sumNet = (xs: ReviewMissing[]) => xs.reduce((s, p) => s + (p.net ?? 0), 0)
  const fieldCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const m of changed) for (const d of m.diffs) c[d.field] = (c[d.field] ?? 0) + 1
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [changed])

  const done = apply.data
  return (
    <div className="flex flex-col gap-5 text-sm" style={{ color: 'var(--c-text-2)' }}>
      <p style={{ color: 'var(--c-text-1)' }}>
        Bybit has <b>{rv.matches.length + rv.missing.length}</b> positions on this account.{' '}
        <b>{rv.matches.length}</b> of your logged trades match one;{' '}
        {changed.length ? <><b>{changed.length}</b> of those differ from Bybit somewhere and will take Bybit's figures. </> : 'all agree with Bybit. '}
        Your setups, notes, mistakes, rules and logged stops are kept as they are. From then on this account fills itself in.
      </p>

      {fieldCounts.length > 0 && (
        <Section title={`Corrections · ${changed.length} trades`} defaultOpen={false}
          lead={`Most often: ${fieldCounts.slice(0, 4).map(([f, c]) => `${f} (${c})`).join(', ')}. Times are compared in UTC; differences of under three minutes are ignored, and so are fees within 2 cents.`}>
          <div className="flex flex-col divide-y" style={{ borderColor: 'var(--c-border)' }}>
            {changed.map(m => (
              <div key={m.tradeId} className="py-1.5 flex flex-wrap gap-x-3 gap-y-1 items-baseline">
                <span className="num text-xs w-14" style={{ color: 'var(--c-text-3)' }}>#{m.tradeId}</span>
                <span className="w-40 text-xs" style={{ color: 'var(--c-text-1)' }}>{m.symbol} {m.direction} · {utc(m.openedAt)}</span>
                {m.diffs.map(d => (
                  <span key={d.field} className="text-xs num">
                    <span style={{ color: 'var(--c-text-3)' }}>{d.field}</span>{' '}
                    <s style={{ color: 'var(--c-text-3)' }}>{n(d.logged)}</s> → <span style={{ color: 'var(--c-text-1)' }}>{n(d.bybit)}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title={`Not logged · ${rv.missing.length} positions`} defaultOpen
        lead={<>
          Sync from{' '}
          <input type="date" value={syncFrom} onChange={e => setSyncFrom(e.target.value)}
            className="px-1.5 py-0.5 rounded text-xs num" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)' }} />
          {' '}(your first logged trade is {earliestLogged}).{' '}
          <b>{added.length}</b> will be added ({formatCurrency(sumNet(added))} net)
          {left.length > 0 && <>; {left.length} from before that date stay out ({formatCurrency(sumNet(left))} net)</>}
          {moved.length > 0 && <>; <b>{moved.length}</b> go to {movedTo.map(accountName).join(', ')} ({formatCurrency(sumNet(moved))} net)</>}.
          {rv.otherAccounts.some(o => o.firstFillAt) && <>
            {' '}Real trades taken here before {rv.otherAccounts.filter(o => o.firstFillAt).map(o => `${o.name} started (${o.firstFillAt!.slice(0, 10)})`).join(', ')} and
            risking $20 or more are set to move there; change any row with its "Goes to" choice.
          </>}
        </>}>
        <PositionsTable rows={rv.missing} syncFrom={syncFrom} dest={dest} home={rv.accountId}
          accounts={[{ accountId: rv.accountId, name: rv.name }, ...rv.otherAccounts]} onDest={setDestFor} />
      </Section>

      {rv.unmatched.length > 0 && (
        <Section title={`Logged, but not on Bybit · ${rv.unmatched.length}`} defaultOpen
          lead="Ticked trades are removed. One marked as part of another trade is a second log of the same position, which the other trade now carries in full.">
          {rv.unmatched.map(u => (
            <label key={u.tradeId} className="flex items-center gap-2 py-1 text-xs num cursor-pointer">
              <input type="checkbox" checked={remove.has(u.tradeId)}
                onChange={e => setRemove(s => { const x = new Set(s); e.target.checked ? x.add(u.tradeId) : x.delete(u.tradeId); return x })} />
              <span style={{ color: 'var(--c-text-1)' }}>#{u.tradeId} {u.asset} {u.direction} · {u.date} {u.time ?? ''}</span>
              <span>entry {n(u.entryPrice)}, size {n(u.size)}, net {n(u.netPnl)}</span>
              <span style={{ color: 'var(--c-text-3)' }}>
                {u.samePositionAs ? `part of #${u.samePositionAs}` : u.size === 0 ? 'size 0, no matching position' : 'no matching position'}
              </span>
            </label>
          ))}
        </Section>
      )}

      {rv.notOnBybit.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
          {rv.notOnBybit.length} trades from another broker ({[...new Set(rv.notOnBybit.map(t => t.asset))].join(', ')}) are not Bybit's and stay exactly as they are.
        </p>
      )}

      <div className="flex items-center justify-end gap-3 pt-2 border-t" style={{ borderColor: 'var(--c-border)' }}>
        {done && <span className="text-xs" style={{ color: 'var(--c-profit)' }}>Done: {done.updated} trades corrected, {done.created} added.</span>}
        {apply.isError && <span className="text-xs" style={{ color: 'var(--c-loss)' }}>Could not apply: {(apply.error as Error).message}</span>}
        <Button variant="secondary" onClick={onClose}>{done ? 'Close' : 'Not now'}</Button>
        {!done && (
          <Button onClick={() => apply.mutate({ accountId: rv.accountId, syncFrom, deleteTradeIds: [...remove], moves: [...dest].map(([externalId, accountId]) => ({ externalId, accountId })) })} disabled={apply.isPending}>
            {apply.isPending ? 'Applying…' : `Correct ${changed.length}, add ${added.length + moved.length}${remove.size ? `, remove ${remove.size}` : ''}, and keep syncing`}
          </Button>
        )}
      </div>
    </div>
  )
}

function Section({ title, lead, children, defaultOpen }: { title: string; lead: React.ReactNode; children: React.ReactNode; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--c-text-1)' }}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {title}
      </button>
      <div className="text-xs mb-2" style={{ color: 'var(--c-text-3)' }}>{lead}</div>
      {open && <div className="max-h-72 overflow-y-auto pr-1">{children}</div>}
    </div>
  )
}

function PositionsTable({ rows, syncFrom, dest, home, accounts, onDest }: {
  rows: ReviewMissing[]; syncFrom: string; dest: Map<string, number>; home: number
  accounts: { accountId: number; name: string }[]; onDest: (externalId: string, accountId: number) => void
}) {
  if (!rows.length) return <div className="text-xs" style={{ color: 'var(--c-text-3)' }}>Nothing to add.</div>
  return (
    <table className="w-full text-xs num">
      <thead>
        <tr style={{ color: 'var(--c-text-3)' }}>
          {['Opened (UTC)', 'Coin', 'Dir', 'Size', 'Entry', 'Exit', 'Risk', 'Net', 'Goes to'].map(h => <th key={h} className="text-left font-medium py-1 pr-3">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map(p => {
          const to = dest.get(p.externalId) ?? home
          const out = to === home && p.openedAt.slice(0, 10) < syncFrom
          return (
          <tr key={p.externalId} style={{ opacity: out ? 0.45 : 1 }}>
            <td className="py-0.5 pr-3">{utc(p.openedAt)}</td>
            <td className="pr-3" style={{ color: 'var(--c-text-1)' }}>{p.symbol}</td>
            <td className="pr-3">{p.direction}</td>
            <td className="pr-3">{n(p.size)}</td>
            <td className="pr-3">{n(p.avgEntry)}</td>
            <td className="pr-3">{p.closedAt ? n(p.avgExit) : 'open'}</td>
            <td className="pr-3">{p.risk != null ? formatCurrency(p.risk) : '—'}</td>
            <td className="pr-3" style={{ color: (p.net ?? 0) >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>{p.net != null ? formatCurrency(p.net) : '—'}</td>
            <td>
              <select value={to} onChange={e => onDest(p.externalId, Number(e.target.value))}
                className="px-1 py-0.5 rounded text-xs" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: to !== home ? 'var(--c-accent)' : 'var(--c-text-2)' }}>
                {accounts.map(a => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
              </select>
              {out && <span className="ml-1" style={{ color: 'var(--c-text-3)' }}>before sync date</span>}
            </td>
          </tr>
          )
        })}
      </tbody>
    </table>
  )
}
