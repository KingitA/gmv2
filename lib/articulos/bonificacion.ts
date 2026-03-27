/**
 * Helper para obtener el artículo de bonificación (SKU 11115).
 * Este artículo se usa como línea en NC/REV generadas por pago contado.
 * Se crea automáticamente en la migración 104-precio-base-stored.sql.
 */

import { SupabaseClient } from "@supabase/supabase-js"

let cachedBonificacionId: string | null = null

export async function getBonificacionArticuloId(supabase: SupabaseClient): Promise<string> {
  if (cachedBonificacionId) return cachedBonificacionId

  const { data, error } = await supabase
    .from("articulos")
    .select("id")
    .eq("sku", "11115")
    .single()

  if (error || !data) {
    throw new Error(
      "Artículo bonificación (SKU 11115) no encontrado. " +
      "Ejecutar migración 104-precio-base-stored.sql en la base de datos."
    )
  }

  cachedBonificacionId = data.id
  return data.id
}

/** Limpia el cache (útil para tests) */
export function clearBonificacionCache() {
  cachedBonificacionId = null
}
