import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { getPrecioNeto } from "@/lib/comisiones/calcular"

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

    // REGLA DE ORO: el número que ve el vendedor es el NETO que va a cobrar.
    // Si el comprobante se cobró con bonificación contado, la línea trae
    // descuento_financiero_pct y la comisión neta = pactada × (1 − pct/100).
    // La pactada y el débito viajan aparte para explicar el porqué.
    // PRECIOS SIN IVA: la comisión se calcula sobre el neto, así que precio
    // unitario y subtotal se muestran netos para que % × precio = comisión
    // cierre a ojo. Con IVA incluido, un 5% sobre $1.000 mostraría $41,32 y
    // parecería mal calculado. Se usa la MISMA base que el motor de comisiones
    // (getPrecioNeto): subtotal_neto, y en presupuesto de artículo blanco
    // además se le quita el IVA implícito (÷1,21).
    const mapArticulo = (r: any) => {
      const pactada = Number(r.comision_viajante_monto ?? 0)
      const descPct = Number(r.descuento_financiero_pct ?? 0)
      const neta = descPct > 0 ? Math.round(pactada * (1 - descPct / 100) * 100) / 100 : pactada
      const cantidad = Number(r.cantidad ?? 0)
      const subtotalNeto = Math.round(getPrecioNeto(Number(r.subtotal_neto ?? 0), r.metodo_facturacion, r.articulo_iva_ventas) * 100) / 100
      return {
        kardex_id: r.id,
        articulo_id: r.articulo_id,
        sku: r.articulo_sku ?? "—",
        descripcion: r.articulo_descripcion ?? r.articulo_id ?? "—",
        categoria: r.articulo_categoria ?? "—",
        cantidad,
        precio_unitario: cantidad > 0 ? Math.round((subtotalNeto / cantidad) * 100) / 100 : 0,
        subtotal: subtotalNeto,
        comision_pct: Number(r.comision_viajante_pct ?? 0),
        comision_monto: neta, // neto: lo que efectivamente cobra
        comision_pactada: pactada,
        descuento_financiero_pct: descPct,
      }
    }

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
          debito_contado: 0,
          articulos: [],
        })
      }
      const g = grupos.get(cid)!
      const art = mapArticulo(r)
      g.total_comision += art.comision_monto
      g.debito_contado += art.comision_pactada - art.comision_monto
      g.articulos.push(art)
    }

    for (const g of grupos.values()) {
      g.total_comision = Math.round(g.total_comision * 100) / 100
      g.debito_contado = Math.round(g.debito_contado * 100) / 100
    }

    return NextResponse.json({ tipo, comprobantes: [...grupos.values()] })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/comisiones/detalle:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
