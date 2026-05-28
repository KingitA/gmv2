import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// GET /api/chofer/articulo/precio-historico?clienteId=&articuloId=
// Retorna el último precio de venta de un artículo para un cliente específico.
// Usado para calcular el precio de devoluciones de mercadería vieja.
export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("clienteId")
    const articuloId = searchParams.get("articuloId")

    if (!clienteId || !articuloId) {
      return NextResponse.json({ error: "clienteId y articuloId son requeridos" }, { status: 400 })
    }

    // Buscar en kardex: última venta de este artículo a este cliente
    const { data: kardex } = await supabase
      .from("kardex")
      .select("precio_unitario_final, fecha, numero_comprobante, tipo_comprobante")
      .eq("cliente_id", clienteId)
      .eq("articulo_id", articuloId)
      .eq("tipo_movimiento", "venta")
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (kardex) {
      return NextResponse.json({
        precio: Number(kardex.precio_unitario_final),
        fecha: kardex.fecha,
        comprobante: kardex.numero_comprobante,
        tipo_comprobante: kardex.tipo_comprobante,
        fuente: "kardex",
      })
    }

    // Fallback: buscar en comprobantes_venta_detalle
    const { data: detalle } = await supabase
      .from("comprobantes_venta_detalle")
      .select(`
        precio_unitario, created_at,
        comprobante:comprobantes_venta!inner(
          cliente_id, fecha, numero_comprobante, tipo_comprobante
        )
      `)
      .eq("articulo_id", articuloId)
      .eq("comprobantes_venta.cliente_id", clienteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (detalle) {
      return NextResponse.json({
        precio: Number(detalle.precio_unitario),
        fecha: (detalle.comprobante as any)?.fecha,
        comprobante: (detalle.comprobante as any)?.numero_comprobante,
        tipo_comprobante: (detalle.comprobante as any)?.tipo_comprobante,
        fuente: "comprobante",
      })
    }

    return NextResponse.json({
      precio: null,
      mensaje: "No se encontraron ventas previas de este artículo al cliente",
    })
  } catch (error: any) {
    console.error("[chofer] Error en precio-historico:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
