import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const chofer_id = searchParams.get("chofer_id")
    const mes = searchParams.get("mes") // Formato: YYYY-MM

    if (!chofer_id) {
      return NextResponse.json(
        { error: "chofer_id es requerido" },
        { status: 400 }
      )
    }

    // Construir filtro de fecha si se proporciona
    let query = supabase
      .from("viajes")
      .select(`
        id,
        fecha,
        estado,
        dinero_nafta,
        gastos_peon,
        gastos_hotel,
        gastos_adicionales
      `)
      .eq("chofer_id", chofer_id)

    if (mes) {
      const [year, month] = mes.split("-")
      const fechaInicio = `${year}-${month}-01`
      const fechaFin = `${year}-${month}-31`
      query = query.gte("fecha", fechaInicio).lte("fecha", fechaFin)
    }

    const { data: viajes, error: viajesError } = await query

    if (viajesError) {
      console.error("[v0] Error al obtener viajes:", viajesError)
      return NextResponse.json(
        { error: viajesError.message },
        { status: 500 }
      )
    }

    // Calcular métricas
    const total_viajes = viajes?.length || 0
    const viajes_finalizados = viajes?.filter(v => v.estado === "finalizado").length || 0

    // Calcular pernoctadas (viajes con gastos_hotel > 0)
    const pernoctadas = viajes?.filter(v => Number(v.gastos_hotel) > 0).length || 0

    // Calcular kilómetros recorridos
    let kilometros_recorridos = 0
    for (const viaje of viajes || []) {
      const { data: pedidos } = await supabase
        .from("pedidos")
        .select(`
          clientes!inner(
            localidad_id,
            localidades!inner(
              zona_id,
              zonas(kilometros)
            )
          )
        `)
        .eq("viaje_id", viaje.id)

      const kmViaje = pedidos?.reduce((sum, p: any) => {
        const km = p.clientes?.localidades?.zonas?.kilometros || 0
        return sum + Number(km)
      }, 0) || 0

      kilometros_recorridos += kmViaje
    }

    // Calcular total facturado y pedidos entregados
    let total_facturado = 0
    let pedidos_entregados = 0

    for (const viaje of viajes || []) {
      const { data: pedidos } = await supabase
        .from("pedidos")
        .select("estado, total")
        .eq("viaje_id", viaje.id)

      pedidos_entregados += pedidos?.filter(p => p.estado === "entregado").length || 0
      total_facturado += pedidos?.reduce((sum, p) => sum + (Number(p.total) || 0), 0) || 0
    }

    // Calcular total de pagos cobrados
    const { data: pagos } = await supabase
      .from("viajes_pagos")
      .select("monto, viaje_id")
      .in("viaje_id", viajes?.map(v => v.id) || [])

    const total_cobrado = pagos?.reduce((sum, p) => sum + (Number(p.monto) || 0), 0) || 0

    return NextResponse.json(
      {
        periodo: mes || "todos",
        total_viajes,
        viajes_finalizados,
        kilometros_recorridos,
        pernoctadas,
        total_facturado,
        pedidos_entregados,
        total_cobrado,
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error("[v0] Error en GET /api/choferes/estadisticas:", error)
    return NextResponse.json(
      { error: "Error al obtener estadísticas" },
      { status: 500 }
    )
  }
}
