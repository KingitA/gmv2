/**
 * Bultos y unidades en la recepción de mercadería (E-30).
 *
 * REGLA: el stock, el kardex y `movimientos_stock` van SIEMPRE en unidades base.
 * La orden de compra se pide por bulto o por unidad (`ordenes_compra_detalle.tipo_cantidad`)
 * y el operario cuenta en la unidad de esa línea, salvo que elija otra. Todo lo que
 * suma stock pasa por `aUnidadesBase`.
 *
 * Archivo PURO (sin base ni red): lo usan el servidor (lib/deposito/recepciones.ts),
 * la pantalla de verificación de la oficina y la app Depósito (`@gm/deposito`).
 * Tests: mobile/packages/core/test/deposito-unidades.test.ts
 */

export type UnidadConteo = "bulto" | "unidad"

/** Unidades por bulto utilizables para convertir: número mayor a 1. Si no, 1. */
export function unidadesPorBultoDe(valor: unknown): number {
  const n = Number(valor)
  return Number.isFinite(n) && n > 1 ? n : 1
}

/** `tipo_cantidad` de la línea de la OC → unidad. La columna nace en 'bulto' (valor por defecto de la base). */
export function unidadLineaOC(tipoCantidad: unknown): UnidadConteo {
  return tipoCantidad === "unidad" ? "unidad" : "bulto"
}

export const esUnidadConteo = (v: unknown): v is UnidadConteo => v === "bulto" || v === "unidad"

export interface ConversionLinea {
  /** En qué está pedida la línea (fuera de OC: "unidad") */
  unidadOC: UnidadConteo
  /** En qué se contó (o se va a contar) lo recibido */
  unidadConteo: UnidadConteo
  /** Unidades base por cada 1 de `cantidad_oc` */
  factorOC: number
  /** Unidades base por cada 1 de `cantidad_fisica` */
  factorConteo: number
  unidadesPorBulto: number
  /** Se cuenta o se pidió por bulto pero el artículo no tiene unidades por bulto: se toma 1 (revisar la ficha) */
  sinUnidadesPorBulto: boolean
}

/**
 * Cómo se convierte una línea de recepción a unidades base.
 *  - Línea de la OC: unidad de la OC (bulto ⇒ × unidades por bulto del artículo).
 *  - Artículo fuera de la OC: unidades, salvo que el operario elija bultos.
 *  - `unidadElegida` (app nueva) manda sobre el valor por defecto. Las APK viejas
 *    no la envían: cuentan en la unidad de la línea, que es el número que ven.
 */
export function conversionLinea(p: {
  enOC: boolean
  tipoCantidadOC?: unknown
  unidadElegida?: unknown
  unidadesPorBulto?: unknown
}): ConversionLinea {
  const unidadesPorBulto = unidadesPorBultoDe(p.unidadesPorBulto)
  const unidadOC: UnidadConteo = p.enOC ? unidadLineaOC(p.tipoCantidadOC) : "unidad"
  const unidadConteo: UnidadConteo = esUnidadConteo(p.unidadElegida) ? p.unidadElegida : unidadOC
  return {
    unidadOC,
    unidadConteo,
    factorOC: unidadOC === "bulto" ? unidadesPorBulto : 1,
    factorConteo: unidadConteo === "bulto" ? unidadesPorBulto : 1,
    unidadesPorBulto,
    sinUnidadesPorBulto: unidadesPorBulto === 1 && (unidadOC === "bulto" || unidadConteo === "bulto"),
  }
}

/** Cantidad × factor, en unidades base (4 decimales para no arrastrar basura de coma flotante). */
export function aUnidadesBase(cantidad: unknown, factor: unknown): number {
  const c = Number(cantidad)
  const f = Number(factor)
  if (!Number.isFinite(c) || c <= 0) return 0
  return Math.round(c * (Number.isFinite(f) && f > 0 ? f : 1) * 10000) / 10000
}

/** Unidades base → cantidad en la unidad dada (para mostrar "lo contado" en la unidad de la OC). */
export function desdeUnidadesBase(base: unknown, factor: unknown): number {
  const b = Number(base)
  const f = Number(factor)
  if (!Number.isFinite(b)) return 0
  return Math.round((b / (Number.isFinite(f) && f > 0 ? f : 1)) * 10000) / 10000
}

/**
 * Lo que falta recibir de una línea de la orden (E-39/E-92): lo pedido menos lo ya recibido en
 * entregas anteriores. `enUnidadOC` va en la unidad de la línea (bultos si se pidió por bulto),
 * que es en lo que el depósito ve y cuenta la segunda entrega.
 */
export function pendienteDeLinea(cantidadPedida: unknown, factorOC: unknown, recibidoBase: unknown): { base: number; enUnidadOC: number } {
  const f = Number(factorOC) > 0 ? Number(factorOC) : 1
  const base = Math.round(Math.max(0, aUnidadesBase(cantidadPedida, f) - (Number(recibidoBase) || 0)) * 10000) / 10000
  // menos de una centésima no es un faltante: es redondeo
  if (base < 0.01) return { base: 0, enUnidadOC: 0 }
  return { base, enUnidadOC: Math.round((base / f) * 100) / 100 }
}

/** Unidades base → bultos ENTEROS hacia arriba (no se puede pedir medio bulto). */
export function bultosParaCubrir(unidades: unknown, unidadesPorBulto: unknown): number {
  const u = Number(unidades)
  if (!Number.isFinite(u) || u <= 0) return 0
  return Math.ceil(u / unidadesPorBultoDe(unidadesPorBulto) - 1e-9)
}

/** Cantidad para mostrar, formato argentino sin ceros de más: 1200 → "1.200" · 1.5 → "1,5". */
export function cant(v: unknown): string {
  const r = Math.round((Number(v) || 0) * 100) / 100
  const [entero, decimales] = String(Math.abs(r)).split(".")
  return (r < 0 ? "-" : "") + entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (decimales ? "," + decimales : "")
}
const n = cant
const plural = (v: number, uno: string, muchos: string) => (v === 1 ? uno : muchos)

/** "2 bultos" · "1 bulto" · "48 u" (sin la cuenta). */
export function cantidadConUnidad(cantidad: unknown, unidad: UnidadConteo): string {
  const c = Number(cantidad) || 0
  return unidad === "unidad" ? `${n(c)} u` : `${n(c)} ${plural(c, "bulto", "bultos")}`
}

/**
 * Texto sin ambigüedad de una cantidad: "2 bultos × 24 u = 48 u" · "48 u" ·
 * "2 bultos (sin unidades por bulto cargadas)".
 */
export function textoCantidad(cantidad: unknown, unidad: UnidadConteo, unidadesPorBulto: unknown): string {
  const c = Number(cantidad) || 0
  if (unidad === "unidad") return `${n(c)} u`
  const upb = unidadesPorBultoDe(unidadesPorBulto)
  const bultos = `${n(c)} ${plural(c, "bulto", "bultos")}`
  if (upb === 1) return `${bultos} (sin unidades por bulto cargadas)`
  return `${bultos} × ${n(upb)} u = ${n(aUnidadesBase(c, upb))} u`
}
