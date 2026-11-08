import { cn } from '../../../lib/utils'

/** A chart or table's frame: space and a hairline. */
export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('tr-panel', className)}>{children}</div>
}
