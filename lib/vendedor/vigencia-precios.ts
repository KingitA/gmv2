// Vigencia de los precios de un pedido tomado en la app Vendedor — PURO, lo usan el
// servidor (lib/mobile/outbox/vendedor.ts) y la app (cartel + `precios_al`).
//
// Regla del dueño (21/09/2026, MOBILE.md §5 y §18):
//  - El pedido se factura a los precios que el vendedor TENÍA A LA VISTA: los vigentes a
//    su última sincronización de precios (`precios_al`).
//  - TOPE: si al tomar el pedido hacía MÁS DE 24 HS que el equipo no actualizaba los
//    precios, esa garantía se pierde: el precio lo pone el sistema cuando INGRESA el
//    pedido (precios vigentes al sincronizar). La app se lo avisa al vendedor con un
//    cartel fijo mientras dure esa situación.

export const TOPE_PRECIOS_HORAS = 24
export const TOPE_PRECIOS_MS = TOPE_PRECIOS_HORAS * 3_600_000

export const CARTEL_PRECIOS_VENCIDOS =
  "HACE MAS DE 24HS NO SE ACTUALIZAN DATOS, LA EMPRESA NO SE RESPONSABILIZA POR DIFERENCIA DE PRECIOS"

/**
 * ¿Los precios del equipo estaban vencidos en `momento`? `preciosAl` = hora del servidor
 * de la última sincronización de precios (null = nunca se descargaron).
 */
export function preciosVencidos(preciosAl: string | null | undefined, momento: number | string | Date): boolean {
  const al = preciosAl ? Date.parse(preciosAl) : NaN
  if (!Number.isFinite(al)) return true
  const t = momento instanceof Date ? momento.getTime() : typeof momento === "string" ? Date.parse(momento) : momento
  return t - al > TOPE_PRECIOS_MS
}

export interface VigenciaPedido {
  /** ISO: momento al que el servidor reconstruye los insumos de precio */
  vigenciaAt: string
  /**
   * true = se honra el precio que vio el vendedor (una diferencia es un bug ⇒ alerta de
   * integridad). false = precios vencidos (> 24 hs): rige el precio del sistema al
   * ingresar el pedido y una diferencia con lo que mostró el equipo es ESPERABLE.
   */
  garantizada: boolean
}

export function vigenciaDelPedido(capturadoAt: string, preciosAl: string | null | undefined, ahora: number = Date.now()): VigenciaPedido {
  const cap = Math.min(Date.parse(capturadoAt), ahora) // nunca el futuro (reloj del equipo corrido)
  if (!preciosAl || !Number.isFinite(Date.parse(preciosAl))) {
    // Equipos/versiones que no informan precios_al: regla original (vigentes a la captura)
    return { vigenciaAt: new Date(cap).toISOString(), garantizada: true }
  }
  if (preciosVencidos(preciosAl, cap)) return { vigenciaAt: new Date(ahora).toISOString(), garantizada: false }
  return { vigenciaAt: new Date(Math.min(cap, Date.parse(preciosAl))).toISOString(), garantizada: true }
}
