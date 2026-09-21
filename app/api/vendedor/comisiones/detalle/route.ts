import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { agruparPorComprobante, mapArticuloComision } from "@/lib/vendedor/comisiones-detalle"

// GET /api/vendedor/comisiones/detalle?pedido_id=&tipo=cobrada|vendida
// Drill-down de un pedido: artículos con precio, % comisión y comisión.
// En "cobrada" agrupa por comprobante (mismo formato que el playroom).
export async function GET(req: NextRequest) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(req.url)
    const pedidoId = searchParams.get("pedido_id")
    const tipo = searchParams.get("tipo") === "vendida" ? "vendida" : "cobrada"

    if (!pedidoId) {
      return NextResponse.json({ error: "pedido_id requerido" }, { status: 400 })
    }

    const rows = await fetchAllRows(() => {
      let q = supabase
        .from("kardex")
        .select(
          "id, articulo_id, articulo_sku, articulo_descripcion, articulo_categoria, cantidad, subtotal_neto, metodo_facturacion, articulo_iva_ventas, comision_viajante_pct, comision_viajante_monto, descuento_financiero_pct, comprobante_venta_id, fecha_comprobante_cobrado, comprobante_cobrado"
        )
        .eq("pedido_id", pedidoId)
        .eq("tipo_movimiento", "venta")
        .not("comision_viajante_monto", "is", null)
        .neq("comision_viajante_monto", 0)
        .eq("pedido_eliminado", false)
        .in("vendedor_id", session.vendedorIds)
      if (tipo === "cobrada") q = q.eq("comprobante_cobrado", true)
      return q
    })

    if (tipo === "vendida") {
      return NextResponse.json({ tipo, articulos: (rows || []).map(mapArticuloComision) })
    }

    // cobrada: agrupar por comprobante
    const compIds = [...new Set((rows || []).map((r) => r.comprobante_venta_id).filter(Boolean))] as string[]
    const compMap = new Map<string, any>()
    if (compIds.length) {
      const { data: comps } = await supabase
        .from("comprobantes_venta")
        .select("id, numero_comprobante, tipo_comprobante, total_neto, total_iva, total_factura")
        .in("id", compIds)
      for (const c of comps || []) compMap.set(c.id, c)
    }

    return NextResponse.json({ tipo, comprobantes: agruparPorComprobante(rows || [], compMap) })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/comisiones/detalle:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
