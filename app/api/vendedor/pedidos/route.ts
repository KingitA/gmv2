import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/pedidos?q=&estado=&cliente=
// Pedidos de los clientes de los vendedores del usuario.
export async function GET(request: Request) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado")?.trim() || ""
    const clienteId = searchParams.get("cliente")?.trim() || ""
    const q = searchParams.get("q")?.trim() || ""

    let query = supabase
      .from("pedidos")
      .select("id, numero_pedido, fecha, estado, total, observaciones, clientes(id, nombre)")
      .in("vendedor_id", session.vendedorIds)
      .is("eliminado_at", null)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100)

    if (estado) query = query.eq("estado", estado)
    if (clienteId) query = query.eq("cliente_id", clienteId)

    const { data: pedidos, error } = await query
    if (error) throw error

    let resultado = pedidos || []
    if (q) {
      const term = q.toLowerCase()
      resultado = resultado.filter(
        (p: any) =>
          p.clientes?.nombre?.toLowerCase().includes(term) ||
          p.numero_pedido?.toLowerCase().includes(term)
      )
    }

    return NextResponse.json({ pedidos: resultado })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/pedidos:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
