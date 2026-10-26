/**
 * Descuadres reales de v_cc_reconciliacion (libro mayor vs comprobantes − a cuenta).
 * Una sola regla para la alerta de la Caja y el detalle de Finanzas:
 *  - sin las cuentas del personal: sus retiros van al libro sin comprobante,
 *    así que "descuadran" por diseño;
 *  - con tolerancia de $1 por redondeos de centavos en cobros parciales.
 *  - descontando los AJUSTES DE APERTURA (texto libre del sistema viejo, #6):
 *    están en el libro sin comprobante, como "Ajustar saldo", por diseño.
 * Auditoría 21/10: el aviso marcaba 2 clientes y eran el retiro de un vendedor
 * y $0,08 de redondeo.
 */
import { PREFIJO_AJUSTE_APERTURA } from "@/lib/apertura/parsear-chr"
import { fetchAllRows } from "@/lib/supabase/fetch-all"

export const TOLERANCIA_DESCUADRE = 1

export async function descuadresReales<T extends { cliente_id: string; diferencia: number | string | null }>(
  supabase: any,
  filas: T[],
): Promise<T[]> {
  const [{ data: empleados }, ajustes] = await Promise.all([
    supabase.from("clientes").select("id").eq("es_empleado", true),
    fetchAllRows<any>(() =>
      supabase.from("cuenta_corriente_clientes").select("id, cliente_id, debe, haber").ilike("observaciones", `${PREFIJO_AJUSTE_APERTURA}%`),
    "id").catch(() => [] as any[]),
  ])
  const esEmpleado = new Set((empleados || []).map((c: any) => c.id))
  const ajusteDe = new Map<string, number>()
  for (const a of ajustes) ajusteDe.set(a.cliente_id, (ajusteDe.get(a.cliente_id) ?? 0) + Number(a.debe || 0) - Number(a.haber || 0))
  return filas.filter(
    (r) => !esEmpleado.has(r.cliente_id) && Math.abs((Number(r.diferencia) || 0) - (ajusteDe.get(r.cliente_id) ?? 0)) >= TOLERANCIA_DESCUADRE,
  )
}
