import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { confirmarCobranza } from "@/lib/actions/cobranzas"

// POST /api/pagos/confirmar-lote
// Rendición en lote: confirma varios pagos pendientes de una sola vez (rendición
// de vendedor/chofer o verificación masiva en oficina). Usa la confirmación única.
// Body: { pago_ids?: string[], vendedor_id?: string }
//  - pago_ids: confirma esos pagos.
//  - vendedor_id: confirma todos los pendientes (pendiente | pendiente_rendicion) del vendedor.
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    const { pago_ids, vendedor_id } = await request.json()

    let ids: string[] = Array.isArray(pago_ids) ? pago_ids : []

    if (!ids.length && vendedor_id) {
      const { data } = await supabase
        .from("pagos_clientes")
        .select("id")
        .eq("vendedor_id", vendedor_id)
        .in("estado", ["pendiente", "pendiente_rendicion"])
      ids = (data || []).map((p: any) => p.id)
    }

    if (!ids.length) {
      return NextResponse.json({ error: "No hay pagos para confirmar" }, { status: 400 })
    }

    const confirmados: string[] = []
    const errores: string[] = []
    for (const pagoId of ids) {
      try {
        const r = await confirmarCobranza(supabase, admin, { pagoId, usuarioId: auth.user.id })
        confirmados.push(r.numero_recibo || pagoId)
      } catch (e: any) {
        errores.push(`${pagoId}: ${e.message}`)
      }
    }

    return NextResponse.json({ success: true, confirmados, errores })
  } catch (error: any) {
    console.error("[confirmar-lote] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
