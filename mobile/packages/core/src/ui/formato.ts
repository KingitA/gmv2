const AR = "America/Argentina/Buenos_Aires"

/** "18/09 14:30" en hora Argentina */
export function fechaHoraCorta(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  return new Intl.DateTimeFormat("es-AR", { timeZone: AR, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(d)
    .replace(",", "")
}

export function moneda(n: number | null | undefined): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }).format(Number(n) || 0)
}

/** "hace 3 min" / "hace 2 h" / "hace 3 días" */
export function hace(iso: string | null | undefined, ahora = Date.now()): string {
  if (!iso) return "nunca"
  const s = Math.max(0, Math.round((ahora - Date.parse(iso)) / 1000))
  if (s < 60) return "recién"
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} días`
}
