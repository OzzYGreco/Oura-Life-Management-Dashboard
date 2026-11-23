import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CATEGORIES, beats, catMeta, setLabel, setText, startingSets, topOf, useDeleteTemplate, useLogWorkout, useSaveTemplate, useUpdateBody, type BodyMetric, type LogExercise, type Template, type TrainingView, type Workout } from '../../core/training'
import './training.css'

const fmtDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const fmtShort = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
/** What the logger opens with: a template by name, or an existing workout to edit. */
export type LogInit = { template: string } | { edit: Workout }

const chartTip = {
  contentStyle: { background: 'var(--k-card2)', border: '1px solid var(--k-line2)', borderRadius: 12, fontSize: 12.5, padding: '6px 10px' },
  labelStyle: { color: 'var(--k-mute)', marginBottom: 2 },
  itemStyle: { color: 'var(--k-ink)', padding: 0 },
}
const tick = { fill: 'var(--k-faint)', fontSize: 11, fontFamily: 'var(--k-font)' }

export function MetricChart({ rows, field, unit, label }: { rows: BodyMetric[]; field: 'weightKg' | 'bodyFatPct'; unit: string; label: string }) {
  const pts = rows.filter(r => r[field] != null)
  // Ticks at whole steps of 1, 2 or 5 around the values, so every label is a round number at an even spacing.
  const vals = pts.map(p => p[field]!)
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const st = hi - lo > 12 ? 5 : hi - lo > 5 ? 2 : 1
  const yt: number[] = []
  for (let v = Math.floor((lo - 0.3) / st) * st; v <= Math.ceil((hi + 0.3) / st) * st; v += st) yt.push(v)
  return (
    <div className="trn-mchart">
      <ResponsiveContainer width="100%" height={110}>
        <LineChart data={pts} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke="rgb(var(--k-fg) / .05)" />
          <XAxis dataKey="date" tick={tick} axisLine={false} tickLine={false} tickFormatter={fmtShort} minTickGap={28} />
          <YAxis tick={tick} axisLine={false} tickLine={false} domain={[yt[0], yt[yt.length - 1]]} ticks={yt} tickFormatter={v => String(v)} width={44} />
          <Tooltip {...chartTip} labelFormatter={l => fmtDay(String(l))} formatter={(v: any) => [`${v}${unit}`, label]} />
          <Line type="linear" dataKey={field} stroke="var(--k-ink2)" strokeWidth={1.8} dot={pts.length <= 24 ? { r: 2.5, fill: 'var(--k-ink2)', strokeWidth: 0 } : false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function BodyEdit({ row, onDone }: { row: BodyMetric; onDone: () => void }) {
  const upd = useUpdateBody()
  const [date, setDate] = useState(row.date)
  const [w, setW] = useState(row.weightKg != null ? String(row.weightKg) : '')
  const [bf, setBf] = useState(row.bodyFatPct != null ? String(row.bodyFatPct) : '')
  const [notes, setNotes] = useState(row.notes ?? '')
  const [err, setErr] = useState<string | null>(null)
  const num = (s: string) => { const v = parseFloat(s.replace(',', '.')); return Number.isFinite(v) ? v : null }
  const save = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    upd.mutate({ id: row.id, date, weightKg: num(w), bodyFatPct: num(bf), notes: notes.trim() || null }, {
      onSuccess: onDone,
      onError: (x: any) => setErr(x?.response?.data?.error ?? 'Could not save that entry.'),
    })
  }
  return (
    <li className="trn-bedit">
      <form onSubmit={save} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onDone() } }}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Date" />
        <input className="num" inputMode="decimal" value={w} onChange={e => setW(e.target.value)} placeholder="kg" aria-label="Weight in kg" autoFocus />
        <input className="num" inputMode="decimal" value={bf} onChange={e => setBf(e.target.value)} placeholder="BF %" aria-label="Body fat percent" />
        <input className="nt" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Note" aria-label="Note" />
        <button type="submit" className="wh-chase" disabled={upd.isPending}>Save</button>
        <button type="button" className="wh-chase" onClick={onDone}>Cancel</button>
      </form>
      {err && <p className="err">{err}</p>}
    </li>
  )
}

