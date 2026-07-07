import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/comisiones?tipo=cobrada|vendida
// Comisiones REALES del vendedor desde kardex (misma fuente que el playroom):
// - totales: disponible (mercadería cobrada, comisión sin retirar), sin_cobrar
//   (devengada, cliente aún no pagó), retirado (comisión ya pagada)
// - pedidos: agregado por pedido (monto, comisión, SKUs) según el toggle
export async function GET(req: NextRequest) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(req.url)
    const tipo = searchParams.get("tipo") === "vendida" ? "vendida" : "cobrada"

    // Todas las filas de venta con comisión del vendedor (paginado)
    const PAGE = 1000
    const rows: any[] = []
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await supabase
        .from("kardex")
        .select(
          "id, pedido_id, numero_pedido, cliente_id, fecha, fecha_comprobante_cobrado, articulo_id, subtotal_total, comision_viajante_monto, comprobante_cobrado"
        )
        .eq("tipo_movimiento", "venta")
        .not("comision_viajante_monto", "is", null)
        .neq("comision_viajante_monto", 0)
        .eq("pedido_eliminado", false)
        .in("vendedor_id", session.vendedorIds)
        .range(from, from + PAGE - 1)
      if (error) throw error
      rows.push(...(page || []))
      if (!page || page.length < PAGE) break
    }

    // Estado de pago de cada comisión (tabla comisiones, por kardex_id)
    const pagadoPorKardex = new Map<string, boolean>()
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await supabase
        .from("comisiones")
        .select("kardex_id, pagado")
        .in("viajante_id", session.vendedorIds)
        .range(from, from + PAGE - 1)
      if (error) throw error
      for (const c of page || []) if (c.kardex_id) pagadoPorKardex.set(c.kardex_id, !!c.pagado)
      if (!page || page.length < PAGE) break
    }

    // Totales sobre TODO el historial
    let disponible = 0
    let sinCobrar = 0
    let retirado = 0
    for (const k of rows) {
      const monto = Number(k.comision_viajante_monto || 0)
      const pagado = pagadoPorKardex.get(k.id) === true
      if (pagado) retirado += monto
      else if (k.comprobante_cobrado) disponible += monto
      else sinCobrar += monto
    }

    // Lista de pedidos según el toggle (formato playroom)
    const visibles = tipo === "cobrada" ? rows.filter((k) => k.comprobante_cobrado) : rows
    type Agg = {
      pedido_id: string
      numero_pedido: string
      cliente_id: string | null
      fecha: string
      fecha_cobro: string | null
      total_monto: number
      total_comision: number
      skus: Set<string>
    }
    const aggMap = new Map<string, Agg>()
    for (const k of visibles) {
      const pid = k.pedido_id ?? "sin_pedido"
      if (!aggMap.has(pid)) {
        aggMap.set(pid, {
          pedido_id: pid,
          numero_pedido: k.numero_pedido ?? "—",
          cliente_id: k.cliente_id,
          fecha: k.fecha?.slice(0, 10) ?? "",
          fecha_cobro: k.fecha_comprobante_cobrado?.slice(0, 10) ?? null,
          total_monto: 0,
          total_comision: 0,
          skus: new Set(),
        })
      }
      const agg = aggMap.get(pid)!
      agg.total_monto += Number(k.subtotal_total ?? 0)
      agg.total_comision += Number(k.comision_viajante_monto ?? 0)
      if (k.articulo_id) agg.skus.add(k.articulo_id)
    }

    const clienteIds = [...new Set([...aggMap.values()].map((a) => a.cliente_id).filter(Boolean))] as string[]
    const clienteMap = new Map<string, string>()
    if (clienteIds.length) {
      const { data: clientes } = await supabase
        .from("clientes")
        .select("id, nombre_razon_social, nombre")
        .in("id", clienteIds)
      for (const c of clientes || []) clienteMap.set(c.id, c.nombre_razon_social ?? c.nombre ?? c.id)
    }

    const pedidos = [...aggMap.values()]
      .map((agg) => ({
        pedido_id: agg.pedido_id,
        numero_pedido: agg.numero_pedido,
        cliente_id: agg.cliente_id,
        cliente_nombre: clienteMap.get(agg.cliente_id ?? "") ?? "—",
        fecha: agg.fecha,
        fecha_cobro: agg.fecha_cobro,
        total_monto: agg.total_monto,
        total_comision: agg.total_comision,
        cantidad_skus: agg.skus.size,
      }))
      .sort((a, b) => (b.fecha_cobro || b.fecha).localeCompare(a.fecha_cobro || a.fecha))

    return NextResponse.json({
      tipo,
      totales: { disponible, sin_cobrar: sinCobrar, retirado },
      pedidos,
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/comisiones:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
