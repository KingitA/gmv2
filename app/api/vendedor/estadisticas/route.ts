import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { fechaISO, hoyISO, sumarDiasISO } from "@/lib/formato"

// GET /api/vendedor/estadisticas
// KPIs del vendedor autenticado: ventas por mes (últimos 6), top clientes
// (90 días), comisiones y deuda total de su cartera. Sin datos de margen/costo.
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()

    // Meses calendario en hora argentina (no UTC): el actual y los 5 anteriores
    const hoy = hoyISO()
    const [anioHoy, mesHoy] = hoy.split("-").map(Number)
    const mesesLista: string[] = []
    for (let i = 5; i >= 0; i--) {
      mesesLista.push(new Date(Date.UTC(anioHoy, mesHoy - 1 - i, 1, 12)).toISOString().slice(0, 7))
    }
    const desdeStr = `${mesesLista[0]}-01`

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
    for (const mes of mesesLista) meses.set(mes, { total: 0, pedidos: 0 })
    for (const p of pedidos || []) {
      const mes = fechaISO(p.fecha).slice(0, 7)
      const m = meses.get(mes)
      if (m) {
        m.total += Number(p.total) || 0
        m.pedidos += 1
      }
    }
    const ventasPorMes = [...meses.entries()].map(([mes, v]) => ({ mes, ...v }))

    // Top clientes últimos 90 días
    const corte90 = sumarDiasISO(hoy, -90)
    const porCliente = new Map<string, { nombre: string; total: number; pedidos: number }>()
    for (const p of pedidos || []) {
      if (fechaISO(p.fecha) < corte90 || !p.cliente_id) continue
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
    const inicioMes = hoy.slice(0, 7)
    const comisionesMes = (comisiones || [])
      .filter((c) => fechaISO(c.created_at).slice(0, 7) === inicioMes)
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
