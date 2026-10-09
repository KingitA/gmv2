import { fechaCorta, hora, moneda as monedaAR } from "@gm/formato"

/** "18/09 14:30" en hora Argentina (= fechaCorta + hora de @gm/formato). */
export function fechaHoraCorta(iso: string | null | undefined): string {
  const f = fechaCorta(iso)
  return f ? `${f} ${hora(iso)}` : "—"
}

/** "$1.000,32" (= moneda de @gm/formato). */
export function moneda(n: number | null | undefined): string {
  return monedaAR(Number(n) || 0)
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
