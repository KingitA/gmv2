import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/cliente/[id]
// Ficha del cliente + cuenta corriente: comprobantes con saldo pendiente
// (FIFO) y pagos recientes con su estado de doble firma.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { id } = await params

    const { data: cliente } = await supabase
      .from("clientes")
      .select(
        "id, nombre, razon_social, cuit, direccion, localidad, provincia, telefono, mail, condicion_iva, condicion_pago, condicion_entrega, metodo_facturacion, vendedor_id, codigo_cliente"
      )
      .eq("id", id)
      .in("vendedor_id", session.vendedorIds)
      .maybeSingle()

    if (!cliente) {
      return NextResponse.json({ error: "Cliente inexistente o no asignado a vos." }, { status: 404 })
    }

    const { data: saldo } = await supabase
      .from("v_saldo_clientes")
      .select("saldo_actual")
      .eq("cliente_id", id)
      .maybeSingle()

    // Comprobantes con saldo pendiente, más viejos primero (FIFO)
    const { data: comprobantes } = await supabase
      .from("comprobantes_venta")
      .select(
        "id, tipo_comprobante, numero_comprobante, fecha, total_factura, saldo_pendiente, estado_pago, pedido_id, pedido:pedido_id(numero_pedido)"
      )
      .eq("cliente_id", id)
      .gt("saldo_pendiente", 0)
      .in("estado_pago", ["pendiente", "parcial"])
      .order("fecha", { ascending: true })

    // Pedidos cobrables sin facturar (anticipo, mismo criterio que el ERP):
    // sin comprobantes emitidos, sin anticipo previo, y ya confirmados (no en_venta)
    const { data: pedidosCliente } = await supabase
      .from("pedidos")
      .select("id, numero_pedido, fecha, estado, total, pago_contado_10, anticipo_pago_id")
      .eq("cliente_id", id)
      .is("eliminado_at", null)
      .not("estado", "in", "(eliminado,en_venta)")
      .order("fecha", { ascending: true })

    const { data: compsDePedidos } = await supabase
      .from("comprobantes_venta")
      .select("pedido_id")
      .eq("cliente_id", id)
      .not("pedido_id", "is", null)
    const pedidosFacturados = new Set((compsDePedidos || []).map((c: any) => c.pedido_id))

    const pedidosCobrables = (pedidosCliente || []).filter(
      (p: any) => !pedidosFacturados.has(p.id) && !p.anticipo_pago_id && Number(p.total || 0) > 0
    )

    const { data: pagosRecientes } = await supabase
      .from("pagos_clientes")
      .select("id, fecha_pago, monto, estado, forma_pago, confirmado_por")
      .eq("cliente_id", id)
      .order("fecha_pago", { ascending: false })
      .limit(10)

    return NextResponse.json({
      cliente: { ...cliente, saldo_actual: Number(saldo?.saldo_actual) || 0 },
      comprobantes: comprobantes || [],
      pedidos_cobrables: pedidosCobrables,
      pagos_recientes: (pagosRecientes || []).map((p) => ({
        ...p,
        verificado: p.estado === "confirmado" && !!p.confirmado_por,
      })),
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/cliente/[id]:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH /api/vendedor/cliente/[id]
// Campos editables por el vendedor desde la ficha. Por ahora: reasignar
// el cliente a cualquier otro vendedor (clientes.vendedor_id).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { id } = await params
    const body = await request.json()

    const { data: cliente } = await supabase
      .from("clientes")
      .select("id")
      .eq("id", id)
      .in("vendedor_id", session.vendedorIds)
      .maybeSingle()

    if (!cliente) {
      return NextResponse.json({ error: "Cliente inexistente o no asignado a vos." }, { status: 404 })
    }

    if (!body.vendedor_id || typeof body.vendedor_id !== "string") {
      return NextResponse.json({ error: "Se requiere vendedor_id." }, { status: 400 })
    }

    const { data: vendedorDestino } = await supabase
      .from("vendedores")
      .select("id, nombre")
      .eq("id", body.vendedor_id)
      .eq("activo", true)
      .maybeSingle()

    if (!vendedorDestino) {
      return NextResponse.json({ error: "Vendedor destino inexistente o inactivo." }, { status: 400 })
    }

    const { error } = await supabase
      .from("clientes")
      .update({ vendedor_id: vendedorDestino.id })
      .eq("id", id)

    if (error) throw error

    return NextResponse.json({ success: true, vendedor: vendedorDestino })
  } catch (error: any) {
    console.error("[vendedor] Error en PATCH /api/vendedor/cliente/[id]:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
