/**
 * Marca [pago:<id>] en las observaciones de una NC/REV de bonificación 10%:
 * identifica QUÉ pago la generó, para que cobranza_anular revierta SOLO la
 * bonificación de ese pago (bug Gioventu 01/10: anular un cobro revertía
 * también la REV de otro pago confirmado imputada al mismo comprobante).
 *
 * El formato es CONTRATO con el SQL de cobranza_anular v7:
 *   obs LIKE '%[pago:' || p_pago_id || ']%'
 * Si cambia acá, cambia allá.
 */

export function marcaPagoBonif(pagoId: string): string {
  return `[pago:${pagoId}]`
}

export function esBonifDelPago(obs: string | null | undefined, pagoId: string): boolean {
  return (obs || "").includes(marcaPagoBonif(pagoId))
}

export function tieneMarcaPago(obs: string | null | undefined): boolean {
  return /\[pago:[0-9a-fA-F-]{8,}\]/.test(obs || "")
}

/**
 * ¿La anulación del pago `pagoId` debe revertir esta bonificación?
 * — Con marca: solo si la marca es de ESTE pago.
 * — Legado sin marca: solo si ningún OTRO pago confirmado participó del
 *   comprobante (si hay otro, la NC puede ser suya: no se toca, se avisa).
 * Espejo exacto del predicado SQL de cobranza_anular v7.
 */
export function debeRevertirBonificacion(opts: {
  obs: string | null | undefined
  pagoId: string
  hayOtroPagoConfirmado: boolean
}): boolean {
  if (tieneMarcaPago(opts.obs)) return esBonifDelPago(opts.obs, opts.pagoId)
  return !opts.hayOtroPagoConfirmado
}
