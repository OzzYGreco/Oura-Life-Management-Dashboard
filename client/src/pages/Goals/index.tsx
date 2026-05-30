import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { useGoals, useCreateGoal, useUpdateGoal, useDeleteGoal, useScoreTask, type Goal } from '../../hooks/useGoals'
import { useGoalsSettings, loadGoalsSettings, type GoalsSettings } from '../../hooks/useGoalsSettings'
import { PageShell } from '../../components/layout/PageShell'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageLoader } from '../../components/ui/Spinner'
import { formatDate, cn } from '../../lib/utils'
import { Plus, Trash2, Edit, Target, Trophy, Gift, ChevronDown, ChevronRight, Settings2, CheckCircle2, Flame, RotateCcw } from 'lucide-react'

// ─── Constants ────────────────────────────────────────────────────────────────

const HORIZONS = [
  { id: 'weekly',  label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly',  label: 'Yearly' },
  { id: '3yr',     label: '3-Year' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreColor(earned: number, threshold: number): string {
  // >= 70% of the success threshold = green, below = red
  return earned >= threshold * 0.7 ? 'var(--c-profit)' : 'var(--c-loss)'
}

function getCurrentReward(rewards: any[], total: number) {
  return [...rewards].sort((a, b) => b.minScore - a.minScore).find(r => total >= r.minScore)
}

// ─── Period Tracker helpers ───────────────────────────────────────────────────

function periodLabel(goal: Goal, horizon: string): string {
  const src = goal.periodStart || goal.createdAt
  if (!src) return goal.focus.slice(0, 3)
  const d = new Date(src + (src.includes('T') ? '' : 'T00:00:00Z'))
  if (horizon === 'yearly')  return String(d.getUTCFullYear())
  if (horizon === 'monthly') return d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
  if (horizon === 'weekly')  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  // 3yr
  return d.toLocaleDateString('en-GB', { year: 'numeric', timeZone: 'UTC' })
}

function TrackerStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[56px]">
      <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>{label}</span>
      <span className="text-xl font-black num leading-none" style={{ color }}>{value}</span>
    </div>
  )
}

// ─── Period Tracker ───────────────────────────────────────────────────────────

const BAR_W = 36   // px — fixed bar width
const BAR_GAP = 5  // px — gap between bars

function PeriodTracker({ goals, horizon, onNewPeriod }: {
  goals: Goal[]
  horizon: string
  onNewPeriod: () => void
}) {
  const [hoveredGoal, setHoveredGoal] = useState<Goal | null>(null)
  const scrollRef  = useRef<HTMLDivElement>(null)
  const spacerRef  = useRef<HTMLDivElement>(null)

  const settings  = loadGoalsSettings()
  const threshold = settings.successThresholds[horizon as keyof typeof settings.successThresholds] ?? 7

  // Sort chronologically oldest→newest — must be before any hook that references it
  const sorted = [...goals].sort((a, b) => {
    const da = (a.periodStart || a.createdAt).slice(0, 10)
    const db = (b.periodStart || b.createdAt).slice(0, 10)
    return da.localeCompare(db)
  })

  // Scroll so the active bar sits at 2/3 of the visible width.
  // The spacerRef div must be sized to clientWidth*(2/3) first so the last
  // bar can actually be scrolled that far left.
  const scrollToActive = () => {
    const el     = scrollRef.current
    const spacer = spacerRef.current
    if (!el || el.clientWidth === 0) return
    // Size spacer so the last bar is never clamped before the 2/3 position
    if (spacer) spacer.style.width = `${Math.ceil(el.clientWidth * (2 / 3))}px`
    const activeIdx = sorted.findIndex(g => g.status === 'active')
    const activePos = activeIdx >= 0
      ? activeIdx * (BAR_W + BAR_GAP)
      : sorted.length * (BAR_W + BAR_GAP)
    el.scrollLeft = Math.max(0, activePos - el.clientWidth * (2 / 3) + BAR_W / 2)
  }

  // Reset hover on horizon change
  useEffect(() => { setHoveredGoal(null) }, [horizon])

  // Run after paint so clientWidth is populated; retry after 100 ms for safety
  useLayoutEffect(() => {
    scrollToActive()
    const t = setTimeout(scrollToActive, 100)
    return () => clearTimeout(t)
  }, [sorted.length, horizon])      // eslint-disable-line react-hooks/exhaustive-deps

  // Clamp scroll so users can't drift right past the active bar's 2/3 position
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const activeIdx = sorted.findIndex(g => g.status === 'active')
      if (activeIdx < 0) return
      const maxLeft = Math.max(0, activeIdx * (BAR_W + BAR_GAP) - el.clientWidth * (2 / 3) + BAR_W / 2)
      if (el.scrollLeft > maxLeft) el.scrollLeft = maxLeft
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [sorted.length, horizon])      // eslint-disable-line react-hooks/exhaustive-deps

  const active  = sorted.find(g => g.status === 'active') ?? null
  const past    = sorted.filter(g => g.status !== 'active')
  const beaten  = past.filter(g => g.earnedPoints >= threshold)
  const winRate = past.length > 0 ? Math.round((beaten.length / past.length) * 100) : null

  let streak = 0
  for (const g of [...past].reverse()) {
    if (g.earnedPoints >= threshold) streak++
    else break
  }
  const bestScore = past.length > 0 ? Math.max(...past.map(g => g.earnedPoints)) : null

  const unitLabel = horizon === 'weekly' ? 'Week' : horizon === 'monthly' ? 'Month' : horizon === 'yearly' ? 'Year' : 'Period'
  const unitChar  = horizon === 'weekly' ? 'W' : horizon === 'monthly' ? 'M' : horizon === 'yearly' ? '' : 'P'

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)', boxShadow: 'var(--c-shadow-card)' }}>

      {/* ── Stats row ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-1.5">
          <Flame size={18} style={{ color: streak >= 3 ? '#fb923c' : streak > 0 ? '#fbbf24' : 'var(--c-text-3)', flexShrink: 0 }} />
          <TrackerStat label="Streak" value={`${streak}`}
            color={streak >= 3 ? '#fb923c' : streak > 0 ? '#fbbf24' : 'var(--c-text-3)'} />
        </div>
        <div className="w-px h-8 shrink-0" style={{ background: 'var(--c-border)' }} />
        <TrackerStat label="Win Rate"
          value={winRate !== null ? `${winRate}%` : '--'}
          color={winRate !== null ? (winRate >= 60 ? 'var(--c-profit)' : 'var(--c-loss)') : 'var(--c-text-3)'} />
        <div className="w-px h-8 shrink-0" style={{ background: 'var(--c-border)' }} />
        <TrackerStat label="Beaten"
          value={past.length > 0 ? `${beaten.length}/${past.length}` : '--'}
          color="var(--c-text-1)" />
        <div className="w-px h-8 shrink-0" style={{ background: 'var(--c-border)' }} />
        <TrackerStat label="Best"
          value={bestScore !== null ? `${bestScore} pts` : '--'}
          color="var(--c-text-1)" />
        <div className="flex-1" />
        {sorted.length > 1 && (
          <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>
            {sorted.length} {unitLabel}{sorted.length !== 1 ? 's' : ''} · scroll to explore
          </span>
        )}
        {!active && goals.length > 0 && (
          <button onClick={onNewPeriod}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{ background: 'rgba(129,140,248,0.1)', color: 'var(--c-accent)', border: '1px solid rgba(129,140,248,0.25)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(129,140,248,0.18)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(129,140,248,0.1)' }}>
            <RotateCcw size={11} /> Start Next Period
          </button>
        )}
      </div>

      {/* ── Scrollable bar chart ───────────────────────────────────────── */}
      {sorted.length > 0 ? (
        <>
          <div
            ref={scrollRef}
            className="overflow-x-auto"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--c-border) transparent', paddingTop: 6, paddingBottom: 4 }}>
            {/* Inner row — bars + trailing spacer so last bar can reach the 2/3 scroll position */}
            <div className="flex items-end"
              style={{ gap: BAR_GAP, minWidth: sorted.length * (BAR_W + BAR_GAP) - BAR_GAP }}>
              {sorted.map((g, idx) => {
                const seqNum      = idx + 1
                const isActive    = g.status === 'active'
                const isBeaten    = !isActive && g.earnedPoints >= threshold
                const fillPct     = g.maxPoints > 0 ? Math.min(Math.round((g.earnedPoints / g.maxPoints) * 100), 100) : 0
                const threshPct   = g.maxPoints > 0 ? Math.min(Math.round((threshold / g.maxPoints) * 100), 100) : 0
                const label       = horizon === 'yearly' ? periodLabel(g, horizon) : `${unitChar}${seqNum}`
                const barColor    = isActive ? 'rgba(129,140,248,0.45)' : isBeaten ? 'rgba(52,211,153,0.45)' : 'rgba(248,113,113,0.4)'
                const borderColor = isActive ? 'var(--c-accent)'        : isBeaten ? 'var(--c-profit)'        : 'var(--c-loss)'
                const iconColor   = isActive ? 'var(--c-accent)'        : isBeaten ? 'var(--c-profit)'        : 'var(--c-loss)'

                return (
                  <div key={g.id}
                    className="flex flex-col items-center gap-1 cursor-default shrink-0"
                    style={{ width: BAR_W }}
                    onMouseEnter={() => setHoveredGoal(g)}
                    onMouseLeave={() => setHoveredGoal(null)}>

                    <div className="w-full rounded-lg overflow-hidden relative transition-all duration-150"
                      style={{
                        height: 56,
                        background: 'var(--c-bg-input)',
                        border: `1.5px solid ${borderColor}`,
                        opacity: hoveredGoal && hoveredGoal.id !== g.id ? 0.35 : 1,
                        boxShadow: hoveredGoal?.id === g.id ? `0 0 0 2.5px ${borderColor}` : 'none',
                      }}>
                      <div className="absolute bottom-0 left-0 right-0"
                        style={{ height: `${fillPct}%`, background: barColor }} />
                      {threshPct > 0 && threshPct < 100 && (
                        <div className="absolute left-0 right-0"
                          style={{ bottom: `${threshPct}%`, borderTop: `1px dashed ${isBeaten ? 'var(--c-profit)' : '#fbbf24'}`, opacity: 0.8 }} />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center">
                        {isActive
                          ? <span className="text-[9px] font-black" style={{ color: iconColor }}>▶</span>
                          : isBeaten
                            ? <CheckCircle2 size={10} style={{ color: iconColor }} />
                            : <span className="text-[9px] font-black" style={{ color: iconColor }}>✕</span>
                        }
                      </div>
                    </div>

                    <span className="text-[8px] font-semibold leading-none text-center w-full truncate"
                      style={{ color: hoveredGoal?.id === g.id ? 'var(--c-text-1)' : 'var(--c-text-3)' }}>
                      {label}
                    </span>
                  </div>
                )
              })}
              {/* Trailing spacer — sized to 2/3 of scroll container width by scrollToActive() */}
              <div ref={spacerRef} style={{ flexShrink: 0, height: 1 }} />
            </div>
          </div>

          {/* ── Hover info strip ─────────────────────────────────────── */}
          {hoveredGoal && (() => {
            const hg          = hoveredGoal
            const idx         = sorted.findIndex(g => g.id === hg.id)
            const seqNum      = idx + 1
            const isActive    = hg.status === 'active'
            const isBeaten    = !isActive && hg.earnedPoints >= threshold
            const fillPct     = hg.maxPoints > 0 ? Math.min(Math.round((hg.earnedPoints / hg.maxPoints) * 100), 100) : 0
            const statusColor = isActive ? 'var(--c-accent)' : isBeaten ? 'var(--c-profit)' : 'var(--c-loss)'
            return (
              <div className="mt-3 flex items-center gap-3 px-3 py-2 rounded-xl"
                style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
                <span className="text-xs font-bold shrink-0 num" style={{ color: statusColor }}>
                  {unitChar}{seqNum}
                </span>
                <span className="font-semibold text-sm truncate flex-1" style={{ color: 'var(--c-text-1)' }}>{hg.focus}</span>
                <span className="num text-sm font-bold" style={{ color: statusColor }}>{hg.earnedPoints} / {hg.maxPoints} pts</span>
                <span className="num text-xs" style={{ color: 'var(--c-text-3)' }}>({fillPct}%)</span>
                {hg.periodStart && (
                  <span className="text-xs shrink-0" style={{ color: 'var(--c-text-3)' }}>
                    {formatDate(hg.periodStart)}{hg.periodEnd ? ` – ${formatDate(hg.periodEnd)}` : ''}
                  </span>
                )}
                <span className="text-xs font-semibold px-2 py-0.5 rounded-lg shrink-0"
                  style={{ background: isActive ? 'rgba(129,140,248,0.12)' : isBeaten ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)', color: statusColor }}>
                  {isActive ? 'In progress' : isBeaten ? 'Beaten' : `Missed · needed ${threshold} pts`}
                </span>
              </div>
            )
          })()}
        </>
      ) : (
        <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
          No periods recorded yet. Create your first goal to start the tracker.
        </p>
      )}
    </div>
  )
}

