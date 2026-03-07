import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const articulo_id = searchParams.get("articulo_id")
    const cliente_id = searchParams.get("cliente_id")
    const pedido_id = searchParams.get("pedido_id")

    if (!articulo_id || !cliente_id) {
      return NextResponse.json({ error: "articulo_id y cliente_id son requeridos" }, { status: 400 })
    }

    // 1. Si hay pedido_id, buscar primero en ese pedido
    if (pedido_id) {
      const { data: itemPedido } = await supabase
        .from("pedidos_detalle")
        .select("precio_final, created_at")
        .eq("pedido_id", pedido_id)
        .eq("articulo_id", articulo_id)
        .single()

      if (itemPedido) {
        return NextResponse.json({
          encontrado: true,
          precio: itemPedido.precio_final,
          fecha: itemPedido.created_at,
          origen: "pedido_actual",
        })
      }
    }

    // 2. Buscar en comprobantes de venta (última vez facturado)
    const { data: ultimaVenta } = await supabase
      .from("comprobantes_venta_detalle")
      .select(
        `
        precio_unitario,
        comprobantes_venta!inner(
          fecha,
          cliente_id
        )
      `
      )
      .eq("articulo_id", articulo_id)
      .eq("comprobantes_venta.cliente_id", cliente_id)
      .order("fecha", { ascending: false, foreignTable: "comprobantes_venta" })
      .limit(1)
      .single()

    if (ultimaVenta) {
      return NextResponse.json({
        encontrado: true,
        precio: ultimaVenta.precio_unitario,
        fecha: (ultimaVenta.comprobantes_venta as any).fecha,
        origen: "ultima_factura",
      })
    }

    // 3. No se le vendió nunca este artículo
    return NextResponse.json({
      encontrado: false,
      mensaje: "No le hemos vendido este artículo",
    })
  } catch (error: any) {
    console.error("[v0] Error buscando último precio:", error)
    return NextResponse.json({ error: error.message || "Error buscando precio" }, { status: 500 })
  }
}
