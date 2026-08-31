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

    // Un pago rendido y confirmado no se anula: el efectivo ya viajó
    // billetera→caja con la rendición y la reversa descuadraría la billetera
    // del cobrador. (El RPC tiene el mismo guard; acá el mensaje amigable.)
    const { data: rendido } = await supabase
      .from("rendicion_items")
      .select("id, rendiciones!inner(estado)")
      .eq("pago_id", pagoId)
      .eq("rendiciones.estado", "confirmada")
      .limit(1)
    if (rendido?.length) {
      return NextResponse.json(
        { error: "El pago ya fue rendido y confirmado — no se puede anular. Corregilo con un ajuste." },
        { status: 409 }
      )
    }

    const result = await anularCobranza(supabase, {
      pagoId,
      usuarioId: auth.user.id,
      motivo,
    })

    if (result.yaAnulado) {
      return NextResponse.json({ error: "El pago ya está anulado" }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      ...(result.bonificacionesFiscalesPendientes.length
        ? {
            advertencia: `El pago tenía bonificación 10% en NC fiscal (${result.bonificacionesFiscalesPendientes.join(", ")}). La NC no se anula sola: emití la Nota de Débito para recuperar el descuento.`,
            bonificaciones_fiscales_pendientes: result.bonificacionesFiscalesPendientes,
          }
        : {}),
    })
  } catch (error: any) {
    console.error("[pagos-clientes/anular] POST error:", error)
    if (error.message?.includes("RENDIDO_CONFIRMADO")) {
      return NextResponse.json(
        { error: "El pago ya fue rendido y confirmado — no se puede anular. Corregilo con un ajuste." },
        { status: 409 }
      )
    }
    const status = error.message?.includes("no encontrado") ? 404 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}
