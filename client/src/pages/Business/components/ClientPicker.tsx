import { useEffect, useMemo, useRef, useState } from 'react'
import type { Client } from '../lib/types'

/**
 * Pick one client out of the whole book by typing.
 *
 * This replaces a wrapped row of every client as a button, which reflowed into
 * an unreadable block at 22 clients and got worse with each one won. Finding a
 * name in it meant scanning a shape that changed every time the list did.
 *
 * A vertical list holds its order, so the eye goes down one column instead of
 * hunting a grid, and typing three letters ends the search outright. The names
 * a payment already points at are floated to the top, because when Stripe hands
 * over "E Harding" the answer is usually one keystroke away rather than a
 * search at all.
 *
 * Fully keyboard driven: the field takes focus on open, up and down move the
 * highlight, Enter takes it, Escape closes. The mouse never has to be involved.
 */
export function ClientPicker({
  clients, value, onPick, hint, autoFocus = true,
}: {
  clients: Client[]
  value: number | null
  onPick: (clientId: number) => void
  /** The payer name or email off the payment, used to rank the likely answers first. */
  hint?: string | null
  autoFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (autoFocus) inputRef.current?.focus() }, [autoFocus])

  /** Words worth matching on: drop initials and noise so "E Harding" keys off "harding". */
  const hintWords = useMemo(() => {
    if (!hint) return []
    return hint.toLowerCase()
      .replace(/@.*$/, ' ')          // an email's domain says nothing about who they are
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2)
  }, [hint])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()

    const scored = clients.map(c => {
      const name = c.name.toLowerCase()
      const company = (c.company ?? '').toLowerCase()
      const email = (c.email ?? '').toLowerCase()
      const hay = `${name} ${company} ${email}`

      if (needle && !hay.includes(needle)) return null

      // Rank: what the user typed beats what the payment suggested, and a match
      // at the start of a name beats one buried in the middle of an email.
      let score = 0
      if (needle) {
        if (name.startsWith(needle) || company.startsWith(needle)) score += 100
        else if (name.includes(needle) || company.includes(needle)) score += 60
        else score += 20
      }
      for (const w of hintWords) {
        if (name === w || company === w) score += 50
        else if (name.includes(w) || company.includes(w) || email.includes(w)) score += 30
      }
      if (c.status !== 'active') score -= 10
      return { c, score }
    }).filter((r): r is { c: Client; score: number } => r !== null)

    scored.sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
    return scored.map(r => r.c)
  }, [clients, q, hintWords])

  // A filtered list can be shorter than where the highlight was sitting.
  useEffect(() => { setCursor(0) }, [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor, rows.length])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, rows.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const c = rows[cursor]; if (c) onPick(c.id) }
  }

  return (
    <div>
      <input
        ref={inputRef}
        value={q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={`Type a name or company to search ${clients.length} clients`}
        className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
        style={{
          background: 'var(--c-bg-input)',
          border: '1px solid var(--c-border)',
          color: 'var(--c-text-1)',
        }}
        onFocus={e => (e.currentTarget.style.borderColor = 'var(--c-accent)')}
        onBlur={e => (e.currentTarget.style.borderColor = 'var(--c-border)')}
      />

      <div ref={listRef} className="mt-1.5 rounded-lg max-h-48 overflow-y-auto"
        style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px]" style={{ color: 'var(--c-text-3)' }}>
            No client matches "{q}". Check the spelling, or close this and add them first.
          </p>
        ) : rows.map((c, i) => {
          const active = i === cursor
          const chosen = c.id === value
          return (
            <button
              key={c.id}
              type="button"
              data-active={active}
              onMouseEnter={() => setCursor(i)}
              onClick={() => onPick(c.id)}
              className="w-full flex items-baseline gap-2.5 px-3 py-1.5 text-left"
              style={{
                background: chosen ? 'rgba(129,140,248,0.16)'
                  : active ? 'rgba(255,255,255,0.045)' : 'transparent',
              }}
            >
              <span className="text-xs font-medium shrink-0"
                style={{ color: chosen ? 'var(--c-accent)' : 'var(--c-text-1)' }}>
                {c.name}
              </span>
              <span className="text-[11px] truncate flex-1" style={{ color: 'var(--c-text-3)' }}>
                {c.company ?? ''}
              </span>
              {c.status !== 'active' && (
                <span className="text-[10px] shrink-0" style={{ color: 'var(--c-text-3)' }}>{c.status}</span>
              )}
            </button>
          )
        })}
      </div>

      <p className="text-[10px] mt-1" style={{ color: 'var(--c-text-3)' }}>
        {rows.length} of {clients.length} shown. Up and down to move, Enter to choose.
      </p>
    </div>
  )
}
