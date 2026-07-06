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

    return NextResponse.json({
      usuario: usuario || { id: session.user.id, nombre: session.user.email, email: session.user.email },
      vendedores: session.vendedores,
      total_clientes: totalClientes ?? 0,
      ultimos_pedidos: ultimosPedidos || [],
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/me:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
