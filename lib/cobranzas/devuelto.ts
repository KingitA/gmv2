import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Cuánto de cada comprobante ya se DEVOLVIÓ con una NC o REV de devolución
 * emitida (generar-nc-reversa la imputa a su comprobante de origen; las
 * observaciones empiezan con "Devolución DEV-…"). Es la base del 10% contado:
 * el descuento va sobre lo que el cliente se quedó (#33, prueba de salida 26/10).
 * Misma base para el servidor (generar-bonificacion) y para lo que muestran las
 * apps al cobrar (V2 vendedor, C3 chofer). Map comprobante_id → monto devuelto.
 */
export async function devueltoPorComprobante(supabase: SupabaseClient, comprobanteIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = [...new Set(comprobanteIds)].filter(Boolean)
  if (!ids.length) return out
  const { data: imps, error } = await supabase
    .from("imputaciones")
    .select("comprobante_id, monto_imputado, credito:comprobantes_venta!imputaciones_credito_comprobante_id_fkey(observaciones, anulado_en, estado_pago)")
    .in("comprobante_id", ids)
    .eq("estado", "confirmado")
    .not("credito_comprobante_id", "is", null)
  if (error) throw new Error(`devueltoPorComprobante: ${error.message}`)
  for (const i of imps || []) {
    const cr: any = Array.isArray((i as any).credito) ? (i as any).credito[0] : (i as any).credito
    if (!cr || cr.anulado_en || cr.estado_pago === "anulado") continue
    if (!String(cr.observaciones || "").startsWith("Devolución")) continue
    out.set(i.comprobante_id, Math.round(((out.get(i.comprobante_id) ?? 0) + Number(i.monto_imputado || 0)) * 100) / 100)
  }
  return out
}
