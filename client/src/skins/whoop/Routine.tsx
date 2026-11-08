import { useEffect, useRef, useState } from 'react'
import { LEADS, fromDayMin, parseMany, pointsOf, toDayMin, useDeleteRoutine, useNewRoutine, useRenameRoutine, useReminderSettings, useSaveReminderSettings, useSaveRoutine, useNotifierStatus, useSetRoutineType, useTestNotification, useToggleRoutine, type NotifierStatus, type Parsed, type RoutineItem, type RoutineView } from '../../core/routine'
import { useWeeklyTick } from '../../core/today'
import './routine-today.css'

const DAY_END = 1440 + 240            // 04:00 the next morning
export function EmptyRoutine() {
  const create = useNewRoutine()
  return (
    <section className="wh-card wh-ed">
      <div className="wh-h">No routine yet</div>
      <p className="wh-sub" style={{ marginTop: 6 }}>A routine is the set of things you mean to do each day, each with a time window. Ticking inside the window earns its points.</p>
      <button className="wh-btn" style={{ marginTop: 14 }} onClick={() => create.mutate('Daily routine')}>Create a routine</button>
    </section>
  )
}

// ─── The routine: one plain list, edited in place ────────────────────────────

export type Draft = RoutineItem & { key: string }
let seq = 0
const keyed = (i: RoutineItem): Draft => ({ ...i, key: i.id ? `i${i.id}` : `n${++seq}` })
const byTime = (a: RoutineItem, b: RoutineItem) => (toDayMin(a.time) ?? 99999) - (toDayMin(b.time) ?? 99999)
export type DraftApi = ReturnType<typeof useDraft>

/** Editing state shared by the list and the timeline; saves itself shortly after each change. */
export function useDraft(tpl: RoutineView['templates'][number]) {
  const weekly = tpl.type === 'weekly'
  const save = useSaveRoutine()
  const [items, setItems] = useState<Draft[]>(() => tpl.items.map(keyed))
  const [open, setOpen] = useState<string | null>(null)
  const [status, setStatus] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Take fresh server state (new ids after a save) unless an edit is in flight.
  useEffect(() => {
    if (status !== 'saved') return
    setItems(prev => {
      const next = tpl.items.map(i => { const old = prev.find(p => p.id === i.id); return old ? { ...i, key: old.key } : keyed(i) })
      return [...next, ...prev.filter(p => !p.id && !p.label.trim())]   // keep an unnamed new row
    })
  }, [tpl]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: Draft[]) => {
    setItems(next)
    setStatus('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setStatus('saving')
      save.mutate({ id: tpl.id, items: next.filter(i => i.label.trim()).sort(byTime) }, {
        onSuccess: () => setStatus('saved'),
        onError: () => setStatus('error'),
      })
    }, 600)
  }
  const patch = (key: string, p: Partial<Draft>) => commit(items.map(i => (i.key === key ? { ...i, ...p } : i)))
  const remove = (key: string) => { setOpen(null); commit(items.filter(i => i.key !== key)) }
  const add = () => {
    const last = [...items].filter(i => i.label.trim()).sort(byTime).pop()
    const start = last?.time ? Math.min(DAY_END - 60, (toDayMin(last.time) ?? 540) + 60) : 540
    const d = keyed({ label: '', time: weekly ? null : fromDayMin(start), windowMin: 60, schedule: null, importance: 'NUI', points: 5, pointsOverride: null })
    setItems([...items, d]); setOpen(d.key)
  }
  /**
   * Adds fully described items from the quick-add box (one line, or a pasted
   * list); saved straight away. An item with no time follows the one before it.
   * Weekly routines have no times or days.
   */
  const addParsed = (ps: Parsed[]) => {
    const next = [...items]
    for (const p of ps) {
      const last = [...next].filter(i => i.label.trim() && i.time).sort(byTime).pop()
      const fallback = last?.time ? Math.min(DAY_END - 60, (toDayMin(last.time) ?? 540) + 60) : 540
      next.push(keyed({
        label: p.label, time: weekly ? null : p.time ?? fromDayMin(fallback), windowMin: p.windowMin ?? 60,
        schedule: weekly || p.schedule === undefined ? null : p.schedule, importance: p.importance ?? 'NUI',
        points: pointsOf(p.importance ?? 'NUI', null), pointsOverride: null,
      }))
    }
    commit(next)
  }
  return { items, open, setOpen, status, patch, remove, add, addParsed, weekly }
}

