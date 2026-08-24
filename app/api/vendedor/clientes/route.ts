import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor, listaDelViajante } from "@/lib/vendedor/session"

// GET /api/vendedor/clientes?q=&localidad=&filtro=todos|con_deuda|sin_rendir
// Clientes asignados a los vendedores del usuario, con saldo real
// (v_saldo_clientes) y cantidad de pagos pendientes de rendición.
export async function GET(request: Request) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")?.trim() || ""
    const localidad = searchParams.get("localidad")?.trim() || ""
    const filtro = searchParams.get("filtro") || "todos"

    let query = supabase
      .from("clientes")
      .select("id, nombre, razon_social, cuit, codigo_cliente, direccion, localidad, condicion_pago, metodo_facturacion, vendedor_id")
      .in("vendedor_id", session.vendedorIds)
      .eq("activo", true)
      .order("nombre")

    // Mismos campos que el buscador del ERP/importador: un cliente se encuentra
    // también por su dirección ("belgrano" → el de calle Belgrano), código o localidad
    if (q) query = query.or(`nombre.ilike.%${q}%,razon_social.ilike.%${q}%,cuit.ilike.%${q}%,codigo_cliente.ilike.%${q}%,direccion.ilike.%${q}%,localidad.ilike.%${q}%`)
    if (localidad) query = query.eq("localidad", localidad)

    const { data: clientes, error } = await query
    if (error) throw error

    const ids = (clientes || []).map((c) => c.id)

    // Saldos reales desde el libro mayor
    const saldoPorCliente = new Map<string, number>()
    if (ids.length) {
      const { data: saldos } = await supabase
        .from("v_saldo_clientes")
        .select("cliente_id, saldo_actual")
        .in("cliente_id", ids)
      for (const s of saldos || []) saldoPorCliente.set(s.cliente_id, Number(s.saldo_actual) || 0)
    }

    // Pagos de este vendedor pendientes de rendición
    const sinRendirPorCliente = new Map<string, number>()
    if (ids.length) {
      const { data: pagos } = await supabase
        .from("pagos_clientes")
        .select("cliente_id")
        .in("cliente_id", ids)
        .eq("estado", "pendiente_rendicion")
        .eq("creado_por", session.user.id)
      for (const p of pagos || [])
        sinRendirPorCliente.set(p.cliente_id, (sinRendirPorCliente.get(p.cliente_id) || 0) + 1)
    }

    // ── Saldo PROYECTADO por cliente: real − cobros pendientes (imputaciones
    // + a cuenta) − devoluciones pendientes. Es el número que ve el vendedor:
    // lo que va a deber el cliente cuando el ERP confirme lo ya cobrado.
    const bajaPorCliente = new Map<string, number>()
    if (ids.length) {
      const { data: pagosPend } = await supabase
        .from("pagos_clientes")
        .select("id, cliente_id, monto, observaciones")
        .in("cliente_id", ids)
        .in("estado", ["pendiente", "pendiente_rendicion"])
      const pagoIds = (pagosPend || []).map((p: any) => p.id)
      const impPorPago = new Map<string, number>()
      if (pagoIds.length) {
        const { data: imps } = await supabase
          .from("imputaciones")
          .select("pago_id, monto_imputado")
          .in("pago_id", pagoIds)
          .eq("estado", "pendiente")
        for (const i of imps || [])
          impPorPago.set(i.pago_id, (impPorPago.get(i.pago_id) || 0) + Number(i.monto_imputado))
      }
      for (const p of pagosPend || []) {
        const imp = impPorPago.get(p.id) || 0
        let baja = imp + Math.max(0, Number(p.monto || 0) - imp)
        if ((p.observaciones || "").includes("[10% CONTADO]")) baja += imp / 9 // NC 10% futura
        bajaPorCliente.set(p.cliente_id, (bajaPorCliente.get(p.cliente_id) || 0) + baja)
      }
      const { data: devsPend } = await supabase
        .from("devoluciones")
        .select("cliente_id, monto_total")
        .in("cliente_id", ids)
        .eq("estado", "pendiente")
      for (const d of devsPend || [])
        bajaPorCliente.set(d.cliente_id, (bajaPorCliente.get(d.cliente_id) || 0) + Number(d.monto_total || 0))
    }

    let resultado = (clientes || []).map((c) => {
      const real = saldoPorCliente.get(c.id) ?? 0
      return {
        ...c,
        saldo_actual: real,
        saldo_proyectado: Math.round((real - (bajaPorCliente.get(c.id) || 0)) * 100) / 100,
        pagos_sin_rendir: sinRendirPorCliente.get(c.id) ?? 0,
      }
    })

    if (filtro === "con_deuda") resultado = resultado.filter((c) => c.saldo_actual > 0)
    if (filtro === "sin_rendir") resultado = resultado.filter((c) => c.pagos_sin_rendir > 0)

    // Localidades disponibles para los chips de filtro (sobre el total sin filtrar)
    const { data: locs } = await supabase
      .from("clientes")
      .select("localidad")
      .in("vendedor_id", session.vendedorIds)
      .eq("activo", true)
      .not("localidad", "is", null)
    const localidades = [...new Set((locs || []).map((l) => l.localidad).filter(Boolean))].sort()

    return NextResponse.json({ clientes: resultado, localidades })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/clientes:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/vendedor/clientes — alta de cliente desde la calle.
