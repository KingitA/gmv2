import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/clientes?q=&localidad=&filtro=todos|con_deuda|sin_rendir
// Clientes asignados a los vendedores del usuario, con saldo real
// (v_saldo_clientes) y cantidad de pagos pendientes de rendición.
export async function GET(request: Request) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")?.trim() || ""
    const localidad = searchParams.get("localidad")?.trim() || ""
    const filtro = searchParams.get("filtro") || "todos"

    let query = supabase
      .from("clientes")
      .select("id, nombre, cuit, localidad, condicion_pago, metodo_facturacion, vendedor_id")
      .in("vendedor_id", session.vendedorIds)
      .eq("activo", true)
      .order("nombre")

    if (q) query = query.or(`nombre.ilike.%${q}%,cuit.ilike.%${q}%,razon_social.ilike.%${q}%`)
    if (localidad) query = query.eq("localidad", localidad)

    const { data: clientes, error } = await query
    if (error) throw error

    const ids = (clientes || []).map((c) => c.id)

    // Saldos reales desde el libro mayor
    const saldoPorCliente = new Map<string, number>()
    if (ids.length) {
      const { data: saldos } = await supabase
        .from("v_saldo_clientes")
        .select("cliente_id, saldo_actual")
        .in("cliente_id", ids)
      for (const s of saldos || []) saldoPorCliente.set(s.cliente_id, Number(s.saldo_actual) || 0)
    }

    // Pagos de este vendedor pendientes de rendición
    const sinRendirPorCliente = new Map<string, number>()
    if (ids.length) {
      const { data: pagos } = await supabase
        .from("pagos_clientes")
        .select("cliente_id")
        .in("cliente_id", ids)
        .eq("estado", "pendiente_rendicion")
        .eq("creado_por", session.user.id)
      for (const p of pagos || [])
        sinRendirPorCliente.set(p.cliente_id, (sinRendirPorCliente.get(p.cliente_id) || 0) + 1)
    }

    let resultado = (clientes || []).map((c) => ({
      ...c,
      saldo_actual: saldoPorCliente.get(c.id) ?? 0,
      pagos_sin_rendir: sinRendirPorCliente.get(c.id) ?? 0,
    }))

    if (filtro === "con_deuda") resultado = resultado.filter((c) => c.saldo_actual > 0)
    if (filtro === "sin_rendir") resultado = resultado.filter((c) => c.pagos_sin_rendir > 0)

    // Localidades disponibles para los chips de filtro (sobre el total sin filtrar)
    const { data: locs } = await supabase
      .from("clientes")
      .select("localidad")
      .in("vendedor_id", session.vendedorIds)
      .eq("activo", true)
      .not("localidad", "is", null)
    const localidades = [...new Set((locs || []).map((l) => l.localidad).filter(Boolean))].sort()

    return NextResponse.json({ clientes: resultado, localidades })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/clientes:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
