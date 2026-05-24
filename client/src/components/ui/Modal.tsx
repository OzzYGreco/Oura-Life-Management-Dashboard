import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)' }} onClick={onClose} />
      <div
        className={cn('relative flex flex-col max-h-[90vh] w-full rounded-2xl overflow-hidden', {
          'max-w-sm': size === 'sm', 'max-w-lg': size === 'md', 'max-w-2xl': size === 'lg', 'max-w-4xl': size === 'xl',
        })}
        style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border-mid)', boxShadow: 'var(--c-shadow-modal)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{
            background: 'linear-gradient(180deg, var(--c-bg-hover) 0%, transparent 100%)',
            borderBottom: '1px solid var(--c-border)',
          }}
        >
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--c-text-1)' }}>{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150"
            style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-bg-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-1)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-bg-input)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-3)' }}
          >
            <X size={13} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>,
    document.body
  )
}
