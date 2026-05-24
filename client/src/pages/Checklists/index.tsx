import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useForm } from 'react-hook-form'
import {
  useChecklistTemplates, useChecklistEntries,
  useCreateTemplate, useUpdateTemplate, useDeleteTemplate, useToggleChecklistItem,
  useChecklistTaskStreaks, useArchiveCompleted,
  useAddAdhocItems, useDeleteChecklistItem,
} from '../../hooks/useChecklists'
import { loadNotifSettings, saveNotifSettings, type NotifSettings } from '../../hooks/useChecklistNotifications'
import { PageShell } from '../../components/layout/PageShell'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { PageLoader } from '../../components/ui/Spinner'
import { EmptyState } from '../../components/ui/EmptyState'
import { today, cn } from '../../lib/utils'
import { EISENHOWER } from '../../lib/constants'
import { Plus, Trash2, CheckSquare, Settings, Check, Zap, Clock, RefreshCw, Power, ChevronDown, ChevronRight, Archive, Bell, BellOff } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface TaskItem {
  id?: number
  label: string
  time: string
  importance: string
  repeatDaily: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────


function getImportance(key: string) {
  return EISENHOWER.find(e => e.key === key)
}

function ImportanceBadge({ code }: { code?: string | null }) {
  if (!code) return null
  const e = getImportance(code)
  if (!e) return null
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide shrink-0"
      style={{ background: e.bg, color: e.color, border: `1px solid ${e.border}` }}
    >
      {e.key}
    </span>
  )
}

// ─── Time status helpers ──────────────────────────────────────────────────────

function parseTaskTime(timeStr: string): Date | null {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!match) return null
  let hours = parseInt(match[1])
  const minutes = parseInt(match[2])
  const period = match[3].toUpperCase()
  if (period === 'PM' && hours < 12) hours += 12
  if (period === 'AM' && hours === 12) hours = 0
  const d = new Date()
  d.setHours(hours, minutes, 0, 0)
  return d
}

type TimeStatus = 'early' | 'soon' | 'now' | 'late' | 'none'

function getTimeStatus(timeStr: string | null | undefined): TimeStatus {
  if (!timeStr) return 'none'
  const t = parseTaskTime(timeStr)
  if (!t) return 'none'
  const diffMin = (t.getTime() - Date.now()) / 60000
  if (diffMin > 60) return 'early'
  if (diffMin > 15) return 'soon'
  if (diffMin > -15) return 'now'
  return 'late'
}

const TIME_STYLE: Record<TimeStatus, { color: string; label: string }> = {
  early: { color: 'var(--c-text-3)',  label: '' },
  soon:  { color: '#fbbf24',          label: '· soon' },
  now:   { color: '#f97316',          label: '· now' },
  late:  { color: 'var(--c-loss)',    label: '· late' },
  none:  { color: 'var(--c-text-3)',  label: '' },
}

// ─── Plain-text parser ────────────────────────────────────────────────────────

function parseChecklistText(text: string): TaskItem[] {
  const lines = text.split('\n')
  const results: TaskItem[] = []

  for (const line of lines) {
    const raw = line.replace(/^[\*\-•]\s*/, '').trim()
    if (!raw) continue

    // Strip emojis and normalize whitespace
    const clean = raw.replace(/[✅❌✅❌]/g, '').replace(/\s+/g, ' ').trim()

    // Extract importance — must be last word, one of the known codes (longest match first)
    const impMatch = clean.match(/\s+(NUNI|NUI|UNI|UI)\s*$/i)
    const importance = impMatch?.[1]?.toUpperCase() ?? ''
    const withoutImp = impMatch ? clean.slice(0, impMatch.index).trim() : clean

    // Extract time — pattern like "at 09:15 AM" or "at 14:30 PM"
    const timeMatch = withoutImp.match(/\bat\s+(\d{1,2}:\d{2}\s*[APap][Mm])\s*$/i)
    const time = timeMatch ? timeMatch[1].replace(/\s+/, '').toUpperCase() : ''
    const label = timeMatch ? withoutImp.slice(0, timeMatch.index).trim() : withoutImp

    if (label) {
      results.push({ label, time, importance, repeatDaily: true })
    }
  }

  return results
}

// ─── Quick Parser ─────────────────────────────────────────────────────────────

