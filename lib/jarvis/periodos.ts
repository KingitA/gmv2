/**
 * Períodos con nombre ("mes_actual", "ultimos_30_dias"…). Las tarjetas fijadas
 * guardan el NOMBRE del período, no las fechas: así "ventas de este mes" sigue
 * siendo "este mes" cuando se abre Playroom la semana que viene.
 */
import { fecha, hoyISO, sumarDiasISO } from "@/lib/formato"

export const PERIODOS = [
  "hoy", "ayer", "semana_actual", "mes_actual", "mes_anterior",
  "ultimos_7_dias", "ultimos_30_dias", "ultimos_90_dias", "anio_actual",
] as const
export type PeriodoNombre = (typeof PERIODOS)[number]

export interface Rango {
  desde: string
  hasta: string
  etiqueta: string
  /** mismo largo, inmediatamente antes (para comparar) */
  prevDesde: string
  prevHasta: string
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]

function diasEntre(a: string, b: string) {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86_400_000)
}
function finDeMes(anio: number, mes: number) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate()
}
const dosDig = (n: number) => String(n).padStart(2, "0")

function anterior(desde: string, hasta: string) {
  const largo = diasEntre(desde, hasta)
  const prevHasta = sumarDiasISO(desde, -1)
  return { prevDesde: sumarDiasISO(prevHasta, -largo), prevHasta }
}

export function resolverPeriodo(
  p: { periodo?: string | null; desde?: string | null; hasta?: string | null },
  porDefecto: PeriodoNombre = "mes_actual",
  hoy = hoyISO(),
): Rango {
  const valida = (f: string | null | undefined): f is string =>
    !!f && /^\d{4}-\d{2}-\d{2}$/.test(f) && new Date(f + "T12:00:00Z").toISOString().slice(0, 10) === f // formato-ok: valida que la fecha exista (no es "hoy")
  if (valida(p.desde)) {
    let desde = p.desde
    let hasta = valida(p.hasta) ? p.hasta : hoy
    if (desde > hasta) [desde, hasta] = [hasta, desde]
    return { desde, hasta, etiqueta: `del ${fecha(desde)} al ${fecha(hasta)}`, ...anterior(desde, hasta) }
  }
  const nombre = (PERIODOS as readonly string[]).includes(p.periodo ?? "") ? (p.periodo as PeriodoNombre) : porDefecto
  const [a, m, d] = hoy.split("-").map(Number)
  switch (nombre) {
    case "hoy":
      return { desde: hoy, hasta: hoy, etiqueta: "hoy", ...anterior(hoy, hoy) }
    case "ayer": {
      const ay = sumarDiasISO(hoy, -1)
      return { desde: ay, hasta: ay, etiqueta: "ayer", ...anterior(ay, ay) }
    }
    case "semana_actual": {
      const dow = (new Date(hoy + "T12:00:00Z").getUTCDay() + 6) % 7 // lunes = 0
      const desde = sumarDiasISO(hoy, -dow)
      return { desde, hasta: hoy, etiqueta: "esta semana", prevDesde: sumarDiasISO(desde, -7), prevHasta: sumarDiasISO(hoy, -7) }
    }
    case "mes_anterior": {
      const pa = m === 1 ? a - 1 : a, pm = m === 1 ? 12 : m - 1
      const desde = `${pa}-${dosDig(pm)}-01`, hasta = `${pa}-${dosDig(pm)}-${dosDig(finDeMes(pa, pm))}`
      const qa = pm === 1 ? pa - 1 : pa, qm = pm === 1 ? 12 : pm - 1
      return { desde, hasta, etiqueta: MESES[pm - 1], prevDesde: `${qa}-${dosDig(qm)}-01`, prevHasta: `${qa}-${dosDig(qm)}-${dosDig(finDeMes(qa, qm))}` }
    }
    case "ultimos_7_dias":
    case "ultimos_30_dias":
    case "ultimos_90_dias": {
      const n = nombre === "ultimos_7_dias" ? 7 : nombre === "ultimos_30_dias" ? 30 : 90
      const desde = sumarDiasISO(hoy, -(n - 1))
      return { desde, hasta: hoy, etiqueta: `últimos ${n} días`, ...anterior(desde, hoy) }
    }
    case "anio_actual": {
      const desde = `${a}-01-01`
      return { desde, hasta: hoy, etiqueta: `${a} hasta hoy`, prevDesde: `${a - 1}-01-01`, prevHasta: `${a - 1}-${dosDig(m)}-${dosDig(Math.min(d, finDeMes(a - 1, m)))}` }
    }
    case "mes_actual":
    default: {
      // mismo tramo del mes anterior (del 1 al mismo día), como el tablero
      const pa = m === 1 ? a - 1 : a, pm = m === 1 ? 12 : m - 1
      return {
        desde: `${a}-${dosDig(m)}-01`, hasta: hoy, etiqueta: `${MESES[m - 1]} (hasta hoy)`,
        prevDesde: `${pa}-${dosDig(pm)}-01`, prevHasta: `${pa}-${dosDig(pm)}-${dosDig(Math.min(d, finDeMes(pa, pm)))}`,
      }
    }
  }
}

