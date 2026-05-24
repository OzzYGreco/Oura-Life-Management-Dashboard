import { useState, useMemo } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import {
  useWorkouts, useBodyMetrics,
  useCreateWorkout, useUpdateWorkout, useDeleteWorkout,
  useCreateMetric, useUpdateMetric, useDeleteMetric,
  useWorkoutTemplates, useCreateTemplate, useUpdateTemplate, useDeleteTemplate,
} from '../../hooks/useTraining'
import { PageShell } from '../../components/layout/PageShell'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Textarea } from '../../components/ui/Textarea'
import { Button } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { StatCard } from '../../components/ui/StatCard'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageLoader } from '../../components/ui/Spinner'
import { formatDate, today } from '../../lib/utils'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  Plus, Trash2, Dumbbell, Pencil, ChevronDown, ChevronUp,
  Flame, Trophy, Activity, Clock, TrendingUp, LayoutTemplate,
} from 'lucide-react'

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES: { value: string; label: string; color: string }[] = [
  { value: 'strength',  label: 'Strength',  color: '#818cf8' },
  { value: 'cardio',    label: 'Cardio',    color: '#22d3ee' },
  { value: 'sport',     label: 'Sport',     color: '#fbbf24' },
  { value: 'hiit',      label: 'HIIT',      color: '#f87171' },
  { value: 'mobility',  label: 'Mobility',  color: '#34d399' },
]

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'workouts',   label: 'Workouts' },
  { id: 'templates',  label: 'Templates' },
  { id: 'progress',   label: 'Progress' },
]

function catMeta(v: string) {
  return CATEGORIES.find(c => c.value === v) ?? { label: v, color: '#8b8baa' }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Total volume (kg) for one workout: sum(sets × avg_reps × avg_weight) */
function workoutVolume(w: any): number {
  if (!w.exercises?.length) return 0
  return w.exercises.reduce((sum: number, e: any) => {
    const avgReps   = Array.isArray(e.reps)   && e.reps.length   ? e.reps.reduce((a: number, b: number) => a + b, 0) / e.reps.length     : 0
    const avgWeight = Array.isArray(e.weight) && e.weight.length ? e.weight.reduce((a: number, b: number) => a + b, 0) / e.weight.length : 0
    return sum + (e.sets ?? 0) * avgReps * avgWeight
  }, 0)
}

/** ISO week start (Monday) for a date string */
function weekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay() // 0=Sun
  const diff = (day === 0 ? -6 : 1) - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

/** Current streak of consecutive training days (today counts if trained) */
function computeStreak(workouts: any[]): number {
  if (!workouts.length) return 0
  const days = [...new Set(workouts.map((w: any) => w.date))].sort().reverse()
  const todayStr = today()
  let streak = 0
  let cursor = days[0] === todayStr ? todayStr : null
  if (!cursor) return 0
  for (const d of days) {
    if (d === cursor) {
      streak++
      const prev = new Date(cursor + 'T00:00:00')
      prev.setDate(prev.getDate() - 1)
      cursor = prev.toISOString().split('T')[0]
    } else break
  }
  return streak
}

/** Last 8 ISO-week buckets */
function last8Weeks(): { key: string; label: string }[] {
  const result = []
  const now = new Date()
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i * 7)
    const ws = weekStart(d.toISOString().split('T')[0])
    const label = new Date(ws + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
    result.push({ key: ws, label })
  }
  return result
}

// ─── ExerciseBlock -- one exercise with per-set rows ───────────────────────────

