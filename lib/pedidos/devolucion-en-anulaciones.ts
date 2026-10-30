import type { SupabaseClient } from "@supabase/supabase-js"
import { repartirDevolucionDeAnulacion } from "./ajuste-devoluciones"

/**
 * P2-43 — Lo DEVUELTO que llega a un comprobante refacturado dentro de la NC/REV
 * de anulación (no como pago).
 *
 * Al anular un comprobante para refacturar, su inverso (motivo "Anulación") cubre
 * el total: después del cruce le queda de crédito lo que el cliente pagó MÁS lo
 * que devolvió. Ese crédito se imputa al comprobante nuevo del pedido
 * (lib/pedidos/refacturar.ts). Sin separar la parte devolución:
 *  - la base del 10 % contado del comprobante nuevo no restaba lo devuelto
 *    (devueltoPorComprobante solo ve las NC/REV "Devolución …");
 *  - la comisión la contaba como plata cobrada (lib/comisiones/liquidar.ts).
 * Parte devolución de cada crédito de anulación = lo devuelto del comprobante que
 * anuló (sus NC/REV de devolución + lo que a su vez le llegó así, si ya era
 * refacturado). Va primero a los débitos de ajuste de devoluciones (precio más
 * bajo) y el resto a los comprobantes nuevos (repartirDevolucionDeAnulacion).
 *
 * `devueltoEtiquetado`: lo devuelto por NC/REV "Devolución …" (lib/cobranzas/devuelto.ts);
 * se recibe por parámetro para no importarse en círculo.
 */

export const MOTIVO_AJUSTE_DEVOLUCION = "Ajuste devolución refacturada"
const MAX_PROFUNDIDAD = 5
const r2 = (n: number) => Math.round(n * 100) / 100

type Etiquetado = (supabase: SupabaseClient, ids: string[]) => Promise<Map<string, number>>

export async function devolucionEnAnulaciones(
  supabase: SupabaseClient,
  comprobanteIds: string[],
  devueltoEtiquetado: Etiquetado,
  profundidad = 0,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = [...new Set(comprobanteIds)].filter(Boolean)
  if (!ids.length || profundidad >= MAX_PROFUNDIDAD) return out

  const { data: imps, error } = await supabase
    .from("imputaciones")
    .select("comprobante_id, credito_comprobante_id, credito:comprobantes_venta!imputaciones_credito_comprobante_id_fkey(id, motivo_ajuste, anulado_en, estado_pago, comprobantes_relacionados_ids)")
    .in("comprobante_id", ids)
    .eq("estado", "confirmado")
    .not("credito_comprobante_id", "is", null)
  if (error) throw new Error(`devolucionEnAnulaciones: ${error.message}`)

  // Créditos de anulación (vivos) y el comprobante que anularon
  const originalDe = new Map<string, string>()
  for (const i of (imps || []) as any[]) {
    const cr = Array.isArray(i.credito) ? i.credito[0] : i.credito
    if (!cr || cr.motivo_ajuste !== "Anulación" || cr.anulado_en || cr.estado_pago === "anulado") continue
    const orig = (cr.comprobantes_relacionados_ids || [])[0]
    if (orig) originalDe.set(cr.id, orig)
  }
  if (!originalDe.size) return out

  const originales = [...new Set(originalDe.values())]
  const [etiquetado, heredado, { data: todas, error: e2 }] = await Promise.all([
    devueltoEtiquetado(supabase, originales),
    devolucionEnAnulaciones(supabase, originales, devueltoEtiquetado, profundidad + 1),
    supabase
      .from("imputaciones")
      .select("comprobante_id, credito_comprobante_id, monto_imputado, debito:comprobantes_venta!imputaciones_comprobante_id_fkey(motivo_ajuste)")
      .in("credito_comprobante_id", [...originalDe.keys()])
      .eq("estado", "confirmado"),
  ])
  if (e2) throw new Error(`devolucionEnAnulaciones: ${e2.message}`)

  const pedidos = new Set(ids)
  for (const [creditoId, orig] of originalDe) {
    const devParte = r2((etiquetado.get(orig) ?? 0) + (heredado.get(orig) ?? 0))
    if (devParte <= 0.005) continue
    const deEste = ((todas || []) as any[])
      .filter((i) => i.credito_comprobante_id === creditoId)
      .map((i) => {
        const deb = Array.isArray(i.debito) ? i.debito[0] : i.debito
        return { comprobante_id: i.comprobante_id, monto: Number(i.monto_imputado) || 0, es_ajuste: deb?.motivo_ajuste === MOTIVO_AJUSTE_DEVOLUCION, es_original: i.comprobante_id === orig }
      })
    for (const [compId, parte] of repartirDevolucionDeAnulacion(devParte, deEste)) {
      if (pedidos.has(compId)) out.set(compId, r2((out.get(compId) ?? 0) + parte))
    }
  }
  return out
}
