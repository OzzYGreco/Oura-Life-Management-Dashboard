/**
 * Skin plumbing shared by every skin: which skin is active, the navigation
 * list, the ⌘K palette and the evening review. Skins import from here and
 * supply only their own Shell and pages.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { MISS_REASONS, useCloseDay, useToday } from '../core/today'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'

export type SkinId = 'linear' | 'whoop' | 'revolut' | 'things' | 'next'

export const SKINS: { id: SkinId; label: string; hint: string }[] = [
  { id: 'next',    label: 'Arete',   hint: 'The new layout, every page redesigned' },
  { id: 'whoop',   label: 'Whoop',   hint: 'Score dial, coaching voice' },
  { id: 'linear',  label: 'Linear',  hint: 'Dark, precise, keyboard-first' },
  { id: 'revolut', label: 'Revolut', hint: 'Your day as a chart, momentum' },
  { id: 'things',  label: 'Things',  hint: 'Light, calm, tactile' },
]

export const NAV = [
  { to: '/',          label: 'Today',    key: 'today' },
  { to: '/goals',     label: 'Week',     key: 'week' },
  { to: '/checklists', label: 'Routine', key: 'routine' },
  { to: '/trading',   label: 'Trading',  key: 'trading' },
  { to: '/business',  label: 'Business', key: 'business' },
  { to: '/training',  label: 'Training', key: 'training' },
  { to: '/finances',  label: 'Money',    key: 'money' },
  { to: '/calendar',  label: 'Calendar', key: 'calendar' },
  { to: '/notes',     label: 'Notes',    key: 'notes' },
] as const

export type NavItem = (typeof NAV)[number]
export type NavKey = NavItem['key']
export type NavLayout = 'vertical' | 'horizontal'
export type NavLayoutPref = NavLayout | 'auto'

/** Each skin's own navigation, used when the owner picks "Skin default". */
export const NATIVE_LAYOUT: Record<SkinId, NavLayout> = {
  whoop: 'horizontal', revolut: 'horizontal', linear: 'vertical', things: 'vertical', next: 'horizontal',
}

const parseKeys = (v?: string) => (v ?? '').split(',').map(x => x.trim()).filter(Boolean)

/** The owner's tab order with any tabs added later appended, minus hidden ones. Today is always shown. */
export function orderedNav(order: string[], hidden: string[]) {
  const known = new Set<string>(NAV.map(n => n.key))
  const keys = [...order.filter(k => known.has(k)), ...NAV.map(n => n.key).filter(k => !order.includes(k))]
  const all = keys.map(k => NAV.find(n => n.key === k)!)
  return { all, visible: all.filter(n => n.key === 'today' || !hidden.includes(n.key)) }
}

type AppSettings = { skin: string; navLayout?: string; navOrder?: string; navHidden?: string }

// ─── Active skin ─────────────────────────────────────────────────────────────

const CACHE = 'oura-skin'
interface SkinCtx {
  skin: SkinId
  setSkin: (s: SkinId) => void
  openPalette: () => void
  /** Visible tabs in the owner's order. */
  nav: NavItem[]
  /** The orientation to render, already resolved from "auto". */
  navLayout: NavLayout
  navLayoutPref: NavLayoutPref
  openCustomize: () => void
}
const Ctx = createContext<SkinCtx>({
  skin: 'next', setSkin: () => {}, openPalette: () => {},
  nav: [...NAV], navLayout: 'horizontal', navLayoutPref: 'auto', openCustomize: () => {},
})
export const useSkin = () => useContext(Ctx)

const readCache = (): SkinId => {
  const preview = new URLSearchParams(window.location.search).get('skin')
  if (SKINS.some(s => s.id === preview)) return preview as SkinId
  try { const v = localStorage.getItem(CACHE); if (SKINS.some(s => s.id === v)) return v as SkinId } catch { /* ignore */ }
  return 'next'
}

