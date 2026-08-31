import type { SupabaseClient } from "@supabase/supabase-js"
import { registrarTareaFallida } from "@/lib/finanzas/tareas-fallidas"

/**
 * Posteo al libro mayor (cc_postear) con reintento y SIN fallo silencioso.
 *
 * Contexto: los documentos fiscales se emiten ANTES de postear (el CAE ya
 * existe), así que abortar el request si el asiento falla provocaría
 * reintentos del operador y documentos duplicados. En cambio:
 *   1. se reintenta una vez;
 *   2. si vuelve a fallar, se devuelve una ADVERTENCIA que el endpoint debe
 *      incluir en su respuesta (la UI la muestra) — nunca un console.error
 *      perdido;
 *   3. GET /api/finanzas/reconciliacion detecta el asiento faltante hasta
 *      que se reponga.
 *
 * Devuelve null si el asiento entró; el texto de la advertencia si no.
 */
export async function postearLibroConAviso(
  supabase: SupabaseClient,
  params: {
    p_cliente_id: string
    p_tipo_movimiento: string
    p_debe: number
    p_haber: number
    p_referencia_tipo: string
    p_referencia_id: string
    p_numero_comprobante?: string | null
    p_observaciones?: string | null
    p_usuario_id?: string | null
  },
  contexto: string,
): Promise<string | null> {
  let lastError = ""
  for (let intento = 0; intento < 2; intento++) {
    const { error } = await supabase.rpc("cc_postear", params)
    if (!error) return null
    lastError = error.message
  }
  const aviso =
    `El asiento en cuenta corriente de ${contexto} NO se registró (${lastError}). ` +
    `El documento existe pero el saldo del cliente quedó desactualizado: ` +
    `quedó en "Pendientes de reproceso" de la Caja del Día para reintentarlo.`
  console.error(`[cc_postear] ${contexto}:`, lastError)
  // Persistir para reintento desde /caja (nada falla en silencio)
  await registrarTareaFallida({
    tipo: "cc_postear",
    referencia_tipo: params.p_referencia_tipo,
    referencia_id: params.p_referencia_id,
    payload: params,
    error: `${contexto}: ${lastError}`,
  })
  return aviso
}
