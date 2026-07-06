import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * POST /api/cheques/[id]/depositar — EN_CARTERA → DEPOSITADO vía RPC
 * `caja_depositar_cheque` (Fase B2). El saldo del banco se acredita recién
 * al acreditarse el cheque (endpoint /acreditar).
 *
 * Body: { cuenta_banco_id, gastos? }
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
    const body = await request.json()
    const { cuenta_banco_id, gastos } = body

    if (!cuenta_banco_id) {
      return NextResponse.json({ error: "cuenta_banco_id es requerido" }, { status: 400 })
    }

    const { data, error } = await supabase.rpc("caja_depositar_cheque", {
      p_cheque_id: chequeId,
      p_cuenta_banco_id: cuenta_banco_id,
      p_gastos: Number(gastos) || 0,
      p_usuario_id: auth.user.id,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true, ...data })
  } catch (error: any) {
    console.error("[cheques/depositar] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
