/**
 * Headless core of the Training page, shared by every skin.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

/** A set as typed: the weight and the reps. A lift is measured by its top set (heaviest weight, ties to more reps). */
export interface TopSet { date: string; kg: number; reps: number }
export interface Lift {
  name: string
  sessions: number
  lastDate: string
  last: TopSet                 // the top set of the most recent session
  best: TopSet                 // the best top set ever, and when it was first done
  before: TopSet | null        // the top set from the last session at least 8 weeks ago
  bests: (TopSet & { prev: { kg: number; reps: number } })[]  // every session that beat all before it
  history: TopSet[]            // the top set of every session, oldest first
}

/** Is set a better than set b: heavier, or the same weight for more reps. */
export const beats = (a: { kg: number; reps: number }, b: { kg: number; reps: number }) => a.kg > b.kg || (a.kg === b.kg && a.reps > b.reps)
export const sameSet = (a: { kg: number; reps: number }, b: { kg: number; reps: number }) => a.kg === b.kg && a.reps === b.reps
/** A weight as it was typed: 82.45 stays 82.45, 80 stays 80. */
export const kgs = (n: number) => String(Math.round(n * 100) / 100)
export const setText = (s: { kg: number; reps: number }) => `${kgs(s.kg)} kg × ${s.reps}`
/** The top set of one exercise's sets as logged. */
export function topOf(reps: number[], weight: number[]) {
  let top: { kg: number; reps: number } | null = null
  reps.forEach((r, i) => { const k = weight[i] ?? 0; if (k > 0 && r > 0 && (!top || beats({ kg: k, reps: r }, top))) top = { kg: k, reps: r } })
  return top as { kg: number; reps: number } | null
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


// ─── Lift verdicts: one answer per lift, shared by the list and the read ────

const fmtShort = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const dayDiff = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 864e5)

/** The gap between two sets in words: "20 kg", or "2 reps" at the same weight. */
const gap = (a: { kg: number; reps: number }, b: { kg: number; reps: number }) =>
  a.kg !== b.kg ? `${kgs(Math.abs(a.kg - b.kg))} kg` : plural(Math.abs(a.reps - b.reps), 'rep')

export type Verdict = { kind: 'up' | 'best' | 'below' | 'new'; text: string; sub: string }
/**
 * One answer per lift, in this order: at your best; up on 8+ weeks ago; below
 * your best by how much. The second line names the set it was compared with.
 * "Better" is always a real set: heavier, or the same weight for more reps.
 */
export function verdict(l: Lift): Verdict {
  if (l.sessions < 2) return { kind: 'new', text: 'One session so far', sub: '' }
  if (sameSet(l.last, l.best)) {
    const fresh = l.last.date === l.best.date && l.bests.length > 0
    return { kind: 'best', text: fresh ? 'New best' : 'Matched your best', sub: fresh ? `Was ${setText(l.bests[l.bests.length - 1].prev)}` : `First done ${fmtShort(l.best.date)}` }
  }
  if (l.before && beats(l.last, l.before)) return { kind: 'up', text: `Up ${gap(l.last, l.before)} since ${fmtShort(l.before.date)}`, sub: `Then ${setText(l.before)}` }
  return { kind: 'below', text: `${gap(l.last, l.best)} under your best`, sub: `Best ${setText(l.best)}, ${fmtShort(l.best.date)}` }
}

// ─── The read: body weight and strength together ────────────────────────────
// Strength comes from the same per-lift verdicts the list shows, so the two
// can never disagree. Weight compares the average of the first week of
// weigh-ins with the last week, since one reading against another is mostly
// water. The scale cannot tell muscle from fat, so the read says what it can
// and points at body fat for the rest.

type WeightTrend = 'gaining' | 'stable' | 'dropping'
type LiftTrend   = 'improving' | 'holding' | 'declining'

/** Day-to-day water swings: a change of weekly averages smaller than this is "stable". */
const WEIGHT_BAND_KG = 1
/** Faster than this per month and lean gain alone cannot explain it. */
const FAST_GAIN_KG_MONTH = 1
/** The weight trend looks at the last eight weeks of weigh-ins. */
const WEIGHT_WINDOW_DAYS = 56

