import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { importarExtracto } from "@/lib/finanzas/extractos-import"

/**
 * Extractos bancarios (Fase G1, migración 20260723).
 *
 * GET  /api/finanzas/extractos?cuenta_id=…            → extractos de la cuenta
 * GET  /api/finanzas/extractos?extracto_id=…          → movimientos del extracto
 * GET  /api/finanzas/extractos?pendientes=1&cuenta_id → movs sin resolver de la cuenta
 *
 * POST — importa un extracto (el cliente parsea el archivo y manda filas):
 *   { cuenta_bancaria_id, fuente?, periodo_desde?, periodo_hasta?,
 *     saldo_inicial?, saldo_final?,
 *     movimientos: [{ fecha (YYYY-MM-DD), descripcion?, monto (signado),
 *                     referencia_externa? }] }
 * Idempotente: si la fila no trae referencia del banco se genera un hash
 * determinístico (fecha|monto|descripcion|ocurrencia) → re-importar el mismo
 * archivo no duplica nada. Al final corre extracto_matchear.
 */

export async function GET(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const { searchParams } = new URL(request.url)
    const supabase = await createClient()

    const extractoId = searchParams.get("extracto_id")
    if (extractoId) {
      const { data, error } = await supabase
        .from("banco_extractos_movimientos")
        .select("*, pagos_clientes(id, monto, cliente_id, clientes(nombre)), kardex_contable(id, tipo_movimiento, concepto, monto, fecha)")
        .eq("extracto_id", extractoId)
        .order("fecha", { ascending: true })
      if (error) throw error
      return NextResponse.json({ movimientos: data || [] })
    }

    const cuentaId = searchParams.get("cuenta_id")
    if (searchParams.get("pendientes") && cuentaId) {
      const { data, error } = await supabase
        .from("banco_extractos_movimientos")
        .select("*, pagos_clientes(id, monto, cliente_id, clientes(nombre)), kardex_contable(id, tipo_movimiento, concepto, monto, fecha)")
        .eq("cuenta_bancaria_id", cuentaId)
        .in("estado_matching", ["PENDIENTE", "SUGERIDO"])
        .order("fecha", { ascending: true })
      if (error) throw error
      return NextResponse.json({ movimientos: data || [] })
    }

    let q = supabase
      .from("banco_extractos")
      .select("*, cuentas_bancarias(nombre)")
      .order("created_at", { ascending: false })
      .limit(20)
    if (cuentaId) q = q.eq("cuenta_bancaria_id", cuentaId)
    const { data, error } = await q
    if (error) throw error

    // Resumen de estados por extracto
    const ids = (data || []).map((e) => e.id)
    const resumen: Record<string, Record<string, number>> = {}
    if (ids.length) {
      const { data: movs } = await supabase
        .from("banco_extractos_movimientos")
        .select("extracto_id, estado_matching")
        .in("extracto_id", ids)
      for (const m of movs || []) {
        resumen[m.extracto_id] = resumen[m.extracto_id] || {}
        resumen[m.extracto_id][m.estado_matching] = (resumen[m.extracto_id][m.estado_matching] || 0) + 1
      }
    }
    return NextResponse.json({
      extractos: (data || []).map((e) => ({ ...e, estados: resumen[e.id] || {} })),
    })
  } catch (error: any) {
    console.error("[finanzas/extractos] GET error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const { cuenta_bancaria_id, movimientos } = body
    if (!cuenta_bancaria_id || !Array.isArray(movimientos) || !movimientos.length) {
      return NextResponse.json({ error: "cuenta_bancaria_id y movimientos son obligatorios" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const res = await importarExtracto(supabase, {
      cuenta_bancaria_id,
      fuente: body.fuente || "excel",
      movimientos,
      periodo_desde: body.periodo_desde ?? null,
      periodo_hasta: body.periodo_hasta ?? null,
      saldo_inicial: body.saldo_inicial ?? null,
      saldo_final: body.saldo_final ?? null,
      importado_por: auth.user?.id ?? null,
    })

    return NextResponse.json({ success: true, total_filas: movimientos.length, ...res })
  } catch (error: any) {
    console.error("[finanzas/extractos] POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
