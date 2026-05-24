import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import {
  useNotes, useCreateNote, useUpdateNote, useDeleteNote,
  useNoteCategories, useCreateCategory, useUpdateCategory, useDeleteCategory,
} from '../../hooks/useNotes'
import { PageShell } from '../../components/layout/PageShell'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageLoader } from '../../components/ui/Spinner'
import { cn } from '../../lib/utils'
import { Pin, Search, Trash2, FileText, Bold, Italic,
         Heading1, Heading2, List, ListOrdered, Quote,
         Code, CheckSquare, Minus, PinOff,
         PanelLeft, PanelLeftClose, SquarePen,
         CheckCircle2, Circle, CheckCheck, Copy, Clipboard,
         Folder, FolderPlus, FolderOpen, Pencil,
         ChevronRight, ChevronDown, X, MoreHorizontal } from 'lucide-react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions/placeholder'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wordCount(editor: any): number {
  if (!editor) return 0
  const text = editor.getText().trim()
  return text ? text.split(/\s+/).filter(Boolean).length : 0
}

/** Normalise a SQLite UTC datetime string so the browser parses it as UTC, not local time */
function toUtc(isoStr: string): string {
  return isoStr.includes('Z') || isoStr.includes('+') ? isoStr : isoStr.replace(' ', 'T') + 'Z'
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(toUtc(isoStr)).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60)  return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  return formatDateTime(isoStr)
}

