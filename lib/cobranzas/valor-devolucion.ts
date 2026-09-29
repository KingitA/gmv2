/**
 * VALOR DE UNA DEVOLUCIÓN EN PROCESO — LA regla, en un solo lugar (29/09).
 *
 * Una devolución vale el PRECIO DE FACTURA de esa mercadería tal como la pagó
 * el cliente (neto + IVA + percepciones si el documento futuro es fiscal),
 * MENOS el 10% si la factura original fue cobrada contado con 10%.
 *
 * Ese número es a la vez:
 *  - lo que se descuenta en el cobro (pantallas y APIs de vendedor/chofer), y
 *  - el importe por el que sale la NC/REV al confirmarse la devolución en
 *    depósito (la bonificación del 10% se aplica POR RENGLÓN, con el IVA
 *    discriminado sobre el neto ya bonificado).
 * Cobro y NC coinciden al centavo porque los dos llaman a esta función.
 *
 * Casos de referencia (dueño, 28/09):
 *  (a) factura $500.000 contado → cobra $450.000; devolución de $10.000 en
 *      factura vale $9.000 → a cobrar $441.000 (no $440.000).
 *  (b) pedido $260.930,88 contado, devolución $10.491,36:
 *      correcto = (260.930,88 − 10.491,36) × 0,9 = $225.395,57
 *      (equivale a 260.930,88×0,9 − 10.491,36×0,9 — el 10% también baja la
 *      devolución; el sistema hacía 260.930,88×0,9 − 10.491,36 = 224.346,43).
 *
 * La plata a cuenta NUNCA lleva 10% (eso ya lo maneja el circuito de créditos).
 */

const r2 = (n: number) => Math.round(n * 100) / 100

export const DTO_CONTADO = 0.10

export interface ValorDevolucionInput {
  /** Renglones devueltos con su subtotal NETO de factura (cantidad × precio original) */
  renglones: Array<{ subtotal: number }>
  /** La factura original fue cobrada contado con el 10% (bonificación viva) */
  aplica10: boolean
  /** El documento futuro es fiscal (NCA/NCB): lleva IVA 21% discriminado */
  conIva: boolean
  /** Percepciones sobre el neto bonificado (solo fiscal); el server inyecta
   *  calcularPercepciones — el motor no conoce la condición del cliente. */
  percepcionesDe?: (neto: number) => number
}

export interface ValorDevolucionResult {
  /** Neto por renglón YA bonificado (para el detalle de la NC) */
  netoPorRenglon: number[]
  neto: number
  iva: number
  percepciones: number
  /** El número de la regla: lo que se descuenta en el cobro y el total de la NC */
  total: number
}

export function valorDevolucion({ renglones, aplica10, conIva, percepcionesDe }: ValorDevolucionInput): ValorDevolucionResult {
  const factor = aplica10 ? 1 - DTO_CONTADO : 1
  // Por renglón, redondeado como lo va a escribir la NC en su detalle
  const netoPorRenglon = renglones.map((r) => r2((Number(r.subtotal) || 0) * factor))
  const neto = r2(netoPorRenglon.reduce((s, n) => s + n, 0))
  const iva = conIva ? r2((neto * 21) / 100) : 0
  const percepciones = conIva && percepcionesDe ? r2(percepcionesDe(neto)) : 0
  // Suma en centavos enteros — misma aritmética que la emisión fiscal (ARCA
  // valida ImpTotal == ImpNeto + ImpIva + ImpTrib al centavo)
  const total = (Math.round(neto * 100) + Math.round(iva * 100) + Math.round(percepciones * 100)) / 100
  return { netoPorRenglon, neto, iva, percepciones, total }
}

/** Neto a cobrar de un comprobante contado (10% sobre el total de factura). */
export function netoContado(totalFactura: number): number {
  return r2((Number(totalFactura) || 0) * (1 - DTO_CONTADO))
}
