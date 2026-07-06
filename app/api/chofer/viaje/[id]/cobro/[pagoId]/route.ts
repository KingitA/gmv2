import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { anularCobranza } from "@/lib/actions/cobranzas"

/**
 * DELETE /api/chofer/viaje/[id]/cobro/[pagoId]
 *
 * El chofer anula un cobro propio mientras esté 'pendiente_rendicion' y su
 * rendición no haya sido confirmada (Fase C). La reversa completa (billetera,
 * cheques, imputaciones) la hace el RPC cobranza_anular.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pagoId: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { id: viajeId, pagoId } = await params

    const { data: viaje } = await supabase
      .from("viajes")
      .select("id, chofer_id, estado")
      .eq("id", viajeId)
      .single()
    if (!viaje || viaje.chofer_id !== auth.user.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    const { data: pago } = await supabase
      .from("pagos_clientes")
      .select("id, estado, viaje_id")
      .eq("id", pagoId)
      .single()
    if (!pago || pago.viaje_id !== viajeId) {
      return NextResponse.json({ error: "Pago no encontrado en este viaje" }, { status: 404 })
    }
    if (pago.estado !== "pendiente_rendicion") {
      return NextResponse.json(
        { error: `El cobro ya fue ${pago.estado === "confirmado" ? "rendido y confirmado" : pago.estado} — no se puede eliminar` },
        { status: 409 }
      )
    }

    // ¿Está en una rendición confirmada? (abierta se puede: el item quedará sin pago válido)
    const { data: enRendicion } = await supabase
      .from("rendicion_items")
      .select("rendicion_id, rendiciones!inner(estado)")
      .eq("pago_id", pagoId)
      .eq("rendiciones.estado", "confirmada")
      .limit(1)
    if (enRendicion?.length) {
      return NextResponse.json({ error: "El cobro pertenece a una rendición confirmada" }, { status: 409 })
    }

    await anularCobranza(supabase, {
      pagoId,
      usuarioId: auth.user.id,
      motivo: "Corrección del chofer antes de rendir",
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[chofer/cobro] DELETE error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
