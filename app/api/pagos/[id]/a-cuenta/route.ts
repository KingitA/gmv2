import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"

// POST /api/pagos/[id]/a-cuenta — "Dejar a cuenta" (regla del dueño 16/10).
// Lo no imputado de un pago confirmado queda a cuenta del cliente por decisión
// explícita: sale de la bandeja de pendientes y queda registrado quién y cuándo.
// No mueve saldos (el pago ya bajó la cuenta al confirmarse). Solo admin (Caja).
// DELETE deshace la decisión (vuelve a la bandeja).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermiso("caja")
  if (auth.error) return auth.error
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: pago } = await supabase.from("pagos_clientes").select("id, estado").eq("id", id).maybeSingle()
    if (!pago) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 })
    if (pago.estado !== "confirmado") {
      return NextResponse.json(
        { error: "Solo un pago confirmado puede quedar a cuenta. Confirmalo primero en Caja." },
        { status: 422 },
      )
    }
    const { error } = await supabase
      .from("pagos_clientes")
      .update({ a_cuenta_decidido_por: auth.user.id, a_cuenta_decidido_at: new Date().toISOString() })
      .eq("id", id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[pagos/a-cuenta] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermiso("caja")
  if (auth.error) return auth.error
  try {
    const { id } = await params
    const supabase = await createClient()
    const { error } = await supabase
      .from("pagos_clientes")
      .update({ a_cuenta_decidido_por: null, a_cuenta_decidido_at: null })
      .eq("id", id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[pagos/a-cuenta] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
