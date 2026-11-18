/**
 * Sugerencia de cheques de cartera para un pago — la MISMA regla en la Nueva OP y en
 * "Pagos de la semana": de mayor a menor, sin pasarse del importe a cubrir.
 * Sin imports: se usa en el navegador y en el servidor.
 */

export interface ChequeCartera {
  id: string
  monto: number | string
  fecha_vencimiento: string
  color?: string | null
  es_echeq?: boolean | null
  banco?: string | null
  numero?: string | null
}

/** Color de la plata de un cheque: e-cheq, negro o blanco. */
export const colorDeCheque = (ch: { es_echeq?: boolean | null; color?: string | null }): "ECHEQ" | "NEGRO" | "BLANCO" =>
  ch.es_echeq ? "ECHEQ" : ch.color === "NEGRO" ? "NEGRO" : "BLANCO"

/** Elige cheques de mayor a menor sin pasarse del objetivo. No modifica la lista recibida. */
export function elegirCheques<T extends { monto: number | string }>(candidatos: T[], objetivo: number): T[] {
  let resto = objetivo + 0.009
  const elegidos: T[] = []
  for (const ch of [...candidatos].sort((a, b) => Number(b.monto) - Number(a.monto))) {
    if (Number(ch.monto) <= resto) { elegidos.push(ch); resto -= Number(ch.monto) }
  }
  return elegidos
}

/**
 * Ventana de fechas de cheques que sirven para un pago, igual que la Nueva OP:
 *   cheques "al día" (plazo 0)  → los ya exigibles: hasta 365 días antes, ninguno después;
 *   cheques a N días            → fecha objetivo (día del pago + N) ± 5 días.
 */
export function ventanaCheques(fechaPago: string, plazoDias: number, sumarDias: (iso: string, d: number) => string): { desde: string; hasta: string; objetivo: string } {
  const plazo = Math.max(0, Math.trunc(Number(plazoDias) || 0))
  const objetivo = plazo > 0 ? sumarDias(fechaPago, plazo) : fechaPago
  return plazo > 0
    ? { desde: sumarDias(objetivo, -5), hasta: sumarDias(objetivo, 5), objetivo }
    : { desde: sumarDias(objetivo, -365), hasta: objetivo, objetivo }
}
