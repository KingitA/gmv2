/**
 * "Retener entregas" de un cliente: el chofer no baja mercadería si no cobra.
 *
 * El bloqueo por parada ya existía (viajes_paradas.bloquear_entrega, el
 * candado "NO ENTREGAR SIN COBRAR" de la hoja de ruta y la app del chofer).
 * Esto lo lleva al CLIENTE (clientes.retener_entregas): mientras esté
 * retenido, toda parada suya nace bloqueada y con "cobrar lo anterior".
 *
 * - Lo activa / desactiva una PERSONA (Sí en la agenda de Jarvis o botón
 *   "Liberar" en Ajustes de Jarvis). Jarvis solo lo propone.
 * - Mismas reglas que la pantalla de viajes: las instrucciones de una parada
 *   se pueden cambiar hasta que el chofer finaliza (puedeEditarInstrucciones).
 * - Al liberar, solo se destraban las paradas que bloqueó la retención
 *   (motivo "Retenido: …"); un candado puesto a mano por oficina se respeta.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { puedeEditarInstrucciones } from "./estados"

export const PREFIJO_RETENCION = "Retenido: "

/** Paradas pendientes del cliente en viajes que todavía aceptan instrucciones. */
async function paradasAbiertas(db: SupabaseClient, clienteId: string) {
  const { data, error } = await db.from("viajes_paradas")
    .select("id, viaje_id, bloquear_entrega, motivo_bloqueo, viajes!inner(estado, tipo)")
    .eq("cliente_id", clienteId).eq("estado", "pendiente")
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).filter((p) => p.viajes?.tipo === "reparto" && puedeEditarInstrucciones(p.viajes?.estado))
}

export async function retenerCliente(db: SupabaseClient, clienteId: string, motivo: string, usuarioId: string) {
  const ahora = new Date().toISOString()
  const motivoLimpio = motivo.trim().slice(0, 200) || "deuda vencida"
  const { error } = await db.from("clientes").update({
    retener_entregas: true, retener_motivo: motivoLimpio, retener_desde: ahora, retener_por: usuarioId,
    actualizado_por: usuarioId, actualizado_at: ahora,
  }).eq("id", clienteId)
  if (error) throw new Error(`No se pudo marcar al cliente: ${error.message}`)

  // Viajes ya armados (hasta que el chofer finaliza): se bloquea la parada ahora mismo
  const abiertas = (await paradasAbiertas(db, clienteId)).filter((p) => !p.bloquear_entrega)
  for (const p of abiertas) {
    const { error: e } = await db.from("viajes_paradas")
      .update({ bloquear_entrega: true, exigir_cobro_anterior: true, motivo_bloqueo: PREFIJO_RETENCION + motivoLimpio })
      .eq("id", p.id)
    if (e) throw new Error(`No se pudo bloquear la parada de un viaje armado: ${e.message}`)
  }
  return { paradasBloqueadas: abiertas.length }
}

export async function liberarCliente(db: SupabaseClient, clienteId: string, usuarioId: string) {
  const ahora = new Date().toISOString()
  const { error } = await db.from("clientes").update({
    retener_entregas: false, retener_motivo: null, retener_desde: null, retener_por: null,
    actualizado_por: usuarioId, actualizado_at: ahora,
  }).eq("id", clienteId)
  if (error) throw new Error(`No se pudo liberar al cliente: ${error.message}`)

  const deRetencion = (await paradasAbiertas(db, clienteId)).filter((p) => p.bloquear_entrega && String(p.motivo_bloqueo ?? "").startsWith(PREFIJO_RETENCION))
  for (const p of deRetencion) {
    const { error: e } = await db.from("viajes_paradas").update({ bloquear_entrega: false, motivo_bloqueo: null }).eq("id", p.id)
    if (e) throw new Error(`No se pudo destrabar la parada: ${e.message}`)
  }
  return { paradasLiberadas: deRetencion.length }
}

/** Para sincronizarParadas: qué clientes de la lista están retenidos (y por qué). */
export async function retenidosEntre(db: SupabaseClient, clienteIds: string[]): Promise<Map<string, string>> {
  if (!clienteIds.length) return new Map()
  const { data, error } = await db.from("clientes").select("id, retener_motivo").in("id", clienteIds).eq("retener_entregas", true)
  if (error) {
    // Si la columna todavía no existe (migración sin aplicar) no se frena el armado del viaje
    console.error("[viajes] retenidos", error.message)
    return new Map()
  }
  return new Map(((data ?? []) as { id: string; retener_motivo: string | null }[]).map((c) => [c.id, c.retener_motivo || "deuda vencida"]))
}