export interface WeekAvg { from: string; to: string; kg: number; n: number }
export interface ProgressInsight {
  pattern:    string
  color:      'good' | 'warn' | 'bad'
  what:       string
  why:        string
  action:     string
  weightTrend: WeightTrend | null
  liftTrend:   LiftTrend   | null
  /** Weekly averages compared, oldest first, with the change between them. */
  weight: { early: WeekAvg; late: WeekAvg; change: number; days: number; perMonth: number } | null
  /** Body fat, first and last entry inside the same window, when logged. */
  fat: { first: { date: string; pct: number }; last: { date: string; pct: number } } | null
  lifts: { good: number; below: number; total: number }
}

const avgOf = (rows: { date: string; weightKg: number }[]): WeekAvg => ({
  from: rows[0].date, to: rows[rows.length - 1].date, n: rows.length,
  kg: Math.round((rows.reduce((s, r) => s + r.weightKg, 0) / rows.length) * 100) / 100,
})

/** The weight trend, or null when there is not yet enough to call one. */
export function weightRead(metrics: { date: string; weightKg: number | null }[]) {
  const all = metrics.filter(m => m.weightKg != null).map(m => ({ date: m.date, weightKg: m.weightKg! })).sort((a, b) => a.date.localeCompare(b.date))
  if (all.length < 2) return null
  const end = all[all.length - 1].date
  const rows = all.filter(r => dayDiff(r.date, end) <= WEIGHT_WINDOW_DAYS)
  const start = rows[0].date
  const early = rows.filter(r => dayDiff(start, r.date) < 7)
  const late = rows.filter(r => dayDiff(r.date, end) < 7 && !early.includes(r))
  if (!late.length) return null
  const e = avgOf(early), l = avgOf(late)
  const change = Math.round((l.kg - e.kg) * 100) / 100
  const days = dayDiff(start, end)
  const trend: WeightTrend = Math.abs(change) < WEIGHT_BAND_KG ? 'stable' : change > 0 ? 'gaining' : 'dropping'
  return { trend, early: e, late: l, change, days, perMonth: days > 0 ? Math.round((change / days) * 30 * 10) / 10 : 0 }
}

