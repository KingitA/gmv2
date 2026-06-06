/**
 * Reglas de negocio para anulación de comprobantes.
 *
 * Anular = generar el movimiento inverso exacto.
 * El comprobante original nunca se elimina ni modifica en sus montos.
 * Solo se marca con anulado_en y su saldo queda compensado por el inverso.
 *
 * Para AFIP no existe "anular" — existe emitir el comprobante contrario.
 * El original permanece en el Libro IVA bajo la solapa "Comprobantes Anulados".
 */

export const TIPO_INVERSO: Record<string, string> = {
  FA:   'NCA',
  FB:   'NCB',
  NCA:  'NDA',
  NCB:  'NDB',
  NDA:  'NCA',
  NDB:  'NCB',
  PRES: 'REV',
  REV:  'PRES',
}

/**
 * Tipos cuya emisión decrementó stock → al anular hay que incrementarlo.
 * NC/ND/REV no movieron stock, por lo que su inverso tampoco lo toca.
 */
export const ORIGINAL_DECREMENTO_STOCK = new Set(['FA', 'FB', 'PRES'])

/**
 * Tipos que al generarse como inverso crean una entrada en CC (haber o debe).
 * FA/FB/PRES no crean CC ajuste explícito — usan saldo_pendiente directamente.
 */
export const CC_MOVIMIENTO: Record<string, 'haber' | 'debe' | null> = {
  NCA:  'haber',   // crédito para el cliente (reduce deuda)
  NCB:  'haber',
  NDA:  'debe',    // débito para el cliente (aumenta deuda)
  NDB:  'debe',
  REV:  null,      // reversa de presupuesto — sin CC
  PRES: null,      // presupuesto — sin CC
}

export function formatearNumeroComprobante(puntoVenta: string, numero: number): string {
  return `${puntoVenta.padStart(4, '0')}-${numero.toString().padStart(8, '0')}`
}

export function leyendaAnulacion(
  numeroOriginal: string,
  fechaOriginal: string,
): string {
  // fechaOriginal viene como YYYY-MM-DD, mostramos DD/MM/YYYY
  const [y, m, d] = fechaOriginal.split('-')
  return `Anulación. Comprobante asociado: ${numeroOriginal} ${d}/${m}/${y}`
}
