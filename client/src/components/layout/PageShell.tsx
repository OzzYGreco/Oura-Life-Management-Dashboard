interface PageShellProps {
  title: string
  action?: React.ReactNode      // right-aligned actions
  leftAction?: React.ReactNode  // left-aligned actions, rendered after the title
  children: React.ReactNode
  noPad?: boolean               // skip the default p-6 / overflow-y-auto wrapper (for full-bleed layouts like Notes)
}

export function PageShell({ title, action, leftAction, children, noPad }: PageShellProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{ borderBottom: '1px solid var(--c-border)' }}>
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">{title}</h1>
          {leftAction && <div className="flex items-center">{leftAction}</div>}
        </div>
        {action && <div>{action}</div>}
      </div>
      {noPad
        ? <div className="flex-1 overflow-hidden min-h-0">{children}</div>
        : <div className="flex-1 overflow-y-auto p-6 min-h-0">{children}</div>
      }
    </div>
  )
}
