import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * POST /api/cheques/[id]/rechazar
 *
 * Desde Fase A2 todo el rechazo es atómico en el RPC `cheque_rechazar`:
 * - Si el pago origen estaba SIN confirmar → rechaza el pago, sin ND ni
 *   libro mayor (la versión anterior generaba deuda duplicada).
 * - Si estaba confirmado → ND (numeración transaccional) + libro mayor +
 *   kardex, con gastos bancarios opcionales incluidos en el débito.
 *
 * Body: { motivo_rechazo?, observaciones?, gastos? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id: chequeId } = await params
    const body = await request.json().catch(() => ({}))
    const { motivo_rechazo, observaciones, gastos } = body

    const motivo = [motivo_rechazo, observaciones].filter(Boolean).join(". ")

    const { data, error } = await supabase.rpc("cheque_rechazar", {
      p_cheque_id: chequeId,
      p_usuario_id: auth.user.id,
      p_motivo: motivo || null,
      p_gastos: Number(gastos) || 0,
    })
    if (error) {
      const status = error.message?.includes("no encontrado") ? 404 : 500
      return NextResponse.json({ error: error.message }, { status })
    }

    if (data?.ya_rechazado) {
      return NextResponse.json({ error: "El cheque ya fue rechazado" }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      cheque_id: chequeId,
      pago_rechazado: data?.pago_rechazado ?? false,
      nd_generada: data?.nd_generada ?? false,
      numero_nd: data?.numero_nd ?? null,
      total_debitado: data?.total_debitado ?? null,
      mensaje: data?.mensaje,
    })
  } catch (error: any) {
    console.error("[cheques/rechazar] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
