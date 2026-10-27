import { fecha } from "../formato"

/**
 * #28: PRES de respaldo, uno por cliente, para lo devuelto sin comprobante con
 * ese artículo (negro). Uno solo por cliente vivo: lo asegura el índice único
 * ux_comprobantes_venta_respaldo_devolucion (20261027b_respaldo_devolucion_unico.sql).
 * Los PRES viejos de la apertura entran con PV 0002 (#18): la apertura frena el
 * que caería en este mismo número (R9, 27/10).
 */
export const NUMERO_RESPALDO_DEVOLUCION = "0002-00000001"

export interface CompraDelArticulo {
  /** aaaa-mm-dd */
  fecha: string
  cantidad: number
  comprobante: string
}

/**
 * Regla de Juan (27/10): lo que va al respaldo no tiene contra qué topearse (no
 * hay venta registrada en ese comprobante), así que lo controla la OFICINA al
 * revisar. Para que no se pase por alto, el renglón lleva este aviso con lo que
 * el cliente compró de ese artículo en gmv2 ("el cliente compró 25 el 20/10/2026,
 * ¿los otros corresponden a un pedido del sistema viejo?").
 */
export function textoAvisoRespaldo(devuelve: number, compras: CompraDelArticulo[]): string {
  const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",")
  if (!compras.length) {
    return `Sin venta registrada en gmv2: controlá la cantidad. El cliente no compró este artículo en gmv2; ¿las ${fmt(devuelve)} corresponden a un pedido del sistema viejo?`
  }
  const ordenadas = [...compras].sort((a, b) => b.fecha.localeCompare(a.fecha))
  const comprado = ordenadas.reduce((s, c) => s + c.cantidad, 0)
  const detalle = ordenadas.slice(0, 3).map((c) => `${fmt(c.cantidad)} el ${fecha(c.fecha)} (${c.comprobante})`).join(", ")
  const mas = ordenadas.length > 3 ? ` y ${ordenadas.length - 3} compra${ordenadas.length - 3 === 1 ? "" : "s"} más` : ""
  const resto = devuelve - comprado
  return resto > 0.0005
    ? `Sin venta registrada para lo devuelto: controlá la cantidad. El cliente compró ${detalle}${mas}; ¿las otras ${fmt(resto)} corresponden a un pedido del sistema viejo?`
    : `Sin venta registrada para lo devuelto: controlá la cantidad. El cliente compró ${detalle}${mas}.`
}
