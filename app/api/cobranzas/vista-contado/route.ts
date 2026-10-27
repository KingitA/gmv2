import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requireAuth } from "@/lib/auth"
import { bonificacionPendientePorComprobante } from "@/lib/cobranzas/bonif-pendiente"

/**
 * POST /api/cobranzas/vista-contado — para que las vistas previas del cobro
 * (/caja y la cuenta agregada del chofer) muestren el MISMO 10 % contado que
 * va a emitir el servidor (R5 de la revisión 27/10). Solo lectura.
 *
 * Body: { cliente_id, comprobante_ids: string[], credito_ids?: string[] }
 * Respuesta:
 *  - bonif: { [comprobante_id]: 10 % del comprobante COMPLETO menos lo ya devuelto };
 *    no figura si ya tiene su 10 % o no es FA/FB/FC/PRES.
 *  - devolucion: ids de los créditos (NC/REV) que son de devolución.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const body = await request.json().catch(() => ({}))
    const clienteId = String(body.cliente_id || "")
    const ids: string[] = Array.isArray(body.comprobante_ids) ? body.comprobante_ids.filter(Boolean) : []
    const creditoIds: string[] = Array.isArray(body.credito_ids) ? body.credito_ids.filter(Boolean) : []
    if (!clienteId) return NextResponse.json({ error: "cliente_id requerido" }, { status: 400 })

    const supabase = await createClient()
    const [bonif, creditos] = await Promise.all([
      bonificacionPendientePorComprobante(supabase as any, clienteId, ids.map((comprobante_id) => ({ comprobante_id, monto_imputado: 0 }))),
      creditoIds.length
        ? supabase.from("comprobantes_venta").select("id, observaciones").in("id", creditoIds)
        : Promise.resolve({ data: [] as { id: string; observaciones: string | null }[] }),
    ])
    const devolucion = ((creditos as any).data || [])
      .filter((c: any) => String(c.observaciones || "").startsWith("Devolución"))
      .map((c: any) => c.id as string)
    return NextResponse.json({ bonif, devolucion })
  } catch (e: any) {
    console.error("[cobranzas/vista-contado]", e?.message)
    return NextResponse.json({ error: e?.message || "Error" }, { status: 500 })
  }
}
