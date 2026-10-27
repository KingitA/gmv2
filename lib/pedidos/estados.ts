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
 *   facturado. Facturado lo pone la emisión de comprobantes, en_viaje el
 *   despacho del viaje, entregado el chofer / mostrador.
 */

// en_revision (09/10/2026): primer pedido de un cliente, tomado desde la app del
// vendedor (típicamente un cliente dado de alta en la calle). Queda retenido para
// que la oficina revise cliente y pedido: depósito NO lo ve (no es preparable) hasta
// que la oficina lo pasa a "pendiente" con el cambio de estado de siempre.
export const ESTADOS_EDITABLES = ["en_revision", "en_venta", "pendiente", "impreso", "en_preparacion"] as const
export const ESTADOS_ENTREGA = ["listo_para_retirar", "listo_para_enviar"] as const

export const ESTADO_LABEL: Record<string, string> = {
  en_revision: "En Revisión",
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
  sistema_viejo: "Sistema viejo",
}

export function esPedidoEditable(estado: string | null | undefined): boolean {
  return !!estado && (ESTADOS_EDITABLES as readonly string[]).includes(estado)
}

/** Comprobantes que FACTURAN un pedido. Las NC/REV (espejo de una anulación,
 *  devolución, 10 % contado) no: un pedido sin débitos vivos no está facturado. */
export const TIPOS_FACTURA_PEDIDO = ["FA", "FB", "FC", "PRES", "ND", "NDA", "NDB", "NDC"] as const

const ESTADOS_SIN_CONDICIONES = ["eliminado", "sistema_viejo"]

/**
 * Condiciones del pedido (lista, método de facturación, descuentos por segmento,
 * contado 10 %, mercadería %, condiciones por proveedor/marca). Regla del dueño
 * (23/10/2026, #16): los ARTÍCULOS y CANTIDADES se bloquean al preparar (son los
 * del depósito), pero las condiciones se pueden cambiar mientras el pedido NO
 * esté facturado; al guardar se reprecia solo.
 * Regla del dueño (27/10/2026, #19/#20): después de anular sus comprobantes para
 * refacturar, el pedido QUEDA EN SU ESTADO (en viaje, entregado…): lo que manda
 * es si le quedan comprobantes vivos que lo facturen (`tieneFacturaViva`), no el
 * estado. Sin ese dato (pantallas viejas) se toma "pendiente_facturacion" como
 * el único estado preparado sin facturar.
 */
export function puedeEditarCondiciones(estado: string | null | undefined, tieneFacturaViva?: boolean): boolean {
  if (esPedidoEditable(estado)) return true
  if (!estado || ESTADOS_SIN_CONDICIONES.includes(estado)) return false
  if (tieneFacturaViva === undefined) return estado === "pendiente_facturacion"
  return !tieneFacturaViva
}

/**
 * Estado del pedido al emitir sus comprobantes. Antes de salir pasa a
 * "facturado"; si ya estaba más adelante (listo, en viaje, entregado, rechazado)
 * —refacturado después de anular, #19/#20— se queda donde estaba: refacturar
 * solo cambia los comprobantes, no la logística (regla del dueño 27/10/2026).
 */
export function estadoAlFacturar(estadoActual: string | null | undefined): string {
  const despues = ["facturado", "listo_para_retirar", "listo_para_enviar", "en_viaje", "entregado", "rechazado"]
  return despues.includes(estadoActual || "") ? (estadoActual as string) : "facturado"
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

/**
 * Un pedido se sube a un viaje programado en cualquier estado previo a salir
 * (los viajes se arman antes de que el pedido esté facturado). Pasa a en_viaje
 * recién al despachar el viaje — ver lib/viajes/estados.ts.
 */
export function puedeAsignarViaje(estado: string | null | undefined): boolean {
  return !!estado && !["en_viaje", "entregado", "rechazado", "eliminado", "sistema_viejo"].includes(estado)
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
export function motivoBloqueo(estado: string | null | undefined, tieneFacturaViva?: boolean): string | null {
  if (esPedidoEditable(estado)) return null
  const label = (ESTADO_LABEL[estado || ""] || estado || "").toLowerCase()
  if (estado === "eliminado") return "Este pedido está eliminado y no se puede modificar."
  if (estado === "sistema_viejo") return "Este pedido se cargó antes del pase a producción: se entregó y cobró en el sistema viejo. No se puede modificar."
  if (puedeEditarCondiciones(estado, tieneFacturaViva))
    return `Este pedido está ${label} y sin comprobantes: los artículos y las cantidades quedaron como los preparó el depósito. Podés cambiar las condiciones (lista, método, descuentos, contado) y volver a generar los comprobantes.`
  if (tieneFacturaViva && !["en_viaje", "entregado", "rechazado"].includes(estado || ""))
    return `Este pedido ya está facturado: para cambiar las condiciones hay que anular sus comprobantes ("Anular comprobantes"). Podés cambiar la forma de entrega.`
  if (puedeEditarEntrega(estado))
    return `Este pedido ya está ${label}: no se puede modificar. Solo podés cambiar la forma de entrega. Si hay que corregir algo, hacé un pedido nuevo.`
  return `Este pedido ya está ${label} y no se puede modificar. Si hay que corregir algo, hacé un pedido nuevo.`
}
