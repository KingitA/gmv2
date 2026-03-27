/**
 * POST /api/pagos/generar-bonificacion
 *
 * Genera NC/REV de bonificación por pago contado (10%) para los comprobantes indicados.
 * Si se provee pago_id, las NC/REV se imputarán automáticamente a ese pago.
 *
 * Body:
 * {
 *   cliente_id: string
 *   comprobante_ids: string[]
 *   pago_id?: string          // opcional: imputa NC/REV al pago
 * }
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { generarBonificacionContado } from "@/lib/comprobantes/generar-bonificacion"

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { cliente_id, comprobante_ids, pago_id } = body

    if (!cliente_id || !comprobante_ids || !Array.isArray(comprobante_ids)) {
      return NextResponse.json(
        { error: "Faltan parámetros: cliente_id y comprobante_ids son requeridos" },
        { status: 400 },
      )
    }

    if (comprobante_ids.length === 0) {
      return NextResponse.json(
        { error: "comprobante_ids no puede estar vacío" },
        { status: 400 },
      )
    }

    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )

    const resultado = await generarBonificacionContado(supabase, {
      cliente_id,
      comprobante_ids,
      pago_id,
    })

    return NextResponse.json({
      success: true,
      ...resultado,
    })
  } catch (error: any) {
    console.error("[generar-bonificacion] Error:", error)
    return NextResponse.json(
      { error: error.message || "Error generando bonificación" },
      { status: 500 },
    )
  }
}
