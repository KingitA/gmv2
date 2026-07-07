import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

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

    let q = supabase
      .from("kardex")
      .select(
        "id, articulo_id, articulo_sku, articulo_descripcion, articulo_categoria, cantidad, subtotal_total, precio_unitario_final, comision_viajante_pct, comision_viajante_monto, comprobante_venta_id, fecha_comprobante_cobrado, comprobante_cobrado"
      )
      .eq("pedido_id", pedidoId)
      .eq("tipo_movimiento", "venta")
      .not("comision_viajante_monto", "is", null)
      .neq("comision_viajante_monto", 0)
      .eq("pedido_eliminado", false)
      .in("vendedor_id", session.vendedorIds)
    if (tipo === "cobrada") q = q.eq("comprobante_cobrado", true)

    const { data: rows, error } = await q
    if (error) throw error

    const mapArticulo = (r: any) => ({
      kardex_id: r.id,
      articulo_id: r.articulo_id,
      sku: r.articulo_sku ?? "—",
      descripcion: r.articulo_descripcion ?? r.articulo_id ?? "—",
      categoria: r.articulo_categoria ?? "—",
      cantidad: Number(r.cantidad ?? 0),
      precio_unitario: Number(r.precio_unitario_final ?? 0),
      subtotal: Number(r.subtotal_total ?? 0),
      comision_pct: Number(r.comision_viajante_pct ?? 0),
      comision_monto: Number(r.comision_viajante_monto ?? 0),
    })

    if (tipo === "vendida") {
      return NextResponse.json({ tipo, articulos: (rows || []).map(mapArticulo) })
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

    const grupos = new Map<string, any>()
    for (const r of rows || []) {
      const cid = r.comprobante_venta_id ?? "sin_comprobante"
      if (!grupos.has(cid)) {
        const comp = compMap.get(cid)
        grupos.set(cid, {
          comprobante_id: cid,
          numero: comp ? `${comp.tipo_comprobante} ${comp.numero_comprobante}` : "—",
          fecha_cobro: r.fecha_comprobante_cobrado?.slice(0, 10) ?? "",
          total_neto: Number(comp?.total_neto ?? 0),
          total_iva: Number(comp?.total_iva ?? 0),
          total: Number(comp?.total_factura ?? 0),
          total_comision: 0,
          articulos: [],
        })
      }
      const g = grupos.get(cid)!
      const art = mapArticulo(r)
      g.total_comision += art.comision_monto
      g.articulos.push(art)
    }

    return NextResponse.json({ tipo, comprobantes: [...grupos.values()] })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/comisiones/detalle:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
