import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const supabase = await createClient()
    const searchParams = request.nextUrl.searchParams
    const cliente_id = searchParams.get("cliente_id")

    if (!cliente_id) {
      return NextResponse.json({ error: "Se requiere cliente_id" }, { status: 400 })
    }

    // Obtener comprobantes de venta
    const { data: comprobantes, error: comprobantesError } = await supabase
      .from("comprobantes_venta")
      .select("*")
      .eq("cliente_id", cliente_id)
      .order("fecha", { ascending: false })

    if (comprobantesError) throw comprobantesError

    // Obtener pagos de clientes (nuevos, desde CRM)
    const { data: pagosClientes, error: pagosClientesError } = await supabase
      .from("pagos_clientes")
      .select("*")
      .eq("cliente_id", cliente_id)
      .order("fecha_pago", { ascending: false })

    if (pagosClientesError) throw pagosClientesError

    // Saldo total = fuente única: libro mayor (vista v_saldo_clientes = Σdebe − Σhaber)
    const { data: saldoRow } = await supabase
      .from("v_saldo_clientes")
      .select("saldo_actual")
      .eq("cliente_id", cliente_id)
      .maybeSingle()
    const saldoTotal = Number(saldoRow?.saldo_actual ?? 0)

    // Extracto (libro mayor) para la UI
    const { data: movimientos } = await supabase
      .from("cuenta_corriente_clientes")
      .select("fecha, tipo_movimiento, debe, haber, numero_comprobante, observaciones, referencia_tipo, referencia_id")
      .eq("cliente_id", cliente_id)
      .order("fecha", { ascending: false })

    // Separar comprobantes por estado
    const hoy = todayArgentina()
    const comprobantesVencidos =
      comprobantes?.filter((c) => c.saldo_pendiente > 0 && c.fecha_vencimiento && c.fecha_vencimiento < hoy) || []
    const comprobantesPendientes =
      comprobantes?.filter((c) => c.saldo_pendiente > 0 && (!c.fecha_vencimiento || c.fecha_vencimiento >= hoy)) || []
    const comprobantesPagados = comprobantes?.filter((c) => c.saldo_pendiente === 0) || []

    // Obtener pedidos del cliente
    const { data: pedidos, error: pedidosError } = await supabase
      .from("pedidos")
      .select(`
        *,
        pedidos_detalle (
          *,
          articulos (
            descripcion,
            sku
          )
        )
      `)
      .eq("cliente_id", cliente_id)
      .order("fecha", { ascending: false })

    if (pedidosError) throw pedidosError

    return NextResponse.json({
      success: true,
      cuenta_corriente: {
        saldo_total: saldoTotal,
        comprobantes_vencidos: comprobantesVencidos,
        comprobantes_pendientes: comprobantesPendientes,
        comprobantes_pagados: comprobantesPagados,
        pagos_clientes: pagosClientes,
        pedidos: pedidos,
        movimientos: movimientos || [],
      },
    })
  } catch (error: any) {
    console.error("[v0] Error obteniendo cuenta corriente:", error)
    return NextResponse.json({ error: error.message || "Error obteniendo cuenta corriente" }, { status: 500 })
  }
}
