// Artículos que un cliente COMPRÓ (facturados), con el último precio facturado y
// su comprobante: base de la pantalla de devoluciones del vendedor. Extraído de
// GET /api/vendedor/cliente/[id]/comprados para compartirlo con la réplica móvil.

import { fetchAllRows } from "@/lib/supabase/fetch-all"

/** Sin filtrar ni ordenar (la route y la app aplican búsqueda, orden y tope). */
export async function cargarComprados(supabase: any, id: string) {
  // Líneas facturadas del cliente (excluye NC/REV: solo lo que se le vendió)
  const rows = await fetchAllRows(() =>
    supabase
      .from("comprobantes_venta_detalle")
      .select(
        "articulo_id, cantidad, precio_unitario, comprobante:comprobante_venta_id!inner(id, cliente_id, fecha, tipo_comprobante, numero_comprobante, anulado_en)"
      )
      .eq("comprobante.cliente_id", id)
      .in("comprobante.tipo_comprobante", ["FA", "FB", "FC", "PRES"])
      .is("comprobante.anulado_en", null)
  )

  // Última factura por artículo + cantidad acumulada
  type Compra = {
    articulo_id: string
    ultimo_precio: number
    ultima_fecha: string
    comprobante_venta_id: string
    numero_comprobante: string
    tipo_comprobante: string
    cantidad_total: number
  }
  const porArticulo = new Map<string, Compra>()
  for (const r of rows as any[]) {
    if (!r.articulo_id) continue
    const fecha = r.comprobante?.fecha || ""
    const actual = porArticulo.get(r.articulo_id)
    if (!actual || fecha > actual.ultima_fecha) {
      porArticulo.set(r.articulo_id, {
        articulo_id: r.articulo_id,
        ultimo_precio: Number(r.precio_unitario || 0),
        ultima_fecha: fecha,
        comprobante_venta_id: r.comprobante?.id,
        numero_comprobante: r.comprobante?.numero_comprobante || "—",
        tipo_comprobante: r.comprobante?.tipo_comprobante || "",
        cantidad_total: (actual?.cantidad_total || 0) + Number(r.cantidad || 0),
      })
    } else {
      actual.cantidad_total += Number(r.cantidad || 0)
    }
  }

  if (!porArticulo.size) return []

  const { data: articulos } = await supabase
    .from("articulos")
    .select("id, sku, ean13, descripcion, imagen_url, unidades_por_bulto")
    .in("id", [...porArticulo.keys()])

  return (articulos || []).map((a: any) => ({
    ...porArticulo.get(a.id)!,
    sku: a.sku,
    ean13: a.ean13,
    descripcion: a.descripcion,
    imagen_url: a.imagen_url,
    unidades_por_bulto: a.unidades_por_bulto,
  }))
}
