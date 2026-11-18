import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Cheques de tercero RESERVADOS por una orden de pago pendiente (E-66).
 * Una orden pendiente que eligió un cheque lo reserva: mientras esa orden no se confirme o
 * se elimine, el cheque no se puede usar en otra orden ni depositar.
 *
 * Devuelve cheque_id → número de la orden que lo tiene. Se lee con el cliente de servicio
 * (las órdenes de pago no son visibles para todos los roles) y solo expone el número.
 */
export async function chequesReservados(chequeIds?: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>()
  if (chequeIds && chequeIds.length === 0) return mapa
  const db = createAdminClient()
  const tanda = 200
  const ids = chequeIds ?? [null as unknown as string]
  for (let i = 0; i < ids.length; i += tanda) {
    let q = db.from("ordenes_pago_detalle")
      .select("cheque_id, ordenes_pago!inner(numero_op, estado)")
      .not("cheque_id", "is", null)
      .eq("ordenes_pago.estado", "pendiente")
    if (chequeIds) q = q.in("cheque_id", ids.slice(i, i + tanda))
    const { data, error } = await q
    if (error) throw new Error(error.message)
    for (const d of (data ?? []) as any[]) {
      const op = Array.isArray(d.ordenes_pago) ? d.ordenes_pago[0] : d.ordenes_pago
      if (d.cheque_id && op?.numero_op) mapa.set(d.cheque_id, op.numero_op)
    }
    if (!chequeIds) break
  }
  return mapa
}
