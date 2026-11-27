import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Observación ESCRITA A MANO de un pedido (pedidos.observaciones: vendedor en la app,
 * oficina en el ERP o en la importación), para imprimirla al pie de los comprobantes
 * (Juan, 27/11/2026). La nota del sistema (pedidos.nota_origen) nunca va a un comprobante.
 * Consulta a prueba de fallas: si algo falla, el comprobante sale igual sin la observación.
 */
export async function observacionManualPedido(supabase: SupabaseClient, pedidoId: string | null | undefined): Promise<string | null> {
  if (!pedidoId) return null
  try {
    const { data } = await supabase.from("pedidos").select("observaciones").eq("id", pedidoId).maybeSingle()
    return (data as any)?.observaciones?.trim() || null
  } catch {
    return null
  }
}
