import { useEffect, useMemo, useRef, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CATEGORIES, catMeta, setLabel, startingSets, useDeleteTemplate, useLogWorkout, useSaveTemplate, useUpdateBody, type BodyMetric, type LogExercise, type Template, type TrainingView, type Workout } from '../../core/training'
import './training.css'

const e1 = (w: number, r: number) => (w > 0 && r > 0 && r <= 12 ? w * (1 + r / 30) : 0)
const fmtDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const fmtShort = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
/** What the logger opens with: a template by name, or an existing workout to edit. */
export type LogInit = { template: string } | { edit: Workout }

const chartTip = {
  contentStyle: { background: 'var(--k-card2)', border: '1px solid var(--k-line2)', borderRadius: 12, fontSize: 12.5, padding: '6px 10px' },
  labelStyle: { color: 'var(--k-mute)', marginBottom: 2 },
  itemStyle: { color: 'var(--k-ink)', padding: 0 },
}
/** A y-axis range padded to round steps, so the ticks read as plain numbers. */
const niceDomain = (vals: number[], step: number): [number, number] => {
  const lo = Math.min(...vals), hi = Math.max(...vals)
  return [Math.max(0, Math.floor((lo - step / 2) / step) * step), Math.ceil((hi + step / 2) / step) * step]
}
const tick = { fill: 'var(--k-faint)', fontSize: 11, fontFamily: 'var(--k-font)' }

export function MetricChart({ rows, field, unit, label }: { rows: BodyMetric[]; field: 'weightKg' | 'bodyFatPct'; unit: string; label: string }) {
  const pts = rows.filter(r => r[field] != null)
  return (
    <div className="trn-mchart">
      <ResponsiveContainer width="100%" height={110}>
        <LineChart data={pts} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke="rgb(var(--k-fg) / .05)" />
          <XAxis dataKey="date" tick={tick} axisLine={false} tickLine={false} tickFormatter={fmtShort} minTickGap={28} />
          <YAxis tick={tick} axisLine={false} tickLine={false} domain={niceDomain(pts.map(p => p[field]!), 1)} tickFormatter={v => String(Math.round(v))} width={44} />
          <Tooltip {...chartTip} labelFormatter={l => fmtDay(String(l))} formatter={(v: any) => [`${v}${unit}`, label]} />
          <Line type="monotone" dataKey={field} stroke="var(--k-ink2)" strokeWidth={1.8} dot={pts.length <= 24 ? { r: 2.5, fill: 'var(--k-ink2)', strokeWidth: 0 } : false} activeDot={{ r: 4 }} isAnimationActive={false} />
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

function RpePick({ value, onChange, label, title = 'RPE' }: { value: number | null; onChange: (v: number | null) => void; label: string; title?: string }) {
  return (
    <div className="trn-rpe" role="group" aria-label={label}>
      <span>{title}</span>
      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
        <button key={n} type="button" className={value === n ? 'on' : ''} aria-pressed={value === n} aria-label={`${label} ${n}`} onClick={() => onChange(value === n ? null : n)}>{n}</button>
      ))}
    </div>
  )
}

// ─── The logger: last time pre-filled, one tap per set ───────────────────────

type Ex = LogExercise & { key: string; skip: boolean; touched: boolean[] }

