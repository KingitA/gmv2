import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { getSaldosClientes } from "@/lib/cuenta-corriente/saldo"
import { requireVendedor } from "@/lib/vendedor/session"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { fechaISO, hoyISO, sumarDiasISO } from "@/lib/formato"
import { idsClientesEmpleados } from "@/lib/personal/empleados"
import { cuentaPersonalDe, resumenCuentaPersonal } from "@/lib/cuenta-corriente/cuenta-personal"
import { startOfDayArgentina } from "@/lib/utils"

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

    let comisionesPendientes = 0
    let comisionesMes = 0
    // Comisiones — R10 (27/10): desde la etapa 3 lo GANADO está en la cuenta
    // personal del vendedor (renglones 'comision', lib/comisiones/liquidar.ts);
    // la tabla vieja `comisiones` ya no se escribe y daba $0. "Pend. retiro" =
    // lo que tiene a favor en su cuenta (= "Para retirar" de la billetera).
    const inicioMes = hoy.slice(0, 7)
    const cuentaId = await cuentaPersonalDe(supabase, { usuarioId: session.user.id, vendedorIds: session.vendedorIds })
    if (cuentaId) {
      const [resumen, movsMes] = await Promise.all([
        resumenCuentaPersonal(supabase, cuentaId),
        fetchAllRows<{ debe: number; haber: number }>(() =>
          supabase
            .from("cuenta_corriente_clientes")
            .select("debe, haber")
            .eq("cliente_id", cuentaId)
            .eq("tipo_movimiento", "comision")
            .gte("fecha", startOfDayArgentina(`${inicioMes}-01`)),
        ),
      ])
      comisionesPendientes = resumen.a_favor
      comisionesMes = Math.round(movsMes.reduce((s, m) => s + Number(m.haber || 0) - Number(m.debe || 0), 0) * 100) / 100
    } else {
      const comisiones = await fetchAllRows(() =>
        supabase
          .from("comisiones")
          .select("monto, pagado, tipo, created_at")
          .in("viajante_id", session.vendedorIds)
          .eq("tipo", "cobrada")
      )
      comisionesPendientes = (comisiones || [])
        .filter((c) => !c.pagado)
        .reduce((s, c) => s + Number(c.monto), 0)
      comisionesMes = (comisiones || [])
        .filter((c) => fechaISO(c.created_at).slice(0, 7) === inicioMes)
        .reduce((s, c) => s + Number(c.monto), 0)
    }

    // Deuda de cartera: saldo PROYECTADO desde la fuente única (lo que ve el
    // vendedor en cada cliente), solo los que deben. Sin las cuentas de
    // empleados (clientes.es_empleado): no son deuda de clientes.
    const [carteraTodos, empleados] = await Promise.all([
      fetchAllRows<{ id: string }>(() =>
        supabase.from("clientes").select("id").in("vendedor_id", session.vendedorIds),
      ),
      idsClientesEmpleados(supabase),
    ])
    const cartera = carteraTodos.filter((c) => !empleados.has(c.id))
    const saldosCartera = await getSaldosClientes(supabase, cartera.map((c) => c.id))
    const deudores = [...saldosCartera.values()].filter((s) => s.saldo_proyectado > 0.005)
    const deudaCartera = Math.round(deudores.reduce((s, x) => s + x.saldo_proyectado, 0) * 100) / 100
    const clientesConDeuda = deudores.length

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
