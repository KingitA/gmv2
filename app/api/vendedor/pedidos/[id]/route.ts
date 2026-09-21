import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { cargarDetallePedido } from "@/lib/vendedor/detalle-pedido"

// GET /api/vendedor/pedidos/[id]
// Detalle de un pedido propio: items con artículo, cliente, totales y la
// CABECERA DE DESCUENTOS con datos reales (lo que efectivamente se aplicó a
// cada renglón + de dónde salió cada %: "solo este pedido" o ficha del cliente).
// 404 si el pedido no existe o no pertenece a un vendedor del usuario.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { id } = await params

    const detalle = await cargarDetallePedido(supabase, session.vendedorIds, id)
    if (!detalle) {
      return NextResponse.json({ error: "Pedido inexistente o no asignado a vos." }, { status: 404 })
    }
    return NextResponse.json(detalle)
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/pedidos/[id]:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
