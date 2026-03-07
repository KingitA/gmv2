import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const supabase = await createClient()
    const { id } = await params

    const { data: viaje, error: viajeError } = await supabase
      .from("viajes")
      .select(`
        id,
        nombre,
        fecha,
        estado,
        vehiculo,
        chofer_id,
        dinero_nafta,
        gastos_peon,
        gastos_hotel,
        gastos_adicionales,
        observaciones
      `)
      .eq("id", id)
      .single()

    if (viajeError || !viaje) {
      return NextResponse.json(
        { error: "Viaje no encontrado" },
        { status: 404 }
      )
    }

    let choferNombre = "Sin asignar"
    let choferEmail = ""
    if (viaje.chofer_id) {
      const { data: chofer } = await supabase
        .from('usuarios')
        .select('nombre, email')
        .eq('id', viaje.chofer_id)
        .single()

      if (chofer) {
        choferNombre = chofer.nombre
        choferEmail = chofer.email
      }
    }

    // Obtener pedidos del viaje
    const { data: pedidos, error: pedidosError } = await supabase
      .from("pedidos")
      .select(`
        id,
        numero_pedido,
        fecha,
        estado,
        total,
        bultos,
        cliente_id,
        clientes!inner(
          razon_social,
          direccion,
          telefono,
          localidad_id,
          localidades(nombre)
        )
      `)
      .eq("viaje_id", id)
      .order("prioridad", { ascending: true })

    if (pedidosError) {
      console.error("[v0] Error al obtener pedidos:", pedidosError)
      return NextResponse.json(
        { error: pedidosError.message },
        { status: 500 }
      )
    }

    // Para cada pedido, calcular bultos y saldos
    const pedidosConDatos = await Promise.all(
      pedidos.map(async (pedido: any) => {
        const bultos = pedido.bultos || 0

        // Calcular saldo anterior (comprobantes pendientes previos a este pedido)
        const { data: comprobantes } = await supabase
          .from("comprobantes_venta")
          .select("saldo_pendiente")
          .eq("cliente_id", pedido.cliente_id)
          .neq("pedido_id", pedido.id)
          .gt("saldo_pendiente", 0)

        const saldo_anterior =
          comprobantes?.reduce(
            (sum, c) => sum + (Number(c.saldo_pendiente) || 0),
            0
          ) || 0

        return {
          id: pedido.id,
          numero: pedido.numero_pedido,
          fecha: pedido.fecha,
          estado: pedido.estado,
          cliente_nombre: pedido.clientes?.razon_social || "Sin nombre",
          direccion: pedido.clientes?.direccion || "Sin dirección",
          telefono: pedido.clientes?.telefono || "",
          localidad:
            pedido.clientes?.localidades?.nombre || "Sin localidad",
          bultos,
          saldo_anterior,
          saldo_actual: Number(pedido.total) || 0,
          total: (saldo_anterior + Number(pedido.total)) || 0,
        }
      })
    )

    // Obtener resumen de pagos del viaje
    const { data: pagos } = await supabase
      .from("viajes_pagos")
      .select("forma_pago, monto")
      .eq("viaje_id", id)

    const resumen_pagos = {
      total_efectivo:
        pagos
          ?.filter((p) => p.forma_pago === "efectivo")
          .reduce((sum, p) => sum + (Number(p.monto) || 0), 0) || 0,
      cantidad_cheques:
        pagos?.filter((p) => p.forma_pago === "cheque").length || 0,
      cantidad_transferencias:
        pagos?.filter((p) => p.forma_pago === "transferencia").length || 0,
      total_cobrado:
        pagos?.reduce((sum, p) => sum + (Number(p.monto) || 0), 0) || 0,
    }

    return NextResponse.json(
      {
        viaje: {
          ...viaje,
          chofer_nombre: choferNombre,
          chofer_email: choferEmail,
        },
        pedidos: pedidosConDatos,
        resumen_pagos,
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error("[v0] Error en GET /api/viajes/[id]:", error)
    return NextResponse.json(
      { error: "Error al obtener viaje" },
      { status: 500 }
    )
  }
}
