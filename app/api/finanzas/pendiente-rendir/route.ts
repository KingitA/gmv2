import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * GET /api/finanzas/pendiente-rendir — la plata en la calle y lo sin verificar.
 *
 * Devuelve:
 *  - cobradores: pagos 'pendiente_rendicion' agrupados por cobrador (chofer/
 *    viajante) con el saldo de su billetera (saldos_financieros BILLETERA).
 *  - sin_verificar: pagos 'confirmado' sin segunda firma (efectivo de
 *    mostrador auto-confirmado pendiente de arqueo; excluye transferencias,
 *    que viven en /finanzas/conciliacion).
 */
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()

    const [pendientesRes, sinVerificarRes, saldosRes, rendicionesRes, cajasRes] = await Promise.all([
      supabase
        .from("pagos_clientes")
        .select(
          "id, monto, fecha_pago, viaje_id, cobrador_tipo, creado_por, cliente_id, clientes(nombre), viajes(id, nombre, chofer_id, estado), pagos_detalle(tipo_pago, monto)"
        )
        .eq("estado", "pendiente_rendicion")
        .order("fecha_pago", { ascending: true }),
      supabase
        .from("pagos_clientes")
        .select(
          "id, monto, fecha_pago, cobrador_tipo, creado_por, cliente_id, clientes(nombre), pagos_detalle(tipo_pago, monto)"
        )
        .eq("estado", "confirmado")
        .is("verificado_por", null)
        .order("fecha_pago", { ascending: true }),
      supabase.from("saldos_financieros").select("cuenta_id, color, saldo").eq("cuenta_tipo", "BILLETERA"),
      supabase
        .from("rendiciones")
        .select("id, cobrador_id, cobrador_tipo, fecha, efectivo_declarado, efectivo_registrado, diferencia, observaciones, rendicion_items(pago_id)")
        .eq("estado", "abierta")
        .order("fecha", { ascending: true }),
      supabase.from("cajas_financieras").select("id, nombre").order("nombre"),
    ])

    const saldoBilletera = new Map<string, number>()
    for (const s of saldosRes.data || []) {
      saldoBilletera.set(s.cuenta_id, (saldoBilletera.get(s.cuenta_id) ?? 0) + Number(s.saldo))
    }

    // Agrupar pendientes por cobrador (chofer del viaje, o creador)
    const grupos = new Map<string, any>()
    for (const p of pendientesRes.data || []) {
      const cobradorId = (p as any).viajes?.chofer_id || p.creado_por || "desconocido"
      if (!grupos.has(cobradorId)) {
        grupos.set(cobradorId, {
          cobrador_id: cobradorId,
          cobrador_tipo: p.cobrador_tipo,
          billetera_saldo: saldoBilletera.get(cobradorId) ?? 0,
          total: 0,
          efectivo: 0,
          cheques: 0,
          transferencias: 0,
          pagos: [],
        })
      }
      const g = grupos.get(cobradorId)
      g.total += Number(p.monto)
      for (const d of (p as any).pagos_detalle || []) {
        if (d.tipo_pago === "efectivo") g.efectivo += Number(d.monto)
        else if (d.tipo_pago === "cheque") g.cheques += Number(d.monto)
        else g.transferencias += Number(d.monto)
      }
      g.pagos.push({
        id: p.id,
        cliente: (p as any).clientes?.nombre ?? p.cliente_id,
        monto: Number(p.monto),
        fecha: p.fecha_pago,
        viaje: (p as any).viajes?.nombre ?? null,
        viaje_id: p.viaje_id,
      })
    }

    // Nombres de cobradores (grupos + rendiciones declaradas)
    const rendicionesAbiertas = rendicionesRes.data || []
    const cobradorIds = [
      ...new Set([
        ...[...grupos.keys()].filter((id) => id !== "desconocido"),
        ...rendicionesAbiertas.map((r) => r.cobrador_id),
      ]),
    ]
    const nombres = new Map<string, string>()
    if (cobradorIds.length) {
      const [profilesRes, vendedoresRes] = await Promise.all([
        supabase.from("profiles").select("id, nombre").in("id", cobradorIds),
        supabase.from("vendedores").select("id, nombre").in("id", cobradorIds),
      ])
      for (const v of vendedoresRes.data || []) nombres.set(v.id, v.nombre)
      for (const p of profilesRes.data || []) nombres.set(p.id, p.nombre)
      for (const [id, g] of grupos) g.cobrador_nombre = nombres.get(id) ?? id.slice(0, 8)
    }

    const sinVerificar = (sinVerificarRes.data || []).filter((p) =>
      ((p as any).pagos_detalle || []).some((d: any) => !["transferencia", "deposito"].includes(d.tipo_pago))
    )

    // ── Desglose de cada rendición declarada: pago por pago, con cliente,
    // comprobantes imputados, medios (cheques enumerados) y totales por medio,
    // para que la oficina COTEJE la plata y los cheques antes de confirmar. ──
    const pagoIdsRend = [...new Set(rendicionesAbiertas.flatMap((r: any) => (r.rendicion_items || []).map((i: any) => i.pago_id)))]
    const pagosRendMap = new Map<string, any>()
    if (pagoIdsRend.length) {
      const { data: pagosRend } = await supabase
        .from("pagos_clientes")
        .select(`
          id, monto, fecha_pago, observaciones, cliente_id,
          clientes(nombre, razon_social),
          pagos_detalle(tipo_pago, monto, banco, numero_cheque, fecha_cheque, referencia, color_cheque),
          imputaciones(monto_imputado, estado, comprobantes_venta(tipo_comprobante, numero_comprobante))
        `)
        .in("id", pagoIdsRend)
      for (const p of pagosRend || []) pagosRendMap.set(p.id, p)
    }
    const desgloseRendicion = (r: any) => {
      const pagos = (r.rendicion_items || [])
        .map((i: any) => pagosRendMap.get(i.pago_id))
        .filter(Boolean)
        .map((p: any) => ({
          id: p.id,
          cliente: p.clientes?.razon_social || p.clientes?.nombre || p.cliente_id,
          fecha: p.fecha_pago,
          monto: Number(p.monto),
          observaciones: (p.observaciones || "").replace(/\[[^\]]*\]/g, "").trim() || null,
          medios: (p.pagos_detalle || []).map((d: any) => ({
            tipo: d.tipo_pago,
            monto: Number(d.monto),
            banco: d.banco,
            numero_cheque: d.numero_cheque,
            fecha_cheque: d.fecha_cheque,
            referencia: d.referencia,
            color: d.color_cheque,
          })),
          comprobantes: (p.imputaciones || [])
            .filter((i: any) => i.estado !== "anulado")
            .map((i: any) => ({
              numero: i.comprobantes_venta ? `${i.comprobantes_venta.tipo_comprobante} ${i.comprobantes_venta.numero_comprobante}` : "—",
              monto: Number(i.monto_imputado),
            })),
        }))
      const totales: Record<string, { cantidad: number; monto: number }> = {}
      for (const p of pagos) for (const m of p.medios) {
        totales[m.tipo] = totales[m.tipo] || { cantidad: 0, monto: 0 }
        totales[m.tipo].cantidad += 1
        totales[m.tipo].monto += m.monto
      }
      return { pagos, totales }
    }

    return NextResponse.json({
      cobradores: [...grupos.values()].sort((a, b) => b.total - a.total),
      total_en_calle: [...grupos.values()].reduce((s, g) => s + g.total, 0),
      cajas: cajasRes.data || [],
      rendiciones_declaradas: rendicionesAbiertas.map((r: any) => ({
        id: r.id,
        cobrador_nombre: nombres.get(r.cobrador_id) ?? r.cobrador_id.slice(0, 8),
        cobrador_tipo: r.cobrador_tipo,
        fecha: r.fecha,
        efectivo_declarado: Number(r.efectivo_declarado),
        efectivo_registrado: Number(r.efectivo_registrado),
        diferencia: Number(r.diferencia),
        cantidad_pagos: (r.rendicion_items || []).length,
        observaciones: r.observaciones,
        ...desgloseRendicion(r),
      })),
      sin_verificar: sinVerificar.map((p) => ({
        id: p.id,
        cliente: (p as any).clientes?.nombre ?? p.cliente_id,
        monto: Number(p.monto),
        fecha: p.fecha_pago,
        cobrador_tipo: p.cobrador_tipo,
        metodos: ((p as any).pagos_detalle || []).map((d: any) => d.tipo_pago),
      })),
    })
  } catch (error: any) {
    console.error("[pendiente-rendir] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
