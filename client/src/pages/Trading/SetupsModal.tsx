import { useMemo, useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { useTradingSetups, useUpdateSetup, useMergeSetup, useDeleteSetup, useCreateSetup, type TradingSetup } from '../../hooks/useTradingSetups'
import { fmtR } from '../../lib/tradeStats'
import { formatDate } from '../../lib/utils'
import { Archive, ArchiveRestore, GitMerge, Pencil, Trash2 } from 'lucide-react'

const STALE_DAYS = 90

/**
 * Setups you trade, with what each has done. Duplicates merge in a click,
 * setups you no longer use get archived (their trades keep the name), and a
 * line of description reminds future you what a setup actually is.
 */
export function SetupsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: setups = [] } = useTradingSetups()
  const update = useUpdateSetup()
  const merge = useMergeSetup()
  const del = useDeleteSetup()
  const create = useCreateSetup()
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [merging, setMerging] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const active = setups.filter(s => !s.archived)
  const archived = setups.filter(s => s.archived)
  const byId = useMemo(() => new Map(setups.map(s => [s.id, s])), [setups])

  // Each look-alike pair once: the one with fewer trades merges into the other.
  const dupes = useMemo(() => {
    const seen = new Set<string>(), out: { from: TradingSetup; into: TradingSetup }[] = []
    for (const s of setups) for (const id of s.sameAs) {
      const o = byId.get(id)!
      const key = [s.id, o.id].sort().join('-')
      if (seen.has(key)) continue
      seen.add(key)
      const [from, into] = s.trades < o.trades || (s.trades === o.trades && s.name < o.name) ? [s, o] : [o, s]
      out.push({ from, into })
    }
    return out
  }, [setups, byId])

  const cutoff = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString().slice(0, 10)
  const stale = active.filter(s => !s.lastUsed || s.lastUsed < cutoff)

  const onErr = (e: any) => setError(e?.response?.data?.error ?? 'Something went wrong')

  return (
    <Modal open={open} onClose={onClose} title="Setups" size="xl">
      <div className="p-5 space-y-5 overflow-y-auto">
        <p className="text-xs text-text-muted leading-relaxed">
          Archiving takes a setup out of the picker; its trades keep the name and still count in Analytics.
          Merging moves every trade onto the other setup. Add a line to say what a setup is, so you'll recognise it later.
        </p>
        {error && <p className="text-xs" style={{ color: 'var(--c-loss)' }}>{error}</p>}

        {(dupes.length > 0 || stale.length > 0) && (
          <div className="rounded-xl p-3.5 space-y-2.5" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.3)' }}>
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#f59e0b' }}>Suggested cleanup</div>
            {dupes.map(({ from, into }) => (
              <div key={`${from.id}-${into.id}`} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-text-secondary">“{from.name}” ({from.trades}) looks like “{into.name}” ({into.trades})</span>
                <button onClick={() => merge.mutate({ id: from.id, intoId: into.id }, { onError: onErr })}
                  className="ml-auto text-xs px-2.5 py-1 rounded-lg" style={{ background: 'var(--c-accent)', color: 'var(--c-on-accent)' }}>
                  Merge into “{into.name}”
                </button>
              </div>
            ))}
            {stale.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-text-secondary">{stale.length} setups haven't been used in {STALE_DAYS} days.</span>
                <button onClick={() => stale.forEach(s => update.mutate({ id: s.id, archived: true }, { onError: onErr }))}
                  className="ml-auto text-xs px-2.5 py-1 rounded-lg" style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)' }}>
                  Archive all {stale.length}
                </button>
              </div>
            )}
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
              {['Setup', 'Trades', 'W · L', 'Avg R', 'Net R', 'Last used', ''].map(h => (
                <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-widest pb-2 px-2" style={{ color: 'var(--c-text-3)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(showArchived ? [...active, ...archived] : active).map(s => (
              <Row key={s.id} s={s} all={active} editing={editing === s.id} merging={merging === s.id}
                onEdit={() => { setEditing(s.id); setMerging(null) }} onMergeOpen={() => { setMerging(s.id); setEditing(null) }}
                onCancel={() => { setEditing(null); setMerging(null) }}
                onSave={(name, description) => update.mutate({ id: s.id, name, description }, { onSuccess: () => setEditing(null), onError: onErr })}
                onMerge={intoId => merge.mutate({ id: s.id, intoId }, { onSuccess: () => setMerging(null), onError: onErr })}
                onArchive={() => update.mutate({ id: s.id, archived: !s.archived }, { onError: onErr })}
                onDelete={() => del.mutate(s.id, { onError: onErr })} />
            ))}
          </tbody>
        </table>

        <div className="flex flex-wrap items-center gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New setup name"
            onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) create.mutate({ name: newName.trim() }, { onSuccess: () => setNewName('') }) }}
            className="px-2.5 py-1.5 rounded-lg text-sm outline-none w-60"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)' }} />
          <Button size="sm" variant="secondary" disabled={!newName.trim()}
            onClick={() => create.mutate({ name: newName.trim() }, { onSuccess: () => setNewName('') })}>Add</Button>
          {archived.length > 0 && (
            <button onClick={() => setShowArchived(v => !v)} className="ml-auto text-xs hover:underline" style={{ color: 'var(--c-text-3)' }}>
              {showArchived ? 'Hide' : 'Show'} {archived.length} archived
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function Row({ s, all, editing, merging, onEdit, onMergeOpen, onCancel, onSave, onMerge, onArchive, onDelete }: {
  s: TradingSetup; all: TradingSetup[]; editing: boolean; merging: boolean
  onEdit: () => void; onMergeOpen: () => void; onCancel: () => void
  onSave: (name: string, description: string) => void; onMerge: (intoId: number) => void
  onArchive: () => void; onDelete: () => void
}) {
  const [name, setName] = useState(s.name)
  const [desc, setDesc] = useState(s.description ?? '')
  const [into, setInto] = useState<number | ''>('')
  const inputStyle = { background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-1)' }
  const icon = 'p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-secondary'

  return (
    <tr style={{ borderBottom: '1px solid var(--c-border)', opacity: s.archived ? 0.5 : 1 }}>
      <td className="px-2 py-2 align-top">
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <input value={name} onChange={e => setName(e.target.value)} className="px-2 py-1 rounded text-sm outline-none" style={inputStyle} autoFocus />
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="What is this setup? (one line)" className="px-2 py-1 rounded text-xs outline-none" style={inputStyle}
              onKeyDown={e => { if (e.key === 'Enter') onSave(name.trim(), desc) }} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => onSave(name.trim(), desc)} disabled={!name.trim()}>Save</Button>
              <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
            </div>
          </div>
        ) : merging ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-text-muted">Move its {s.trades} trades to</span>
            <select value={into} onChange={e => setInto(e.target.value ? Number(e.target.value) : '')} className="px-2 py-1 rounded text-xs outline-none" style={inputStyle}>
              <option value="">pick a setup…</option>
              {all.filter(o => o.id !== s.id).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <Button size="sm" disabled={into === ''} onClick={() => into !== '' && onMerge(into)}>Merge</Button>
            <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
          </div>
        ) : (
          <>
            <div className="text-text-primary">{s.name}{s.archived && <span className="text-[10px] text-text-muted"> · archived</span>}</div>
            {s.description && <div className="text-[11px] text-text-muted">{s.description}</div>}
          </>
        )}
      </td>
      <td className="px-2 py-2 num text-text-secondary align-top">{s.trades}</td>
      <td className="px-2 py-2 num text-xs align-top whitespace-nowrap">
        <span style={{ color: 'var(--c-profit)' }}>{s.wins}</span><span className="text-text-muted"> · </span><span style={{ color: 'var(--c-loss)' }}>{s.losses}</span>
      </td>
      <td className="px-2 py-2 num text-xs align-top" style={{ color: s.avgR == null ? undefined : s.avgR >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>{fmtR(s.avgR)}</td>
      <td className="px-2 py-2 num text-xs align-top" style={{ color: s.netR == null ? undefined : s.netR >= 0 ? 'var(--c-profit)' : 'var(--c-loss)' }}>{fmtR(s.netR, 1)}</td>
      <td className="px-2 py-2 text-xs text-text-muted align-top whitespace-nowrap">{s.lastUsed ? formatDate(s.lastUsed) : 'never'}</td>
      <td className="px-2 py-1.5 align-top">
        {!editing && !merging && (
          <div className="flex justify-end gap-0.5">
            <button className={icon} title="Rename or describe" onClick={onEdit}><Pencil size={12} /></button>
            {s.trades > 0 && <button className={icon} title="Merge into another setup" onClick={onMergeOpen}><GitMerge size={12} /></button>}
            <button className={icon} title={s.archived ? 'Restore' : 'Archive'} onClick={onArchive}>
              {s.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
            </button>
            {s.trades === 0 && <button className={icon} title="Delete" onClick={onDelete}><Trash2 size={12} /></button>}
          </div>
        )}
      </td>
    </tr>
  )
}
