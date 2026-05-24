import { useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  label?: string
}

export function TagInput({ value = [], onChange, placeholder = 'Add tag...', label }: TagInputProps) {
  const [input, setInput] = useState('')

  const add = () => {
    const tag = input.trim().toLowerCase()
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setInput('')
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() }
    if (e.key === 'Backspace' && !input && value.length) onChange(value.slice(0, -1))
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>{label}</label>}
      <div
        className="flex flex-wrap gap-1.5 px-2 py-2 min-h-[40px] rounded-lg transition-all duration-150"
        style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border-mid)' }}
      >
        {value.map(tag => (
          <span
            key={tag}
            className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md font-medium"
            style={{ background: 'rgba(129,140,248,0.15)', color: 'var(--c-accent)', border: '1px solid rgba(129,140,248,0.2)' }}
          >
            {tag}
            <button type="button" onClick={() => onChange(value.filter(t => t !== tag))} className="transition-opacity hover:opacity-60">
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          onBlur={add}
          placeholder={value.length ? '' : placeholder}
          className="flex-1 min-w-20 bg-transparent text-sm outline-none"
          style={{ color: 'var(--c-text-1)' }}
        />
      </div>
    </div>
  )
}
