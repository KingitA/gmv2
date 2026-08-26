// Segmentación de artículos para precios / bonificaciones. Puro (sin DB),
// compartido por el motor de pedidos (server) y las pantallas (client).

/** Segmento interno del motor de precios */
export type Segmento = "limpieza" | "perf0" | "perf_plus"

/** Clave del segmento en la tabla `bonificaciones` y en los overrides por pedido */
export type SegmentoBonif = "limpieza_bazar" | "perf0" | "perf_plus"

export const SEGMENTOS_BONIF: SegmentoBonif[] = ["limpieza_bazar", "perf0", "perf_plus"]

export const SEGMENTO_BONIF: Record<Segmento, SegmentoBonif> = {
  limpieza: "limpieza_bazar",
  perf0: "perf0",
  perf_plus: "perf_plus",
}

export const SEGMENTO_LABEL: Record<SegmentoBonif, string> = {
  limpieza_bazar: "Limpieza / Bazar",
  perf0: "Perfumería 0",
  perf_plus: "Perfumería plus",
}

export interface ArticuloSegmentable {
  categoria?: string | null
  iva_compras?: string | null
  iva_ventas?: string | null
  segmento_precio?: string | null
  rubros?: { slug: string } | { slug: string }[] | null
}

function segPerf(a: { iva_ventas?: string | null }): Segmento {
  return a.iva_ventas === "presupuesto" ? "perf0" : "perf_plus"
}

export function detectarSegmento(articulo: ArticuloSegmentable): Segmento {
  // 1. Override explícito
  if (articulo.segmento_precio === "perfumeria") return segPerf(articulo)
  if (articulo.segmento_precio === "limpieza_bazar") return "limpieza"

  // 2. Slug relacional del rubro
  const r: any = articulo.rubros
  const slug: string | undefined = Array.isArray(r) ? r[0]?.slug : r?.slug
  if (slug === "perfumeria") return segPerf(articulo)
  if (slug === "limpieza" || slug === "bazar") return "limpieza"

  // 3. Fallback: texto de categoría
  const cat = (articulo.categoria || "").toUpperCase()
  if (cat.includes("PERFUMERIA") || cat.includes("PERFUMERÍA")) return segPerf(articulo)
  return "limpieza"
}

export function detectarSegmentoBonif(articulo: ArticuloSegmentable): SegmentoBonif {
  return SEGMENTO_BONIF[detectarSegmento(articulo)]
}

/**
 * Bonificaciones "solo este pedido" (pedidos.bonif_pedido, jsonb).
 * Cada tipo: objeto { segmento: % } — si el tipo está presente pisa la ficha
 * del cliente para los segmentos que tenga definidos; ausente/null = hereda.
 */
export type BonifPorSegmento = Partial<Record<SegmentoBonif, number>>
export interface BonifPedido {
  general?: BonifPorSegmento | null
  viajante?: BonifPorSegmento | null
  mercaderia?: BonifPorSegmento | null
}

/** Normaliza un BonifPedido: números finitos 0..100, sin claves vacías; null si queda vacío */
export function normalizarBonifPedido(input: any): BonifPedido | null {
  if (!input || typeof input !== "object") return null
  const out: BonifPedido = {}
  for (const tipo of ["general", "viajante", "mercaderia"] as const) {
    const src = input[tipo]
    if (!src || typeof src !== "object") continue
    const seg: BonifPorSegmento = {}
    for (const k of SEGMENTOS_BONIF) {
      const v = Number(src[k])
      if (Number.isFinite(v)) seg[k] = Math.max(0, Math.min(100, v))
    }
    if (Object.keys(seg).length) out[tipo] = seg
  }
  return Object.keys(out).length ? out : null
}

/** Pasa un mapa { segmento: % } al formato de filas de bonificaciones */
export function bonifSegAFilas(seg: BonifPorSegmento | null | undefined): Array<{ segmento: string | null; porcentaje: number }> {
  if (!seg) return []
  return SEGMENTOS_BONIF.filter((k) => typeof seg[k] === "number").map((k) => ({ segmento: k, porcentaje: seg[k] as number }))
}
