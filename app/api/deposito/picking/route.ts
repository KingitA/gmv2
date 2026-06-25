import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"
import { hybridSearchIds } from "@/lib/search/hybrid"
import { padEan13 } from "@/lib/utils/ean"

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
          cantidad_preparada, estado_item, es_bonificado,
          articulos(id, sku, descripcion, ean13, unidades_por_bulto, proveedores(nombre))
        )
      `)
      .eq("id", pedido_id)
      .in("estado", ["pendiente", "en_preparacion", "impreso"])
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
    const SELECT = "id, sku, descripcion, ean13, codigo_bulto, stock_actual, unidades_por_bulto, unidad_de_medida, marca:marca_id(descripcion)"

    // EAN13 / codigo_bulto exacto primero (scanner — máxima prioridad)
    if (/^\d{8,14}$/.test(q)) {
      const qPadded = padEan13(q)
      const queries = qPadded !== q ? [qPadded, q] : [qPadded]
      for (const code of queries) {
        const { data: porEan } = await adminSupabase
          .from("articulos")
          .select(SELECT)
          .or(`ean13.cs.{"${code}"},codigo_bulto.eq.${code}`)
          .eq("activo", true)
        if (porEan && porEan.length > 0) return NextResponse.json(porEan)
      }
    }

    // Motor unificado (léxico trigram + vector de fallback)
    const ids = await hybridSearchIds("articulos", q, 50)
    if (ids.length === 0) return NextResponse.json([])

    const { data, error } = await adminSupabase
      .from("articulos")
      .select(SELECT)
      .in("id", ids)
      .eq("activo", true)

    if (error) console.error("[picking] search error:", error.message)

    const map = new Map((data || []).map((r: any) => [r.id, r]))
    return NextResponse.json(ids.map((id) => map.get(id)).filter(Boolean))

  } catch (error: any) {
    console.error("[picking] unexpected error:", error)
    return NextResponse.json([], { status: 200 })
  }
}