/** Full date + time + seconds for note headers */
function formatDateTime(isoStr: string): string {
  try {
    const d = new Date(toUtc(isoStr))
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      + ' at '
      + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { return isoStr }
}

function plainPreview(content: string): string {
  try {
    const parsed = JSON.parse(content || '{}')
    return (parsed?.content ?? [])
      .flatMap((b: any) => b.content ?? [])
      .map((t: any) => t.text ?? '')
      .join(' ')
      .slice(0, 120)
  } catch { return '' }
}

/** Recursively extract all text from a Tiptap JSON document, preserving line breaks. */
function extractFullText(node: any): string {
  if (!node) return ''
  // Text leaf
  if (node.type === 'text') return node.text ?? ''
  // Hard break
  if (node.type === 'hardBreak') return '\n'
  const children = (node.content ?? []).map(extractFullText).join('')
  // Block-level nodes get a trailing newline
  const blocks = new Set(['paragraph','heading','blockquote','bulletList','orderedList','taskList','listItem','taskItem','codeBlock','horizontalRule'])
  return blocks.has(node.type) ? children + '\n' : children
}

function noteToPlainText(content: string): string {
  try {
    const doc = JSON.parse(content || '{}')
    return extractFullText(doc).replace(/\n{3,}/g, '\n\n').trim()
  } catch { return '' }
}

// ─── Editor toolbar ───────────────────────────────────────────────────────────

function ToolbarBtn({ active, onClick, title, children }: {
  active?: boolean; onClick: () => void; title: string; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      className={cn('w-7 h-7 flex items-center justify-center rounded transition-colors')}
      style={{
        background: active ? 'rgba(129,140,248,0.2)' : 'transparent',
        color: active ? '#818cf8' : 'rgba(139,139,170,0.8)',
      }}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <div className="w-px h-4 mx-0.5 flex-shrink-0" style={{ background: 'var(--c-bg-input)' }} />
}

function EditorToolbar({ editor }: { editor: any }) {
  if (!editor) return null
  return (
    <div className="flex items-center gap-0.5 px-3 py-2 flex-wrap"
      style={{ borderBottom: '1px solid var(--c-border)' }}>
      <ToolbarBtn active={editor.isActive('bold')}   onClick={() => editor.chain().focus().toggleBold().run()}   title="Bold">   <Bold size={13} /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"> <Italic size={13} /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive('code')}   onClick={() => editor.chain().focus().toggleCode().run()}   title="Inline code"><Code size={13} /></ToolbarBtn>
      <Sep />
      <ToolbarBtn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1"><Heading1 size={14} /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2"><Heading2 size={14} /></ToolbarBtn>
      <Sep />
      <ToolbarBtn active={editor.isActive('bulletList')}  onClick={() => editor.chain().focus().toggleBulletList().run()}  title="Bullet list">  <List size={14} /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered size={14} /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive('taskList')}    onClick={() => editor.chain().focus().toggleTaskList().run()}    title="Task list">    <CheckSquare size={14} /></ToolbarBtn>
      <Sep />
      <ToolbarBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote"><Quote size={14} /></ToolbarBtn>
      <ToolbarBtn active={editor.isActive('codeBlock')}  onClick={() => editor.chain().focus().toggleCodeBlock().run()}  title="Code block"><span className="text-[10px] font-mono font-bold">{'<>'}</span></ToolbarBtn>
      <ToolbarBtn active={false} onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider"><Minus size={14} /></ToolbarBtn>
    </div>
  )
}

// ─── Right-pane editor ────────────────────────────────────────────────────────

function NoteEditor({ note, onSave }: { note: any; onSave: (patch: Record<string, any>) => void }) {
  const [localTitle, setLocalTitle] = useState(note.title)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved')
  const saveTimer                   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleSave = useCallback((patch: Record<string, any>) => {
    setSaveStatus('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { onSave(patch); setSaveStatus('saved') }, 1200)
  }, [onSave])

  useEffect(() => {
    setLocalTitle(note.title)
    setSaveStatus('saved')
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [note.id])

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
    ],
    content: (() => { try { return note.content ? JSON.parse(note.content) : '' } catch { return '' } })(),
    onUpdate: ({ editor }) => scheduleSave({ content: JSON.stringify(editor.getJSON()) }),
    editorProps: { attributes: { class: 'outline-none text-text-primary' } },
  }, [note.id])

  const wc = wordCount(editor)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header: title + pin */}
      <div className="flex items-start gap-2 px-7 pt-6 pb-1">
        <input
          value={localTitle}
          onChange={e => { setLocalTitle(e.target.value); scheduleSave({ title: e.target.value }) }}
          placeholder="Untitled"
          className="flex-1 text-2xl font-bold text-text-primary bg-transparent outline-none placeholder:text-text-muted"
        />
        <button
          onClick={() => { onSave({ pinned: note.pinned ? 0 : 1 }) }}
          title={note.pinned ? 'Unpin' : 'Pin note'}
          className="mt-1.5 p-1.5 rounded-lg transition-colors flex-shrink-0"
          style={{ color: note.pinned ? '#818cf8' : 'rgba(139,139,170,0.35)' }}>
          {note.pinned ? <Pin size={16} /> : <PinOff size={16} />}
        </button>
      </div>
      <p className="px-7 text-[11px] text-text-muted mb-3">{formatDateTime(note.createdAt)}</p>

      {/* Toolbar */}
      <EditorToolbar editor={editor} />

      {/* Editor body */}
      <div className="flex-1 overflow-y-auto px-7 py-5">
        <style>{`
          .ProseMirror { min-height: 50vh; }
          .ProseMirror > * + * { margin-top: 0.5em; }
          .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: rgba(139,139,170,0.35); float: left; height: 0; pointer-events: none; }
          .ProseMirror h1 { font-size: 1.45em; font-weight: 700; margin-top: 1em; color: #eeeef5; }
          .ProseMirror h2 { font-size: 1.18em; font-weight: 600; margin-top: 0.8em; color: #eeeef5; }
          .ProseMirror ul, .ProseMirror ol { padding-left: 1.5em; }
          .ProseMirror li { color: #c5c5d8; }
          .ProseMirror blockquote { border-left: 3px solid rgba(129,140,248,0.45); padding-left: 1em; color: #8b8baa; font-style: italic; margin: 0.6em 0; }
          .ProseMirror code { background: var(--c-bg-input); border-radius: 4px; padding: 0.1em 0.35em; font-family: 'JetBrains Mono', monospace; font-size: 0.84em; color: #a78bfa; }
          .ProseMirror pre { background: var(--c-bg-input); border: 1px solid var(--c-border-mid); border-radius: 8px; padding: 1em; }
          .ProseMirror pre code { background: none; padding: 0; color: #c5c5d8; font-size: 0.88em; }
          .ProseMirror hr { border: none; border-top: 1px solid var(--c-border-mid); margin: 1em 0; }
          .ProseMirror ul[data-type="taskList"] { list-style: none; padding-left: 0; }
          .ProseMirror ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.55em; }
          .ProseMirror ul[data-type="taskList"] li > label { flex-shrink: 0; margin-top: 3px; }
          .ProseMirror ul[data-type="taskList"] li > label input[type="checkbox"] { accent-color: #818cf8; width: 14px; height: 14px; cursor: pointer; }
          .ProseMirror ul[data-type="taskList"] li[data-checked="true"] > div { opacity: 0.45; text-decoration: line-through; }
        `}</style>
        <EditorContent editor={editor} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-7 py-2"
        style={{ borderTop: '1px solid var(--c-border-subtle)' }}>
        <span className="text-[11px] text-text-muted">{wc} {wc === 1 ? 'word' : 'words'}</span>
        <span className="text-[11px]" style={{ color: saveStatus === 'saving' ? '#fbbf24' : 'rgba(139,139,170,0.45)' }}>
          {saveStatus === 'saving' ? 'Saving…' : `Saved · ${timeAgo(note.updatedAt)}`}
        </span>
      </div>
    </div>
  )
}

// ─── Sidebar note item ────────────────────────────────────────────────────────

