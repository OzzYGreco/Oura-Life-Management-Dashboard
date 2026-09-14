/**
 * A trend line with no chart library behind it. Used at row scale, where
 * Recharts would cost more than the line is worth.
 */
export function Sparkline({
  points, color, height = 36,
}: { points: number[]; color: string; height?: number }) {
  if (points.length < 2) return null
  const W = 100
  const H = height
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const pts = points
    .map((v, i) => `${(i / (points.length - 1)) * W},${H - ((v - min) / range) * (H - 4) - 2}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
      style={{ display: 'block' }} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
    </svg>
  )
}
