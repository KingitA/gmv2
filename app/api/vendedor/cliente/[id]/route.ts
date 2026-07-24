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
        "id, nombre, razon_social, cuit, direccion, localidad, localidad_id, provincia, telefono, mail, condicion_iva, condicion_pago, condicion_entrega, metodo_facturacion, vendedor_id, codigo_cliente"
      )
      .eq("id", id)
      .in("vendedor_id", session.vendedorIds)
      .maybeSingle()

    if (!cliente) {
      return NextResponse.json({ error: "Cliente inexistente o no asignado a vos." }, { status: 404 })
    }

    // Auditoría de la ficha (best-effort: requiere la migración
    // 20260707_clientes_auditoria; hasta entonces la query falla y queda null)
    let actualizadoAt: string | null = null
    let actualizadoPorNombre: string | null = null
    const { data: audit } = await supabase
      .from("clientes")
      .select("actualizado_por, actualizado_at")
      .eq("id", id)
      .maybeSingle()
    if (audit?.actualizado_at) actualizadoAt = audit.actualizado_at
    if (audit?.actualizado_por) {
      const { data: perfil } = await supabase
        .from("profiles")
        .select("nombre")
        .eq("id", audit.actualizado_por)
        .maybeSingle()
      actualizadoPorNombre = perfil?.nombre || null
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

    // Devoluciones sin confirmar (todavía no tienen NC/reversa emitida) —
    // la pantalla de cobro las muestra junto al pedido para que el vendedor
    // sepa que ese saldo va a bajar cuando la oficina las procese.
    const { data: devolucionesPendientes } = await supabase
      .from("devoluciones")
      .select("id, numero_devolucion, pedido_id, monto_total, created_at")
      .eq("cliente_id", id)
      .eq("estado", "pendiente")
      .order("created_at", { ascending: false })

    // Vista unificada para la pantalla de cobro: TODOS los pedidos vigentes
    // del cliente con su estado; el front les asocia comprobantes (por
    // pedido_id) y devoluciones. "cobrable" = sin facturar y sin anticipo
    // previo (se puede cobrar el pedido completo como anticipo).
    const pedidosCobro = (pedidosCliente || [])
      .map((p: any) => ({
        id: p.id,
        numero_pedido: p.numero_pedido,
        fecha: p.fecha,
        estado: p.estado,
        total: Number(p.total || 0),
        pago_contado_10: !!p.pago_contado_10,
        anticipo_pago_id: p.anticipo_pago_id || null,
        facturado: pedidosFacturados.has(p.id),
        cobrable: !pedidosFacturados.has(p.id) && !p.anticipo_pago_id && Number(p.total || 0) > 0,
      }))
      .sort((a: any, b: any) => (a.fecha < b.fecha ? 1 : -1))

    return NextResponse.json({
      cliente: {
        ...cliente,
        saldo_actual: Number(saldo?.saldo_actual) || 0,
        actualizado_at: actualizadoAt,
        actualizado_por_nombre: actualizadoPorNombre,
      },
      comprobantes: comprobantes || [],
      pedidos_cobrables: pedidosCobrables,
      pedidos_cobro: pedidosCobro,
      devoluciones_pendientes: devolucionesPendientes || [],
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

// Campos de la ficha que el vendedor puede editar directamente. Todo update
// queda asentado con actualizado_por + actualizado_at (auditoría).
const CAMPOS_EDITABLES = [
  "nombre",
  "razon_social",
  "cuit",
  "direccion",
  "localidad",
  "provincia",
  "telefono",
  "mail",
  "condicion_pago",
  "condicion_entrega",
  "metodo_facturacion",
  "localidad_id",
] as const

// PATCH /api/vendedor/cliente/[id]
// Edita datos de la ficha (whitelist) y/o reasigna el vendedor. Deja
// registrado quién y cuándo modificó (clientes.actualizado_por/_at).
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

    const patch: Record<string, any> = {}

    // Datos de la ficha (solo whitelist)
    for (const campo of CAMPOS_EDITABLES) {
      if (body[campo] !== undefined) {
        const v = typeof body[campo] === "string" ? body[campo].trim() : body[campo]
        patch[campo] = v === "" ? null : v
      }
    }
    if (patch.nombre === null) {
      return NextResponse.json({ error: "El nombre no puede quedar vacío." }, { status: 400 })
    }

    // Reasignación de vendedor (opcional)
    let vendedorDestino: { id: string; nombre: string } | null = null
    if (body.vendedor_id !== undefined) {
      if (!body.vendedor_id || typeof body.vendedor_id !== "string") {
        return NextResponse.json({ error: "vendedor_id inválido." }, { status: 400 })
      }
      const { data: vd } = await supabase
        .from("vendedores")
        .select("id, nombre")
        .eq("id", body.vendedor_id)
        .eq("activo", true)
        .maybeSingle()
      if (!vd) {
        return NextResponse.json({ error: "Vendedor destino inexistente o inactivo." }, { status: 400 })
      }
      vendedorDestino = vd
      patch.vendedor_id = vd.id
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "Nada para actualizar." }, { status: 400 })
    }

    const { error } = await supabase.from("clientes").update(patch).eq("id", id)
    if (error) throw error

    // Sello de auditoría best-effort (requiere migración 20260707_clientes_auditoria;
    // va aparte para no voltear el guardado si la columna todavía no existe)
    await supabase
      .from("clientes")
      .update({ actualizado_por: session.user.id, actualizado_at: new Date().toISOString() })
      .eq("id", id)

    return NextResponse.json({ success: true, ...(vendedorDestino ? { vendedor: vendedorDestino } : {}) })
  } catch (error: any) {
    console.error("[vendedor] Error en PATCH /api/vendedor/cliente/[id]:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
