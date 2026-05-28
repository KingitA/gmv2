import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// GET /api/chofer/viaje/[id]
// Retorna el viaje con sus pedidos, estado de cobro por cliente, y resumen
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id } = await params

    // Verificar que el viaje pertenece a este chofer
    const { data: viaje, error: viajeError } = await supabase
      .from("viajes")
      .select(`
        id, nombre, fecha, estado, vehiculo, chofer_id,
        dinero_nafta, gastos_peon, gastos_hotel, gastos_adicionales,
        observaciones, zona_id, zonas(nombre)
      `)
      .eq("id", id)
      .single()

    if (viajeError || !viaje) {
      return NextResponse.json({ error: "Viaje no encontrado" }, { status: 404 })
    }

    // Chofer solo puede ver sus propios viajes
    if (viaje.chofer_id !== auth.user.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    // Pedidos del viaje con datos del cliente
    const { data: pedidos } = await supabase
      .from("pedidos")
      .select(`
        id, numero_pedido, fecha, estado, total, bultos, cliente_id,
        clientes(nombre, razon_social, direccion, telefono,
          localidad_id, localidades(nombre))
      `)
      .eq("viaje_id", id)
      .order("prioridad", { ascending: true })

    // Pagos pendiente_rendicion de este viaje (cobros del chofer)
    const { data: pagosViaje } = await supabase
      .from("pagos_clientes")
      .select("id, cliente_id, monto, estado, forma_pago")
      .eq("viaje_id", id)
      .in("estado", ["pendiente_rendicion", "confirmado"])

    // Devoluciones pendientes de este viaje
    const { data: devolucionesViaje } = await supabase
      .from("devoluciones")
      .select("id, cliente_id, monto_total, estado, numero_devolucion")
      .eq("viaje_id", id)

    const pagosPorCliente = new Map<string, number>()
    for (const p of pagosViaje || []) {
      pagosPorCliente.set(p.cliente_id, (pagosPorCliente.get(p.cliente_id) || 0) + Number(p.monto))
    }

    const devolucionesPorCliente = new Map<string, number>()
    for (const d of devolucionesViaje || []) {
      devolucionesPorCliente.set(d.cliente_id, (devolucionesPorCliente.get(d.cliente_id) || 0) + Number(d.monto_total))
    }

    const pedidosConDatos = await Promise.all(
      (pedidos || []).map(async (pedido: any) => {
        // Saldo previo: comprobantes pendientes de otros pedidos
        const { data: comprobantes } = await supabase
          .from("comprobantes_venta")
          .select("saldo_pendiente")
          .eq("cliente_id", pedido.cliente_id)
          .neq("pedido_id", pedido.id)
          .gt("saldo_pendiente", 0)

        const saldo_anterior = comprobantes?.reduce((s, c) => s + Number(c.saldo_pendiente), 0) || 0

        const cobrado = pagosPorCliente.get(pedido.cliente_id) || 0
        const devuelto = devolucionesPorCliente.get(pedido.cliente_id) || 0

        let estadoEntrega = "pendiente"
        if (cobrado > 0) estadoEntrega = "cobrado"
        else if (devuelto > 0) estadoEntrega = "devolucion_registrada"

        return {
          id: pedido.id,
          numero: pedido.numero_pedido,
          fecha: pedido.fecha,
          estado: pedido.estado,
          estado_entrega: estadoEntrega,
          cliente_id: pedido.cliente_id,
          cliente_nombre: pedido.clientes?.razon_social || pedido.clientes?.nombre || "Sin nombre",
          direccion: pedido.clientes?.direccion || "",
          telefono: pedido.clientes?.telefono || "",
          localidad: pedido.clientes?.localidades?.nombre || "",
          bultos: pedido.bultos || 0,
          total_pedido: Number(pedido.total) || 0,
          saldo_anterior,
          total_a_cobrar: saldo_anterior + (Number(pedido.total) || 0),
          cobrado,
          devuelto,
        }
      })
    )

    // Gastos del chofer en este viaje desde billetera
    const { data: gastos } = await supabase
      .from("billetera_movimientos")
      .select("monto, concepto, fecha")
      .eq("viajante_id", auth.user.id)
      .eq("tipo", "debito")
      .eq("referencia_tipo", "viaje")
      .eq("referencia_id", id)

    const total_gastos = gastos?.reduce((s, g) => s + Math.abs(Number(g.monto)), 0) || 0
    const total_cobrado = Array.from(pagosPorCliente.values()).reduce((s, v) => s + v, 0)

    return NextResponse.json({
      viaje: {
        ...viaje,
        zona_nombre: (viaje as any).zonas?.nombre || "",
      },
      pedidos: pedidosConDatos,
      resumen: {
        total_pedidos: pedidosConDatos.length,
        total_a_cobrar: pedidosConDatos.reduce((s, p) => s + p.total_a_cobrar, 0),
        total_cobrado,
        total_gastos,
        efectivo_neto: total_cobrado - total_gastos,
        pendientes: pedidosConDatos.filter(p => p.estado_entrega === "pendiente").length,
        cobrados: pedidosConDatos.filter(p => p.estado_entrega === "cobrado").length,
      },
    })
  } catch (error: any) {
    console.error("[chofer] Error en GET /api/chofer/viaje/[id]:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
