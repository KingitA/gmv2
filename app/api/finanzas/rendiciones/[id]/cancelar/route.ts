import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * POST /api/finanzas/rendiciones/[id]/cancelar — cancela una rendición ABIERTA
 * que quedó sin pagos vigentes (todos rechazados/anulados/confirmados por otra
 * vía). Sin esto la rendición quedaba "en viaje" para siempre del lado del
 * cobrador e invisible para la oficina.
 *
 * Solo cancela si NO quedan pagos en pendiente/pendiente_rendicion: una
 * rendición con plata real en viaje se resuelve confirmándola o rechazando
 * sus pagos uno a uno, nunca cancelándola entera.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id: rendicionId } = await params

    const { data: rend, error: rendErr } = await supabase
      .from("rendiciones")
      .select("id, estado, rendicion_items(pago_id)")
      .eq("id", rendicionId)
      .single()
    if (rendErr || !rend) {
      return NextResponse.json({ error: "Rendición no encontrada" }, { status: 404 })
    }
    if (rend.estado !== "abierta") {
      return NextResponse.json(
        { error: `La rendición está ${rend.estado} — solo se cancela una abierta` },
        { status: 400 }
      )
    }

    const pagoIds = (rend.rendicion_items || []).map((i: any) => i.pago_id).filter(Boolean)
    if (pagoIds.length) {
      const { data: vigentes } = await supabase
        .from("pagos_clientes")
        .select("id")
        .in("id", pagoIds)
        .in("estado", ["pendiente", "pendiente_rendicion"])
        .limit(1)
      if (vigentes?.length) {
        return NextResponse.json(
          { error: "La rendición tiene pagos vigentes — confirmala o rechazá los pagos uno a uno." },
          { status: 409 }
        )
      }
    }

    const { error: updErr } = await supabase
      .from("rendiciones")
      .update({
        estado: "cancelada",
        observaciones: `Cancelada por oficina: sin pagos vigentes (${new Date().toISOString().slice(0, 10)})`,
      })
      .eq("id", rendicionId)
      .eq("estado", "abierta")
    if (updErr) throw updErr

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[rendiciones/cancelar] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
