/**
 * Bitácora de Jarvis (tabla ai_registro): quién hizo qué y cuándo.
 * La base impide modificar o borrar renglones (trigger). Solo se agregan.
 *
 * usuario_id = null significa "lo hizo Jarvis solo" (proceso automático).
 */
import type { SupabaseClient } from "@supabase/supabase-js"

export interface Anotacion {
  usuarioId: string | null
  accion: string
  entidadTipo?: string
  entidadId?: string
  detalle?: Record<string, unknown>
}

/** Anota en la bitácora. Si falla, TIRA error: una acción sin registro no debe seguir. */
export async function anotar(db: SupabaseClient, a: Anotacion): Promise<void> {
  const { error } = await db.from("ai_registro").insert({
    usuario_id: a.usuarioId,
    accion: a.accion,
    entidad_tipo: a.entidadTipo ?? null,
    entidad_id: a.entidadId ?? null,
    detalle: a.detalle ?? {},
  })
  if (error) throw new Error(`No se pudo anotar en la bitácora: ${error.message}`)
}
