import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { fetchAllRows } from "@/lib/supabase/fetch-all"

/**
 * POST /api/finanzas/egresos — gasto desde una caja/banco vía RPC `caja_egreso`
 * (Fase B2). Registra egresos_generales + kardex + descuenta saldo.
 *
 * Body: { origen_tipo, origen_id, categoria, monto, color?, concepto }
 * Categorías: OPERATIVO | SUELDOS | INVERSION | CREDITO | IMPUESTOS | OTROS
 *
 * GET — lista egresos recientes.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { origen_tipo, origen_id, categoria, monto, color, concepto } = body

    if (!origen_tipo || !origen_id || !categoria || !monto || !concepto) {
      return NextResponse.json(
        { error: "origen_tipo, origen_id, categoria, monto y concepto son requeridos" },
        { status: 400 }
      )
    }

    const { data, error } = await supabase.rpc("caja_egreso", {
      p_origen_tipo: origen_tipo,
      p_origen_id: origen_id,
      p_categoria: categoria,
      p_monto: Number(monto),
      p_color: color || "BLANCO",
      p_concepto: concepto,
      p_usuario_id: auth.user.id,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true, ...data })
  } catch (error: any) {
    console.error("[finanzas/egresos] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const egresos = await fetchAllRows(() => supabase
      .from("egresos_generales")
      .select("*")
      .order("fecha", { ascending: false }), "id")
    return NextResponse.json({ egresos })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
