import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useClients, useLedger } from '../../../hooks/useBusiness'
import { StatusDot } from './primitives'
import type { Client } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

type Hit =
  | { kind: 'client'; id: number; title: string; sub: string }
  | { kind: 'invoice'; id: number; title: string; sub: string; status: string; amount: number }

/**
 * One box for finding anything on the Business tab: a client by name, company
 * or email, an invoice by number, or an invoice by amount ("149.99").
 *
 * ⌘K (or Ctrl+K) jumps to it from anywhere on the tab. Enter opens the top
 * result, arrows move through the rest.
 */
export function BusinessSearch({
  fmtView, onOpenClient, onOpenInvoice,
}: {
  fmtView: FmtView
  onOpenClient: (id: number) => void
  onOpenInvoice: (id: number) => void
}) {
  const { data: clients = [] } = useClients()
  const { data: ledger } = useLedger({})
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
        setOpen(true)
      }
    }
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [])

  const hits = useMemo<Hit[]>(() => {
    const term = q.trim().toLowerCase()
    if (!term) return []
    const amount = Number(term.replace(/[£,\s]/g, ''))
    const isAmount = Number.isFinite(amount) && /^[£\d.,\s]+$/.test(term)

    const clientHits: Hit[] = (clients as Client[])
      .filter(c => [c.name, c.company, c.email].some(v => v?.toLowerCase().includes(term)))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(term)) - Number(a.name.toLowerCase().startsWith(term)))
      .slice(0, 5)
      .map(c => ({
        kind: 'client' as const, id: c.id, title: c.name,
        sub: [c.company, c.status === 'churned' ? 'left' : c.status !== 'active' ? c.status : null].filter(Boolean).join(' · '),
      }))

    const invoiceHits: Hit[] = (ledger?.rows ?? [])
      .filter(r => r.invoiceNumber.toLowerCase().includes(term)
        || (isAmount && Math.abs(r.gross - amount) < 0.005))
      .slice(0, 6)
      .map(r => ({
        kind: 'invoice' as const, id: r.id, title: `${r.invoiceNumber} · ${r.clientName}`,
        sub: `${r.what} · ${r.issueDate}`, status: r.status, amount: r.gross,
      }))

    return isAmount || /^inv/i.test(term) ? [...invoiceHits, ...clientHits] : [...clientHits, ...invoiceHits]
  }, [q, clients, ledger])

  const go = (h: Hit) => {
    if (h.kind === 'client') onOpenClient(h.id)
    else onOpenInvoice(h.id)
    setQ('')
    setOpen(false)
    input.current?.blur()
  }

  return (
    <div className="relative" ref={box}>
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--c-text-3)' }} />
      <input
        ref={input}
        id="business-search"
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); setCursor(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, hits.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
          else if (e.key === 'Enter' && hits[cursor]) go(hits[cursor])
          else if (e.key === 'Escape') { setOpen(false); input.current?.blur() }
        }}
        placeholder="Find a client, INV-086 or £149"
        className="pl-8 pr-10 py-2 rounded-lg text-xs w-64 outline-none"
        style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }}
      />
      <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[9.5px] px-1 rounded pointer-events-none"
        style={{ color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}>⌘K</kbd>

      {open && q.trim() && (
        <div className="absolute right-0 mt-1.5 w-96 rounded-xl overflow-hidden z-50"
          style={{ background: 'var(--c-bg-elevated)', border: '1px solid var(--c-border-mid)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
          {hits.length === 0 ? (
            <p className="px-3.5 py-3 text-[11px]" style={{ color: 'var(--c-text-3)' }}>Nothing matches “{q}”.</p>
          ) : hits.map((h, i) => (
            <button
              key={`${h.kind}-${h.id}`}
              type="button"
              onMouseDown={e => { e.preventDefault(); go(h) }}
              onMouseEnter={() => setCursor(i)}
              className="w-full text-left px-3.5 py-2 flex items-center gap-3"
              style={{ background: i === cursor ? 'var(--c-bg-hover)' : 'transparent', borderTop: i ? '1px solid var(--c-border)' : 'none' }}
            >
              <span className="text-[9.5px] font-bold uppercase tracking-wider w-12 shrink-0" style={{ color: 'var(--c-text-3)' }}>
                {h.kind === 'client' ? 'Client' : 'Invoice'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold truncate" style={{ color: 'var(--c-text-1)' }}>{h.title}</span>
                {h.sub && <span className="block text-[10.5px] truncate" style={{ color: 'var(--c-text-3)' }}>{h.sub}</span>}
              </span>
              {h.kind === 'invoice' && (
                <span className="text-right shrink-0">
                  <span className="block text-xs num font-semibold" style={{ color: 'var(--c-text-1)' }}>{fmtView(h.amount)}</span>
                  <StatusDot status={h.status} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
