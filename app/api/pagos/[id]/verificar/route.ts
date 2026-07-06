import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * POST /api/pagos/[id]/verificar — segunda firma manual (arqueo/revisión).
 * Exige que el verificador sea distinto de quien cobró (RPC pago_verificar).
 * Body: { metodo?: "arqueo"|"revision"|"conciliacion" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { id } = await params
    const body = await request.json().catch(() => ({}))

    const { data, error } = await supabase.rpc("pago_verificar", {
      p_pago_id: id,
      p_usuario_id: auth.user.id,
      p_metodo: body.metodo || "arqueo",
      p_fuente: "manual",
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true, ya_verificado: data?.ya_verificado ?? false })
  } catch (error: any) {
    console.error("[pagos/verificar] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
