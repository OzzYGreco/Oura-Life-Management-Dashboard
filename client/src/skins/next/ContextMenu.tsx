/**
 * A right-click menu in the macOS manner: opens at the pointer, stays on
 * screen, shows each action's shortcut on the right, has submenus, and works
 * from the keyboard (arrows, Return, Esc). Closes on any outside click,
 * scroll or resize.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type MenuItem =
  | { sep: true }
  | { sep?: false; label: string; keys?: string; run?: () => void; danger?: boolean; disabled?: boolean; checked?: boolean; sub?: MenuItem[] }

export type MenuAt = { x: number; y: number; items: MenuItem[] } | null

type Real = Exclude<MenuItem, { sep: true }>
const isReal = (i: MenuItem): i is Real => !i.sep

function Panel({ x, y, items, onClose, autoFocus, onBack }: { x: number; y: number; items: MenuItem[]; onClose: () => void; autoFocus: boolean; onBack?: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [hi, setHi] = useState<number>(autoFocus ? -1 : -1)
  const [open, setOpen] = useState<{ i: number; x: number; y: number } | null>(null)

  // Keep the panel on screen: flip left or up when it would spill over.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = x + r.width > window.innerWidth - 8 ? Math.max(8, x - r.width) : x
    const top = y + r.height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - 8 - r.height) : y
    setPos({ left, top })
    if (autoFocus) el.focus()
  }, [x, y, autoFocus])

  const real = items.map((it, i) => (isReal(it) && !it.disabled ? i : -1)).filter(i => i >= 0)
  const openSub = (i: number) => {
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)
    const r = el?.getBoundingClientRect()
    if (r) setOpen({ i, x: r.right - 4, y: r.top - 6 })
  }
  const choose = (i: number) => {
    const it = items[i]
    if (!isReal(it) || it.disabled) return
    if (it.sub) { openSub(i); return }
    onClose(); it.run?.()
  }
  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    const at = real.indexOf(hi)
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(real[(at + 1) % real.length]) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(real[(at - 1 + real.length) % real.length]) }
    else if (e.key === 'ArrowRight' && hi >= 0 && isReal(items[hi]) && (items[hi] as Real).sub) { e.preventDefault(); openSub(hi) }
    else if (e.key === 'ArrowLeft' && onBack) { e.preventDefault(); onBack() }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (hi >= 0) choose(hi) }
    else if (e.key === 'Escape') { e.preventDefault(); if (onBack) onBack(); else onClose() }
  }

  return (
    <>
      <div ref={box} className="nx-ctx" role="menu" tabIndex={-1} style={pos} onKeyDown={onKey} onContextMenu={e => e.preventDefault()}>
        {items.map((it, i) => !isReal(it)
          ? <div key={i} className="sep" role="separator" />
          : (
            <button key={i} data-i={i} role="menuitem" disabled={it.disabled} aria-haspopup={it.sub ? 'menu' : undefined}
              className={`${it.danger ? 'bad' : ''} ${hi === i ? 'hi' : ''}`}
              onMouseEnter={() => { setHi(i); if (it.sub) openSub(i); else setOpen(null) }}
              onClick={() => choose(i)}>
              <span className="ck">{it.checked ? '✓' : ''}</span>
              <span className="lb">{it.label}</span>
              {it.sub ? <span className="ar" aria-hidden>›</span> : it.keys ? <kbd>{it.keys}</kbd> : null}
            </button>
          ))}
      </div>
      {open && isReal(items[open.i]) && (items[open.i] as Real).sub && (
        <Panel x={open.x} y={open.y} items={(items[open.i] as Real).sub!} onClose={onClose} autoFocus
          onBack={() => { setOpen(null); box.current?.focus() }} />
      )}
    </>
  )
}

export function ContextMenu({ at, onClose }: { at: MenuAt; onClose: () => void }) {
  useEffect(() => {
    if (!at) return
    const out = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.nx-ctx')) onClose() }
    const gone = () => onClose()
    document.addEventListener('mousedown', out)
    window.addEventListener('resize', gone)
    window.addEventListener('blur', gone)
    document.addEventListener('scroll', gone, true)
    return () => {
      document.removeEventListener('mousedown', out)
      window.removeEventListener('resize', gone)
      window.removeEventListener('blur', gone)
      document.removeEventListener('scroll', gone, true)
    }
  }, [at, onClose])
  if (!at) return null
  return createPortal(<div className="wh nx-ctx-layer"><Panel x={at.x} y={at.y} items={at.items} onClose={onClose} autoFocus /></div>, document.body)
}
