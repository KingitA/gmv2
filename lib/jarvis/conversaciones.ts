/**
 * Conversaciones con Jarvis: quién preguntó qué y qué se le respondió.
 * Se guardan en ai_conversations / ai_messages (reciclados del chat viejo).
 *
 * Cada respuesta guarda en metadata.api SOLO los mensajes que se agregaron en
 * esa vuelta (pregunta, consultas, respuesta). El historial completo se arma
 * concatenando esas partes en orden. Así no se guarda lo mismo una y otra vez.
 */
import type Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { RespuestaJarvis } from "./cerebro"

export async function cargarHistorial(db: SupabaseClient, conversacionId: string, usuarioId: string): Promise<Anthropic.MessageParam[] | null> {
  const { data: conv } = await db.from("ai_conversations").select("id, usuario_id").eq("id", conversacionId).maybeSingle()
  if (!conv || conv.usuario_id !== usuarioId) return null
  const { data, error } = await db.from("ai_messages").select("metadata, created_at").eq("conversation_id", conversacionId)
    .eq("role", "assistant").order("created_at", { ascending: true })
  if (error) return null
  return (data ?? []).flatMap((m: { metadata: { api?: Anthropic.MessageParam[] } | null }) => m.metadata?.api ?? [])
}

/** Guarda la pregunta y la respuesta. Devuelve el id de la conversación (o null si no se pudo). */
export async function guardarIntercambio(
  db: SupabaseClient,
  a: { conversacionId: string | null; usuarioId: string; mensaje: string; desdeIndice: number; r: RespuestaJarvis },
): Promise<string | null> {
  try {
    let id = a.conversacionId
    if (!id) {
      const { data, error } = await db.from("ai_conversations")
        .insert({ title: a.mensaje.slice(0, 80), source: "playroom", status: "active", usuario_id: a.usuarioId })
        .select("id").single()
      if (error) throw error
      id = data.id as string
    } else {
      await db.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", id)
    }
    const { error } = await db.from("ai_messages").insert([
      { conversation_id: id, role: "user", content: a.mensaje, usuario_id: a.usuarioId, metadata: {} },
      {
        conversation_id: id, role: "assistant", content: a.r.respuesta, usuario_id: null,
        metadata: {
          bloques: a.r.bloques, consultado: a.r.consultado, sugerencias: a.r.sugerencias,
          modelo: a.r.modelo, costo_usd: a.r.costoUsd, api: a.r.historial.slice(a.desdeIndice),
        },
      },
    ])
    if (error) throw error
    return id
  } catch (e) {
    console.error("[jarvis] no se pudo guardar la conversación", e)
    return a.conversacionId
  }
}