export function SkinProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient()
  const [skin, setLocal] = useState<SkinId>(readCache)
  const [palette, setPalette] = useState(false)
  const [customize, setCustomize] = useState(() => new URLSearchParams(window.location.search).get('customize') === '1')

  // The server holds the choice so it follows you across browsers.
  const settings = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => api.get<AppSettings>('/api/today/settings').then(r => r.data),
  })
  const previewing = SKINS.some(s => s.id === new URLSearchParams(window.location.search).get('skin'))
  useEffect(() => {
    const s = settings.data?.skin
    if (previewing) return          // ?skin=x previews a skin without changing the saved one
    if (s && SKINS.some(x => x.id === s) && s !== skin) setLocal(s as SkinId)
  }, [settings.data?.skin]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (s: SkinId) => api.put('/api/today/settings', { skin: s }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-settings'] }),
  })
  const setSkin = useCallback((s: SkinId) => {
    setLocal(s)
    try { localStorage.setItem(CACHE, s) } catch { /* ignore */ }
    save.mutate(s)
  }, [save])

  useEffect(() => {
    document.documentElement.dataset.skin = skin
    document.documentElement.classList.toggle('light', skin === 'things')
    if (!previewing) try { localStorage.setItem(CACHE, skin) } catch { /* ignore */ }
  }, [skin, previewing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navLayoutPref = (['vertical', 'horizontal'].includes(settings.data?.navLayout ?? '') ? settings.data!.navLayout : 'auto') as NavLayoutPref
  const navLayout: NavLayout = navLayoutPref === 'auto' ? NATIVE_LAYOUT[skin] : navLayoutPref
  const { visible } = orderedNav(parseKeys(settings.data?.navOrder), parseKeys(settings.data?.navHidden))

  const value = useMemo(() => ({
    skin, setSkin, openPalette: () => setPalette(true),
    nav: visible, navLayout, navLayoutPref, openCustomize: () => setCustomize(true),
  }), [skin, setSkin, visible.map(v => v.key).join(), navLayout, navLayoutPref]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Ctx.Provider value={value}>
      {children}
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      {customize && settings.data && <CustomizeTabs settings={settings.data} onClose={() => setCustomize(false)} />}
      <ReviewSheet />
    </Ctx.Provider>
  )
}

// ─── ⌘K palette ──────────────────────────────────────────────────────────────

function CommandPalette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate()
  const { skin, setSkin, openCustomize } = useSkin()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [, setParams] = useSearchParams()

  const items = useMemo(() => {
    const all = [
      ...NAV.map(n => ({ id: `go:${n.to}`, label: `Go to ${n.label}`, run: () => nav(n.to) })),
      ...SKINS.map(s => ({ id: `skin:${s.id}`, label: `Skin: ${s.label}${s.id === skin ? '  (current)' : ''}`, run: () => setSkin(s.id) })),
      { id: 'review', label: 'Close the day (evening review)', run: () => setParams(p => { p.set('review', '1'); return p }) },
      { id: 'tabs', label: 'Customize tabs: order, hide, sidebar or top', run: openCustomize },
    ]
    const t = q.trim().toLowerCase()
    return t ? all.filter(i => i.label.toLowerCase().includes(t)) : all
  }, [q, nav, skin, setSkin, setParams, openCustomize])

  useEffect(() => setSel(0), [q])

  const run = (i: number) => { const it = items[i]; if (it) { it.run(); onClose() } }

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-start justify-center pt-[14vh]" onMouseDown={onClose}
      style={{ background: 'rgba(0,0,0,.35)' }}>
      <div className="w-[560px] rounded-[14px] overflow-hidden skin-enter" onMouseDown={e => e.stopPropagation()}
        style={{ background: 'var(--c-bg-elevated)', boxShadow: 'var(--c-shadow-modal)' }} role="dialog" aria-label="Command menu">
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Jump to a page or switch skin…"
          onKeyDown={e => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(items.length - 1, s + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
            if (e.key === 'Enter') run(sel)
          }}
          className="w-full h-[52px] px-5 bg-transparent outline-none text-[15px]"
          style={{ color: 'var(--c-text-1)', borderBottom: '1px solid var(--c-border)' }} />
        <ul className="max-h-[360px] overflow-y-auto p-1.5" role="listbox">
          {items.map((it, i) => (
            <li key={it.id} role="option" aria-selected={i === sel}
              onMouseEnter={() => setSel(i)} onClick={() => run(i)}
              className="px-3.5 h-9 flex items-center rounded-[8px] text-[13.5px] cursor-pointer"
              style={{ background: i === sel ? 'var(--c-bg-selected)' : undefined, color: 'var(--c-text-1)' }}>
              {it.label}
            </li>
          ))}
          {!items.length && <li className="px-3.5 py-3 text-[13px]" style={{ color: 'var(--c-text-3)' }}>Nothing matches.</li>}
        </ul>
      </div>
    </div>,
    document.body,
  )
}

