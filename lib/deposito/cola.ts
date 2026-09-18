/**
 * Cola de pedidos a preparar (GET /api/deposito/pedidos y dataset deposito_pedidos).
 *
 * POR QUÉ NO ES UN SOLO SELECT (incidente del 18/09/2026): la consulta original
 * `pedidos + pedidos_detalle(...) embebido + ORDER BY + LIMIT` obliga a Postgres a
 * armar los renglones de TODOS los pedidos de la cola antes de ordenar. Con 1.285
 * pedidos / 53.867 renglones superó el statement timeout (8 s): la route devolvía
 * 500 y la pantalla mostraba la cola VACÍA sin ningún mensaje. Y aunque terminara,
 * la respuesta pesaba 21 MB (Vercel corta en 4,5 MB).
 *
 * Regla: los pedidos se leen SIN embeber renglones; los renglones se leen aparte,
 * por tandas de pedido_id, en paralelo.
 */

import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { ESTADOS_PREPARABLES } from "./picking"

const PEDIDO_COLS = "id, numero_pedido, estado, fecha, prioridad, observaciones, created_at, clientes(id, nombre, razon_social, direccion, localidad)"

export function enTandas<T>(items: T[], tam: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += tam) out.push(items.slice(i, i + tam))
  return out
}

/** Corre `fn` sobre cada tanda con un máximo de tareas simultáneas. */
export async function porTandas<T, R>(tandas: T[][], simultaneas: number, fn: (tanda: T[]) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < tandas.length; i += simultaneas) {
    out.push(...(await Promise.all(tandas.slice(i, i + simultaneas).map(fn))))
  }
  return out
}

/**
 * Cola para el LISTADO web: cada pedido con su progreso (total de renglones y
 * cuántos ya están resueltos). No trae los renglones: el listado nunca los usó y
 * eran el 97 % del peso. El detalle se pide al abrir el pedido (POST /picking).
 */
export async function cargarColaResumen(supabase: any) {
  const pedidos: any[] = await fetchAllRows(() =>
    supabase.from("pedidos").select(PEDIDO_COLS).in("estado", ESTADOS_PREPARABLES).order("created_at", { ascending: true }),
  )
  if (pedidos.length === 0) return []

  const totales = new Map<string, number>()
  const resueltos = new Map<string, number>()
  await porTandas(enTandas(pedidos.map((p) => p.id), 100), 16, async (ids) => {
    const [conteo, hechos] = await Promise.all([
      supabase.from("pedidos").select("id, pedidos_detalle(count)").in("id", ids),
      fetchAllRows(() =>
        supabase.from("pedidos_detalle").select("id, pedido_id").in("pedido_id", ids).not("estado_item", "is", null).neq("estado_item", "PENDIENTE"),
      ),
    ])
    if (conteo.error) throw conteo.error
    for (const p of conteo.data || []) totales.set(p.id, Number(p.pedidos_detalle?.[0]?.count ?? 0))
    for (const d of hechos as any[]) resueltos.set(d.pedido_id, (resueltos.get(d.pedido_id) || 0) + 1)
  })

  return pedidos.map((p) => ({ ...p, progreso: { total: totales.get(p.id) || 0, resueltos: resueltos.get(p.id) || 0 } }))
}
