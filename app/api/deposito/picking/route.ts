import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"
import { searchProductsByVector } from "@/lib/actions/embeddings"

// POST: Iniciar o retomar sesión de picking para un pedido
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { pedido_id } = await request.json()

    if (!pedido_id) {
      return NextResponse.json({ error: "pedido_id requerido" }, { status: 400 })
    }

    // Obtener pedido con sus detalles (usando campos reales de pedidos_detalle)
    const { data: pedido, error: pedidoError } = await supabase
      .from("pedidos")
      .select(`
        id, numero_pedido, estado,
        clientes(id, nombre, razon_social),
        pedidos_detalle(
          id, cantidad, articulo_id,
          cantidad_preparada, estado_item,
          articulos(id, sku, descripcion, ean13, unidades_por_bulto, proveedores(nombre))
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

    // Obtener usuario
    const { data: { user } } = await supabase.auth.getUser()
    const usuarioEmail = user?.email || "deposito@sistema"
    const usuarioId = user?.id || null

    // Buscar sesión existente para este pedido
    const { data: sesionExistente } = await supabase
      .from("picking_sesiones")
      .select("id, estado, usuario_email")
      .eq("pedido_id", pedido_id)
      .eq("estado", "EN_PROGRESO")
      .maybeSingle()

    if (!sesionExistente) {
      // Crear nueva sesión usando estructura real de la tabla
      const { error: sesionError } = await supabase
        .from("picking_sesiones")
        .insert({
          pedido_id,
          usuario_id: usuarioId,
          usuario_email: usuarioEmail,
          estado: "EN_PROGRESO",
        })

      if (sesionError) {
        return NextResponse.json(
          { error: `Error creando sesión: ${sesionError.message}` },
          { status: 500 }
        )
      }

      // Marcar pedido como en_preparacion
      await supabase.from("pedidos").update({ estado: "en_preparacion" }).eq("id", pedido_id)
    }

    return NextResponse.json({ pedido })

  } catch (error: any) {
    return NextResponse.json({ error: `Error: ${error?.message}` }, { status: 500 })
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

    if (!q || q.length < 2) return NextResponse.json([])

    const adminSupabase = createAdminClient()
    const SELECT = "id, sku, descripcion, ean13, cantidad_stock, unidades_por_bulto, unidad_de_medida"

    // EAN13 exacto primero (scanner — máxima prioridad, no mezclar con vector)
    const { data: porEan } = await supabase
      .from("articulos")
      .select(SELECT)
      .contains("ean13", [q])
      .eq("activo", true)
      .limit(5)

    if (porEan && porEan.length > 0) return NextResponse.json(porEan)

    const [{ data: textResults, error }, vectorResults] = await Promise.all([
      adminSupabase
        .from("articulos")
        .select(SELECT)
        .or(`sku.ilike.%${q}%,descripcion.ilike.%${q}%`)
        .eq("activo", true)
        .limit(20),
      searchProductsByVector(q, 0.35, 20),
    ])

    if (error) throw error

    const textIds = new Set((textResults || []).map((r: any) => r.id))
    const merged = [
      ...(textResults || []),
      ...vectorResults.filter((r: any) => !textIds.has(r.id)),
    ].slice(0, 20)

    return NextResponse.json(merged)

  } catch (error: any) {
    return NextResponse.json({ error: "Error en búsqueda" }, { status: 500 })
  }
}
