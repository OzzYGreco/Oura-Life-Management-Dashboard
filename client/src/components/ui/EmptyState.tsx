interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-3">
      {icon && (
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-1"
          style={{
            background: 'var(--c-bg-input)',
            border: '1px solid var(--c-border)',
            color: 'var(--c-text-2)',
          }}
        >
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold" style={{ color: 'var(--c-text-2)' }}>{title}</p>
      {description && <p className="text-xs leading-relaxed max-w-xs" style={{ color: 'var(--c-text-3)' }}>{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
