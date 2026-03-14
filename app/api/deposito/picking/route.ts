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

    const { data: pedido, error: pedidoError } = await supabase
      .from("pedidos")
      .select(`
        id, numero_pedido, estado,
        clientes(id, nombre, razon_social),
        pedidos_detalle(
          id, cantidad, articulo_id,
          articulos(id, sku, descripcion, ean13, stock_actual, unidades_por_bulto)
        )
      `)
      .eq("id", pedido_id)
      .in("estado", ["pendiente", "en_preparacion"])
      .single()

    if (pedidoError || !pedido) {
      return NextResponse.json({ error: "Pedido no encontrado o no disponible para picking" }, { status: 404 })
    }

    // Buscar sesión existente
    const { data: sesionExistente } = await supabase
      .from("picking_sesiones")
      .select(`
        id, estado, fecha_inicio,
        picking_items(
          id, pedido_detalle_id, articulo_id,
          cantidad_pedida, cantidad_preparada,
          estado, usuario_nombre, fecha_escaneo
        )
      `)
      .eq("pedido_id", pedido_id)
      .single()

    if (sesionExistente) {
      return NextResponse.json({ pedido, sesion: sesionExistente })
    }

    // Crear nueva sesión
    const { data: nuevaSesion, error: sesionError } = await supabase
      .from("picking_sesiones")
      .insert({ pedido_id, estado: "en_progreso" })
      .select()
      .single()

    if (sesionError) {
      console.error("[picking] Error creando sesión:", sesionError)
      return NextResponse.json(
        { error: "Error al crear sesión. Verificá que la migración 092 fue ejecutada en Supabase." },
        { status: 500 }
      )
    }

    const pickingItems = (pedido.pedidos_detalle as any[]).map((det) => ({
      sesion_id: nuevaSesion.id,
      pedido_detalle_id: det.id,
      articulo_id: det.articulo_id,
      cantidad_pedida: det.cantidad,
      cantidad_preparada: 0,
      estado: "pendiente",
    }))

    if (pickingItems.length > 0) {
      const { error: itemsError } = await supabase.from("picking_items").insert(pickingItems)
      if (itemsError) {
        console.error("[picking] Error creando items:", itemsError)
        return NextResponse.json({ error: "Error al crear items de picking" }, { status: 500 })
      }
    }

    await supabase.from("pedidos").update({ estado: "en_preparacion" }).eq("id", pedido_id)

    const { data: sesionFull } = await supabase
      .from("picking_sesiones")
      .select(`
        id, estado, fecha_inicio,
        picking_items(
          id, pedido_detalle_id, articulo_id,
          cantidad_pedida, cantidad_preparada,
          estado, usuario_nombre, fecha_escaneo
        )
      `)
      .eq("id", nuevaSesion.id)
      .single()

    return NextResponse.json({ pedido, sesion: sesionFull })
  } catch (error: any) {
    console.error("[deposito] Error POST picking:", error)
    return NextResponse.json(
      { error: "Error al iniciar picking: " + (error?.message || "desconocido") },
      { status: 500 }
    )
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

    // EAN13 exacto primero
    const { data: porEan } = await supabase
      .from("articulos")
      .select("id, sku, descripcion, ean13, stock_actual, unidades_por_bulto")
      .eq("ean13", q)
      .eq("activo", true)
      .limit(5)

    if (porEan && porEan.length > 0) {
      return NextResponse.json(porEan)
    }

    const { data: articulos, error } = await supabase
      .from("articulos")
      .select("id, sku, descripcion, ean13, stock_actual, unidades_por_bulto")
      .or(`sku.ilike.%${q}%,descripcion.ilike.%${q}%`)
      .eq("activo", true)
      .limit(20)

    if (error) throw error

    return NextResponse.json(articulos || [])
  } catch (error: any) {
    return NextResponse.json({ error: "Error en búsqueda" }, { status: 500 })
  }
}
