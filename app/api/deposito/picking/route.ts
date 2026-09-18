import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"
import { hybridSearchIds } from "@/lib/search/hybrid"
import { padEan13 } from "@/lib/utils/ean"
import { abrirPicking, ErrorDeposito } from "@/lib/deposito/picking"

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

    // La lógica vive en lib/deposito/picking.ts (la comparte el outbox de la app)
    return NextResponse.json(await abrirPicking(supabase, pedido_id))

  } catch (error: any) {
    if (error instanceof ErrorDeposito) return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status })
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
