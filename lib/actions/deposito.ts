"use server"

import { createAdminClient } from "@/lib/supabase/admin"

const SELECT = "id, sku, ean13, descripcion, unidades_por_bulto, unidad_de_medida, orden_deposito, cantidad_stock, imagen_url, proveedor:proveedores(nombre), marca:marca_id(descripcion)"

export async function buscarArticulosDeposito(query: string) {
  const sb = createAdminClient()
  const q = query.trim()
  if (!q) {
    const { data } = await sb
      .from("articulos")
      .select(SELECT)
      .eq("activo", true)
      .order("descripcion")
      .limit(30)
    return data || []
  }

  // EAN13 exact match si es solo dígitos de 8-14 caracteres
  if (/^\d{8,14}$/.test(q)) {
    const { data: byEan } = await sb
      .from("articulos")
      .select(SELECT)
      .contains("ean13", [q])
      .eq("activo", true)
      .limit(5)
    if (byEan && byEan.length > 0) return byEan
  }

  const { data } = await sb
    .from("articulos")
    .select(SELECT)
    .eq("activo", true)
    .or(`descripcion.ilike.%${q}%,sku.ilike.%${q}%`)
    .order("descripcion")
    .limit(20)
  return data || []
}

export async function actualizarDatosArticulo(id: string, datos: {
  ean13?: string[] | null
  unidades_por_bulto?: number | null
  unidad_de_medida?: string | null
  orden_deposito?: number | null
  tipo_fraccion?: string | null
  cantidad_fraccion?: number | null
}) {
  const sb = createAdminClient()
  const { error } = await sb.from("articulos").update(datos).eq("id", id)
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function getArticuloExtra(id: string) {
  const sb = createAdminClient()
  const { data } = await sb
    .from("articulos")
    .select("tipo_fraccion, cantidad_fraccion")
    .eq("id", id)
    .single()
  return data
}

export async function ajustarStock(
  articuloId: string,
  cantidad: number,
  tipo: "correccion" | "entrada" | "salida",
  motivo: string
) {
  const sb = createAdminClient()
  const { data: art, error: fetchErr } = await sb
    .from("articulos")
    .select("cantidad_stock")
    .eq("id", articuloId)
    .single()
  if (fetchErr) throw new Error(fetchErr.message)

  let nuevoStock: number
  const stockActual = art.cantidad_stock ?? 0
  if (tipo === "correccion") nuevoStock = cantidad
  else if (tipo === "entrada") nuevoStock = stockActual + cantidad
  else nuevoStock = stockActual - cantidad

  const { error } = await sb
    .from("articulos")
    .update({ cantidad_stock: nuevoStock })
    .eq("id", articuloId)
  if (error) throw new Error(error.message)
  return { success: true, nuevoStock }
}
