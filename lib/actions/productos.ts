"use server"

import { createAdminClient } from "@/lib/supabase/admin"

export async function searchProductos(searchTerm: string) {
  const supabase = createAdminClient()

  let query = supabase
    .from("articulos")
    .select("id, sku, sigla, ean13, descripcion, rubro, categoria, stock_actual, precio_compra, unidades_por_bulto, unidad_medida, activo")
    .eq("activo", true)

  if (searchTerm && searchTerm.trim().length > 0) {
    const term = searchTerm.trim()
    query = query.or(`descripcion.ilike.%${term}%,sku.ilike.%${term}%,ean13.ilike.%${term}%,sigla.ilike.%${term}%`)
  }

  const { data, error } = await query.order("descripcion").limit(50)

  if (error) {
    console.error("[searchProductos] Error:", error)
    return []
  }

  return data || []
}
