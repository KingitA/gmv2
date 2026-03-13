import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// GET: Pedidos pendientes o en_preparacion para el depósito
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()

    const { data: pedidos, error } = await supabase
      .from("pedidos")
      .select(`
        id,
        numero_pedido,
        estado,
        fecha,
        observaciones,
        created_at,
        clientes(id, nombre, razon_social),
        pedidos_detalle(
          id,
          cantidad,
          articulo_id,
          articulos(id, sku, descripcion, ean13, stock_actual, unidades_por_bulto)
        )
      `)
      .in("estado", ["pendiente", "en_preparacion"])
      .neq("estado", "eliminado")
      .order("created_at", { ascending: true })

    if (error) throw error

    // Enrich with picking session progress
    const pedidosConProgreso = await Promise.all(
      (pedidos || []).map(async (pedido) => {
        const { data: sesion } = await supabase
          .from("picking_sesiones")
          .select(`
            id,
            estado,
            fecha_inicio,
            picking_items(
              id,
              pedido_detalle_id,
              articulo_id,
              cantidad_pedida,
              cantidad_preparada,
              estado,
              usuario_nombre,
              fecha_escaneo
            )
          `)
          .eq("pedido_id", pedido.id)
          .single()

        const totalItems = pedido.pedidos_detalle?.length || 0
        const itemsPreparados = sesion?.picking_items?.filter(
          (i: any) => i.estado === "preparado" || i.estado === "faltante"
        ).length || 0

        return {
          ...pedido,
          sesion: sesion || null,
          progreso: { total: totalItems, completados: itemsPreparados },
        }
      })
    )

    return NextResponse.json(pedidosConProgreso)
  } catch (error: any) {
    console.error("[deposito] Error GET pedidos:", error)
    return NextResponse.json({ error: "Error al obtener pedidos" }, { status: 500 })
  }
}