function ExerciseBlock({ control, register, watch, index, onRemove, catColor }: {
  control: any; register: any; watch: any; index: number; onRemove: () => void; catColor: string
}) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `exercises.${index}.setRows` as any,
  })
  const rpe     = watch(`exercises.${index}.rpe`)
  const rpeCol  = Number(rpe) >= 9 ? '#f87171' : Number(rpe) >= 7 ? '#fbbf24' : '#34d399'
  const inputCls = 'min-w-0 w-full bg-bg-secondary border border-bg-border rounded-lg px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue transition-colors'

  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
      {/* Exercise header: name + RPE + remove */}
      <div className="flex items-center gap-2">
        <input {...register(`exercises.${index}.exerciseName`)} placeholder="Exercise name"
          className={`flex-1 ${inputCls}`} />
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">RPE</span>
          <input {...register(`exercises.${index}.rpe`)} type="number" min="1" max="10" placeholder="--"
            className="w-14 text-center num font-bold bg-bg-secondary border border-bg-border rounded-lg px-2 py-1.5 text-sm placeholder:text-text-muted outline-none focus:border-accent-blue transition-all"
            style={{ color: rpe ? rpeCol : undefined, borderColor: rpe ? rpeCol + '55' : undefined }} />
        </div>
        <button type="button" onClick={onRemove}
          className="text-text-muted hover:text-pnl-loss text-xl leading-none transition-colors flex-shrink-0 px-1">×</button>
      </div>

      {/* Set rows */}
      {fields.length > 0 && (
        <div className="space-y-1.5 pl-1">
          <div className="grid gap-2" style={{ gridTemplateColumns: '20px 1fr 1fr 20px' }}>
            {['#', 'Reps', 'kg', ''].map(h => (
              <span key={h} className="text-[10px] font-semibold uppercase tracking-wider text-text-muted text-center">{h}</span>
            ))}
          </div>
          {fields.map((set, si) => (
            <div key={set.id} className="grid gap-2 items-center" style={{ gridTemplateColumns: '20px 1fr 1fr 20px' }}>
              <span className="text-[11px] text-text-muted num text-center font-medium">{si + 1}</span>
              <input {...register(`exercises.${index}.setRows.${si}.reps`)} type="number" placeholder="8"
                className={`${inputCls} text-center num`} />
              <input {...register(`exercises.${index}.setRows.${si}.weight`)} type="number" step="any" placeholder="80"
                className={`${inputCls} text-center num`} />
              <button type="button" onClick={() => remove(si)}
                className="text-text-muted hover:text-pnl-loss text-base leading-none transition-colors text-center">×</button>
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={() => append({ reps: '', weight: '' })}
        className="text-[11px] font-medium pl-1 transition-colors"
        style={{ color: catColor }}>
        + Add set
      </button>
    </div>
  )
}

// ─── Workout Modal ────────────────────────────────────────────────────────────

function WorkoutModal({ entry, onClose }: { entry?: any; onClose: () => void }) {
  const create    = useCreateWorkout()
  const update    = useUpdateWorkout()
  const { data: templates = [] } = useWorkoutTemplates()
  const [showTemplatePicker, setShowTemplatePicker] = useState(!entry)

  const defaultExercise = () => ({ exerciseName: '', rpe: '', setRows: [{ reps: '', weight: '' }] })

  const { register, handleSubmit, control, watch, setValue, reset, formState: { errors } } = useForm({
    defaultValues: entry
      ? {
          ...entry,
          exercises: entry.exercises?.map((e: any) => ({
            exerciseName: e.exerciseName,
            rpe: e.rpe ? String(e.rpe) : '',
            setRows: Array.isArray(e.reps) && e.reps.length
              ? e.reps.map((r: number, i: number) => ({ reps: String(r), weight: String(e.weight?.[i] ?? '') }))
              : [{ reps: '', weight: '' }],
          })) ?? [defaultExercise()],
        }
      : {
          name: '', date: today(), category: 'strength',
          durationMinutes: '', notes: '',
          exercises: [defaultExercise()],
        },
  })

  const { fields, append, remove, replace } = useFieldArray({ control, name: 'exercises' })
  const watchedCategory = watch('category')
  const cm = catMeta(watchedCategory)

  /** Load a template: set name, category, and replace exercises with empty set rows */
  const loadTemplate = (tpl: any) => {
    if (!watch('name')) setValue('name', tpl.name)
    setValue('category', tpl.category)
    replace(
      (tpl.exercises as { exerciseName: string; defaultSets: number }[]).map(ex => ({
        exerciseName: ex.exerciseName,
        rpe: '',
        setRows: Array.from({ length: Math.max(ex.defaultSets ?? 1, 1) }, () => ({ reps: '', weight: '' })),
      }))
    )
    setShowTemplatePicker(false)
  }

  const onSubmit = async (data: any) => {
    const payload = {
      ...data,
      durationMinutes: data.durationMinutes ? parseInt(data.durationMinutes) : null,
      exercises: data.exercises
        .filter((e: any) => e.exerciseName)
        .map((e: any) => {
          const validSets = (e.setRows ?? []).filter((s: any) => s.reps || s.weight)
          return {
            exerciseName: e.exerciseName,
            sets:   validSets.length,
            reps:   validSets.map((s: any) => parseInt(s.reps)).filter((n: number) => !isNaN(n)),
            weight: validSets.map((s: any) => parseFloat(s.weight)).filter((n: number) => !isNaN(n)),
            rpe:    e.rpe ? parseInt(e.rpe) : null,
          }
        }),
    }
    if (entry) await update.mutateAsync({ id: entry.id, ...payload })
    else       await create.mutateAsync(payload)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={entry ? 'Edit Workout' : 'Log Workout'} size="lg">
      <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-4">

        {/* Name + Date + Duration */}
        <div className="grid grid-cols-3 gap-3">
          <Input label="Workout name" placeholder="Push Day, 5K Run…" {...register('name', { required: true })} />
          <Input label="Date" type="date" {...register('date')} />
          <Input label="Duration (min)" type="number" placeholder="60" {...register('durationMinutes')} />
        </div>
        {errors.name && <p className="text-xs text-pnl-loss -mt-2">Name is required</p>}

        {/* Category */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1.5">Category</label>
          <div className="flex gap-1.5 flex-wrap">
            {CATEGORIES.map(c => {
              const active = watchedCategory === c.value
              return (
                <button key={c.value} type="button"
                  onClick={() => setValue('category', c.value)}
                  className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: active ? c.color + '20' : 'var(--c-bg-input)',
                    border: `1px solid ${active ? c.color + '55' : 'var(--c-border-mid)'}`,
                    color: active ? c.color : 'rgba(139,139,170,0.8)',
                  }}>
                  {c.label}
                </button>
              )
            })}
          </div>
          <input type="hidden" {...register('category')} />
        </div>

        {/* Template picker -- only for new workouts */}
        {!entry && (templates as any[]).length > 0 && (
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
            <button
              type="button"
              onClick={() => setShowTemplatePicker(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 transition-colors text-left"
              style={{ background: showTemplatePicker ? 'rgba(129,140,248,0.08)' : 'var(--c-bg-input)' }}>
              <div className="flex items-center gap-2">
                <LayoutTemplate size={13} style={{ color: '#818cf8' }} />
                <span className="text-xs font-semibold text-text-secondary">Load a template</span>
              </div>
              <span className="text-[10px] text-text-muted">{showTemplatePicker ? '▲' : '▼'}</span>
            </button>
            {showTemplatePicker && (
              <div className="p-2 flex flex-wrap gap-1.5" style={{ borderTop: '1px solid var(--c-border-subtle)' }}>
                {(templates as any[]).map(tpl => {
                  const tm = catMeta(tpl.category)
                  return (
                    <button key={tpl.id} type="button" onClick={() => loadTemplate(tpl)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
                      style={{
                        background: tm.color + '15',
                        border: `1px solid ${tm.color}35`,
                        color: tm.color,
                      }}>
                      {tpl.name}
                      <span className="text-[10px] opacity-60">· {(tpl.exercises ?? []).length} ex</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Exercises */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Exercises</label>
            <button type="button" onClick={() => append(defaultExercise())}
              className="text-xs font-medium transition-colors" style={{ color: cm.color }}>
              + Add exercise
            </button>
          </div>
          <div className="space-y-2">
            {fields.map((field, i) => (
              <ExerciseBlock
                key={field.id}
                control={control}
                register={register}
                watch={watch}
                index={i}
                onRemove={() => remove(i)}
                catColor={cm.color}
              />
            ))}
          </div>
        </div>

        <Textarea label="Notes" rows={2} placeholder="How it felt, anything to remember…" {...register('notes')} />

        <div className="flex justify-end gap-2 pt-1 border-t border-bg-border">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">{entry ? 'Save Changes' : 'Log Workout'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ onLogWorkout }: { onLogWorkout: () => void }) {
  const { data: workouts = [], isPending } = useWorkouts()

  const allWorkouts = workouts as any[]

  // This week
  const thisWeek    = weekStart(today())
  const weekWorkouts = allWorkouts.filter(w => weekStart(w.date) === thisWeek)
  const weekVolume   = weekWorkouts.reduce((s: number, w: any) => s + workoutVolume(w), 0)
  const streak       = computeStreak(allWorkouts)
  const avgDuration  = allWorkouts.length
    ? Math.round(allWorkouts.filter(w => w.durationMinutes).reduce((s: number, w: any) => s + w.durationMinutes, 0) / allWorkouts.filter(w => w.durationMinutes).length)
    : 0

  // 8-week frequency chart
  const weeks      = last8Weeks()
  const chartData  = weeks.map(wk => {
    const wkWorkouts = allWorkouts.filter(w => weekStart(w.date) === wk.key)
    const byCategory: Record<string, number> = {}
    wkWorkouts.forEach(w => { byCategory[w.category] = (byCategory[w.category] ?? 0) + 1 })
    return { label: wk.label, total: wkWorkouts.length, ...byCategory }
  })

  // Personal records: max weight per exercise across all workouts
  const prMap: Record<string, { weight: number; date: string; workout: string }> = {}
  allWorkouts.forEach(w => {
    w.exercises?.forEach((e: any) => {
      if (!Array.isArray(e.weight) || !e.weight.length) return
      const max = Math.max(...e.weight)
      if (!prMap[e.exerciseName] || max > prMap[e.exerciseName].weight) {
        prMap[e.exerciseName] = { weight: max, date: w.date, workout: w.name }
      }
    })
  })
  const prs = Object.entries(prMap)
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, 8)

  // Recent workouts (last 5)
  const recent = [...allWorkouts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)

  if (isPending) return <PageLoader />

  return (
    <div className="p-6 space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="This Week" value={weekWorkouts.length} icon={<Dumbbell size={16} />}
          iconBg="rgba(129,140,248,0.12)" iconColor="#818cf8" accent="#818cf8"
          sub={`${weekWorkouts.length === 1 ? '1 session' : `${weekWorkouts.length} sessions`}`} />
        <StatCard label="Volume This Week" value={weekVolume > 0 ? `${(weekVolume / 1000).toFixed(1)}t` : '--'} icon={<TrendingUp size={16} />}
          iconBg="rgba(34,211,238,0.12)" iconColor="#22d3ee" accent="#22d3ee"
          sub={weekVolume > 0 ? `${Math.round(weekVolume).toLocaleString()} kg moved` : 'no weight data yet'} />
        <StatCard label="Current Streak" value={streak > 0 ? `${streak}d` : '--'} icon={<Flame size={16} />}
          iconBg="rgba(251,191,36,0.12)" iconColor="#fbbf24" accent="#fbbf24"
          sub={streak > 0 ? `${streak} day${streak > 1 ? 's' : ''} in a row` : 'start training to streak'} />
        <StatCard label="Avg Session" value={avgDuration > 0 ? `${avgDuration}m` : '--'} icon={<Clock size={16} />}
          iconBg="rgba(167,139,250,0.12)" iconColor="#a78bfa" accent="#a78bfa"
          sub={avgDuration > 0 ? 'per logged workout' : 'log duration to track'} />
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Frequency chart */}
        <div className="col-span-2 rounded-xl p-4" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
          <h3 className="text-sm font-semibold text-text-primary mb-4">Sessions per Week</h3>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barSize={28}>
                <CartesianGrid vertical={false} stroke="var(--c-chart-grid)" />
                <XAxis dataKey="label" tick={{ fill: '#8b8baa', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8b8baa', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--c-chart-tooltip-bg)', border: '1px solid var(--c-border-mid)', borderRadius: 8 }}
                  labelStyle={{ color: '#eeeef5', fontSize: 12 }}
                  itemStyle={{ fontSize: 11 }}
                />
                {CATEGORIES.map(c => (
                  <Bar key={c.value} dataKey={c.value} stackId="a" fill={c.color} name={c.label} radius={[0,0,0,0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 mt-2">
            {CATEGORIES.map(c => (
              <div key={c.value} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                <span className="text-[10px] text-text-muted">{c.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent workouts */}
        <div className="rounded-xl p-4" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-text-primary">Recent</h3>
            <button onClick={onLogWorkout}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #818cf8, #a78bfa)' }}>
              <Plus size={11} /> Log
            </button>
          </div>
          {recent.length === 0
            ? <p className="text-xs text-text-muted">No workouts yet</p>
            : (
              <div className="space-y-2">
                {recent.map(w => {
                  const cm  = catMeta(w.category)
                  const vol = workoutVolume(w)
                  return (
                    <div key={w.id} className="flex items-start justify-between py-1.5 border-b border-bg-border/40 last:border-0">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: cm.color }} />
                          <p className="text-xs font-medium text-text-primary truncate">{w.name}</p>
                        </div>
                        <p className="text-[11px] text-text-muted num">{formatDate(w.date)}{w.durationMinutes ? ` · ${w.durationMinutes}m` : ''}</p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        {(() => {
                          const peak = w.exercises?.length ? Math.max(...w.exercises.map((e: any) => e.rpe ?? 0)) : 0
                          const col  = peak >= 9 ? '#f87171' : peak >= 7 ? '#fbbf24' : '#34d399'
                          return peak > 0 ? <p className="text-[11px] num font-bold" style={{ color: col }}>RPE {peak}</p> : null
                        })()}
                        {vol > 0 && <p className="text-[11px] text-text-muted num">{Math.round(vol).toLocaleString()} kg</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          }
        </div>
      </div>

      {/* Personal Records */}
      {prs.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-bg-border">
            <Trophy size={14} style={{ color: '#fbbf24' }} />
            <h3 className="text-sm font-semibold text-text-primary">Personal Records</h3>
            <span className="text-xs text-text-muted">heaviest set per exercise</span>
          </div>
          <div className="grid grid-cols-4 divide-x divide-y" style={{ borderColor: 'var(--c-border-subtle)' }}>
            {prs.map(([exercise, pr]) => (
              <div key={exercise} className="px-4 py-3">
                <p className="text-[11px] text-text-muted mb-0.5 truncate">{exercise}</p>
                <p className="text-lg font-bold num" style={{ color: '#fbbf24' }}>{pr.weight}<span className="text-xs font-normal text-text-muted ml-1">kg</span></p>
                <p className="text-[10px] text-text-muted num mt-0.5">{formatDate(pr.date)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Workouts Tab ─────────────────────────────────────────────────────────────

function WorkoutsTab() {
  const { data: workouts = [], isPending } = useWorkouts()
  const deleteWorkout = useDeleteWorkout()

  const [modal,      setModal]      = useState<null | 'new' | any>(null)
  const [catFilter,  setCatFilter]  = useState('')
  const [expanded,   setExpanded]   = useState<Set<number>>(new Set())
  const [confirmDel, setConfirmDel] = useState<number | null>(null)

  const allWorkouts = workouts as any[]

  const filtered = useMemo(() =>
    [...allWorkouts]
      .filter(w => !catFilter || w.category === catFilter)
      .sort((a, b) => b.date.localeCompare(a.date)),
    [allWorkouts, catFilter],
  )

  const toggleExpand = (id: number) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  if (isPending) return <PageLoader />

  return (
    <div className="p-6 space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setCatFilter('')}
          className="px-3 py-1 rounded-lg text-xs font-medium transition-all"
          style={{
            background: !catFilter ? 'var(--c-border-mid)' : 'var(--c-bg-input)',
            border: `1px solid ${!catFilter ? 'var(--c-border-strong)' : 'var(--c-border)'}`,
            color: !catFilter ? '#eeeef5' : '#8b8baa',
          }}>
          All
        </button>
        {CATEGORIES.map(c => (
          <button key={c.value} onClick={() => setCatFilter(catFilter === c.value ? '' : c.value)}
            className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: catFilter === c.value ? c.color + '20' : 'var(--c-bg-input)',
              border: `1px solid ${catFilter === c.value ? c.color + '55' : 'var(--c-border)'}`,
              color: catFilter === c.value ? c.color : '#8b8baa',
            }}>
            {c.label}
          </button>
        ))}
        <button onClick={() => setModal('new')}
          className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #818cf8, #a78bfa)' }}>
          <Plus size={14} /> Log Workout
        </button>
      </div>

      {filtered.length === 0
        ? <EmptyState icon={<Dumbbell size={28} />} title="No workouts logged" description="Track every session to see your progress over time." />
        : (
          <div className="space-y-2">
            {filtered.map(w => {
              const cm      = catMeta(w.category)
              const vol     = workoutVolume(w)
              const isOpen  = expanded.has(w.id)
              const peakRpe = w.exercises?.length
                ? Math.max(...w.exercises.map((e: any) => e.rpe ?? 0))
                : 0
              const rpeColor = peakRpe >= 9 ? '#f87171' : peakRpe >= 7 ? '#fbbf24' : '#34d399'

              return (
                <div key={w.id} className="rounded-xl overflow-hidden transition-all"
                  style={{ background: 'var(--c-bg-card)', border: `1px solid var(--c-border)`, borderLeft: `3px solid ${cm.color}` }}>

                  {/* Header row */}
                  <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => toggleExpand(w.id)}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-semibold text-text-primary">{w.name}</p>
                        {/* Category badge */}
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                          style={{ background: cm.color + '18', color: cm.color }}>{cm.label}</span>
                        {/* Peak RPE badge */}
                        {peakRpe > 0 && (
                          <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold num"
                            style={{ background: rpeColor + '18', color: rpeColor }}>Peak RPE {peakRpe}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-text-muted num">
                        <span>{formatDate(w.date)}</span>
                        {w.durationMinutes && <span>{w.durationMinutes} min</span>}
                        {vol > 0 && <span>{Math.round(vol).toLocaleString()} kg volume</span>}
                        {w.exercises?.length > 0 && <span>{w.exercises.length} exercise{w.exercises.length > 1 ? 's' : ''}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={e => { e.stopPropagation(); setModal(w) }}
                        className="p-1.5 text-text-muted hover:text-text-primary rounded-lg transition-colors hover:bg-bg-hover">
                        <Pencil size={13} />
                      </button>
                      {confirmDel === w.id
                        ? (
                          <div className="flex items-center gap-1">
                            <button onClick={e => { e.stopPropagation(); deleteWorkout.mutate(w.id); setConfirmDel(null) }}
                              className="text-[10px] text-pnl-loss hover:underline px-1">confirm</button>
                            <button onClick={e => { e.stopPropagation(); setConfirmDel(null) }}
                              className="text-[10px] text-text-muted hover:underline px-1">cancel</button>
                          </div>
                        )
                        : (
                          <button onClick={e => { e.stopPropagation(); setConfirmDel(w.id) }}
                            className="p-1.5 text-text-muted hover:text-pnl-loss rounded-lg transition-colors hover:bg-bg-hover">
                            <Trash2 size={13} />
                          </button>
                        )
                      }
                      {isOpen ? <ChevronUp size={14} className="text-text-muted ml-1" /> : <ChevronDown size={14} className="text-text-muted ml-1" />}
                    </div>
                  </div>

                  {/* Expanded: exercises + notes */}
                  {isOpen && (
                    <div className="px-4 pb-3 border-t border-bg-border/50">
                      {w.exercises?.length > 0 && (
                        <table className="w-full text-xs mt-3">
                          <thead>
                            <tr>
                              {['Exercise', 'Sets', 'Reps', 'Weight (kg)', 'Volume', 'RPE'].map(h => (
                                <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-wider text-text-muted py-1.5 pr-4">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {w.exercises.map((e: any) => {
                              const avgR   = Array.isArray(e.reps)   && e.reps.length   ? e.reps.reduce((a: number, b: number) => a+b, 0)   / e.reps.length   : 0
                              const avgW   = Array.isArray(e.weight) && e.weight.length ? e.weight.reduce((a: number, b: number) => a+b, 0) / e.weight.length : 0
                              const vol    = (e.sets ?? 0) * avgR * avgW
                              const eRpeC  = e.rpe >= 9 ? '#f87171' : e.rpe >= 7 ? '#fbbf24' : '#34d399'
                              return (
                                <tr key={e.id} className="border-t border-bg-border/30">
                                  <td className="py-1.5 pr-4 text-text-primary font-medium">{e.exerciseName}</td>
                                  <td className="py-1.5 pr-4 text-text-secondary num">{e.sets ?? '--'}</td>
                                  <td className="py-1.5 pr-4 text-text-secondary num">{Array.isArray(e.reps)   ? e.reps.join(', ')   : '--'}</td>
                                  <td className="py-1.5 pr-4 text-text-secondary num">{Array.isArray(e.weight) ? e.weight.join(', ') : '--'}</td>
                                  <td className="py-1.5 pr-4 text-text-muted num">{vol > 0 ? `${Math.round(vol).toLocaleString()} kg` : '--'}</td>
                                  <td className="py-1.5">
                                    {e.rpe
                                      ? <span className="px-1.5 py-0.5 rounded num font-bold text-[10px]" style={{ background: eRpeC + '18', color: eRpeC }}>{e.rpe}</span>
                                      : <span className="text-text-muted">--</span>
                                    }
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                      {w.notes && <p className="text-xs text-text-muted mt-2 pt-2 border-t border-bg-border/40 italic">{w.notes}</p>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      }

      {modal && <WorkoutModal entry={modal === 'new' ? undefined : modal} onClose={() => setModal(null)} />}
    </div>
  )
}

// ─── Metrics Modal ────────────────────────────────────────────────────────────

function MetricModal({ entry, onClose }: { entry?: any; onClose: () => void }) {
  const create = useCreateMetric()
  const update = useUpdateMetric()
  const { register, handleSubmit } = useForm({
    defaultValues: entry ?? { date: today(), weightKg: '', bodyFatPct: '', notes: '' },
  })
  const onSubmit = async (data: any) => {
    const payload = { ...data, weightKg: data.weightKg ? parseFloat(data.weightKg) : null, bodyFatPct: data.bodyFatPct ? parseFloat(data.bodyFatPct) : null }
    if (entry) await update.mutateAsync({ id: entry.id, ...payload })
    else       await create.mutateAsync(payload)
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={entry ? 'Edit Entry' : 'Log Body Metrics'} size="sm">
      <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-3">
        <Input label="Date" type="date" {...register('date')} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Weight (kg)" type="number" step="0.1" placeholder="80.5" {...register('weightKg')} />
          <Input label="Body Fat %" type="number" step="0.1" placeholder="15.0" {...register('bodyFatPct')} />
        </div>
        <Textarea label="Notes" rows={2} placeholder="How you felt, conditions…" {...register('notes')} />
        <div className="flex justify-end gap-2 pt-1 border-t border-bg-border">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">{entry ? 'Save' : 'Log'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Progress insight engine ──────────────────────────────────────────────────

type WeightTrend = 'gaining' | 'stable' | 'dropping'
type LiftTrend   = 'improving' | 'stagnating' | 'declining'

interface ProgressInsight {
  pattern:    string
  color:      string
  what:       string
  why:        string
  action:     string
  weightTrend: WeightTrend | null
  liftTrend:   LiftTrend   | null
  weightChange: number | null
  liftPct:      number | null        // avg % change across tracked exercises
  trackedExercises: number
}

function computeInsight(metrics: any[], workouts: any[]): ProgressInsight | null {
  // ── Weight trend ──────────────────────────────────────────────────────────
  const wEntries = [...metrics].filter(m => m.weightKg != null).sort((a, b) => a.date.localeCompare(b.date))
  let weightTrend: WeightTrend | null = null
  let weightChange: number | null     = null

  if (wEntries.length >= 2) {
    const n          = Math.max(1, Math.floor(wEntries.length / 3))
    const earlyAvg   = wEntries.slice(0, n).reduce((s, m) => s + m.weightKg, 0) / n
    const recentAvg  = wEntries.slice(-n).reduce((s, m) => s + m.weightKg, 0) / n
    weightChange     = recentAvg - earlyAvg
    weightTrend      = Math.abs(weightChange) < 1.0 ? 'stable' : weightChange < 0 ? 'dropping' : 'gaining'
  }

  // ── Lift trend ────────────────────────────────────────────────────────────
  // Build per-exercise session history: { name → [{date, maxWeight}] }
  const exSessions: Record<string, { date: string; max: number }[]> = {}
  ;(workouts as any[]).forEach(w => {
    w.exercises?.forEach((e: any) => {
      if (!Array.isArray(e.weight) || !e.weight.length) return
      if (!exSessions[e.exerciseName]) exSessions[e.exerciseName] = []
      exSessions[e.exerciseName].push({ date: w.date, max: Math.max(...e.weight) })
    })
  })

  let improvingCount = 0, stagnatingCount = 0, decliningCount = 0
  const pctChanges: number[] = []

  Object.values(exSessions).forEach(sessions => {
    if (sessions.length < 3) return
    const sorted   = sessions.sort((a, b) => a.date.localeCompare(b.date))
    const half     = Math.max(1, Math.floor(sorted.length / 2))
    const earlyAvg = sorted.slice(0, half).reduce((s, e) => s + e.max, 0) / half
    const latAvg   = sorted.slice(-half).reduce((s, e) => s + e.max, 0) / half
    const pct      = earlyAvg > 0 ? ((latAvg - earlyAvg) / earlyAvg) * 100 : 0
    pctChanges.push(pct)
    if (pct >  4) improvingCount++
    else if (pct < -4) decliningCount++
    else stagnatingCount++
  })

  const trackedExercises = improvingCount + stagnatingCount + decliningCount
  let liftTrend: LiftTrend | null = null
  let liftPct: number | null      = null

  if (trackedExercises > 0) {
    liftPct = pctChanges.reduce((s, p) => s + p, 0) / pctChanges.length
    if (improvingCount > stagnatingCount && improvingCount >= decliningCount) liftTrend = 'improving'
    else if (decliningCount > improvingCount && decliningCount > stagnatingCount)  liftTrend = 'declining'
    else liftTrend = 'stagnating'
  }

  // Need at least one stream
  if (!weightTrend && !liftTrend) return null

  // ── Pattern match ─────────────────────────────────────────────────────────
  type PatternDef = { pattern: string; color: string; what: string; why: string; action: string }

  const patterns: Record<string, PatternDef> = {
    recomp: {
      pattern: 'Recomposition',
      color:   '#818cf8',
      what:    'Your weight is holding steady while your lifts are getting stronger.',
      why:     'Recomposition (gaining muscle and losing fat simultaneously) is the hardest state to achieve and the most efficient use of your training. It typically means your protein intake, training intensity, and recovery are all dialled in.',
      action:  'Keep doing what you\'re doing. Recomp is slow by nature. Don\'t chase the scale.',
    },
    effectiveBulk: {
      pattern: 'Effective Bulk',
      color:   '#34d399',
      what:    'Your weight is going up and your lifts are following.',
      why:     'This is what a productive gaining phase looks like. The weight you\'re adding is being used to build strength, not just stored as fat. As long as the rate of gain is moderate (0.5–1 kg/month), you\'re likely adding mostly muscle.',
      action:  'Keep the caloric surplus modest. If weight is rising faster than your lifts, pull back slightly on calories.',
    },
    cleanCut: {
      pattern: 'Clean Cut',
      color:   '#22d3ee',
      what:    'Your weight is dropping while your lifts are holding or improving.',
      why:     'This is the ideal cutting scenario. Maintaining or gaining strength while in a caloric deficit means you\'re preserving muscle mass, which is the whole point of training during a cut. Most people lose strength when cutting; you\'re not.',
      action:  'Ensure protein stays high (2g+ per kg bodyweight). Monitor RPE: if sessions start feeling unusually hard at the same weights, it\'s a sign the deficit is getting too aggressive.',
    },
    overCutting: {
      pattern: 'Cutting Too Aggressively',
      color:   '#f87171',
      what:    'Your weight is dropping and your lifts are declining with it.',
      why:     'When you lose weight and lose strength at the same time, you\'re in too large a caloric deficit. Your body is breaking down muscle for energy. The weight loss number looks good but you\'re losing the wrong thing.',
      action:  'Reduce the deficit. Aim for 300–500 kcal below maintenance rather than a crash cut. Increase protein. Consider a brief maintenance week to recover.',
    },
    fatGain: {
      pattern: 'Fat Gain Without Muscle',
      color:   '#fbbf24',
      what:    'Your weight is going up but your lifts aren\'t responding.',
      why:     'Gaining weight without strength gains means the surplus calories are being stored as fat rather than used to build muscle. This can happen from too large a surplus, insufficient training stimulus, or poor recovery.',
      action:  'Reduce calories to a small surplus (200–300 kcal). Check that your training has progressive overload built in: are you actually trying to add weight to the bar each week?',
    },
    plateau: {
      pattern: 'Plateau',
      color:   '#fbbf24',
      what:    'Your weight and your lifts are both stuck.',
      why:     'A plateau means your body has adapted to your current training and nutrition. It\'s not a failure. It\'s your body signalling it needs a new stimulus. Common after 8–12 weeks on the same programme.',
      action:  'Change the stimulus: try adding one rep to each set before adding weight, increase training frequency for lagging exercises, or take a deliberate deload week to reset fatigue.',
    },
    weightOnly: {
      pattern: weightTrend === 'dropping' ? 'Weight Dropping' : weightTrend === 'gaining' ? 'Weight Gaining' : 'Weight Stable',
      color:   weightTrend === 'dropping' ? '#22d3ee' : weightTrend === 'gaining' ? '#fbbf24' : '#818cf8',
      what:    `Your body weight is ${weightTrend === 'stable' ? 'holding steady' : weightTrend === 'dropping' ? 'trending down' : 'trending up'}.`,
      why:     'Log your lifts with weights for at least 3 sessions per exercise to unlock strength-vs-weight analysis and get a full picture of what your body composition is doing.',
      action:  'Add weight data to your exercises when logging workouts.',
    },
    liftOnly: {
      pattern: liftTrend === 'improving' ? 'Lifts Improving' : liftTrend === 'declining' ? 'Lifts Declining' : 'Lifts Stagnating',
      color:   liftTrend === 'improving' ? '#34d399' : liftTrend === 'declining' ? '#f87171' : '#fbbf24',
      what:    `Your tracked lifts are ${liftTrend === 'improving' ? 'trending upward' : liftTrend === 'declining' ? 'declining' : 'flat'}.`,
      why:     'Log your body weight regularly to unlock the full picture. Knowing whether you\'re gaining or losing weight alongside your strength trend reveals what\'s actually happening to your body composition.',
      action:  'Log your body weight at least once a week, same time of day.',
    },
  }

  let key: string
  if (!weightTrend) key = 'liftOnly'
  else if (!liftTrend) key = 'weightOnly'
  else if (weightTrend === 'stable'   && liftTrend === 'improving')   key = 'recomp'
  else if (weightTrend === 'gaining'  && liftTrend === 'improving')   key = 'effectiveBulk'
  else if (weightTrend === 'dropping' && liftTrend !== 'declining')   key = 'cleanCut'
  else if (weightTrend === 'dropping' && liftTrend === 'declining')   key = 'overCutting'
  else if (weightTrend === 'gaining'  && liftTrend !== 'improving')   key = 'fatGain'
  else key = 'plateau'

  return { ...patterns[key], weightTrend, liftTrend, weightChange, liftPct, trackedExercises }
}

// ─── Progress Tab ─────────────────────────────────────────────────────────────

function ProgressTab() {
  const { data: workouts = [], isPending: wLoading } = useWorkouts()
  const { data: metrics  = [], isPending: mLoading  } = useBodyMetrics()
  const deleteMetric = useDeleteMetric()

  const [metricModal,   setMetricModal]   = useState<null | 'new' | any>(null)
  const [selectedEx,    setSelectedEx]    = useState('')
  const [confirmDel,    setConfirmDel]    = useState<number | null>(null)

  const allWorkouts = workouts as any[]
  const allMetrics  = [...(metrics as any[])].sort((a, b) => a.date.localeCompare(b.date))

  // All exercise names across all workouts (deduplicated)
  const exerciseNames = useMemo(() => {
    const names = new Set<string>()
    allWorkouts.forEach(w => w.exercises?.forEach((e: any) => names.add(e.exerciseName)))
    return [...names].sort()
  }, [allWorkouts])

  // Per-exercise progression: max weight per session
  const exerciseChart = useMemo(() => {
    if (!selectedEx) return []
    return allWorkouts
      .filter(w => w.exercises?.some((e: any) => e.exerciseName === selectedEx))
      .map(w => {
        const ex     = w.exercises.find((e: any) => e.exerciseName === selectedEx)
        const maxW   = Array.isArray(ex?.weight) && ex.weight.length ? Math.max(...ex.weight) : null
        const totVol = ex && Array.isArray(ex.weight) && Array.isArray(ex.reps) && ex.sets
          ? ex.sets * (ex.reps.reduce((a: number, b: number) => a+b, 0) / ex.reps.length) * (ex.weight.reduce((a: number, b: number) => a+b, 0) / ex.weight.length)
          : null
        return { date: w.date, maxWeight: maxW, volume: totVol ? Math.round(totVol) : null }
      })
      .filter(p => p.maxWeight !== null)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [allWorkouts, selectedEx])

  // Body metrics delta
  const firstMetric = allMetrics[0]
  const lastMetric  = allMetrics[allMetrics.length - 1]
  const weightDelta = firstMetric && lastMetric && firstMetric.weightKg && lastMetric.weightKg
    ? lastMetric.weightKg - firstMetric.weightKg
    : null
  const bfDelta = firstMetric && lastMetric && firstMetric.bodyFatPct && lastMetric.bodyFatPct
    ? lastMetric.bodyFatPct - firstMetric.bodyFatPct
    : null

  // Pattern insight
  const insight = useMemo(() => computeInsight(allMetrics, allWorkouts), [allMetrics, allWorkouts])

  if (wLoading || mLoading) return <PageLoader />

  const tooltipStyle = { background: 'var(--c-chart-tooltip-bg)', border: '1px solid var(--c-border-mid)', borderRadius: 8 }
  const tickStyle    = { fill: '#8b8baa', fontSize: 10 }

  return (
    <div className="p-6 space-y-6">

      {/* ── Insight card ── */}
      {insight ? (
        <div className="rounded-xl p-5" style={{
          background: insight.color + '0c',
          border: `1px solid ${insight.color}30`,
          borderLeft: `4px solid ${insight.color}`,
        }}>
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: insight.color }}>
                Body Composition Signal
              </p>
              <h3 className="text-lg font-bold text-text-primary">{insight.pattern}</h3>
            </div>
            {/* Data evidence pills */}
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              {insight.weightChange !== null && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold num"
                  style={{ background: 'var(--c-bg-input)', color: 'var(--c-text-2)' }}>
                  Weight {insight.weightChange > 0 ? '+' : ''}{insight.weightChange.toFixed(1)} kg
                </span>
              )}
              {insight.liftPct !== null && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold num"
                  style={{ background: 'var(--c-bg-input)', color: 'var(--c-text-2)' }}>
                  Lifts {insight.liftPct > 0 ? '+' : ''}{insight.liftPct.toFixed(1)}% · {insight.trackedExercises} exercise{insight.trackedExercises !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {/* What */}
          <p className="text-sm font-semibold text-text-primary mb-1">{insight.what}</p>

          {/* Why */}
          <p className="text-sm text-text-secondary leading-relaxed mb-3">{insight.why}</p>

          {/* Action */}
          <div className="flex items-start gap-2 rounded-lg px-3 py-2"
            style={{ background: insight.color + '12', border: `1px solid ${insight.color}22` }}>
            <span className="text-[11px] font-bold uppercase tracking-wider flex-shrink-0 mt-0.5" style={{ color: insight.color }}>→</span>
            <p className="text-xs text-text-secondary leading-relaxed">{insight.action}</p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl p-5 text-center" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
          <p className="text-sm font-semibold text-text-primary mb-1">No signal yet</p>
          <p className="text-xs text-text-muted leading-relaxed max-w-md mx-auto">
            Log at least 2 body weight entries and 3 sessions per exercise with weights to unlock pattern analysis: strength vs weight trend, recomposition detection, and cut/bulk feedback.
          </p>
        </div>
      )}

      {/* Body metrics stat row */}
      {lastMetric && (
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Current Weight" value={lastMetric.weightKg ? `${lastMetric.weightKg} kg` : '--'}
            icon={<Activity size={16} />} iconBg="rgba(129,140,248,0.12)" iconColor="#818cf8"
            badge={weightDelta !== null ? { text: `${weightDelta > 0 ? '+' : ''}${weightDelta.toFixed(1)} kg`, color: weightDelta < 0 ? '#34d399' : '#f87171' } : undefined} />
          <StatCard label="Body Fat" value={lastMetric.bodyFatPct ? `${lastMetric.bodyFatPct}%` : '--'}
            icon={<Activity size={16} />} iconBg="rgba(34,211,238,0.12)" iconColor="#22d3ee"
            badge={bfDelta !== null ? { text: `${bfDelta > 0 ? '+' : ''}${bfDelta.toFixed(1)}%`, color: bfDelta < 0 ? '#34d399' : '#f87171' } : undefined} />
          <StatCard label="Entries Logged" value={allMetrics.length}
            icon={<TrendingUp size={16} />} iconBg="rgba(52,211,153,0.12)" iconColor="#34d399"
            sub={firstMetric ? `since ${formatDate(firstMetric.date)}` : undefined} />
          <div className="flex items-center justify-end">
            <button onClick={() => setMetricModal('new')}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #818cf8, #a78bfa)' }}>
              <Plus size={14} /> Log Metrics
            </button>
          </div>
        </div>
      )}

      {/* Body metrics charts */}
      {allMetrics.length > 0 ? (
        <div className="grid grid-cols-2 gap-4">
          {/* Weight chart */}
          <div className="rounded-xl p-4" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
            <h3 className="text-sm font-semibold text-text-primary mb-4">Weight (kg)</h3>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={allMetrics}>
                  <CartesianGrid vertical={false} stroke="var(--c-chart-grid)" />
                  <XAxis dataKey="date" tick={tickStyle} axisLine={false} tickLine={false}
                    tickFormatter={d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} />
                  <YAxis tick={tickStyle} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#eeeef5' }}
                    formatter={(v: any) => [`${v} kg`, 'Weight']} />
                  <Line type="monotone" dataKey="weightKg" stroke="#818cf8" strokeWidth={2} dot={{ fill: '#818cf8', r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Body fat chart */}
          <div className="rounded-xl p-4" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
            <h3 className="text-sm font-semibold text-text-primary mb-4">Body Fat %</h3>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={allMetrics}>
                  <CartesianGrid vertical={false} stroke="var(--c-chart-grid)" />
                  <XAxis dataKey="date" tick={tickStyle} axisLine={false} tickLine={false}
                    tickFormatter={d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} />
                  <YAxis tick={tickStyle} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#eeeef5' }}
                    formatter={(v: any) => [`${v}%`, 'Body Fat']} />
                  <Line type="monotone" dataKey="bodyFatPct" stroke="#22d3ee" strokeWidth={2} dot={{ fill: '#22d3ee', r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl p-6 text-center" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
          <p className="text-sm text-text-muted mb-3">No body metrics logged yet</p>
          <button onClick={() => setMetricModal('new')}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #818cf8, #a78bfa)' }}>
            <Plus size={14} className="inline mr-1" /> Log First Entry
          </button>
        </div>
      )}

      {/* Per-exercise progression */}
      {exerciseNames.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
          <div className="flex items-center gap-3 mb-4">
            <h3 className="text-sm font-semibold text-text-primary">Exercise Progression</h3>
            <select value={selectedEx} onChange={e => setSelectedEx(e.target.value)}
              className="text-xs rounded-lg px-2.5 py-1.5 text-text-primary outline-none transition-colors"
              style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)' }}>
              <option value="">Pick an exercise</option>
              {exerciseNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          {selectedEx && exerciseChart.length > 1 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={exerciseChart}>
                  <CartesianGrid vertical={false} stroke="var(--c-chart-grid)" />
                  <XAxis dataKey="date" tick={tickStyle} axisLine={false} tickLine={false}
                    tickFormatter={d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} />
                  <YAxis tick={tickStyle} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#eeeef5' }}
                    formatter={(v: any, name: string) => [name === 'maxWeight' ? `${v} kg` : `${v} kg`, name === 'maxWeight' ? 'Max weight' : 'Volume']} />
                  <Line type="monotone" dataKey="maxWeight" stroke="#fbbf24" strokeWidth={2.5} dot={{ fill: '#fbbf24', r: 4, strokeWidth: 0 }} activeDot={{ r: 6 }} name="maxWeight" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : selectedEx ? (
            <p className="text-xs text-text-muted py-4 text-center">Need at least 2 sessions with weight data to show a trend</p>
          ) : (
            <p className="text-xs text-text-muted py-4 text-center">Select an exercise above to see how your max weight has progressed over time</p>
          )}
        </div>
      )}

      {/* Metrics log table */}
      {allMetrics.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
          <div className="px-4 py-3 border-b border-bg-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">All Entries</h3>
            <button onClick={() => setMetricModal('new')}
              className="text-xs font-medium transition-colors" style={{ color: '#818cf8' }}>
              + Log
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--c-bg-input)' }}>
                {['Date', 'Weight', 'Body Fat', 'Notes', ''].map(h => (
                  <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-wider text-text-muted px-4 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...allMetrics].reverse().map((m: any) => (
                <tr key={m.id} className="border-t border-bg-border/30 hover:bg-bg-hover/20 group">
                  <td className="px-4 py-2.5 text-text-secondary text-xs num">{formatDate(m.date)}</td>
                  <td className="px-4 py-2.5 font-semibold num text-text-primary">{m.weightKg ? `${m.weightKg} kg` : '--'}</td>
                  <td className="px-4 py-2.5 num text-text-secondary">{m.bodyFatPct ? `${m.bodyFatPct}%` : '--'}</td>
                  <td className="px-4 py-2.5 text-xs text-text-muted truncate max-w-[200px]">{m.notes || '--'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setMetricModal(m)} className="p-1 text-text-muted hover:text-text-primary rounded transition-colors"><Pencil size={12} /></button>
                      {confirmDel === m.id
                        ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => { deleteMetric.mutate(m.id); setConfirmDel(null) }} className="text-[10px] text-pnl-loss hover:underline">confirm</button>
                            <button onClick={() => setConfirmDel(null)} className="text-[10px] text-text-muted hover:underline">cancel</button>
                          </div>
                        )
                        : <button onClick={() => setConfirmDel(m.id)} className="p-1 text-text-muted hover:text-pnl-loss rounded transition-colors"><Trash2 size={12} /></button>
                      }
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {metricModal && <MetricModal entry={metricModal === 'new' ? undefined : metricModal} onClose={() => setMetricModal(null)} />}
    </div>
  )
}

// ─── Template Modal ───────────────────────────────────────────────────────────

function TemplateModal({ entry, onClose }: { entry?: any; onClose: () => void }) {
  const create = useCreateTemplate()
  const update = useUpdateTemplate()

  const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm({
    defaultValues: entry
      ? { ...entry, exercises: entry.exercises ?? [] }
      : { name: '', category: 'strength', exercises: [{ exerciseName: '', defaultSets: 3 }] },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'exercises' })
  const watchedCategory = watch('category')
  const cm = catMeta(watchedCategory)

  const onSubmit = async (data: any) => {
    const payload = {
      ...data,
      exercises: data.exercises
        .filter((e: any) => e.exerciseName.trim())
        .map((e: any) => ({ exerciseName: e.exerciseName.trim(), defaultSets: parseInt(e.defaultSets) || 3 })),
    }
    if (entry) await update.mutateAsync({ id: entry.id, ...payload })
    else       await create.mutateAsync(payload)
    onClose()
  }

  const inputCls = 'min-w-0 w-full bg-bg-secondary border border-bg-border rounded-lg px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue transition-colors'

  return (
    <Modal open onClose={onClose} title={entry ? 'Edit Template' : 'New Template'} size="md">
      <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-4">

        {/* Name */}
        <Input label="Template name" placeholder="Push Day A, Leg Day, Basketball…"
          {...register('name', { required: true })} />
        {errors.name && <p className="text-xs text-pnl-loss -mt-2">Required</p>}

        {/* Category */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1.5">Category</label>
          <div className="flex gap-1.5 flex-wrap">
            {CATEGORIES.map(c => {
              const active = watchedCategory === c.value
              return (
                <button key={c.value} type="button"
                  onClick={() => setValue('category', c.value)}
                  className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: active ? c.color + '20' : 'var(--c-bg-input)',
                    border: `1px solid ${active ? c.color + '55' : 'var(--c-border-mid)'}`,
                    color: active ? c.color : 'rgba(139,139,170,0.8)',
                  }}>
                  {c.label}
                </button>
              )
            })}
          </div>
          <input type="hidden" {...register('category')} />
        </div>

        {/* Exercise list */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Exercises</label>
            <button type="button" onClick={() => append({ exerciseName: '', defaultSets: 3 })}
              className="text-xs font-medium transition-colors" style={{ color: cm.color }}>
              + Add exercise
            </button>
          </div>

          {/* Column headers */}
          <div className="grid gap-2 px-0.5 mb-1" style={{ gridTemplateColumns: '1fr 80px 20px' }}>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Exercise</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted text-center">Default sets</span>
            <span />
          </div>

          <div className="space-y-2">
            {fields.map((field, i) => (
              <div key={field.id} className="grid gap-2 items-center" style={{ gridTemplateColumns: '1fr 80px 20px' }}>
                <input {...register(`exercises.${i}.exerciseName`)} placeholder="e.g. Bench Press"
                  className={inputCls} />
                <input {...register(`exercises.${i}.defaultSets`)} type="number" min="1" max="10" placeholder="3"
                  className={`${inputCls} text-center num`} />
                <button type="button" onClick={() => remove(i)}
                  className="text-text-muted hover:text-pnl-loss text-lg leading-none transition-colors">×</button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-text-muted mt-2">
            Default sets pre-fills empty set rows when you load this template. You set the weights when logging.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1 border-t border-bg-border">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">{entry ? 'Save Template' : 'Create Template'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

function TemplatesTab() {
  const { data: templates = [], isPending } = useWorkoutTemplates()
  const deleteTemplate = useDeleteTemplate()

  const [modal,      setModal]      = useState<null | 'new' | any>(null)
  const [confirmDel, setConfirmDel] = useState<number | null>(null)

  if (isPending) return <PageLoader />

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Workout Templates</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Define your fixed gym schedule. When logging a workout, pick a template to pre-load your exercises, then remove what you skipped and add anything extra.
          </p>
        </div>
        <button onClick={() => setModal('new')}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white flex-shrink-0 ml-4 transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #818cf8, #a78bfa)' }}>
          <Plus size={14} /> New Template
        </button>
      </div>

      {(templates as any[]).length === 0 ? (
        <EmptyState icon={<LayoutTemplate size={28} />} title="No templates yet"
          description="Create your first template. Push Day, Pull Day, Leg Day, Basketball..." />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {(templates as any[]).map((tpl: any) => {
            const tm = catMeta(tpl.category)
            return (
              <div key={tpl.id} className="rounded-xl overflow-hidden group"
                style={{ background: 'var(--c-bg-card)', border: `1px solid var(--c-border)`, borderTop: `3px solid ${tm.color}` }}>
                <div className="p-4">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-text-primary">{tpl.name}</h3>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold mt-1"
                        style={{ background: tm.color + '18', color: tm.color }}>
                        {tm.label}
                      </span>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setModal(tpl)}
                        className="p-1.5 text-text-muted hover:text-text-primary rounded-lg transition-colors hover:bg-bg-hover">
                        <Pencil size={13} />
                      </button>
                      {confirmDel === tpl.id
                        ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => { deleteTemplate.mutate(tpl.id); setConfirmDel(null) }}
                              className="text-[10px] text-pnl-loss hover:underline px-1">confirm</button>
                            <button onClick={() => setConfirmDel(null)}
                              className="text-[10px] text-text-muted hover:underline px-1">cancel</button>
                          </div>
                        )
                        : (
                          <button onClick={() => setConfirmDel(tpl.id)}
                            className="p-1.5 text-text-muted hover:text-pnl-loss rounded-lg transition-colors hover:bg-bg-hover">
                            <Trash2 size={13} />
                          </button>
                        )
                      }
                    </div>
                  </div>

                  {/* Exercise list */}
                  {(tpl.exercises ?? []).length > 0 ? (
                    <div className="space-y-1">
                      {(tpl.exercises as { exerciseName: string; defaultSets: number }[]).map((ex, i) => (
                        <div key={i} className="flex items-center justify-between py-1 border-b border-bg-border/30 last:border-0">
                          <span className="text-xs text-text-secondary">{ex.exerciseName}</span>
                          <span className="text-[11px] text-text-muted num">{ex.defaultSets} sets</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-text-muted">No exercises added yet</p>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-bg-border/50">
                    <span className="text-[11px] text-text-muted">
                      {(tpl.exercises ?? []).length} exercise{(tpl.exercises ?? []).length !== 1 ? 's' : ''}
                    </span>
                    <span className="text-[11px] text-text-muted num">
                      {(tpl.exercises ?? []).reduce((s: number, e: any) => s + (e.defaultSets ?? 0), 0)} total sets
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modal && <TemplateModal entry={modal === 'new' ? undefined : modal} onClose={() => setModal(null)} />}
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function TrainingPage() {
  const [tab,        setTab]        = useState('overview')
  const [logWorkout, setLogWorkout] = useState(false)

  return (
    <PageShell title="Training" action={<Tabs tabs={TABS} active={tab} onChange={setTab} />}>
      {tab === 'overview'  && <OverviewTab onLogWorkout={() => { setTab('workouts'); setLogWorkout(true) }} />}
      {tab === 'workouts'  && <WorkoutsTab key={logWorkout ? 'open' : 'closed'} />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'progress'  && <ProgressTab />}
    </PageShell>
  )
}
