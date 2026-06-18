"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { hybridSearchIds } from "@/lib/search/hybrid"

const SELECT = "id, sku, ean13, descripcion, rubro, categoria, precio_compra, precio_base, unidades_por_bulto, activo, marca:marca_id(descripcion)"

export async function searchProductos(searchTerm: string) {
  const supabase = createAdminClient()
  const term = searchTerm?.trim() || ""

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

  // Motor unificado: léxico trigram (token-AND, typos) + vector como fallback.
  const ids = await hybridSearchIds("articulos", term, 50)
  if (ids.length === 0) return []

  const { data, error } = await supabase
    .from("articulos")
    .select(SELECT)
    .in("id", ids)
    .eq("activo", true)
  if (error) { console.error("[searchProductos] Error:", error); return [] }

  // Conservar el orden de relevancia del motor
  const map = new Map((data || []).map((r: any) => [r.id, r]))
  return ids.map((id) => map.get(id)).filter(Boolean)
}
