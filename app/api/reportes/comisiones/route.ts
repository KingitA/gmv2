/**
 * GET /api/reportes/comisiones
 *
 * Reporte de comisiones por vendedor, filtradas por comprobante cobrado.
 * Las comisiones solo son "cobrables" una vez que el comprobante fue saldado.
 *
 * Query params (todos opcionales):
 *   vendedor_id      UUID
 *   desde            YYYY-MM-DD  (fecha del pedido)
 *   hasta            YYYY-MM-DD
 *   solo_cobrables   'true' → solo donde comprobante_cobrado = true
 *   pagado           'true' | 'false'  → filtrar por si la comisión ya fue pagada al vendedor
 *   page             default: 1
 *   per_page         default: 100, max: 500
 */

import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)

    const vendedorId = searchParams.get("vendedor_id")
    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")
    const soloCobrables = searchParams.get("solo_cobrables") === "true"
    const pagadoFilter = searchParams.get("pagado")
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
    const perPage = Math.min(500, Math.max(1, parseInt(searchParams.get("per_page") || "100")))

    // ── Query de comisiones ────────────────────────────────────────────────────
    let query = supabase
      .from("comisiones")
      .select(`
        id, monto, porcentaje, pagado,
        comprobante_cobrado, fecha_comprobante_cobrado,
        viajante_id, pedido_id, comprobante_venta_id,
        pedido:pedidos!comisiones_pedido_id_fkey(
          numero_pedido, fecha, cliente_id,
          cliente:clientes!pedidos_cliente_id_fkey(razon_social)
        ),
        comprobante:comprobante_venta_id(
          tipo_comprobante, numero_comprobante, estado_pago,
          saldo_pendiente, total_factura
        ),
        vendedor:viajante_id(
          email, raw_user_meta_data
        )
      `, { count: "exact" })

    if (vendedorId) query = query.eq("viajante_id", vendedorId)
    if (soloCobrables) query = query.eq("comprobante_cobrado", true)
    if (pagadoFilter !== null) query = query.eq("pagado", pagadoFilter === "true")

    // Filtros por fecha del pedido — join via pedido
    // (Supabase no soporta filtros en joins de forma directa en client SDK;
    //  se filtra en JS después)

    const from = (page - 1) * perPage
    query = query.order("id", { ascending: false }).range(from, from + perPage - 1)

    const { data: comisiones, count, error } = await query
    if (error) throw error

    // Aplicar filtros de fecha en JS
    const filtradas = (comisiones || []).filter((c: any) => {
      const fechaPedido = c.pedido?.fecha?.slice(0, 10)
      if (desde && fechaPedido && fechaPedido < desde) return false
      if (hasta && fechaPedido && fechaPedido > hasta) return false
      return true
    })

    // ── Totales ────────────────────────────────────────────────────────────────
    // Totales completos sin paginación
    let totalesQuery = supabase
      .from("comisiones")
      .select("monto, pagado, comprobante_cobrado")

    if (vendedorId) totalesQuery = totalesQuery.eq("viajante_id", vendedorId)
    if (soloCobrables) totalesQuery = totalesQuery.eq("comprobante_cobrado", true)
    if (pagadoFilter !== null) totalesQuery = totalesQuery.eq("pagado", pagadoFilter === "true")

    const { data: totalesData } = await totalesQuery

    let total_cobrables = 0
    let total_pagado = 0
    let total_pendiente_cobro = 0  // cobrable pero no pagada todavía

    for (const c of totalesData || []) {
      const monto = c.monto || 0
      if (c.comprobante_cobrado && !c.pagado) total_pendiente_cobro += monto
      if (c.pagado) total_pagado += monto
      if (c.comprobante_cobrado) total_cobrables += monto
    }

    // ── Agrupación por vendedor ────────────────────────────────────────────────
    const porVendedor: Record<string, any> = {}
    for (const c of totalesData || []) {
      const vid = (c as any).viajante_id || "sin_vendedor"
      if (!porVendedor[vid]) {
        porVendedor[vid] = { viajante_id: vid, total: 0, cobrable: 0, pagado: 0, pendiente: 0 }
      }
      porVendedor[vid].total += c.monto || 0
      if (c.comprobante_cobrado) porVendedor[vid].cobrable += c.monto || 0
      if (c.pagado) porVendedor[vid].pagado += c.monto || 0
      if (c.comprobante_cobrado && !c.pagado) porVendedor[vid].pendiente += c.monto || 0
    }

    return NextResponse.json({
      filas: filtradas,
      pagination: { page, per_page: perPage, total: count || 0 },
      totales: {
        total_cobrables: Math.round(total_cobrables * 100) / 100,
        total_pagado: Math.round(total_pagado * 100) / 100,
        total_pendiente_cobro: Math.round(total_pendiente_cobro * 100) / 100,
      },
      por_vendedor: Object.values(porVendedor),
    })
  } catch (error: any) {
    console.error("[Reportes/Comisiones] Error:", error)
    return NextResponse.json({ error: error.message || "Error generando reporte" }, { status: 500 })
  }
}
