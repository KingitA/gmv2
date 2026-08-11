/**
 * Fórmula ÚNICA del "disponible / a cuenta" de un pago: la plata entregada que
 * todavía no se aplicó a ningún comprobante de débito.
 *
 *   disponible = monto del pago − Σ imputaciones vivas a DÉBITOS
 *
 * Reglas:
 * - Solo cuentan las imputaciones vivas (pendiente | confirmado) — las
 *   anuladas no consumen plata.
 * - Las imputaciones a comprobantes de CRÉDITO (NC/NCA/NCB/NCC/REV) no
 *   consumen el pago: son residuo del "modelo pozo" viejo (la NC hoy se imputa
 *   a los comprobantes, nunca al pago) y se ignoran.
 *
 * La usan la cuenta corriente del cliente (filas "A CUENTA") y la Caja del Día
 * (chip "Imputar"). Si tocás la regla, tocala acá — un solo lugar.
 */

export const TIPOS_CREDITO = ["NC", "NCA", "NCB", "NCC", "REV"] as const

export interface ImputacionDePago {
  monto_imputado: number | string | null
  estado?: string | null
  /** tipo_comprobante del comprobante destino (si se conoce) */
  tipo_comprobante_destino?: string | null
}

export function disponibleDePago(
  monto: number | string | null,
  imputaciones: ImputacionDePago[] | null | undefined,
): number {
  const consumido = (imputaciones || []).reduce((sum, i) => {
    const estado = i.estado ?? "confirmado"
    if (estado === "anulado") return sum
    if (i.tipo_comprobante_destino && TIPOS_CREDITO.includes(i.tipo_comprobante_destino as any)) return sum
    return sum + Math.abs(Number(i.monto_imputado) || 0)
  }, 0)
  return Math.max(0, Math.round((Number(monto || 0) - consumido) * 100) / 100)
}
