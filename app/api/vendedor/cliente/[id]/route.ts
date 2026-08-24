import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor, listaDelViajante } from "@/lib/vendedor/session"
import { disponibleDePago } from "@/lib/cuenta-corriente/pago-disponible"
import { repreciarPedidosAbiertosCliente } from "@/lib/actions/pedidos"

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
        "id, nombre, razon_social, cuit, direccion, localidad, localidad_id, provincia, telefono, mail, condicion_iva, condicion_pago, condicion_entrega, metodo_facturacion, vendedor_id, codigo_cliente, lista_precio_id, lista:lista_precio_id(nombre)"
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
      // Un comprobante anulado no se cobra (su NC inversa lo cancela)
      .is("anulado_en", null)
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

    // ── PLATA A FAVOR del cliente (el vendedor debe verla al cobrar: sin esto
    // podría cobrar la deuda bruta cuando el cliente tiene crédito) ──
    // a) Créditos documento vivos: NC/REV con saldo disponible
    const { data: creditosVivos } = await supabase
      .from("comprobantes_venta")
      .select("id, tipo_comprobante, numero_comprobante, fecha, saldo_pendiente")
      .eq("cliente_id", id)
      .lt("saldo_pendiente", -0.005)
      .is("anulado_en", null)
      .neq("estado_pago", "anulado")
      .order("fecha", { ascending: true })

    // b) Entregas a cuenta: pagos confirmados sin imputar (fórmula única)
    const { data: pagosConfirmados } = await supabase
      .from("pagos_clientes")
      .select("id, monto, fecha_pago")
      .eq("cliente_id", id)
      .eq("estado", "confirmado")
    const confIds = (pagosConfirmados || []).map((p: any) => p.id)
    const impsPorPagoConf = new Map<string, any[]>()
    if (confIds.length) {
      const { data: impsConf } = await supabase
        .from("imputaciones")
        .select("pago_id, monto_imputado, estado, comprobante:comprobantes_venta!imputaciones_comprobante_id_fkey(tipo_comprobante)")
        .in("pago_id", confIds)
      for (const i of impsConf || []) {
        if (!impsPorPagoConf.has(i.pago_id)) impsPorPagoConf.set(i.pago_id, [])
        impsPorPagoConf.get(i.pago_id)!.push(i)
      }
    }
    const aCuenta = (pagosConfirmados || [])
      .map((p: any) => ({
        pago_id: p.id,
        fecha: p.fecha_pago,
        disponible: disponibleDePago(
          p.monto,
          (impsPorPagoConf.get(p.id) || []).map((i: any) => ({
            monto_imputado: i.monto_imputado,
            estado: i.estado,
            tipo_comprobante_destino: (i.comprobante as any)?.tipo_comprobante ?? null,
          })),
        ),
      }))
      .filter((p: any) => p.disponible > 0.005)
    const totalAFavor = Math.round((
      (creditosVivos || []).reduce((s: number, c: any) => s + Math.abs(Number(c.saldo_pendiente)), 0)
      + aCuenta.reduce((s: number, p: any) => s + p.disponible, 0)
    ) * 100) / 100

    // Devoluciones sin confirmar (todavía no tienen NC/reversa emitida), con
    // cuánto ya se descontó en cobros anteriores (se puede descontar parcial).
    const { data: devolucionesPendientes } = await supabase
      .from("devoluciones")
      .select("id, numero_devolucion, pedido_id, monto_total, created_at")
      .eq("cliente_id", id)
      .eq("estado", "pendiente")
      .order("created_at", { ascending: false })

    const devIds = (devolucionesPendientes || []).map((d: any) => d.id)
    const descontadoPorDev = new Map<string, number>()
    if (devIds.length) {
      const { data: descuentos } = await supabase
        .from("devoluciones_descuentos")
        .select("devolucion_id, monto")
        .in("devolucion_id", devIds)
      for (const d of descuentos || [])
        descontadoPorDev.set(d.devolucion_id, (descontadoPorDev.get(d.devolucion_id) || 0) + Number(d.monto))
    }
    const devolucionesConRestante = (devolucionesPendientes || []).map((d: any) => ({
      ...d,
      descontado: Math.round((descontadoPorDev.get(d.id) || 0) * 100) / 100,
      restante: Math.max(0, Math.round((Number(d.monto_total || 0) - (descontadoPorDev.get(d.id) || 0)) * 100) / 100),
    }))

    // ── Saldo PROYECTADO: lo que el cliente va a deber cuando el ERP confirme
    // lo ya cobrado en la calle. El vendedor acaba de recibir la plata: si le
    // mostramos la deuda vieja parece que lo tratamos de mentiroso.
    // proyectado = real − imputaciones pendientes − a cuenta pendiente −
    //              devoluciones pendientes (la NC futura acredita el total).
    // El 10% contado entra solo: sus imputaciones cubren el 100% del
    // comprobante aunque el pago sea el 90% ("proyección reversa").
    const { data: pagosPend } = await supabase
      .from("pagos_clientes")
      .select("id, monto, observaciones")
      .eq("cliente_id", id)
      .in("estado", ["pendiente", "pendiente_rendicion"])
    const pagoPendIds = (pagosPend || []).map((p: any) => p.id)
    const impPorPago = new Map<string, number>()
    if (pagoPendIds.length) {
      const { data: impsPend } = await supabase
        .from("imputaciones")
        .select("pago_id, monto_imputado")
        .in("pago_id", pagoPendIds)
        .eq("estado", "pendiente")
      for (const i of impsPend || [])
        impPorPago.set(i.pago_id, (impPorPago.get(i.pago_id) || 0) + Number(i.monto_imputado))
    }
    let bajaProyectada = 0
    for (const p of pagosPend || []) {
      const imp = impPorPago.get(p.id) || 0
      bajaProyectada += imp + Math.max(0, Number(p.monto || 0) - imp) // imputado + a cuenta
      // "Proyección reversa": pago con marca contado → la NC 10% futura
      // cubre imput/9 más (las imputaciones quedaron al 90% del comprobante)
      if ((p.observaciones || "").includes("[10% CONTADO]")) bajaProyectada += imp / 9
    }
    for (const d of devolucionesConRestante) bajaProyectada += Number(d.monto_total || 0)

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
        saldo_proyectado: Math.round(((Number(saldo?.saldo_actual) || 0) - bajaProyectada) * 100) / 100,
        actualizado_at: actualizadoAt,
        actualizado_por_nombre: actualizadoPorNombre,
      },
      comprobantes: comprobantes || [],
      creditos: creditosVivos || [],
      a_cuenta: aCuenta,
      total_a_favor: totalAFavor,
      pedidos_cobrables: pedidosCobrables,
      pedidos_cobro: pedidosCobro,
      devoluciones_pendientes: devolucionesConRestante,
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
  "condicion_iva",
  "metodo_facturacion",
  "localidad_id",
  "lista_precio_id",
] as const

