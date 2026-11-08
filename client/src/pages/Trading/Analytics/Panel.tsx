import { Card } from '../../../components/ui/Card'
import { cn } from '../../../lib/utils'
import { useIsNext } from '../../../skins/isNext'

/** A chart or table's frame: a card in the original look, space and a hairline in the redesign. */
export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  const nx = useIsNext()
  return nx ? <div className={cn('tr-panel', className)}>{children}</div> : <Card className={className}>{children}</Card>
}
