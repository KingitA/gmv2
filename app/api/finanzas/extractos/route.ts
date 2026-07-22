import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createHash } from "crypto"

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

    const invalidas: number[] = []
    const limpias: { fecha: string; descripcion: string; monto: number; referencia_externa: string | null }[] = []
    movimientos.forEach((m: any, i: number) => {
      const fecha = String(m.fecha ?? "").trim()
      const monto = Number(m.monto)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(monto) || monto === 0) {
        invalidas.push(i + 1)
        return
      }
      limpias.push({
        fecha,
        descripcion: String(m.descripcion ?? "").trim(),
        monto,
        referencia_externa: m.referencia_externa ? String(m.referencia_externa).trim() : null,
      })
    })
    if (!limpias.length) {
      return NextResponse.json({ error: `Ninguna fila válida (inválidas: ${invalidas.join(", ")})` }, { status: 400 })
    }

    // Referencia determinística cuando el banco no da una: misma fila del
    // mismo archivo → mismo hash → el UNIQUE dedupe re-importaciones.
    const vistos = new Map<string, number>()
    for (const m of limpias) {
      if (!m.referencia_externa) {
        const base = `${m.fecha}|${m.monto.toFixed(2)}|${m.descripcion.toLowerCase()}`
        const n = (vistos.get(base) ?? 0) + 1
        vistos.set(base, n)
        m.referencia_externa = "h:" + createHash("md5").update(`${base}|${n}`).digest("hex").slice(0, 20)
      }
    }

    const fechas = limpias.map((m) => m.fecha).sort()
    const supabase = createAdminClient()

    const { data: extracto, error: extErr } = await supabase
      .from("banco_extractos")
      .insert({
        cuenta_bancaria_id,
        fuente: body.fuente || "excel",
        periodo_desde: body.periodo_desde || fechas[0],
        periodo_hasta: body.periodo_hasta || fechas[fechas.length - 1],
        saldo_inicial: body.saldo_inicial ?? null,
        saldo_final: body.saldo_final ?? null,
        importado_por: auth.user?.id ?? null,
      })
      .select("id")
      .single()
    if (extErr) throw extErr

    // upsert ignorando duplicados (idempotencia por cuenta+referencia)
    const { data: insertados, error: movErr } = await supabase
      .from("banco_extractos_movimientos")
      .upsert(
        limpias.map((m) => ({
          extracto_id: extracto.id,
          cuenta_bancaria_id,
          fecha: m.fecha,
          descripcion: m.descripcion || null,
          referencia_externa: m.referencia_externa,
          monto: m.monto,
        })),
        { onConflict: "cuenta_bancaria_id,referencia_externa", ignoreDuplicates: true }
      )
      .select("id")
    if (movErr) throw movErr

    const nuevos = insertados?.length ?? 0
    const duplicados = limpias.length - nuevos

    const { data: match, error: matchErr } = await supabase.rpc("extracto_matchear", {
      p_extracto_id: extracto.id,
    })
    if (matchErr) throw matchErr

    return NextResponse.json({
      success: true,
      extracto_id: extracto.id,
      total_filas: movimientos.length,
      importados: nuevos,
      duplicados,
      invalidas,
      matching: match,
    })
  } catch (error: any) {
    console.error("[finanzas/extractos] POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