// Campos cuyo cambio altera los precios de los pedidos abiertos del cliente
const CAMPOS_PRECIO = ["lista_precio_id", "metodo_facturacion", "condicion_iva"] as const

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

    // La lista de precios solo la cambian los viajantes habilitados
    // (vendedores.puede_cambiar_lista) — el resto ni la ve en la UI
    if (body.lista_precio_id !== undefined && !session.puedeCambiarLista) {
      return NextResponse.json({ error: "No tenés permiso para cambiar la lista de precios." }, { status: 403 })
    }

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

    // Reasignación de vendedor (opcional) — SOLO entre los viajantes del
    // propio usuario (ej. FREIJE DANIEL ↔ FREIJE DANIEL LISTA NECO)
    let vendedorDestino: { id: string; nombre: string } | null = null
    if (body.vendedor_id !== undefined) {
      if (!body.vendedor_id || typeof body.vendedor_id !== "string") {
        return NextResponse.json({ error: "vendedor_id inválido." }, { status: 400 })
      }
      if (!session.vendedorIds.includes(body.vendedor_id)) {
        return NextResponse.json({ error: "Solo podés asignar el cliente a un viajante de tu usuario." }, { status: 403 })
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
      // El viajante impone su lista (ej. "LISTA NECO" → Neco, "FREIJE DANIEL" → Viajante)
      const listaImpuesta = listaDelViajante(session, vd.id)
      if (listaImpuesta) patch.lista_precio_id = listaImpuesta
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

    // Si cambió algo que define el precio (lista, método, viajante que impone
    // lista), los pedidos abiertos del cliente se re-precian para que lo que
    // llega a facturar coincida con la ficha — no solo la visual
    let repreciados = 0
    if (CAMPOS_PRECIO.some((c) => patch[c] !== undefined)) {
      const r = await repreciarPedidosAbiertosCliente(id)
      repreciados = r.repreciados
    }

    return NextResponse.json({
      success: true,
      pedidos_repreciados: repreciados,
      ...(vendedorDestino ? { vendedor: vendedorDestino } : {}),
    })
  } catch (error: any) {
    console.error("[vendedor] Error en PATCH /api/vendedor/cliente/[id]:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
