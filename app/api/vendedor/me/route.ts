import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { resumenBilletera } from "@/lib/vendedor/billetera-saldo"
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

    // Saldo de la billetera: el MISMO cálculo que la pantalla Billetera
    // (lib/vendedor/billetera-saldo.ts). Antes había una copia acá que quedó vieja
    // y el inicio mostraba −$674.500 con la billetera en $0 (Freije, 09/10/2026).
    const billetera = await resumenBilletera(supabase, session.vendedorIds)

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
      .select("id, nombre, fecha, estado, zona_id, zonas!zona_id(id, nombre, descripcion), viaje_zonas(zona_id)")
      // Calendario de REPARTO vigente (los viajes se programan a fin del mes anterior)
      .eq("tipo", "reparto")
      .in("estado", ["programado", "despachado", "en_curso"])
      .or(`fecha.gte.${hoy},estado.eq.en_curso`)
      .order("fecha", { ascending: true })
      .limit(8)

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
        // Un viaje puede cubrir varias zonas (viaje_zonas); zona_id es la principal
        mis_clientes_en_zona: [...new Set([v.zona_id, ...((v.viaje_zonas || []).map((z: any) => z.zona_id))])]
          .filter(Boolean)
          .reduce((s: number, z: string) => s + (clientesPorZona.get(z) || 0), 0),
      }))
    }

    return NextResponse.json({
      usuario: usuario || { id: session.user.id, nombre: session.user.email, email: session.user.email },
      vendedores: session.vendedores,
      total_clientes: totalClientes ?? 0,
      ultimos_pedidos: ultimosPedidos || [],
      billetera: { saldo: billetera.saldo, cheques_cantidad: billetera.cheques_cantidad, comisiones_pendientes: comisionesPendientes },
      proximas_zonas: proximasZonas,
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/me:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
