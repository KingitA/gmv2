"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { padEan13, padEanArray } from "@/lib/utils/ean"
import { hybridSearchIds } from "@/lib/search/hybrid"

const SELECT_SEARCH = "id, sku, ean13, codigo_bulto, descripcion, unidades_por_bulto, unidad_de_medida, orden_deposito, stock_actual, proveedor_id, marca:marca_id(descripcion)"
const SELECT_FULL   = "id, sku, ean13, codigo_bulto, descripcion, unidades_por_bulto, unidad_de_medida, orden_deposito, stock_actual, proveedor_id, marca:marca_id(descripcion)"

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

    // Motor unificado: ids por relevancia; hidratamos respetando filtros (proveedor/categoria)
    const ids = await hybridSearchIds("articulos", q, 30)
    if (ids.length === 0) return { data: [] }
    const { data, error } = await base().in("id", ids)
    if (error) { console.error("[deposito] buscar texto:", error.message); return { data: [], error: error.message } }
    const map = new Map((data || []).map((r: any) => [r.id, r]))
    return { data: ids.map((id) => map.get(id)).filter(Boolean) }
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

const SELECT_LISTADO = "id, sku, descripcion, ean13, codigo_bulto, orden_deposito, stock_actual, unidades_por_bulto, unidad_de_medida, marcas!marca_id(descripcion)"
const mapListado = (a: any) => a ? ({ ...a, marca: (a.marcas as any)?.descripcion ?? null, marcas: undefined }) : null

// Trae un artículo por id con el mismo shape del listado (para restaurar la sesión tras recarga).
export async function getArticuloPorId(id: string): Promise<{ data: any | null }> {
  const sb = createAdminClient()
  const { data } = await sb.from("articulos").select(SELECT_LISTADO).eq("id", id).eq("activo", true).single()
  return { data: mapListado(data) }
}

/**
 * Devuelve el artículo adyacente (siguiente/anterior) en el orden de depósito,
 * usando un cursor sobre la clave estable (orden_deposito ASC nulls last, descripcion ASC, id ASC).
 * No depende de tener la lista en memoria → retomable desde cualquier punto.
 * Sólo usa filtros numéricos/null (no mete descripcion en strings de PostgREST, que rompen con comas/paréntesis).
 */
export async function getArticuloAdyacente(
  actual: { orden_deposito: number | null; descripcion: string; id: string },
  dir: "next" | "prev",
  filtros: { proveedorId?: string; categoria?: string }
): Promise<{ data: any | null }> {
  const sb = createAdminClient()
  const base = () => {
    let qb = sb.from("articulos").select(SELECT_LISTADO).eq("activo", true)
    if (filtros.proveedorId) qb = qb.eq("proveedor_id", filtros.proveedorId)
    if (filtros.categoria) qb = qb.ilike("categoria", filtros.categoria)
    return qb
  }
  const cmpAsc = (x: any, y: any) =>
    x.descripcion < y.descripcion ? -1 : x.descripcion > y.descripcion ? 1 : (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)

  const o = actual.orden_deposito

  // Bucket = artículos con el mismo orden_deposito (o todos los null), ordenados por (descripcion, id).
  const cargarBucket = async (): Promise<any[]> => {
    let qb = base()
    qb = o == null ? qb.is("orden_deposito", null) : qb.eq("orden_deposito", o)
    const { data } = await qb.order("descripcion", { ascending: true }).order("id", { ascending: true }).limit(1000)
    return (data || []).sort(cmpAsc)
  }

  if (dir === "next") {
    const bucket = await cargarBucket()
    const idx = bucket.findIndex((a) => a.id === actual.id)
    if (idx >= 0 && idx < bucket.length - 1) return { data: mapListado(bucket[idx + 1]) }
    if (o != null) {
      // siguiente bucket (orden_deposito mayor)
      const { data: sig } = await base()
        .gt("orden_deposito", o)
        .order("orden_deposito", { ascending: true, nullsFirst: false })
        .order("descripcion", { ascending: true }).order("id", { ascending: true }).limit(1)
      if (sig && sig[0]) return { data: mapListado(sig[0]) }
      // cola de nulls
      const { data: nulls } = await base()
        .is("orden_deposito", null)
        .order("descripcion", { ascending: true }).order("id", { ascending: true }).limit(1)
      if (nulls && nulls[0]) return { data: mapListado(nulls[0]) }
    }
    return { data: null }
  } else {
    const bucket = await cargarBucket()
    const idx = bucket.findIndex((a) => a.id === actual.id)
    if (idx > 0) return { data: mapListado(bucket[idx - 1]) }
    if (o == null) {
      // antes de la cola de nulls está el último con orden
      const { data } = await base()
        .not("orden_deposito", "is", null)
        .order("orden_deposito", { ascending: false }).order("descripcion", { ascending: false }).order("id", { ascending: false }).limit(1)
      if (data && data[0]) return { data: mapListado(data[0]) }
    } else {
      const { data } = await base()
        .lt("orden_deposito", o)
        .order("orden_deposito", { ascending: false }).order("descripcion", { ascending: false }).order("id", { ascending: false }).limit(1)
      if (data && data[0]) return { data: mapListado(data[0]) }
    }
    return { data: null }
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
