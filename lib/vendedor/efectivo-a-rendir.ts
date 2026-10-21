/**
 * Efectivo que el vendedor tiene que llevar a la oficina: lo cobrado en efectivo
 * menos lo que ya retiró para sí (rendicion_crear v4 descuenta TODOS los retiros
 * sin rendir). Proponer solo lo cobrado hacía que, rindiendo sin tocar el número,
 * el retiro quedara compensado "a su favor" (auditoría 21/10).
 * Misma fórmula que mobile/apps/vendedor/src/datos/billetera.ts.
 */
export function efectivoARendir(efectivoCobrado: number, retirosSinRendir: number): number {
  return Math.max(0, Math.round((efectivoCobrado - Math.max(0, retirosSinRendir || 0)) * 100) / 100)
}
