import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// GET /api/pagos-clientes/rendiciones-resumen
// Datos para el historial unificado de pagos: rendiciones (de viajes/choferes
// y de viajantes) con su desglose completo — pagos, efectivo, gastos y fondos
// del viaje, retiros del viajante — más los viajes con pagos pendientes de
// rendir agrupados. Los pagos incluidos en una rendición se aprueban desde la
// rendición, no sueltos.
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()

    const { data: rendiciones, error } = await supabase
      .from("rendiciones")
      .select(
        `id, viaje_id, cobrador_id, cobrador_tipo, fecha, estado, efectivo_declarado, efectivo_registrado,
         diferencia, observaciones, confirmado_at, created_at, viajes(id, nombre),
         rendicion_items(pago_id, pagos_clientes(id, monto, fecha_pago, estado, forma_pago, clientes(nombre), pagos_detalle(tipo_pago, monto)))`
      )
      .neq("estado", "cancelada")
      .order("created_at", { ascending: false })
      .limit(60)
    if (error) throw error

    // Nombres de cobradores (vendedores primero, después profiles de choferes)
    const cobradorIds = [...new Set((rendiciones || []).map((r: any) => r.cobrador_id).filter(Boolean))]
    const nombres = new Map<string, string>()
    if (cobradorIds.length) {
      const [{ data: vend }, { data: prof }] = await Promise.all([
        supabase.from("vendedores").select("id, nombre").in("id", cobradorIds),
        supabase.from("profiles").select("id, nombre").in("id", cobradorIds),
      ])
      for (const v of vend || []) nombres.set(v.id, v.nombre)
      for (const p of prof || []) if (!nombres.has(p.id)) nombres.set(p.id, p.nombre)
    }

    // Gastos (débitos) y fondos entregados (créditos) por viaje
    const viajeIds = [...new Set((rendiciones || []).map((r: any) => r.viaje_id).filter(Boolean))]
    const movsPorViaje = new Map<string, any[]>()
    if (viajeIds.length) {
      const { data: movs } = await supabase
        .from("billetera_movimientos")
        .select("referencia_id, tipo, monto, concepto, fecha")
        .eq("referencia_tipo", "viaje")
        .in("referencia_id", viajeIds)
        .in("tipo", ["debito", "credito"])
      for (const m of movs || []) {
        const list = movsPorViaje.get(m.referencia_id) || []
        list.push(m)
        movsPorViaje.set(m.referencia_id, list)
      }
    }

    // Retiros de comisión de viajantes, para asignarlos al período de cada rendición
    const viajanteIds = [
      ...new Set(
        (rendiciones || []).filter((r: any) => r.cobrador_tipo === "viajante").map((r: any) => r.cobrador_id)
      ),
    ]
    const retirosPorCobrador = new Map<string, any[]>()
    if (viajanteIds.length) {
      const { data: retiros } = await supabase
        .from("billetera_movimientos")
        .select("viajante_id, monto, concepto, fecha")
        .eq("tipo", "retiro_comision")
        .in("viajante_id", viajanteIds)
        .order("fecha", { ascending: false })
      for (const m of retiros || []) {
        const list = retirosPorCobrador.get(m.viajante_id) || []
        list.push(m)
        retirosPorCobrador.set(m.viajante_id, list)
      }
    }
    const porCobrador = new Map<string, any[]>()
    for (const r of rendiciones || []) {
      const list = porCobrador.get(r.cobrador_id) || []
      list.push(r) // ya vienen ordenadas desc por created_at
      porCobrador.set(r.cobrador_id, list)
    }
    // Retiros entre la rendición anterior del cobrador y esta
    const retirosDeRendicion = (r: any): any[] => {
      if (r.cobrador_tipo !== "viajante") return []
      const todas = porCobrador.get(r.cobrador_id) || []
      const idx = todas.findIndex((x: any) => x.id === r.id)
      const desde = idx >= 0 && idx + 1 < todas.length ? todas[idx + 1].created_at : null
      return (retirosPorCobrador.get(r.cobrador_id) || []).filter(
        (m: any) => m.fecha <= r.created_at && (!desde || m.fecha > desde)
      )
    }

    const mapMov = (m: any) => ({ concepto: m.concepto, monto: Number(m.monto), fecha: m.fecha })

    const resumen = (rendiciones || []).map((r: any) => {
      const pagos = (r.rendicion_items || [])
        .map((it: any) => it.pagos_clientes)
        .filter(Boolean)
        .map((p: any) => ({
          id: p.id,
          monto: Number(p.monto),
          fecha_pago: p.fecha_pago,
          estado: p.estado,
          cliente_nombre: p.clientes?.nombre || "—",
          metodos: (p.pagos_detalle || []).length
            ? [...new Set((p.pagos_detalle || []).map((d: any) => d.tipo_pago))].join(" + ")
            : p.forma_pago || "—",
        }))
      const movs = r.viaje_id ? movsPorViaje.get(r.viaje_id) || [] : []
      return {
        id: r.id,
        estado: r.estado,
        fecha: r.fecha,
        created_at: r.created_at,
        confirmado_at: r.confirmado_at,
        cobrador_tipo: r.cobrador_tipo,
        viaje_id: r.viaje_id,
        titulo: r.viajes?.nombre
          ? `Viaje ${r.viajes.nombre}`
          : nombres.get(r.cobrador_id) || (r.cobrador_tipo === "viajante" ? "Viajante" : "Chofer"),
        efectivo_declarado: Number(r.efectivo_declarado),
        efectivo_registrado: Number(r.efectivo_registrado),
        diferencia: Number(r.diferencia),
        observaciones: r.observaciones,
        total: pagos.reduce((s: number, p: any) => s + p.monto, 0),
        cantidad_pagos: pagos.length,
        pago_ids: pagos.map((p: any) => p.id),
        pagos,
        gastos: movs.filter((m: any) => m.tipo === "debito").map(mapMov),
        fondos: movs.filter((m: any) => m.tipo === "credito").map(mapMov),
        retiros: retirosDeRendicion(r).map(mapMov),
      }
    })

    // Viajes con pagos pendientes de rendir (agrupados en una sola fila)
    const enRendicionAbierta = new Set<string>()
    for (const r of resumen) if (r.estado === "abierta") for (const pid of r.pago_ids) enRendicionAbierta.add(pid)

    const { data: pendViaje } = await supabase
      .from("pagos_clientes")
      .select("id, monto, fecha_pago, viaje_id, viajes(id, nombre)")
      .eq("estado", "pendiente_rendicion")
      .not("viaje_id", "is", null)

    const viajesMap = new Map<string, any>()
    for (const p of pendViaje || []) {
      if (enRendicionAbierta.has(p.id)) continue
      const v =
        viajesMap.get((p as any).viaje_id) || {
          viaje_id: (p as any).viaje_id,
          nombre: (p as any).viajes?.nombre || "Viaje",
          cantidad_pagos: 0,
          total: 0,
          pago_ids: [] as string[],
          ultima_fecha: p.fecha_pago,
        }
      v.cantidad_pagos++
      v.total += Number(p.monto)
      v.pago_ids.push(p.id)
      if (p.fecha_pago > v.ultima_fecha) v.ultima_fecha = p.fecha_pago
      viajesMap.set((p as any).viaje_id, v)
    }

    return NextResponse.json({
      rendiciones: resumen,
      viajes_pendientes: [...viajesMap.values()],
    })
  } catch (error: any) {
    console.error("[pagos-clientes/rendiciones-resumen] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
