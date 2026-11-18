/**
 * Reglas de matching para un comprobante de COMPRA (factura, adquisición, remito de un proveedor).
 *
 * Prueba en producción del 18/11 (OC-000012, HORNAL): el renglón "190138 ROLLO ALUMINIO" quedó
 * sugerido al SKU 961950 "ROLLO ALUMINIO" de OTRO proveedor (YASH), con "Sugerencia 90 %", cuando
 * existía el SKU 190138 de HORNAL con el código exacto. Reglas (orquestador, 18/11):
 *   1. El CÓDIGO EXACTO gana siempre sobre el parecido del texto: código de proveedor, SKU o EAN.
 *   2. Se busca primero entre los artículos de la ORDEN, después entre los del PROVEEDOR.
 *   3. Un artículo de otro proveedor es el último recurso: nunca se asigna solo (queda como
 *      sugerencia) y va marcado "de otro proveedor".
 *
 * Archivo PURO (sin base ni red). Tests: mobile/packages/core/test/entrada-ocr-match.test.ts
 */

export interface ArticuloConCodigo {
  id: string
  sku?: string | null
  proveedor_id?: string | null
}

export interface ContextoCompra {
  /** Artículos de la orden de compra del comprobante */
  ordenArticuloIds?: readonly string[] | null
}

/** Código comparable: sin espacios, sin puntos ni guiones, sin ceros a la izquierda, en mayúsculas. */
export function codigoComparable(v: unknown): string {
  const s = String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "")
  return s.replace(/^0+(?=.)/, "")
}

/**
 * Entre los artículos cuyo SKU es EXACTAMENTE el código leído: el que está en la orden; si no, el
 * del proveedor (solo si es uno: dos del mismo proveedor con el mismo código no se pueden
 * distinguir). Uno de otro proveedor no cuenta como coincidencia exacta.
 */
export function elegirPorCodigo<T extends ArticuloConCodigo>(codigo: unknown, articulos: readonly T[], proveedorId: string | null | undefined, contexto?: ContextoCompra | null): T | null {
  const c = codigoComparable(codigo)
  if (!c) return null
  const iguales = articulos.filter((a) => codigoComparable(a.sku) === c)
  if (iguales.length === 0) return null
  const enOrden = new Set(contexto?.ordenArticuloIds || [])
  const deLaOrden = iguales.filter((a) => enOrden.has(a.id))
  if (deLaOrden.length === 1) return deLaOrden[0]!
  if (deLaOrden.length > 1) return deLaOrden.find((a) => !!proveedorId && a.proveedor_id === proveedorId) ?? deLaOrden[0]!
  const delProveedor = proveedorId ? iguales.filter((a) => a.proveedor_id === proveedorId) : []
  return delProveedor.length === 1 ? delProveedor[0]! : null
}

export interface CandidatoCompra {
  sku_id: string
  score: number
  proveedor_id?: string | null
}

/** Puntaje desde el que un candidato se muestra como sugerencia (igual que el motor). */
export const UMBRAL_SUGERENCIA = 0.75

/**
 * Elige entre candidatos por PARECIDO de texto, ya ordenados o no:
 *   1º el mejor de la orden que llegue a sugerencia; 2º el mejor del proveedor que llegue;
 *   3º, solo si no hay ninguno de los anteriores que llegue, el mejor de otro proveedor (marcado);
 *   si nadie llega, el mejor de la orden o del proveedor aunque sea flojo.
 * `otro_proveedor` = true ⇒ no se puede asignar solo: queda como sugerencia.
 */
export function elegirCandidatoCompra<T extends CandidatoCompra>(candidatos: readonly T[], proveedorId: string | null | undefined, contexto?: ContextoCompra | null): { candidato: T; otro_proveedor: boolean; en_orden: boolean } | null {
  if (candidatos.length === 0) return null
  const enOrden = new Set(contexto?.ordenArticuloIds || [])
  const mejor = (lista: T[]) => lista.slice().sort((a, b) => b.score - a.score)[0] ?? null
  const deOrden = candidatos.filter((c) => enOrden.has(c.sku_id))
  const deProv = candidatos.filter((c) => !enOrden.has(c.sku_id) && !!proveedorId && c.proveedor_id === proveedorId)
  const otros = candidatos.filter((c) => !enOrden.has(c.sku_id) && !(!!proveedorId && c.proveedor_id === proveedorId))

  const o = mejor(deOrden)
  if (o && o.score >= UMBRAL_SUGERENCIA) return { candidato: o, otro_proveedor: false, en_orden: true }
  const p = mejor(deProv)
  if (p && p.score >= UMBRAL_SUGERENCIA) return { candidato: p, otro_proveedor: false, en_orden: false }
  const x = mejor(otros)
  if (x && x.score >= UMBRAL_SUGERENCIA) return { candidato: x, otro_proveedor: true, en_orden: false }
  const flojo = mejor([...deOrden, ...deProv])
  if (flojo) return { candidato: flojo, otro_proveedor: false, en_orden: enOrden.has(flojo.sku_id) }
  return x ? { candidato: x, otro_proveedor: true, en_orden: false } : null
}

/** Parecido de dos descripciones por palabras (0 a 1), para puntuar los artículos de la orden. */
export function parecidoPorPalabras(a: unknown, b: unknown): number {
  const palabras = (v: unknown) => new Set(
    String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ")
      .filter((t) => t.length > 1 && !["de", "para", "con", "el", "la", "los", "las", "un", "una"].includes(t)),
  )
  const x = palabras(a), y = palabras(b)
  if (x.size === 0 || y.size === 0) return 0
  let comunes = 0
  for (const t of x) if (y.has(t)) comunes++
  return comunes / (x.size + y.size - comunes)
}
