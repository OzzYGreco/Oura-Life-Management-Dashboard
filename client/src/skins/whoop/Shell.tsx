import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Briefcase, CalendarDays, CandlestickChart, ChevronsLeft, ChevronsRight, Dumbbell, Moon, ListChecks, NotebookPen, Sun, SunMedium, Target, Wallet, type LucideIcon } from 'lucide-react'
import { api } from '../../lib/api'
import { SKINS, useSkin, type NavLayout } from '../core'
import { useAvatar, useAvatarActions } from '../../core/profile'
import { startMoneyMask, usePrivacy } from '../../core/privacy'
import { useMode, type ModePref } from '../../core/mode'
import './whoop.css'
import { AreteBrand, AreteMark } from '../../brand/AreteMark'

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t) }, [])
  return now
}

/** ?nav=vertical|horizontal previews an orientation without saving it. Read once, so it survives in-app navigation. */
function usePreviewLayout(): NavLayout | null {
  const [v] = useState<NavLayout | null>(() => {
    const q = new URLSearchParams(window.location.search).get('nav')
    return q === 'vertical' || q === 'horizontal' ? q : null
  })
  return v
}

const EyeIcon = ({ off }: { off: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>
    {off && <path d="M2.5 13.5l11-11"/>}
  </svg>
)

const typingIn = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** H hides money amounts on every page; the eye in the top bar does the same and shows the state. */
function usePrivacyEverywhere() {
  const privacy = usePrivacy()
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'h' || typingIn(e.target) || document.querySelector('[role="dialog"]')) return
      e.preventDefault(); privacy.toggle()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [privacy])
  useEffect(() => (privacy.hidden ? startMoneyMask() : undefined), [privacy.hidden])
  return privacy
}

type NavEntry = { to: string; label: string; key: string }

/** One icon per section, used when the tabs are compact and on the collapsed sidebar. */
const ICONS: Record<string, LucideIcon> = {
  today: Sun, routine: ListChecks, week: Target, trading: CandlestickChart, business: Briefcase,
  money: Wallet, training: Dumbbell, calendar: CalendarDays, notes: NotebookPen,
}
const NavIcon = ({ k }: { k: string }) => { const I = ICONS[k] ?? Sun; return <I className="ic" size={16} strokeWidth={1.7} aria-hidden /> }

function navLink(n: NavEntry, iconTitle: boolean) {
  return (
    <NavLink key={n.key} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'on' : '')} title={iconTitle ? n.label : undefined} aria-label={n.label}>
      <NavIcon k={n.key} /><span className="t">{n.label}</span>
    </NavLink>
  )
}

/**
 * The top tabs, always all of them. When the labels don't fit, the tabs you
 * aren't on shrink to icons (name on hover) and the current one keeps its name.
 * Widths come from a hidden copy of the full row, measured on every resize.
 */
function TopNav({ items }: { items: readonly NavEntry[] }) {
  const box = useRef<HTMLDivElement>(null)
  const ruler = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  useLayoutEffect(() => {
    const measure = () => {
      if (!box.current || !ruler.current) return
      setCompact(ruler.current.scrollWidth > box.current.clientWidth)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [items])
  return (
    <div className="wh-navbox" ref={box}>
      <nav className={`wh-nav ${compact ? 'compact' : ''}`} aria-label="Sections">{items.map(n => navLink(n, compact))}</nav>
      <div className="wh-nav wh-ruler" ref={ruler} aria-hidden>
        {items.map(n => <a key={n.key}><span className="t">{n.label}</span></a>)}
      </div>
    </div>
  )
}

const COLLAPSE_KEY = 'oura-nav-collapsed'
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } }

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5" strokeLinecap="round"/></svg>
)

