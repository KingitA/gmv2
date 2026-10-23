/**
 * Cantidad de un renglón que va al comprobante (y al kardex / comisión).
 *
 * Después de la preparación del depósito, lo que se factura es lo que
 * realmente sale (prueba integral 23/10/2026, problema 15):
 *  - FALTANTE → 0 (no va)
 *  - PARCIAL  → lo preparado (ej. 30 de 36)
 *  - resto (sin preparar, COMPLETO, mostrador) → lo pedido
 */
export function cantidadAFacturar(det: {
  cantidad?: number | string | null
  cantidad_preparada?: number | string | null
  estado_item?: string | null
}): number {
  const pedida = Number(det.cantidad || 0)
  if (det.estado_item === "FALTANTE") return 0
  if (det.estado_item === "PARCIAL" && det.cantidad_preparada != null) {
    const preparada = Number(det.cantidad_preparada)
    if (Number.isFinite(preparada)) return Math.max(0, Math.min(pedida, preparada))
  }
  return pedida
}
