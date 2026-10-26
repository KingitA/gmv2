import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { billeteraConCuentaPersonal } from "@/lib/cuenta-corriente/cuenta-personal"
import { hoyISO, sumarDiasISO } from "@/lib/formato"

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

    // Saldo, efectivo en la calle, cheques, en viaje y cuenta corriente: el MISMO
    // cálculo que el inicio de la app (lib/vendedor/billetera-saldo.ts).
    const resumen = await billeteraConCuentaPersonal(supabase, session.vendedorIds, session.user.id)

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

    // Transferencias / depósitos / echeqs que cobró en la calle (#35, 26/10): NO van a la
    // rendición ni a la mano; la oficina las confirma en /caja. La app las lista aparte con su
    // estado ("pendiente" = a confirmar en oficina, "confirmado" = confirmada). Últimos 30 días.
    const { data: pagosDig } = await supabase
      .from("pagos_clientes")
      .select("id, monto, estado, fecha_pago, clientes(nombre), pagos_detalle(tipo_pago, monto, color_cheque)")
      .in("vendedor_id", session.vendedorIds)
      .in("estado", ["pendiente", "confirmado"])
      .gte("fecha_pago", sumarDiasISO(hoyISO(), -30))
      .order("fecha_pago", { ascending: false })
      .limit(100)
    const esDigital = (d: any) => d.tipo_pago === "transferencia" || d.tipo_pago === "deposito" || (d.tipo_pago === "cheque" && d.color_cheque === "ECHEQ")
    const transferencias = (pagosDig ?? []).flatMap((p: any) => {
      const dig = (p.pagos_detalle || []).filter(esDigital)
      if (!dig.length) return []
      return [{
        pago_id: p.id,
        fecha: p.fecha_pago,
        cliente: p.clientes?.nombre || "",
        monto: Math.round(dig.reduce((s: number, d: any) => s + Number(d.monto || 0), 0) * 100) / 100,
        medio: [...new Set(dig.map((d: any) => (d.tipo_pago === "cheque" ? "echeq" : d.tipo_pago)))].join(" + "),
        estado: p.estado as "pendiente" | "confirmado",
      }]
    })

    return NextResponse.json({
      ...resumen,
      transferencias,
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