// ─── Start a workout: one tap ────────────────────────────────────────────────

/** One click: keeps a workout's shape as a template, or refreshes the template of the same name. */
export function SaveAsTemplate({ data, name, category, exercises }: { data: TrainingView; name: string; category: string; exercises: Template['exercises'] }) {
  const save = useSaveTemplate()
  const [done, setDone] = useState(false)
  const existing = data.templates.find(t => t.name.trim().toLowerCase() === name.trim().toLowerCase())
  const ok = name.trim() && exercises.some(e => e.exerciseName.trim())
  if (done) return <span className="trn-saved">{existing ? 'Template updated' : 'Saved as a template'}</span>
  return (
    <button type="button" className="wh-chase" disabled={!ok || save.isPending}
      title={!ok ? 'Needs a name and at least one exercise' : undefined}
      onClick={() => save.mutate({ id: existing?.id, name: name.trim(), category, exercises }, { onSuccess: () => setDone(true) })}>
      {existing ? `Update template "${existing.name}"` : 'Save as template'}
    </button>
  )
}

// ─── RPE: one tap, tap again to clear ────────────────────────────────────────

/** Effort on the RPE scale: 1 is easy, 10 is nothing left in the tank. Tap again to clear. */
function RpePick({ value, onChange, label, title = 'Effort' }: { value: number | null; onChange: (v: number | null) => void; label: string; title?: string }) {
  return (
    <div className="trn-rpe" role="group" aria-label={`${label}, 1 easy to 10 nothing left`} title="RPE: 1 is easy, 10 is nothing left in the tank">
      <span>{title}</span>
      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
        <button key={n} type="button" className={value === n ? 'on' : ''} aria-pressed={value === n} aria-label={`${label} ${n}`} onClick={() => onChange(value === n ? null : n)}>{n}</button>
      ))}
    </div>
  )
}

// ─── Length: type any number of minutes; quick picks include last time ──────

