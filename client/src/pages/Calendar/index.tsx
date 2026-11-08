import { useState, useEffect } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { localTz, hoursIn, zoneLabel, SESSION_ZONES, DEFAULT_SESSIONS, type TradingSession } from '../../lib/sessions'
import { Plus, Trash2 } from 'lucide-react'

// ─── Category config (persisted to localStorage) ─────────────────────────────
export interface CalCategory { value: string; label: string; color: string; builtin?: boolean }
const CAT_KEY = 'cal-categories-v1'
const DEFAULT_CATEGORIES: CalCategory[] = [
  { value: 'personal', label: 'Personal',  color: '#818cf8', builtin: true },
  { value: 'business', label: 'Business',  color: '#a78bfa', builtin: true },
  { value: 'health',   label: 'Health',    color: '#34d399', builtin: true },
  { value: 'trading',  label: 'Trading',   color: '#fbbf24', builtin: true },
  { value: 'focus',    label: 'Deep Work', color: '#22d3ee', builtin: true },
]
export function loadCategories(): CalCategory[] {
  try {
    const raw = localStorage.getItem(CAT_KEY)
    if (!raw) return DEFAULT_CATEGORIES
    const saved = JSON.parse(raw) as CalCategory[]
    // Merge: keep saved label/color for builtins, append custom ones
    const builtinsMerged = DEFAULT_CATEGORIES.map(d => ({
      ...d,
      ...(saved.find(s => s.value === d.value) ?? {}),
      builtin: true,
    }))
    const customs = saved.filter(s => !DEFAULT_CATEGORIES.some(d => d.value === s.value))
    return [...builtinsMerged, ...customs]
  } catch { return DEFAULT_CATEGORIES }
}
export function saveCategories(cats: CalCategory[]) {
  localStorage.setItem(CAT_KEY, JSON.stringify(cats))
}
// ─── CategoryConfigModal ──────────────────────────────────────────────────────
const PRESET_COLORS = ['#818cf8','#a78bfa','#34d399','#22d3ee','#fbbf24','#fb923c','#f87171','#e879f9','#38bdf8','#a3e635','#fb7185','#c084fc']

function slugify(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 32) || `cat-${Date.now()}`
}

