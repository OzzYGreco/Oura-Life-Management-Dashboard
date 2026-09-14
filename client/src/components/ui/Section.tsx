import type { ReactNode } from 'react'

/**
 * A labelled section: tiny uppercase eyebrow, a hairline that fills the rest of
 * the row, and an optional action slot on the right.
 *
 * This is the device that lets a dense page stay readable, because it says
 * plainly where one question ends and the next begins. It lived privately
 * inside Trading Analytics, which is why no other page looked like it.
 */
export function Section({
  label, count, action, children,
}: {
  label: string
  /** Shown next to the label, for "9 things need you" style counts. */
  count?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: 'var(--c-text-3)' }}>
          {label}
        </span>
        {count != null && (
          <span className="text-[11px] num" style={{ color: 'var(--c-text-3)' }}>{count}</span>
        )}
        <div className="flex-1 h-px" style={{ background: 'var(--c-border)' }} />
        {action && <div className="flex items-center gap-2 flex-wrap">{action}</div>}
      </div>
      {children}
    </div>
  )
}