// ─── Evening review (?review=1) ──────────────────────────────────────────────

function ReviewSheet() {
  const [params, setParams] = useSearchParams()
  const open = params.get('review') === '1'
  const { data } = useToday()
  const close = useCloseDay()
  const [reasons, setReasons] = useState<Record<number, string>>({})
  const [line, setLine] = useState('')
  const box = useRef<HTMLDivElement>(null)

  const dismiss = () => setParams(p => { p.delete('review'); return p })
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !data) return null
  const d = data.day
  const missed = d.items.filter(i => i.status === 'overdue' || i.status === 'missed' || (i.status === 'anytime'))

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,.45)' }} onMouseDown={dismiss}>
      <div ref={box} className="w-[620px] max-h-[86vh] overflow-y-auto rounded-[18px] p-7 skin-enter" onMouseDown={e => e.stopPropagation()}
        role="dialog" aria-label="Close the day" style={{ background: 'var(--c-bg-elevated)', boxShadow: 'var(--c-shadow-modal)', color: 'var(--c-text-1)' }}>
        {d.closed ? (
          <>
            <p className="text-[13px]" style={{ color: 'var(--c-text-2)' }}>Today is closed.</p>
            <p className="text-[40px] font-semibold num mt-1">{d.score ?? 0}</p>
            <button onClick={dismiss} className="mt-5 h-9 px-4 rounded-[9px] text-[13.5px] font-medium"
              style={{ background: 'var(--c-accent)', color: 'var(--c-on-accent)' }}>Done</button>
          </>
        ) : (
          <>
            <p className="text-[13px]" style={{ color: 'var(--c-text-2)' }}>Close the day</p>
            <div className="flex items-baseline gap-3 mt-1">
              <span className="text-[44px] leading-none font-semibold num">{d.score ?? 0}</span>
              <span className="text-[14px]" style={{ color: 'var(--c-text-2)' }}>
                {d.earned} of {d.possible} points · {d.counts.onTime} on time, {d.counts.late} late, {d.counts.missed} missed
              </span>
            </div>

            {missed.length > 0 && (
              <div className="mt-6">
                <p className="text-[14px] font-medium">Why were these missed?</p>
                <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--c-text-2)' }}>One tap each. The reasons show up in your history, so patterns are easy to spot.</p>
                <ul className="mt-3 space-y-2.5">
                  {missed.map(i => (
                    <li key={i.id} className="flex items-center gap-3">
                      <span className="w-12 text-[12.5px] num" style={{ color: 'var(--c-text-3)' }}>{i.time ?? ''}</span>
                      <span className="flex-1 text-[14px] truncate">{i.label}</span>
                      <div className="flex gap-1">
                        {MISS_REASONS.map(r => {
                          const on = reasons[i.id] === r
                          return (
                            <button key={r} onClick={() => setReasons(x => ({ ...x, [i.id]: r }))}
                              className="h-7 px-2.5 rounded-full text-[12px] transition-colors"
                              style={{ background: on ? 'var(--c-accent)' : 'var(--c-bg-input)', color: on ? 'var(--c-on-accent)' : 'var(--c-text-2)' }}>
                              {r}
                            </button>
                          )
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <label className="block mt-6">
              <span className="text-[14px] font-medium">One line on today</span>
              <input value={line} onChange={e => setLine(e.target.value)} maxLength={200}
                placeholder="What went well, or what you'd change tomorrow"
                className="mt-2 w-full h-11 px-3.5 rounded-[10px] text-[14px] outline-none"
                style={{ background: 'var(--c-bg-input)', color: 'var(--c-text-1)', boxShadow: 'inset 0 0 0 1px var(--c-border)' }} />
            </label>

            <div className="mt-7 flex items-center justify-between">
              <span className="text-[12.5px] pr-4" style={{ color: 'var(--c-text-3)' }}>Closing locks the score. Days left open close themselves at 04:00.</span>
              <div className="flex gap-2 shrink-0">
                <button onClick={dismiss} className="h-9 px-4 rounded-[9px] text-[13.5px] whitespace-nowrap" style={{ color: 'var(--c-text-2)' }}>Not yet</button>
                <button disabled={close.isPending}
                  onClick={() => close.mutate({ reflection: line, reasons }, { onSuccess: dismiss })}
                  className="h-9 px-4 rounded-[9px] text-[13.5px] font-medium whitespace-nowrap"
                  style={{ background: 'var(--c-accent)', color: 'var(--c-on-accent)', opacity: close.isPending ? .6 : 1 }}>
                  Close the day
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Opens the evening review from any skin. */
export function useOpenReview() {
  const [, setParams] = useSearchParams()
  return () => setParams(p => { p.set('review', '1'); return p })
}

// ─── Customize tabs ──────────────────────────────────────────────────────────

const LAYOUTS: { value: NavLayoutPref; label: string }[] = [
  { value: 'auto', label: 'Skin default' },
  { value: 'vertical', label: 'Sidebar' },
  { value: 'horizontal', label: 'Top tabs' },
]

function CustomizeTabs({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const qc = useQueryClient()
  const { skin } = useSkin()
  const initial = orderedNav(parseKeys(settings.navOrder), [])
  const [order, setOrder] = useState<string[]>(initial.all.map(n => n.key))
  const [hidden, setHidden] = useState<string[]>(parseKeys(settings.navHidden))
  const [layout, setLayout] = useState<NavLayoutPref>(
    (['vertical', 'horizontal'].includes(settings.navLayout ?? '') ? settings.navLayout : 'auto') as NavLayoutPref)

  // Changes apply as you make them, so you can see the result behind the panel.
  const save = useMutation({
    mutationFn: (patch: Partial<AppSettings>) => api.put('/api/today/settings', patch),
    onMutate: patch => qc.setQueryData<AppSettings>(['app-settings'], old => (old ? { ...old, ...patch } : old)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['app-settings'] }),
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onDrag = (r: DropResult) => {
    if (!r.destination || r.destination.index === r.source.index) return
    const next = [...order]
    const [moved] = next.splice(r.source.index, 1)
    next.splice(r.destination.index, 0, moved)
    setOrder(next)
    save.mutate({ navOrder: next.join(',') })
  }
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= order.length) return
    const next = [...order]; [next[i], next[j]] = [next[j], next[i]]
    setOrder(next); save.mutate({ navOrder: next.join(',') })
  }
  const toggle = (key: string) => {
    const next = hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key]
    setHidden(next); save.mutate({ navHidden: next.join(',') })
  }
  const pickLayout = (v: NavLayoutPref) => { setLayout(v); save.mutate({ navLayout: v }) }
  const reset = () => {
    const def = NAV.map(n => n.key)
    setOrder(def); setHidden([]); setLayout('auto')
    save.mutate({ navOrder: '', navHidden: '', navLayout: 'auto' })
  }

  const label = (key: string) => NAV.find(n => n.key === key)!.label
  const native = NATIVE_LAYOUT[skin] === 'vertical' ? 'sidebar' : 'top tabs'

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-start justify-center pt-[10vh]" style={{ background: 'rgba(0,0,0,.4)' }} onMouseDown={onClose}>
      <div className="w-[440px] rounded-[16px] p-6 skin-fade" role="dialog" aria-label="Customize tabs" onMouseDown={e => e.stopPropagation()}
        style={{ background: 'var(--c-bg-elevated)', boxShadow: 'var(--c-shadow-modal)', color: 'var(--c-text-1)' }}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-[17px] font-semibold">Customize tabs</h2>
          <button onClick={reset} className="text-[12.5px]" style={{ color: 'var(--c-text-2)' }}>Reset</button>
        </div>

        <p className="mt-5 text-[12.5px] font-medium" style={{ color: 'var(--c-text-2)' }}>Navigation</p>
        <div className="mt-2 grid grid-cols-3 p-[3px] rounded-[10px] gap-[3px]" role="radiogroup" aria-label="Navigation layout"
          style={{ background: 'var(--c-bg-input)', boxShadow: 'inset 0 0 0 1px var(--c-border)' }}>
          {LAYOUTS.map(l => {
            const on = layout === l.value
            return (
              <button key={l.value} role="radio" aria-checked={on} onClick={() => pickLayout(l.value)}
                className="h-8 rounded-[8px] text-[13px] font-medium transition-colors"
                style={{ background: on ? 'var(--c-seg-on)' : 'transparent', boxShadow: on ? 'var(--c-seg-on-shadow)' : 'none', color: on ? 'var(--c-text-1)' : 'var(--c-text-2)' }}>
                {l.label}
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-[12px]" style={{ color: 'var(--c-text-3)' }}>Skin default is {native} for this skin.</p>

        <p className="mt-5 text-[12.5px] font-medium" style={{ color: 'var(--c-text-2)' }}>Order and visibility</p>
        <p className="text-[12px]" style={{ color: 'var(--c-text-3)' }}>Drag to reorder. Hidden tabs stay reachable with ⌘K.</p>
        <DragDropContext onDragEnd={onDrag}>
          <Droppable droppableId="tabs">
            {drop => (
              <ul ref={drop.innerRef} {...drop.droppableProps} className="mt-2.5">
                {order.map((key, i) => {
                  const off = key !== 'today' && hidden.includes(key)
                  return (
                    <Draggable key={key} draggableId={key} index={i}>
                      {(drag, snap) => (
                        <li ref={drag.innerRef} {...drag.draggableProps}
                          className="flex items-center gap-3 h-10 px-2.5 rounded-[10px] mb-1"
                          style={{
                            ...drag.draggableProps.style,
                            background: snap.isDragging ? 'var(--c-bg-selected)' : 'var(--c-bg-input)',
                            boxShadow: snap.isDragging ? 'var(--c-shadow-modal)' : 'none',
                          }}>
                          <span {...drag.dragHandleProps} aria-label={`Drag ${label(key)}`}
                            className="cursor-grab select-none text-[15px] leading-none px-1" style={{ color: 'var(--c-text-3)' }}>⋮⋮</span>
                          <span className="flex-1 text-[14px]" style={{ color: off ? 'var(--c-text-3)' : 'var(--c-text-1)', textDecoration: off ? 'line-through' : 'none' }}>
                            {label(key)}
                          </span>
                          <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${label(key)} up`}
                            className="w-7 h-7 rounded-[7px] text-[12px] disabled:opacity-30" style={{ color: 'var(--c-text-2)' }}>↑</button>
                          <button onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move ${label(key)} down`}
                            className="w-7 h-7 rounded-[7px] text-[12px] disabled:opacity-30" style={{ color: 'var(--c-text-2)' }}>↓</button>
                          {key === 'today'
                            ? <span className="w-[52px] text-right text-[12px]" style={{ color: 'var(--c-text-3)' }}>Home</span>
                            : <button onClick={() => toggle(key)} role="switch" aria-checked={!off} aria-label={`Show ${label(key)}`}
                                className="w-[52px] h-7 rounded-[7px] text-[12px] font-medium"
                                style={{ background: off ? 'transparent' : 'var(--c-bg-selected)', color: off ? 'var(--c-text-3)' : 'var(--c-text-1)', boxShadow: 'inset 0 0 0 1px var(--c-border)' }}>
                                {off ? 'Show' : 'Hide'}
                              </button>}
                        </li>
                      )}
                    </Draggable>
                  )
                })}
                {drop.placeholder}
              </ul>
            )}
          </Droppable>
        </DragDropContext>

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="h-9 px-4 rounded-[9px] text-[13.5px] font-medium"
            style={{ background: 'var(--c-accent)', color: 'var(--c-on-accent)' }}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