function QuickParser({ onApply }: { onApply: (tasks: TaskItem[]) => void }) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<TaskItem[] | null>(null)

  const handleParse = () => {
    const tasks = parseChecklistText(text)
    setParsed(tasks)
  }

  const handleApply = () => {
    if (parsed?.length) {
      onApply(parsed)
      setText('')
      setParsed(null)
    }
  }

  return (
    <div className="rounded-xl p-4 mb-4" style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.18)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Zap size={13} style={{ color: 'var(--c-accent)' }} />
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--c-accent)' }}>Paste & Parse</span>
        <span className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>Paste your routine text to generate tasks instantly</span>
      </div>
      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setParsed(null) }}
        rows={4}
        placeholder={'* Wake up & freshen up at 09:15 AM UI\n* Coffee/ Breakfast at 09:30 AM NUI\n* ...'}
        className="w-full rounded-lg px-3 py-2 text-xs font-mono outline-none resize-none mb-3"
        style={{ background: 'var(--c-bg-input)', border: '1px solid rgba(99,102,241,0.25)', color: 'var(--c-text-1)' }}
        onFocus={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)' }}
      />
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" variant="secondary" onClick={handleParse} disabled={!text.trim()}>
          Parse
        </Button>
        {parsed && (
          <>
            <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>
              Found <strong style={{ color: 'var(--c-accent)' }}>{parsed.length}</strong> tasks
            </span>
            <Button type="button" size="sm" onClick={handleApply}>
              Add to Template →
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Time Picker ─────────────────────────────────────────────────────────────

const HOURS   = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

function TimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const hasTime = !!value
  const matchRe = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  const h       = matchRe ? parseInt(matchRe[1]) : 9
  const m       = matchRe ? parseInt(matchRe[2]) : 0
  const period  = (matchRe ? matchRe[3].toUpperCase() : 'AM') as 'AM' | 'PM'

  const emit = (nh: number, nm: number, np: 'AM' | 'PM') =>
    onChange(`${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}${np}`)

  // Position the floating panel: below the trigger by default, flip upward if it would clip
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r      = btnRef.current.getBoundingClientRect()
    const popW   = 236
    const popH   = popRef.current?.offsetHeight ?? 380   // measured after first paint
    const left   = Math.min(r.left, window.innerWidth - popW - 8)
    const below  = r.bottom + 6
    const above  = r.top - popH - 6
    const top    = below + popH > window.innerHeight - 8 && above > 8 ? above : below
    setPos({ top, left: Math.max(8, left) })
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node))
        setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleOpen = () => {
    if (!hasTime) onChange('09:00AM')
    setOpen(true)
  }

  return (
    <div className="flex items-center gap-1 shrink-0">
      {/* Trigger */}
      <button ref={btnRef} type="button" onClick={handleOpen}
        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-all"
        style={hasTime
          ? { background: open ? 'rgba(129,140,248,0.15)' : 'var(--c-bg-input)', color: 'var(--c-text-1)', border: `1px solid ${open ? 'var(--c-accent)' : 'var(--c-border)'}` }
          : { background: 'transparent', color: 'var(--c-text-3)', border: '1px solid transparent' }}
        onMouseEnter={e => { if (!hasTime) { (e.currentTarget as HTMLElement).style.background = 'var(--c-bg-input)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--c-border)' } }}
        onMouseLeave={e => { if (!hasTime) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.borderColor = 'transparent' } }}>
        <Clock size={11} style={{ color: hasTime ? 'var(--c-text-3)' : 'var(--c-text-3)' }} />
        {hasTime
          ? <span className="num">{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')} {period}</span>
          : <span>+ time</span>}
      </button>

      {/* Clear */}
      {hasTime && (
        <button type="button" onClick={() => { onChange(''); setOpen(false) }}
          className="w-4 h-4 flex items-center justify-center rounded text-sm leading-none transition-colors"
          style={{ color: 'var(--c-text-3)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--c-loss)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--c-text-3)'}>
          ×
        </button>
      )}

      {/* Floating panel — portaled to body so modal overflow can't clip it */}
      {open && createPortal(
        <div ref={popRef} className="fixed z-[300] rounded-2xl p-4 overflow-y-auto"
          style={{ top: pos.top, left: pos.left, width: 236, maxHeight: 'calc(100vh - 24px)', background: 'var(--c-bg-card)', border: '1px solid var(--c-border-mid)', boxShadow: '0 16px 48px rgba(0,0,0,0.65)' }}>

          {/* Large time display + AM/PM */}
          <div className="flex items-center justify-center gap-3 mb-4">
            <span className="num text-4xl font-black tracking-tight" style={{ color: 'var(--c-text-1)' }}>
              {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}
            </span>
            <div className="flex flex-col gap-1">
              {(['AM', 'PM'] as const).map(p => (
                <button key={p} type="button" onClick={() => emit(h, m, p)}
                  className="px-2.5 py-0.5 rounded-lg text-xs font-bold transition-all"
                  style={{ background: period === p ? 'rgba(129,140,248,0.25)' : 'var(--c-bg-input)', color: period === p ? 'var(--c-accent)' : 'var(--c-text-3)', border: `1px solid ${period === p ? 'var(--c-accent)' : 'var(--c-border)'}` }}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Hour grid */}
          <p className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--c-text-3)' }}>Hour</p>
          <div className="grid grid-cols-6 gap-1 mb-3">
            {HOURS.map(hr => (
              <button key={hr} type="button" onClick={() => emit(hr, m, period)}
                className="rounded-lg py-1.5 text-xs num font-semibold transition-all"
                style={{ background: hr === h ? 'rgba(129,140,248,0.25)' : 'var(--c-bg-input)', color: hr === h ? 'var(--c-accent)' : 'var(--c-text-2)', border: `1px solid ${hr === h ? 'rgba(129,140,248,0.4)' : 'var(--c-border)'}` }}>
                {String(hr).padStart(2, '0')}
              </button>
            ))}
          </div>

          {/* Minute grid */}
          <p className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--c-text-3)' }}>Minute</p>
          <div className="grid grid-cols-6 gap-1 mb-4">
            {MINUTES.map(min => (
              <button key={min} type="button" onClick={() => emit(h, min, period)}
                className="rounded-lg py-1.5 text-xs num font-semibold transition-all"
                style={{ background: min === m ? 'rgba(129,140,248,0.25)' : 'var(--c-bg-input)', color: min === m ? 'var(--c-accent)' : 'var(--c-text-2)', border: `1px solid ${min === m ? 'rgba(129,140,248,0.4)' : 'var(--c-border)'}` }}>
                {String(min).padStart(2, '0')}
              </button>
            ))}
          </div>

          <button type="button" onClick={() => setOpen(false)}
            className="w-full py-2 rounded-xl text-xs font-bold transition-all"
            style={{ background: 'rgba(129,140,248,0.15)', color: 'var(--c-accent)', border: '1px solid rgba(129,140,248,0.3)' }}>
            Done
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}

// ─── Task Editor Row ──────────────────────────────────────────────────────────

function TaskRow({
  item, index, onChange, onRemove,
}: {
  item: TaskItem
  index: number
  onChange: (i: number, field: keyof TaskItem, value: any) => void
  onRemove: (i: number) => void
}) {
  const e = getImportance(item.importance)

  return (
    <div className="flex items-center gap-2 py-2 px-3 rounded-lg group" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
      {/* Task name */}
      <input
        value={item.label}
        onChange={ev => onChange(index, 'label', ev.target.value)}
        placeholder="Task name"
        className="flex-1 min-w-0 bg-transparent text-sm outline-none"
        style={{ color: 'var(--c-text-1)' }}
      />

      {/* Time */}
      <TimePicker value={item.time} onChange={v => onChange(index, 'time', v)} />

      {/* Importance selector */}
      <div className="flex gap-1 shrink-0">
        {EISENHOWER.map(q => (
          <button
            key={q.key}
            type="button"
            onClick={() => onChange(index, 'importance', item.importance === q.key ? '' : q.key)}
            className="px-1.5 py-0.5 rounded text-[10px] font-bold transition-all"
            style={item.importance === q.key
              ? { background: q.bg, color: q.color, border: `1px solid ${q.border}` }
              : { background: 'transparent', color: 'var(--c-text-3)', border: '1px solid transparent' }
            }
            title={`${q.key}: ${q.desc}`}
          >
            {q.key}
          </button>
        ))}
      </div>

      {/* Repeat daily toggle */}
      <button
        type="button"
        onClick={() => onChange(index, 'repeatDaily', !item.repeatDaily)}
        title={item.repeatDaily ? 'Repeats daily' : 'One-time only'}
        className="shrink-0 transition-colors"
        style={{ color: item.repeatDaily ? 'var(--c-accent)' : 'var(--c-text-3)' }}
      >
        <RefreshCw size={12} />
      </button>

      {/* Remove */}
      <button
        type="button"
        onClick={() => onRemove(index)}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: 'var(--c-loss)' }}
      >
        ×
      </button>
    </div>
  )
}

// ─── Create / Edit Template Modal ────────────────────────────────────────────

function TemplateModal({
  open, onClose, existing,
}: {
  open: boolean
  onClose: () => void
  existing?: any
}) {
  const createTemplate = useCreateTemplate()
  const updateTemplate = useUpdateTemplate()
  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState(existing?.type ?? 'daily')
  const [repeatDaily, setRepeatDaily] = useState(existing?.repeatDaily ?? 1)
  const [enabled, setEnabled] = useState(existing?.enabled ?? 1)
  const [tasks, setTasks] = useState<TaskItem[]>(
    existing?.items?.map((i: any) => ({
      id: i.id,
      label: i.label,
      time: i.time ?? '',
      importance: i.importance ?? '',
      repeatDaily: i.repeatDaily ?? true,
    })) ?? []
  )

  const changeTask = (i: number, field: keyof TaskItem, value: any) => {
    setTasks(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t))
  }

  const addTask = () => setTasks(prev => [...prev, { label: '', time: '', importance: '', repeatDaily: true }])
  const removeTask = (i: number) => setTasks(prev => prev.filter((_, idx) => idx !== i))
  const applyParsed = (parsed: TaskItem[]) => setTasks(prev => [...prev, ...parsed])

  const handleSave = async () => {
    if (!name.trim()) return
    const payload = {
      name: name.trim(),
      type,
      repeatDaily: repeatDaily ? 1 : 0,
      enabled: enabled ? 1 : 0,
      items: tasks.filter(t => t.label.trim()).map((t, i) => ({
        label: t.label.trim(),
        time: t.time || null,
        importance: t.importance || null,
        repeatDaily: t.repeatDaily ? 1 : 0,
        sortOrder: i,
      })),
    }
    if (existing) {
      await updateTemplate.mutateAsync({ id: existing.id, ...payload })
    } else {
      await createTemplate.mutateAsync(payload)
    }
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit Template' : 'New Template'} size="lg">
      <div className="p-5 space-y-4">

        {/* Name + type */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Template Name"
            placeholder="Morning Routine, Pre-Market…"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Type</label>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="rounded-lg px-3 py-2 text-sm outline-none appearance-none"
              style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
        </div>

        {/* Template-level toggles */}
        <div className="flex gap-4">
          <TogglePill
            label="Repeat Daily"
            icon={<RefreshCw size={11} />}
            active={!!repeatDaily}
            onChange={v => setRepeatDaily(v ? 1 : 0)}
          />
          <TogglePill
            label="Enabled"
            icon={<Power size={11} />}
            active={!!enabled}
            onChange={v => setEnabled(v ? 1 : 0)}
            activeColor="var(--c-profit)"
            activeBg="rgba(52,211,153,0.12)"
            activeBorder="rgba(52,211,153,0.25)"
          />
        </div>

        {/* Eisenhower legend */}
        <div className="flex gap-2 flex-wrap">
          {EISENHOWER.map(e => (
            <span key={e.key} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-semibold"
              style={{ background: e.bg, color: e.color, border: `1px solid ${e.border}` }}>
              {e.key} <span style={{ color: e.color, opacity: 0.7 }}>· {e.desc}</span>
            </span>
          ))}
        </div>

        {/* Parser */}
        <QuickParser onApply={applyParsed} />

        {/* Task list */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>
              Tasks ({tasks.length})
            </label>
            <div className="flex gap-3 text-[10px]" style={{ color: 'var(--c-text-3)' }}>
              <span className="flex items-center gap-1"><RefreshCw size={9} style={{ color: 'var(--c-accent)' }} /> Repeats daily</span>
            </div>
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {tasks.map((task, i) => (
              <TaskRow key={i} item={task} index={i} onChange={changeTask} onRemove={removeTask} />
            ))}
          </div>
          <button type="button" onClick={addTask}
            className="flex items-center gap-1.5 text-xs font-medium mt-1 transition-colors"
            style={{ color: 'var(--c-accent)' }}>
            <Plus size={12} /> Add task
          </button>
        </div>

        <div className="flex justify-end gap-3 pt-3" style={{ borderTop: '1px solid var(--c-border)' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={createTemplate.isPending || updateTemplate.isPending}>
            {existing ? 'Save Changes' : 'Create Template'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Toggle Pill ─────────────────────────────────────────────────────────────

function TogglePill({
  label, icon, active, onChange,
  activeColor = 'var(--c-accent)',
  activeBg = 'rgba(129,140,248,0.12)',
  activeBorder = 'rgba(129,140,248,0.25)',
}: {
  label: string; icon?: React.ReactNode; active: boolean; onChange: (v: boolean) => void
  activeColor?: string; activeBg?: string; activeBorder?: string
}) {
  return (
    <button type="button" onClick={() => onChange(!active)}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
      style={active
        ? { background: activeBg, color: activeColor, border: `1px solid ${activeBorder}` }
        : { background: 'var(--c-bg-input)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }
      }>
      {icon} {label}
      <span className="ml-1 w-7 h-4 rounded-full relative inline-flex items-center"
        style={{ background: active ? activeColor : 'var(--c-border)' }}>
        <span className="absolute w-3 h-3 rounded-full bg-white transition-all"
          style={{ left: active ? '14px' : '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
      </span>
    </button>
  )
}

// ─── Template Card ────────────────────────────────────────────────────────────

function TemplateCard({ template, onEdit }: { template: any; onEdit: (t: any) => void }) {
  const deleteTemplate = useDeleteTemplate()
  const updateTemplate = useUpdateTemplate()
  const [expanded,    setExpanded]    = useState(false)
  const [confirmDel,  setConfirmDel]  = useState(false)

  const previewItems = template.items?.slice(0, expanded ? undefined : 4) ?? []
  const hasMore = !expanded && (template.items?.length ?? 0) > 4

  return (
    <div
      className="rounded-xl overflow-hidden transition-all"
      style={{
        background: 'var(--c-bg-card)',
        border: '1px solid var(--c-border)',
        boxShadow: 'var(--c-shadow-card)',
        opacity: template.enabled ? 1 : 0.55,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--c-border)' }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate" style={{ color: 'var(--c-text-1)' }}>{template.name}</span>
            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(129,140,248,0.12)', color: 'var(--c-accent)', border: '1px solid rgba(129,140,248,0.2)' }}>
              {template.type}
            </span>
            {template.repeatDaily ? (
              <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--c-text-3)' }}>
                <RefreshCw size={9} /> Daily
              </span>
            ) : null}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>
            {template.items?.length ?? 0} tasks
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* On/Off */}
          <button
            type="button"
            onClick={() => updateTemplate.mutate({ id: template.id, enabled: template.enabled ? 0 : 1 })}
            title={template.enabled ? 'Disable template' : 'Enable template'}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={template.enabled
              ? { color: 'var(--c-profit)', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)' }
              : { color: 'var(--c-text-3)', background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }
            }
          >
            <Power size={12} />
          </button>
          <button
            onClick={() => onEdit(template)}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: 'var(--c-text-3)', background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-accent)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-accent)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border)' }}
            title="Edit template"
          >
            <Settings size={12} />
          </button>
          {confirmDel ? (
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg"
              style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)' }}>
              <span className="text-[10px] font-semibold" style={{ color: 'var(--c-loss)' }}>Delete?</span>
              <button onClick={() => { deleteTemplate.mutate(template.id); setConfirmDel(false) }}
                className="text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors"
                style={{ background: 'rgba(248,113,113,0.2)', color: 'var(--c-loss)' }}>
                Yes
              </button>
              <button onClick={() => setConfirmDel(false)}
                className="text-[10px] font-bold px-1 py-0.5 rounded"
                style={{ color: 'var(--c-text-3)' }}>✕</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDel(true)}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
              style={{ color: 'var(--c-text-3)', background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-loss)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-loss)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border)' }}
              title="Delete template"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Task preview */}
      <div className="px-4 py-2 space-y-1">
        {previewItems.map((item: any, i: number) => (
          <div key={item.id ?? i} className="flex items-center gap-2 py-1">
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--c-border)' }} />
            <span className="flex-1 text-xs truncate" style={{ color: 'var(--c-text-2)' }}>{item.label}</span>
            {item.time && (
              <span className="text-[10px] num shrink-0" style={{ color: 'var(--c-text-3)' }}>{item.time}</span>
            )}
            {item.importance && <ImportanceBadge code={item.importance} />}
            {!item.repeatDaily && (
              <span className="text-[10px] shrink-0" style={{ color: 'var(--c-text-3)' }}>×1</span>
            )}
          </div>
        ))}
        {hasMore && (
          <button
            className="text-[10px] font-medium py-1 transition-colors"
            style={{ color: 'var(--c-accent)' }}
            onClick={() => setExpanded(true)}
          >
            + {(template.items?.length ?? 0) - 4} more tasks
          </button>
        )}
        {expanded && template.items?.length > 4 && (
          <button className="text-[10px] font-medium py-1" style={{ color: 'var(--c-text-3)' }} onClick={() => setExpanded(false)}>
            Show less
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Ad-hoc Tasks Card ────────────────────────────────────────────────────────

function AdhocTasksCard({ date, adhocEntry, toggle, deleteItem }: {
  date: string
  adhocEntry: any | null
  toggle: ReturnType<typeof useToggleChecklistItem>
  deleteItem: ReturnType<typeof useDeleteChecklistItem>
}) {
  const addAdhocItems    = useAddAdhocItems()
  const archiveCompleted = useArchiveCompleted()
  const [open,         setOpen]         = useState(false)
  const [editorOn,     setEditorOn]     = useState(false)
  const [tasks,        setTasks]        = useState<TaskItem[]>([])
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [confirming,   setConfirming]   = useState(false)

  const changeTask  = (i: number, field: keyof TaskItem, value: any) =>
    setTasks(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t))
  const removeTask  = (i: number) => setTasks(prev => prev.filter((_, idx) => idx !== i))
  const addTask     = () => setTasks(prev => [...prev, { label: '', time: '', importance: '', repeatDaily: true }])
  const applyParsed = (parsed: TaskItem[]) => setTasks(prev => [...prev, ...parsed])

  const handleSave = async () => {
    const valid = tasks.filter(t => t.label.trim())
    if (!valid.length) return
    await addAdhocItems.mutateAsync({
      date,
      items: valid.map(t => ({ label: t.label.trim(), time: t.time || undefined, importance: t.importance || undefined })),
    })
    setTasks([])
    setEditorOn(false)
  }

  const handleArchive = () =>
    archiveCompleted.mutate(adhocEntry.id, { onSuccess: () => setConfirming(false) })

  const allItems: any[]      = adhocEntry?.items ?? []
  const archivedItems: any[] = allItems.filter((i: any) => i.archived)

  // Non-archived — completed items sink to the bottom, same as template entries
  const mainItems: any[] = allItems
    .filter((i: any) => !i.archived)
    .sort((a: any, b: any) => {
      if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1
      if (a.time && b.time) {
        const ta = parseTaskTime(a.time), tb = parseTaskTime(b.time)
        if (ta && tb) return ta.getTime() - tb.getTime()
      }
      return a.time ? -1 : b.time ? 1 : (a.id - b.id)
    })

  const archivable = mainItems.filter((i: any) => i.completed)
  const done       = allItems.filter((i: any) => i.completed || i.archived)
  const total      = allItems.length
  const pct        = total > 0 ? Math.round(done.length / total * 100) : 0
  const hasItems   = mainItems.length > 0 || archivedItems.length > 0

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)', boxShadow: 'var(--c-shadow-card)' }}>

      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 transition-colors text-left"
        style={{ background: 'var(--c-bg-secondary)', borderBottom: (open && hasItems) ? '1px solid var(--c-border)' : 'none' }}
        onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.08)'}
        onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.filter = ''}>
        {open
          ? <ChevronDown  size={15} className="shrink-0" style={{ color: 'var(--c-text-3)' }} />
          : <ChevronRight size={15} className="shrink-0" style={{ color: 'var(--c-text-3)' }} />}
        <span className="font-bold text-sm flex-1" style={{ color: 'var(--c-text-1)' }}>Today's Tasks</span>

        {/* Collapsed summary */}
        {!open && hasItems && (
          <span className="text-xs shrink-0" style={{ color: 'var(--c-text-3)' }}>
            {mainItems.filter((i: any) => !i.completed).length} remaining
            {done.length > 0 && ` · ${done.length} done`}
          </span>
        )}

        {/* Progress bar — visible when expanded */}
        {open && total > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-1 w-16 rounded-full overflow-hidden" style={{ background: 'var(--c-border)' }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: pct === 100 ? 'var(--c-profit)' : 'linear-gradient(90deg, var(--c-accent), var(--c-accent-2))' }} />
            </div>
            <span className="text-xs num font-bold" style={{ color: pct === 100 ? 'var(--c-profit)' : 'var(--c-text-3)' }}>{pct}%</span>
          </div>
        )}

        {/* Archive button — stops propagation */}
        <div onClick={e => e.stopPropagation()}>
          {confirming ? (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
              style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)' }}>
              <span className="text-[10px] font-semibold" style={{ color: 'var(--c-loss)' }}>⚠ Irreversible</span>
              <button onClick={handleArchive} disabled={archiveCompleted.isPending}
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(248,113,113,0.2)', color: 'var(--c-loss)' }}>
                {archiveCompleted.isPending ? '…' : 'Confirm'}
              </button>
              <button onClick={() => setConfirming(false)} className="text-[10px] font-bold px-1 py-0.5 rounded"
                style={{ color: 'var(--c-text-3)' }}>✕</button>
            </div>
          ) : (
            <button
              onClick={() => archivable.length > 0 && setConfirming(true)}
              title={archivable.length > 0 ? `Archive ${archivable.length} completed` : 'No completed tasks to archive'}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
              style={{
                background: 'var(--c-bg-input)', border: '1px solid var(--c-border)',
                color: archivable.length > 0 ? 'var(--c-text-2)' : 'var(--c-text-3)',
                opacity: archivable.length > 0 ? 1 : 0.35,
                cursor: archivable.length > 0 ? 'pointer' : 'default',
              }}>
              <Archive size={12} />
            </button>
          )}
        </div>

        {/* Add button — stops propagation so it doesn't toggle the card */}
        <div onClick={e => { e.stopPropagation(); setOpen(true); setEditorOn(true) }}>
          <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold transition-all shrink-0"
            style={{ background: 'rgba(129,140,248,0.1)', color: 'var(--c-accent)', border: '1px solid rgba(129,140,248,0.25)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(129,140,248,0.18)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(129,140,248,0.1)'}>
            <Plus size={11} /> Add Task
          </span>
        </div>
      </button>

      {open && (
        <>
          {/* Main list — incomplete first, completed sink to bottom */}
          {mainItems.map((item: any) => (
            <div key={item.id}
              className="flex items-center gap-3 px-4 py-3 group transition-all"
              style={{ borderTop: '1px solid var(--c-border-subtle)', opacity: item.completed ? 0.5 : 1 }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--c-bg-hover)'}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ''}>
              <div
                onClick={() => toggle.mutate({ entryId: adhocEntry.id, itemId: item.id, completed: !item.completed })}
                className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 cursor-pointer transition-all"
                style={item.completed
                  ? { background: 'linear-gradient(135deg, var(--c-accent), var(--c-accent-2))', borderColor: 'transparent' }
                  : { background: 'transparent', borderColor: 'var(--c-border-mid)' }}>
                {!!item.completed && <Check size={11} className="text-white" />}
              </div>
              <div className="flex-1 flex items-center gap-2 min-w-0 flex-wrap cursor-pointer"
                onClick={() => toggle.mutate({ entryId: adhocEntry.id, itemId: item.id, completed: !item.completed })}>
                <span className="text-sm font-semibold"
                  style={{ color: item.completed ? 'var(--c-text-3)' : 'var(--c-text-1)', textDecoration: item.completed ? 'line-through' : 'none' }}>
                  {item.label}
                </span>
                {item.time && (
                  <span className="flex items-center gap-1 text-[11px] font-medium num shrink-0"
                    style={{ color: item.completed ? 'var(--c-text-3)' : TIME_STYLE[getTimeStatus(item.time)].color }}>
                    <Clock size={10} />{item.time}
                    {!item.completed && TIME_STYLE[getTimeStatus(item.time)].label && (
                      <span className="font-bold">{TIME_STYLE[getTimeStatus(item.time)].label}</span>
                    )}
                  </span>
                )}
                {item.importance && !item.completed && <ImportanceBadge code={item.importance} />}
              </div>
              {/* Delete — only on non-archived ad-hoc items */}
              <button
                onClick={() => deleteItem.mutate({ entryId: adhocEntry.id, itemId: item.id })}
                className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-all"
                style={{ color: 'var(--c-text-3)', background: 'transparent' }}
                title="Remove task"
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--c-loss)'; (e.currentTarget as HTMLElement).style.background = 'rgba(248,113,113,0.1)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--c-text-3)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                <Trash2 size={11} />
              </button>
            </div>
          ))}

          {/* Archived section — matches template entry behaviour */}
          {archivedItems.length > 0 && (
            <>
              <button
                onClick={() => setArchivedOpen(v => !v)}
                className="w-full flex items-center gap-2 px-4 py-2 transition-colors"
                style={{ borderTop: '1px solid var(--c-border-subtle)', color: 'var(--c-text-3)', background: 'transparent' }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-bg-hover)'}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}>
                {archivedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="text-[11px] font-semibold">{archivedItems.length} completed</span>
              </button>
              {archivedOpen && archivedItems.map((item: any) => (
                <div key={item.id}
                  className="flex items-center gap-3 px-4 py-3 transition-all"
                  style={{ borderTop: '1px solid var(--c-border-subtle)', opacity: 0.45 }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--c-bg-hover)'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ''}>
                  <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: 'linear-gradient(135deg, var(--c-accent), var(--c-accent-2))', borderColor: 'transparent' }}>
                    <Check size={11} className="text-white" />
                  </div>
                  <div className="flex-1 flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="text-sm font-semibold"
                      style={{ color: 'var(--c-text-3)', textDecoration: 'line-through' }}>
                      {item.label}
                    </span>
                    {item.time && (
                      <span className="flex items-center gap-1 text-[11px] num shrink-0" style={{ color: 'var(--c-text-3)' }}>
                        <Clock size={10} />{item.time}
                      </span>
                    )}
                    {item.importance && <ImportanceBadge code={item.importance} />}
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Inline editor */}
          {editorOn && (
            <div className="px-4 py-4 space-y-3" style={{ borderTop: hasItems ? '1px solid var(--c-border)' : 'none', background: 'rgba(99,102,241,0.03)' }}>
              <QuickParser onApply={applyParsed} />

              <div className="space-y-2">
                {tasks.map((task, i) => (
                  <TaskRow key={i} item={task} index={i} onChange={changeTask} onRemove={removeTask} />
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button type="button" onClick={addTask}
                  className="flex items-center gap-1 text-xs font-medium"
                  style={{ color: 'var(--c-accent)' }}>
                  <Plus size={12} /> Add task
                </button>
                <div className="flex-1" />
                <button type="button" onClick={() => { setEditorOn(false); setTasks([]) }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: 'var(--c-bg-input)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}>
                  Cancel
                </button>
                <button type="button" onClick={handleSave} disabled={addAdhocItems.isPending || !tasks.some(t => t.label.trim())}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold transition-all"
                  style={{ background: 'rgba(129,140,248,0.2)', color: 'var(--c-accent)', border: '1px solid rgba(129,140,248,0.35)', opacity: tasks.some(t => t.label.trim()) ? 1 : 0.4 }}>
                  {addAdhocItems.isPending ? 'Saving...' : `Add ${tasks.filter(t => t.label.trim()).length || ''} to Today`}
                </button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!hasItems && !editorOn && (
            <div className="px-4 py-5 text-center">
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No tasks added for today yet.</p>
              <button onClick={() => setEditorOn(true)}
                className="mt-2 text-xs font-semibold"
                style={{ color: 'var(--c-accent)' }}>
                + Add your first task
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Daily Checklist ──────────────────────────────────────────────────────────

function ChecklistTaskRow({ item, entryId, toggle, getTaskStreak }: {
  item: any; entryId: number
  toggle: ReturnType<typeof useToggleChecklistItem>
  getTaskStreak: (id: number) => number
}) {
  const status = item.completed ? 'none' : getTimeStatus(item.time)
  const ts = TIME_STYLE[status]
  const streak = getTaskStreak(item.templateItemId)
  return (
    <div
      onClick={() => toggle.mutate({ entryId, itemId: item.id, completed: !item.completed })}
      className="flex items-start gap-3 px-4 py-3 cursor-pointer transition-all"
      style={{ borderTop: '1px solid var(--c-border-subtle)', opacity: item.completed ? 0.5 : 1 }}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--c-bg-hover)'}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ''}
    >
      <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all"
        style={item.completed
          ? { background: 'linear-gradient(135deg, var(--c-accent), var(--c-accent-2))', borderColor: 'transparent' }
          : { background: 'transparent', borderColor: 'var(--c-border-mid)' }}>
        {!!item.completed && <Check size={11} className="text-white" />}
      </div>
      <div className="flex-1 flex items-center gap-2 min-w-0 flex-wrap">
        <span className="text-sm font-semibold"
          style={{ color: item.completed ? 'var(--c-text-3)' : 'var(--c-text-1)', textDecoration: item.completed ? 'line-through' : 'none' }}>
          {item.label}
        </span>
        {streak >= 2 && <span className="text-sm font-bold shrink-0" style={{ color: '#fb923c' }}>🔥 {streak}</span>}
        {item.time && (
          <span className="flex items-center gap-1 text-[11px] font-medium num shrink-0"
            style={{ color: item.completed ? 'var(--c-text-3)' : ts.color }}>
            <Clock size={10} />{item.time}
            {!item.completed && ts.label && <span className="font-bold">{ts.label}</span>}
          </span>
        )}
        {item.importance && !item.completed && <ImportanceBadge code={item.importance} />}
      </div>
    </div>
  )
}

function DailyChecklist({ date }: { date: string }) {
  const { data: entries, isPending } = useChecklistEntries(date)
  const { data: taskStreaks } = useChecklistTaskStreaks()
  const toggle     = useToggleChecklistItem()
  const deleteItem = useDeleteChecklistItem()
  const archiveCompleted = useArchiveCompleted()
  const getTaskStreak = (id: number) => taskStreaks?.find(s => s.templateItemId === id)?.streak ?? 0

  // Separate ad-hoc entry (template === null) from template-based entries
  const adhocEntry      = entries?.find((e: any) => e.template === null) ?? null
  const templateEntries = entries?.filter((e: any) => e.template !== null) ?? []

  // Refresh time colours every minute
  const [, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 60_000); return () => clearInterval(t) }, [])

  // State 1 — template-level collapse (hides entire task list, shows summary)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const toggleCollapse = (id: number) =>
    setCollapsed(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  // State 2 — completed-section expand (independent per template)
  const [completedOpen, setCompletedOpen] = useState<Set<number>>(new Set())
  const toggleCompleted = (id: number) =>
    setCompletedOpen(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  // State 3 — archive confirm
  const [confirming, setConfirming] = useState<number | null>(null)
  const handleArchive = (entryId: number) =>
    archiveCompleted.mutate(entryId, { onSuccess: () => setConfirming(null) })

  if (isPending) return <PageLoader />

  return (
    <div className="space-y-3">
      {/* Ad-hoc "Today's Tasks" card — always shown at the top */}
      <AdhocTasksCard date={date} adhocEntry={adhocEntry} toggle={toggle} deleteItem={deleteItem} />

      {templateEntries.length === 0 && !adhocEntry?.items?.length && (
        <EmptyState icon={<CheckSquare size={32} />} title="No active checklists for today"
          description="Enable a template in the Templates tab, or use Today's Tasks above to add one-off tasks." />
      )}

      {templateEntries.map((entry: any) => {
        const isCollapsed      = collapsed.has(entry.id)
        const isCompletedOpen  = completedOpen.has(entry.id)

        const sortByTime = (a: any, b: any) => {
          if (a.time && b.time) {
            const ta = parseTaskTime(a.time), tb = parseTaskTime(b.time)
            if (ta && tb) return ta.getTime() - tb.getTime()
          }
          return a.time ? -1 : b.time ? 1 : a.sortOrder - b.sortOrder
        }

        const allItems = [...(entry.items ?? [])]

        // Main list: not archived (includes both incomplete and just-completed)
        const mainItems   = allItems.filter((i: any) => !i.archived).sort((a: any, b: any) => {
          // Completed tasks sink to bottom within main list
          if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1
          return sortByTime(a, b)
        })
        // Archived section: items explicitly archived via the button
        const archivedItems = allItems.filter((i: any) => i.archived)

        // Archived items were completed then cleared — count as done for progress
        const done               = allItems.filter((i: any) => i.completed || i.archived)
        const total              = allItems.length
        const pct                = total > 0 ? Math.round(done.length / total * 100) : 0
        // Only non-archived completed items can still be archived
        const archivable         = allItems.filter((i: any) => i.completed && !i.archived)

        return (
          <div key={entry.id} className="rounded-xl overflow-hidden"
            style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)', boxShadow: 'var(--c-shadow-card)' }}>

            {/* ── Header ── collapse toggles the whole task list */}
            <button
              onClick={() => toggleCollapse(entry.id)}
              className="w-full flex items-center gap-3 px-4 py-3 transition-colors text-left"
              style={{ background: 'var(--c-bg-secondary)', borderBottom: isCollapsed ? 'none' : '1px solid var(--c-border)' }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.08)'}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.filter = ''}
            >
              {isCollapsed ? <ChevronRight size={15} className="shrink-0" style={{ color: 'var(--c-text-3)' }} /> : <ChevronDown size={15} className="shrink-0" style={{ color: 'var(--c-text-3)' }} />}
              <span className="font-bold text-sm flex-1 min-w-0" style={{ color: 'var(--c-text-1)' }}>{entry.template?.name}</span>
              {isCollapsed ? (
                <span className="text-xs shrink-0" style={{ color: 'var(--c-text-3)' }}>
                  {mainItems.filter((i: any) => !i.completed).length} remaining{done.length > 0 && ` · ${done.length} done`}
                </span>
              ) : (
                <div className="flex items-center gap-2 shrink-0">
                  <div className="h-1 w-16 rounded-full overflow-hidden" style={{ background: 'var(--c-border)' }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: pct === 100 ? 'var(--c-profit)' : 'linear-gradient(90deg, var(--c-accent), var(--c-accent-2))' }} />
                  </div>
                  <span className="text-xs num font-bold" style={{ color: pct === 100 ? 'var(--c-profit)' : 'var(--c-text-3)' }}>{pct}%</span>
                </div>
              )}

              {/* Archive — stop click propagation */}
              <div onClick={e => e.stopPropagation()}>
                {confirming === entry.id ? (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                    style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)' }}>
                    <span className="text-[10px] font-semibold" style={{ color: 'var(--c-loss)' }}>⚠ Irreversible</span>
                    <button onClick={() => handleArchive(entry.id)} disabled={archiveCompleted.isPending}
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(248,113,113,0.2)', color: 'var(--c-loss)' }}>
                      {archiveCompleted.isPending ? '…' : 'Confirm'}
                    </button>
                    <button onClick={() => setConfirming(null)} className="text-[10px] font-bold px-1 py-0.5 rounded"
                      style={{ color: 'var(--c-text-3)' }}>✕</button>
                  </div>
                ) : (
                  <button
                    onClick={() => archivable.length > 0 && setConfirming(entry.id)}
                    title={archivable.length > 0 ? `Archive ${archivable.length} completed` : 'No completed tasks to archive'}
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                    style={{
                      background: 'var(--c-bg-input)', border: '1px solid var(--c-border)',
                      color: archivable.length > 0 ? 'var(--c-text-2)' : 'var(--c-text-3)',
                      opacity: archivable.length > 0 ? 1 : 0.35, cursor: archivable.length > 0 ? 'pointer' : 'default',
                    }}>
                    <Archive size={12} />
                  </button>
                )}
              </div>
            </button>

            {/* ── Task list — visible when NOT collapsed ── */}
            {!isCollapsed && (
              <>
                {/* Main list — all non-archived tasks (complete + incomplete), completed sink to bottom */}
                {mainItems.map((item: any) => (
                  <ChecklistTaskRow key={item.id} item={item} entryId={entry.id} toggle={toggle} getTaskStreak={getTaskStreak} />
                ))}

                {/* Archived section — only appears after pressing Archive button */}
                {archivedItems.length > 0 && (
                  <>
                    <button
                      onClick={() => toggleCompleted(entry.id)}
                      className="w-full flex items-center gap-2 px-4 py-2 transition-colors"
                      style={{ borderTop: '1px solid var(--c-border-subtle)', color: 'var(--c-text-3)', background: 'transparent' }}
                      onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-bg-hover)'}
                      onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                    >
                      {isCompletedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span className="text-[11px] font-semibold">{archivedItems.length} completed</span>
                    </button>
                    {isCompletedOpen && archivedItems.map((item: any) => (
                      <ChecklistTaskRow key={item.id} item={item} entryId={entry.id} toggle={toggle} getTaskStreak={getTaskStreak} />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

function TemplatesTab() {
  const { data: templates, isPending } = useChecklistTemplates()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)

  if (isPending) return <PageLoader />

  const open = (t?: any) => { setEditing(t ?? null); setModalOpen(true) }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => open()}><Plus size={14} /> New Template</Button>
      </div>

      {!templates?.length ? (
        <EmptyState icon={<Settings size={32} />} title="No templates yet"
          description="Create a template to build your daily routine"
          action={<Button onClick={() => open()}><Plus size={14} /> Create Template</Button>} />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {templates.map((t: any) => (
            <TemplateCard key={t.id} template={t} onEdit={open} />
          ))}
        </div>
      )}

      <TemplateModal
        key={editing?.id ?? 'new'}
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        existing={editing}
      />
    </div>
  )
}

// ─── Notification Settings Modal ─────────────────────────────────────────────

const ADVANCE_OPTIONS = [
  { value: 0,  label: 'At time' },
  { value: 5,  label: '5 min before' },
  { value: 10, label: '10 min before' },
  { value: 15, label: '15 min before' },
  { value: 30, label: '30 min before' },
]

function NotificationSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState<NotifSettings>(loadNotifSettings)
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  )

  const update = (patch: Partial<NotifSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveNotifSettings(next)
  }

  const requestPermission = async () => {
    const result = await Notification.requestPermission()
    setPermission(result)
    if (result === 'granted') update({ enabled: true })
  }

  const permColor = permission === 'granted' ? 'var(--c-profit)' : permission === 'denied' ? 'var(--c-loss)' : '#fbbf24'
  const permLabel = permission === 'granted' ? 'Granted' : permission === 'denied' ? 'Blocked' : 'Not set'

  return (
    <Modal open={open} onClose={onClose} title="Notification Settings" size="sm">
      <div className="p-5 space-y-5">

        {/* Info banner */}
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl"
          style={{ background: 'rgba(129,140,248,0.07)', border: '1px solid rgba(129,140,248,0.18)' }}>
          <Bell size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--c-accent)' }} />
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--c-text-2)' }}>
            Browser notifications fire for checklist items that have a scheduled time. The app must be open in the browser (this is not a push service).
          </p>
        </div>

        {/* Browser permission row */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--c-text-1)' }}>Browser permission</p>
            <p className="text-[11px] mt-0.5" style={{ color: permColor }}>{permLabel}</p>
          </div>
          {permission !== 'granted' && (
            <Button size="sm" onClick={requestPermission} disabled={permission === 'denied'}>
              {permission === 'denied' ? 'Blocked in browser' : 'Allow Notifications'}
            </Button>
          )}
          {permission === 'denied' && (
            <p className="text-[10px]" style={{ color: 'var(--c-text-3)' }}>
              Re-enable in browser site settings
            </p>
          )}
        </div>

        {/* Enable toggle */}
        <div className="flex items-center justify-between gap-4 py-2"
          style={{ borderTop: '1px solid var(--c-border)', borderBottom: '1px solid var(--c-border)' }}>
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--c-text-1)' }}>Enable notifications</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>
              Fire alerts for timed checklist items
            </p>
          </div>
          <button
            onClick={() => update({ enabled: !settings.enabled })}
            disabled={permission !== 'granted'}
            className="relative w-11 h-6 rounded-full transition-all shrink-0"
            style={{
              background: settings.enabled && permission === 'granted' ? 'rgba(129,140,248,0.5)' : 'var(--c-bg-input)',
              border: `1px solid ${settings.enabled && permission === 'granted' ? 'var(--c-accent)' : 'var(--c-border-mid)'}`,
              opacity: permission !== 'granted' ? 0.4 : 1,
            }}>
            <span className="absolute top-0.5 transition-all w-5 h-5 rounded-full"
              style={{
                left: settings.enabled && permission === 'granted' ? '22px' : '2px',
                background: settings.enabled && permission === 'granted' ? 'var(--c-accent)' : 'var(--c-text-3)',
              }} />
          </button>
        </div>

        {/* Advance notice */}
        <div style={{ opacity: settings.enabled && permission === 'granted' ? 1 : 0.4 }}>
          <p className="text-xs font-semibold mb-3" style={{ color: 'var(--c-text-1)' }}>Alert me</p>
          <div className="flex flex-wrap gap-2">
            {ADVANCE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => update({ advanceMinutes: opt.value })}
                disabled={!settings.enabled || permission !== 'granted'}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: settings.advanceMinutes === opt.value ? 'rgba(129,140,248,0.2)' : 'var(--c-bg-input)',
                  color: settings.advanceMinutes === opt.value ? 'var(--c-accent)' : 'var(--c-text-2)',
                  border: `1px solid ${settings.advanceMinutes === opt.value ? 'var(--c-accent)' : 'var(--c-border-mid)'}`,
                }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="secondary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'today',     label: "Today's List", icon: <CheckSquare size={14} /> },
  { id: 'templates', label: 'Templates',    icon: <Settings size={14} /> },
]

export function ChecklistsPage() {
  const [tab, setTab] = useState('today')
  const [date, setDate] = useState(today())
  const [notifOpen, setNotifOpen] = useState(false)

  const notifSettings = loadNotifSettings()
  const notifEnabled  = notifSettings.enabled && typeof Notification !== 'undefined' && Notification.permission === 'granted'

  return (
    <PageShell
      title="Checklists"
      action={
        <div className="flex items-center gap-3">
          {tab === 'today' && (
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="rounded-lg px-2 py-1 text-sm outline-none"
              style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)' }} />
          )}
          <button
            onClick={() => setNotifOpen(true)}
            title="Notification settings"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
            style={{
              background: notifEnabled ? 'rgba(129,140,248,0.12)' : 'var(--c-bg-input)',
              border: `1px solid ${notifEnabled ? 'rgba(129,140,248,0.3)' : 'var(--c-border)'}`,
              color: notifEnabled ? 'var(--c-accent)' : 'var(--c-text-3)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-accent)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-accent)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = notifEnabled ? 'var(--c-accent)' : 'var(--c-text-3)'; (e.currentTarget as HTMLButtonElement).style.borderColor = notifEnabled ? 'rgba(129,140,248,0.3)' : 'var(--c-border)' }}>
            {notifEnabled ? <Bell size={14} /> : <BellOff size={14} />}
          </button>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>
      }
    >
      {tab === 'today'     && <DailyChecklist date={date} />}
      {tab === 'templates' && <TemplatesTab />}
      <NotificationSettingsModal open={notifOpen} onClose={() => setNotifOpen(false)} />
    </PageShell>
  )
}
