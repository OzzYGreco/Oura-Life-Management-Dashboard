/**
 * Headless core of the Training page, shared by every skin.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Lift {
  name: string
  sessions: number
  current: number
  lastDate: string
  best: { e1rm: number; date: string; kg: number; reps: number }
  change: number          // estimated 1RM now minus about 8 weeks ago
  since: string
  stalled: boolean
  history: { date: string; e1rm: number }[]
}

export interface Template { id: number; name: string; category: string; exercises: { exerciseName: string; defaultSets: number }[] }

export interface TrainingView {
  today: string
  templates: Template[]
  last: Record<string, { date: string; reps: number[]; weight: number[]; target: string }>
  progress: Lift[]
  weeks: { start: string; count: number; byCat: Record<string, number> }[]
  recent: { id: number; date: string; name: string; category: string; durationMinutes: number | null; rpe: number | null; exercises: { name: string; reps: number[]; weight: number[] }[] }[]
  totals: { workouts: number; first: string | null }
}

// ─── Categories ─────────────────────────────────────────────────────────────
// The old page's five categories. Their colours are series colours only: cool,
// distinct hues that never borrow good / bad / warn.
export const CATEGORIES = [
  { value: 'strength', label: 'Strength', color: '#D3DAE6' },
  { value: 'cardio',   label: 'Cardio',   color: '#6E9FE0' },
  { value: 'sport',    label: 'Sport',    color: '#A48FE6' },
  { value: 'hiit',     label: 'HIIT',     color: '#5FC1D6' },
  { value: 'mobility', label: 'Mobility', color: '#8790A3' },
] as const
export const catMeta = (v: string) => CATEGORIES.find(c => c.value === v) ?? { value: v, label: v, color: '#8790A3' }

const KEY = ['training-overview']

export function useTraining() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<TrainingView>('/api/training/overview').then(r => r.data) })
}

/** Every save touches the overview, the full list, and the pages that count workouts. */
const refresh = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: KEY })
  qc.invalidateQueries({ queryKey: ['workouts-all'] })
  qc.invalidateQueries({ queryKey: ['today'] })
  qc.invalidateQueries({ queryKey: ['week'] })
}

export interface LogSet { reps: number; weight: number }
export interface LogExercise { name: string; sets: LogSet[]; rpe?: number | null }
export interface LogWorkout {
  date: string; name: string; category: string
  durationMinutes?: number | null; rpe?: number | null; notes?: string | null
  exercises: LogExercise[]
}

/** Reps and weights are written together set by set, so they can never fall out of step. */
const toBody = (w: LogWorkout) => ({
  date: w.date, name: w.name, category: w.category,
  durationMinutes: w.durationMinutes ?? null, rpe: w.rpe ?? null, notes: w.notes?.trim() ? w.notes.trim() : null,
  exercises: w.exercises
    .map(e => ({ ...e, sets: e.sets.filter(s => s.reps > 0) }))
    .filter(e => e.sets.length)
    .map(e => ({ exerciseName: e.name, sets: e.sets.length, reps: e.sets.map(s => s.reps), weight: e.sets.map(s => s.weight), rpe: e.rpe ?? null })),
})

/** Saves a new workout, or replaces an existing one when an id is given. */
export function useLogWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...w }: LogWorkout & { id?: number }) =>
      id ? api.put(`/api/training/workouts/${id}`, toBody(w)) : api.post('/api/training/workouts', toBody(w)),
    onSuccess: () => refresh(qc),
  })
}