// ─── Goals Settings Modal ────────────────────────────────────────────────────

function GoalsSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, save } = useGoalsSettings()
  const { register, handleSubmit } = useForm<GoalsSettings>({ values: settings })

  const onSubmit = (data: GoalsSettings) => {
    save({
      maxScores: {
        weekly:  Number(data.maxScores.weekly),
        monthly: Number(data.maxScores.monthly),
        yearly:  Number(data.maxScores.yearly),
        '3yr':   Number(data.maxScores['3yr']),
      },
      successThresholds: {
        weekly:  Number(data.successThresholds.weekly),
        monthly: Number(data.successThresholds.monthly),
        yearly:  Number(data.successThresholds.yearly),
        '3yr':   Number(data.successThresholds['3yr']),
      },
    })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Goals Settings" size="sm">
      <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-5">

        {/* Tracker info banner */}
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl"
          style={{ background: 'rgba(129,140,248,0.07)', border: '1px solid rgba(129,140,248,0.18)' }}>
          <Flame size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--c-accent)' }} />
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--c-text-2)' }}>
            The period tracker uses these settings. Success thresholds determine which periods show as beaten (green) or missed (red) in the timeline.
          </p>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-accent)' }}>Max Score per Timeframe</span>
            <div className="flex-1 h-px" style={{ background: 'var(--c-border)' }} />
          </div>
          <p className="text-[11px] mb-3" style={{ color: 'var(--c-text-3)' }}>
            Sets the total points ceiling for each timeframe. Used as the default max when you add tasks to a goal.
          </p>
          <div className="space-y-2">
            {(['weekly', 'monthly', 'yearly', '3yr'] as const).map(h => (
              <div key={h} className="flex items-center gap-3">
                <span className="text-xs font-semibold capitalize w-16" style={{ color: 'var(--c-text-2)' }}>
                  {h === '3yr' ? '3-Year' : h.charAt(0).toUpperCase() + h.slice(1)}
                </span>
                <Input
                  type="number" step="1" min="1"
                  {...register(`maxScores.${h}`)}
                  className="w-20"
                />
                <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>pts max</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-accent)' }}>Success Thresholds</span>
            <div className="flex-1 h-px" style={{ background: 'var(--c-border)' }} />
          </div>
          <p className="text-[11px] mb-3" style={{ color: 'var(--c-text-3)' }}>
            Minimum score to consider a period "successful". Shown as a marker on the progress bar.
          </p>
          <div className="space-y-2">
            {(['weekly', 'monthly', 'yearly', '3yr'] as const).map(h => (
              <div key={h} className="flex items-center gap-3">
                <span className="text-xs font-semibold capitalize w-16" style={{ color: 'var(--c-text-2)' }}>
                  {h === '3yr' ? '3-Year' : h.charAt(0).toUpperCase() + h.slice(1)}
                </span>
                <Input
                  type="number" step="0.5" min="0"
                  {...register(`successThresholds.${h}`)}
                  className="w-20"
                />
                <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>pts to succeed</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-3" style={{ borderTop: '1px solid var(--c-border)' }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Controlled score input ───────────────────────────────────────────────────

function ScoreInput({ task, onScore }: {
  task: { id: number; maxPoints: number; earnedPoints: number | null }
  onScore: (taskId: number, val: number | null) => void
}) {
  const [value, setValue] = useState(task.earnedPoints != null ? String(task.earnedPoints) : '')
  const capped = value !== '' && Number(value) > task.maxPoints

  return (
    <input
      type="number"
      min={0}
      step={0.5}
      value={value}
      onChange={e => setValue(e.target.value)}
      placeholder="0"
      className="w-16 rounded-lg px-2 py-1 text-sm text-center num outline-none transition-all"
      style={{
        background: 'var(--c-bg-input)',
        border: `1px solid ${capped ? '#f97316' : task.earnedPoints != null ? 'rgba(129,140,248,0.3)' : 'var(--c-border)'}`,
        color: capped ? '#f97316' : task.earnedPoints != null ? 'var(--c-accent)' : 'var(--c-text-3)',
      }}
      title={capped ? `Capped at ${task.maxPoints} pts` : undefined}
      onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)' }}
      onKeyDown={e => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        const raw = value === '' ? null : Number(value)
        const clamped = raw === null ? null : Math.min(raw, task.maxPoints)
        setValue(clamped != null ? String(clamped) : '')
        onScore(task.id, clamped)
        // Move focus to the next score input in the same goal card
        const inputs = Array.from(
          (e.currentTarget.closest('[data-goal-tasks]') ?? document).querySelectorAll<HTMLInputElement>('input[type="number"]')
        )
        const idx = inputs.indexOf(e.currentTarget)
        if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus()
        else e.currentTarget.blur()
      }}
      onBlur={() => {
        const raw = value === '' ? null : Number(value)
        const clamped = raw === null ? null : Math.min(raw, task.maxPoints)
        setValue(clamped != null ? String(clamped) : '')
        onScore(task.id, clamped)
      }}
    />
  )
}

// ─── Goal Modal ───────────────────────────────────────────────────────────────

function GoalModal({ open, onClose, horizon, existing }: {
  open: boolean; onClose: () => void; horizon: string; existing?: Goal | null
}) {
  const createGoal  = useCreateGoal()
  const updateGoal  = useUpdateGoal()
  const { settings } = useGoalsSettings()

  // Default max points for new tasks uses the per-timeframe setting
  const defaultTaskMax = settings.maxScores[horizon as keyof typeof settings.maxScores] ?? 10

  const { register, handleSubmit, control } = useForm({
    defaultValues: {
      focus: existing?.focus ?? '',
      periodStart: existing?.periodStart ?? '',
      periodEnd: existing?.periodEnd ?? '',
      tasks: existing?.tasks?.map(t => ({ title: t.title, maxPoints: t.maxPoints, notes: t.notes ?? '' }))
        ?? [{ title: '', maxPoints: defaultTaskMax, notes: '' }],
      rewards: existing?.rewards?.map(r => ({ minScore: r.minScore, reward: r.reward }))
        ?? [{ minScore: 6, reward: '' }, { minScore: 7, reward: '' }, { minScore: 8, reward: '' }, { minScore: 9, reward: '' }, { minScore: 10, reward: '' }],
    },
  })

  const { fields: taskFields, append: addTask, remove: removeTask } = useFieldArray({ control, name: 'tasks' })
  const { fields: rewardFields, append: addReward, remove: removeReward } = useFieldArray({ control, name: 'rewards' })

  const horizonLabel = HORIZONS.find(h => h.id === horizon)?.label ?? horizon

  const onSubmit = async (data: any) => {
    const payload = {
      ...data,
      horizon,
      tasks: data.tasks.filter((t: any) => t.title.trim()).map((t: any) => ({ ...t, maxPoints: Number(t.maxPoints) })),
      rewards: data.rewards.filter((r: any) => r.reward.trim()).map((r: any) => ({ ...r, minScore: Number(r.minScore) })),
    }
    if (existing) await updateGoal.mutateAsync({ id: existing.id, ...payload })
    else await createGoal.mutateAsync(payload)
    onClose()
  }

  const SH = ({ label }: { label: string }) => (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-accent)' }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: 'var(--c-border)' }} />
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title={`${existing ? 'Edit' : 'New'} ${horizonLabel} Goal`} size="lg">
      <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-5">

        {/* Focus + dates */}
        <div>
          <SH label="Focus" />
          <Input label="This period's focus" placeholder="e.g. Trading, System improvement" {...register('focus', { required: true })} />
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Input label="Period Start" type="date" {...register('periodStart')} />
            <Input label="Period End" type="date" {...register('periodEnd')} />
          </div>
        </div>

        {/* Tasks */}
        <div>
          <SH label="Tasks & Points" />
          <p className="text-[11px] mb-3" style={{ color: 'var(--c-text-3)' }}>
            Break your goal into specific tasks. Assign point values based on importance.
          </p>
          <div className="space-y-2">
            {taskFields.map((field, i) => (
              <div key={field.id} className="flex items-start gap-2">
                <input {...register(`tasks.${i}.title`)} placeholder="Task description"
                  className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                  style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }} />
                <div className="flex items-center gap-1 shrink-0">
                  <input {...register(`tasks.${i}.maxPoints`)} type="number" min="0.5" step="0.5" placeholder="pts"
                    className="w-16 rounded-lg px-2 py-2 text-sm text-center num outline-none"
                    style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-accent)' }} />
                  <button type="button" onClick={() => removeTask(i)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0"
                    style={{ color: 'var(--c-text-3)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-loss)'}
                    onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)'}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addTask({ title: '', maxPoints: defaultTaskMax, notes: '' })}
            className="mt-2 text-xs font-medium flex items-center gap-1"
            style={{ color: 'var(--c-accent)' }}>
            <Plus size={12} /> Add task
          </button>
        </div>

        {/* Rewards */}
        <div>
          <SH label="Rewards" />
          <p className="text-[11px] mb-3" style={{ color: 'var(--c-text-3)' }}>
            Set what you earn when you reach each score threshold.
          </p>
          <div className="space-y-2">
            {rewardFields.map((field, i) => (
              <div key={field.id} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 shrink-0">
                  <input {...register(`rewards.${i}.minScore`)} type="number" min="0" step="0.5"
                    className="w-14 rounded-lg px-2 py-2 text-sm text-center num outline-none"
                    style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: '#fbbf24' }} />
                  <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>+</span>
                </div>
                <input {...register(`rewards.${i}.reward`)} placeholder="Reward description"
                  className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                  style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }} />
                <button type="button" onClick={() => removeReward(i)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0"
                  style={{ color: 'var(--c-text-3)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-loss)'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)'}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addReward({ minScore: 5, reward: '' })}
            className="mt-2 text-xs font-medium flex items-center gap-1"
            style={{ color: 'var(--c-accent)' }}>
            <Plus size={12} /> Add reward tier
          </button>
        </div>

        <div className="flex justify-end gap-3 pt-3" style={{ borderTop: '1px solid var(--c-border)' }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={createGoal.isPending || updateGoal.isPending}>
            {existing ? 'Save Changes' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Goal Card ────────────────────────────────────────────────────────────────

function GoalCard({ goal, onCompleted, forceExpanded, seqNum }: {
  goal: Goal; onCompleted?: () => void; forceExpanded?: boolean; seqNum?: number
}) {
  const scoreTask  = useScoreTask()
  const deleteGoal = useDeleteGoal()
  const updateGoal = useUpdateGoal()
  const [editing,         setEditing]         = useState(false)
  const [expanded,        setExpanded]         = useState(forceExpanded ?? true)
  const [confirmComplete, setConfirmComplete]  = useState(false)
  const settings = loadGoalsSettings()

  // Sync with parent collapse/expand all
  useEffect(() => {
    if (forceExpanded !== undefined) setExpanded(forceExpanded)
  }, [forceExpanded])

  const currentReward = getCurrentReward(goal.rewards, goal.earnedPoints)
  const maxPoints  = goal.maxPoints
  const earned     = goal.earnedPoints
  const pct        = goal.progressPct
  const threshold  = settings.successThresholds[goal.horizon as keyof typeof settings.successThresholds] ?? 7
  const thresholdPct = maxPoints > 0 ? Math.min((threshold / maxPoints) * 100, 100) : 0
  const succeeded = earned >= threshold

  return (
    <>
      <div className="rounded-xl overflow-hidden"
        style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)', boxShadow: 'var(--c-shadow-card)' }}>

        {/* Header */}
        <div className="px-4 py-3" style={{ background: 'var(--c-bg-secondary)', borderBottom: '1px solid var(--c-border)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <span className="font-bold text-sm" style={{ color: 'var(--c-text-1)' }}>{goal.focus}</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase"
                  style={{ background: 'rgba(129,140,248,0.12)', color: 'var(--c-accent)', border: '1px solid rgba(129,140,248,0.2)' }}>
                  {goal.horizon}
                </span>
                {seqNum != null && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded num"
                    style={{ background: goal.status === 'active' ? 'rgba(251,191,36,0.12)' : 'var(--c-bg-input)', color: goal.status === 'active' ? '#fbbf24' : 'var(--c-text-3)', border: `1px solid ${goal.status === 'active' ? 'rgba(251,191,36,0.3)' : 'var(--c-border)'}` }}>
                    {goal.horizon === 'weekly' ? 'Week' : goal.horizon === 'monthly' ? 'Month' : goal.horizon === 'yearly' ? 'Year' : 'Period'} {seqNum}
                  </span>
                )}
              </div>
              {(goal.periodStart || goal.periodEnd) && (
                <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>
                  {goal.periodStart && formatDate(goal.periodStart)}
                  {goal.periodStart && goal.periodEnd && ' – '}
                  {goal.periodEnd && formatDate(goal.periodEnd)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Complete Period — active goals only */}
              {goal.status === 'active' && !confirmComplete && (
                <button
                  onClick={() => setConfirmComplete(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all"
                  style={{ background: 'rgba(52,211,153,0.1)', color: 'var(--c-profit)', border: '1px solid rgba(52,211,153,0.25)' }}
                  title="Archive this period and record the result in the tracker"
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(52,211,153,0.18)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(52,211,153,0.1)' }}>
                  <CheckCircle2 size={11} /> Complete
                </button>
              )}
              {confirmComplete && (
                <>
                  <span className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>Archive period?</span>
                  <button
                    onClick={async () => {
                      await updateGoal.mutateAsync({ id: goal.id, status: 'past' })
                      setConfirmComplete(false)
                      onCompleted?.()
                    }}
                    disabled={updateGoal.isPending}
                    className="px-2 py-1 rounded-lg text-[11px] font-semibold transition-all"
                    style={{ background: 'rgba(52,211,153,0.15)', color: 'var(--c-profit)', border: '1px solid rgba(52,211,153,0.3)' }}>
                    Yes
                  </button>
                  <button
                    onClick={() => setConfirmComplete(false)}
                    className="px-2 py-1 rounded-lg text-[11px] font-semibold transition-all"
                    style={{ background: 'var(--c-bg-input)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}>
                    No
                  </button>
                </>
              )}

              <button onClick={() => setEditing(true)}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-accent)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-accent)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border)' }}>
                <Edit size={12} />
              </button>
              <button onClick={() => deleteGoal.mutate(goal.id)}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-loss)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-loss)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border)' }}>
                <Trash2 size={12} />
              </button>
              <button onClick={() => setExpanded(!expanded)}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}>
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            </div>
          </div>

          {/* Score summary + progress bar with threshold marker */}
          <div className="flex items-center gap-3 mt-2">
            <div className="flex-1 relative h-2 rounded-full overflow-visible" style={{ background: 'var(--c-border)' }}>
              {/* Fill */}
              <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: succeeded ? 'var(--c-profit)' : 'var(--c-loss)' }} />
              {/* Success threshold marker */}
              {thresholdPct > 0 && thresholdPct < 100 && (
                <div className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full z-10"
                  style={{ left: `${thresholdPct}%`, background: succeeded ? 'var(--c-profit)' : '#fbbf24', boxShadow: `0 0 4px ${succeeded ? 'var(--c-profit)' : '#fbbf24'}` }}
                  title={`Success = ${threshold} pts`}
                />
              )}
            </div>
            <span className="num font-bold text-sm shrink-0" style={{ color: scoreColor(earned, threshold) }}>
              {earned} / {maxPoints} pts
            </span>
            <span className="num text-xs shrink-0" style={{ color: 'var(--c-text-3)' }}>
              {pct}%
            </span>
          </div>

          {/* Current reward earned */}
          {currentReward && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <Gift size={11} style={{ color: '#fbbf24' }} />
              <span className="text-[11px] font-semibold" style={{ color: '#fbbf24' }}>
                Earned: {currentReward.reward}
              </span>
            </div>
          )}
        </div>

        {/* Tasks table */}
        {expanded && (
          <div data-goal-tasks>
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_80px_90px] px-4 py-1.5"
              style={{ borderBottom: '1px solid var(--c-border-subtle)', background: 'var(--c-bg-input)' }}>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Task</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-center" style={{ color: 'var(--c-text-3)' }}>Max</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-center" style={{ color: 'var(--c-text-3)' }}>Score</span>
            </div>

            {goal.tasks.map(task => (
              <div key={task.id} className="grid grid-cols-[1fr_80px_90px] items-center px-4 py-2.5"
                style={{ borderBottom: '1px solid var(--c-border-subtle)' }}>
                <span className="text-sm" style={{ color: 'var(--c-text-1)' }}>{task.title}</span>
                <span className="num text-sm text-center font-medium" style={{ color: 'var(--c-text-3)' }}>
                  {task.maxPoints} pts
                </span>
                <div className="flex items-center justify-center">
                  <ScoreInput
                    task={task}
                    onScore={(taskId, val) => scoreTask.mutate({ taskId, earnedPoints: val })}
                  />
                </div>
              </div>
            ))}

            {/* Total row */}
            <div className="grid grid-cols-[1fr_80px_90px] items-center px-4 py-3"
              style={{ background: 'rgba(99,102,241,0.05)', borderTop: '2px solid rgba(99,102,241,0.2)' }}>
              <span className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--c-text-1)' }}>Total</span>
              <span className="num text-sm text-center font-bold" style={{ color: 'var(--c-text-2)' }}>
                {maxPoints} pts
              </span>
              <span className="num text-sm text-center font-bold" style={{ color: scoreColor(earned, threshold) }}>
                {earned}
              </span>
            </div>
          </div>
        )}

        {/* Rewards row */}
        {expanded && goal.rewards.length > 0 && (
          <div className="px-4 py-3 flex items-center gap-2 flex-wrap"
            style={{ borderTop: '1px solid var(--c-border)', background: 'var(--c-bg-input)' }}>
            <Trophy size={13} style={{ color: '#fbbf24', flexShrink: 0 }} />
            {[...goal.rewards].sort((a, b) => a.minScore - b.minScore).map(r => {
              const active = earned >= r.minScore
              return (
                <span key={r.id}
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-md transition-all"
                  style={active ? {
                    background: 'rgba(251,191,36,0.15)',
                    color: '#fbbf24',
                    border: '1px solid rgba(251,191,36,0.3)',
                  } : {
                    background: 'var(--c-bg-input)',
                    color: 'var(--c-text-3)',
                    border: '1px solid var(--c-border)',
                    opacity: 0.6,
                  }}>
                  {r.minScore}+ {r.reward}
                </span>
              )
            })}
          </div>
        )}
      </div>

      <GoalModal open={editing} onClose={() => setEditing(false)} horizon={goal.horizon} existing={goal} />
    </>
  )
}

// ─── Goals Page ───────────────────────────────────────────────────────────────

export function GoalsPage() {
  const [horizon, setHorizon] = useState('weekly')
  const [creating, setCreating] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pastExpanded, setPastExpanded] = useState(false)  // past cards collapsed by default
  const [newPeriodPrompt, setNewPeriodPrompt] = useState(false)
  const { data: goals, isPending } = useGoals(horizon)

  // Reset when horizon changes
  useEffect(() => { setPastExpanded(false) }, [horizon])

  // Sort all goals chronologically to derive sequence numbers
  const allSorted = [...(goals ?? [])].sort((a, b) =>
    (a.periodStart || a.createdAt).slice(0, 10).localeCompare((b.periodStart || b.createdAt).slice(0, 10))
  )
  const seqOf = (g: Goal) => allSorted.findIndex(x => x.id === g.id) + 1

  const active = goals?.filter(g => g.status === 'active') ?? []
  // Most recent period first so the just-completed week is immediately visible
  const past = [...(goals?.filter(g => g.status !== 'active') ?? [])].sort((a, b) => {
    const da = (a.periodStart || a.createdAt).slice(0, 10)
    const db = (b.periodStart || b.createdAt).slice(0, 10)
    return db.localeCompare(da)
  })

  return (
    <PageShell
      title="Goals"
      action={
        <div className="flex items-center gap-3">
          <Tabs tabs={HORIZONS} active={horizon} onChange={setHorizon} />
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-accent)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-accent)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border)' }}
            title="Goals Settings"
          >
            <Settings2 size={14} />
          </button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> New {HORIZONS.find(h => h.id === horizon)?.label}
          </Button>
        </div>
      }
    >
      {isPending ? <PageLoader /> : (
        <div className="space-y-5">

          {/* ── Period Tracker (always visible) ─────────────────────── */}
          <PeriodTracker
            goals={goals ?? []}
            horizon={horizon}
            onNewPeriod={() => setCreating(true)}
          />

          {/* ── Goal cards ──────────────────────────────────────────── */}
          {!goals?.length ? (
            <EmptyState
              icon={<Target size={32} />}
              title={`No ${HORIZONS.find(h => h.id === horizon)?.label} goals yet`}
              description="Break your focus into scored tasks and set rewards for hitting your targets."
              action={<Button onClick={() => setCreating(true)}><Plus size={14} /> Create Goal</Button>}
            />
          ) : (
            <>
              {active.length > 0 && (
                <div className="space-y-4">
                  {active.map(g => (
                    <GoalCard
                      key={g.id}
                      goal={g}
                      seqNum={seqOf(g)}
                      onCompleted={() => setNewPeriodPrompt(true)}
                    />
                  ))}
                </div>
              )}

              {past.length > 0 && (
                <div>
                  <div className="flex items-center gap-3 mb-3 mt-2">
                    <p className="text-xs font-semibold uppercase tracking-widest flex-1"
                      style={{ color: 'var(--c-text-3)' }}>Past Periods ({past.length})</p>
                    <button
                      onClick={() => setPastExpanded(v => !v)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
                      style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--c-text-1)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--c-border-mid)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--c-text-3)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--c-border)' }}>
                      {pastExpanded
                        ? <><ChevronDown size={11} /> Collapse All</>
                        : <><ChevronRight size={11} /> Expand All</>}
                    </button>
                  </div>
                  <div className="space-y-3">
                    {past.map(g => (
                      <GoalCard key={g.id} goal={g} seqNum={seqOf(g)} forceExpanded={pastExpanded} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <GoalModal open={creating} onClose={() => setCreating(false)} horizon={horizon} />
      <GoalsSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* New period prompt — shown after completing a period */}
      <Modal open={newPeriodPrompt} onClose={() => setNewPeriodPrompt(false)} title="Period Complete!" size="sm">
        <div className="p-6 flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(52,211,153,0.12)', border: '2px solid rgba(52,211,153,0.35)' }}>
            <CheckCircle2 size={30} style={{ color: 'var(--c-profit)' }} />
          </div>
          <div>
            <p className="text-base font-bold mb-1" style={{ color: 'var(--c-text-1)' }}>
              {horizon === 'weekly' ? 'Week' : horizon === 'monthly' ? 'Month' : horizon === 'yearly' ? 'Year' : 'Period'} archived successfully
            </p>
            <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
              It's saved in your Past Periods. Would you like to set up goals for the next{' '}
              {horizon === 'weekly' ? 'week' : horizon === 'monthly' ? 'month' : horizon === 'yearly' ? 'year' : 'period'}?
            </p>
          </div>
          <div className="flex gap-3 pt-1">
            <Button variant="secondary" onClick={() => setNewPeriodPrompt(false)}>Not now</Button>
            <Button onClick={() => { setNewPeriodPrompt(false); setCreating(true) }}>
              <Plus size={14} /> Set Up Next {horizon === 'weekly' ? 'Week' : horizon === 'monthly' ? 'Month' : horizon === 'yearly' ? 'Year' : 'Period'}
            </Button>
          </div>
        </div>
      </Modal>
    </PageShell>
  )
}
