import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { devolucionesDelPedido } from "@/lib/pedidos/ajuste-devoluciones-refacturado"

// P2-43: antes de volver a Generar un pedido refacturado, qué artículos no van al
// comprobante nuevo por estar devueltos (aplicados al anular).
//  GET → { devoluciones: [{ numero, articulos, aparte, fiscal, texto }] }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermiso("emitir_comprobantes")
  if (auth.error) return auth.error
  try {
    const { id } = await params
    return NextResponse.json({ devoluciones: await devolucionesDelPedido(createAdminClient() as any, id, { anulados: true }) })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error revisando las devoluciones del pedido" }, { status: 500 })
  }
}
