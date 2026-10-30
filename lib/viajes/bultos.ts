import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * #22 — Bultos y pallets por pedido (se cargan en el ERP antes de finalizar el
 * viaje; no bloquean el despacho).
 *
 * `pedidos.pallets` llega con la migración 20261026_pedidos_pallets.sql. Hasta
 * que se aplique, la lectura devuelve 0 en vez de romper la hoja de ruta (que
 * también usa la app del chofer).
 */
export async function palletsDePedidos(supabase: SupabaseClient, pedidoIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!pedidoIds.length) return out
  const { data, error } = await supabase.from("pedidos").select("id, pallets").in("id", pedidoIds)
  if (error) {
    if (!/pallets/i.test(error.message)) console.error("[viajes/bultos] pallets:", error.message)
    return out
  }
  for (const p of (data || []) as Array<{ id: string; pallets: number | null }>) out.set(p.id, Number(p.pallets) || 0)
  return out
}

/** Viaje en el que todavía se pueden cargar bultos/pallets (antes de finalizarlo). */
export const ESTADOS_CARGA_BULTOS = ["programado", "despachado", "en_curso"] as const

/**
 * P2-27: la carga escrita entera, igual en todas las pantallas y en el PDF:
 * "2 bultos + 1 pallet", "132 bultos", "1 pallet". Sin nada cargado: `vacio`.
 */
export function textoCarga(bultos: number, pallets: number, vacio = ""): string {
  const b = Number(bultos) || 0
  const p = Number(pallets) || 0
  const partes: string[] = []
  if (b > 0) partes.push(`${b} ${b === 1 ? "bulto" : "bultos"}`)
  if (p > 0) partes.push(`${p} ${p === 1 ? "pallet" : "pallets"}`)
  return partes.join(" + ") || vacio
}