function NoteItem({ note, active, selectMode, checked, folderColor, folders, onSelect, onDelete, onTogglePin, onToggleCheck, onDuplicate, onCopyToClipboard, onMoveToFolder }: {
  note: any; active: boolean; selectMode: boolean; checked: boolean; folderColor?: string
  folders: any[]
  onSelect: () => void; onDelete: () => void; onTogglePin: () => void; onToggleCheck: () => void
  onDuplicate: () => void; onCopyToClipboard: () => void; onMoveToFolder: (folderId: number | null) => void
}) {
  const preview = plainPreview(note.content || '')
  const handleClick = () => selectMode ? onToggleCheck() : onSelect()

  return (
    <div onClick={handleClick} className="group relative px-3 py-2.5 rounded-lg cursor-pointer transition-all"
      style={{
        background: selectMode
          ? checked ? 'rgba(129,140,248,0.12)' : 'transparent'
          : active  ? 'rgba(129,140,248,0.1)'  : 'transparent',
        border: `1px solid ${
          selectMode ? (checked ? 'rgba(129,140,248,0.28)' : 'var(--c-bg-input)')
                     : (active  ? 'rgba(129,140,248,0.22)' : 'transparent')
        }`,
      }}>
      <div className="flex items-start gap-2 pr-10">
        {/* Checkbox (select mode) or pin indicator (normal mode) */}
        {selectMode ? (
          <div className="flex-shrink-0 mt-[2px]" style={{ color: checked ? '#818cf8' : 'rgba(139,139,170,0.35)' }}>
            {checked ? <CheckCircle2 size={14} /> : <Circle size={14} />}
          </div>
        ) : (
          note.pinned ? <Pin size={10} className="flex-shrink-0 mt-[3px]" style={{ color: '#818cf8' }} /> : null
        )}
        <p className={cn('text-[13px] font-medium leading-tight truncate flex-1', active && !selectMode ? 'text-text-primary' : 'text-text-secondary')}>
          {note.title || 'Untitled'}
        </p>
      </div>
      {preview && <p className="text-[11px] text-text-muted mt-0.5 line-clamp-2 leading-relaxed pl-0">{preview}</p>}
      <div className="flex items-center gap-1.5 mt-1">
        <p className="text-[10px] text-text-muted num">{timeAgo(note.updatedAt)}</p>
        {folderColor && !selectMode && (
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: folderColor }} />
        )}
      </div>

      {/* Action menu — hidden in select mode */}
      {!selectMode && <NoteMenu note={note} folders={folders}
        onTogglePin={onTogglePin} onDelete={onDelete}
        onDuplicate={onDuplicate} onCopyToClipboard={onCopyToClipboard}
        onMoveToFolder={onMoveToFolder} />}
    </div>
  )
}

// ─── Per-note action menu ─────────────────────────────────────────────────────

function MenuItem({ icon, label, onClick, danger = false }: {
  icon: ReactNode; label: string; onClick: () => void; danger?: boolean
}) {
  return (
    <button onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onClick() }}
      className="w-full flex items-center gap-2.5 px-3 py-2 mx-1 text-xs font-medium transition-colors text-left rounded-lg"
      style={{ color: danger ? 'var(--c-loss)' : 'var(--c-text-1)', width: 'calc(100% - 8px)' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = danger ? 'rgba(248,113,113,0.08)' : 'var(--c-bg-hover)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
      <span style={{ color: danger ? 'var(--c-loss)' : 'var(--c-accent)', opacity: danger ? 1 : 0.7 }}>{icon}</span>
      {label}
    </button>
  )
}

function MenuDivider() {
  return <div className="my-1 mx-3" style={{ height: 1, background: 'var(--c-border-subtle)' }} />
}

