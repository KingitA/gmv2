import { hybridSearchIds } from "@/lib/search/hybrid"

/**
 * Búsqueda con filtros que COMPONE bien texto + filtros, sin el bug de "filtrar
 * después del corte por relevancia".
 *
 * Preserva la búsqueda combinada del motor:
 *  - Relevancia (léxico + embeddings) vía hybridSearchIds, pero hidratando YA con los
 *    filtros aplicados → el ranking se calcula y recorta DENTRO del subconjunto filtrado.
 *  - Completitud: un pase literal token-AND sobre `search_text` DENTRO del filtro, que
 *    garantiza traer TODOS los que matchean literalmente (no se pierde ninguno).
 *    Como `search_text` concatena descripción + marca + proveedor + categoría (artículos)
 *    ó nombre + dirección + localidad (clientes), "bolsa make" sigue matcheando por
 *    descripción+marca, etc.
 *  - Unión: primero los rankeados por relevancia, luego los literales que falten.
 *
 * Cuando NO hay filtro, devuelve solo el pool de relevancia global (autocomplete),
 * para no traer miles de filas.
 *
 * Asume `q` no vacío. La rama de EAN/código exacto la maneja cada caller antes.
 */
export async function buscarConFiltros(opts: {
  sb: any
  table: string
  entity: string                 // "articulos" | "clientes" | "proveedores"
  q: string
  select: string
  hayFiltro: boolean
  aplicarFiltros: (qb: any) => any   // agrega .eq("activo",true) + filtros (proveedor, vendedor, etc.)
  hybridN?: number
  literalLimit?: number
}): Promise<any[]> {
  const { sb, table, entity, select, aplicarFiltros, hayFiltro } = opts
  const q = opts.q.trim()
  if (!q) return []

  // 1. Relevancia (léxico + embeddings) DENTRO del filtro
  const hybridN = opts.hybridN ?? (hayFiltro ? 300 : 50)
  const ids = await hybridSearchIds(entity, q, hybridN)
  let ranked: any[] = []
  if (ids.length > 0) {
    const { data } = await aplicarFiltros(sb.from(table).select(select).in("id", ids))
    const map = new Map((data || []).map((r: any) => [r.id, r]))
    ranked = ids.map((id) => map.get(id)).filter(Boolean)
  }

  // Sin filtro, el pool de relevancia ES el resultado (búsqueda global / autocomplete).
  if (!hayFiltro) return ranked

  // 2. Completitud literal DENTRO del filtro (garantiza no perder ninguno del subconjunto)
  let lq = aplicarFiltros(sb.from(table).select(select))
  for (const tok of q.split(/\s+/).filter((t) => t.length >= 2)) {
    lq = lq.ilike("search_text", `%${tok.replace(/[%_]/g, "")}%`)
  }
  const { data: lit } = await lq.limit(opts.literalLimit ?? 500)

  // 3. Unión: relevancia primero, literales faltantes después
  const seen = new Set(ranked.map((r) => r.id))
  const out = [...ranked]
  for (const r of lit || []) {
    if (!seen.has(r.id)) { seen.add(r.id); out.push(r) }
  }
  return out
}
