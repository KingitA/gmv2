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

// ─── Mercadería bonificada POR CUPO (regla del dueño, 06/10/2026) ────────────
// Cada renglón vendido guarda a qué cupo aporta (bonif_merc_origen: "todo",
// "seg:<segmento>", "prov:<id>", "marca:<id>") y con qué % (bonif_merc_pct).
// Cada cupo se calcula por separado: monto = % × neto del cupo, repartido parejo
// entre los artículos bonificados elegidos para ESE cupo (renglones es_bonificado
// con el mismo origen); unidades = redondeo al entero más cercano (0,5 sube).
// Base: lo que REALMENTE va. Renglón ya resuelto en picking (no PENDIENTE) →
// cantidad_preparada; todavía no preparado → cantidad vendida (estimación).
// Un cupo sin artículos elegidos queda PENDIENTE: no se puede facturar.

export interface LineaCupo extends LineaBonificable {
  estado_item?: string | null
  bonif_merc_origen?: string | null
  bonif_merc_pct?: number | null
}

export interface CupoBonificacion {
  origen: string
  pct: number
  /** neto que va del cupo (base del cálculo) */
  base: number
  /** monto a bonificar = base × pct */
  monto: number
  /** renglones bonificados elegidos para el cupo */
  bonificados: number
}

/** Cantidad que "va" de un renglón: lo preparado si ya se resolvió en picking, si no lo vendido. */
export function cantidadQueVa(l: { cantidad?: number | null; cantidad_preparada?: number | null; estado_item?: string | null }): number {
  return l.estado_item && l.estado_item !== "PENDIENTE" ? Number(l.cantidad_preparada || 0) : Number(l.cantidad || 0)
}

/** ¿El pedido usa cupos (renglones con origen)? Si no, es un pedido viejo: regla de un solo %. */
export function usaCupos(lineas: LineaCupo[]): boolean {
  return lineas.some((l) => !!l.bonif_merc_origen)
}

export function calcularBonificadosPorCupo(lineas: LineaCupo[]): {
  calculados: BonificadoCalculado[]
  cupos: CupoBonificacion[]
  /** orígenes con % > 0 y sin ningún artículo bonificado elegido */
  pendientes: string[]
} {
  const cupos = new Map<string, CupoBonificacion>()
  for (const l of lineas) {
    if (l.es_bonificado || !l.bonif_merc_origen) continue
    const pct = Number(l.bonif_merc_pct || 0)
    if (!(pct > 0)) continue
    const c = cupos.get(l.bonif_merc_origen) || { origen: l.bonif_merc_origen, pct: 0, base: 0, monto: 0, bonificados: 0 }
    c.pct = Math.max(c.pct, pct)
    c.base += Number(l.precio_base || 0) * cantidadQueVa(l)
    cupos.set(l.bonif_merc_origen, c)
  }
  const bonifPorOrigen = new Map<string, LineaCupo[]>()
  for (const b of lineas) {
    if (!b.es_bonificado) continue
    const k = b.bonif_merc_origen || ""
    if (!bonifPorOrigen.has(k)) bonifPorOrigen.set(k, [])
    bonifPorOrigen.get(k)!.push(b)
  }
  const calculados: BonificadoCalculado[] = []
  for (const [origen, bonifs] of bonifPorOrigen) {
    const cupo = cupos.get(origen)
    if (cupo) {
      cupo.base = Math.round(cupo.base * 100) / 100
      cupo.monto = Math.round(cupo.base * cupo.pct) / 100
      cupo.bonificados = bonifs.length
    }
    const share = cupo ? cupo.monto / bonifs.length : 0
    for (const b of bonifs) {
      const precio = Number(b.precio_base || 0)
      // Math.round redondea .5 hacia arriba en positivos: <0,5 → 0 · ≥0,5 → 1
      const units = cupo && precio > 0 ? Math.round(share / precio) : 0
      calculados.push({ id: b.id, cantidad: units, cambia: units !== Number(b.cantidad) })
    }
  }
  for (const c of cupos.values()) {
    if (!c.bonificados) {
      c.base = Math.round(c.base * 100) / 100
      c.monto = Math.round(c.base * c.pct) / 100
    }
  }
  const pendientes = [...cupos.values()].filter((c) => c.bonificados === 0).map((c) => c.origen)
  return { calculados, cupos: [...cupos.values()], pendientes }
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
