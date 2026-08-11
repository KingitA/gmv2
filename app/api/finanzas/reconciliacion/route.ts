import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

export const dynamic = "force-dynamic"

/**
 * GET /api/finanzas/reconciliacion — control diario de cuentas corrientes.
 *
 * Lee v_cc_reconciliacion (v2): por cliente, saldo del libro mayor vs saldo
 * por documentos menos la plata a cuenta. En un sistema sano TODAS las
 * diferencias son 0 — cualquier fila acá es un descuadre real a investigar
 * (asiento faltante, imputación rota, ajuste manual mal hecho).
 */
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("v_cc_reconciliacion")
      .select("*")
      .order("diferencia", { ascending: true })
    if (error) throw error

    const rows = data || []
    const descuadres = rows.filter((r: any) => Math.abs(Number(r.diferencia)) > 0.01)

    return NextResponse.json({
      ok: descuadres.length === 0,
      descuadres,
      total_clientes: rows.length,
      mensaje: descuadres.length
        ? `⚠ ${descuadres.length} cliente(s) con el libro mayor desalineado de los documentos`
        : "Libro mayor y documentos alineados en todos los clientes",
    })
  } catch (error: any) {
    console.error("[finanzas/reconciliacion] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
