import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { evaluarAnulacionPedido } from "@/lib/pedidos/anulacion-pedido"
import { anularComprobantesPedido, CorteAnulacionPedido } from "@/lib/pedidos/anular-comprobantes-pedido"

// Anular comprobantes del pedido para refacturarlo (#19/#20).
//  GET  → qué se anularía (para el modal): { puede, motivo, aAnular, estado }.
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
    return NextResponse.json(await evaluarAnulacionPedido(createAdminClient(), id))
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
