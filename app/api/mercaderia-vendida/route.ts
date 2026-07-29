import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const supabase = await createClient()
    const searchParams = request.nextUrl.searchParams
    const cliente_id = searchParams.get("cliente_id")
    const fecha_desde = searchParams.get("fecha_desde")
    const fecha_hasta = searchParams.get("fecha_hasta")
    const articulo_id = searchParams.get("articulo_id")

    if (!cliente_id) {
      return NextResponse.json({ error: "Se requiere cliente_id" }, { status: 400 })
    }

    // Construir query — pedidos!inner para que los filtros sobre el embed
    // realmente excluyan las filas padre (sin !inner, PostgREST solo anula el embed)
    const ventas = await fetchAllRows(() => {
      let query = supabase
        .from("pedidos_detalle")
        .select(`
        *,
        pedidos!inner (
          numero_pedido,
          fecha,
          estado
        ),
        articulos (
          descripcion,
          sku,
          ean13
        )
      `)
        .eq("pedidos.cliente_id", cliente_id)

      if (fecha_desde) {
        query = query.gte("pedidos.fecha", fecha_desde)
      }

      if (fecha_hasta) {
        query = query.lte("pedidos.fecha", fecha_hasta)
      }

      if (articulo_id) {
        query = query.eq("articulo_id", articulo_id)
      }

      return query.order("pedidos.fecha", { ascending: false })
    })

    return NextResponse.json({
      success: true,
      ventas,
    })
  } catch (error: any) {
    console.error("[v0] Error obteniendo mercadería vendida:", error)
    return NextResponse.json({ error: error.message || "Error obteniendo mercadería vendida" }, { status: 500 })
  }
}
