import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()

    const { data: pedidos, error } = await supabase
      .from("pedidos")
      .select(`
        id, numero_pedido, estado, fecha, observaciones, created_at,
        clientes(id, nombre, razon_social, direccion, localidad),
        pedidos_detalle(
          id, cantidad, articulo_id, cantidad_preparada, estado_item,
          articulos(id, sku, descripcion, ean13, proveedores(nombre))
        )
      `)
      .in("estado", ["pendiente", "en_preparacion"])
      .neq("estado", "eliminado")
      .order("created_at", { ascending: true })

    if (error) throw error

    const pedidosConProgreso = (pedidos || []).map(p => {
      const detalles = p.pedidos_detalle || []
      const total = detalles.length
      const resueltos = detalles.filter((d: any) =>
        d.estado_item && d.estado_item !== "PENDIENTE"
      ).length
      return { ...p, progreso: { total, resueltos } }
    })

    return NextResponse.json(pedidosConProgreso)
  } catch (error: any) {
    return NextResponse.json({ error: "Error al obtener pedidos" }, { status: 500 })
  }
}