// El cliente nace asignado a uno de los viajantes del usuario (si no se
// indica, al primero) y listo para levantarle un pedido en el momento.
// El trigger clientes_sync_localidad_fk completa localidad/provincia desde
// localidad_id (o resuelve el FK si viene solo el texto).
export async function POST(request: Request) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const body = await request.json()
    const {
      nombre,
      razon_social,
      cuit,
      condicion_iva,
      metodo_facturacion,
      condicion_pago,
      condicion_entrega,
      direccion,
      localidad_id,
      localidad,
      telefono,
      mail,
      lista_precio_id,
      vendedor_id,
    } = body

    const nombreFinal = String(nombre || razon_social || "").trim()
    if (!nombreFinal) {
      return NextResponse.json({ error: "Ingresá el nombre o razón social." }, { status: 400 })
    }

    const vendedorId =
      vendedor_id && session.vendedorIds.includes(vendedor_id) ? vendedor_id : session.vendedorIds[0]
    if (!vendedorId) {
      return NextResponse.json({ error: "Tu usuario no tiene viajante asignado." }, { status: 400 })
    }

    const cuitLimpio = cuit ? String(cuit).trim() : null
    if (cuitLimpio) {
      const { data: dup } = await supabase
        .from("clientes")
        .select("id, nombre")
        .eq("cuit", cuitLimpio)
        .eq("activo", true)
        .maybeSingle()
      if (dup) {
        return NextResponse.json(
          { error: `Ya existe un cliente con ese CUIT: ${dup.nombre}`, cliente_existente_id: dup.id },
          { status: 409 }
        )
      }
    }

    const { data: cliente, error } = await supabase
      .from("clientes")
      .insert({
        nombre: nombreFinal,
        razon_social: razon_social?.trim() || null,
        nombre_razon_social: razon_social?.trim() || nombreFinal,
        cuit: cuitLimpio,
        condicion_iva: condicion_iva || null,
        metodo_facturacion: metodo_facturacion || null,
        condicion_pago: condicion_pago || null,
        condicion_entrega: condicion_entrega || null,
        direccion: direccion?.trim() || null,
        localidad_id: localidad_id || null,
        localidad: localidad?.trim() || null,
        telefono: telefono?.trim() || null,
        mail: mail?.trim() || null,
        // La lista la impone el viajante; si no impone, la elige quien tiene permiso
        lista_precio_id:
          listaDelViajante(session, vendedorId) || (session.puedeCambiarLista ? lista_precio_id || null : null),
        vendedor_id: vendedorId,
        activo: true,
        puntaje: 50,
        nivel_puntaje: "REGULAR",
        retira_en_deposito: false,
        actualizado_por: session.user.id,
        actualizado_at: new Date().toISOString(),
      })
      .select("id, nombre, localidad, metodo_facturacion")
      .single()
    if (error) throw error

    return NextResponse.json({ success: true, cliente }, { status: 201 })
  } catch (error: any) {
    console.error("[vendedor] Error en POST /api/vendedor/clientes:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
