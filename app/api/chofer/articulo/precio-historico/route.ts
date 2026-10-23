import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { resolverOrigenesDevolucion } from "@/lib/cobranzas/origen-devolucion"

// GET /api/chofer/articulo/precio-historico?clienteId=&articuloId=[&pedidoId=]
// Precio y comprobante de origen de un artículo que el cliente devuelve (regla
// del dueño 21/10/2026, lib/cobranzas/origen-devolucion.ts):
//  - si está en un comprobante del sistema (o en el del pedido que se entrega):
//    el precio FACTURADO (neto si fue factura) y ese comprobante;
//  - si no: el comprobante más reciente del cliente del tipo que corresponde y
//    el precio actual del cliente (neto si va por factura), editable.
// `origen` + `alicuota_iibb` alcanzan para valuar con valorDevolucionConOrigen.
export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("clienteId")
    const articuloId = searchParams.get("articuloId")
    const pedidoId = searchParams.get("pedidoId")

    if (!clienteId || !articuloId) {
      return NextResponse.json({ error: "clienteId y articuloId son requeridos" }, { status: 400 })
    }

    const { origenes, contexto } = await resolverOrigenesDevolucion(supabase as any, clienteId, [articuloId], { pedidoId })
    const o = origenes.get(articuloId)!
    const precio = o.exacto ? o.precio : o.precio_sugerido
    return NextResponse.json({
      precio: precio ?? null,
      comprobante: o.numero_comprobante,
      tipo_comprobante: o.tipo_comprobante,
      comprobante_venta_id: o.comprobante_venta_id,
      fuente: o.exacto ? "comprobante" : "vigente",
      origen: o,
      alicuota_iibb: contexto.alicuota_iibb,
      ...(precio == null ? { mensaje: "No se pudo calcular el precio: cargalo a mano." } : {}),
    })
  } catch (error: any) {
    console.error("[chofer] Error en precio-historico:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
