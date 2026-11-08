/**
 * Notes, the one-layout redesign (approved 2026-11-08). A capture line on
 * top: press N, type, Enter, and the note exists before you decide where it
 * goes. The list groups Pinned, This week and Earlier with folders below; the
 * editor is the hero at a calm reading width. New on top of every old
 * feature: images (paste or drop), tags you can see and filter by, and search
 * over the full text on the server.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions/placeholder'
import {
  useCreateCategory, useCreateNote, useDeleteCategory, useDeleteNote, useDeletedNotes, useNoteCategories, useNotes,
  usePermanentlyDeleteNote, useRestoreNote, useUpdateCategory, useUpdateNote, useUploadNoteImages,
} from '../../hooks/useNotes'
import { api } from '../../lib/api'
import { useQueryClient } from '@tanstack/react-query'
import { PageLoader } from '../../components/ui/Spinner'
import { Bold, Code, Heading1, Heading2, Italic, List as ListIcon, ListChecks, ListOrdered, Minus, Quote, SquareCode } from 'lucide-react'
import { ContextMenu, type MenuAt, type MenuItem } from './ContextMenu'
import './next.css'
import './roadmap.css'
import './training.css'
import './money.css'
import './notes.css'

type Img = { id: number; filePath: string; originalName: string | null }
type Note = { id: number; title: string; content: string | null; categoryId: number | null; tags: string[] | null; pinned: number; createdAt: string; updatedAt: string; deletedAt?: string | null; images?: Img[] }
type Folder = { id: number; name: string; color: string | null; parentId: number | null }
const FOLDER_COLORS = ['#818cf8', '#34d399', '#fbbf24', '#f87171', '#22d3ee', '#a78bfa', '#fb923c', '#e879f9']
const TRASH_DAYS = 30

const utc = (s: string) => (s.includes('Z') || s.includes('+') ? s : s.replace(' ', 'T') + 'Z')
const ago = (s: string) => {
  const m = Math.floor((Date.now() - new Date(utc(s)).getTime()) / 60000)
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h} h ago`
  return new Date(utc(s)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
const longDate = (s: string) => new Date(utc(s)).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const daysLeft = (s: string) => Math.max(0, Math.ceil((new Date(utc(s)).getTime() + TRASH_DAYS * 864e5 - Date.now()) / 864e5))

type PMNode = { type?: string; text?: string; content?: PMNode[] }
const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'codeBlock', 'horizontalRule'])
function textOf(n: PMNode | undefined): string {
  if (!n) return ''
  if (n.type === 'text') return n.text ?? ''
  if (n.type === 'hardBreak') return '\n'
  const inner = (n.content ?? []).map(textOf).join('')
  return BLOCKS.has(n.type ?? '') ? inner + '\n' : inner
}
const plain = (content: string | null) => { try { return textOf(JSON.parse(content || '{}')).replace(/\n{3,}/g, '\n\n').trim() } catch { return '' } }
const preview = (n: Note) => plain(n.content).replace(/\s+/g, ' ').slice(0, 110)
async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t) } catch {
    const el = document.createElement('textarea'); el.value = t; document.body.appendChild(el); el.select(); document.execCommand('copy'); el.remove()
  }
}
const asText = (n: Note) => { const c = plain(n.content); return c ? `${n.title || 'Untitled'}\n\n${c}` : n.title || 'Untitled' }

// ─── Page ────────────────────────────────────────────────────────────────────

export function NextNotes() {
  const { data: notesRaw = [], isPending } = useNotes()
  const { data: foldersRaw = [] } = useNoteCategories()
  const notes = notesRaw as Note[], folders = foldersRaw as Folder[]
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t) }, [q])
  const search = useNotes(debounced ? { q: debounced } : {})
  const [folder, setFolder] = useState<number | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [trash, setTrash] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)
  /** Notes picked with ⌘-click, ⇧-click, ⇧-arrows or Select mode. Empty means just the open note. */
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [anchor, setAnchor] = useState<number | null>(null)
  const [menuAt, setMenuAt] = useState<MenuAt>(null)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const [help, setHelp] = useState(false)
  const lastDeleted = useRef<number[]>([])
  const upd = useUpdateNote(), create = useCreateNote(), del = useDeleteNote(), restore = useRestoreNote()
  const captureRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [focusEditor, setFocusEditor] = useState(0)

  // Folder filter includes subfolders.
  const inFolder = useCallback((n: Note) => {
    if (folder == null) return true
    const ids = new Set<number>([folder]); let grew = true
    while (grew) { grew = false; for (const f of folders) if (f.parentId != null && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true } }
    return n.categoryId != null && ids.has(n.categoryId)
  }, [folder, folders])
  const base = debounced ? ((search.data ?? []) as Note[]) : notes
  const visible = base.filter(n => inFolder(n) && (!tag || (n.tags ?? []).includes(tag)))
    .sort((a, b) => (b.pinned - a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
  const active = notes.find(n => n.id === activeId) ?? (activeId == null && !trash ? visible[0] : undefined) ?? null
  const select = selectMode ? sel : null

  // ── Actions on one or many notes, shared by keys, the right-click menu and the bulk bar.
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const say = (text: string, undo?: () => void) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, undo }); toastTimer.current = setTimeout(() => setToast(null), 6000)
  }
  // Focus a note in the list; if it isn't drawn yet (just restored or made), wait for the list to catch up.
  const wantFocus = useRef<number | null>(null)
  const tryFocus = () => {
    const id = wantFocus.current
    const el = id != null ? document.querySelector<HTMLElement>(`[data-note-id="${id}"]`) : null
    if (el) { el.focus(); el.scrollIntoView({ block: 'nearest' }); wantFocus.current = null }
  }
  const focusNote = (id: number | null) => { wantFocus.current = id; requestAnimationFrame(tryFocus) }
  useEffect(() => { if (wantFocus.current != null) tryFocus() })
  const targets = (id?: number): Note[] => {
    const ids = id != null && !sel.has(id) ? [id] : sel.size ? [...sel] : active ? [active.id] : []
    return ids.map(i => notes.find(n => n.id === i)).filter((n): n is Note => !!n)
  }
  const plural = (n: number) => (n === 1 ? 'note' : `${n} notes`)
  const undoDelete = () => {
    const ids = lastDeleted.current
    if (!ids.length) return
    lastDeleted.current = []
    Promise.all(ids.map(i => restore.mutateAsync(i))).then(() => { setActiveId(ids[0]); focusNote(ids[0]); say(`Restored ${plural(ids.length)}`) })
  }
  const remove = async (list: Note[]) => {
    if (!list.length) return
    const ids = list.map(n => n.id)
    // The open note moves to the next one down, or up when the last went.
    const order = visible.map(n => n.id)
    const after = order.slice(order.indexOf(ids[ids.length - 1]) + 1).find(i => !ids.includes(i))
    const before = [...order.slice(0, order.indexOf(ids[0]))].reverse().find(i => !ids.includes(i))
    const next = after ?? before ?? null
    await Promise.all(ids.map(i => del.mutateAsync(i)))
    lastDeleted.current = ids
    setSel(new Set()); setSelectMode(false); setActiveId(next); focusNote(next)
    say(`Moved ${list.length === 1 ? `"${list[0].title || 'Untitled'}"` : `${list.length} notes`} to Recently deleted`, undoDelete)
  }
  const duplicate = async (list: Note[]) => {
    let first: number | null = null
    for (const x of list) {
      const n: Note = await create.mutateAsync({ title: `${x.title || 'Untitled'} (Copy)`, content: x.content, tags: x.tags ?? [], pinned: 0, categoryId: x.categoryId })
      first ??= n.id
    }
    if (first != null) { setSel(new Set()); setActiveId(first); focusNote(first); say(`Duplicated ${plural(list.length)}`) }
  }
  const copy = async (list: Note[]) => { if (!list.length) return; await copyText(list.map(asText).join('\n\n---\n\n')); say(`Copied ${plural(list.length)} as text`) }
  const pin = (list: Note[], on: boolean) => { list.forEach(x => upd.mutate({ id: x.id, pinned: on ? 1 : 0 })); say(`${on ? 'Pinned' : 'Unpinned'} ${plural(list.length)}`) }
  const move = (list: Note[], to: number | null) => {
    list.forEach(x => upd.mutate({ id: x.id, categoryId: to }))
    say(`Moved ${plural(list.length)} to ${to == null ? 'No folder' : folders.find(f => f.id === to)?.name ?? 'the folder'}`)
  }

  // ── Clicks in the list, the macOS way: click opens, ⌘-click adds, ⇧-click picks a range.
  const pick = (e: React.MouseEvent | null, id: number) => {
    if (selectMode || e?.metaKey || e?.ctrlKey) {
      setSel(s => { const n = new Set(s.size || selectMode ? s : active ? [active.id] : []); if (n.has(id)) n.delete(id); else n.add(id); return n })
      setAnchor(id); return
    }
    if (e?.shiftKey && (anchor ?? active?.id) != null) {
      const order = visible.map(n => n.id)
      const a = order.indexOf((anchor ?? active!.id)), b = order.indexOf(id)
      if (a >= 0 && b >= 0) { setSel(new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1))); return }
    }
    setSel(new Set()); setAnchor(id); setActiveId(id)
  }

  // ── The right-click menu for a note (or every picked note, when it is one of them).
  const noteMenu = (e: React.MouseEvent, id: number) => {
    e.preventDefault()
    if (!sel.has(id)) { setSel(new Set()); setActiveId(id); setAnchor(id) }
    const list = sel.has(id) ? targets(id) : [notes.find(n => n.id === id)!].filter(Boolean)
    const many = list.length > 1
    const allPinned = list.every(n => n.pinned)
    const items: MenuItem[] = [
      ...(!many ? [{ label: 'Open', keys: '↩', run: () => { setActiveId(id); setFocusEditor(x => x + 1) } } as MenuItem] : []),
      { label: allPinned ? (many ? `Unpin ${list.length} notes` : 'Unpin') : (many ? `Pin ${list.length} notes` : 'Pin to top'), keys: 'P', run: () => pin(list, !allPinned) },
      { label: 'Move to', sub: [
        { label: 'No folder', checked: list.every(n => n.categoryId == null), run: () => move(list, null) },
        ...(folders.length ? [{ sep: true } as MenuItem] : []),
        ...folders.map(f => ({ label: folders.find(p => p.id === f.parentId) ? `${folders.find(p => p.id === f.parentId)!.name} / ${f.name}` : f.name, checked: list.every(n => n.categoryId === f.id), run: () => move(list, f.id) })),
      ] },
      { sep: true },
      { label: many ? `Copy ${list.length} as text` : 'Copy as text', keys: '⌘C', run: () => copy(list) },
      { label: many ? `Duplicate ${list.length}` : 'Duplicate', keys: '⌘D', run: () => duplicate(list) },
      { sep: true },
      { label: 'Select', keys: '⌘-click', run: () => { setSelectMode(true); setSel(new Set(list.map(n => n.id))) } },
      { label: 'Select all', keys: '⌘A', run: () => setSel(new Set(visible.map(n => n.id))) },
      { sep: true },
      { label: many ? `Delete ${list.length} notes` : 'Delete', keys: '⌫', danger: true, run: () => remove(list) },
    ]
    setMenuAt({ x: e.clientX, y: e.clientY, items })
  }

  // Keys. They act on the list whenever you're not typing; Esc in the editor hands control back to the list.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  const onKeyNow = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement
    const mod = e.metaKey || e.ctrlKey
    if (menuAt || el.closest('[role="dialog"], .nx-ctx')) return
    if (e.key === 'Escape' && el.closest('.nno-pm, .nno-ti')) { e.preventDefault(); el.blur(); focusNote(active?.id ?? null); return }
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRef.current?.focus(); return }
    if (el.closest('input, textarea, select, [contenteditable="true"]')) return
    if (e.key === 'Escape' && (sel.size || selectMode)) { e.preventDefault(); setSel(new Set()); setSelectMode(false); return }
    if (trash) return
    const order = visible.map(n => n.id)
    const at = active ? order.indexOf(active.id) : -1
    const k = e.key.toLowerCase()
    const step = (d: number) => {
      const i = Math.max(0, Math.min(order.length - 1, (at < 0 ? -1 : at) + d))
      const id = order[i]; if (id == null) return
      if (e.shiftKey) {
        const a = anchor ?? active?.id ?? id
        const ai = order.indexOf(a)
        setSel(new Set(order.slice(Math.min(ai, i), Math.max(ai, i) + 1))); setAnchor(a)
      } else { setSel(new Set()); setAnchor(id) }
      setActiveId(id); focusNote(id)
    }
    if (e.key === 'ArrowDown' && !mod) { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowUp' && !mod) { e.preventDefault(); step(-1) }
    else if (mod && e.key === 'ArrowUp') { e.preventDefault(); step(-order.length) }
    else if (mod && e.key === 'ArrowDown') { e.preventDefault(); step(order.length) }
    else if (e.key === 'Enter' && !mod && active) { e.preventDefault(); setFocusEditor(x => x + 1) }
    else if ((e.key === 'Backspace' || e.key === 'Delete') && !e.altKey) { e.preventDefault(); remove(targets()) }
    else if (mod && k === 'z' && !e.shiftKey && lastDeleted.current.length) { e.preventDefault(); undoDelete() }
    else if (mod && k === 'd') { e.preventDefault(); duplicate(targets()) }
    else if (mod && k === 'c' && !window.getSelection()?.toString()) { e.preventDefault(); copy(targets()) }
    else if (mod && k === 'a') { e.preventDefault(); setSel(new Set(order)) }
    else if (mod || e.altKey) return
    else if (k === 'n') { e.preventDefault(); captureRef.current?.focus() }
    else if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
    else if (k === 'p') { e.preventDefault(); const l = targets(); pin(l, !l.every(n => n.pinned)) }
    else if (e.key === '?') { e.preventDefault(); setHelp(h => !h) }
  }
  useLayoutEffect(() => { keys.current = onKeyNow })
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  if (isPending) return <PageLoader />
  return (
    <div className="wh-page nx nno skin-enter">
      <div className="nx-wrap">
        <div className="nno-bar">
          <h1 className="nno-title">Notes</h1>
          <span className="nno-rule">{notes.length} note{notes.length === 1 ? '' : 's'}</span>
          <span className="nr-grow" />
          <div className="nno-search">
            <input ref={searchRef} className="nr-in" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setQ(''); (e.target as HTMLInputElement).blur() } }} placeholder="Search all text" aria-label="Search notes" />
            <kbd>/</kbd>
          </div>
          <button className="nx-btn ghost sm" onClick={() => setHelp(true)} title="Keyboard shortcuts (?)">Shortcuts<kbd>?</kbd></button>
          <button className={`nx-btn ghost sm ${selectMode ? 'on' : ''}`} onClick={() => { setSelectMode(m => !m); setSel(new Set()) }} aria-pressed={selectMode}>{selectMode ? 'Done' : 'Select'}</button>
        </div>
        <div className="nno-grid">
          <div className="nno-side">
            {!trash && <Capture inputRef={captureRef} folder={folder} onMade={id => { setActiveId(id); setFocusEditor(x => x + 1) }} />}
            <Folders notes={notes} folders={folders} folder={folder} trash={trash} onMenu={setMenuAt}
              onPick={f => { setFolder(f); setTrash(false) }} onTrash={() => { setTrash(true); setSel(new Set()); setSelectMode(false) }} />
            {(selectMode || sel.size > 1) && <Bulk ids={sel} notes={notes} folders={folders} visible={visible} onAll={() => setSel(new Set(visible.map(n => n.id)))} onDone={() => { setSel(new Set()); setSelectMode(false) }} onDelete={list => remove(list)} />}
            {trash ? <Trash onBack={() => setTrash(false)} onMenu={setMenuAt} /> : (
              <List label={debounced ? `Matching "${debounced}"` : folder != null ? (folders.find(f => f.id === folder)?.name ?? 'Folder') : 'All notes'} notes={visible} folders={folders} active={active?.id ?? null} select={select} picked={sel} searching={!!debounced} tag={tag}
                onPick={pick} onMenu={noteMenu}
                onClearTag={() => setTag(null)} />
            )}
          </div>
          <section className="nx-hero nno-hero" aria-label="Editor">
            {active && !trash
              ? <NoteEditor key={active.id} note={active} folders={folders} focus={focusEditor} onTag={t => setTag(t)} onGone={() => setActiveId(null)} />
              : <EmptyEditor trash={trash} count={notes.length} onCapture={() => captureRef.current?.focus()} />}
          </section>
        </div>
      </div>
      <ContextMenu at={menuAt} onClose={() => setMenuAt(null)} />
      {toast && (
        <div className="wh-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button className="wh-undo" onClick={() => { const u = toast.undo!; setToast(null); u() }}>Undo<kbd>⌘Z</kbd></button>}
        </div>
      )}
      {help && <Shortcuts onClose={() => setHelp(false)} />}
    </div>
  )
}

