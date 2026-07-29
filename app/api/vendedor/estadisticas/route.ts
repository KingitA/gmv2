import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { fetchAllRows } from "@/lib/supabase/fetch-all"

// GET /api/vendedor/estadisticas
// KPIs del vendedor autenticado: ventas por mes (últimos 6), top clientes
// (90 días), comisiones y deuda total de su cartera. Sin datos de margen/costo.
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()

    const desde = new Date()
    desde.setMonth(desde.getMonth() - 5)
    desde.setDate(1)
    const desdeStr = desde.toISOString().slice(0, 10)

    const pedidos = await fetchAllRows(() =>
      supabase
        .from("pedidos")
        .select("fecha, total, estado, cliente_id, clientes(nombre)")
        .in("vendedor_id", session.vendedorIds)
        .is("eliminado_at", null)
        .neq("estado", "cancelado")
        .gte("fecha", desdeStr)
        .order("fecha", { ascending: true })
    )

    // Ventas por mes
    const meses = new Map<string, { total: number; pedidos: number }>()
    for (let i = 0; i < 6; i++) {
      const d = new Date(desde)
      d.setMonth(desde.getMonth() + i)
      meses.set(d.toISOString().slice(0, 7), { total: 0, pedidos: 0 })
    }
    for (const p of pedidos || []) {
      const mes = String(p.fecha).slice(0, 7)
      const m = meses.get(mes)
      if (m) {
        m.total += Number(p.total) || 0
        m.pedidos += 1
      }
    }
    const ventasPorMes = [...meses.entries()].map(([mes, v]) => ({ mes, ...v }))

    // Top clientes últimos 90 días
    const hace90 = new Date()
    hace90.setDate(hace90.getDate() - 90)
    const corte90 = hace90.toISOString().slice(0, 10)
    const porCliente = new Map<string, { nombre: string; total: number; pedidos: number }>()
    for (const p of pedidos || []) {
      if (String(p.fecha) < corte90 || !p.cliente_id) continue
      const actual = porCliente.get(p.cliente_id) || {
        nombre: (p.clientes as any)?.nombre || "—",
        total: 0,
        pedidos: 0,
      }
      actual.total += Number(p.total) || 0
      actual.pedidos += 1
      porCliente.set(p.cliente_id, actual)
    }
    const topClientes = [...porCliente.entries()]
      .map(([cliente_id, v]) => ({ cliente_id, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)

    // Comisiones
    const comisiones = await fetchAllRows(() =>
      supabase
        .from("comisiones")
        .select("monto, pagado, tipo, created_at")
        .in("viajante_id", session.vendedorIds)
        .eq("tipo", "cobrada")
    )
    const comisionesPendientes = (comisiones || [])
      .filter((c) => !c.pagado)
      .reduce((s, c) => s + Number(c.monto), 0)
    const inicioMes = new Date().toISOString().slice(0, 7)
    const comisionesMes = (comisiones || [])
      .filter((c) => String(c.created_at).slice(0, 7) === inicioMes)
      .reduce((s, c) => s + Number(c.monto), 0)

    // Deuda de cartera
    const { data: saldos } = await supabase
      .from("v_saldo_clientes")
      .select("saldo_actual")
      .in("vendedor_id", session.vendedorIds)
      .gt("saldo_actual", 0)
    const deudaCartera = (saldos || []).reduce((s, x) => s + Number(x.saldo_actual), 0)
    const clientesConDeuda = (saldos || []).length

    return NextResponse.json({
      ventas_por_mes: ventasPorMes,
      top_clientes: topClientes,
      comisiones: { pendientes: comisionesPendientes, generadas_mes: comisionesMes },
      cartera: { deuda_total: deudaCartera, clientes_con_deuda: clientesConDeuda },
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/estadisticas:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
