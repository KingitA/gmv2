// Calendario de viajes (03/11/2026): cuentas puras del mes (las prueban los tests).
// Fechas ISO "aaaa-mm-dd" (día argentino); nada de Date local ni toLocaleString.

import { hoyISO, sumarDiasISO } from "@gm/formato"

export const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
export const DIAS_CORTOS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"]

/** "2026-11" del día de hoy (o del ISO dado). */
export const mesDe = (iso: string) => iso.slice(0, 7)

/** Suma meses a "aaaa-mm". */
export function sumarMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number) as [number, number]
  const t = a * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`
}

/** "Noviembre 2026" */
export function nombreMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number]
  return `${MESES[m - 1]} ${a}`
}

/** Día de la semana de un ISO: 0 = lunes … 6 = domingo. */
export function diaSemana(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number) as [number, number, number]
  return (new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7
}

/** Semanas del mes (lunes a domingo); null = casillero vacío fuera del mes. */
export function semanasDelMes(mes: string): Array<Array<string | null>> {
  const primero = `${mes}-01`
  const dias: Array<string | null> = Array(diaSemana(primero)).fill(null)
  for (let d = primero; d.startsWith(mes); d = sumarDiasISO(d, 1)) dias.push(d)
  while (dias.length % 7) dias.push(null)
  const out: Array<Array<string | null>> = []
  for (let i = 0; i < dias.length; i += 7) out.push(dias.slice(i, i + 7))
  return out
}

/** ¿El viaje (fecha..fecha_fin) cae ese día / toca ese mes? */
export const viajeEnDia = (v: { fecha: string; fecha_fin: string }, iso: string) => v.fecha <= iso && v.fecha_fin >= iso
export const viajeEnMes = (v: { fecha: string; fecha_fin: string }, mes: string) => v.fecha.slice(0, 7) <= mes && v.fecha_fin.slice(0, 7) >= mes

/** Meses que se pueden mirar: los últimos 3 (historial) hasta el que viene (calendario). */
export function mesesNavegables(hoy = hoyISO()): { desde: string; hasta: string } {
  const actual = mesDe(hoy)
  return { desde: sumarMeses(actual, -3), hasta: sumarMeses(actual, 1) }
}
