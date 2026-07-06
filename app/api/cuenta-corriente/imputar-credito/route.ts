import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * POST /api/cuenta-corriente/imputar-credito
 *
 * Imputa manualmente una nota de crédito (o REV) contra un comprobante de
 * débito del mismo cliente, vía RPC atómico `cc_imputar_credito` (Fase A3).
 * No postea al libro mayor: ambos documentos ya están posteados; esto solo
 * aplica saldos (saldo_pendiente) entre sí.
 *
 * Body: { credito_id, debito_id, monto? }  — monto omitido = máximo imputable
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { credito_id, debito_id, monto } = body

    if (!credito_id || !debito_id) {
      return NextResponse.json(
        { error: "credito_id y debito_id son requeridos" },
        { status: 400 }
      )
    }

    const { data, error } = await supabase.rpc("cc_imputar_credito", {
      p_credito_id: credito_id,
      p_debito_id: debito_id,
      p_monto: monto ? Number(monto) : null,
      p_usuario_id: auth.user.id,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({
      success: true,
      monto_imputado: data?.monto_imputado,
      credito_saldo_restante: data?.credito_saldo_restante,
      debito_saldo_restante: data?.debito_saldo_restante,
    })
  } catch (error: any) {
    console.error("[imputar-credito] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
