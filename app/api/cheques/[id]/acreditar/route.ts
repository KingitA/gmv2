import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * POST /api/cheques/[id]/acreditar — DEPOSITADO → COBRADO vía RPC
 * `caja_acreditar_cheque` (Fase B2). Acredita el saldo del banco de depósito
 * neto de gastos bancarios.
 *
 * Body: { gastos? }
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

    const { data, error } = await supabase.rpc("caja_acreditar_cheque", {
      p_cheque_id: chequeId,
      p_gastos: Number(body.gastos) || 0,
      p_usuario_id: auth.user.id,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true, ...data })
  } catch (error: any) {
    console.error("[cheques/acreditar] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
