// Artículos que un cliente COMPRÓ (facturados), con el último precio facturado y
// su comprobante: base de la pantalla de devoluciones del vendedor. Extraído de
// GET /api/vendedor/cliente/[id]/comprados para compartirlo con la réplica móvil.
//
// Cada artículo trae su ORIGEN de devolución (lib/cobranzas/origen-devolucion.ts):
// comprobante, precio neto e IVA del renglón facturado, si ese comprobante llevó
// percepción IVA y si fue cobrado contado — lo que la app necesita para valuar
// una devolución sin señal igual que el servidor (regla del dueño 21/10/2026).

import { origenesComprados } from "@/lib/cobranzas/origen-devolucion"

/** Sin filtrar ni ordenar (la route y la app aplican búsqueda, orden y tope). */
export async function cargarComprados(supabase: any, id: string) {
  const origenes = await origenesComprados(supabase, id)
  if (!origenes.size) return []

  const { data: articulos } = await supabase
    .from("articulos")
    .select("id, sku, ean13, descripcion, imagen_url, unidades_por_bulto")
    .in("id", [...origenes.keys()])

  return (articulos || []).map((a: any) => {
    const o = origenes.get(a.id)!
    return {
      articulo_id: a.id,
      ultimo_precio: o.precio ?? 0,
      ultima_fecha: o.ultima_fecha,
      comprobante_venta_id: o.comprobante_venta_id as string,
      numero_comprobante: o.numero_comprobante || "—",
      tipo_comprobante: o.tipo_comprobante || "",
      cantidad_total: o.cantidad_total,
      bonificado_contado: o.bonificado_contado,
      // Origen de devolución (= OrigenDevolucion)
      fiscal: o.fiscal,
      percepcion_iva: o.percepcion_iva,
      exacto: o.exacto,
      precio: o.precio,
      iva_unitario: o.iva_unitario,
      sku: a.sku,
      ean13: a.ean13,
      descripcion: a.descripcion,
      imagen_url: a.imagen_url,
      unidades_por_bulto: a.unidades_por_bulto,
    }
  })
}
