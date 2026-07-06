import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { anularCobranza } from "@/lib/actions/cobranzas"

/**
 * Anula un pago de cliente. Desde Fase A1 toda la reversa es atómica en el
 * RPC `cobranza_anular`: saldos de comprobantes, imputaciones, recibo,
 * cheques, libro mayor, kardex, comisiones cobradas y billetera del viajante.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id: pagoId } = await params
    const body = await request.json().catch(() => ({}))
    const motivo: string = body.motivo || ""

    const result = await anularCobranza(supabase, {
      pagoId,
      usuarioId: auth.user.id,
      motivo,
    })

    if (result.yaAnulado) {
      return NextResponse.json({ error: "El pago ya está anulado" }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[pagos-clientes/anular] POST error:", error)
    const status = error.message?.includes("no encontrado") ? 404 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}
