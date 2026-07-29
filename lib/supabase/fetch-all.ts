// ─── Paginación segura para Supabase/PostgREST ───────────────────────────────
// PostgREST corta silenciosamente en 1000 filas por request (aunque se pida
// .limit mayor). Estos helpers paginan con ORDER BY estable: sin él, Postgres
// no garantiza el orden entre páginas y se duplican/pierden filas.
// Compartido por toda la app (reportes, exportes, listados, agregaciones).

/**
 * Trae TODAS las filas de una query paginando de a 1000.
 * `buildQuery` debe devolver un builder NUEVO en cada llamada (sin .range).
 * El orden estable se agrega acá (por defecto `id`); si la query ya trae sus
 * propios .order, `orderColumn` actúa como desempate final.
 */
export async function fetchAllRows<T = any>(buildQuery: () => any, orderColumn = 'id'): Promise<T[]> {
  const PAGE_SIZE = 1000
  const rows: T[] = []
  let offset = 0
  while (true) {
    const { data, error } = await buildQuery()
      .order(orderColumn, { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    if (!data?.length) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return rows
}

/**
 * Lookup por lista de IDs en tandas de 200: evita URLs gigantes con .in() y el
 * corte en 1000 resultados cuando la lista es grande.
 * `buildQuery(chunk)` debe devolver un builder nuevo aplicando .in() sobre el chunk.
 */
export async function fetchByIds<T = any>(
  buildQuery: (chunk: string[]) => any,
  ids: string[],
  chunkSize = 200,
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += chunkSize) {
    const { data, error } = await buildQuery(ids.slice(i, i + chunkSize))
    if (error) throw error
    out.push(...(data ?? []))
  }
  return out
}
