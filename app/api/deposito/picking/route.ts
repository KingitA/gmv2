import { createClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"

// POST: Crear o retomar sesión de picking para un pedido
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { pedido_id } = await request.json()

    if (!pedido_id) {
      return NextResponse.json({ error: "pedido_id requerido" }, { status: 400 })
    }

    // Verificar que el pedido existe y está en estado válido
    const { data: pedido, error: pedidoError } = await supabase
      .from("pedidos")
      .select(`
        id, numero_pedido, estado,
        pedidos_detalle(
          id, cantidad, articulo_id,
          articulos(id, sku, descripcion, ean13, stock_actual, unidades_por_bulto)
        )
      `)
      .eq("id", pedido_id)
      .in("estado", ["pendiente", "en_preparacion"])
      .single()

    if (pedidoError || !pedido) {
      return NextResponse.json({ error: "Pedido no encontrado o no disponible" }, { status: 404 })
    }

    // Buscar sesión existente o crear nueva
    let { data: sesion } = await supabase
      .from("picking_sesiones")
      .select(`*, picking_items(*)`)
      .eq("pedido_id", pedido_id)
      .single()

    if (!sesion) {
      // Crear nueva sesión
      const { data: nuevaSesion, error: sesionError } = await supabase
        .from("picking_sesiones")
        .insert({ pedido_id, estado: "en_progreso" })
        .select()
        .single()

      if (sesionError) throw sesionError

      // Crear items de picking para cada detalle del pedido
      const pickingItems = pedido.pedidos_detalle.map((det: any) => ({
        sesion_id: nuevaSesion.id,
        pedido_detalle_id: det.id,
        articulo_id: det.articulo_id,
        cantidad_pedida: det.cantidad,
        cantidad_preparada: 0,
        estado: "pendiente",
      }))

      const { error: itemsError } = await supabase
        .from("picking_items")
        .insert(pickingItems)

      if (itemsError) throw itemsError

      // Marcar pedido como en_preparacion
      await supabase
        .from("pedidos")
        .update({ estado: "en_preparacion" })
        .eq("id", pedido_id)

      // Reload sesión con items
      const { data: sesionFull } = await supabase
        .from("picking_sesiones")
        .select(`*, picking_items(*)`)
        .eq("id", nuevaSesion.id)
        .single()

      sesion = sesionFull
    }

    return NextResponse.json({ pedido, sesion })
  } catch (error: any) {
    console.error("[deposito] Error POST picking:", error)
    return NextResponse.json({ error: "Error al iniciar picking" }, { status: 500 })
  }
}

// GET: Buscar artículo por EAN13, SKU o descripción
export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")?.trim()

    if (!q || q.length < 2) {
      return NextResponse.json([])
    }

    // Buscar por EAN13 exacto, SKU exacto, o descripción parcial
    const { data: articulos, error } = await supabase
      .from("articulos")
      .select("id, sku, descripcion, ean13, stock_actual, unidades_por_bulto")
      .or(`ean13.eq.${q},sku.ilike.${q},descripcion.ilike.%${q}%`)
      .eq("activo", true)
      .limit(20)

    if (error) throw error

    return NextResponse.json(articulos || [])
  } catch (error: any) {
    return NextResponse.json({ error: "Error en búsqueda" }, { status: 500 })
  }
}
