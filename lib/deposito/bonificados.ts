/**
 * Recalculo de cantidades bonificadas de un pedido según lo REALMENTE preparado.
 * Módulo PURO (sin imports): lo usa el servidor (picking/item) y la app Depósito
 * sobre la réplica local, para que offline el operario vea las mismas unidades
 * bonificadas que va a fijar el servidor al sincronizar.
 *
 * Regla: monto = % mercadería × neto preparado (precio_base × cantidad_preparada,
 * sin bonificados ni artículos de lista especial), repartido parejo entre los
 * renglones bonificados; unidades = round(parte / precio_base).
 */

export interface LineaBonificable {
  id: string
  cantidad: number | null
  cantidad_preparada: number | null
  precio_base?: number | null
  es_bonificado?: boolean | null
  /** true si el renglón es de la lista "especial" (no entra en la base) */
  excluye_bonif?: boolean | null
}

export interface BonificadoCalculado {
  id: string
  cantidad: number
  /** false = ya tenía esa cantidad y estaba completo (no hay nada que escribir) */
  cambia: boolean
}

export function calcularBonificados(pct: number | null | undefined, lineas: LineaBonificable[]): BonificadoCalculado[] {
  const bonificados = lineas.filter((d) => d.es_bonificado)
  if (bonificados.length === 0) return []
  const p = Number(pct ?? 0)
  // Sin % no se recalcula: quedan las cantidades que cargó el usuario a mano.
  if (p <= 0) return bonificados.map((b) => ({ id: b.id, cantidad: Number(b.cantidad || 0), cambia: false }))
  const netoPreparado = lineas
    .filter((d) => !d.es_bonificado && !d.excluye_bonif)
    .reduce((s, d) => s + Number(d.precio_base || 0) * Number(d.cantidad_preparada || 0), 0)
  const share = ((netoPreparado * p) / 100) / bonificados.length
  return bonificados.map((b) => {
    const precio = Number(b.precio_base || 0)
    const units = precio > 0 ? Math.round(share / precio) : 0
    return { id: b.id, cantidad: units, cambia: units !== Number(b.cantidad) || units !== Number(b.cantidad_preparada) }
  })
}

/** Estado del renglón a partir de lo preparado (misma regla que PATCH picking/item). */
export function estadoItemPicking(cantidadPreparada: number, cantidadPedida: number, esFaltante: boolean): "PENDIENTE" | "FALTANTE" | "COMPLETO" | "PARCIAL" {
  if (esFaltante) return "FALTANTE"
  if (cantidadPreparada >= cantidadPedida) return "COMPLETO"
  if (cantidadPreparada > 0) return "PARCIAL"
  return "PENDIENTE"
}

/** Estado de la línea de recepción (misma regla que PATCH recepciones). -1 = volver a pendiente. */
export function estadoLineaRecepcion(cantidadFisica: number): { estado_linea: "pendiente" | "faltante" | "ok"; cantidad: number } {
  if (cantidadFisica === -1) return { estado_linea: "pendiente", cantidad: 0 }
  if (cantidadFisica === 0) return { estado_linea: "faltante", cantidad: 0 }
  return { estado_linea: "ok", cantidad: cantidadFisica }
}
