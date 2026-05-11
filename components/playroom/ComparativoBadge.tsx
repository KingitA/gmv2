import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface ComparativoBadgeProps {
  pct: number
  label?: string
  size?: 'sm' | 'md'
  invertColor?: boolean
}

export default function ComparativoBadge({
  pct,
  label,
  size = 'md',
  invertColor = false,
}: ComparativoBadgeProps) {
  const isPositive = pct > 0.05
  const isNegative = pct < -0.05

  const goodClass = 'text-emerald-400 bg-emerald-400/10'
  const badClass = 'text-red-400 bg-red-400/10'
  const neutralClass = 'text-white/40 bg-white/5'

  const colorClass = !isPositive && !isNegative
    ? neutralClass
    : isPositive
      ? (invertColor ? badClass : goodClass)
      : (invertColor ? goodClass : badClass)

  const Icon = !isPositive && !isNegative ? Minus : isPositive ? TrendingUp : TrendingDown
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs'
  const iconSize = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-semibold ${colorClass} ${textSize}`}>
      <Icon className={iconSize} />
      {Math.abs(pct).toFixed(1)}%
      {label && <span className="font-normal opacity-70 ml-0.5">{label}</span>}
    </span>
  )
}
