import type { SupabaseClient } from "@supabase/supabase-js"
import { parteDevolucionDeAnulacion, repartirDevolucionDeAnulacion } from "./ajuste-devoluciones"

/**
 * P2-43 — Lo DEVUELTO que llega a un comprobante refacturado dentro de la NC/REV
 * de anulación (no como pago).
 *
 * Con la regla de Juan (31/10) la anulación ya no trae devoluciones: es por
 * total − REV/NC de devolución imputadas (que quedan como están). Pero un comprobante
 * anulado por el TOTAL con la devolución imputada (refacturado antes de este
 * cambio) deja en su anulación lo pagado MÁS lo devuelto; esa parte devolución:
 *  - cuenta en la base del 10 % contado del comprobante nuevo (devueltoPorComprobante);
 *  - no es plata cobrada para la comisión (lib/comisiones/liquidar.ts).
 * parteDevolucionDeAnulacion = devuelto − (total − anulación): da 0 con el flujo nuevo.
 *
 * `devueltoEtiquetado`: lo devuelto por NC/REV "Devolución …" (lib/cobranzas/devuelto.ts);
 * se recibe por parámetro para no importarse en círculo.
 */

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
    .select("comprobante_id, credito_comprobante_id, credito:comprobantes_venta!imputaciones_credito_comprobante_id_fkey(id, motivo_ajuste, anulado_en, estado_pago, total_factura, comprobantes_relacionados_ids)")
    .in("comprobante_id", ids)
    .eq("estado", "confirmado")
    .not("credito_comprobante_id", "is", null)
  if (error) throw new Error(`devolucionEnAnulaciones: ${error.message}`)

  // Créditos de anulación (vivos) y el comprobante que anularon
  const creditos = new Map<string, { orig: string; total: number }>()
  for (const i of (imps || []) as any[]) {
    const cr = Array.isArray(i.credito) ? i.credito[0] : i.credito
    if (!cr || cr.motivo_ajuste !== "Anulación" || cr.anulado_en || cr.estado_pago === "anulado") continue
    const orig = (cr.comprobantes_relacionados_ids || [])[0]
    if (orig) creditos.set(cr.id, { orig, total: Number(cr.total_factura) || 0 })
  }
  if (!creditos.size) return out

  const originales = [...new Set([...creditos.values()].map((c) => c.orig))]
  const [etiquetado, heredado, { data: origs }, { data: todas, error: e2 }] = await Promise.all([
    devueltoEtiquetado(supabase, originales),
    devolucionEnAnulaciones(supabase, originales, devueltoEtiquetado, profundidad + 1),
    supabase.from("comprobantes_venta").select("id, total_factura").in("id", originales),
    supabase
      .from("imputaciones")
      .select("comprobante_id, credito_comprobante_id, monto_imputado")
      .in("credito_comprobante_id", [...creditos.keys()])
      .eq("estado", "confirmado"),
  ])
  if (e2) throw new Error(`devolucionEnAnulaciones: ${e2.message}`)
  const totalDe = new Map(((origs || []) as any[]).map((o) => [o.id, Number(o.total_factura) || 0]))

  const pedidos = new Set(ids)
  for (const [creditoId, c] of creditos) {
    const devuelto = r2((etiquetado.get(c.orig) ?? 0) + (heredado.get(c.orig) ?? 0))
    const devParte = parteDevolucionDeAnulacion(devuelto, totalDe.get(c.orig) ?? 0, c.total)
    if (devParte <= 0.005) continue
    const deEste = ((todas || []) as any[])
      .filter((i) => i.credito_comprobante_id === creditoId)
      .map((i) => ({ comprobante_id: i.comprobante_id, monto: Number(i.monto_imputado) || 0, es_original: i.comprobante_id === c.orig }))
    for (const [compId, parte] of repartirDevolucionDeAnulacion(devParte, deEste)) {
      if (pedidos.has(compId)) out.set(compId, r2((out.get(compId) ?? 0) + parte))
    }
  }
  return out
}
