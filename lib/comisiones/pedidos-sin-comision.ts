import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchByIds } from "@/lib/supabase/fetch-all"

/** Estados de pedido cuyas líneas de kardex no generan comisión en este sistema. */
export const ESTADOS_SIN_COMISION = ["eliminado", "sistema_viejo"]

/**
 * Pedidos que NO cuentan para comisiones (#10): eliminados (el flag
 * kardex.pedido_eliminado de los de agosto quedó en false) y los pasados al
 * sistema viejo (esas comisiones se liquidan allá, regla 36). Se filtra por el
 * estado del pedido, no solo por el flag del kardex.
 */
export async function pedidosSinComision(supabase: SupabaseClient, pedidoIds: Array<string | null | undefined>): Promise<Set<string>> {
  const ids = [...new Set(pedidoIds.filter(Boolean))] as string[]
  if (!ids.length) return new Set()
  const rows = await fetchByIds<any>(
    (ch) => supabase.from("pedidos").select("id").in("id", ch).in("estado", ESTADOS_SIN_COMISION),
    ids,
  )
  return new Set(rows.map((r) => r.id))
}

/** Filtra líneas de kardex de pedidos que no cuentan para comisiones. */
export async function sinPedidosExcluidos<T extends { pedido_id?: string | null }>(supabase: SupabaseClient, rows: T[]): Promise<T[]> {
  const fuera = await pedidosSinComision(supabase, rows.map((r) => r.pedido_id))
  return fuera.size ? rows.filter((r) => !r.pedido_id || !fuera.has(r.pedido_id)) : rows
}
