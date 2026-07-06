import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/me
// Identidad del vendedor autenticado: usuario, registros de vendedor
// vinculados y resumen (cantidad de clientes, últimos pedidos).
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()

    const { data: usuario } = await supabase
      .from("usuarios")
      .select("id, nombre, email")
      .eq("id", session.user.id)
      .single()

    const { count: totalClientes } = await supabase
      .from("clientes")
      .select("id", { count: "exact", head: true })
      .in("vendedor_id", session.vendedorIds)

    const { data: ultimosPedidos } = await supabase
      .from("pedidos")
      .select("id, numero_pedido, fecha, estado, total, clientes(id, nombre)")
      .in("vendedor_id", session.vendedorIds)
      .is("eliminado_at", null)
      .order("fecha", { ascending: false })
      .limit(5)

    // Resumen de billetera (plata en la calle + comisiones pendientes)
    const { data: movs } = await supabase
      .from("billetera_movimientos")
      .select("monto")
      .in("viajante_id", session.vendedorIds)
    const billeteraSaldo = (movs || []).reduce((s, m) => s + Number(m.monto), 0)

    const { data: comisiones } = await supabase
      .from("comisiones")
      .select("monto")
      .in("viajante_id", session.vendedorIds)
      .eq("tipo", "cobrada")
      .eq("pagado", false)
    const comisionesPendientes = (comisiones || []).reduce((s, c) => s + Number(c.monto), 0)

    // Próximas zonas: viajes vigentes (hoy en adelante o en curso) con la
    // cantidad de clientes del vendedor en cada zona (vía localidades)
    const hoy = new Date().toISOString().slice(0, 10)
    const { data: viajes } = await supabase
      .from("viajes")
      .select("id, nombre, fecha, estado, zona_id, zonas(id, nombre, descripcion)")
      .or(`fecha.gte.${hoy},estado.eq.en_curso`)
      .order("fecha", { ascending: true })
      .limit(5)

    let proximasZonas: any[] = viajes || []
    if (proximasZonas.length) {
      const { data: misClientes } = await supabase
        .from("clientes")
        .select("localidad_id, localidades:localidad_id(zona_id)")
        .in("vendedor_id", session.vendedorIds)
        .eq("activo", true)
        .not("localidad_id", "is", null)
      const clientesPorZona = new Map<string, number>()
      for (const c of misClientes || []) {
        const zonaId = (c.localidades as any)?.zona_id
        if (zonaId) clientesPorZona.set(zonaId, (clientesPorZona.get(zonaId) || 0) + 1)
      }
      proximasZonas = proximasZonas.map((v) => ({
        ...v,
        mis_clientes_en_zona: v.zona_id ? clientesPorZona.get(v.zona_id) || 0 : 0,
      }))
    }

    return NextResponse.json({
      usuario: usuario || { id: session.user.id, nombre: session.user.email, email: session.user.email },
      vendedores: session.vendedores,
      total_clientes: totalClientes ?? 0,
      ultimos_pedidos: ultimosPedidos || [],
      billetera: { saldo: billeteraSaldo, comisiones_pendientes: comisionesPendientes },
      proximas_zonas: proximasZonas,
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/me:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