function Length({ value, onChange, last }: { value: number | null; onChange: (v: number | null) => void; last: number | null }) {
  const picks = [...new Set([...(last ? [last] : []), 30, 45, 60, 90])]
  return (
    <div className="trn-len">
      <label>Length
        <input className="num" type="number" inputMode="numeric" min={1} max={600} value={value ?? ''} placeholder="min"
          onChange={e => { const n = Math.round(Number(e.target.value)); onChange(e.target.value && n > 0 ? Math.min(600, n) : null) }}
          aria-label="Length in minutes" />
        <span className="u">min</span>
      </label>
      <div className="trn-lenpicks" role="group" aria-label="Quick lengths">
        {picks.map(m => (
          <button key={m} type="button" className={value === m ? 'on' : ''} aria-pressed={value === m} onClick={() => onChange(value === m ? null : m)}>
            {m === last ? `${m} last time` : m}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── The logger: last time pre-filled, one tap per set ───────────────────────

type Ex = LogExercise & { key: string; skip: boolean; touched: boolean[] }

// ─── Draft: an unsaved workout survives closing the sheet ───────────────────
// One draft at a time, kept in this browser for 18 hours. It is a convenience
// only; nothing is saved to the database until Save.
const DRAFT_KEY = 'arete.trainingDraft'
const DRAFT_HOURS = 18
type DraftState = { name: string; category: string; date: string; mins: number | null; rpe: number | null; notes: string; ex: Ex[]; step: number | null }
type Draft = { key: string; at: number; state: DraftState }
const readDraft = (key: string): Draft | null => {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null
    return d && d.key === key && Date.now() - d.at < DRAFT_HOURS * 36e5 ? d : null
  } catch { return null }
}
/** When there is an unsaved draft for this start (a template name, or '' for an empty workout), when it was last changed. */
export const draftTime = (template: string): number | null => readDraft(`new:${template}`)?.at ?? null
const writeDraft = (d: Draft | null) => { try { if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else localStorage.removeItem(DRAFT_KEY) } catch { /* storage blocked: no draft */ } }

export function Logger({ data, init, onClose }: { data: TrainingView; init: LogInit; onClose: () => void }) {
  const log = useLogWorkout()
  const edit = 'edit' in init ? init.edit : null
  const tpl = 'template' in init ? data.templates.find(t => t.name === init.template) : undefined
  const draftKey = edit ? `edit:${edit.id}` : `new:${'template' in init ? init.template : ''}`
  // Length starts from the last time this workout was done; a new one starts blank. Any number can be typed.
  const lastMins = data.recent.find(r => r.name === (edit?.name ?? tpl?.name) && r.durationMinutes)?.durationMinutes ?? null
  const fresh = (): DraftState => ({
    name: edit?.name ?? tpl?.name ?? ('template' in init && init.template !== 'Workout' ? init.template : ''),
    category: edit?.category ?? tpl?.category ?? 'strength',
    date: edit?.date ?? data.today,
    mins: edit ? edit.durationMinutes : lastMins,
    rpe: edit?.rpe ?? null,
    notes: edit?.notes ?? '',
    step: null,
    ex: edit
      ? edit.exercises.map((e, i) => {
        const sets = (e.reps ?? []).map((r, j) => ({ reps: r, weight: (e.weight ?? [])[j] ?? 0 }))
        return { name: e.exerciseName, sets, rpe: e.rpe, key: `e${i}`, skip: false, touched: sets.map(() => true) }
      })
      : (tpl?.exercises ?? []).map((e, i) => {
        const sets = startingSets(data, e.exerciseName, e.defaultSets)
        return { name: e.exerciseName, sets, rpe: null, key: `${i}`, skip: false, touched: sets.map(() => false) }
      }),
  })
  const [restored, setRestored] = useState<number | null>(() => readDraft(draftKey)?.at ?? null)
  const [st, setSt] = useState<DraftState>(() => readDraft(draftKey)?.state ?? fresh())
  const initial = useRef(JSON.stringify(st))
  const { name, category, date, mins, rpe, notes, ex, step } = st
  const set = <K extends keyof DraftState>(k: K) => (v: DraftState[K]) => setSt(s => ({ ...s, [k]: v }))
  const setName = set('name'), setCategory = set('category'), setDate = set('date'), setMins = set('mins'), setRpe = set('rpe'), setNotes = set('notes'), setStep = set('step')
  const setEx = (f: (xs: Ex[]) => Ex[]) => setSt(s => ({ ...s, ex: f(s.ex) }))
  const [adding, setAdding] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [unticked, setUnticked] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const dirty = JSON.stringify(st) !== initial.current || restored != null

  // Every change is kept as a draft, so closing the sheet mid-workout loses nothing.
  useEffect(() => { if (JSON.stringify(st) !== initial.current) writeDraft({ key: draftKey, at: Date.now(), state: st }) }, [st, draftKey])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    if (!name) nameRef.current?.focus()
    return () => window.removeEventListener('keydown', esc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  const known = useMemo(() => Object.keys(data.last).sort(), [data.last])
  const patch = (k: string, f: (e: Ex) => Ex) => setEx(xs => xs.map(e => (e.key === k ? f(e) : e)))
  const setAt = (k: string, i: number, p: Partial<{ reps: number; weight: number }>) =>
    patch(k, e => ({ ...e, sets: e.sets.map((s, j) => (j === i ? { ...s, ...p } : s)), touched: e.touched.map((t, j) => (j === i ? true : t)) }))
  const mark = (k: string, i: number) => patch(k, e => ({ ...e, touched: e.touched.map((t, j) => (j === i ? !t : t)) }))
  const addEx = (n0: string) => {
    const n = n0.trim(); if (!n) return
    const sets = startingSets(data, n, 3)
    setEx(xs => [...xs, { name: n, sets, rpe: null, key: `a${xs.length}${Date.now()}`, skip: false, touched: sets.map(() => false) }]); setAdding('')
  }
  const startOver = () => { writeDraft(null); const f = fresh(); initial.current = JSON.stringify(f); setSt(f); setRestored(null); setUnticked(false) }

  // New bests this session, worked out live: a top set heavier than the best so far (or the same weight for more reps).
  const bests = ex.filter(e => !e.skip).map(e => {
    const best = data.progress.find(l => l.name === e.name)?.best
    const now = topOf(e.sets.map(s => s.reps), e.sets.map(s => s.weight))
    return best && now && beats(now, best) && !(edit && edit.date <= best.date) ? `${e.name} (${setText(now)})` : null
  }).filter(Boolean)

  const kept = ex.filter(e => !e.skip)
  // Sets still showing last time's numbers that were never ticked or changed. They are
  // not saved as done without asking: an unticked set is not a set you did.
  const openSets = edit ? 0 : kept.reduce((n, e) => n + e.sets.filter((s, i) => s.reps > 0 && !e.touched[i]).length, 0)
  const save = (mode?: 'all' | 'ticked') => {
    setErr(null)
    if (!name.trim()) { setErr('Give the workout a name.'); setStep(null); setTimeout(() => nameRef.current?.focus()); return }
    if (openSets > 0 && !mode) { setUnticked(true); return }
    const exercises = mode === 'ticked' ? kept.map(e => ({ ...e, sets: e.sets.filter((_, i) => e.touched[i]) })) : kept
    log.mutate({ id: edit?.id, date, name: name.trim(), category, durationMinutes: mins, rpe, notes, exercises }, {
      onSuccess: () => { writeDraft(null); onClose() },
      onError: (e: any) => setErr(e?.response?.data?.error ?? 'Could not save the workout.'),
    })
  }

  const renderEx = (e: Ex, big = false) => {
    const last = data.last[e.name]
    return (
      <div key={e.key} className={`exr ${e.skip ? 'skip' : ''}`}>
        <div className="eh">
          <b>{e.name}</b>
          {last && !edit && <span className="wh-sub">Last {fmtDay(last.date)}: {last.reps.map((r, i) => setLabel({ reps: r, weight: last.weight[i] ?? 0 })).join(' · ')}</span>}
          {last && !edit && <span className="beat" title="One more rep on your heaviest set. At 10 reps, the next weight you have used on it (or 2.5 kg more) for 2 fewer reps.">Aim: {last.target}</span>}
          <button className="lnk" onClick={() => patch(e.key, x => ({ ...x, skip: !x.skip }))}>{e.skip ? 'Include' : edit ? 'Remove' : 'Skip'}</button>
        </div>
        {!e.skip && (
          <div className="sets">
            {e.sets.map((s, i) => (
              <div key={i} className={`set ${e.touched[i] ? 'ok' : ''}`}>
                <span className="i num">{i + 1}</span>
                <button className="chk" onClick={() => mark(e.key, i)} aria-pressed={e.touched[i]} aria-label={`Set ${i + 1} done as shown`}>✓</button>
                <input className="num" type="number" step={0.5} min={0} value={s.weight} onChange={v => setAt(e.key, i, { weight: Number(v.target.value) })} aria-label="Weight in kg" /><span className="u">kg</span>
                <input className="num" type="number" min={0} value={s.reps} onChange={v => setAt(e.key, i, { reps: Number(v.target.value) })} aria-label="Reps" /><span className="u">reps</span>
                <button className="nudge" onClick={() => setAt(e.key, i, { reps: s.reps + 1 })}>+1 rep</button>
                <button className="nudge" onClick={() => setAt(e.key, i, { weight: s.weight + 2.5 })}>+2.5 kg</button>
                <button className="x" onClick={() => patch(e.key, x => ({ ...x, sets: x.sets.filter((_, j) => j !== i), touched: x.touched.filter((_, j) => j !== i) }))} aria-label="Remove set">×</button>
              </div>
            ))}
            <div className="trn-exfoot">
              <button className="lnk" onClick={() => patch(e.key, x => ({ ...x, sets: [...x.sets, { ...(x.sets[x.sets.length - 1] ?? { reps: 0, weight: 0 }) }], touched: [...x.touched, false] }))}>+ set</button>
              {!big && <RpePick value={e.rpe ?? null} onChange={v => patch(e.key, x => ({ ...x, rpe: v }))} label={`Effort for ${e.name}`} />}
            </div>
          </div>
        )}
      </div>
    )
  }

  // One at a time: each exercise on its own, then a closing step with length, effort and notes.
  const stepping = step != null && !edit
  const atEnd = stepping && step! >= ex.length
  const cur = stepping && !atEnd ? ex[step!] : null
  const doneSets = (e: Ex) => e.touched.filter(Boolean).length

  return (
    <div className="wh-sheet-bg" onMouseDown={onClose}>
      <div className={`wh wh-sheet wh-logger trn-logger ${stepping ? 'step' : ''}`} role="dialog" aria-label={edit ? `Edit ${edit.name}` : 'Log a workout'} onMouseDown={e => e.stopPropagation()}>
        <div className="hd">
          <div className="trn-namewrap">
            <input ref={nameRef} className="trn-name" value={name} onChange={e => setName(e.target.value)} placeholder="Name it, e.g. 5K run" aria-label="Workout name" />
            <div className="wh-sub">{edit ? `Editing the workout from ${fmtDay(edit.date)}.` : 'Sets start from last time. Tick ✓ when a set matched, or change the numbers.'}</div>
          </div>
          {!edit && ex.length > 0 && (
            <button className="wh-chase" onClick={() => setStep(stepping ? null : 0)} aria-pressed={stepping}>{stepping ? 'All exercises' : 'One at a time'}</button>
          )}
          <button className="wh-chase" onClick={onClose} title={dirty ? 'Your sets stay as a draft until you save or start over' : undefined}>Close</button>
        </div>
        {restored != null && (
          <p className="trn-draft">Picked up your unsaved workout from {new Date(restored).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. <button className="lnk" onClick={startOver}>Start over</button></p>
        )}

        {!stepping && (
          <>
            <div className="chips trn-cats" role="group" aria-label="Category">
              {CATEGORIES.map(c => (
                <button key={c.value} type="button" className={category === c.value ? 'on' : ''} aria-pressed={category === c.value} onClick={() => setCategory(c.value)}>
                  <i className="trn-dot" style={{ background: c.color }} />{c.label}
                </button>
              ))}
            </div>
            <div className="meta">
              <label>Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
              <Length value={mins} onChange={setMins} last={lastMins} />
              <RpePick value={rpe} onChange={setRpe} label="Overall effort" title="Overall effort" />
            </div>
            {ex.map(e => renderEx(e))}
          </>
        )}

        {stepping && (
          <>
            <div className="trn-steps" role="list" aria-label="Exercises">
              {ex.map((e, i) => (
                <button key={e.key} role="listitem" className={`${i === step ? 'on' : ''} ${e.skip ? 'skip' : doneSets(e) === e.sets.length && e.sets.length ? 'done' : ''}`} onClick={() => setStep(i)} aria-current={i === step} title={e.name}>
                  <i aria-hidden />
                </button>
              ))}
              <button role="listitem" className={atEnd ? 'on' : ''} onClick={() => setStep(ex.length)} aria-current={atEnd} title="Finish"><i aria-hidden /></button>
              <span className="c num">{atEnd ? 'Finish' : `${step! + 1} of ${ex.length}`}</span>
            </div>
            {cur && renderEx(cur, true)}
            {cur && (
              <div className="trn-stepnav">
                <button className="wh-chase" disabled={step === 0} onClick={() => setStep(step! - 1)}>Previous</button>
                <button className="wh-btn" onClick={() => setStep(step! + 1)}>{step! + 1 < ex.length ? `Next: ${ex[step! + 1].name}` : 'Finish'}</button>
              </div>
            )}
            {atEnd && (
              <div className="meta trn-finish">
                <label>Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
                <Length value={mins} onChange={setMins} last={lastMins} />
                <RpePick value={rpe} onChange={setRpe} label="Overall effort" title="How hard was it overall" />
              </div>
            )}
          </>
        )}

        {(!stepping || atEnd) && (
          <>
            <form className="add" onSubmit={e => { e.preventDefault(); addEx(adding) }}>
              <input list="wh-known-lifts" value={adding} onChange={e => setAdding(e.target.value)} placeholder="Add an exercise and press Enter" aria-label="Add exercise" />
              <datalist id="wh-known-lifts">{known.map(k => <option key={k} value={k} />)}</datalist>
            </form>
            <textarea className="trn-notesin" value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes: how it felt, anything to remember" aria-label="Workout notes" />
          </>
        )}

        {(!stepping || atEnd) && (
          <div className="foot">
            {bests.length > 0 && <span className="pr">New best on {bests.join(', ')}</span>}
            {err && <span style={{ color: 'var(--k-bad)', fontSize: 13 }}>{err}</span>}
            {unticked && openSets > 0 ? (
              <span className="trn-unticked">
                <span>{openSets} {openSets === 1 ? 'set is' : 'sets are'} not ticked.</span>
                <button className="wh-chase" onClick={() => save('ticked')} disabled={log.isPending}>Leave them out</button>
                <button className="wh-btn" onClick={() => save('all')} disabled={log.isPending}>Save all as done</button>
              </span>
            ) : (
              <>
                <SaveAsTemplate data={data} name={name} category={category} exercises={kept.map(e => ({ exerciseName: e.name, defaultSets: Math.max(1, e.sets.length) }))} />
                <button className="wh-btn" disabled={log.isPending} onClick={() => save()}>{edit ? 'Save changes' : 'Save workout'}</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Templates: create, edit in place, delete ────────────────────────────────

export function Templates({ data, onClose }: { data: TrainingView; onClose: () => void }) {
  const [open, setOpen] = useState<number | 'new' | null>(data.templates.length ? null : 'new')
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="wh-sheet-bg" onMouseDown={onClose}>
      <div className="wh wh-sheet trn-tsheet" role="dialog" aria-label="Workout templates" onMouseDown={e => e.stopPropagation()}>
        <div className="hd">
          <div>
            <div className="wh-h" style={{ fontSize: 19 }}>Workout templates</div>
            <div className="wh-sub">{data.templates.length ? `${data.templates.length} template${data.templates.length === 1 ? '' : 's'}. Click one to change it.` : 'No templates yet. Make your first one below.'}</div>
          </div>
          <button className="wh-chase" onClick={onClose}>Close</button>
        </div>
        <div className="trn-tlist">
          {data.templates.map(t => open === t.id
            ? <TemplateEdit key={t.id} data={data} tpl={t} onDone={() => setOpen(null)} />
            : (
              <button key={t.id} className="trn-trow" onClick={() => setOpen(t.id)} aria-label={`Edit template ${t.name}`}>
                <span className="n"><i className="trn-dot" style={{ background: catMeta(t.category).color }} />{t.name}</span>
                <span className="wh-sub">{catMeta(t.category).label} · {t.exercises.length} exercises · {t.exercises.reduce((s, e) => s + (e.defaultSets ?? 0), 0)} sets</span>
              </button>
            ))}
          {open === 'new'
            ? <TemplateEdit data={data} onDone={() => setOpen(null)} />
            : <button className="wh-addrow" onClick={() => setOpen('new')}><Plus size={13} aria-hidden />New template</button>}
        </div>
      </div>
    </div>
  )
}

function TemplateEdit({ data, tpl, onDone }: { data: TrainingView; tpl?: Template; onDone: () => void }) {
  const save = useSaveTemplate()
  const del = useDeleteTemplate()
  const [name, setName] = useState(tpl?.name ?? '')
  const [category, setCategory] = useState(tpl?.category ?? 'strength')
  const [rows, setRows] = useState(tpl?.exercises.map(e => ({ ...e })) ?? [])
  const [adding, setAdding] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const known = useMemo(() => Object.keys(data.last).sort(), [data.last])
  const add = () => { const n = adding.trim(); if (!n) return; setRows(r => [...r, { exerciseName: n, defaultSets: 3 }]); setAdding('') }
  const submit = () => {
    setErr(null)
    if (!name.trim()) { setErr('Give the template a name.'); return }
    const pending = adding.trim() ? [...rows, { exerciseName: adding.trim(), defaultSets: 3 }] : rows
    save.mutate({ id: tpl?.id, name, category, exercises: pending }, {
      onSuccess: onDone,
      onError: (e: any) => setErr(e?.response?.data?.error ?? 'Could not save the template.'),
    })
  }
  return (
    <div className="trn-tedit" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onDone() } }}>
      <input className="in" value={name} onChange={e => setName(e.target.value)} placeholder="Template name, e.g. Push Day A" aria-label="Template name" autoFocus={!tpl} />
      <div className="chips" role="group" aria-label="Category">
        {CATEGORIES.map(c => (
          <button key={c.value} type="button" className={category === c.value ? 'on' : ''} aria-pressed={category === c.value} onClick={() => setCategory(c.value)}>
            <i className="trn-dot" style={{ background: c.color }} />{c.label}
          </button>
        ))}
      </div>
      <div className="trn-terows">
        {rows.map((r, i) => (
          <div key={i} className="r">
            <input value={r.exerciseName} onChange={e => setRows(rs => rs.map((x, j) => (j === i ? { ...x, exerciseName: e.target.value } : x)))} aria-label={`Exercise ${i + 1}`} />
            <div className="st">
              <button type="button" onClick={() => setRows(rs => rs.map((x, j) => (j === i ? { ...x, defaultSets: Math.max(1, x.defaultSets - 1) } : x)))} aria-label={`One set fewer for ${r.exerciseName}`}>−</button>
              <b className="num">{r.defaultSets}</b><span>sets</span>
              <button type="button" onClick={() => setRows(rs => rs.map((x, j) => (j === i ? { ...x, defaultSets: Math.min(20, x.defaultSets + 1) } : x)))} aria-label={`One set more for ${r.exerciseName}`}>+</button>
            </div>
            <button type="button" className="x" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} aria-label={`Remove ${r.exerciseName}`}>×</button>
          </div>
        ))}
        <form onSubmit={e => { e.preventDefault(); add() }}>
          <input className="in" list="wh-tpl-lifts" value={adding} onChange={e => setAdding(e.target.value)} placeholder="Add an exercise and press Enter" aria-label="Add exercise to template" />
          <datalist id="wh-tpl-lifts">{known.map(k => <option key={k} value={k} />)}</datalist>
        </form>
      </div>
      <div className="trn-tfoot">
        {tpl && (confirm
          ? <span className="del"><span>Delete this template?</span><button onClick={() => setConfirm(false)}>Keep</button><button className="bad" onClick={() => del.mutate(tpl.id, { onSuccess: onDone })}>Delete</button></span>
          : <button className="wh-chase trn-delbtn" onClick={() => setConfirm(true)}>Delete template</button>)}
        {err && <span style={{ color: 'var(--k-bad)', fontSize: 13 }}>{err}</span>}
        <button className="wh-chase" onClick={onDone}>Cancel</button>
        <button className="wh-btn" onClick={submit} disabled={save.isPending}>{tpl ? 'Save template' : 'Create template'}</button>
      </div>
    </div>
  )
}
