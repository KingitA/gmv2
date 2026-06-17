import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getSaldosCliente } from "@/lib/cuenta-corriente/saldo"

// GET /api/chofer/viaje/[id]/cliente/[clienteId]
// Datos del cliente para la entrega: pedido, comprobantes pendientes, devoluciones del viaje
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; clienteId: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id: viajeId, clienteId } = await params

    // Verificar que el viaje es del chofer
    const { data: viaje } = await supabase
      .from("viajes")
      .select("id, chofer_id, estado")
      .eq("id", viajeId)
      .single()

    if (!viaje || viaje.chofer_id !== auth.user.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    // Pedido del viaje para este cliente
    const { data: pedido } = await supabase
      .from("pedidos")
      .select(`
        id, numero_pedido, fecha, estado, total, bultos, observaciones,
        clientes(nombre, razon_social, direccion, telefono, cuit, condicion_pago)
      `)
      .eq("viaje_id", viajeId)
      .eq("cliente_id", clienteId)
      .maybeSingle()

    // Detalle del pedido (artículos)
    let pedido_detalle: any[] = []
    if (pedido) {
      const { data: detalle } = await supabase
        .from("pedidos_detalle")
        .select(`
          id, cantidad, precio_final, subtotal, es_bonificado,
          articulo_id, articulos(sku, descripcion, unidades_por_bulto)
        `)
        .eq("pedido_id", pedido.id)

      pedido_detalle = detalle || []
    }

    // Comprobantes pendientes del cliente (saldo anterior)
    const { data: comprobantes } = await supabase
      .from("comprobantes_venta")
      .select("id, tipo_comprobante, numero_comprobante, fecha, total_factura, saldo_pendiente")
      .eq("cliente_id", clienteId)
      .gt("saldo_pendiente", 0)
      .order("fecha", { ascending: true })

    // Cobros ya registrados del chofer para este cliente en este viaje
    const { data: pagos_registrados } = await supabase
      .from("pagos_clientes")
      .select("id, monto, estado, created_at")
      .eq("viaje_id", viajeId)
      .eq("cliente_id", clienteId)
      .in("estado", ["pendiente_rendicion", "confirmado"])

    // Devoluciones registradas en este viaje para este cliente
    const { data: devoluciones } = await supabase
      .from("devoluciones")
      .select(`
        id, numero_devolucion, monto_total, estado,
        devoluciones_detalle(
          id, articulo_id, cantidad, precio_venta_original, motivo, es_vendible, condicion,
          articulos(sku, descripcion)
        )
      `)
      .eq("viaje_id", viajeId)
      .eq("cliente_id", clienteId)

    // Doble saldo: real (libro mayor, confirmado) y proyectado (real − pendientes)
    const saldos = await getSaldosCliente(supabase, clienteId)
    const saldo_anterior = saldos.saldo_real
    const total_devuelto = (devoluciones || []).reduce((s, d) => s + Number(d.monto_total), 0)
    const total_cobrado = (pagos_registrados || []).reduce((s, p) => s + Number(p.monto), 0)

    return NextResponse.json({
      cliente: pedido?.clientes || null,
      pedido: pedido
        ? {
            id: pedido.id,
            numero: pedido.numero_pedido,
            fecha: pedido.fecha,
            estado: pedido.estado,
            total: Number(pedido.total),
            bultos: pedido.bultos,
            observaciones: pedido.observaciones,
            detalle: pedido_detalle,
          }
        : null,
      comprobantes_pendientes: comprobantes || [],
      devoluciones: devoluciones || [],
      pagos_registrados: pagos_registrados || [],
      resumen: {
        saldo_anterior,
        saldo_real: saldos.saldo_real,
        saldo_proyectado: saldos.saldo_proyectado,
        pendiente_verificacion: saldos.pendiente_verificacion,
        total_pedido: Number(pedido?.total) || 0,
        total_devuelto,
        total_cobrado,
        total_a_cobrar: saldo_anterior + (Number(pedido?.total) || 0) - total_devuelto,
        ya_cobrado: total_cobrado > 0,
      },
      viaje_estado: viaje.estado,
    })
  } catch (error: any) {
    console.error("[chofer] Error en GET cliente:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
