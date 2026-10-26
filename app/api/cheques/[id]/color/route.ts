import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { colorOverride } from "@/lib/actions/color-cheque"

/**
 * PATCH /api/cheques/[id]/color — cambiar a mano el color de un cheque de
 * tercero que sigue en la cartera (#34 de la prueba de salida).
 * La cartera no lleva saldo por color (EN_CARTERA no es una cuenta): el color
 * del cheque es el que usa el depósito al pasarlo al banco.
 *
 * Body: { color: "BLANCO" | "NEGRO" }
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const color = colorOverride(body.color)
    if (!color) return NextResponse.json({ error: "El color tiene que ser BLANCO o NEGRO" }, { status: 400 })

    const supabase = createAdminClient()
    const { data: cheque, error: errGet } = await supabase
      .from("cheques")
      .select("id, tipo, estado, es_echeq, color")
      .eq("id", id)
      .maybeSingle()
    if (errGet) throw errGet
    if (!cheque) return NextResponse.json({ error: "Cheque no encontrado" }, { status: 404 })
    if (cheque.tipo !== "TERCERO" || cheque.es_echeq || !["EN_CARTERA", "EN_VERIFICACION"].includes(cheque.estado)) {
      return NextResponse.json({ error: "Solo se cambia el color de un cheque de tercero que está en la cartera" }, { status: 400 })
    }
    if (cheque.color === color) return NextResponse.json({ ok: true })

    const { error: errUpd } = await supabase.from("cheques").update({ color }).eq("id", id)
    if (errUpd) throw errUpd
    // El detalle del cobro queda igual que el cheque (lo leen el recibo y las rendiciones)
    await supabase.from("pagos_detalle").update({ color_cheque: color }).eq("cheque_id", id).neq("color_cheque", "ECHEQ")
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("[cheques/color]", e?.message)
    return NextResponse.json({ error: e?.message || "No se pudo cambiar el color" }, { status: 500 })
  }
}