export function CategoryConfigModal({
  open, onClose, categories, onSave,
}: { open: boolean; onClose: () => void; categories: CalCategory[]; onSave: (cats: CalCategory[]) => void }) {
  const [local, setLocal] = useState<CalCategory[]>(categories)
  const [newLabel, setNewLabel] = useState('')
  useEffect(() => { setLocal(categories); setNewLabel('') }, [categories, open])

  const upd = (value: string, field: keyof CalCategory, val: string) =>
    setLocal(prev => prev.map(c => c.value === value ? { ...c, [field]: val } : c))
  const del = (value: string) =>
    setLocal(prev => prev.filter(c => c.value !== value))
  const add = () => {
    const label = newLabel.trim()
    if (!label) return
    const value = slugify(label)
    if (local.some(c => c.value === value)) return
    setLocal(prev => [...prev, { value, label, color: PRESET_COLORS[prev.length % PRESET_COLORS.length] }])
    setNewLabel('')
  }

  return (
    <Modal open={open} onClose={onClose} title="Event Categories" size="sm">
      <div className="p-4 space-y-2">
        <p className="text-xs text-text-muted mb-3">
          Customize the categories and colors for your calendar events.
          Built-in categories can be recolored but not deleted.
        </p>

        {local.map(cat => {
          const isPreset = PRESET_COLORS.includes(cat.color)
          return (
            <div key={cat.value} className="flex items-center gap-2.5 rounded-lg px-3 py-2.5"
              style={{ background: cat.color + '0d', border: `1px solid ${cat.color}25` }}>
              {/* Color swatch + picker */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {PRESET_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => upd(cat.value, 'color', c)}
                    className="w-4 h-4 rounded-full flex-shrink-0 transition-transform hover:scale-110"
                    style={{ background: c, boxShadow: cat.color === c ? `0 0 0 1.5px #0e0e1a, 0 0 0 3px ${c}` : 'none' }} />
                ))}
                {/* Custom */}
                <label className="w-4 h-4 rounded-full cursor-pointer flex-shrink-0 transition-transform hover:scale-110"
                  title="Custom colour"
                  style={{ background: isPreset ? 'var(--c-border-mid)' : cat.color, border: isPreset ? '1px dashed var(--c-border-strong)' : 'none', boxShadow: !isPreset ? `0 0 0 1.5px #0e0e1a, 0 0 0 3px ${cat.color}` : 'none' }}>
                  <input type="color" className="sr-only" value={cat.color}
                    onChange={e => upd(cat.value, 'color', e.target.value)} />
                </label>
              </div>

              {/* Label */}
              <input
                value={cat.label}
                onChange={e => upd(cat.value, 'label', e.target.value)}
                className="flex-1 bg-transparent text-sm text-text-primary outline-none border-b border-transparent focus:border-white/20 transition-colors min-w-0"
                placeholder="Category name"
              />

              {/* Slug badge */}
              <span className="text-[10px] text-text-muted font-mono flex-shrink-0">{cat.value}</span>

              {/* Delete (custom only) */}
              {!cat.builtin
                ? <button onClick={() => del(cat.value)} className="flex-shrink-0 text-text-muted hover:text-red-400 transition-colors p-0.5"><Trash2 size={12} /></button>
                : <span className="w-4 flex-shrink-0" />
              }
            </div>
          )
        })}

        {/* Add new */}
        <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--c-border)' }}>
          <input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="New category name…"
            className="flex-1 bg-transparent text-sm text-text-primary outline-none border-b border-[var(--c-border-mid)] focus:border-[var(--c-border-strong)] transition-colors pb-0.5"
          />
          <button onClick={add} disabled={!newLabel.trim()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-all disabled:opacity-30"
            style={{ background: 'var(--c-bg-hover)', color: 'var(--c-text-1)', border: '1px solid var(--c-border)' }}>
            <Plus size={11} /> Add
          </button>
        </div>

        <div className="flex justify-end pt-3">
          <button onClick={() => { onSave(local); onClose() }}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
            style={{ background: 'var(--c-accent)', color: 'var(--c-on-accent, #fff)' }}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── SessionConfigModal ───────────────────────────────────────────────────────
const SESSION_PRESET_COLORS = PRESET_COLORS

export function SessionConfigModal({
  open, onClose, sessions, onSave,
}: { open: boolean; onClose: () => void; sessions: TradingSession[]; onSave: (s: TradingSession[]) => void }) {
  const [local, setLocal] = useState<TradingSession[]>(sessions)
  // Keep local in sync if parent sessions change while closed
  useEffect(() => { setLocal(sessions) }, [sessions])

  const upd = (id: string, field: keyof TradingSession, value: any) =>
    setLocal(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s))

  const save = () => { onSave(local); onClose() }

  const SESSION_META: Record<string, { region: string; desc: string }> = {
    nyse:   { region: 'New York',  desc: 'US equities, NQ futures, S&P 500' },
    london: { region: 'London',    desc: 'European equities, forex majors' },
    asia:   { region: 'Tokyo / Hong Kong', desc: 'Asian indices, crypto, JPY pairs' },
  }

  return (
    <Modal open={open} onClose={onClose} title="Trading Sessions" size="sm">
      <div className="p-4 space-y-3">
        <p className="text-xs text-text-muted mb-1">
          Each session is set in its exchange's own time, so daylight saving shifts on its own:
          New York, London and Tokyo change on their own dates, and your calendar follows.
        </p>
        {local.map(s => {
          const meta = SESSION_META[s.id]
          const isPreset = SESSION_PRESET_COLORS.includes(s.color)
          return (
            <div key={s.id} className="rounded-xl p-3.5 space-y-3"
              style={{ background: s.enabled ? s.color + '0a' : 'var(--c-bg-input)', border: `1px solid ${s.enabled ? s.color + '30' : 'var(--c-border)'}` }}>
              {/* Header row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <div>
                    <p className="text-sm font-bold text-text-primary">{s.name}</p>
                    <p className="text-[11px] text-text-muted">{meta?.region ?? zoneLabel(s.tz)}</p>
                  </div>
                </div>
                {/* Toggle */}
                <label className="relative cursor-pointer flex-shrink-0">
                  <input type="checkbox" className="sr-only" checked={s.enabled}
                    onChange={e => upd(s.id, 'enabled', e.target.checked)} />
                  <div className="w-9 h-5 rounded-full transition-colors relative"
                    style={{ background: s.enabled ? s.color : 'var(--c-border-mid)' }}>
                    <div className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
                      style={{ transform: s.enabled ? 'translateX(20px)' : 'translateX(2px)' }} />
                  </div>
                </label>
              </div>
              {/* Colour picker */}
              <div className={!s.enabled ? 'opacity-30 pointer-events-none' : ''}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Colour</p>
                <div className="flex items-center gap-1.5">
                  {SESSION_PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => upd(s.id, 'color', c)}
                      className="w-5 h-5 rounded-full transition-transform hover:scale-110 flex-shrink-0"
                      style={{
                        background: c,
                        boxShadow: s.color === c ? `0 0 0 2px #0e0e1a, 0 0 0 3.5px ${c}` : 'none',
                      }}
                    />
                  ))}
                  {/* Custom colour input */}
                  <label
                    className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer flex-shrink-0 transition-transform hover:scale-110"
                    title="Custom colour"
                    style={{
                      background: isPreset ? 'var(--c-border-mid)' : s.color,
                      boxShadow: !isPreset ? `0 0 0 2px #0e0e1a, 0 0 0 3.5px ${s.color}` : 'none',
                      border: isPreset ? '1px dashed var(--c-border-strong)' : 'none',
                    }}
                  >
                    <input
                      type="color"
                      value={s.color}
                      onChange={e => upd(s.id, 'color', e.target.value)}
                      className="sr-only"
                    />
                    {isPreset && <span className="text-[10px] text-white/40 leading-none select-none">+</span>}
                  </label>
                </div>
              </div>
              {/* Times */}
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted block mb-1">Open</label>
                  <input
                    type="time"
                    value={s.open}
                    disabled={!s.enabled}
                    onChange={e => upd(s.id, 'open', e.target.value)}
                    className="w-full rounded-lg px-2.5 py-1.5 text-sm text-text-primary outline-none transition-all disabled:opacity-35"
                    style={{ background: 'var(--c-bg-input)', border: `1px solid ${s.enabled ? s.color + '40' : 'var(--c-border-mid)'}` }}
                  />
                </div>
                <div className="mt-5 text-text-muted text-lg font-light">→</div>
                <div className="flex-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted block mb-1">Close</label>
                  <input
                    type="time"
                    value={s.close}
                    disabled={!s.enabled}
                    onChange={e => upd(s.id, 'close', e.target.value)}
                    className="w-full rounded-lg px-2.5 py-1.5 text-sm text-text-primary outline-none transition-all disabled:opacity-35"
                    style={{ background: 'var(--c-bg-input)', border: `1px solid ${s.enabled ? s.color + '40' : 'var(--c-border-mid)'}` }}
                  />
                </div>
              </div>
              <div className={`flex items-center gap-2 text-[11px] ${!s.enabled ? 'opacity-35' : ''}`}>
                <span className="text-text-muted">Times are</span>
                <select value={s.tz} disabled={!s.enabled} onChange={e => upd(s.id, 'tz', e.target.value)}
                  className="rounded-md px-1.5 py-0.5 text-[11px] outline-none"
                  style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }}>
                  {[...SESSION_ZONES, ...(SESSION_ZONES.some(z => z.tz === s.tz) ? [] : [{ tz: s.tz, label: zoneLabel(s.tz) }])].map(z => <option key={z.tz} value={z.tz}>{z.label} time</option>)}
                </select>
                {s.enabled && <span className="ml-auto num text-text-muted text-right" title="Today, with daylight saving applied">= {hoursIn(s, localTz())} your time · {hoursIn(s, 'UTC')} UTC</span>}
              </div>
              {s.enabled && meta?.desc && (
                <p className="text-[10px] text-text-muted">{meta.desc}</p>
              )}
            </div>
          )
        })}
        <div className="flex justify-between items-center pt-2 border-t border-bg-border">
          <button onClick={() => setLocal(DEFAULT_SESSIONS)} className="text-xs text-text-muted hover:text-text-secondary transition-colors">
            Reset to defaults
          </button>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="button" onClick={save}>Save</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
