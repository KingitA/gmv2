/**
 * Descuadres reales de v_cc_reconciliacion (libro mayor vs comprobantes − a cuenta).
 * Una sola regla para la alerta de la Caja y el detalle de Finanzas:
 *  - sin las cuentas del personal: sus retiros van al libro sin comprobante,
 *    así que "descuadran" por diseño;
 *  - con tolerancia de $1 por redondeos de centavos en cobros parciales.
 * Auditoría 21/10: el aviso marcaba 2 clientes y eran el retiro de un vendedor
 * y $0,08 de redondeo.
 */
export const TOLERANCIA_DESCUADRE = 1

export async function descuadresReales<T extends { cliente_id: string; diferencia: number | string | null }>(
  supabase: any,
  filas: T[],
): Promise<T[]> {
  const { data: empleados } = await supabase.from("clientes").select("id").eq("es_empleado", true)
  const esEmpleado = new Set((empleados || []).map((c: any) => c.id))
  return filas.filter((r) => !esEmpleado.has(r.cliente_id) && Math.abs(Number(r.diferencia) || 0) >= TOLERANCIA_DESCUADRE)
}
