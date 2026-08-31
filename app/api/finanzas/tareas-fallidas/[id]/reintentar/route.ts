import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { procesarPostConfirmacion } from "@/lib/cobranzas/post-confirmacion"

/**
 * POST /api/finanzas/tareas-fallidas/[id]/reintentar — re-ejecuta el paso que
 * falló. Ambas operaciones son idempotentes:
 *  - cc_postear: el llamador original guarda (referencia_tipo, referencia_id);
 *    los posteos de confirmación tienen guard por referencia en el RPC.
 *  - post_confirmacion: procesarPostConfirmacion completa solo lo que falta.
 * Éxito → resuelto_en; fallo → intentos+1 con el error nuevo.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    const { id } = await params

    const { data: tarea, error: tErr } = await admin
      .from("tareas_fallidas")
      .select("*")
      .eq("id", id)
      .single()
    if (tErr || !tarea) {
      return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 })
    }
    if (tarea.resuelto_en) {
      return NextResponse.json({ success: true, ya_resuelta: true })
    }

    let fallo: string | null = null

    if (tarea.tipo === "cc_postear") {
      const { error } = await admin.rpc("cc_postear", tarea.payload)
      if (error) fallo = error.message
    } else if (tarea.tipo === "post_confirmacion") {
      const r = await procesarPostConfirmacion(supabase, admin, {
        pagoId: tarea.payload.pagoId,
        usuarioId: tarea.payload.usuarioId || auth.user.id,
      })
      if (r.bonificacion_error) fallo = r.bonificacion_error
    } else {
      return NextResponse.json({ error: `Tipo de tarea desconocido: ${tarea.tipo}` }, { status: 400 })
    }

    if (fallo) {
      await admin
        .from("tareas_fallidas")
        .update({
          error: fallo,
          intentos: (tarea.intentos ?? 1) + 1,
          ultimo_intento_en: new Date().toISOString(),
        })
        .eq("id", id)
      return NextResponse.json({ error: `El reintento volvió a fallar: ${fallo}` }, { status: 502 })
    }

    await admin
      .from("tareas_fallidas")
      .update({ resuelto_en: new Date().toISOString(), ultimo_intento_en: new Date().toISOString() })
      .eq("id", id)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[tareas-fallidas/reintentar] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
