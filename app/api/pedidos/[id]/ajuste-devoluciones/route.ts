import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { planAjusteDevoluciones } from "@/lib/pedidos/ajuste-devoluciones-refacturado"

// P2-43: antes de volver a Generar un pedido refacturado, qué ajuste va a salir
// por cada devolución ya acreditada (estimado con los precios actuales del pedido;
// el definitivo se calcula contra el comprobante emitido).
//  GET → { devoluciones: [{ numero, acreditado, valor_nuevo, ajustes: [{ tipo, total }], texto }] }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermiso("emitir_comprobantes")
  if (auth.error) return auth.error
  try {
    const { id } = await params
    const plan = await planAjusteDevoluciones(createAdminClient() as any, id)
    return NextResponse.json({
      devoluciones: plan.map((p) => ({
        numero: p.numero,
        acreditado: p.acreditado,
        valor_nuevo: p.valor_nuevo,
        ajustes: p.ajustes.map((a) => ({ tipo: a.tipo, total: a.total })),
        texto: p.texto,
      })),
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error calculando el ajuste de las devoluciones" }, { status: 500 })
  }
}