export function computeInsight(
  metrics: { date: string; weightKg: number | null; bodyFatPct?: number | null }[],
  lifts: Lift[],
): ProgressInsight | null {
  // ── Strength: the list's own verdicts ────────────────────────────────────
  const kinds = lifts.map(l => verdict(l).kind).filter(k => k !== 'new')
  const good = kinds.filter(k => k === 'best' || k === 'up').length
  const below = kinds.length - good
  // Improving when lifts at their best or up outnumber those below by 1.5 to 1;
  // declining the other way round. Anything between is holding, never the worse label.
  const liftTrend: LiftTrend | null = !kinds.length ? null
    : good >= below * 1.5 ? 'improving'
    : below >= good * 1.5 ? 'declining'
    : 'holding'

  // ── Weight ────────────────────────────────────────────────────────────────
  const w = weightRead(metrics)
  const weightTrend = w?.trend ?? null
  const fast = !!w && w.perMonth > FAST_GAIN_KG_MONTH

  const fatRows = w ? metrics.filter(m => m.bodyFatPct != null && m.date >= w.early.from).sort((a, b) => a.date.localeCompare(b.date)) : []
  const fat = fatRows.length >= 2 ? {
    first: { date: fatRows[0].date, pct: fatRows[0].bodyFatPct! },
    last: { date: fatRows[fatRows.length - 1].date, pct: fatRows[fatRows.length - 1].bodyFatPct! },
  } : null

  if (!weightTrend && !liftTrend) return null

  const scaleNote = fat ? '' : ' The scale alone cannot tell muscle from fat: log body fat with your weight and this read can say which it is.'
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
      why:     'This is what a productive gaining phase looks like. The weight you\'re adding is being used to build strength, not just stored as fat. As long as the rate of gain is moderate (0.5–1 kg/month), you\'re likely adding mostly muscle.' + scaleNote,
      action:  'Keep the caloric surplus modest. If weight is rising faster than your lifts, pull back slightly on calories.',
    },
    fastBulk: {
      pattern: 'Bulking Fast',
      color:   'warn',
      what:    `Your lifts are going up, and your weight is rising about ${kgs(w?.perMonth ?? 0)} kg a month.`,
      why:     'Strength is coming, so the training is working. But muscle grows slowly, around 0.5–1 kg a month at best, so gain faster than that is likely to be partly fat or water.' + scaleNote,
      action:  'Trim the surplus a little (about 200 kcal a day) and see if your lifts keep climbing. If they do, the extra was not helping.',
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
    gainHolding: {
      pattern: 'Weight Up, Lifts Holding',
      color:   'warn',
      what:    'Your weight is going up while most of your lifts are holding where they were.',
      why:     'Gaining weight without your lifts climbing with it can mean some of the surplus is going to fat. It can also be a slow patch before the next jump.' + scaleNote,
      action:  'Aim for one more rep on your heaviest set each session (the Aim column). If your lifts still hold in a few weeks, bring calories down to a small surplus (200–300 kcal).',
    },
    fatGain: {
      pattern: 'Fat Gain Without Muscle',
      color:   'bad',
      what:    'Your weight is going up while most of your lifts are below their best.',
      why:     'Gaining weight while getting weaker means the surplus calories are being stored as fat rather than used to build muscle. This can happen from too large a surplus, insufficient training stimulus, or poor recovery.',
      action:  'Reduce calories to a small surplus (200–300 kcal). Check that your training has progressive overload built in: are you actually trying to add weight to the bar each week?',
    },
    plateau: {
      pattern: 'Plateau',
      color:   'warn',
      what:    liftTrend === 'declining' ? 'Your weight is steady and most of your lifts are below their best.' : 'Your weight and your lifts are both holding.',
      why:     'A plateau means your body has adapted to your current training and nutrition. It\'s not a failure. It\'s your body signalling it needs a new stimulus. Common after 8–12 weeks on the same programme.',
      action:  'Change the stimulus: try adding one rep to each set before adding weight, increase training frequency for lagging exercises, or take a deliberate deload week to reset fatigue.',
    },
    weightOnly: {
      pattern: weightTrend === 'dropping' ? 'Weight Dropping' : weightTrend === 'gaining' ? 'Weight Gaining' : 'Weight Stable',
      color:   weightTrend === 'gaining' ? 'warn' : 'good',
      what:    `Your body weight is ${weightTrend === 'stable' ? 'holding steady' : weightTrend === 'dropping' ? 'trending down' : 'trending up'}.`,
      why:     'Log your lifts with weights for at least 2 sessions per exercise to unlock strength-vs-weight analysis and get a full picture of what your body composition is doing.',
      action:  'Add weight data to your exercises when logging workouts.',
    },
    liftOnly: {
      pattern: liftTrend === 'improving' ? 'Lifts Improving' : liftTrend === 'declining' ? 'Lifts Declining' : 'Lifts Holding',
      color:   liftTrend === 'improving' ? 'good' : liftTrend === 'declining' ? 'bad' : 'warn',
      what:    `${good} of ${kinds.length} lifts are at your best or up on 8 weeks ago.`,
      why:     'Log your body weight regularly to unlock the full picture. Knowing whether you\'re gaining or losing weight alongside your strength trend reveals what\'s actually happening to your body composition.',
      action:  'Log your body weight at least once a week, same time of day.',
    },
  }

  let key: string
  if (!weightTrend) key = 'liftOnly'
  else if (!liftTrend) key = 'weightOnly'
  else if (weightTrend === 'stable'   && liftTrend === 'improving') key = 'recomp'
  else if (weightTrend === 'gaining'  && liftTrend === 'improving') key = fast ? 'fastBulk' : 'effectiveBulk'
  else if (weightTrend === 'gaining'  && liftTrend === 'holding')   key = 'gainHolding'
  else if (weightTrend === 'gaining'  && liftTrend === 'declining') key = 'fatGain'
  else if (weightTrend === 'dropping' && liftTrend !== 'declining') key = 'cleanCut'
  else if (weightTrend === 'dropping' && liftTrend === 'declining') key = 'overCutting'
  else key = 'plateau'

  return {
    ...patterns[key], weightTrend, liftTrend,
    weight: w ? { early: w.early, late: w.late, change: w.change, days: w.days, perMonth: w.perMonth } : null,
    fat, lifts: { good, below, total: kinds.length },
  }
}

