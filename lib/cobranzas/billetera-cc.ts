/**
 * Cuenta corriente de la billetera (vendedor y chofer): qué tipos de
 * movimiento componen el saldo de rendiciones/ajustes. Módulo PURO — una sola
 * lista para los dos endpoints, para /viajantes no hay lista (suma TODO), y
 * los tests verifican que ambos modelos den lo mismo.
 *
 * Caso FREIJE (05/10/2026): la app mostraba −$674.500 y /viajantes $0. El
 * endpoint del vendedor sumaba solo rendicion_diferencia +
 * rendicion_saldo_declarado y dejaba afuera las compensaciones:
 * 'rendicion_devuelta' (rendición cancelada por oficina — ya estaba en el
 * chofer desde el 28/09) y 'manual' (ajustes del admin desde /viajantes).
 *
 * NO entran acá: 'pago_cliente'/'rendicion' (son el efectivo en calle, que la
 * app modela aparte desde pagos_clientes pendiente_rendicion) ni el par
 * 'pago_rechazado'/'rechazo_revertido' (siguen al estado del pago: al
 * rechazarse, el pago sale de pendiente_rendicion y el efectivo en calle ya
 * baja solo — meter una pata sola del par duplicaría; las dos juntas netean
 * contra un efectivo que ya se movió).
 */

export interface MovimientoCC {
  monto: number
  referencia_tipo: string | null
}

/** Tipos que componen la cuenta corriente de la billetera (deuda/favor). */
export const TIPOS_CC_BILLETERA = [
  "rendicion_diferencia",
  "rendicion_saldo_declarado",
  "rendicion_devuelta",
  "manual",
] as const

/**
 * Saldo de la cuenta corriente en la convención de los MOVIMIENTOS:
 * positivo = retiene/debe, negativo = a favor. (La UI del chofer lo invierte.)
 * @param extras tipos adicionales del circuito propio (chofer: viaje_gasto_rechazado)
 */
export function deudaCuentaCorriente(movimientos: MovimientoCC[], extras: string[] = []): number {
  const tipos = new Set<string>([...TIPOS_CC_BILLETERA, ...extras])
  const total = movimientos
    .filter((m) => m.referencia_tipo != null && tipos.has(m.referencia_tipo))
    .reduce((s, m) => s + Number(m.monto || 0), 0)
  return Math.round(total * 100) / 100
}
