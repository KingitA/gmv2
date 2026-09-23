import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'
import { requireOficina, errorJson, guardarChoferes, guardarZonas } from '@/lib/viajes/servidor'
import { viajeEditable } from '@/lib/viajes/estados'

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

    // Resumen de pagos del viaje (desde pagos_clientes + pagos_detalle; viajes_pagos retirado)
    const { data: pagos } = await supabase
      .from("pagos_clientes")
      .select("monto, estado, pagos_detalle(tipo_pago, monto)")
      .eq("viaje_id", id)
      .in("estado", ["pendiente_rendicion", "confirmado"])

    const detallesViaje = (pagos || []).flatMap((p: any) => p.pagos_detalle || [])
    const resumen_pagos = {
      total_efectivo: detallesViaje
        .filter((d: any) => d.tipo_pago === "efectivo")
        .reduce((sum: number, d: any) => sum + (Number(d.monto) || 0), 0),
      cantidad_cheques: detallesViaje.filter((d: any) => d.tipo_pago === "cheque").length,
      cantidad_transferencias: detallesViaje.filter((d: any) => d.tipo_pago === "transferencia").length,
      total_cobrado: (pagos || []).reduce((sum: number, p: any) => sum + (Number(p.monto) || 0), 0),
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

// PATCH /api/viajes/[id] — editar un viaje (oficina).
// Mientras está 'programado' se edita todo: nombre, fecha, zonas, transporte o
// chofer + acompañantes, vehículo, presupuesto de gastos, observaciones.
// Despachado en adelante solo observaciones (la hoja de ruta ya salió).
// { accion: "cancelar" }: solo programado; libera sus pedidos.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireOficina()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id } = await params
    const body = await request.json()

    const { data: viaje } = await supabase
      .from("viajes")
      .select("id, estado, tipo, tipo_transporte, chofer_id")
      .eq("id", id)
      .single()
    if (!viaje) return errorJson("Viaje no encontrado", 404)
    if (viaje.tipo !== "reparto") return errorJson("Este viaje no es de reparto")

    if (body.accion === "cancelar") {
      if (!viajeEditable(viaje.estado)) return errorJson("Solo se cancela un viaje programado")
      const { error: pErr } = await supabase.from("pedidos").update({ viaje_id: null }).eq("viaje_id", id)
      if (pErr) throw pErr
      await supabase.from("viajes_paradas").delete().eq("viaje_id", id)
      const { error } = await supabase.from("viajes").update({ estado: "cancelado" }).eq("id", id)
      if (error) throw error
      return NextResponse.json({ success: true, estado: "cancelado" })
    }

    const auditoria = { actualizado_por: auth.user.id, actualizado_at: new Date().toISOString() }

    if (!viajeEditable(viaje.estado)) {
      // Despachado en adelante: solo observaciones y, hasta que salga, la fecha
      // (reprogramar arrastrando en el calendario).
      const cambios: Record<string, any> = { ...auditoria }
      if (body.observaciones !== undefined) cambios.observaciones = body.observaciones || null
      if (body.fecha !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) return errorJson("fecha inválida (AAAA-MM-DD)")
        if (viaje.estado !== "despachado") return errorJson("El viaje ya salió: no se cambia la fecha")
        cambios.fecha = body.fecha
      }
      if (body.dias !== undefined && viaje.estado === "despachado") {
        const dias = Math.min(15, Math.max(1, Math.round(Number(body.dias)) || 1))
        cambios.dias = dias
      }
      if (Object.keys(cambios).length === 2) return errorJson("El viaje ya fue despachado: solo se editan la fecha y las observaciones")
      const { error } = await supabase.from("viajes").update(cambios).eq("id", id)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    const cambios: Record<string, any> = { ...auditoria }
    if (body.nombre !== undefined && String(body.nombre).trim()) cambios.nombre = String(body.nombre).trim()
    if (body.fecha !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) return errorJson("fecha inválida (AAAA-MM-DD)")
      cambios.fecha = body.fecha
    }
    if (body.observaciones !== undefined) cambios.observaciones = body.observaciones || null
    if (body.dias !== undefined) {
      const dias = Math.min(15, Math.max(1, Math.round(Number(body.dias)) || 1))
      cambios.dias = dias
    }
    for (const campo of ["porcentaje_flete", "dinero_nafta", "gastos_peon", "gastos_hotel", "gastos_adicionales"]) {
      if (body[campo] !== undefined) cambios[campo] = Number(body[campo]) || 0
    }

    const tipoTransporte = body.tipo_transporte ?? viaje.tipo_transporte
    const porTransporte = tipoTransporte === "transporte"
    if (body.tipo_transporte !== undefined) cambios.tipo_transporte = porTransporte ? "transporte" : "chofer_propio"
    if (porTransporte) {
      if (body.transporte_id !== undefined) cambios.transporte_id = body.transporte_id || null
      if (body.tipo_transporte !== undefined) cambios.vehiculo_id = null
    } else {
      if (body.vehiculo_id !== undefined) cambios.vehiculo_id = body.vehiculo_id || null
      if (body.tipo_transporte !== undefined) cambios.transporte_id = null
    }

    if (Array.isArray(body.zona_ids)) {
      const zonaIds: string[] = body.zona_ids.filter(Boolean)
      if (!zonaIds.length) return errorJson("Elegí al menos una zona")
      cambios.zona_id = zonaIds[0]
      await guardarZonas(supabase, id, zonaIds)
    }

    {
      const { error } = await supabase.from("viajes").update(cambios).eq("id", id)
      if (error) throw error
    }

    if (porTransporte) {
      if (body.tipo_transporte !== undefined) await guardarChoferes(supabase, id, null, [])
    } else if (body.chofer_id !== undefined || body.acompanante_ids !== undefined) {
      let acompanantes: string[] = body.acompanante_ids
      if (!Array.isArray(acompanantes)) {
        const { data: actuales } = await supabase
          .from("viajes_choferes")
          .select("usuario_id")
          .eq("viaje_id", id)
          .eq("rol", "acompanante")
        acompanantes = (actuales || []).map((a: any) => a.usuario_id)
      }
      const titular = body.chofer_id !== undefined ? body.chofer_id || null : viaje.chofer_id
      await guardarChoferes(supabase, id, titular, acompanantes)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[viajes] Error en PATCH /api/viajes/[id]:", error)
    return NextResponse.json({ error: error.message || "Error al editar el viaje" }, { status: 500 })
  }
}
