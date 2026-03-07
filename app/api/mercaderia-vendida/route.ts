import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'

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

    // Construir query
    let query = supabase
      .from("pedidos_detalle")
      .select(`
        *,
        pedidos (
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

    const { data: ventas, error: ventasError } = await query.order("pedidos.fecha", { ascending: false })

    if (ventasError) throw ventasError

    return NextResponse.json({
      success: true,
      ventas,
    })
  } catch (error: any) {
    console.error("[v0] Error obteniendo mercadería vendida:", error)
    return NextResponse.json({ error: error.message || "Error obteniendo mercadería vendida" }, { status: 500 })
  }
}
