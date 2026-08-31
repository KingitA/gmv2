import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * GET /api/finanzas/tareas-fallidas — pasos accesorios del circuito de
 * cobranzas que fallaron y esperan reintento (panel "Pendientes de reproceso"
 * en la Caja del Día).
 */
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("tareas_fallidas")
      .select("id, tipo, referencia_tipo, referencia_id, error, intentos, creado_en, ultimo_intento_en")
      .is("resuelto_en", null)
      .order("creado_en", { ascending: false })
      .limit(50)
    if (error) throw error
    return NextResponse.json({ tareas: data || [] })
  } catch (error: any) {
    console.error("[tareas-fallidas] GET error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
