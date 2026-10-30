import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { evaluarAnulacionPedido } from "@/lib/pedidos/anulacion-pedido"
import { anularComprobantesPedido, CorteAnulacionPedido } from "@/lib/pedidos/anular-comprobantes-pedido"
import { devolucionesDelPedido } from "@/lib/pedidos/ajuste-devoluciones-refacturado"

// Anular comprobantes del pedido para refacturarlo (#19/#20).
//  GET  → qué se anularía (para el modal): { puede, motivo, aAnular, estado,
//         devoluciones } (P2-43: lo devuelto sale del comprobante nuevo y su crédito se neutraliza).
//  POST → anula todo junto, en orden; el pedido vuelve a Pendiente Facturación.
//         Responde { anulados, a_favor, estado_pedido, advertencias }. Si se
//         corta a la mitad: { error, error_code, anulados, pendientes } y
//         volviendo a llamar sigue desde lo que quedó vivo.
// Mismo permiso que emitir: si hay FA/FB, esto emite NC con CAE en ARCA.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermiso("emitir_comprobantes")
  if (auth.error) return auth.error
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const [evaluacion, devoluciones] = await Promise.all([evaluarAnulacionPedido(supabase, id), devolucionesDelPedido(supabase as any, id)])
    return NextResponse.json({ ...evaluacion, devoluciones })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error evaluando el pedido" }, { status: 500 })
  }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermiso("emitir_comprobantes")
  if (auth.error) return auth.error
  try {
    const { id } = await params
    return NextResponse.json(await anularComprobantesPedido(createAdminClient(), id, auth.user.id))
  } catch (error: any) {
    if (error instanceof CorteAnulacionPedido) return NextResponse.json(error.body, { status: error.status })
    console.error("[pedidos/anular-comprobantes] Error:", error)
    return NextResponse.json({ error: error.message || "Error anulando los comprobantes del pedido" }, { status: 500 })
  }
}