export function Logger({ data, init, onClose }: { data: TrainingView; init: LogInit; onClose: () => void }) {
  const log = useLogWorkout()
  const edit = 'edit' in init ? init.edit : null
  const tpl = 'template' in init ? data.templates.find(t => t.name === init.template) : undefined
  const [name, setName] = useState(edit?.name ?? tpl?.name ?? ('template' in init && init.template !== 'Workout' ? init.template : ''))
  const [category, setCategory] = useState(edit?.category ?? tpl?.category ?? 'strength')
  const [date, setDate] = useState(edit?.date ?? data.today)
  const [mins, setMins] = useState<number | null>(edit ? edit.durationMinutes : 60)
  const [rpe, setRpe] = useState<number | null>(edit?.rpe ?? null)
  const [notes, setNotes] = useState(edit?.notes ?? '')
  const [adding, setAdding] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [ex, setEx] = useState<Ex[]>(() => edit
    ? edit.exercises.map((e, i) => {
      const sets = (e.reps ?? []).map((r, j) => ({ reps: r, weight: (e.weight ?? [])[j] ?? 0 }))
      return { name: e.exerciseName, sets, rpe: e.rpe, key: `e${i}`, skip: false, touched: sets.map(() => true) }
    })
    : (tpl?.exercises ?? []).map((e, i) => {
      const sets = startingSets(data, e.exerciseName, e.defaultSets)
      return { name: e.exerciseName, sets, rpe: null, key: `${i}`, skip: false, touched: sets.map(() => false) }
    }))

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

  // New bests this session, worked out live (against history before this workout).
  const bests = ex.filter(e => !e.skip).map(e => {
    const best = data.progress.find(l => l.name === e.name)?.best.e1rm ?? 0
    const now = Math.max(0, ...e.sets.map(s => e1(s.weight, s.reps)))
    return now > best && best > 0 ? e.name : null
  }).filter(Boolean)

  const kept = ex.filter(e => !e.skip)
  const save = () => {
    setErr(null)
    if (!name.trim()) { setErr('Give the workout a name.'); nameRef.current?.focus(); return }
    log.mutate({ id: edit?.id, date, name: name.trim(), category, durationMinutes: mins, rpe, notes, exercises: kept }, {
      onSuccess: onClose,
      onError: (e: any) => setErr(e?.response?.data?.error ?? 'Could not save the workout.'),
    })
  }
  const minsOptions = [...new Set([30, 45, 60, 75, 90, 120, ...(mins ? [mins] : [])])].sort((a, b) => a - b)

  return (
    <div className="wh-sheet-bg" onMouseDown={onClose}>
      <div className="wh wh-sheet wh-logger trn-logger" role="dialog" aria-label={edit ? `Edit ${edit.name}` : 'Log a workout'} onMouseDown={e => e.stopPropagation()}>
        <div className="hd">
          <div className="trn-namewrap">
            <input ref={nameRef} className="trn-name" value={name} onChange={e => setName(e.target.value)} placeholder="Name it, e.g. 5K run" aria-label="Workout name" />
            <div className="wh-sub">{edit ? `Editing the workout from ${fmtDay(edit.date)}.` : 'Sets start from last time. ✓ when it matched, or change the numbers.'}</div>
          </div>
          <button className="wh-chase" onClick={onClose}>Close</button>
        </div>
        <div className="chips trn-cats" role="group" aria-label="Category">
          {CATEGORIES.map(c => (
            <button key={c.value} type="button" className={category === c.value ? 'on' : ''} aria-pressed={category === c.value} onClick={() => setCategory(c.value)}>
              <i className="trn-dot" style={{ background: c.color }} />{c.label}
            </button>
          ))}
        </div>
        <div className="meta">
          <label>Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label>Length
            <select value={mins ?? ''} onChange={e => setMins(e.target.value ? Number(e.target.value) : null)}>
              <option value="">not set</option>{minsOptions.map(m => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
          <RpePick value={rpe} onChange={setRpe} label="Overall RPE" title="Overall RPE" />
        </div>

        {ex.map(e => {
          const last = data.last[e.name]
          return (
            <div key={e.key} className={`exr ${e.skip ? 'skip' : ''}`}>
              <div className="eh">
                <b>{e.name}</b>
                {last && !edit && <span className="wh-sub">Last {fmtDay(last.date)}: {last.reps.map((r, i) => setLabel({ reps: r, weight: last.weight[i] ?? 0 })).join(' · ')}</span>}
                {last && !edit && <span className="beat">Beat it: {last.target}</span>}
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
                    <RpePick value={e.rpe ?? null} onChange={v => patch(e.key, x => ({ ...x, rpe: v }))} label={`RPE for ${e.name}`} />
                  </div>
                </div>
              )}
            </div>
          )
        })}

        <form className="add" onSubmit={e => { e.preventDefault(); addEx(adding) }}>
          <input list="wh-known-lifts" value={adding} onChange={e => setAdding(e.target.value)} placeholder="Add an exercise and press Enter" aria-label="Add exercise" />
          <datalist id="wh-known-lifts">{known.map(k => <option key={k} value={k} />)}</datalist>
        </form>

        <textarea className="trn-notesin" value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes: how it felt, anything to remember" aria-label="Workout notes" />

        <div className="foot">
          {bests.length > 0 && <span className="pr">New best on {bests.join(', ')}</span>}
          {err && <span style={{ color: 'var(--k-bad)', fontSize: 13 }}>{err}</span>}
          <SaveAsTemplate data={data} name={name} category={category} exercises={kept.map(e => ({ exerciseName: e.name, defaultSets: Math.max(1, e.sets.length) }))} />
          <button className="wh-btn" disabled={log.isPending} onClick={save}>{edit ? 'Save changes' : 'Save workout'}</button>
        </div>
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
            : <button className="wh-addrow" onClick={() => setOpen('new')}>+ New template</button>}
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
