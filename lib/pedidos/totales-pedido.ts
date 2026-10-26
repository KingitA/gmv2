// Totales del pedido para mostrar en pantalla (#14 de la prueba de salida).
// Después de preparar, lo que se factura es lo que salió del depósito
// (cantidadAFacturar); ya facturado, lo que vale es el total de los comprobantes.
import { cantidadAFacturar } from "./cantidad-a-facturar"

type Renglon = {
  cantidad?: number | string | null
  cantidad_preparada?: number | string | null
  estado_item?: string | null
  precio_final?: number | string | null
}

const PREPARADO = new Set(["COMPLETO", "PARCIAL", "FALTANTE"])
const DEBITOS = new Set(["FA", "FB", "FC", "PRES", "ND", "NDA", "NDB", "NDC"])

/** El depósito ya marcó algún renglón. */
export function pedidoPreparado(renglones: Renglon[]): boolean {
  return renglones.some((r) => PREPARADO.has(r.estado_item || ""))
}

/** Suma de lo que va al comprobante: lo preparado (o lo pedido si no se preparó). */
export function totalAFacturar(renglones: Renglon[]): number {
  return renglones.reduce((t, r) => t + cantidadAFacturar(r) * (Number(r.precio_final) || 0), 0)
}

/** "30 de 36" si salió menos de lo pedido; si no, la cantidad pedida. */
export function textoCantidadPreparada(r: Renglon): string {
  const pedida = Number(r.cantidad || 0)
  const sale = cantidadAFacturar(r)
  return sale < pedida ? `${sale} de ${pedida}` : `${pedida}`
}

/** Total de los comprobantes vivos emitidos por el pedido (sin NC/REV), o null si no hay. */
export function totalFacturado(
  comprobantes: { tipo_comprobante: string; total_factura: number | string | null; anulado_en?: string | null; pedido_id?: string | null }[] | undefined,
  pedidoId: string,
): number | null {
  const vivos = (comprobantes || []).filter((c) => !c.anulado_en && c.pedido_id === pedidoId && DEBITOS.has(c.tipo_comprobante))
  if (!vivos.length) return null
  return vivos.reduce((t, c) => t + (Number(c.total_factura) || 0), 0)
}
