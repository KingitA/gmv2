/**
 * Reglas de estado de un viaje — única fuente de verdad, compartida por API
 * routes y UI (ERP + chofer). Espejo de lib/pedidos/estados.ts.
 *
 * Reparto propio:  programado → despachado → en_curso → en_rendicion → completado
 * Por transporte:  programado → despachado → completado   (sin app ni rendición)
 * Levantamiento:   en_curso ↔ completado                  (app vendedor)
 * cancelado: solo desde programado.
 *
 * - programado: calendario del mes (fecha + zonas). Chofer, vehículo y pedidos
 *   se completan después; los pedidos se asignan en cualquier estado y NO
 *   cambian de estado por asignarse.
 * - despachado: oficina cerró papeles; los pedidos pasan a en_viaje y la hoja
 *   de ruta queda fija (ya no se agregan ni quitan pedidos).
 */

export const ESTADOS_VIAJE = ["programado", "despachado", "en_curso", "en_rendicion", "completado", "cancelado"] as const
export type EstadoViaje = (typeof ESTADOS_VIAJE)[number]

export const ESTADO_VIAJE_LABEL: Record<string, string> = {
  programado: "Programado",
  despachado: "Despachado",
  en_curso: "En Curso",
  en_rendicion: "En Rendición",
  completado: "Completado",
  cancelado: "Cancelado",
}

export const ESTADO_VIAJE_COLOR: Record<string, string> = {
  programado: "bg-yellow-500",
  despachado: "bg-indigo-500",
  en_curso: "bg-blue-500",
  en_rendicion: "bg-orange-500",
  completado: "bg-green-500",
  cancelado: "bg-red-500",
}

export const ESTADOS_PARADA = ["pendiente", "entregado", "entregado_parcial", "no_entregado", "solo_cobro"] as const
export type EstadoParada = (typeof ESTADOS_PARADA)[number]

/** Pedidos que NO pueden subirse a un viaje (finales o ya en la calle). */
const PEDIDO_NO_ASIGNABLE = ["en_viaje", "entregado", "rechazado", "eliminado"]

/** Mientras está programado se arma: datos, choferes, pedidos, paradas. */
export function viajeEditable(estado: string | null | undefined): boolean {
  return estado === "programado"
}

/** Las instrucciones de cobro / candado se pueden ajustar hasta que el chofer finaliza. */
export function puedeEditarInstrucciones(estado: string | null | undefined): boolean {
  return ["programado", "despachado", "en_curso"].includes(estado || "")
}

/** Un pedido se asigna a un viaje programado en cualquier estado previo a salir. */
export function pedidoAsignableAViaje(estadoPedido: string | null | undefined): boolean {
  return !!estadoPedido && !PEDIDO_NO_ASIGNABLE.includes(estadoPedido)
}

/** Al despachar, el pedido ya debería tener sus papeles. */
export function pedidoListoParaDespacho(estadoPedido: string | null | undefined): boolean {
  return ["facturado", "listo_para_enviar", "listo_para_retirar"].includes(estadoPedido || "")
}

export function esViajePorTransporte(tipoTransporte: string | null | undefined): boolean {
  return tipoTransporte === "transporte"
}
