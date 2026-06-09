"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { padEan13, padEanArray } from "@/lib/utils/ean"

const SELECT_SEARCH = "id, sku, ean13, codigo_bulto, descripcion, unidades_por_bulto, unidad_de_medida, orden_deposito, stock_actual, proveedor_id"
const SELECT_FULL   = "id, sku, ean13, codigo_bulto, descripcion, unidades_por_bulto, unidad_de_medida, orden_deposito, stock_actual, proveedor_id"

export async function buscarArticulosDeposito(
  query: string,
  opciones?: { proveedorId?: string; categoria?: string }
): Promise<{ data: any[]; error?: string }> {
  try {
    const sb = createAdminClient()
    const q = query.trim()

    const base = () => {
      let qb = sb.from("articulos").select(SELECT_SEARCH).eq("activo", true)
      if (opciones?.proveedorId) qb = qb.eq("proveedor_id", opciones.proveedorId)
      if (opciones?.categoria) qb = qb.ilike("categoria", opciones.categoria)
      return qb
    }

    if (!q) {
      const { data, error } = await base().order("descripcion").limit(50)
      if (error) { console.error("[deposito] buscar sin q:", error.message); return { data: [], error: error.message } }
      return { data: data || [] }
    }

    // EAN13 / codigo_bulto exact match si es solo dígitos de 8-14 caracteres
    if (/^\d{8,14}$/.test(q)) {
      const qPadded = padEan13(q)
      const { data: byEan } = await base()
        .or(`ean13.cs.{"${qPadded}"},codigo_bulto.eq.${qPadded}`)
        .limit(5)
      if (byEan && byEan.length > 0) return { data: byEan }
      // fallback: también buscar sin padding por si el código fue guardado sin él
      if (qPadded !== q) {
        const { data: byEanRaw } = await base()
          .or(`ean13.cs.{"${q}"},codigo_bulto.eq.${q}`)
          .limit(5)
        if (byEanRaw && byEanRaw.length > 0) return { data: byEanRaw }
      }
    }

    const { data, error } = await base()
      .or(`descripcion.ilike.%${q}%,sku.ilike.%${q}%`)
      .order("descripcion")
      .limit(30)
    if (error) { console.error("[deposito] buscar texto:", error.message); return { data: [], error: error.message } }
    return { data: data || [] }
  } catch (e: any) {
    console.error("[deposito] buscar exception:", e?.message)
    return { data: [], error: e?.message || "Error inesperado" }
  }
}

export async function getProveedoresDeposito() {
  const sb = createAdminClient()
  const { data } = await sb.from("proveedores").select("id, nombre").eq("activo", true).order("nombre")
  return data || []
}

export async function getCategoriasDeposito() {
  const sb = createAdminClient()
  const { data } = await sb
    .from("articulos")
    .select("categoria")
    .eq("activo", true)
    .not("categoria", "is", null)
    .neq("categoria", "")
  const cats = [...new Set((data || []).map((a: any) => a.categoria).filter(Boolean))] as string[]
  return cats.sort()
}

// Carga TODOS los artículos de un filtro ordenados por orden_deposito (para sesión de conteo)
export async function cargarSesionDeposito(opciones: { proveedorId?: string; categoria?: string }): Promise<{ data: any[]; error?: string }> {
  try {
    const sb = createAdminClient()
    let qb = sb.from("articulos").select(SELECT_FULL).eq("activo", true)
    if (opciones.proveedorId) qb = qb.eq("proveedor_id", opciones.proveedorId)
    if (opciones.categoria) qb = qb.ilike("categoria", opciones.categoria)
    const { data, error } = await qb
      .order("orden_deposito", { ascending: true, nullsFirst: false })
      .order("descripcion", { ascending: true })
      .limit(500)
    if (error) { console.error("[deposito] sesion:", error.message); return { data: [], error: error.message } }
    return { data: data || [] }
  } catch (e: any) {
    console.error("[deposito] sesion exception:", e?.message)
    return { data: [], error: e?.message || "Error inesperado" }
  }
}

export async function actualizarDatosArticulo(id: string, datos: {
  ean13?: string[] | null
  codigo_bulto?: string | null
  unidades_por_bulto?: number | null
  unidad_de_medida?: string | null
  orden_deposito?: number | null
  tipo_fraccion?: string | null
  cantidad_fraccion?: number | null
}) {
  const sb = createAdminClient()
  const normalized = {
    ...datos,
    ean13: datos.ean13 ? padEanArray(datos.ean13) : datos.ean13,
    codigo_bulto: datos.codigo_bulto ? padEan13(datos.codigo_bulto) : datos.codigo_bulto,
  }
  const { error } = await sb.from("articulos").update(normalized).eq("id", id)
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

export async function getArticulosListado(
  filtros: { proveedorId?: string; categoria?: string; soloConOrden?: boolean },
  page: number = 0
): Promise<{ data: any[]; total: number; error?: string }> {
  try {
    const sb = createAdminClient()
    const limit = 100
    const offset = page * limit
    let qb = sb
      .from("articulos")
      .select("id, sku, descripcion, ean13, codigo_bulto, orden_deposito, stock_actual, unidades_por_bulto, unidad_de_medida, marcas!marca_id(descripcion)", { count: "exact" })
      .eq("activo", true)
    if (filtros.proveedorId) qb = qb.eq("proveedor_id", filtros.proveedorId)
    if (filtros.categoria)   qb = qb.ilike("categoria", filtros.categoria)
    if (filtros.soloConOrden) qb = qb.not("orden_deposito", "is", null)
    const { data, error, count } = await qb
      .order("orden_deposito", { ascending: true, nullsFirst: false })
      .order("descripcion",    { ascending: true })
      .range(offset, offset + limit - 1)
    if (error) return { data: [], total: 0, error: error.message }
    const mapped = (data || []).map((a: any) => ({
      ...a,
      marca: (a.marcas as any)?.descripcion ?? null,
      marcas: undefined,
    }))
    return { data: mapped, total: count || 0 }
  } catch (e: any) {
    return { data: [], total: 0, error: e?.message || "Error inesperado" }
  }
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
    .select("stock_actual")
    .eq("id", articuloId)
    .single()
  if (fetchErr) throw new Error(fetchErr.message)

  let nuevoStock: number
  const stockActual = art.stock_actual ?? 0
  if (tipo === "correccion") nuevoStock = cantidad
  else if (tipo === "entrada") nuevoStock = stockActual + cantidad
  else nuevoStock = stockActual - cantidad

  const { error } = await sb
    .from("articulos")
    .update({ stock_actual: nuevoStock })
    .eq("id", articuloId)
  if (error) throw new Error(error.message)
  return { success: true, nuevoStock }
}
