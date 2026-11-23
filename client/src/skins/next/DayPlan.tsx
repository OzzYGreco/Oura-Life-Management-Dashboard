/**
 * One day's plan, made the night before: what runs that day (routine items
 * can be skipped for this day only), one-day items added in one line, and
 * one-tap suggestions. Lives in Today's hero for a day ahead and in the
 * evening review's last step. Nothing is added or skipped on its own.
 */
import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { errText, toItem, useDayPlan, usePlan, type PlanPick } from '../../core/plan'
import { onceDate, type Parsed } from '../../core/routine'
import { QuickAdd } from '../whoop/Routine'
import './plan.css'

const fmtDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const longDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
const plusDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const pt = (n: number) => String(Math.round(n * 100) / 100)
const PAUSED_SHOWN = 8

export function DayPlan({ date, variant, focus }: { date: string; variant: 'hero' | 'sheet'; focus?: boolean }) {
  const { data } = useDayPlan(date)
  const plan = usePlan()
  const [note, setNote] = useState<{ text: string; undo?: () => void; bad?: boolean } | null>(null)
  const [allPaused, setAllPaused] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focus && data && !data.locked) box.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [focus, !!data]) // eslint-disable-line react-hooks/exhaustive-deps

  const say = (text: string, undo?: () => void, bad = false) => {
    if (timer.current) clearTimeout(timer.current)
    setNote({ text, undo, bad }); timer.current = setTimeout(() => setNote(null), 6000)
  }
  const fail = (e: unknown) => say(errText(e), undefined, true)

  if (!data) return <div className={`npl npl-${variant}`} aria-busy="true" />

  const busy = plan.add.isPending || plan.remove.isPending || plan.skip.isPending || plan.restore.isPending
  const open = !data.locked
  const items = [...data.items].sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9) || a.label.localeCompare(b.label))

  // A line can still say "tomorrow" or a date: each item goes to the day it names.
  const addParsed = (ps: Parsed[]) => {
    const byDate = new Map<string, Parsed[]>()
    for (const p of ps) { const d = onceDate(p.schedule ?? null) ?? date; byDate.set(d, [...(byDate.get(d) ?? []), p]) }
    for (const [d, list] of byDate) plan.add.mutate({ date: d, items: list.map(toItem) }, {
      onSuccess: () => say(list.length === 1 ? `Added ${list[0].label}${d !== date ? ` to ${fmtDay(d)}` : ''}` : `Added ${list.length} items${d !== date ? ` to ${fmtDay(d)}` : ''}`),
      onError: fail,
    })
  }
  const addPick = (p: PlanPick) => plan.add.mutate({ date, items: [toItem(p)] }, { onSuccess: () => say(`Added ${p.label}`), onError: fail })
  const skip = (id: number, label: string, on: boolean) => plan.skip.mutate({ id, skip: on }, {
    onSuccess: () => say(on ? `${label}: skipped for ${fmtDay(date)}` : `${label}: back on ${fmtDay(date)}`, on ? () => skip(id, label, false) : undefined),
    onError: fail,
  })
  const remove = (id: number, label: string) => plan.remove.mutate(id, {
    onSuccess: () => say(`${label}: deleted`, () => plan.restore.mutate(id, { onSuccess: () => say(`${label}: back`), onError: fail })),
    onError: fail,
  })

  const { unfinished, recent, paused } = data.suggestions
  const pausedFrom = paused[0]?.from
  const pausedShown = allPaused ? paused : paused.slice(0, PAUSED_SHOWN)
  const chips = (list: PlanPick[]) => list.map(p => (
    <Button key={p.label} variant="secondary" size="sm" className="npl-chip" disabled={busy} onClick={() => addPick(p)} aria-label={`Add ${p.label}${p.time ? ` at ${p.time}` : ''}`}>
      <Plus size={13} aria-hidden />{p.label}{p.time && <span className="num t">{p.time}</span>}
    </Button>
  ))

  return (
    <div ref={box} className={`npl npl-${variant}`}>
      {variant === 'hero' ? (
        <div className="npl-head">
          <p className="nx-state">Plan for {plusDays(data.today, 1) === date ? 'tomorrow' : 'this day'}</p>
          <h1>{longDay(date)}</h1>
          <p className="npl-sum num">{items.length ? `${items.length} item${items.length === 1 ? '' : 's'}, up to ${pt(data.total)} points` : 'Nothing planned yet. Add what this day holds below.'}</p>
        </div>
      ) : (
        <div className="npl-head">
          <h2>Plan {plusDays(data.today, 1) === date ? 'tomorrow' : fmtDay(date)}</h2>
          <p className="npl-sum num">{fmtDay(date)}{items.length ? `: ${items.length} item${items.length === 1 ? '' : 's'}, up to ${pt(data.total)} points` : ': nothing planned yet'}</p>
        </div>
      )}

      {open ? (
        <div className="npl-add">
          <QuickAdd today={date} onAdd={addParsed} label={`Add to ${fmtDay(date)} in one line, or paste a list`}
            placeholder={`Add to ${fmtDay(date)}: Gym 18:00 must 90m, or paste a list`} />
        </div>
      ) : <p className="npl-locked">{data.locked}</p>}

      {open && (unfinished.length > 0 || recent.length > 0 || paused.length > 0) && (
        <div className="npl-sugg">
          {unfinished.length > 0 && <div className="g"><span className="h">Left undone {fmtDay(plusDays(date, -1))}</span><div className="c">{chips(unfinished)}</div></div>}
          {recent.length > 0 && <div className="g"><span className="h">Added recently</span><div className="c">{chips(recent)}</div></div>}
          {paused.length > 0 && (
            <div className="g">
              <span className="h">From {pausedFrom ?? 'a paused routine'}, paused</span>
              <div className="c">
                {chips(pausedShown)}
                {paused.length > PAUSED_SHOWN && (
                  <Button variant="ghost" size="sm" onClick={() => setAllPaused(a => !a)} aria-expanded={allPaused}>
                    {allPaused ? 'Fewer' : `${paused.length - PAUSED_SHOWN} more`}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {items.length > 0 && (
        <ul className="npl-list" aria-label={`Planned for ${fmtDay(date)}`}>
          {items.map(i => (
            <li key={i.id}>
              <span className="num tm">{i.time ?? 'Anytime'}</span>
              <span className="lb">{i.label}<small>{i.oneOff ? 'this day only' : 'routine'}</small></span>
              <span className="num p">+{pt(i.points)}</span>
              {open && (i.oneOff
                ? <button className="ui-icon" disabled={busy} onClick={() => remove(i.id, i.label)} aria-label={`Delete ${i.label}`} title="Delete it from this day"><X size={14} /></button>
                : <Button variant="ghost" size="sm" disabled={busy} onClick={() => skip(i.id, i.label, true)} aria-label={`Skip ${i.label} on ${fmtDay(date)}`} title="Leave it out of this day only. Its streak holds.">Skip</Button>)}
            </li>
          ))}
        </ul>
      )}

      {data.skipped.length > 0 && (
        <div className="npl-skipped">
          <span className="h">Skipped this day</span>
          <ul>
            {data.skipped.map(s => (
              <li key={s.id}>
                <span className="num tm">{s.time ?? 'Anytime'}</span>
                <span className="lb">{s.label}</span>
                {open && <Button variant="secondary" size="sm" disabled={busy} onClick={() => skip(s.id, s.label, false)}>Bring back</Button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="npl-note" role="status" aria-live="polite">
        {note && <span className={note.bad ? 'bad' : ''}>{note.text}{note.undo && <> <Button variant="ghost" size="sm" onClick={() => { note.undo!(); setNote(null) }}>Undo</Button></>}</span>}
      </div>
    </div>
  )
}
