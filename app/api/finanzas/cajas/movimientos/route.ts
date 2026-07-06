import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * GET /api/finanzas/cajas/movimientos?cuenta_tipo=CAJA&cuenta_id=...
 * Historial de una cuenta de fondos desde el ledger maestro (kardex_contable).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const cuentaTipo = searchParams.get("cuenta_tipo")
    const cuentaId = searchParams.get("cuenta_id")
    const limit = Math.min(Number(searchParams.get("limit")) || 100, 500)

    if (!cuentaTipo || !cuentaId) {
      return NextResponse.json({ error: "cuenta_tipo y cuenta_id son requeridos" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("kardex_contable")
      .select(
        "id, fecha, tipo_movimiento, concepto, monto, gastos, color, metodo, origen_tipo, origen_id, destino_tipo, destino_id, verificado, saldo_origen_after, saldo_destino_after, created_at"
      )
      .or(
        `and(origen_tipo.eq.${cuentaTipo},origen_id.eq.${cuentaId}),and(destino_tipo.eq.${cuentaTipo},destino_id.eq.${cuentaId})`
      )
      .order("created_at", { ascending: false })
      .limit(limit)
    if (error) throw error

    const movimientos = (data || []).map((k) => {
      const esIngreso = k.destino_tipo === cuentaTipo && k.destino_id === cuentaId
      return {
        ...k,
        direccion: esIngreso ? "ingreso" : "egreso",
        monto_efectivo: esIngreso
          ? Math.abs(Number(k.monto)) - Number(k.gastos || 0)
          : -Math.abs(Number(k.monto)),
        saldo_despues: esIngreso ? k.saldo_destino_after : k.saldo_origen_after,
      }
    })

    return NextResponse.json({ movimientos })
  } catch (error: any) {
    console.error("[finanzas/cajas/movimientos] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
