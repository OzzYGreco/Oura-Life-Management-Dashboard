import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useSearchParams } from 'react-router-dom'
import { SKINS, useSkin } from '../core'
import { isDone, useToday } from '../../core/today'
import './things.css'
import { AreteBrand } from '../../brand/AreteMark'

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t) }, [])
  return now
}

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export function Star({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M8 1.4l1.95 4.05 4.45.62-3.23 3.1.79 4.42L8 11.5l-3.96 2.09.79-4.42-3.23-3.1 4.45-.62z" fill="var(--k-star)" stroke="#E2A400" strokeWidth=".7" strokeLinejoin="round" />
    </svg>
  )
}

const ICONS: Record<string, React.ReactNode> = {
  today: <Star />,
  week: <svg width="16" height="16" viewBox="0 0 16 16" {...STROKE}><rect x="2" y="3" width="12" height="11" rx="2.5" /><path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4" /></svg>,
  routine: <svg width="16" height="16" viewBox="0 0 16 16" {...STROKE}><circle cx="8" cy="8" r="6" /><path d="M5.3 8.2l1.8 1.8 3.6-3.8" /></svg>,
  trading: <svg width="16" height="16" viewBox="0 0 16 16" {...STROKE}><path d="M2 12l3.5-4 3 2.5L14 4" /><path d="M10.5 4H14v3.5" /></svg>,
  business: <svg width="16" height="16" viewBox="0 0 16 16" {...STROKE}><rect x="2" y="5" width="12" height="9" rx="2.2" /><path d="M5.5 5V3.6c0-.9.7-1.6 1.6-1.6h1.8c.9 0 1.6.7 1.6 1.6V5M2 9h12" /></svg>,
  training: <svg width="16" height="16" viewBox="0 0 16 16" {...STROKE}><path d="M4 5v6M12 5v6M2 6.8v2.4M14 6.8v2.4M4 8h8" /></svg>,
  money: <svg width="16" height="16" viewBox="0 0 16 16" {...STROKE}><circle cx="8" cy="8" r="6" /><path d="M9.8 5.6c-.4-.6-1.1-.9-1.8-.9-1 0-1.8.6-1.8 1.4 0 1.9 3.8 1 3.8 3 0 .8-.9 1.4-2 1.4-.8 0-1.5-.3-1.9-.9M8 3.6v1.1M8 11.3v1.1" /></svg>,
  calendar: <svg width="16" height="16" viewBox="0 0 16 16" {...STROKE}><rect x="2" y="3" width="12" height="11" rx="2.5" /><path d="M2 6.5h12" /><path d="M5.5 9.5h.01M8 9.5h.01M10.5 9.5h.01" strokeWidth="2" /></svg>,
  notes: <svg width="16" height="16" viewBox="0 0 16 16" {...STROKE}><path d="M4 2.5h6l2.5 2.5v8.5H4z" /><path d="M6.3 8h4M6.3 10.6h3" /></svg>,
}

export function ThingsShell({ children }: { children: React.ReactNode }) {
  const now = useClock()
  const { skin, setSkin, openPalette, nav, navLayout, openCustomize } = useSkin()
  const [params] = useSearchParams()
  const q = params.get('nav')
  const layout = q === 'vertical' || q === 'horizontal' ? q : navLayout
  const top = layout === 'horizontal'
  const { data } = useToday()
  const [menu, setMenu] = useState(false)
  const who = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.th-menu, .th-who')) setMenu(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [menu])

  // Counts beside the nav, only where the data says something real.
  const left = data && !data.day.closed
    ? data.day.items.filter(i => !isDone(i.status) && i.status !== 'missed').length : null
  const due = data?.pulse.business?.nextDue
  const overdueInvoice = due ? new Date(due.dueDate + 'T23:59:59') < new Date() : false
  const counts: Record<string, React.ReactNode> = {
    today: left ? left : null,
    week: data?.week ? Math.round(data.week.score * 100) / 100 : null,
    business: overdueInvoice ? <span className="bad" title="An invoice is overdue">1</span> : null,
  }

  const brand = (
    <div className="th-brand">
      <AreteBrand size={22} />
    </div>
  )
  const search = (
    <button className="th-search" onClick={openPalette} aria-label="Search and commands">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><circle cx="6" cy="6" r="4.3" /><path d="M9.3 9.3l3 3" strokeLinecap="round" /></svg>
      Search
      <kbd>⌘K</kbd>
    </button>
  )
  const links = (
    <nav className={top ? 'th-nav th-tabs' : 'th-nav'} aria-label="Sections">
      {nav.map((n, i) => (
        <div key={n.key} style={{ display: 'contents' }}>
          {n.key === 'calendar' && i > 0 && <div className="sep" aria-hidden />}
          <NavLink to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'on' : '')}>
            <span className="ic">{ICONS[n.key]}</span>
            {n.label}
            {counts[n.key] != null && <span className="n num">{counts[n.key]}</span>}
          </NavLink>
        </div>
      ))}
    </nav>
  )
  const day = now.toLocaleDateString('en-GB', { weekday: 'long' })
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  const r = who.current?.getBoundingClientRect()
  return (
    <div className={`th th-app${top ? ' th-h' : ''}`}>
      {top ? (
        <header className="th-side th-bar">
          {brand}
          {links}
          {search}
          <button ref={who} className="th-who" onClick={() => setMenu(m => !m)} aria-label="Switch skin" aria-haspopup="menu" aria-expanded={menu}>
            <span className="t"><span className="num">{time}</span><small>{day}</small></span>
            <span className="av">O</span>
          </button>
        </header>
      ) : (
        <aside className="th-side">
          {brand}
          {search}
          {links}
          <button ref={who} className="th-who" onClick={() => setMenu(m => !m)} aria-label="Switch skin" aria-haspopup="menu" aria-expanded={menu}>
            <span className="av">O</span>
            <span className="t">OzzY<small>{day} · <span className="num">{time}</span></small></span>
            <svg className="chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3.5 7.5L6 5l2.5 2.5" /></svg>
          </button>
        </aside>
      )}
      <main className="th-panel">{children}</main>
      {menu && r && createPortal(
        <div className="th th-menu" style={top ? { top: r.bottom + 8, right: window.innerWidth - r.right } : { bottom: window.innerHeight - r.top + 8, left: r.left }} role="menu" aria-label="Skin">
          <p>Skin</p>
          {SKINS.map(s => (
            <button key={s.id} className={s.id === skin ? 'on' : ''} onClick={() => { setSkin(s.id); setMenu(false) }} role="menuitemradio" aria-checked={s.id === skin}>
              <span>{s.label}<small>{s.hint}</small></span>
              {s.id === skin && <svg width="14" height="14" viewBox="0 0 10 10" aria-hidden><path d="M2 5.3l2 2 4-4.4" fill="none" stroke="var(--k-blue)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </button>
          ))}
          <div className="th-menu-sep" role="separator" />
          <button className="th-menu-act" onClick={() => { openCustomize(); setMenu(false) }} role="menuitem">
            <span>Customize tabs…</span>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /><circle cx="5.5" cy="4.5" r="1.4" fill="#fff" /><circle cx="10.5" cy="8" r="1.4" fill="#fff" /><circle cx="7" cy="11.5" r="1.4" fill="#fff" /></svg>
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}
