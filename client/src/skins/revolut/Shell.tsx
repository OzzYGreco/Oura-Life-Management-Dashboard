import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink } from 'react-router-dom'
import { SKINS, useSkin, type NavLayout } from '../core'
import './revolut.css'
import { AreteBrand } from '../../brand/AreteMark'

/** ?nav=vertical|horizontal previews an orientation without saving it. Read once, so it survives in-app navigation. */
function usePreviewLayout(): NavLayout | null {
  const [v] = useState<NavLayout | null>(() => {
    const q = new URLSearchParams(window.location.search).get('nav')
    return q === 'vertical' || q === 'horizontal' ? q : null
  })
  return v
}

const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" strokeLinecap="round" /></svg>
)

export function RevolutShell({ children }: { children: React.ReactNode }) {
  const { skin, setSkin, openPalette, nav, navLayout, openCustomize } = useSkin()
  const layout = usePreviewLayout() ?? navLayout
  const vertical = layout === 'vertical'
  const [menu, setMenu] = useState(false)
  const av = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.rv-menu, .rv-av, .rv-sfoot')) setMenu(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [menu])

  const links = nav.map(n => (
    <NavLink key={n.key} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'on' : '')}>{n.label}</NavLink>
  ))
  const search = (
    <button className="rv-search" onClick={openPalette} aria-label="Search and commands">
      <SearchIcon />
      <span className="t">{vertical ? 'Search' : 'Search or jump to'}</span>
      <kbd>⌘K</kbd>
    </button>
  )

  const r = av.current?.getBoundingClientRect()
  const menuPos: React.CSSProperties | undefined = r && (vertical
    ? { bottom: window.innerHeight - r.top + 8, left: r.left }
    : { top: r.bottom + 8, right: window.innerWidth - r.right })

  return (
    <div className={`rv rv-app ${vertical ? 'rv-v' : ''}`}>
      {vertical ? (
        <aside className="rv-side">
          <div className="rv-brand"><AreteBrand /></div>
          {search}
          <nav className="rv-snav" aria-label="Sections">{links}</nav>
          <button ref={av} className="rv-sfoot" onClick={() => setMenu(m => !m)} aria-label="Appearance" aria-haspopup="menu" aria-expanded={menu}>
            <span className="rv-av" aria-hidden>O</span>
            <span className="rv-sfoot-t">Appearance<small>{SKINS.find(s => s.id === skin)?.label}</small></span>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4.5 10l3.5-3.5 3.5 3.5" /></svg>
          </button>
        </aside>
      ) : (
        <header className="rv-top">
          <div className="rv-brand"><AreteBrand /></div>
          <nav className="rv-nav" aria-label="Sections">{links}</nav>
          {search}
          <button ref={av} className="rv-av" onClick={() => setMenu(m => !m)} aria-label="Appearance" aria-haspopup="menu" aria-expanded={menu}>O</button>
        </header>
      )}
      <main className="rv-main">{children}</main>
      {menu && menuPos && createPortal(
        <div className="rv rv-menu" style={menuPos} role="menu">
          <p>Skin</p>
          {SKINS.map(s => (
            <button key={s.id} className={s.id === skin ? 'on' : ''} onClick={() => { setSkin(s.id); setMenu(false) }} role="menuitemradio" aria-checked={s.id === skin}>
              <span>{s.label}<small>{s.hint}</small></span>
              {s.id === skin && <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 8.5l3.2 3L13 4.5" /></svg>}
            </button>
          ))}
          <hr />
          <button onClick={() => { openCustomize(); setMenu(false) }} role="menuitem">Customize tabs…</button>
        </div>,
        document.body,
      )}
    </div>
  )
}