export function useDeleteWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/training/workouts/${id}`),
    onSuccess: () => refresh(qc),
  })
}

/** Creates a template, or updates one when an id is given. */
export function useSaveTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...t }: Omit<Template, 'id'> & { id?: number }) => {
      const body = { name: t.name.trim(), category: t.category, exercises: t.exercises.filter(e => e.exerciseName.trim()).map(e => ({ exerciseName: e.exerciseName.trim(), defaultSets: Math.max(1, Math.round(e.defaultSets) || 3) })) }
      return id ? api.put(`/api/training/templates/${id}`, body) : api.post('/api/training/templates', body)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/training/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

/** Builds the logger's starting sets from last time, so most sets need one tap. */
export function startingSets(view: TrainingView, exercise: string, defaultSets: number): LogSet[] {
  const l = view.last[exercise]
  if (!l) return Array.from({ length: Math.max(1, defaultSets) }, () => ({ reps: 0, weight: 0 }))
  return l.reps.map((r, i) => ({ reps: r, weight: l.weight[i] ?? 0 }))
}

export const kg = (n: number) => `${Math.round(n * 10) / 10} kg`
export const setLabel = (s: LogSet) => (s.weight > 0 ? `${s.weight}×${s.reps}` : `${s.reps} reps`)

// ─── Workouts in full, and the numbers worked out from them ──────────────────

export interface WorkoutExercise { id: number; exerciseName: string; sets: number | null; reps: number[] | null; weight: number[] | null; rpe: number | null; notes: string | null; sortOrder: number }
export interface Workout { id: number; date: string; name: string; category: string; rpe: number | null; notes: string | null; durationMinutes: number | null; exercises: WorkoutExercise[] }

/** Every workout with its exercises. */
export function useAllWorkouts() {
  return useQuery({ queryKey: ['workouts-all'], queryFn: () => api.get<Workout[]>('/api/training/workouts').then(r => r.data) })
}

/** Kilograms moved by one exercise: every set's reps times its weight. */
export const exVolume = (e: { reps: number[] | null; weight: number[] | null }) =>
  (e.reps ?? []).reduce((s, r, i) => s + r * ((e.weight ?? [])[i] ?? 0), 0)
export const workoutVolume = (w: Workout) => w.exercises.reduce((s, e) => s + exVolume(e), 0)
/** The hardest effort recorded on a workout, overall or on any exercise. */
export const peakRpe = (w: Workout) => Math.max(w.rpe ?? 0, ...w.exercises.map(e => e.rpe ?? 0))

/** The Sunday that starts a date's week (the app's weeks run Sunday to Saturday). */
export const sundayOf = (iso: string) => {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - d.getDay())
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Weeks in a row hitting the target, counted back from last week. This week
 * joins the run once it has hit; until then it can't break it.
 */
export function targetStreak(workouts: Workout[], today: string, target: number): { weeks: number; thisWeekHit: boolean } {
  const per = new Map<string, number>()
  for (const w of workouts) { const k = sundayOf(w.date); per.set(k, (per.get(k) ?? 0) + 1) }
  const cur = sundayOf(today)
  const thisWeekHit = (per.get(cur) ?? 0) >= target
  let weeks = thisWeekHit ? 1 : 0
  const d = new Date(cur + 'T12:00:00')
  for (;;) {
    d.setDate(d.getDate() - 7)
    if ((per.get(sundayOf(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)) ?? 0) >= target) weeks++
    else break
  }
  return { weeks, thisWeekHit }
}

/** Heaviest set per exercise (ties go to more reps, then the earlier date). */
export function personalRecords(workouts: Workout[]) {
  const best = new Map<string, { name: string; kg: number; reps: number; date: string }>()
  for (const w of workouts) for (const e of w.exercises) {
    const name = e.exerciseName.trim()
    ;(e.weight ?? []).forEach((kgv, i) => {
      const reps = (e.reps ?? [])[i] ?? 0
      if (!(kgv > 0) || !(reps > 0)) return
      const b = best.get(name)
      if (!b || kgv > b.kg || (kgv === b.kg && reps > b.reps) || (kgv === b.kg && reps === b.reps && w.date < b.date)) best.set(name, { name, kg: kgv, reps, date: w.date })
    })
  }
  return [...best.values()].sort((a, b) => b.kg - a.kg)
}

/** One exercise over time: the heaviest weight and the best estimated 1RM each session. */
export function exerciseSeries(workouts: Workout[], exercise: string) {
  const out: { date: string; maxKg: number; e1rm: number }[] = []
  for (const w of [...workouts].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
    for (const e of w.exercises) {
      if (e.exerciseName.trim() !== exercise) continue
      const ws = e.weight ?? [], rs = e.reps ?? []
      const maxKg = Math.max(0, ...ws)
      const e1rm = Math.max(0, ...rs.map((r, i) => (ws[i] > 0 && r > 0 && r <= 12 ? ws[i] * (1 + r / 30) : 0)))
      if (maxKg > 0) out.push({ date: w.date, maxKg, e1rm: Math.round(e1rm * 10) / 10 })
    }
  }
  return out
}

// ─── Body weight and the body composition signal ─────────────────────────────

export interface BodyMetric { id: number; date: string; weightKg: number | null; bodyFatPct: number | null; notes: string | null }

export function useBodyMetrics() {
  return useQuery({ queryKey: ['body-metrics'], queryFn: () => api.get<BodyMetric[]>('/api/training/metrics').then(r => r.data) })
}

/** Logs (or corrects) a day's weight; one entry per day. */
export function useLogBody() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { date: string; weightKg?: number | null; bodyFatPct?: number | null; notes?: string | null }) => api.post('/api/training/metrics', b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['body-metrics'] }),
  })
}

/** Corrects any past entry: its date, weight, body fat or note. */
export function useUpdateBody() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...b }: { id: number; date: string; weightKg: number | null; bodyFatPct: number | null; notes: string | null }) => api.put(`/api/training/metrics/${id}`, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['body-metrics'] }),
  })
}

export function useDeleteBody() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/training/metrics/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['body-metrics'] }),
  })
}


// The owner's original insight engine, unchanged in logic and wording; only
// its colours now name a meaning (good / warn / bad) for the skins to paint.
type WeightTrend = 'gaining' | 'stable' | 'dropping'
type LiftTrend   = 'improving' | 'stagnating' | 'declining'

export interface ProgressInsight {
  pattern:    string
  color:      'good' | 'warn' | 'bad'
  what:       string
  why:        string
  action:     string
  weightTrend: WeightTrend | null
  liftTrend:   LiftTrend   | null
  weightChange: number | null
  liftPct:      number | null        // avg % change across tracked exercises
  trackedExercises: number
}

export function computeInsight(metrics: any[], workouts: any[]): ProgressInsight | null {
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
  type PatternDef = { pattern: string; color: 'good' | 'warn' | 'bad'; what: string; why: string; action: string }

  const patterns: Record<string, PatternDef> = {
    recomp: {
      pattern: 'Recomposition',
      color:   'good',
      what:    'Your weight is holding steady while your lifts are getting stronger.',
      why:     'Recomposition (gaining muscle and losing fat simultaneously) is the hardest state to achieve and the most efficient use of your training. It typically means your protein intake, training intensity, and recovery are all dialled in.',
      action:  'Keep doing what you\'re doing. Recomp is slow by nature. Don\'t chase the scale.',
    },
    effectiveBulk: {
      pattern: 'Effective Bulk',
      color:   'good',
      what:    'Your weight is going up and your lifts are following.',
      why:     'This is what a productive gaining phase looks like. The weight you\'re adding is being used to build strength, not just stored as fat. As long as the rate of gain is moderate (0.5–1 kg/month), you\'re likely adding mostly muscle.',
      action:  'Keep the caloric surplus modest. If weight is rising faster than your lifts, pull back slightly on calories.',
    },
    cleanCut: {
      pattern: 'Clean Cut',
      color:   'good',
      what:    'Your weight is dropping while your lifts are holding or improving.',
      why:     'This is the ideal cutting scenario. Maintaining or gaining strength while in a caloric deficit means you\'re preserving muscle mass, which is the whole point of training during a cut. Most people lose strength when cutting; you\'re not.',
      action:  'Ensure protein stays high (2g+ per kg bodyweight). Monitor RPE: if sessions start feeling unusually hard at the same weights, it\'s a sign the deficit is getting too aggressive.',
    },
    overCutting: {
      pattern: 'Cutting Too Aggressively',
      color:   'bad',
      what:    'Your weight is dropping and your lifts are declining with it.',
      why:     'When you lose weight and lose strength at the same time, you\'re in too large a caloric deficit. Your body is breaking down muscle for energy. The weight loss number looks good but you\'re losing the wrong thing.',
      action:  'Reduce the deficit. Aim for 300–500 kcal below maintenance rather than a crash cut. Increase protein. Consider a brief maintenance week to recover.',
    },
    fatGain: {
      pattern: 'Fat Gain Without Muscle',
      color:   'warn',
      what:    'Your weight is going up but your lifts aren\'t responding.',
      why:     'Gaining weight without strength gains means the surplus calories are being stored as fat rather than used to build muscle. This can happen from too large a surplus, insufficient training stimulus, or poor recovery.',
      action:  'Reduce calories to a small surplus (200–300 kcal). Check that your training has progressive overload built in: are you actually trying to add weight to the bar each week?',
    },
    plateau: {
      pattern: 'Plateau',
      color:   'warn',
      what:    'Your weight and your lifts are both stuck.',
      why:     'A plateau means your body has adapted to your current training and nutrition. It\'s not a failure. It\'s your body signalling it needs a new stimulus. Common after 8–12 weeks on the same programme.',
      action:  'Change the stimulus: try adding one rep to each set before adding weight, increase training frequency for lagging exercises, or take a deliberate deload week to reset fatigue.',
    },
    weightOnly: {
      pattern: weightTrend === 'dropping' ? 'Weight Dropping' : weightTrend === 'gaining' ? 'Weight Gaining' : 'Weight Stable',
      color:   weightTrend === 'dropping' ? 'good' : weightTrend === 'gaining' ? 'warn' : 'good',
      what:    `Your body weight is ${weightTrend === 'stable' ? 'holding steady' : weightTrend === 'dropping' ? 'trending down' : 'trending up'}.`,
      why:     'Log your lifts with weights for at least 3 sessions per exercise to unlock strength-vs-weight analysis and get a full picture of what your body composition is doing.',
      action:  'Add weight data to your exercises when logging workouts.',
    },
    liftOnly: {
      pattern: liftTrend === 'improving' ? 'Lifts Improving' : liftTrend === 'declining' ? 'Lifts Declining' : 'Lifts Stagnating',
      color:   liftTrend === 'improving' ? 'good' : liftTrend === 'declining' ? 'bad' : 'warn',
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