export function WhoopShell({ children }: { children: React.ReactNode }) {
  const now = useClock()
  const { skin, setSkin, openPalette, nav, navLayout, openCustomize } = useSkin()
  const layout = usePreviewLayout() ?? navLayout
  const vertical = layout === 'vertical'
  const [menu, setMenu] = useState(false)
  const av = useRef<HTMLButtonElement>(null)
  const photo = useAvatar()
  const pic = useAvatarActions()
  const file = useRef<HTMLInputElement>(null)
  const privacy = usePrivacyEverywhere()
  const qc = useQueryClient()
  const look = useMode()
  const isNextSkin = skin === 'next'
  // L switches light and dark on every page.
  useEffect(() => {
    if (!isNextSkin) return
    const on = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'l' || e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target) || document.querySelector('[role="dialog"]')) return
      e.preventDefault(); look.toggle()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [isNextSkin, look])
  const modeBtn = isNextSkin && (
    <button className="wh-eye" onClick={look.toggle} aria-label={look.mode === 'dark' ? 'Switch to light mode (L)' : 'Switch to dark mode (L)'} title={look.mode === 'dark' ? 'Light mode (L)' : 'Dark mode (L)'}>
      {look.mode === 'dark' ? <SunMedium size={16} strokeWidth={1.6} aria-hidden /> : <Moon size={16} strokeWidth={1.6} aria-hidden />}
    </button>
  )
  const [collapsed, setCollapsedState] = useState(readCollapsed)
  const setCollapsed = (v: boolean) => { setCollapsedState(v); try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0') } catch { /* private mode */ } }
  const chooseLayout = (l: NavLayout) => {
    qc.setQueryData(['app-settings'], (old: object | undefined) => ({ ...(old ?? {}), navLayout: l }))
    api.put('/api/today/settings', { navLayout: l }).finally(() => qc.invalidateQueries({ queryKey: ['app-settings'] }))
  }
  // [ collapses or expands the sidebar.
  useEffect(() => {
    if (!vertical) return
    const on = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target) || document.querySelector('[role="dialog"]')) return
      e.preventDefault(); setCollapsed(!readCollapsed())
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [vertical])
  const eye = (
    <button className={`wh-eye ${privacy.hidden ? 'on' : ''}`} onClick={privacy.toggle} aria-pressed={privacy.hidden}
      aria-label={privacy.hidden ? 'Show amounts (H)' : 'Hide amounts (H)'} title={privacy.hidden ? 'Amounts hidden. Press H to show' : 'Hide amounts (H)'}>
      <EyeIcon off={privacy.hidden} />
    </button>
  )

  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.wh-menu, .wh-av')) setMenu(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [menu])

  const day = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const avatar = (
    <button ref={av} className="wh-av" onClick={() => setMenu(m => !m)} aria-label="Profile and appearance" aria-haspopup="menu" aria-expanded={menu}>
      {photo ? <img src={photo} alt="" /> : 'O'}
    </button>
  )

  const r = av.current?.getBoundingClientRect()
  const menuPos: React.CSSProperties | undefined = r && (vertical
    ? { bottom: window.innerHeight - r.top + 8, left: r.left }
    : { top: r.bottom + 8, right: window.innerWidth - r.right })

  return (
    <div className={`wh wh-app ${vertical ? 'wh-v' : ''}`}>
      {vertical ? (
        <aside className={`wh-side ${collapsed ? 'mini' : ''}`}>
          <div className="wh-brand">{collapsed ? <AreteMark size={26} title="Arete" /> : <AreteBrand />}</div>
          <button className="wh-search" onClick={openPalette} aria-label="Search and commands" title={collapsed ? 'Search (⌘K)' : undefined}>
            <SearchIcon />
            <span className="lbl">Search</span> <kbd>⌘K</kbd>
          </button>
          <nav className="wh-snav" aria-label="Sections">{nav.map(n => navLink(n, collapsed))}</nav>
          <button className="wh-collapse" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar ([)' : 'Collapse sidebar ([)'} title={collapsed ? 'Expand ([)' : 'Collapse ([)'}>
            {collapsed ? <ChevronsRight size={16} aria-hidden /> : <><ChevronsLeft size={16} aria-hidden /><span className="lbl">Collapse</span><kbd>[</kbd></>}
          </button>
          <div className="wh-sfoot">
            {eye}
            {modeBtn}
            <div className="wh-swhen">
              <b>{day}</b>
              <span className="num">{time}</span>
            </div>
            {avatar}
          </div>
        </aside>
      ) : (
        <header className="wh-top">
          <div className="wh-brand"><AreteBrand /></div>
          <TopNav items={nav} />
          <div className="wh-topr">
            <button className="wh-search" onClick={openPalette} aria-label="Search and commands">
              <SearchIcon />
              <span className="lbl">Search anything</span> <kbd>⌘K</kbd>
            </button>
            {eye}
            {modeBtn}
            <div className="wh-when">
              <b>{day}</b><span className="sep"> · </span><span className="num">{time}</span>
            </div>
            {avatar}
          </div>
        </header>
      )}
      {/* Keyed on the mode so charts that read colours at draw time redraw in the new palette. */}
      <main className="wh-main" key={look.mode}>{children}</main>
      {menu && menuPos && createPortal(
        <div className="wh wh-menu" style={menuPos} role="menu">
          <div className="wh-mprof">
            <span className="wh-av big" aria-hidden>{photo ? <img src={photo} alt="" /> : 'O'}</span>
            <div>
              <b>OzzY</b>
              <span>
                <button className="lnk" onClick={() => file.current?.click()} disabled={pic.set.isPending}>{pic.set.isPending ? 'Uploading…' : photo ? 'Change photo' : 'Add a photo'}</button>
                {photo && <button className="lnk" onClick={() => pic.remove.mutate()}>Remove</button>}
              </span>
              {pic.set.isError && <small role="alert">That image couldn't be used. Try a JPG or PNG.</small>}
            </div>
            <input ref={file} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) pic.set.mutate(f); e.target.value = '' }} />
          </div>
          {isNextSkin && <>
            <hr />
            <p>Appearance</p>
            <div className="wh-mseg three" role="radiogroup" aria-label="Appearance">
              {([['dark', 'Dark'], ['light', 'Light'], ['system', 'Match Mac']] as [ModePref, string][]).map(([v, l]) => (
                <button key={v} role="radio" aria-checked={look.pref === v} className={look.pref === v ? 'on' : ''} onClick={() => look.setPref(v)}>{l}</button>
              ))}
            </div>
          </>}
          <hr />
          <p>Tabs</p>
          <div className="wh-mseg" role="radiogroup" aria-label="Where the tabs sit">
            <button role="radio" aria-checked={!vertical} className={!vertical ? 'on' : ''} onClick={() => chooseLayout('horizontal')}>Along the top</button>
            <button role="radio" aria-checked={vertical} className={vertical ? 'on' : ''} onClick={() => chooseLayout('vertical')}>Down the side</button>
          </div>
          <hr />
          <p>Skin</p>
          {SKINS.map(s => (
            <button key={s.id} className={s.id === skin ? 'on' : ''} onClick={() => { setSkin(s.id); setMenu(false) }} role="menuitemradio" aria-checked={s.id === skin}>
              {s.label}<small>{s.hint}</small>
            </button>
          ))}
          <hr />
          <button className="wh-mcust" onClick={() => { openCustomize(); setMenu(false) }} role="menuitem">Customize tabs…</button>
        </div>,
        document.body,
      )}
    </div>
  )
}
