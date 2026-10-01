import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * ¿Cuánta NC del 10% contado le FALTA a cada comprobante? — para el reparto
 * del pago (repartirImputacionesContado): un comprobante sin bonificar recibe
 * en plata su saldo menos este monto (la NC lo completa); uno YA bonificado
 * (NC/REV viva cuyo texto "Bonificación contado…" lo menciona — misma
 * detección que las pantallas) devuelve 0 y cobra su saldo completo.
 *
 * Solo bonifican FA/FB/FC/PRES; el resto (ND, etc.) devuelve 0.
 */
const BONIFICABLES = new Set(["FA", "FB", "FC", "PRES"])

export async function bonificacionPendientePorComprobante(
  supabase: SupabaseClient,
  clienteId: string,
  comprobanteIds: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const ids = [...new Set(comprobanteIds.filter(Boolean))]
  if (!ids.length) return out

  const [{ data: comps }, { data: ncs }] = await Promise.all([
    supabase
      .from("comprobantes_venta")
      .select("id, tipo_comprobante, numero_comprobante, total_factura")
      .in("id", ids),
    supabase
      .from("comprobantes_venta")
      .select("observaciones")
      .eq("cliente_id", clienteId)
      .in("tipo_comprobante", ["REV", "NCA", "NCB", "NCC"])
      .is("anulado_en", null)
      .neq("estado_pago", "anulado")
      .ilike("observaciones", "%Bonificación contado%"),
  ])
  const obsBonif = (ncs || []).map((n: any) => String(n.observaciones || ""))
  for (const c of comps || []) {
    if (!BONIFICABLES.has(c.tipo_comprobante)) continue
    const yaBonificado = obsBonif.some((o) => o.includes(c.numero_comprobante))
    if (yaBonificado) continue
    out[c.id] = Math.round(Math.abs(Number(c.total_factura)) * 0.1 * 100) / 100
  }
  return out
}
