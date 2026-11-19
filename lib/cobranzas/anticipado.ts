import type { SupabaseClient } from "@supabase/supabase-js"
import { anticipadoSinCobro } from "./reglas-cobro"

/**
 * Freno de entrega para ANTICIPADO (condiciones de pago, fase 3): qué pedidos de la
 * lista son anticipados y todavía NO tienen un cobro registrado. La regla y el texto
 * están en reglas-cobro.ts (@gm/cobro, también para la app).
 *
 * "Cobro registrado para el pedido" (no hace falta que esté confirmado):
 *  - el pedido tiene un anticipo (pedidos.anticipo_pago_id) no rechazado ni anulado;
 *  - algún cobro no rechazado ni anulado está imputado a sus comprobantes;
 *  - sus comprobantes ya están en $0 (pagado con otros créditos);
 *  - con viajeId: el cliente tiene un cobro registrado en ESE viaje (el chofer lo
 *    carga en la parada y puede no imputarlo a un comprobante).
 */
const MUERTOS = ["rechazado", "anulado"]

export async function anticipadosSinCobro(
  supabase: SupabaseClient,
  pedidoIds: string[],
  opts: { viajeId?: string | null } = {},
): Promise<Array<{ pedido_id: string; numero: string; cliente_id: string }>> {
  const ids = [...new Set(pedidoIds.filter(Boolean))]
  if (!ids.length) return []
  const { data: pedidos, error } = await supabase
    .from("pedidos")
    .select("id, numero_pedido, cliente_id, anticipo_pago_id, condicion_pago_tipo_pedido, clientes(condicion_pago_tipo)")
    .in("id", ids)
  if (error) throw new Error(`anticipado: ${error.message}`)
  const anticipados = (pedidos || []).filter((p: any) =>
    anticipadoSinCobro({ condicionPedido: p.condicion_pago_tipo_pedido, condicionCliente: p.clientes?.condicion_pago_tipo, tieneCobro: false }),
  )
  if (!anticipados.length) return []

  const conCobro = new Set<string>()

  // Anticipo vinculado al pedido
  const anticipoIds = anticipados.map((p: any) => p.anticipo_pago_id).filter(Boolean)
  if (anticipoIds.length) {
    const { data } = await supabase.from("pagos_clientes").select("id, estado").in("id", anticipoIds)
    const vivos = new Set((data || []).filter((p: any) => !MUERTOS.includes(p.estado)).map((p: any) => p.id))
    for (const p of anticipados as any[]) if (p.anticipo_pago_id && vivos.has(p.anticipo_pago_id)) conCobro.add(p.id)
  }

  // Cobros imputados a sus comprobantes, o comprobantes ya en $0
  const { data: comps } = await supabase
    .from("comprobantes_venta")
    .select("id, pedido_id, saldo_pendiente, tipo_comprobante")
    .in("pedido_id", anticipados.map((p: any) => p.id))
    .is("anulado_en", null)
    .in("tipo_comprobante", ["FA", "FB", "FC", "PRES", "ND", "NDA", "NDB", "NDC"])
  const compsDe = new Map<string, any[]>()
  for (const c of comps || []) compsDe.set(c.pedido_id, [...(compsDe.get(c.pedido_id) || []), c])
  for (const [pid, cs] of compsDe) if (cs.length && cs.every((c) => Number(c.saldo_pendiente) <= 0.005)) conCobro.add(pid)
  const compIds = (comps || []).map((c: any) => c.id)
  if (compIds.length) {
    const { data: imps } = await supabase
      .from("imputaciones")
      .select("comprobante_id, estado, pago:pagos_clientes!imputaciones_pago_id_fkey(estado)")
      .in("comprobante_id", compIds)
      .not("pago_id", "is", null)
    const pedidoDeComp = new Map((comps || []).map((c: any) => [c.id, c.pedido_id]))
    for (const i of imps || []) {
      const pago: any = (i as any).pago
      if (MUERTOS.includes(String(i.estado)) || !pago || MUERTOS.includes(pago.estado)) continue
      conCobro.add(pedidoDeComp.get(i.comprobante_id))
    }
  }

  // Cobro del cliente registrado en este viaje (parada del chofer)
  if (opts.viajeId) {
    const clientes = [...new Set(anticipados.map((p: any) => p.cliente_id))]
    const { data: pagosViaje } = await supabase
      .from("pagos_clientes")
      .select("cliente_id, estado")
      .eq("viaje_id", opts.viajeId)
      .in("cliente_id", clientes)
    const pagaron = new Set((pagosViaje || []).filter((p: any) => !MUERTOS.includes(p.estado)).map((p: any) => p.cliente_id))
    for (const p of anticipados as any[]) if (pagaron.has(p.cliente_id)) conCobro.add(p.id)
  }

  return anticipados
    .filter((p: any) => !conCobro.has(p.id))
    .map((p: any) => ({ pedido_id: p.id, numero: p.numero_pedido, cliente_id: p.cliente_id }))
}
