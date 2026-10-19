import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { ErrorRetiro, registrarRetiro } from "@/lib/cuenta-corriente/retiro"

// POST /api/vendedor/retiro — el vendedor retira efectivo de lo que tiene en la
// mano (regla del dueño 19/10/2026). Body: { monto, observaciones?, idempotency_key? }.
// Se debita en su cuenta personal y baja la plata que tiene que rendir. Sin
// aprobación previa: la oficina lo ve al controlar la rendición.
export async function POST(request: NextRequest) {
  const session = await requireVendedor()
  if (session.error) return session.error
  try {
    const supabase = await createClient()
    const body = await request.json()
    const r = await registrarRetiro(supabase, {
      usuarioId: session.user.id,
      vendedorIds: session.vendedorIds,
      monto: Number(body?.monto),
      observaciones: body?.observaciones || null,
      idempotencyKey: body?.idempotency_key || null,
    })
    return NextResponse.json({ success: true, ...r })
  } catch (e: any) {
    if (e instanceof ErrorRetiro) {
      return NextResponse.json({ error: e.message, error_code: e.codigo }, { status: e.status })
    }
    console.error("[vendedor/retiro] error:", e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
