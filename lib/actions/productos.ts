"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { searchProductsByVector } from "@/lib/actions/embeddings"

export async function searchProductos(searchTerm: string) {
  const supabase = createAdminClient()
  const term = searchTerm?.trim() || ""

  const SELECT = "id, sku, sigla, ean13, descripcion, rubro, categoria, stock_actual, precio_compra, unidades_por_bulto, unidad_medida, activo"

  if (!term) {
    const { data, error } = await supabase
      .from("articulos")
      .select(SELECT)
      .eq("activo", true)
      .order("descripcion")
      .limit(50)
    if (error) { console.error("[searchProductos] Error:", error); return [] }
    return data || []
  }

  const [{ data: textResults }, vectorResults] = await Promise.all([
    supabase
      .from("articulos")
      .select(SELECT)
      .eq("activo", true)
      .or(`descripcion.ilike.%${term}%,sku.ilike.%${term}%,ean13.ilike.%${term}%,sigla.ilike.%${term}%`)
      .order("descripcion")
      .limit(50),
    searchProductsByVector(term, 0.35, 50),
  ])

  const textIds = new Set((textResults || []).map((r: any) => r.id))
  const merged = [
    ...(textResults || []),
    ...vectorResults.filter((r: any) => !textIds.has(r.id)),
  ].slice(0, 50)

  return merged
}