export function ResumeButton({ id }: { id: number }) {
  const toggle = useToggleRoutine()
  return <button className="wh-chase" onClick={() => toggle.mutate({ id, enabled: true })}>Resume</button>
}

export function RoutineHeader({ data, tpl, onPick, status, count, total }: {
  data: RoutineView; tpl: RoutineView['templates'][number]; onPick: (id: number | null) => void
  status: 'saved' | 'saving' | 'dirty' | 'error'; count: number; total: number
}) {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(tpl.name)
  const [confirm, setConfirm] = useState(false)
  const rename = useRenameRoutine()
  const toggle = useToggleRoutine()
  const del = useDeleteRoutine()
  const create = useNewRoutine()
  const setType = useSetRoutineType()
  const weekly = tpl.type === 'weekly'

  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.wh-rmenu, .wh-dots')) { setMenu(false); setConfirm(false) } }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [menu])

  return (
    <div className="wh-rhead">
      <div className="l">
        {renaming ? (
          <form onSubmit={e => { e.preventDefault(); if (name.trim()) rename.mutate({ id: tpl.id, name: name.trim() }); setRenaming(false) }}>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={() => setRenaming(false)} className="wh-rename" aria-label="Routine name" />
          </form>
        ) : data.templates.length > 1 ? (
          <div className="wh-tpls" role="tablist" aria-label="Routines">
            {data.templates.map(t => (
              <button key={t.id} role="tab" aria-selected={t.id === tpl.id} className={t.id === tpl.id ? 'on' : ''} onClick={() => onPick(t.id)}>
                {t.name}{t.type === 'weekly' && <small> · weekly</small>}{!t.enabled && <small> · paused</small>}
              </button>
            ))}
          </div>
        ) : (
          <div className="wh-h" style={{ fontSize: 17 }}>{tpl.name}</div>
        )}
        <div className="wh-sub">{count} item{count === 1 ? '' : 's'} · {weekly ? 'weekly, ticked once a week and not scored' : `up to ${total} points a day`}</div>
      </div>
      <div className="r">
        <span className="wh-sub" style={{ color: status === 'error' ? 'var(--k-bad)' : undefined }} role="status">
          {status === 'saved' ? 'Saved' : status === 'error' ? "Couldn't save, try again" : 'Saving…'}
        </span>
        <button className="wh-dots" aria-label="Routine options" aria-expanded={menu} onClick={() => { setMenu(m => !m); setConfirm(false) }}>⋯</button>
        {menu && (
          <div className="wh wh-rmenu" role="menu">
            {!confirm ? (
              <>
                <button role="menuitem" onClick={() => { setMenu(false); setName(tpl.name); setRenaming(true) }}>Rename</button>
                <button role="menuitem" onClick={() => { setMenu(false); toggle.mutate({ id: tpl.id, enabled: !tpl.enabled }) }}>{tpl.enabled ? 'Pause' : 'Resume'}</button>
                <button role="menuitem" onClick={() => { setMenu(false); setType.mutate({ id: tpl.id, type: weekly ? 'daily' : 'weekly' }) }}>
                  {weekly ? 'Make it daily' : 'Make it weekly'}
                </button>
                <hr />
                <button role="menuitem" onClick={() => { setMenu(false); create.mutate({ name: 'New routine', type: 'daily' }, { onSuccess: r => onPick(r.id) }) }}>New daily routine</button>
                <button role="menuitem" onClick={() => { setMenu(false); create.mutate({ name: 'Weekly routine', type: 'weekly' }, { onSuccess: r => onPick(r.id) }) }}>New weekly routine</button>
                <hr />
                <button role="menuitem" className="bad" onClick={() => setConfirm(true)}>Delete routine…</button>
              </>
            ) : (
              <div className="confirm">
                <p>Delete “{tpl.name}”? It stops running from today. Past days keep their scores.</p>
                <div>
                  <button onClick={() => { setConfirm(false); setMenu(false) }}>Cancel</button>
                  <button className="bad" onClick={() => del.mutate(tpl.id, { onSuccess: () => { setMenu(false); onPick(null) } })}>Delete</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Days in a row (or weeks in a row) as a small flame and a number. Shown from 2. */
export function Streak({ n, unit = 'day' }: { n?: number; unit?: 'day' | 'week' }) {
  if (!n || n < 2) return null
  return (
    <span className="rt-streak num" title={`${n} ${unit}s in a row ${unit === 'day' ? 'on time' : 'done'}`} aria-label={`${n} ${unit}s in a row`}>
      <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden><path d="M5 .6c.4 2-1.9 3-1.9 5.2 0 .8.4 1.4.9 1.7-.1-1.2.6-2 1.4-2.6.1 1.4 1.6 1.9 1.6 3.4 0 .4-.1.8-.3 1.1C8.2 8.8 9 7.6 9 6.2 9 3.4 6.3 2.6 5 .6zM1 7.4C1 9.9 2.8 11.4 5 11.4S9 9.9 9 7.4" fill="currentColor" /></svg>
      {n}
    </span>
  )
}

export function QuickAdd({ onAdd, placeholder, today, label = 'Add an item in one line, or paste a list' }: {
  onAdd: (ps: Parsed[]) => void; placeholder: string; today?: string; label?: string
}) {
  const [text, setText] = useState('')
  const ps = text.trim() ? parseMany(text, today) : []
  const lines = text.split('\n').length
  const multi = lines > 1
  const submit = () => { if (ps.length) { onAdd(ps); setText('') } }
  return (
    <form className="wh-quick rt-quick" onSubmit={e => { e.preventDefault(); submit() }}>
      <textarea value={text} rows={Math.min(lines, 6)} onChange={e => setText(e.target.value)} placeholder={placeholder} aria-label={label}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} />
      {ps.length > 0 && !multi && (
        <div className="prev" aria-live="polite">
          <b>{ps[0].label}</b>
          {ps[0].bits.map(b => <span key={b}>{b}</span>)}
          <kbd>Enter</kbd>
        </div>
      )}
      {multi && (
        <div className="rt-many" aria-live="polite">
          <div className="hd"><span>{ps.length} item{ps.length === 1 ? '' : 's'} read from the paste</span><kbd>Enter adds all</kbd></div>
          <ol>
            {ps.map((p, i) => (
              <li key={i}><b>{p.label}</b>{p.bits.map(b => <span key={b}>{b}</span>)}</li>
            ))}
          </ol>
        </div>
      )}
      {text.trim() && !ps.length && <div className="prev"><i>name it</i></div>}
    </form>
  )
}

// ─── A weekly routine's item: a name, done or not this week ─────────────────

export function WeeklyRow({ item, onChange, onRemove }: { item: Draft; onChange: (p: Partial<Draft>) => void; onRemove: () => void }) {
  const tick = useWeeklyTick()
  const done = !!item.week?.done
  const id = item.week?.entryItemId
  return (
    <div className="rt-wrow">
      <button className={`rt-check ${done ? 'on' : ''}`} disabled={!id || tick.isPending} aria-pressed={done}
        aria-label={done ? `Untick ${item.label} for this week` : `Tick ${item.label} for this week`}
        title={id ? (done ? 'Done this week. Click to untick.' : 'Tick it for this week') : 'Saved items can be ticked'}
        onClick={() => id && tick.mutate({ id, done: !done })}>
        {done && <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden><path d="M2.5 6.3l2.2 2.1 4.8-4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </button>
      <input value={item.label} placeholder="What do you do once a week?" autoFocus={!item.label} aria-label="Weekly item name"
        onChange={e => onChange({ label: e.target.value })} />
      <Streak n={item.streak} unit="week" />
      <span className={`rt-wst ${done ? 'good' : ''}`}>{done ? 'Done this week' : 'Not yet this week'}</span>
      <button className="rt-x" onClick={onRemove} aria-label={`Remove ${item.label || 'this item'}`}>×</button>
    </div>
  )
}

// ─── Reminders ───────────────────────────────────────────────────────────────

/** Opens System Settings at Notifications. */
const NOTIFICATION_SETTINGS = 'x-apple.systempreferences:com.apple.Notifications-Settings.extension'

/** Whether macOS settings stand between a reminder and you. */
const needsSettings = (n: NotifierStatus) => n.via === 'arete' && (n.permission === 'denied' || n.style === 'none' || n.sound === false)

/** One line on how reminders arrive, and what to change when they won't get your attention. */
function notifierLine(n: NotifierStatus | undefined): string {
  if (!n) return 'Reminders come as macOS notifications, even with the browser closed.'
  if (n.via !== 'arete') return 'Reminders use plain macOS notifications, which can arrive quietly. Run npm run notifier:build for Arete notifications with a sound.'
  if (n.permission === 'not-determined') return 'Send a test: macOS will ask once whether Arete may send notifications. Choose Allow.'
  if (n.permission === 'denied') return 'macOS is blocking Arete. In Notification settings, open Arete and turn on Allow notifications.'
  if (n.style === 'none') return 'Arete is allowed but set to show nothing. In Notification settings, set Arete to Alerts.'
  if (n.sound === false) return 'Sound is off for Arete. Turn on "Play sound for notification" in Notification settings.'
  return n.style === 'alerts'
    ? 'Reminders arrive as Arete alerts with a sound, and stay until you dismiss them, even with the browser closed.'
    : 'Reminders arrive as Arete notifications with a sound, even with the browser closed.'
}

export function Reminders() {
  const { data } = useReminderSettings()
  const save = useSaveReminderSettings()
  const test = useTestNotification()
  const status = useNotifierStatus()
  const [tested, setTested] = useState<string | null>(null)
  if (!data) return null
  const on = data.notifications === 'on'
  const lead = Number(data.alertLeadMin) || 0
  const quiet = data.quietFrom && data.quietTo
  const set = (patch: Record<string, string>) => save.mutate(patch)

  return (
    <section className="wh-card rt-rem">
      <div className="hd">
        <div className="wh-h">Reminders</div>
        <span className="wh-sub" role="status">{save.isPending ? 'Saving…' : save.isError ? "Couldn't save" : ''}</span>
      </div>
      <p className="rt-answer">
        {on
          ? <>On. Each item alerts {lead ? <><b className="num">{lead} min</b> before</> : 'when'} its window opens; the evening review prompt comes at <b className="num">{data.reviewTime}</b>{quiet ? <>; quiet from <b className="num">{data.quietFrom}</b> to <b className="num">{data.quietTo}</b></> : ''}.</>
          : 'Off. No item alerts and no evening review prompt.'}
      </p>
      <div className="rt-field">
        <span>Notifications</span>
        <div className="rt-seg" role="radiogroup" aria-label="Notifications">
          {(['on', 'off'] as const).map(v => (
            <button key={v} role="radio" aria-checked={data.notifications === v} className={data.notifications === v ? 'on' : ''}
              onClick={() => set({ notifications: v })}>{v === 'on' ? 'On' : 'Off'}</button>
          ))}
        </div>
      </div>
      <div className={`rt-field ${on ? '' : 'dim'}`}>
        <span>Alert me</span>
        <div className="rt-seg" role="radiogroup" aria-label="How early to alert">
          {LEADS.map(m => (
            <button key={m} role="radio" aria-checked={lead === m} className={lead === m ? 'on' : ''} disabled={!on}
              onClick={() => set({ alertLeadMin: String(m) })}>{m === 0 ? 'At start' : `${m} min`}</button>
          ))}
        </div>
      </div>
      <div className={`rt-field ${on ? '' : 'dim'}`}>
        <span>Evening review</span>
        <input className="num" type="time" value={data.reviewTime} disabled={!on} aria-label="Evening review time"
          onChange={e => e.target.value && set({ reviewTime: e.target.value })} />
      </div>
      <div className={`rt-field ${on ? '' : 'dim'}`}>
        <span>Quiet hours</span>
        <div className="rt-quiet">
          <input className="num" type="time" value={data.quietFrom} disabled={!on} aria-label="Quiet from"
            onChange={e => set({ quietFrom: e.target.value, ...(data.quietTo ? {} : { quietTo: '08:00' }) })} />
          <span>to</span>
          <input className="num" type="time" value={data.quietTo} disabled={!on} aria-label="Quiet until"
            onChange={e => set({ quietTo: e.target.value, ...(data.quietFrom ? {} : { quietFrom: '23:00' }) })} />
          {quiet && <button className="wh-chase" disabled={!on} onClick={() => set({ quietFrom: '', quietTo: '' })}>None</button>}
        </div>
      </div>
      <div className="rt-foot">
        <span className="wh-sub">{tested ?? notifierLine(status.data)}
          {status.data && needsSettings(status.data) && <> <a className="lnk" href={NOTIFICATION_SETTINGS}>Open Notification settings</a></>}
        </span>
        <button className="wh-chase" disabled={test.isPending}
          onClick={() => test.mutate(undefined, {
            onSuccess: r => setTested(!r.sent ? 'Not sent, try again.'
              : r.notifier.permission === 'not-determined' ? 'macOS is asking whether Arete may send notifications. Choose Allow, then send another test.'
              : 'Sent. It should appear in the top corner of the screen.'),
            onError: () => setTested("Couldn't send it. Is the server running?"),
          })}>Send a test notification</button>
      </div>
    </section>
  )
}

// ─── History heatmap + day drill-in ──────────────────────────────────────────

export function WhyMissed({ data }: { data: RoutineView }) {
  const items = data.templates.flatMap(t => t.items)
  const reasons: Record<string, number> = {}
  for (const i of items) for (const [r, n] of Object.entries(i.stats?.reasons ?? {})) reasons[r] = (reasons[r] ?? 0) + n
  const rs = Object.entries(reasons).sort((a, b) => b[1] - a[1])
  const total = rs.reduce((s, [, n]) => s + n, 0)
  const most = [...items].filter(i => (i.stats?.missed ?? 0) > 0).sort((a, b) => b.stats!.missed - a.stats!.missed).slice(0, 3)
  if (total === 0) return null   // appears once evening reviews have given reasons

  return (
    <section className="wh-card wh-why">
      <div className="wh-h">Why things get missed</div>
      {total === 0
        ? <p className="wh-sub" style={{ marginTop: 6 }}>Reasons come from the evening review. Close a few days with a reason for each miss and the pattern shows up here.</p>
        : rs.map(([r, n]) => (
          <div key={r} className="wh-tk">
            <div className="nm">{r}</div>
            <div className="wh-bar"><b style={{ width: `${(n / total) * 100}%`, background: 'var(--k-ink2)' }} /></div>
            <div className="v num">{n}</div>
          </div>
        ))}
      {most.length > 0 && (
        <>
          <div className="wh-sub" style={{ marginTop: 14 }}>Missed most, last 30 days</div>
          {most.map(i => (
            <div key={i.id} className="wh-mrow">
              <div className="k">{i.label}</div>
              <div className="r num" style={{ color: 'var(--k-bad)' }}>{i.stats!.missed} of {i.stats!.days}</div>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

// ─── One-offs for today ──────────────────────────────────────────────────────
