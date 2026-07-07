import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/pedidos/[id]
// Detalle de un pedido propio: items con artículo, cliente y totales.
// 404 si el pedido no existe o no pertenece a un vendedor del usuario.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { id } = await params

    const { data: pedido, error } = await supabase
      .from("pedidos")
      .select(
        `id, numero_pedido, fecha, estado, total, observaciones, metodo_facturacion_pedido, vendedor_id, cliente_id, created_at,
         clientes:cliente_id(id, nombre, localidad, metodo_facturacion),
         pedidos_detalle(id, articulo_id, cantidad, precio_base, precio_final, subtotal, es_bonificado, estado_item,
           articulos:articulo_id(id, sku, descripcion, unidades_por_bulto, imagen_url))`
      )
      .eq("id", id)
      .is("eliminado_at", null)
      .maybeSingle()

    if (error) throw error
    if (!pedido || !session.vendedorIds.includes((pedido as any).vendedor_id)) {
      return NextResponse.json({ error: "Pedido inexistente o no asignado a vos." }, { status: 404 })
    }

    return NextResponse.json({ pedido })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/pedidos/[id]:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
