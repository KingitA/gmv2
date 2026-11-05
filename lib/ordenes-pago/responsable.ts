import type { SupabaseClient } from "@supabase/supabase-js"
import { ahoraISO } from "@/lib/formato"

/**
 * Deja anotado en la orden de pago QUIÉN la confirmó (hizo salir la plata) o
 * la anuló/canceló, y cuándo (migración 20261105_jarvis_quien_hizo). Solo la
 * primera vez: si ya tiene responsable, no lo pisa.
 *
 * Nunca hace fallar la operación: la plata ya se movió cuando se llama. Si la
 * migración todavía no está aplicada (columna inexistente), solo avisa en el log.
 */
export async function anotarResponsableOP(
  db: SupabaseClient,
  opId: string,
  que: "confirmado" | "anulado",
  usuarioId: string | null | undefined,
) {
  if (!usuarioId) return
  try {
    const { error } = await db
      .from("ordenes_pago")
      .update({ [`${que}_por`]: usuarioId, [`${que}_at`]: ahoraISO() })
      .eq("id", opId)
      .is(`${que}_por`, null)
    if (error) console.warn(`[ordenes-pago] no se pudo anotar ${que}_por:`, error.message)
  } catch (e) {
    console.warn(`[ordenes-pago] no se pudo anotar ${que}_por:`, e)
  }
}
