import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Registro persistente de fallos de pasos accesorios ("nada falla en
 * silencio"). Cada fallo guarda el payload exacto para reintentarlo desde el
 * panel "Pendientes de reproceso" de la Caja del Día — las operaciones
 * (cc_postear, procesarPostConfirmacion) son idempotentes.
 *
 * Best-effort: si el registro mismo falla, solo se loguea — nunca rompe el
 * flujo que lo llamó.
 */
export async function registrarTareaFallida(input: {
  tipo: "cc_postear" | "post_confirmacion"
  referencia_tipo?: string | null
  referencia_id: string
  payload: Record<string, any>
  error: string
}) {
  try {
    const admin = createAdminClient()
    const { data: existente } = await admin
      .from("tareas_fallidas")
      .select("id, intentos")
      .eq("tipo", input.tipo)
      .eq("referencia_id", input.referencia_id)
      .is("resuelto_en", null)
      .maybeSingle()

    if (existente) {
      await admin
        .from("tareas_fallidas")
        .update({
          error: input.error,
          payload: input.payload,
          intentos: (existente.intentos ?? 1) + 1,
          ultimo_intento_en: new Date().toISOString(),
        })
        .eq("id", existente.id)
    } else {
      await admin.from("tareas_fallidas").insert({
        tipo: input.tipo,
        referencia_tipo: input.referencia_tipo ?? null,
        referencia_id: input.referencia_id,
        payload: input.payload,
        error: input.error,
      })
    }
  } catch (e) {
    console.error("[tareas_fallidas] no se pudo registrar el fallo:", e)
  }
}
