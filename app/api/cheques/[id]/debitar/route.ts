import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * POST /api/cheques/[id]/debitar — conciliación de un cheque PROPIO:
 * el banco lo debitó. ENTREGADO_A_PROVEEDOR → COBRADO + fecha_debito.
 * No toca saldos (los saldos de cajas se manejan manualmente / por kardex);
 * solo lo saca del comprometido.
 *
 * Body: { fecha_debito? } (default hoy)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const fecha = body.fecha_debito || new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return NextResponse.json({ error: "fecha_debito inválida" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: cheque, error: errGet } = await supabase
      .from("cheques")
      .select("id, tipo, estado")
      .eq("id", id)
      .single()
    if (errGet) throw errGet
    if (!cheque || cheque.tipo !== "PROPIO" || cheque.estado !== "ENTREGADO_A_PROVEEDOR") {
      return NextResponse.json(
        { error: "Solo se puede debitar un cheque PROPIO en estado ENTREGADO_A_PROVEEDOR" },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from("cheques")
      .update({ estado: "COBRADO", fecha_debito: fecha })
      .eq("id", id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[cheques/debitar] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
