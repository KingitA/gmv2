import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { fetchAllRows } from "@/lib/supabase/fetch-all"

// GET /api/vendedor/comisiones?tipo=cobrada|vendida
// Comisiones del vendedor. REGLA DE ORO: el vendedor solo ve plata que
// efectivamente va a cobrar (netos). El monto pactado vive en el kardex
// (comision_viajante_monto, al % con el que se vendió — la config actual del
// vendedor NO pisa ventas viejas) y cuando el comprobante se cobró con
// bonificación contado, la fila trae descuento_financiero_pct: la comisión
// neta es monto × (1 − pct/100).
// - totales:
//   · disponible ("para retirar") = Σ comisiones tipo='cobrada' pagado=false
//     (la tabla ya incluye los débitos negativos del 10% → da neto solo)
//   · retirado = Σ tipo='cobrada' pagado=true
//   · sin_cobrar = devengado desde kardex sin cobrar — ESTIMADO máximo (el
//     10% contado recién se conoce cuando el cliente paga); la UI lo rotula.
// - pedidos: agregado por pedido con comisión NETA por línea.
export async function GET(req: NextRequest) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(req.url)
    const tipo = searchParams.get("tipo") === "vendida" ? "vendida" : "cobrada"

    // Todas las filas de venta con comisión del vendedor (paginado)
    const rows = await fetchAllRows(() =>
      supabase
        .from("kardex")
        .select(
          "id, pedido_id, numero_pedido, cliente_id, fecha, fecha_comprobante_cobrado, articulo_id, subtotal_total, comision_viajante_monto, descuento_financiero_pct, comprobante_cobrado"
        )
        .eq("tipo_movimiento", "venta")
        .not("comision_viajante_monto", "is", null)
        .neq("comision_viajante_monto", 0)
        .eq("pedido_eliminado", false)
        .in("vendedor_id", session.vendedorIds)
    )

    // Comisión neta de una línea: pactada menos el débito por pago contado
    const netoLinea = (k: any) => {
      const bruto = Number(k.comision_viajante_monto || 0)
      const pct = Number(k.descuento_financiero_pct || 0)
      return pct > 0 ? bruto * (1 - pct / 100) : bruto
    }

    // Totales "para retirar" y "retirado" desde la tabla comisiones: es lo que
    // la empresa efectivamente liquida (incluye los débitos negativos del 10%).
    const comisionesRows = await fetchAllRows(() =>
      supabase
        .from("comisiones")
        .select("monto, pagado")
        .eq("tipo", "cobrada")
        .in("viajante_id", session.vendedorIds)
    )
    let disponible = 0
    let retirado = 0
    for (const c of comisionesRows) {
      if (c.pagado) retirado += Number(c.monto || 0)
      else disponible += Number(c.monto || 0)
    }

    // Devengado sin cobrar: estimado máximo desde kardex (el débito contado
    // todavía no se conoce — depende de cómo pague el cliente)
    let sinCobrar = 0
    for (const k of rows) {
      if (!k.comprobante_cobrado) sinCobrar += Number(k.comision_viajante_monto || 0)
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
      total_debito_contado: number
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
          total_debito_contado: 0,
          skus: new Set(),
        })
      }
      const agg = aggMap.get(pid)!
      const bruto = Number(k.comision_viajante_monto ?? 0)
      const neto = netoLinea(k)
      agg.total_monto += Number(k.subtotal_total ?? 0)
      // El número que ve el vendedor es SIEMPRE el neto; el débito va aparte
      // para poder mostrar el porqué ("pactada X − débito 10% = neto").
      agg.total_comision += neto
      agg.total_debito_contado += bruto - neto
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
        total_comision: Math.round(agg.total_comision * 100) / 100,
        total_debito_contado: Math.round(agg.total_debito_contado * 100) / 100,
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
