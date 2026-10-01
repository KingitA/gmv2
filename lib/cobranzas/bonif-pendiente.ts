import type { SupabaseClient } from "@supabase/supabase-js"
import { ncContado } from "@/lib/cobranzas/reglas-cobro"

/**
 * ¿Cuánta NC del 10% contado va a generar ESTE cobro por cada comprobante?
 * — para el reparto del pago (repartirImputacionesContado): un comprobante
 * sin bonificar recibe en plata lo seleccionado menos este monto (la NC de
 * este cobro lo completa); uno YA bonificado (NC/REV viva cuyo texto
 * "Bonificación contado…" lo menciona) devuelve 0 y cobra completo.
 *
 * REGLA 01/10 (caso Urquiza): la NC es el 10% de LO SELECCIONADO EN ESTE
 * COBRO (imputación enviada), nunca del total histórico del comprobante ni
 * de entregas a cuenta sin tildar. Solo bonifican FA/FB/FC/PRES.
 */
const BONIFICABLES = new Set(["FA", "FB", "FC", "PRES"])

export async function bonificacionPendientePorComprobante(
  supabase: SupabaseClient,
  clienteId: string,
  imputaciones: Array<{ comprobante_id: string; monto_imputado: number }>,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const porComp = new Map<string, number>()
  for (const i of imputaciones) {
    if (!i?.comprobante_id) continue
    porComp.set(i.comprobante_id, (porComp.get(i.comprobante_id) ?? 0) + (Number(i.monto_imputado) || 0))
  }
  const ids = [...porComp.keys()]
  if (!ids.length) return out

  const [{ data: comps }, { data: ncs }] = await Promise.all([
    supabase
      .from("comprobantes_venta")
      .select("id, tipo_comprobante, numero_comprobante")
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
    out[c.id] = ncContado(porComp.get(c.id) ?? 0)
  }
  return out
}
