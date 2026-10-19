import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * EN COBRO: lo que ya está tomado de cada comprobante por cobros registrados
 * que la oficina todavía no confirmó (imputaciones PENDIENTES de pagos
 * pendiente / pendiente_rendicion). Quien muestra un comprobante para cobrar
 * resta esto del saldo: sin esto, el vendedor y el chofer (u otro viaje)
 * pueden cobrar dos veces el mismo comprobante.
 *
 * Una sola fórmula para la ficha del vendedor y la cuenta de cobro del chofer.
 */
export async function enCobroPorComprobante(
  supabase: SupabaseClient,
  comprobanteIds: string[],
  marcaContado?: string,
): Promise<{ enCobro: Map<string, number>; enCobroContado: Map<string, number> }> {
  const enCobro = new Map<string, number>()
  const enCobroContado = new Map<string, number>()
  if (!comprobanteIds.length) return { enCobro, enCobroContado }
  const { data: impPend } = await supabase
    .from("imputaciones")
    .select("comprobante_id, monto_imputado, pago_id")
    .in("comprobante_id", comprobanteIds)
    .eq("estado", "pendiente")
  const pagoIds = [...new Set((impPend || []).map((i: any) => i.pago_id).filter(Boolean))]
  const estadoPago = new Map<string, string>()
  const contado = new Set<string>()
  if (pagoIds.length) {
    const { data: pgs } = await supabase.from("pagos_clientes").select("id, estado, observaciones").in("id", pagoIds)
    for (const p of pgs || []) {
      estadoPago.set(p.id, p.estado)
      if (marcaContado && (p.observaciones || "").includes(marcaContado)) contado.add(p.id)
    }
  }
  for (const i of impPend || []) {
    const est = estadoPago.get(i.pago_id)
    if (est !== "pendiente" && est !== "pendiente_rendicion") continue
    const m = Number(i.monto_imputado) || 0
    enCobro.set(i.comprobante_id, Math.round(((enCobro.get(i.comprobante_id) || 0) + m) * 100) / 100)
    if (contado.has(i.pago_id)) enCobroContado.set(i.comprobante_id, Math.round(((enCobroContado.get(i.comprobante_id) || 0) + m) * 100) / 100)
  }
  return { enCobro, enCobroContado }
}
