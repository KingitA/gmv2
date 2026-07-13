import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// GET /api/pagos-clientes/rendiciones-resumen
// Datos para el historial unificado de pagos:
// - rendiciones declaradas/confirmadas (viajes/choferes y viajantes) con su
//   desglose completo (pagos, efectivo esperado, cheques, gastos del viaje,
//   retiros del período)
// - viajes con pagos pendientes de rendir (agrupados)
// - vendedores con cobros pendientes SIN declarar (agrupados como
//   "RENDICIÓN {vendedor} — sin declarar")
// Los pagos agrupados no se listan sueltos: se aprueban desde su rendición.
//
// Nota: pagos_detalle se consulta por batch (sin embed anidado) para no
// depender de la FK pagos_detalle→pagos_clientes.

const desgloseVacio = () => ({
  efectivo: 0,
  cheques_monto: 0,
  cheques_cantidad: 0,
  transferencias: 0,
})

export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()

    // ── 1. Rendiciones declaradas/confirmadas ──
    let rendiciones: any[] = []
    try {
      const { data, error } = await supabase
        .from("rendiciones")
        .select(
          `id, viaje_id, cobrador_id, cobrador_tipo, fecha, estado, efectivo_declarado, efectivo_registrado,
           diferencia, observaciones, confirmado_at, created_at, viajes(id, nombre),
           rendicion_items(pago_id, pagos_clientes(id, monto, fecha_pago, estado, forma_pago, clientes(nombre)))`
        )
        .neq("estado", "cancelada")
        .order("created_at", { ascending: false })
        .limit(60)
      if (error) throw error
      rendiciones = data || []
    } catch (e: any) {
      console.error("[rendiciones-resumen] error cargando rendiciones:", e?.message)
    }

    // ── 2. Pagos pendiente_rendicion (para agrupar viajes y vendedores) ──
    const { data: pendientes } = await supabase
      .from("pagos_clientes")
      .select(
        "id, monto, fecha_pago, forma_pago, viaje_id, vendedor_id, cobrador_tipo, clientes(nombre), viajes(id, nombre)"
      )
      .eq("estado", "pendiente_rendicion")

    // ── 3. pagos_detalle por batch para TODOS los pagos involucrados ──
    const pagoIdsRend = rendiciones.flatMap((r: any) =>
      (r.rendicion_items || []).map((it: any) => it.pagos_clientes?.id).filter(Boolean)
    )
    const pagoIdsPend = (pendientes || []).map((p: any) => p.id)
    const todosPagoIds = [...new Set([...pagoIdsRend, ...pagoIdsPend])]
    const detallesPorPago = new Map<string, any[]>()
    for (let i = 0; i < todosPagoIds.length; i += 100) {
      const { data: dets } = await supabase
        .from("pagos_detalle")
        .select("pago_id, tipo_pago, monto")
        .in("pago_id", todosPagoIds.slice(i, i + 100))
      for (const d of dets || []) {
        const list = detallesPorPago.get(d.pago_id) || []
        list.push(d)
        detallesPorPago.set(d.pago_id, list)
      }
    }

    const metodosDe = (pagoId: string, formaPago: string | null) => {
      const dets = detallesPorPago.get(pagoId) || []
      return dets.length
        ? [...new Set(dets.map((d: any) => d.tipo_pago))].join(" + ")
        : formaPago || "—"
    }
    const sumarDesglose = (acc: any, pagoId: string, monto: number, formaPago: string | null) => {
      const dets = detallesPorPago.get(pagoId) || []
      if (dets.length) {
        for (const d of dets) {
          const tipo = (d.tipo_pago || "").toLowerCase()
          if (tipo === "efectivo") acc.efectivo += Number(d.monto)
          else if (tipo === "cheque") {
            acc.cheques_monto += Number(d.monto)
            acc.cheques_cantidad += 1
          } else acc.transferencias += Number(d.monto)
        }
      } else {
        const forma = (formaPago || "").toLowerCase()
        if (forma === "cheque") {
          acc.cheques_monto += monto
          acc.cheques_cantidad += 1
        } else if (forma === "transferencia" || forma === "deposito") acc.transferencias += monto
        else acc.efectivo += monto
      }
      return acc
    }

    // ── 4. Nombres de cobradores ──
    const cobradorIds = [
      ...new Set([
        ...rendiciones.map((r: any) => r.cobrador_id),
        ...(pendientes || []).map((p: any) => p.vendedor_id),
      ]),
    ].filter(Boolean)
    const nombres = new Map<string, string>()
    if (cobradorIds.length) {
      const [{ data: vend }, { data: prof }] = await Promise.all([
        supabase.from("vendedores").select("id, nombre").in("id", cobradorIds),
        supabase.from("profiles").select("id, nombre").in("id", cobradorIds),
      ])
      for (const v of vend || []) nombres.set(v.id, v.nombre)
      for (const p of prof || []) if (!nombres.has(p.id)) nombres.set(p.id, p.nombre)
    }

    // ── 5. Gastos/fondos por viaje (para el detalle de rendiciones de viaje) ──
    const viajeIds = [...new Set(rendiciones.map((r: any) => r.viaje_id).filter(Boolean))]
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

    // ── 6. Retiros de comisión por período (rendiciones de viajante) ──
    const viajanteIds = [
      ...new Set(rendiciones.filter((r: any) => r.cobrador_tipo === "viajante").map((r: any) => r.cobrador_id)),
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
    for (const r of rendiciones) {
      const list = porCobrador.get(r.cobrador_id) || []
      list.push(r)
      porCobrador.set(r.cobrador_id, list)
    }
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

    // ── 7. Armar rendiciones con desglose ──
    const resumen = rendiciones.map((r: any) => {
      const desglose = desgloseVacio()
      const pagos = (r.rendicion_items || [])
        .map((it: any) => it.pagos_clientes)
        .filter(Boolean)
        .map((p: any) => {
          sumarDesglose(desglose, p.id, Number(p.monto), p.forma_pago)
          return {
            id: p.id,
            monto: Number(p.monto),
            fecha_pago: p.fecha_pago,
            estado: p.estado,
            cliente_nombre: p.clientes?.nombre || "—",
            metodos: metodosDe(p.id, p.forma_pago),
          }
        })
      const movs = r.viaje_id ? movsPorViaje.get(r.viaje_id) || [] : []
      return {
        id: r.id,
        tipo: "declarada",
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
        desglose,
        gastos: movs.filter((m: any) => m.tipo === "debito").map(mapMov),
        fondos: movs.filter((m: any) => m.tipo === "credito").map(mapMov),
        retiros: retirosDeRendicion(r).map(mapMov),
      }
    })

    const enRendicionAbierta = new Set<string>()
    for (const r of resumen) if (r.estado === "abierta") for (const pid of r.pago_ids) enRendicionAbierta.add(pid)

    // ── 8. Viajes con pagos pendientes (agrupados) ──
    const viajesMap = new Map<string, any>()
    // ── 9. Vendedores con cobros pendientes sin declarar (agrupados) ──
    const vendedoresMap = new Map<string, any>()

    for (const p of pendientes || []) {
      if (enRendicionAbierta.has(p.id)) continue
      const pagoRow = {
        id: p.id,
        monto: Number(p.monto),
        fecha_pago: p.fecha_pago,
        estado: "pendiente_rendicion",
        cliente_nombre: (p as any).clientes?.nombre || "—",
        metodos: metodosDe(p.id, p.forma_pago),
      }
      if ((p as any).viaje_id) {
        const v =
          viajesMap.get((p as any).viaje_id) || {
            viaje_id: (p as any).viaje_id,
            nombre: (p as any).viajes?.nombre || "Viaje",
            cantidad_pagos: 0,
            total: 0,
            pago_ids: [] as string[],
            pagos: [] as any[],
            desglose: desgloseVacio(),
            ultima_fecha: p.fecha_pago,
          }
        v.cantidad_pagos++
        v.total += Number(p.monto)
        v.pago_ids.push(p.id)
        v.pagos.push(pagoRow)
        sumarDesglose(v.desglose, p.id, Number(p.monto), p.forma_pago)
        if (p.fecha_pago > v.ultima_fecha) v.ultima_fecha = p.fecha_pago
        viajesMap.set((p as any).viaje_id, v)
      } else if ((p as any).vendedor_id) {
        const key = (p as any).vendedor_id
        const g =
          vendedoresMap.get(key) || {
            cobrador_id: key,
            titulo: nombres.get(key) || "Vendedor",
            cantidad_pagos: 0,
            total: 0,
            pago_ids: [] as string[],
            pagos: [] as any[],
            desglose: desgloseVacio(),
            ultima_fecha: p.fecha_pago,
          }
        g.cantidad_pagos++
        g.total += Number(p.monto)
        g.pago_ids.push(p.id)
        g.pagos.push(pagoRow)
        sumarDesglose(g.desglose, p.id, Number(p.monto), p.forma_pago)
        if (p.fecha_pago > g.ultima_fecha) g.ultima_fecha = p.fecha_pago
        vendedoresMap.set(key, g)
      }
      // sin viaje ni vendedor (mostrador/oficina): queda como pago suelto
    }

    return NextResponse.json({
      rendiciones: resumen,
      viajes_pendientes: [...viajesMap.values()],
      vendedores_pendientes: [...vendedoresMap.values()],
    })
  } catch (error: any) {
    console.error("[pagos-clientes/rendiciones-resumen] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
