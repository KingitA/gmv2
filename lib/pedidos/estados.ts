/**
 * Reglas de estado de un pedido — única fuente de verdad, compartida por
 * server actions, API routes y UI (ERP + app vendedor).
 *
 * Flujo:  en_venta → pendiente/impreso → en_preparacion → pendiente_facturacion
 *         → facturado → listo_para_retirar | listo_para_enviar → en_viaje
 *         → entregado | rechazado.   (eliminado: baja lógica desde un estado editable)
 *
 * Reglas:
 * - Solo se puede modificar el pedido (artículos, precios, listas, descuentos,
 *   encabezado) mientras está en un estado EDITABLE. Una vez facturado no se
 *   toca nada: si hay que cambiar algo, se hace un pedido nuevo.
 * - Después de facturado lo único editable es la forma de entrega
 *   (condicion_entrega y el estado listo_para_retirar / listo_para_enviar).
 * - Los cambios manuales de estado siguen el flujo; nunca se vuelve atrás de
 *   facturado. Facturado lo pone la emisión de comprobantes, en_viaje la
 *   asignación de viaje, entregado el chofer / mostrador.
 */

export const ESTADOS_EDITABLES = ["en_venta", "pendiente", "impreso", "en_preparacion"] as const
export const ESTADOS_ENTREGA = ["listo_para_retirar", "listo_para_enviar"] as const

export const ESTADO_LABEL: Record<string, string> = {
  en_venta: "En Venta",
  pendiente: "Pendiente",
  impreso: "Impreso",
  en_preparacion: "En Preparación",
  pendiente_facturacion: "Pendiente Facturación",
  facturado: "Facturado",
  listo_para_retirar: "Listo para Retirar",
  listo_para_enviar: "Listo para Enviar",
  en_viaje: "En Viaje",
  entregado: "Entregado",
  rechazado: "Rechazado",
  eliminado: "Eliminado",
}

export function esPedidoEditable(estado: string | null | undefined): boolean {
  return !!estado && (ESTADOS_EDITABLES as readonly string[]).includes(estado)
}

/** Eliminar (baja lógica) sigue la misma regla que editar. */
export function puedeEliminarPedido(estado: string | null | undefined): boolean {
  return esPedidoEditable(estado)
}

/** Forma de entrega: editable hasta que el pedido sale (en_viaje) o termina. */
export function puedeEditarEntrega(estado: string | null | undefined): boolean {
  if (esPedidoEditable(estado)) return true
  return ["pendiente_facturacion", "facturado", "listo_para_retirar", "listo_para_enviar"].includes(estado || "")
}

/** Un viaje se asigna recién con el pedido facturado / listo. */
export function puedeAsignarViaje(estado: string | null | undefined): boolean {
  return ["facturado", "listo_para_retirar", "listo_para_enviar"].includes(estado || "")
}

/** Estados a los que se puede pasar A MANO desde `estado` (sin contar el actual). */
export function transicionesManuales(estado: string | null | undefined): string[] {
  if (!estado) return []
  if (esPedidoEditable(estado)) return (ESTADOS_EDITABLES as readonly string[]).filter(e => e !== estado)
  switch (estado) {
    case "facturado":
    case "listo_para_retirar":
    case "listo_para_enviar":
      return (ESTADOS_ENTREGA as readonly string[]).filter(e => e !== estado)
    case "en_viaje":
      return ["entregado", "rechazado"]
    // pendiente_facturacion lo resuelve la emisión de comprobantes;
    // entregado / rechazado / eliminado son finales.
    default:
      return []
  }
}

export function puedeCambiarEstado(desde: string | null | undefined, hacia: string): boolean {
  if (!desde) return false
  if (desde === hacia) return true
  return transicionesManuales(desde).includes(hacia)
}

/** Texto para la UI cuando el pedido no se puede modificar. */
export function motivoBloqueo(estado: string | null | undefined): string | null {
  if (esPedidoEditable(estado)) return null
  const label = (ESTADO_LABEL[estado || ""] || estado || "").toLowerCase()
  if (estado === "eliminado") return "Este pedido está eliminado y no se puede modificar."
  if (puedeEditarEntrega(estado))
    return `Este pedido ya está ${label}: no se puede modificar. Solo podés cambiar la forma de entrega. Si hay que corregir algo, hacé un pedido nuevo.`
  return `Este pedido ya está ${label} y no se puede modificar. Si hay que corregir algo, hacé un pedido nuevo.`
}
