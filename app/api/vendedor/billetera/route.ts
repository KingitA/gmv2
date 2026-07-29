import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { fetchAllRows } from "@/lib/supabase/fetch-all"

// GET /api/vendedor/billetera?page=
// Billetera del vendedor autenticado. "Plata en la calle" = suma de los pagos
// que cobró y siguen pendiente_rendicion (no rendidos a oficina), con desglose
// por método real (pagos_detalle). Los movimientos quedan como historial.
export async function GET(request: Request) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get("page") ?? "1")
    const perPage = 50
    const offset = (page - 1) * perPage

    // Plata en la calle: cobros sin rendir (fuente de verdad: pagos_clientes).
    // Los que ya están declarados en una rendición abierta pasan a "en viaje
    // a oficina" y dejan la billetera en 0.
    const { data: pagosSinRendir } = await supabase
      .from("pagos_clientes")
      .select("id, monto, forma_pago, pagos_detalle(tipo_pago, monto)")
      .in("vendedor_id", session.vendedorIds)
      .eq("estado", "pendiente_rendicion")

    const declarados = new Set<string>()
    const { data: abiertas } = await supabase
      .from("rendiciones")
      .select("id")
      .in("cobrador_id", session.vendedorIds)
      .eq("estado", "abierta")
    if (abiertas?.length) {
      const { data: items } = await supabase
        .from("rendicion_items")
        .select("pago_id")
        .in("rendicion_id", abiertas.map((r) => r.id))
      for (const it of items || []) declarados.add(it.pago_id)
    }

    const enCalle = (pagosSinRendir ?? []).filter((p: any) => !declarados.has(p.id))
    const enViaje = (pagosSinRendir ?? []).filter((p: any) => declarados.has(p.id))

    let efectivo = 0
    let cheques = 0
    let transferencias = 0
    for (const p of enCalle) {
      const detalles: any[] = (p as any).pagos_detalle || []
      if (detalles.length) {
        for (const d of detalles) {
          const tipo = (d.tipo_pago || "").toLowerCase()
          if (tipo === "efectivo") efectivo += Number(d.monto)
          else if (tipo === "cheque") cheques += Number(d.monto)
          else transferencias += Number(d.monto)
        }
      } else {
        // pagos viejos sin detalle: clasificar por forma_pago
        const forma = ((p as any).forma_pago || "").toLowerCase()
        if (forma === "cheque") cheques += Number(p.monto)
        else if (forma === "transferencia") transferencias += Number(p.monto)
        else efectivo += Number(p.monto)
      }
    }

    const balance = enCalle.reduce((s, p) => s + Number(p.monto), 0)
    const desglose = { efectivo, cheques, transferencias }
    const cantidadSinRendir = enCalle.length
    const enViajeTotal = enViaje.reduce((s, p) => s + Number(p.monto), 0)

    const comisionesPendientes = await fetchAllRows(() =>
      supabase
        .from("comisiones")
        .select("id, monto, segmento, porcentaje, created_at, pedido_id, articulos(descripcion)")
        .in("viajante_id", session.vendedorIds)
        .eq("tipo", "cobrada")
        .eq("pagado", false)
        .order("created_at", { ascending: false })
    )

    const totalPendiente = comisionesPendientes.reduce((s, c) => s + Number(c.monto), 0)

    const { data: historial, count } = await supabase
      .from("billetera_movimientos")
      .select("id, tipo, medio, monto, concepto, fecha, referencia_id, referencia_tipo", { count: "exact" })
      .in("viajante_id", session.vendedorIds)
      .order("fecha", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + perPage - 1)

    // Enriquecer movimientos genéricos: "Cobro {cliente} · métodos" en vez de
    // "Cobro en calle" (para los registros viejos y los débitos de rendición)
    const refIds = [...new Set((historial ?? []).map((m: any) => m.referencia_id).filter(Boolean))]
    const pagoInfo = new Map<string, { cliente: string; metodos: string }>()
    if (refIds.length) {
      const { data: pagosRef } = await supabase
        .from("pagos_clientes")
        .select("id, clientes(nombre), pagos_detalle(tipo_pago)")
        .in("id", refIds)
      for (const p of pagosRef || []) {
        const metodos = [...new Set(((p as any).pagos_detalle || []).map((d: any) => d.tipo_pago).filter(Boolean))]
        pagoInfo.set(p.id, {
          cliente: (p as any).clientes?.nombre || "",
          metodos: metodos.join(" + "),
        })
      }
    }
    const historialEnriquecido = (historial ?? []).map((m: any) => {
      const info = m.referencia_id ? pagoInfo.get(m.referencia_id) : null
      if (!info?.cliente) return m
      const concepto =
        m.tipo === "cobro_cliente"
          ? `Cobro ${info.cliente}`
          : m.referencia_tipo === "rendicion"
            ? `Rendición · ${info.cliente}`
            : m.concepto
      return { ...m, concepto, medio: m.medio || info.metodos || null }
    })

    return NextResponse.json({
      balance,
      desglose,
      pagos_sin_rendir: cantidadSinRendir,
      en_viaje: { total: enViajeTotal, cantidad: enViaje.length },
      comisiones_pendientes: comisionesPendientes,
      total_pendiente_comisiones: totalPendiente,
      historial: historialEnriquecido,
      total: count ?? 0,
      page,
      per_page: perPage,
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/billetera:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
