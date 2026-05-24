import { cn } from '../../lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  badge?: { text: string; color: string }
  valueColor?: string
  icon?: React.ReactNode
  iconBg?: string
  iconColor?: string
  accent?: string
}

export function StatCard({ label, value, sub, badge, valueColor, icon, iconBg, iconColor, accent }: StatCardProps) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden transition-all duration-200"
      style={{
        background: 'var(--c-bg-card)',
        border: '1px solid var(--c-border)',
        boxShadow: 'var(--c-shadow-card)',
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>
          {label}
        </span>
        {icon && (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: iconBg || 'var(--c-bg-hover)',
              color: iconColor || 'var(--c-text-2)',
              boxShadow: accent ? `0 0 18px ${accent}55` : 'none',
            }}
          >
            {icon}
          </div>
        )}
      </div>

      <div>
        <div className={cn('text-2xl font-bold num tracking-tight leading-none', valueColor || 'text-text-primary')}>
          {value}
        </div>
        {badge && (
          <span
            className="inline-flex items-center mt-2 px-2 py-0.5 rounded-full text-[11px] font-bold num tracking-wide"
            style={{ background: badge.color + '1f', color: badge.color, border: `1px solid ${badge.color}35` }}
          >
            {badge.text}
          </span>
        )}
        {sub && <div className="text-xs font-medium mt-1.5" style={{ color: 'var(--c-text-3)' }}>{sub}</div>}
      </div>

      {/* Bottom accent line */}
      {accent && (
        <div
          className="absolute bottom-0 left-0 right-0 h-px opacity-40"
          style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }}
        />
      )}
    </div>
  )
}
