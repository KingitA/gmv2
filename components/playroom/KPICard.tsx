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

const accentClasses: Record<string, string> = {
  default: 'bg-transparent',
  warning: 'bg-ambar-500',
  danger: 'bg-error-500',
  success: 'bg-exito-500',
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
    <div className="relative rounded-2xl p-5 overflow-hidden bg-white border border-neutro-200 shadow-sm">
      {/* Acento de variante */}
      <div className={`absolute left-0 top-0 h-full w-1 pointer-events-none ${accentClasses[variant]}`} />

      <div className="relative">
        <div className="flex items-start justify-between gap-2 mb-3">
          <p className="text-xs font-semibold text-neutro-500">
            {label}
          </p>
          {icon && <span className="text-neutro-400">{icon}</span>}
        </div>

        {loading ? (
          <div className="h-8 w-28 rounded-lg animate-pulse bg-neutro-100" />
        ) : (
          <p className="text-2xl font-bold text-azul-900 leading-none">{value}</p>
        )}

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {subLabel && (
            <p className="text-xs text-neutro-500">{subLabel}</p>
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
