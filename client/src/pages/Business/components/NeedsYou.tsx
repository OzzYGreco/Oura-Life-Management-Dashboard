import { useState } from 'react'
import { Section } from '../../../components/ui/Section'
import { MiniBtn } from './primitives'
import type { NeedRow, NeedAction } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

const LABEL: Record<NeedAction, string> = {
  paid:    'Mark paid',
  send:    'Send',
  invoice: 'Invoice',
  setup:   'Set up',
  assign:  'Assign',
  void:    'Void',
  open:    'Open',
  repay:   'Paid back',
}

const TONE: Record<NeedAction, 'good' | 'accent' | 'default' | 'danger'> = {
  paid: 'good', send: 'accent', invoice: 'accent', setup: 'accent', assign: 'default', void: 'danger',
  open: 'accent', repay: 'good',
}

/** What the secondary button says, by kind of row: it does the real thing. */
const DISMISS: Record<NeedAction, string> = {
  paid:    'Write off',
  send:    'Not needed',
  invoice: 'Not needed',
  setup:   'Not needed',
  assign:  'Overhead',
  void:    '',
  open:    '',
  repay:   '',
}

/** The other answers to money owed, besides "it is paid" and "write it off". */
export type DismissHow = 'writeoff' | 'hold' | 'settle'

const GROUPS = [
  { key: 'chase', title: 'Chase', hint: 'money owed to you' },
  { key: 'send',  title: 'Send',  hint: 'invoices not sent yet' },
  { key: 'fix',   title: 'Fix',   hint: 'set up or tidy' },
] as const

/**
 * Everything waiting on a decision, in three groups: money to chase, invoices
 * to send, and things to set up or tidy.
 *
 * Every row has two answers, because "do it" is not the only one. Mark paid or
 * Write off. Send or Not needed. Invoice or Not needed. The second button does
 * the real thing (voids the draft, cancels the website) rather than hiding the
 * row, so it does not come back next week.
 */
export function NeedsYou({
  rows, fmtView, onAct, onDismiss, busyKey,
}: {
  rows: NeedRow[]
  fmtView: FmtView
  onAct: (row: NeedRow) => void
  onDismiss: (row: NeedRow, how?: DismissHow) => void
  busyKey?: string | null
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<string | null>(null)
  const LIMIT = 5

  return (
    <Section label="Needs you" count={rows.length || undefined}>
      {rows.length === 0 ? (
        <div className="rounded-xl px-4 py-8 text-center text-xs"
          style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}>
          Nothing needs you right now. Every invoice is paid and every job is billed.
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' }}>
          {GROUPS.map(g => {
            const list = rows.filter(r => (r.group ?? 'fix') === g.key)
            const shown = open[g.key] ? list : list.slice(0, LIMIT)
            const total = list.reduce((s, r) => s + r.amount, 0)
            return (
              <div key={g.key} className="rounded-xl overflow-hidden flex flex-col"
                style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
                <div className="flex items-baseline justify-between gap-3 px-4 py-2.5"
                  style={{ borderBottom: '1px solid var(--c-border)' }}>
                  <span className="flex items-baseline gap-2">
                    <span className="text-xs font-bold" style={{ color: 'var(--c-text-1)' }}>{g.title}</span>
                    <span className="text-[10.5px]" style={{ color: 'var(--c-text-3)' }}>{g.hint}</span>
                  </span>
                  <span className="text-[11px] num" style={{ color: list.length ? 'var(--c-text-2)' : 'var(--c-text-3)' }}>
                    {list.length ? `${list.length} · ${fmtView(total)}` : 'nothing'}
                  </span>
                </div>
                {list.length === 0 ? (
                  <p className="px-4 py-5 text-[11px] text-center" style={{ color: 'var(--c-text-3)' }}>All clear.</p>
                ) : shown.map((r, i) => {
                  const late = !!r.detail && /overdue|past due/.test(r.detail)
                  return (
                    <div key={r.key} className="flex items-center gap-3 px-4 py-2"
                      style={{ borderTop: i ? '1px solid rgba(255,255,255,0.045)' : 'none' }}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-medium truncate" style={{ color: 'var(--c-text-1)' }}>
                          {r.clientName}
                        </span>
                        <span className="block text-[10.5px] truncate" style={{ color: late ? 'var(--c-loss)' : 'var(--c-text-3)' }}>
                          {r.what}{r.detail ? ` · ${r.detail}` : ''}
                        </span>
                      </span>
                      <span className="text-[12.5px] font-semibold num shrink-0" style={{ color: 'var(--c-text-1)' }}>
                        {fmtView(r.amount)}
                      </span>
                      <span className="flex gap-1 shrink-0">
                        <MiniBtn tone={TONE[r.action]} onClick={() => onAct(r)} disabled={busyKey === r.key}>
                          {busyKey === r.key ? '...' : LABEL[r.action]}
                        </MiniBtn>
                        {r.action === 'paid' ? (
                          <span className="relative">
                            <MiniBtn tone="warn" onClick={() => setMenu(m => (m === r.key ? null : r.key))} disabled={busyKey === r.key}
                              title="Not paid yet: wait, accept less, or write it off">Not yet</MiniBtn>
                            {menu === r.key && (
                              <span className="absolute right-0 top-full mt-1 z-20 w-56 rounded-lg py-1 shadow-xl"
                                style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border-mid)' }}
                                onMouseLeave={() => setMenu(null)}>
                                {([
                                  { how: 'hold', label: 'Wait two weeks', hint: 'agreed to wait, or disputing it' },
                                  ...(r.partPaid ? [{ how: 'settle', label: 'Accept what they paid', hint: 'the rest was a discount' }] : []),
                                  { how: 'writeoff', label: 'Write it off', hint: 'they will not pay' },
                                ] as { how: DismissHow; label: string; hint: string }[]).map(o => (
                                  <button key={o.how} type="button" onClick={() => { setMenu(null); onDismiss(r, o.how) }}
                                    className="block w-full text-left px-3 py-1.5 hover:bg-white/5">
                                    <span className="block text-[12px]" style={{ color: o.how === 'writeoff' ? 'var(--c-loss)' : 'var(--c-text-1)' }}>{o.label}</span>
                                    <span className="block text-[10.5px]" style={{ color: 'var(--c-text-3)' }}>{o.hint}</span>
                                  </button>
                                ))}
                              </span>
                            )}
                          </span>
                        ) : DISMISS[r.action] && (
                          <MiniBtn onClick={() => onDismiss(r)} disabled={busyKey === r.key}
                            // Voiding a draft or cancelling a website is a removal; the rest only hide a reminder.
                            tone={r.action === 'send' || r.action === 'invoice' ? 'danger' : 'default'}
                            title={r.action === 'send' ? 'Void this draft' : r.action === 'invoice' ? 'Cancel this website' : 'This does not need doing'}>
                            {DISMISS[r.action]}
                          </MiniBtn>
                        )}
                      </span>
                    </div>
                  )
                })}
                {list.length > LIMIT && (
                  <div className="px-4 py-2 mt-auto" style={{ borderTop: '1px solid var(--c-border)' }}>
                    <MiniBtn onClick={() => setOpen(o => ({ ...o, [g.key]: !o[g.key] }))}>
                      {open[g.key] ? 'Show fewer' : `Show all ${list.length}`}
                    </MiniBtn>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}