/** Every key on the page, in one sheet (press ?). */
function Shortcuts({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])
  const groups: [string, [string, string][]][] = [
    ['Notes', [['N', 'New note'], ['↩', 'Edit the open note'], ['Esc', 'Back to the list from the editor'], ['⌫ or ⌘⌫', 'Move to Recently deleted'], ['⌘Z', 'Undo the delete'], ['⌘D', 'Duplicate'], ['⌘C', 'Copy as text'], ['P', 'Pin or unpin']]],
    ['Moving around', [['↑ ↓', 'Previous or next note'], ['⌘↑ ⌘↓', 'First or last note'], ['/ or ⌘F', 'Search'], ['Right-click', 'Every action for a note or folder']]],
    ['Picking several', [['⌘-click', 'Add or remove a note'], ['⇧-click', 'Pick a range'], ['⇧↑ ⇧↓', 'Extend the pick'], ['⌘A', 'Pick all'], ['Esc', 'Clear the pick']]],
    ['Anywhere', [['H', 'Hide or show amounts'], ['L', 'Light or dark'], ['⌘K', 'Search the app']]],
  ]
  return (
    <div className="nr-sheet-bg" onMouseDown={onClose}>
      <div className="nr-sheet nno-keys" role="dialog" aria-label="Keyboard shortcuts" onMouseDown={e => e.stopPropagation()}>
        <div className="hd"><div><h2>Keyboard shortcuts</h2><p>They work whenever you're not typing.</p></div><button className="nx-btn ghost sm" onClick={onClose}>Close</button></div>
        <div className="cols">
          {groups.map(([g, rows]) => (
            <div key={g}><h3>{g}</h3>{rows.map(([k, l]) => <p key={k + l}><kbd>{k}</kbd><span>{l}</span></p>)}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Capture: one line, Enter, keep typing in the editor ─────────────────────

function Capture({ inputRef, folder, onMade }: { inputRef: React.RefObject<HTMLInputElement | null>; folder: number | null; onMade: (id: number) => void }) {
  const create = useCreateNote()
  const [line, setLine] = useState('')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const title = line.trim()
    create.mutate({ title, content: '', tags: [], pinned: 0, ...(folder != null ? { categoryId: folder } : {}) }, { onSuccess: (n: Note) => { setLine(''); onMade(n.id) } })
  }
  return (
    <form className="nno-cap" onSubmit={submit}>
      <div className="in">
        <input ref={inputRef} className="nr-in" value={line} onChange={e => setLine(e.target.value)} placeholder="New note: type a title, press Enter" aria-label="New note title" />
        <kbd>N</kbd>
      </div>
      <button className="nx-btn" type="submit" disabled={create.isPending} title="Make a note and start writing">New note</button>
    </form>
  )
}

// ─── The list: Pinned, This week, Earlier ────────────────────────────────────

function List({ label, notes, folders, active, select, picked, searching, tag, onPick, onMenu, onClearTag }: {
  label: string; notes: Note[]; folders: Folder[]; active: number | null; select: Set<number> | null; picked: Set<number>; searching: boolean; tag: string | null
  onPick: (e: React.MouseEvent, id: number) => void; onMenu: (e: React.MouseEvent, id: number) => void; onClearTag: () => void
}) {
  const [weekAgo] = useState(() => new Date(Date.now() - 7 * 864e5).toISOString())
  const groups = [
    { k: 'Pinned', list: notes.filter(n => n.pinned) },
    { k: 'This week', list: notes.filter(n => !n.pinned && utc(n.updatedAt) >= weekAgo) },
    { k: 'Earlier', list: notes.filter(n => !n.pinned && utc(n.updatedAt) < weekAgo) },
  ].filter(g => g.list.length)
  const folderOf = (id: number | null) => folders.find(f => f.id === id)
  return (
    <div className="nno-list">
      <p className="nno-showing"><b>{label}</b><span className="num">{notes.length} note{notes.length === 1 ? '' : 's'}</span></p>
      {tag && <p className="nno-filter">Tagged <b>#{tag}</b> <button className="ntr-lnk" onClick={onClearTag}>Clear</button></p>}
      {!notes.length && <p className="nx-answer">{searching ? 'No note has that text.' : 'No notes here yet. Write one in the line above.'}</p>}
      {groups.map(g => (
        <div key={g.k} className="grp">
          <div className="gh"><span>{g.k}</span><span className="num">{g.list.length}</span></div>
          {g.list.map(n => {
            const f = folderOf(n.categoryId)
            const on = picked.has(n.id)
            return (
              <button key={n.id} data-note-id={n.id} className={`nno-item ${active === n.id && !select && !picked.size ? 'on' : ''} ${on ? 'chk' : ''}`}
                onClick={e => onPick(e, n.id)} onContextMenu={e => onMenu(e, n.id)} aria-pressed={select ? !!on : active === n.id}>
                {select && <i className="box" aria-hidden />}
                <span className="t">{n.title || 'Untitled'}</span>
                <span className="p">{preview(n) || <em>No text yet</em>}</span>
                <span className="m">{f && <><i className="nx-dot" style={{ color: f.color ?? undefined }} />{f.name} · </>}{ago(n.updatedAt)}{n.images?.length ? ` · ${n.images.length} image${n.images.length === 1 ? '' : 's'}` : ''}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Select mode: pin, unpin, copy, duplicate, move and delete many at once. */
function Bulk({ ids, notes, folders, visible, onAll, onDone, onDelete }: { ids: Set<number>; notes: Note[]; folders: Folder[]; visible: Note[]; onAll: () => void; onDone: () => void; onDelete: (list: Note[]) => void }) {
  const upd = useUpdateNote(), create = useCreateNote()
  const [confirm, setConfirm] = useState(false)
  const chosen = notes.filter(n => ids.has(n.id))
  const n = chosen.length
  return (
    <div className="nno-bulk">
      <div className="hd"><b className="num">{n} selected</b><button className="ntr-lnk" onClick={onAll}>All {visible.length}</button></div>
      <div className="acts">
        <button className="bz-mini" disabled={!n} onClick={() => { chosen.forEach(x => upd.mutate({ id: x.id, pinned: 1 })); onDone() }}>Pin</button>
        <button className="bz-mini" disabled={!n} onClick={() => { chosen.forEach(x => upd.mutate({ id: x.id, pinned: 0 })); onDone() }}>Unpin</button>
        <button className="bz-mini" disabled={!n} onClick={async () => { await copyText(chosen.map(asText).join('\n\n---\n\n')); onDone() }}>Copy</button>
        <button className="bz-mini" disabled={!n} onClick={async () => { for (const x of chosen) await create.mutateAsync({ title: `${x.title || 'Untitled'} (Copy)`, content: x.content, tags: x.tags ?? [], pinned: 0, categoryId: x.categoryId }); onDone() }}>Duplicate</button>
        <select className="nmo-cat" disabled={!n} value="" onChange={e => { const v = e.target.value; chosen.forEach(x => upd.mutate({ id: x.id, categoryId: v === 'none' ? null : Number(v) })); onDone() }} aria-label="Move to folder">
          <option value="">Move to…</option><option value="none">No folder</option>{folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        {confirm
          ? <><button className="bz-mini" onClick={() => setConfirm(false)}>Keep</button><button className="bz-mini danger" onClick={() => onDelete(chosen)}>Delete {n}</button></>
          : <button className="bz-mini danger" disabled={!n} onClick={() => setConfirm(true)}>Delete</button>}
      </div>
    </div>
  )
}

// ─── Folders, with subfolders; Recently deleted ──────────────────────────────

function Folders({ notes, folders, folder, trash, onPick, onTrash, onMenu }: { notes: Note[]; folders: Folder[]; folder: number | null; trash: boolean; onPick: (f: number | null) => void; onTrash: () => void; onMenu: (m: MenuAt) => void }) {
  const createF = useCreateCategory(), updF = useUpdateCategory(), delF = useDeleteCategory()
  const { data: deleted = [] } = useDeletedNotes()
  const [adding, setAdding] = useState<number | null | false>(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(FOLDER_COLORS[0])
  const [edit, setEdit] = useState<Folder | null>(null)
  const [confirm, setConfirm] = useState(false)
  const count = (id: number) => notes.filter(n => n.categoryId === id).length
  const add = (parentId: number | null) => { if (!name.trim()) return; createF.mutate({ name: name.trim(), color, parentId }, { onSuccess: (f: Folder) => { setName(''); setAdding(false); onPick(f.id) } }) }
  // The path to the open folder, so its parent and its subfolders both show.
  const chain: Folder[] = []
  for (let f = folders.find(x => x.id === folder); f; f = folders.find(x => x.id === f!.parentId)) chain.unshift(f)
  const roots = folders.filter(f => f.parentId == null)
  const kids = folder != null ? folders.filter(f => f.parentId === folder) : []
  const chip = (f: Folder) => (
    <span key={f.id} className={`nno-chip ${folder === f.id && !trash ? 'on' : ''} ${chain.some(c => c.id === f.id) && folder !== f.id ? 'path' : ''}`}
      onContextMenu={e => { e.preventDefault(); onMenu({ x: e.clientX, y: e.clientY, items: [
        { label: 'Open', run: () => onPick(f.id) },
        { label: 'Rename or recolour…', run: () => { onPick(f.id); setEdit(f); setConfirm(false); setAdding(false) } },
        { label: 'New subfolder…', run: () => { onPick(f.id); setAdding(f.id); setEdit(null); setName('') } },
        { sep: true },
        { label: 'Delete folder…', danger: true, run: () => { onPick(f.id); setEdit(f); setConfirm(true); setAdding(false) } },
      ] }) }}>
      <button onClick={() => onPick(folder === f.id ? f.parentId : f.id)}><i className="nx-dot" style={{ color: f.color ?? undefined }} />{f.name}<span className="num">{count(f.id)}</span></button>
      {folder === f.id && !trash && <button className="e" onClick={() => { setEdit(edit ? null : f); setConfirm(false); setAdding(false) }} aria-label={`Edit folder ${f.name}`} title="Rename, recolour, add a subfolder or delete">⋯</button>}
    </span>
  )
  const swatches = (cur: string | null, set: (c: string) => void) => <div className="sw">{FOLDER_COLORS.map(c => <button type="button" key={c} className={cur === c ? 'on' : ''} style={{ background: c }} onClick={() => set(c)} aria-label={`Colour ${c}`} />)}</div>
  return (
    <div className="nno-folders">
      <div className="nno-chips" role="group" aria-label="Folders">
        <span className={`nno-chip ${folder == null && !trash ? 'on' : ''}`}><button onClick={() => onPick(null)}>All notes<span className="num">{notes.length}</span></button></span>
        {roots.map(chip)}
        <span className="nno-chip add"><button onClick={() => { setAdding(adding === null ? false : null); setEdit(null); setName('') }} title="Make a folder">+ Folder</button></span>
        <span className={`nno-chip trash ${trash ? 'on' : ''}`}><button onClick={onTrash}>Deleted<span className="num">{(deleted as Note[]).length}</span></button></span>
      </div>
      {chain.length > 0 && (kids.length > 0 || chain.length > 1) && (
        <div className="nno-chips sub" role="group" aria-label="Subfolders">
          {chain.length > 1 && <span className="nno-crumb">{chain.slice(0, -1).map(c => c.name).join(' / ')} /</span>}
          {chain.length > 1 && chip(chain[chain.length - 1])}
          {kids.map(chip)}
        </div>
      )}
      {adding !== false && (
        <form className="nno-fform" onSubmit={e => { e.preventDefault(); add(adding) }} onKeyDown={e => { if (e.key === 'Escape') setAdding(false) }}>
          <input className="nr-in" value={name} onChange={e => setName(e.target.value)} placeholder={adding != null ? `Subfolder of ${folders.find(f => f.id === adding)?.name}` : 'Folder name, e.g. Trading'} autoFocus aria-label="Folder name" />
          {swatches(color, setColor)}
          <div className="row"><button className="nx-btn sm" type="submit">Make folder</button><button type="button" className="nx-btn ghost sm" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>
      )}
      {edit && (
        <form className="nno-fform" onSubmit={e => { e.preventDefault(); updF.mutate({ id: edit.id, name: edit.name.trim() || 'Folder', color: edit.color }, { onSuccess: () => setEdit(null) }) }} onKeyDown={e => { if (e.key === 'Escape') setEdit(null) }}>
          <input className="nr-in" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} autoFocus aria-label="Folder name" />
          {swatches(edit.color, c => setEdit({ ...edit, color: c }))}
          <div className="row">
            <button className="nx-btn sm" type="submit">Save</button>
            <button type="button" className="nx-btn ghost sm" onClick={() => { setAdding(edit.id); setEdit(null); setName('') }}>Add a subfolder</button>
            {confirm
              ? <button type="button" className="nx-btn sm danger" onClick={() => delF.mutate(edit.id, { onSuccess: () => { setEdit(null); setConfirm(false); onPick(null) } })}>Delete folder</button>
              : <button type="button" className="nx-btn ghost sm" onClick={() => setConfirm(true)}>Delete</button>}
          </div>
          {confirm && <p className="nno-hint">Its notes stay, with no folder.</p>}
        </form>
      )}
    </div>
  )
}

function Trash({ onBack, onMenu }: { onBack: () => void; onMenu: (m: MenuAt) => void }) {
  const { data = [] } = useDeletedNotes()
  const restore = useRestoreNote(), forever = usePermanentlyDeleteNote()
  const [confirm, setConfirm] = useState<number | 'all' | null>(null)
  const list = (data as Note[]).sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''))
  return (
    <div className="nno-list nno-trash">
      <div className="gh"><span>Recently deleted</span><button className="ntr-lnk" onClick={onBack}>Back to notes</button></div>
      <p className="nno-hint">Kept for {TRASH_DAYS} days, then gone for good.</p>
      {!list.length && <p className="nx-answer">Nothing deleted.</p>}
      {list.map(n => (
        <div key={n.id} className="nno-dead" onContextMenu={e => { e.preventDefault(); onMenu({ x: e.clientX, y: e.clientY, items: [
          { label: 'Restore', run: () => restore.mutate(n.id) },
          { sep: true },
          { label: 'Delete forever', danger: true, run: () => forever.mutate(n.id) },
        ] }) }}>
          <span className="t">{n.title || 'Untitled'}<small>{daysLeft(n.deletedAt!)} day{daysLeft(n.deletedAt!) === 1 ? '' : 's'} left</small></span>
          <button className="bz-mini" onClick={() => restore.mutate(n.id)}>Restore</button>
          {confirm === n.id
            ? <button className="bz-mini danger" onClick={() => forever.mutate(n.id, { onSuccess: () => setConfirm(null) })}>Delete forever</button>
            : <button className="bz-mini" onClick={() => setConfirm(n.id)} aria-label={`Delete ${n.title || 'Untitled'} forever`}>×</button>}
        </div>
      ))}
      {list.length > 1 && (confirm === 'all'
        ? <p className="nno-hint">Delete all {list.length} for good? <button className="bz-mini" onClick={() => setConfirm(null)}>Keep</button> <button className="bz-mini danger" onClick={async () => { await Promise.all(list.map(n => forever.mutateAsync(n.id))); setConfirm(null) }}>Empty</button></p>
        : <button className="ntr-lnk nno-empty" onClick={() => setConfirm('all')}>Empty recently deleted</button>)}
    </div>
  )
}

// ─── The editor ──────────────────────────────────────────────────────────────

function EmptyEditor({ trash, count, onCapture }: { trash: boolean; count: number; onCapture: () => void }) {
  return (
    <div className="nno-none">
      <h2>{trash ? 'Recently deleted' : count ? 'Pick a note' : 'Your first note'}</h2>
      <p>{trash ? 'Restore puts a note back in the folder it was in. Anything deleted more than 30 days ago is removed for good.' : 'Press N, type a title and Enter. Then keep typing here: lists, tasks, headings, quotes and code, with images pasted straight in.'}</p>
      {!trash && <button className="nx-btn" onClick={onCapture}>Write a note<kbd>N</kbd></button>}
    </div>
  )
}

function Tool({ on, label, run, children }: { on?: boolean; label: string; run: () => void; children: React.ReactNode }) {
  return <button type="button" className={on ? 'on' : ''} onMouseDown={e => { e.preventDefault(); run() }} title={label} aria-label={label} aria-pressed={!!on}>{children}</button>
}

function Toolbar({ ed }: { ed: Editor | null }) {
  if (!ed) return null
  const c = () => ed.chain().focus()
  return (
    <div className="nno-tools" role="toolbar" aria-label="Formatting">
      <Tool on={ed.isActive('bold')} label="Bold" run={() => c().toggleBold().run()}><Bold size={15} /></Tool>
      <Tool on={ed.isActive('italic')} label="Italic" run={() => c().toggleItalic().run()}><Italic size={15} /></Tool>
      <Tool on={ed.isActive('code')} label="Inline code" run={() => c().toggleCode().run()}><Code size={15} /></Tool>
      <span className="sep" />
      <Tool on={ed.isActive('heading', { level: 1 })} label="Big heading" run={() => c().toggleHeading({ level: 1 }).run()}><Heading1 size={16} /></Tool>
      <Tool on={ed.isActive('heading', { level: 2 })} label="Small heading" run={() => c().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></Tool>
      <span className="sep" />
      <Tool on={ed.isActive('bulletList')} label="Bullet list" run={() => c().toggleBulletList().run()}><ListIcon size={16} /></Tool>
      <Tool on={ed.isActive('orderedList')} label="Numbered list" run={() => c().toggleOrderedList().run()}><ListOrdered size={16} /></Tool>
      <Tool on={ed.isActive('taskList')} label="Checklist" run={() => c().toggleTaskList().run()}><ListChecks size={16} /></Tool>
      <span className="sep" />
      <Tool on={ed.isActive('blockquote')} label="Quote" run={() => c().toggleBlockquote().run()}><Quote size={15} /></Tool>
      <Tool on={ed.isActive('codeBlock')} label="Code block" run={() => c().toggleCodeBlock().run()}><SquareCode size={16} /></Tool>
      <Tool label="Divider line" run={() => c().setHorizontalRule().run()}><Minus size={16} /></Tool>
    </div>
  )
}

function NoteEditor({ note, folders, focus, onTag, onGone }: { note: Note; folders: Folder[]; focus: number; onTag: (t: string) => void; onGone: () => void }) {
  const upd = useUpdateNote(), create = useCreateNote(), del = useDeleteNote(), upload = useUploadNoteImages()
  const qc = useQueryClient()
  const [title, setTitle] = useState(note.title)
  const [status, setStatus] = useState<'saved' | 'saving'>('saved')
  const [tagIn, setTagIn] = useState('')
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [copied, setCopied] = useState(false)
  const [drag, setDrag] = useState(false)
  const pending = useRef<Record<string, unknown>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    const patch = pending.current; pending.current = {}
    if (Object.keys(patch).length) upd.mutate({ id: note.id, ...patch }, { onSuccess: () => setStatus('saved') })
    else setStatus('saved')
  }, [note.id, upd])
  const save = useCallback((p: Record<string, unknown>) => {
    pending.current = { ...pending.current, ...p }; setStatus('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 800)
  }, [flush])
  // Save anything typed when switching notes or leaving the page.
  const flushRef = useRef(flush)
  useEffect(() => { flushRef.current = flush }, [flush])
  useEffect(() => () => flushRef.current(), [])

  const ed = useEditor({
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), Placeholder.configure({ placeholder: 'Keep typing…' })],
    content: (() => { try { return note.content ? JSON.parse(note.content) : '' } catch { return '' } })(),
    onUpdate: ({ editor }) => save({ content: JSON.stringify(editor.getJSON()) }),
    editorProps: { attributes: { class: 'nno-pm' } },
  })
  useEffect(() => { if (focus && ed) ed.commands.focus('end') }, [focus, ed])

  const words = ed ? ed.getText().trim().split(/\s+/).filter(Boolean).length : 0
  const tags = note.tags ?? []
  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-')
    if (!t || tags.includes(t)) { setTagIn(''); return }
    upd.mutate({ id: note.id, tags: [...tags, t] }); setTagIn('')
  }
  const files = async (list: File[]) => {
    const imgs = list.filter(f => f.type.startsWith('image/'))
    if (imgs.length) upload.mutate({ noteId: note.id, files: imgs })
  }
  const removeImg = async (id: number) => { await api.delete(`/api/notes/images/${id}`); qc.invalidateQueries({ queryKey: ['notes'] }) }
  const folder = folders.find(f => f.id === note.categoryId)

  return (
    <div className={`nno-ed ${drag ? 'drag' : ''}`}
      onPaste={e => { const fs = [...e.clipboardData.files]; if (fs.some(f => f.type.startsWith('image/'))) { e.preventDefault(); files(fs) } }}
      onDragOver={e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) { e.preventDefault(); setDrag(true) } }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); setDrag(false); files([...e.dataTransfer.files]) } }}>
      <div className="nno-ed-top">
        <span className="nno-lab">Folder</span>
        <select className="nno-fsel" value={note.categoryId ?? ''} onChange={e => upd.mutate({ id: note.id, categoryId: e.target.value ? Number(e.target.value) : null })} aria-label="Folder">
          <option value="">No folder</option>{folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <button className={`nno-pin ${note.pinned ? 'on' : ''}`} onClick={() => upd.mutate({ id: note.id, pinned: note.pinned ? 0 : 1 })} aria-pressed={!!note.pinned} title="Pinned notes stay at the top of the list">{note.pinned ? 'Pinned to top' : 'Pin to top'}</button>
        <span className="nr-grow" />
        <div className="nno-menu">
          <button className="nx-more" onClick={() => { setMenu(m => !m); setConfirm(false) }} aria-expanded={menu} aria-label="Note actions">⋯</button>
          {menu && (
            <div className="pop" role="menu" onMouseLeave={() => setMenu(false)}>
              <button role="menuitem" onClick={async () => { await copyText(asText({ ...note, title })); setCopied(true); setMenu(false); setTimeout(() => setCopied(false), 1500) }}>Copy as text</button>
              <button role="menuitem" onClick={() => { create.mutate({ title: `${title || 'Untitled'} (Copy)`, content: note.content, tags, pinned: 0, categoryId: note.categoryId }); setMenu(false) }}>Duplicate</button>
              {confirm
                ? <button role="menuitem" className="bad" onClick={() => { if (timer.current) clearTimeout(timer.current); pending.current = {}; del.mutate(note.id, { onSuccess: onGone }) }}>Delete: sure?</button>
                : <button role="menuitem" className="bad" onClick={() => setConfirm(true)}>Delete</button>}
            </div>
          )}
        </div>
      </div>
      <input className="nno-ti" value={title} onChange={e => { setTitle(e.target.value); save({ title: e.target.value }) }} placeholder="Untitled" aria-label="Title" />
      <p className="nno-meta">{folder && <><i className="nx-dot" style={{ color: folder.color ?? undefined }} />{folder.name} · </>}Created {longDate(note.createdAt)}</p>
      <Toolbar ed={ed} />
      <div className="nno-body"><EditorContent editor={ed} /></div>
      {(note.images?.length ?? 0) > 0 && (
        <div className="nno-imgs">
          {note.images!.map(i => (
            <figure key={i.id}>
              <a href={i.filePath} target="_blank" rel="noreferrer"><img src={i.filePath} alt={i.originalName ?? 'Image'} /></a>
              <button onClick={() => removeImg(i.id)} aria-label={`Remove ${i.originalName ?? 'image'}`}>×</button>
            </figure>
          ))}
        </div>
      )}
      <div className="nno-foot">
        <div className="tags">
          {tags.map(t => (
            <span key={t} className="tag"><button onClick={() => onTag(t)} title={`Show notes tagged ${t}`}>#{t}</button><button className="x" onClick={() => upd.mutate({ id: note.id, tags: tags.filter(x => x !== t) })} aria-label={`Remove tag ${t}`}>×</button></span>
          ))}
          <input value={tagIn} onChange={e => setTagIn(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagIn) } }} onBlur={() => tagIn && addTag(tagIn)} placeholder="+ Add tag" aria-label="Add a tag" />
          <label className="nno-up">{upload.isPending ? 'Uploading…' : '+ Add image'}<input type="file" accept="image/*" multiple onChange={e => { files([...(e.target.files ?? [])]); e.target.value = '' }} /></label>
        </div>
        <span className="st num" title="Images can also be pasted or dropped anywhere in the note">{copied ? 'Copied' : <>{words} word{words === 1 ? '' : 's'}, {status === 'saving' ? 'saving…' : `saved ${ago(note.updatedAt)}`}</>}</span>
      </div>
    </div>
  )
}