function NoteMenu({ note, folders, onTogglePin, onDelete, onDuplicate, onCopyToClipboard, onMoveToFolder }: {
  note: any; folders: any[]
  onTogglePin: () => void; onDelete: () => void
  onDuplicate: () => void; onCopyToClipboard: () => void
  onMoveToFolder: (folderId: number | null) => void
}) {
  const [open,        setOpen]        = useState(false)
  const [showFolders, setShowFolders] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false); setShowFolders(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const close = () => { setOpen(false); setShowFolders(false) }
  const run   = (fn: () => void) => { fn(); close() }

  return (
    <div ref={menuRef} className="absolute right-1.5 top-2 z-10">
      {/* Trigger — visible on group hover OR when menu is open */}
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); setShowFolders(false) }}
        className={`p-1 rounded transition-all ${open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        style={{ background: open ? 'rgba(129,140,248,0.18)' : 'transparent', color: open ? 'var(--c-accent)' : 'var(--c-text-3)' }}>
        <MoreHorizontal size={13} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 rounded-2xl overflow-hidden shadow-2xl z-50 py-1"
          style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border-mid)', boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)' }}>

          <MenuItem icon={note.pinned ? <PinOff size={12} /> : <Pin size={12} />}
            label={note.pinned ? 'Unpin' : 'Pin'}
            onClick={() => run(onTogglePin)} />

          <MenuDivider />

          <MenuItem icon={<Clipboard size={12} />} label="Copy to clipboard"
            onClick={() => run(onCopyToClipboard)} />
          <MenuItem icon={<Copy size={12} />} label="Duplicate"
            onClick={() => run(onDuplicate)} />

          <MenuDivider />

          {/* Move to folder — expands inline */}
          <button
            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setShowFolders(v => !v) }}
            className="w-full flex items-center gap-2.5 px-3 py-2 mx-1 text-xs font-medium transition-colors text-left rounded-lg"
            style={{ color: 'var(--c-text-1)', width: 'calc(100% - 8px)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--c-bg-hover)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
            <span style={{ color: 'var(--c-accent)', opacity: 0.7 }}><Folder size={12} /></span>
            Move to folder
            <ChevronRight size={10} className={`ml-auto transition-transform ${showFolders ? 'rotate-90' : ''}`} />
          </button>

          {showFolders && (
            <div className="px-1 pb-1">
              <button
                onMouseDown={e => { e.preventDefault(); e.stopPropagation(); run(() => onMoveToFolder(null)) }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] text-text-muted transition-colors text-left"
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--c-bg-hover)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                <FolderOpen size={11} className="opacity-50" /> No folder
              </button>
              {folders.map((f: any) => (
                <button key={f.id}
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); run(() => onMoveToFolder(f.id)) }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] text-text-secondary transition-colors text-left"
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--c-bg-hover)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: f.color || '#818cf8' }} />
                  {f.name}
                </button>
              ))}
            </div>
          )}

          <MenuDivider />

          <MenuItem icon={<Trash2 size={12} />} label="Delete" onClick={() => run(onDelete)} danger />
        </div>
      )}
    </div>
  )
}

// ─── Notes Page ───────────────────────────────────────────────────────────────

const SIDEBAR_KEY = 'notes-sidebar-open'
const FOLDER_COLORS = ['#818cf8','#34d399','#fbbf24','#f87171','#22d3ee','#a78bfa','#fb923c','#e879f9']

export function NotesPage() {
  const { data: notes = [], isPending } = useNotes()
  const { data: folders = [] }          = useNoteCategories()
  const createNote     = useCreateNote()
  const updateNote     = useUpdateNote()
  const deleteNote     = useDeleteNote()
  const createFolder   = useCreateCategory()
  const updateFolder   = useUpdateCategory()
  const deleteFolder   = useDeleteCategory()

  const [query,          setQuery]          = useState('')
  const [activeId,       setActiveId]       = useState<number | null>(null)
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null) // null = All Notes
  const [sidebarOpen,    setSidebarOpen]    = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) !== 'false' } catch { return true }
  })
  // Select mode
  const [selectMode,    setSelectMode]    = useState(false)
  const [selectedIds,   setSelectedIds]   = useState<Set<number>>(new Set())
  const [confirmDel,    setConfirmDel]    = useState(false)
  const [showMovePicker,setShowMovePicker]= useState(false)
  // Folder state
  const [newFolderName,   setNewFolderName]   = useState('')
  const [newFolderColor,  setNewFolderColor]  = useState(FOLDER_COLORS[0])
  // addingToParent: false = not adding, null = root level, number = subfolder of that ID
  const [addingToParent,  setAddingToParent]  = useState<number | null | false>(false)
  const [editingFolder,   setEditingFolder]   = useState<any>(null)
  const [editFolderName,  setEditFolderName]  = useState('')
  const [collapsedFolders,setCollapsedFolders]= useState<Set<number>>(new Set())
  const [foldersOpen,     setFoldersOpen]     = useState(true)

  const allNotes    = notes as any[]
  const allFolders  = folders as any[]

  // Filter by folder + query
  const visible = allNotes
    .filter(n => {
      if (activeFolderId !== null && n.categoryId !== activeFolderId) return false
      if (!query) return true
      const q = query.toLowerCase()
      return n.title.toLowerCase().includes(q) || plainPreview(n.content || '').toLowerCase().includes(q)
    })
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      return b.updatedAt.localeCompare(a.updatedAt)
    })

  const activeNote = allNotes.find(n => n.id === activeId) ?? null

  useEffect(() => {
    if (!activeId && visible.length > 0) setActiveId(visible[0].id)
  }, [isPending]) // eslint-disable-line

  const toggleSidebar = () => setSidebarOpen(v => {
    const next = !v
    try { localStorage.setItem(SIDEBAR_KEY, String(next)) } catch {}
    return next
  })

  const handleNewNote = async () => {
    const note = await createNote.mutateAsync({
      title: '', content: '', tags: [], pinned: 0,
      ...(activeFolderId !== null ? { categoryId: activeFolderId } : {}),
    })
    setActiveId(note.id)
    if (!sidebarOpen) setSidebarOpen(true)
  }

  const handleSave = useCallback((patch: Record<string, any>) => {
    if (!activeId) return
    updateNote.mutate({ id: activeId, ...patch })
  }, [activeId, updateNote])

  // ── Selection helpers ──────────────────────────────────────────────────────
  const toggleCheck = (id: number) =>
    setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const allChecked = visible.length > 0 && visible.every(n => selectedIds.has(n.id))
  const toggleSelectAll = () =>
    setSelectedIds(allChecked ? new Set() : new Set(visible.map(n => n.id)))

  const exitSelect = () => {
    setSelectMode(false); setSelectedIds(new Set())
    setConfirmDel(false); setShowMovePicker(false)
  }

  const bulkPin = (pinned: 0 | 1) => {
    selectedIds.forEach(id => updateNote.mutate({ id, pinned }))
    exitSelect()
  }

  const bulkDuplicate = async () => {
    const toDuplicate = allNotes.filter(n => selectedIds.has(n.id))
    for (const n of toDuplicate) {
      await createNote.mutateAsync({
        title:      n.title ? `${n.title} (Copy)` : 'Untitled (Copy)',
        content:    n.content,
        tags:       n.tags ?? [],
        pinned:     0,
        categoryId: n.categoryId ?? null,
      })
    }
    exitSelect()
  }

  const bulkCopyToClipboard = async () => {
    const selected = allNotes.filter(n => selectedIds.has(n.id))
    const text = selected.map(n => {
      const title   = n.title || 'Untitled'
      const content = noteToPlainText(n.content || '')
      return content ? `${title}\n\n${content}` : title
    }).join('\n\n---\n\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // fallback for environments where clipboard API is restricted
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    exitSelect()
  }

  const bulkMoveToFolder = (folderId: number | null) => {
    selectedIds.forEach(id => updateNote.mutate({ id, categoryId: folderId }))
    exitSelect()
  }

  const bulkDelete = async () => {
    await Promise.all([...selectedIds].map(id => deleteNote.mutateAsync(id)))
    if (activeId && selectedIds.has(activeId))
      setActiveId(visible.find(n => !selectedIds.has(n.id))?.id ?? null)
    exitSelect()
  }

  // ── Folder tree helpers ───────────────────────────────────────────────────
  const toggleCollapse = (id: number) =>
    setCollapsedFolders(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const handleAddFolder = async (parentId: number | null) => {
    if (!newFolderName.trim()) return
    await createFolder.mutateAsync({ name: newFolderName.trim(), color: newFolderColor, parentId })
    setNewFolderName(''); setNewFolderColor(FOLDER_COLORS[0]); setAddingToParent(false)
  }

  const handleSaveFolder = async () => {
    if (!editingFolder || !editFolderName.trim()) return
    await updateFolder.mutateAsync({ id: editingFolder.id, name: editFolderName.trim(), color: editingFolder.color })
    setEditingFolder(null)
  }

  // Build folder tree (root = parentId is null/undefined)
  type FolderNode = { id: number; name: string; color: string | null; parentId: number | null; children: FolderNode[]; noteCount: number }
  const buildTree = (parentId: number | null): FolderNode[] =>
    allFolders
      .filter((f: any) => (f.parentId ?? null) === parentId)
      .map((f: any) => ({
        ...f,
        parentId: f.parentId ?? null,
        children:  buildTree(f.id),
        noteCount: allNotes.filter(n => n.categoryId === f.id).length,
      }))
  const folderTree = buildTree(null)

  // Inline form used both for new root folders and new subfolders
  const AddFolderForm = ({ parentId }: { parentId: number | null }) => (
    <div className="space-y-1.5 py-1.5">
      <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleAddFolder(parentId); if (e.key === 'Escape') setAddingToParent(false) }}
        placeholder={parentId !== null ? 'Subfolder name…' : 'Folder name…'} autoFocus
        className="w-full bg-bg-secondary border border-bg-border rounded-lg px-2.5 py-1 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue transition-colors" />
      <div className="flex gap-1">
        {FOLDER_COLORS.map(c => (
          <button key={c} type="button" onClick={() => setNewFolderColor(c)}
            className="w-4 h-4 rounded-full transition-transform hover:scale-110 flex-shrink-0"
            style={{ background: c, boxShadow: newFolderColor === c ? `0 0 0 2px #0e0e1a, 0 0 0 3.5px ${c}` : 'none' }} />
        ))}
      </div>
      <div className="flex gap-1.5">
        <button onClick={() => { setAddingToParent(false); setNewFolderName('') }}
          className="flex-1 py-1 rounded-lg text-[10px] font-medium text-text-muted"
          style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)' }}>
          Cancel
        </button>
        <button onClick={() => handleAddFolder(parentId)}
          className="flex-1 py-1 rounded-lg text-[10px] font-bold"
          style={{ background: 'rgba(129,140,248,0.15)', color: '#818cf8', border: '1px solid rgba(129,140,248,0.25)' }}>
          Create
        </button>
      </div>
    </div>
  )

  // Recursive folder row renderer
  const renderFolder = (node: FolderNode, depth: number): React.ReactNode => {
    const isActive     = activeFolderId === node.id
    const isCollapsed  = collapsedFolders.has(node.id)
    const hasChildren  = node.children.length > 0
    const color        = node.color || '#818cf8'
    const isEditing    = editingFolder?.id === node.id
    const isAddingHere = addingToParent === node.id
    const indent       = depth * 14

    return (
      <div key={node.id}>
        {/* Folder row */}
        {isEditing ? (
          <div className="space-y-1 mb-0.5" style={{ paddingLeft: `${indent}px` }}>
            <input value={editFolderName} onChange={e => setEditFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveFolder(); if (e.key === 'Escape') setEditingFolder(null) }}
              autoFocus className="w-full bg-bg-secondary border border-accent-blue/40 rounded-lg px-2.5 py-1 text-xs text-text-primary outline-none" />
            <div className="flex gap-1.5">
              <button onClick={() => setEditingFolder(null)}
                className="flex-1 py-0.5 rounded text-[10px] text-text-muted" style={{ background: 'var(--c-bg-input)' }}>Cancel</button>
              <button onClick={handleSaveFolder}
                className="flex-1 py-0.5 rounded text-[10px] font-bold" style={{ background: 'rgba(129,140,248,0.15)', color: '#818cf8' }}>Save</button>
            </div>
          </div>
        ) : (
          <div className="group flex items-center gap-1.5 pr-1.5 rounded-lg mb-0.5 cursor-pointer transition-colors"
            style={{ paddingLeft: `${indent + 4}px`, background: isActive ? color + '18' : 'transparent' }}
            onClick={() => { setActiveFolderId(node.id); exitSelect() }}>

            {/* Expand/collapse chevron — space reserved even when no children so dots align */}
            <button
              onClick={e => { e.stopPropagation(); if (hasChildren) toggleCollapse(node.id) }}
              className="p-0.5 rounded flex-shrink-0 transition-colors"
              style={{ color: hasChildren ? 'rgba(139,139,170,0.5)' : 'transparent', cursor: hasChildren ? 'pointer' : 'default' }}>
              {hasChildren
                ? (isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />)
                : <ChevronRight size={11} style={{ opacity: 0 }} />}
            </button>

            {/* Colour dot */}
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />

            {/* Name */}
            <span className="flex-1 text-xs font-medium truncate py-1.5"
              style={{ color: isActive ? color : 'rgba(139,139,170,0.7)' }}>
              {node.name}
            </span>

            {/* Count — hidden on hover, replaced by actions */}
            <span className="text-[10px] opacity-50 group-hover:hidden flex-shrink-0">{node.noteCount}</span>

            {/* Hover actions */}
            <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
              <button onClick={e => { e.stopPropagation(); setAddingToParent(node.id); setNewFolderName(''); setNewFolderColor(node.color || FOLDER_COLORS[0]) }}
                className="p-0.5 rounded text-text-muted hover:text-accent-blue transition-colors" title="Add subfolder">
                <FolderPlus size={10} />
              </button>
              <button onClick={e => { e.stopPropagation(); setEditingFolder(node); setEditFolderName(node.name) }}
                className="p-0.5 rounded text-text-muted hover:text-text-primary transition-colors" title="Rename">
                <Pencil size={10} />
              </button>
              <button onClick={e => { e.stopPropagation(); deleteFolder.mutate(node.id); if (activeFolderId === node.id) setActiveFolderId(null) }}
                className="p-0.5 rounded text-text-muted hover:text-pnl-loss transition-colors" title="Delete">
                <Trash2 size={10} />
              </button>
            </div>
          </div>
        )}

        {/* Inline "add subfolder" form */}
        {isAddingHere && (
          <div style={{ paddingLeft: `${indent + 18}px` }}>
            <AddFolderForm parentId={node.id} />
          </div>
        )}

        {/* Children — hidden when collapsed */}
        {!isCollapsed && node.children.map(child => renderFolder(child, depth + 1))}
      </div>
    )
  }

  if (isPending) return <PageShell title="Notes"><PageLoader /></PageShell>

  const leftActions = (
    <div className="flex items-center gap-0.5">
      <button onClick={toggleSidebar} title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        className="p-1.5 rounded-lg transition-colors"
        style={{ color: sidebarOpen ? '#818cf8' : 'rgba(139,139,170,0.5)' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--c-bg-hover)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
        {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
      </button>
      <button onClick={handleNewNote} title="New note"
        className="p-1.5 rounded-lg transition-colors"
        style={{ color: 'rgba(139,139,170,0.5)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--c-bg-hover)'; (e.currentTarget as HTMLElement).style.color = '#eeeef5' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgba(139,139,170,0.5)' }}>
        <SquarePen size={16} />
      </button>
    </div>
  )

  const btnCls = 'flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-[11px] font-semibold transition-all disabled:opacity-30'

  return (
    <PageShell title="Notes" noPad leftAction={leftActions}>
      <div className="flex h-full overflow-hidden">

        {/* ── Sidebar ── */}
        <div className="flex flex-col flex-shrink-0 overflow-hidden"
          style={{
            width: sidebarOpen ? '272px' : '0px',
            transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
            borderRight: sidebarOpen ? '1px solid var(--c-border)' : 'none',
            background: 'var(--c-bg-input)',
          }}>
          <div className="flex flex-col w-[272px] h-full min-h-0">

            {/* Search */}
            <div className="flex-shrink-0 p-3" style={{ borderBottom: '1px solid var(--c-border-subtle)' }}>
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…"
                  className="w-full bg-transparent border border-bg-border rounded-lg pl-7 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue/50 transition-colors" />
              </div>
            </div>

            {/* ── Folders section ── */}
            <div className="flex-shrink-0 px-2 pt-2 pb-1" style={{ borderBottom: '1px solid var(--c-border-subtle)' }}>

              {/* Section header with collapse toggle */}
              <div className="flex items-center gap-1 px-1 mb-1">
                <button onClick={() => setFoldersOpen(v => !v)}
                  className="flex items-center gap-1 flex-1 text-left transition-colors group"
                  style={{ color: 'rgba(139,139,170,0.55)' }}>
                  {foldersOpen
                    ? <ChevronDown size={11} className="flex-shrink-0" />
                    : <ChevronRight size={11} className="flex-shrink-0" />}
                  <span className="text-[10px] font-bold uppercase tracking-widest">Folders</span>
                </button>
                <button onClick={() => { setAddingToParent(null); setNewFolderName(''); setNewFolderColor(FOLDER_COLORS[0]) }}
                  className="p-0.5 rounded transition-colors text-text-muted hover:text-accent-blue flex-shrink-0"
                  title="New root folder">
                  <FolderPlus size={12} />
                </button>
              </div>

              {foldersOpen && (
                <>
                  {/* Root-level new folder form */}
                  {addingToParent === null && (
                    <div className="px-1 mb-1">
                      <AddFolderForm parentId={null} />
                    </div>
                  )}

                  {/* All Notes row */}
                  <button onClick={() => { setActiveFolderId(null); exitSelect() }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors text-left mb-0.5"
                    style={{ background: activeFolderId === null ? 'rgba(129,140,248,0.12)' : 'transparent', color: activeFolderId === null ? '#818cf8' : 'rgba(139,139,170,0.7)' }}>
                    <ChevronRight size={11} style={{ opacity: 0, flexShrink: 0 }} />
                    <FolderOpen size={12} className="flex-shrink-0" />
                    <span className="flex-1 font-medium">All Notes</span>
                    <span className="text-[10px] opacity-60">{allNotes.length}</span>
                  </button>

                  {/* Recursive folder tree */}
                  {folderTree.map(node => renderFolder(node, 0))}
                </>
              )}
            </div>

            {/* Count + select toggle */}
            <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                {selectMode ? `${selectedIds.size} selected` : `${visible.length} ${visible.length === 1 ? 'note' : 'notes'}`}
              </span>
              {visible.length > 0 && (
                <button onClick={() => selectMode ? exitSelect() : setSelectMode(true)}
                  className="text-[10px] font-semibold transition-colors"
                  style={{ color: selectMode ? '#818cf8' : 'rgba(139,139,170,0.55)' }}>
                  {selectMode ? 'Done' : 'Select'}
                </button>
              )}
            </div>

            {/* Select-all row */}
            {selectMode && (
              <div className="flex-shrink-0 px-3 pb-1.5">
                <button onClick={toggleSelectAll}
                  className="flex items-center gap-1.5 text-[11px] font-medium transition-colors"
                  style={{ color: allChecked ? '#818cf8' : 'rgba(139,139,170,0.6)' }}>
                  {allChecked ? <CheckCheck size={13} /> : <Circle size={13} />}
                  {allChecked ? 'Deselect all' : 'Select all'}
                </button>
              </div>
            )}

            {/* Note list */}
            <div className="flex-1 overflow-y-auto min-h-0 px-2 space-y-0.5" style={{ paddingBottom: selectMode ? '0' : '12px' }}>
              {visible.length === 0 ? (
                <p className="text-xs text-text-muted text-center py-8 px-3">
                  {query ? 'No notes match your search' : 'Press the compose button to create a note'}
                </p>
              ) : visible.map(n => {
                const folder = allFolders.find((f: any) => f.id === n.categoryId)
                return (
                  <NoteItem key={n.id} note={n}
                    active={n.id === activeId}
                    selectMode={selectMode}
                    checked={selectedIds.has(n.id)}
                    folderColor={folder?.color}
                    folders={allFolders}
                    onSelect={() => setActiveId(n.id)}
                    onToggleCheck={() => toggleCheck(n.id)}
                    onDelete={() => { deleteNote.mutate(n.id); if (activeId === n.id) setActiveId(visible.find(x => x.id !== n.id)?.id ?? null) }}
                    onTogglePin={() => updateNote.mutate({ id: n.id, pinned: n.pinned ? 0 : 1 })}
                    onDuplicate={() => createNote.mutateAsync({ title: n.title ? `${n.title} (Copy)` : 'Untitled (Copy)', content: n.content, tags: n.tags ?? [], pinned: 0, categoryId: n.categoryId ?? null })}
                    onCopyToClipboard={async () => {
                      const text = n.title ? `${n.title}\n\n${noteToPlainText(n.content || '')}` : noteToPlainText(n.content || '')
                      try { await navigator.clipboard.writeText(text.trim()) } catch { /* silent */ }
                    }}
                    onMoveToFolder={folderId => updateNote.mutate({ id: n.id, categoryId: folderId })}
                  />
                )
              })}
            </div>

            {/* Bulk action bar */}
            {selectMode && (
              <div className="flex-shrink-0 p-2 space-y-1.5"
                style={{ borderTop: '1px solid var(--c-border)', background: 'var(--c-bg-input)' }}>

                {/* Confirm delete */}
                {confirmDel ? (
                  <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                    <p className="text-[11px] text-pnl-loss font-semibold text-center">
                      Delete {selectedIds.size} {selectedIds.size === 1 ? 'note' : 'notes'}? Cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirmDel(false)}
                        className="flex-1 py-1.5 rounded-lg text-xs font-medium text-text-muted"
                        style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)' }}>
                        Cancel
                      </button>
                      <button onClick={bulkDelete}
                        className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white hover:opacity-90"
                        style={{ background: '#ef4444' }}>
                        Delete
                      </button>
                    </div>
                  </div>

                /* Move to folder picker */
                ) : showMovePicker ? (
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--c-border-mid)' }}>
                    <div className="px-3 py-2 flex items-center justify-between" style={{ background: 'var(--c-bg-input)' }}>
                      <span className="text-[11px] font-semibold text-text-secondary">Move to folder</span>
                      <button onClick={() => setShowMovePicker(false)} className="text-text-muted hover:text-text-primary"><X size={12} /></button>
                    </div>
                    {/* Remove from folder */}
                    <button onClick={() => bulkMoveToFolder(null)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-muted hover:bg-bg-hover transition-colors text-left"
                      style={{ borderBottom: '1px solid var(--c-border-subtle)' }}>
                      <FolderOpen size={12} className="opacity-50" /> No folder
                    </button>
                    {allFolders.map((f: any) => (
                      <button key={f.id} onClick={() => bulkMoveToFolder(f.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left hover:bg-bg-hover"
                        style={{ borderBottom: '1px solid var(--c-border-subtle)' }}>
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: f.color || '#818cf8' }} />
                        <span className="text-text-secondary">{f.name}</span>
                      </button>
                    ))}
                  </div>

                /* Default action buttons — two rows */
                ) : (
                  <div className="space-y-1.5">
                    {/* Row 1: Pin · Unpin · Copy to clipboard */}
                    <div className="flex gap-1.5">
                      <button disabled={selectedIds.size === 0} onClick={() => bulkPin(1)}
                        className={btnCls} style={{ background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.2)', color: '#818cf8' }}>
                        <Pin size={11} /> Pin
                      </button>
                      <button disabled={selectedIds.size === 0} onClick={() => bulkPin(0)}
                        className={btnCls} style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-3)' }}>
                        <PinOff size={11} /> Unpin
                      </button>
                      <button disabled={selectedIds.size === 0} onClick={bulkCopyToClipboard}
                        className={btnCls} style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.18)', color: '#22d3ee' }}>
                        <Clipboard size={11} /> Copy
                      </button>
                    </div>
                    {/* Row 2: Duplicate · Move · Delete */}
                    <div className="flex gap-1.5">
                      <button disabled={selectedIds.size === 0} onClick={bulkDuplicate}
                        className={btnCls} style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.18)', color: '#34d399' }}>
                        <Copy size={11} /> Duplicate
                      </button>
                      <button disabled={selectedIds.size === 0} onClick={() => setShowMovePicker(true)}
                        className={btnCls} style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.18)', color: '#a78bfa' }}>
                        <Folder size={11} /> Move
                      </button>
                      <button disabled={selectedIds.size === 0} onClick={() => setConfirmDel(true)}
                        className={btnCls} style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)', color: '#f87171' }}>
                        <Trash2 size={11} /> Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Editor pane ── */}
        <div className="flex-1 overflow-hidden">
          {activeNote
            ? <NoteEditor key={activeNote.id} note={activeNote} onSave={handleSave} />
            : (
              <div className="h-full flex items-center justify-center">
                <EmptyState icon={<FileText size={28} />} title="No note selected"
                  description="Select a note from the sidebar or press the compose button to start a new one" />
              </div>
            )
          }
        </div>
      </div>
    </PageShell>
  )
}
