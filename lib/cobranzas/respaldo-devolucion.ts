import { fecha } from "../formato"

/**
 * #28: PRES de respaldo, uno por cliente, para lo devuelto sin comprobante con
 * ese artículo (negro). Uno solo por cliente vivo: lo asegura el índice único
 * ux_comprobantes_venta_respaldo_devolucion (20261027b_respaldo_devolucion_unico.sql).
 * Los PRES viejos de la apertura entran con PV 0002 (#18): la apertura frena el
 * que caería en este mismo número (R9, 27/10).
 */
export const NUMERO_RESPALDO_DEVOLUCION = "0002-00000001"

/** Marca provisoria del renglón que va al respaldo (antes de saber su id). */
export const AL_RESPALDO = "__respaldo__"

/**
 * Regla de Juan (27/10): lo que se devuelve DE MÁS sobre lo comprado en gmv2 (en
 * un presupuesto) no se frena: va al PRES de respaldo como "del sistema viejo" y
 * lo controla la oficina con el aviso. Parte cada renglón elegible: hasta lo
 * disponible contra su comprobante (vendido − ya devuelto) y el resto al respaldo.
 * `disponible` trae solo los (comprobante|artículo) con detalle de venta; los
 * demás no se tocan (el tope los deja pasar igual).
 */
export function repartirExcedenteAlRespaldo<T extends { articulo_id: string; cantidad: number | string; comprobante_venta_id: string | null }>(
  items: T[],
  disponible: Map<string, number>,
  elegible: (it: T) => boolean,
): T[] {
  const queda = new Map(disponible)
  const out: T[] = []
  for (const it of items) {
    const k = `${it.comprobante_venta_id}|${it.articulo_id}`
    if (!it.comprobante_venta_id || !queda.has(k) || !elegible(it)) { out.push(it); continue }
    const cant = Number(it.cantidad) || 0
    const toma = Math.max(0, Math.min(cant, queda.get(k)!))
    queda.set(k, queda.get(k)! - toma)
    if (cant - toma <= 1e-6) { out.push(it); continue }
    if (toma > 1e-6) out.push({ ...it, cantidad: Math.round(toma * 1000) / 1000 })
    out.push({ ...it, cantidad: Math.round((cant - toma) * 1000) / 1000, comprobante_venta_id: AL_RESPALDO })
  }
  return out
}

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
 * el cliente compró de ese artículo en gmv2 y lo que ya se devolvió contra esas
 * compras ("el cliente compró 25 el 20/10/2026, ¿los otros 25 corresponden a un
 * pedido del sistema viejo?"). `devuelve` = lo de ESTE renglón (lo que va al respaldo).
 */
export function textoAvisoRespaldo(devuelve: number, compras: CompraDelArticulo[], devueltoContraCompras = 0): string {
  const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",")
  if (!compras.length) {
    return `Sin venta registrada en gmv2: controlá la cantidad. El cliente no compró este artículo en gmv2; ¿las ${fmt(devuelve)} corresponden a un pedido del sistema viejo?`
  }
  const ordenadas = [...compras].sort((a, b) => b.fecha.localeCompare(a.fecha))
  const detalle = ordenadas.slice(0, 3).map((c) => `${fmt(c.cantidad)} el ${fecha(c.fecha)} (${c.comprobante})`).join(", ")
  const mas = ordenadas.length > 3 ? ` y ${ordenadas.length - 3} compra${ordenadas.length - 3 === 1 ? "" : "s"} más` : ""
  const yaDev = devueltoContraCompras > 0.0005 ? `; contra esas compras ya se devuelven ${fmt(devueltoContraCompras)}` : ""
  return `Devuelve más de lo comprado en gmv2: controlá la cantidad. El cliente compró ${detalle}${mas}${yaDev}. ¿Las otras ${fmt(devuelve)} corresponden a un pedido del sistema viejo?`
}
