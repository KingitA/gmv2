import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"
import { hybridSearchIds } from "@/lib/search/hybrid"
import { padEan13 } from "@/lib/utils/ean"
import { getUsuarioActual, getOCrearSesion, getPreparadoresPedido } from "@/lib/deposito/preparadores"

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

    // Sesión de picking POR PERSONA: un pedido lo pueden preparar varios usuarios,
    // cada uno con su sesión (antes había una sola por pedido y el primero que lo
    // abría figuraba como "el" preparador).
    const usuario = await getUsuarioActual(supabase)
    await getOCrearSesion(supabase, pedido_id, usuario)
    if (pedido.estado !== "en_preparacion") {
      await supabase.from("pedidos").update({ estado: "en_preparacion" }).eq("id", pedido_id)
    }

    // Quién preparó cada renglón (para mostrar badges y bloquear los tomados por otro)
    const preparadores = await getPreparadoresPedido(supabase, pedido_id)

    return NextResponse.json({ pedido, preparadores, usuario: { id: usuario.id, nombre: usuario.nombre } })

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
