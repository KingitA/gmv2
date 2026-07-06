import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * POST /api/finanzas/transferencias — movimiento entre cajas/bancos/billeteras
 * con gastos bancarios, vía RPC atómico `caja_transferir` (Fase B2).
 *
 * Body: {
 *   origen_tipo: "CAJA"|"BANCO"|"BILLETERA", origen_id,
 *   destino_tipo, destino_id,
 *   monto, gastos?, color?, concepto?
 * }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { origen_tipo, origen_id, destino_tipo, destino_id, monto, gastos, color, concepto } = body

    if (!origen_tipo || !origen_id || !destino_tipo || !destino_id || !monto) {
      return NextResponse.json(
        { error: "origen_tipo, origen_id, destino_tipo, destino_id y monto son requeridos" },
        { status: 400 }
      )
    }

    const { data, error } = await supabase.rpc("caja_transferir", {
      p_origen_tipo: origen_tipo,
      p_origen_id: origen_id,
      p_destino_tipo: destino_tipo,
      p_destino_id: destino_id,
      p_monto: Number(monto),
      p_gastos: Number(gastos) || 0,
      p_color: color || "BLANCO",
      p_concepto: concepto || null,
      p_usuario_id: auth.user.id,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true, ...data })
  } catch (error: any) {
    console.error("[finanzas/transferencias] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
