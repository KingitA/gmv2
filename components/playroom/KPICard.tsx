import ComparativoBadge from './ComparativoBadge'

interface KPICardProps {
  label: string
  value: string | number
  subLabel?: string
  badge?: { pct: number; label?: string; invertColor?: boolean }
  variant?: 'default' | 'warning' | 'danger' | 'success'
  icon?: React.ReactNode
  loading?: boolean
}

const glowColors: Record<string, string> = {
  default: '#7c3aed',
  warning: '#f59e0b',
  danger: '#ef4444',
  success: '#10b981',
}

const borderColors: Record<string, string> = {
  default: 'rgba(124,58,237,0.2)',
  warning: 'rgba(245,158,11,0.2)',
  danger: 'rgba(239,68,68,0.2)',
  success: 'rgba(16,185,129,0.2)',
}

export default function KPICard({
  label,
  value,
  subLabel,
  badge,
  variant = 'default',
  icon,
  loading = false,
}: KPICardProps) {
  return (
    <div
      className="relative rounded-2xl p-5 overflow-hidden"
      style={{
        background: 'rgba(17, 24, 39, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${borderColors[variant]}`,
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      {/* Glow accent */}
      <div
        className="absolute -top-8 -right-8 w-28 h-28 rounded-full pointer-events-none"
        style={{
          background: glowColors[variant],
          filter: 'blur(24px)',
          opacity: 0.08,
        }}
      />

      <div className="relative">
        <div className="flex items-start justify-between gap-2 mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {label}
          </p>
          {icon && <span style={{ color: 'rgba(255,255,255,0.25)' }}>{icon}</span>}
        </div>

        {loading ? (
          <div className="h-8 w-28 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.07)' }} />
        ) : (
          <p className="text-2xl font-bold text-white leading-none">{value}</p>
        )}

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {subLabel && (
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{subLabel}</p>
          )}
          {badge && (
            <ComparativoBadge
              pct={badge.pct}
              label={badge.label}
              size="sm"
              invertColor={badge.invertColor}
            />
          )}
        </div>
      </div>
    </div>
  )
}
