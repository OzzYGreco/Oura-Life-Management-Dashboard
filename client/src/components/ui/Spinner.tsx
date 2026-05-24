import { cn } from '../../lib/utils'

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-spin rounded-full', className || 'w-5 h-5')}
      style={{ border: '2px solid var(--c-border)', borderTopColor: 'var(--c-accent)' }}
    />
  )
}

export function PageLoader() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="w-8 h-8" />
        <span className="text-xs font-medium" style={{ color: 'var(--c-text-3)' }}>Loading…</span>
      </div>
    </div>
  )
}
