"use client"

import { ORDENES, type OrdenArticulos } from "@/lib/vendedor/orden-articulos"

// Selector compacto de orden para los listados de artículos (pedido, precios).
export function OrdenSelector({
  value,
  onChange,
  className = "",
}: {
  value: OrdenArticulos
  onChange: (o: OrdenArticulos) => void
  className?: string
}) {
  return (
    <label className={`flex items-center gap-1.5 ${className}`}>
      <span className="text-gray-400 text-xs shrink-0">↕</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as OrdenArticulos)}
        className={`rounded-lg border px-2 py-1.5 text-xs font-bold bg-white ${
          value === "default" ? "border-gray-200 text-gray-600" : "border-emerald-500 text-emerald-700"
        }`}
      >
        {ORDENES.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}
