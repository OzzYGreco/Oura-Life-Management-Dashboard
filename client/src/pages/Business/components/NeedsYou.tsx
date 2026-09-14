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
}

const TONE: Record<NeedAction, 'good' | 'accent' | 'default'> = {
  paid: 'good', send: 'accent', invoice: 'accent', setup: 'accent', assign: 'default',
}

/**
 * One ranked list of everything waiting on a decision.
 *
 * The version of this idea that got rejected was an entire screen. It works as
 * one section of a page that also tells you where you stand: the list answers
 * "what now", the numbers above it answer "how are we doing".
 *
 * Every button is visible at rest. The page this replaces hid mark-paid behind
 * `opacity-0 group-hover:opacity-100`, so it did not exist on a touchscreen and
 * could not be reached from the keyboard.
 */
export function NeedsYou({
  rows, fmtView, onAct, busyKey,
}: {
  rows: NeedRow[]
  fmtView: FmtView
  onAct: (row: NeedRow) => void
  busyKey?: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? rows : rows.slice(0, 6)

  return (
    <Section
      label="Needs you"
      count={rows.length || undefined}
      action={rows.length > 6 && (
        <MiniBtn onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Show less' : `Show all ${rows.length}`}
        </MiniBtn>
      )}
    >
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs" style={{ color: 'var(--c-text-3)' }}>
            Nothing needs you right now. Every invoice is paid and every job is billed.
          </p>
        ) : shown.map((r, i) => {
          const late = !!r.detail && /overdue|past due/.test(r.detail)
          return (
            <div
              key={r.key}
              className="flex items-center gap-4 px-4 py-2.5 flex-wrap"
              style={{ borderTop: i ? '1px solid rgba(255,255,255,0.045)' : 'none' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.028)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span className="w-48 shrink-0 text-[13px] font-medium truncate" style={{ color: 'var(--c-text-1)' }}>
                {r.clientName}
              </span>
              <span className="flex-1 min-w-[140px] text-xs truncate" style={{ color: 'var(--c-text-2)' }}>
                {r.what}
              </span>
              <span className="w-24 shrink-0 text-right text-[13px] font-semibold num" style={{ color: 'var(--c-text-1)' }}>
                {fmtView(r.amount)}
              </span>
              <span className="w-28 shrink-0 text-right text-[11px] num truncate"
                style={{ color: late ? 'var(--c-loss)' : 'var(--c-text-3)' }}>
                {r.detail ?? ''}
              </span>
              <span className="w-24 shrink-0 flex justify-end">
                <MiniBtn tone={TONE[r.action]} onClick={() => onAct(r)} disabled={busyKey === r.key}>
                  {busyKey === r.key ? '...' : LABEL[r.action]}
                </MiniBtn>
              </span>
            </div>
          )
        })}
      </div>
    </Section>
  )
}
