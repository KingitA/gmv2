import { createClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { pedido_id } = await request.json()

    if (!pedido_id) {
      return NextResponse.json({ error: "pedido_id requerido" }, { status: 400 })
    }

    // Buscar pedido
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
      return NextResponse.json(
        { error: `Pedido no encontrado: ${pedidoError?.message}` },
        { status: 404 }
      )
    }

    // Buscar sesión existente — solo columnas seguras
    const { data: sesionExistente, error: sesionBusqError } = await supabase
      .from("picking_sesiones")
      .select("id, estado, pedido_id")
      .eq("pedido_id", pedido_id)
      .maybeSingle()

    if (sesionBusqError) {
      return NextResponse.json(
        { error: `Error buscando sesión: ${sesionBusqError.message}` },
        { status: 500 }
      )
    }

    if (sesionExistente) {
      // Cargar items de la sesión existente
      const { data: pickingItems } = await supabase
        .from("picking_items")
        .select("id, pedido_detalle_id, articulo_id, cantidad_pedida, cantidad_preparada, estado, usuario_nombre, fecha_escaneo")
        .eq("sesion_id", sesionExistente.id)

      return NextResponse.json({
        pedido,
        sesion: { ...sesionExistente, picking_items: pickingItems || [] }
      })
    }

    // Crear nueva sesión
    const { data: nuevaSesion, error: sesionError } = await supabase
      .from("picking_sesiones")
      .insert({ pedido_id, estado: "en_progreso" })
      .select("id, estado, pedido_id")
      .single()

    if (sesionError) {
      return NextResponse.json(
        { error: `Error creando sesión: ${sesionError.message} (${sesionError.code})` },
        { status: 500 }
      )
    }

    // Crear items
    const detalles = pedido.pedidos_detalle as any[]
    if (detalles && detalles.length > 0) {
      const pickingItems = detalles.map((det) => ({
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

      if (itemsError) {
        await supabase.from("picking_sesiones").delete().eq("id", nuevaSesion.id)
        return NextResponse.json(
          { error: `Error creando items: ${itemsError.message} (${itemsError.code})` },
          { status: 500 }
        )
      }
    }

    // Marcar pedido en_preparacion
    await supabase.from("pedidos").update({ estado: "en_preparacion" }).eq("id", pedido_id)

    // Recargar items
    const { data: itemsCreados } = await supabase
      .from("picking_items")
      .select("id, pedido_detalle_id, articulo_id, cantidad_pedida, cantidad_preparada, estado, usuario_nombre, fecha_escaneo")
      .eq("sesion_id", nuevaSesion.id)

    return NextResponse.json({
      pedido,
      sesion: { ...nuevaSesion, picking_items: itemsCreados || [] }
    })

  } catch (error: any) {
    return NextResponse.json(
      { error: `Error inesperado: ${error?.message}` },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")?.trim()

    if (!q || q.length < 2) return NextResponse.json([])

    // EAN13 exacto primero
    const { data: porEan } = await supabase
      .from("articulos")
      .select("id, sku, descripcion, ean13, stock_actual, unidades_por_bulto")
      .eq("ean13", q)
      .eq("activo", true)
      .limit(5)

    if (porEan && porEan.length > 0) return NextResponse.json(porEan)

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
