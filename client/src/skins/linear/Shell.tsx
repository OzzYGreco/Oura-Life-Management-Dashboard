import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useSearchParams } from 'react-router-dom'
import { SKINS, useSkin } from '../core'
import { useToday } from '../../core/today'
import './linear.css'
import { AreteBrand } from '../../brand/AreteMark'

const pt = (n: number) => String(Math.round(n * 100) / 100)

/** Linear's compact "13h 22m". */
export function hm(mins: number): string {
  const m = Math.max(0, Math.round(mins))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h}h ${r}m` : `${h}h`
}

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const ICONS: Record<string, React.ReactNode> = {
  today: <><circle cx="8" cy="8" r="5.6" {...S} /><path d="M8 4.8V8l2.2 1.4" {...S} /></>,
  week: <><rect x="2.4" y="3" width="11.2" height="10.4" rx="2" {...S} /><path d="M2.4 6.4h11.2M5.6 1.8v2.4M10.4 1.8v2.4" {...S} /></>,
  routine: <><path d="M2.6 4.4l1.2 1.2 2-2.2M2.6 10.4l1.2 1.2 2-2.2" {...S} /><path d="M8 4.6h5.4M8 10.6h5.4" {...S} /></>,
  trading: <><path d="M2.5 11.5 6 7.5l2.6 2.4 4.9-5.4" {...S} /><path d="M10.4 4.5h3.1v3.1" {...S} /></>,
  business: <><rect x="2.2" y="4.8" width="11.6" height="8.4" rx="1.8" {...S} /><path d="M5.8 4.8V3.6a1 1 0 0 1 1-1h2.4a1 1 0 0 1 1 1v1.2M2.2 8.6h11.6" {...S} /></>,
  training: <><path d="M1.8 8h1.6M12.6 8h1.6M5.2 8h5.6" {...S} /><rect x="3.4" y="5" width="1.8" height="6" rx=".6" {...S} strokeWidth={1.2} /><rect x="10.8" y="5" width="1.8" height="6" rx=".6" {...S} strokeWidth={1.2} /></>,
  money: <><circle cx="8" cy="8" r="5.6" {...S} /><path d="M9.8 6.2c-.3-.6-1-.9-1.8-.9-1 0-1.7.5-1.7 1.3 0 1.8 3.6.9 3.6 2.8 0 .8-.8 1.3-1.9 1.3-.9 0-1.6-.4-1.9-1M8 4.2v1.1M8 10.7v1.1" {...S} strokeWidth={1.2} /></>,
  calendar: <><rect x="2.4" y="2.4" width="11.2" height="11.2" rx="2" {...S} /><path d="M5.2 6h5.6M5.2 8.6h3.4" {...S} /></>,
  notes: <><path d="M4 2.4h5.6l2.4 2.4v8.8H4z" {...S} /><path d="M6 7.4h4M6 10h2.6" {...S} /></>,
}

export function LinearShell({ children }: { children: React.ReactNode }) {
  const { skin, setSkin, openPalette, nav, navLayout, openCustomize } = useSkin()
  const [params] = useSearchParams()
  const q = params.get('nav')
  const layout = q === 'vertical' || q === 'horizontal' ? q : navLayout
  const top = layout === 'horizontal'
  const { data } = useToday()
  const [menu, setMenu] = useState(false)
  const ws = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.ln-menu, .ln-ws, .ln-avbtn')) setMenu(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [menu])

  // Counts only where the data is real: windows still ahead today, and the week's score.
  const counts: Record<string, string | undefined> = {
    today: data && !data.day.closed && data.day.counts.ahead > 0 ? String(data.day.counts.ahead) : undefined,
    week: data?.week ? pt(data.week.score) : undefined,
  }
  const countLabel = (key: string) => key === 'today' ? `${counts[key]} windows ahead` : `week score ${counts[key]}`
  const r = ws.current?.getBoundingClientRect()

  const links = nav.map((n, i) => (
    <div key={n.key} className="ln-ni">
      <NavLink to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'on' : '')}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>{ICONS[n.key]}</svg>
        {n.label}
        {counts[n.key] && <span className="c num" aria-label={countLabel(n.key)}>{counts[n.key]}</span>}
      </NavLink>
      {n.key === 'week' && i < nav.length - 1 && <div className="ln-sep" aria-hidden />}
    </div>
  ))

  const search = (
    <button className="ln-search" onClick={openPalette} aria-label="Search or jump to a page">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><circle cx="6.2" cy="6.2" r="4.2" {...S} /><path d="m9.4 9.4 2.8 2.8" {...S} /></svg>
      <span>{top ? 'Search' : 'Search or jump to…'}</span><kbd>⌘K</kbd>
    </button>
  )

  return (
    <div className={`ln ln-app${top ? ' ln-h' : ''}`}>
      {top ? (
        <header className="ln-bar">
          <div className="ln-brand"><AreteBrand size={20} /></div>
          <nav className="ln-nav ln-tabs" aria-label="Sections">{links}</nav>
          <div className="ln-bar-r">
            {data && !data.day.closed ? (
              <span className="ln-left num" title={`Day closes ${data.day.closesAt}`}><b>{hm(data.day.minutesToClose)}</b> left</span>
            ) : data ? (
              <span className="ln-left num">Day closed <b>{data.day.score ?? 0}</b></span>
            ) : null}
            {search}
            <button ref={ws} className="ln-avbtn" onClick={() => setMenu(m => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="Workspace menu, switch skin">
              <span className="ln-av" aria-hidden>OZ</span>
              <svg className="ln-chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M3.5 4.75 6 7.25l2.5-2.5" {...S} /></svg>
            </button>
          </div>
        </header>
      ) : (
        <aside className="ln-side" aria-label="Sidebar">
          <button ref={ws} className="ln-ws" onClick={() => setMenu(m => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="Workspace menu, switch skin">
            <AreteBrand size={20} />
            <svg className="ln-chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M3.5 4.75 6 7.25l2.5-2.5" {...S} /></svg>
            <span className="ln-av" aria-hidden>OZ</span>
          </button>
          {search}
          <nav className="ln-nav" aria-label="Sections">{links}</nav>
          <div className="ln-foot num">
            {data && !data.day.closed ? (
              <>
                <div className="r"><span>Day closes</span><b>{data.day.closesAt}</b></div>
                <div className="r"><span>Time left</span><b>{hm(data.day.minutesToClose)}</b></div>
              </>
            ) : data ? (
              <div className="r"><span>Day closed</span><b>{data.day.score ?? 0}</b></div>
            ) : null}
          </div>
        </aside>
      )}
      <main className="ln-main">{children}</main>
      {menu && r && createPortal(
        <div className="ln ln-menu" style={top ? { top: r.bottom + 6, right: window.innerWidth - r.right } : { top: r.bottom + 6, left: r.left }} role="menu" aria-label="Skin">
          <p>Skin</p>
          {SKINS.map(s => (
            <button key={s.id} className={s.id === skin ? 'on' : ''} onClick={() => { setSkin(s.id); setMenu(false) }} role="menuitemradio" aria-checked={s.id === skin}>
              <span className="nm">{s.label}<small>{s.hint}</small></span>
              {s.id === skin && <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="m3.5 7.2 2.3 2.3 4.7-5" {...S} strokeWidth={1.5} /></svg>}
            </button>
          ))}
          <div className="ln-menu-sep" role="separator" />
          <button className="ln-menu-act" onClick={() => { openCustomize(); setMenu(false) }} role="menuitem">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M2.5 4h9M2.5 7h9M2.5 10h9" {...S} /><circle cx="5" cy="4" r="1.2" {...S} fill="var(--k-s2)" /><circle cx="9" cy="7" r="1.2" {...S} fill="var(--k-s2)" /><circle cx="6" cy="10" r="1.2" {...S} fill="var(--k-s2)" /></svg>
            <span className="nm">Customize tabs…</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}
