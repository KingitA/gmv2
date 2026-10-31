// P2-43 — Devoluciones de un pedido que se REFACTURA (regla DEFINITIVA de Juan, 31/10/2026).
// Las REV/NC de devolución se emiten cuando la mercadería entra al depósito y son
// INTOCABLES. Si el comprobante está cobrado al 100 %, no se refactura.
// Ejemplo: PRES $1.100 (10 trapos × $100 + 10 esponjas × $10); devuelve las
// esponjas. Se refactura a Neco (+20 %):
//  CASO 1 — la devolución todavía no tiene REV/NC: anulación por el TOTAL
//    ($1.100), PRES nuevo sin lo devuelto ($1.200), la devolución se cierra sin
//    emitir ("aplicada en la refacturación"). Saldo 1.100 − 1.100 + 1.200 = $1.200.
//  CASO 2 — ya tiene su REV/NC (−$100) imputada al comprobante: la REV/NC queda
//    como está; la anulación es solo por lo que falta cancelar ($1.100 − $100 =
//    $1.000; fiscal igual: NC de anulación por $1.000, sin ND); PRES nuevo sin lo
//    devuelto ($1.200). Saldo 1.100 − 100 − 1.000 + 1.200 = $1.200.
//  Mixtas: la parte de otros comprobantes o del sistema viejo ya está imputada a
//  esos otros comprobantes (P2-41): no entra en la cuenta de este.
//  Todo devuelto: sin comprobante nuevo → $0.
//  PENDIENTE (Juan 1/11: no traba la refacturación de un pedido que está en la
//    calle): como el caso 1, por lo DECLARADO (lo que cargó el chofer o el
//    vendedor); queda marcada y nunca emite su REV/NC. Cuando depósito la revisa,
//    si acepta menos, la diferencia se le cobra al cliente (PRES, o ND si el
//    origen era factura) al precio del comprobante nuevo.
// Parte pura (sin base), compartida con los tests. La parte con base está en
// lib/pedidos/ajuste-devoluciones-refacturado.ts.

const r2 = (n: number) => Math.round(n * 100) / 100
const IVA_RATE = 0.21

/** Comprobantes en cuya refacturación se aplicó la devolución (marca `[aplicada:<id>]` en sus observaciones). */
export function comprobantesAplicados(observaciones: string | null | undefined): Set<string> {
  return new Set([...String(observaciones || "").matchAll(/\[aplicada:([^\]]+)\]/g)].map((m) => m[1]))
}

/** Aplicada cuando depósito todavía no la había revisado: vale lo declarado. */
export const MARCA_DECLARADA = "[declarada]"
export const esAplicadaDeclarada = (observaciones: string | null | undefined) => String(observaciones || "").includes(MARCA_DECLARADA)

/**
 * Un renglón contra un comprobante donde la devolución ya se aplicó no es
 * crédito (ni en proceso ni NC/REV): el comprobante nuevo ya salió sin eso.
 */
export function renglonAplicado(observaciones: string | null | undefined, comprobanteVentaId: string | null | undefined): boolean {
  return !!comprobanteVentaId && comprobantesAplicados(observaciones).has(comprobanteVentaId)
}

/** Lo declarado de un renglón (antes de la revisión de depósito). */
export const cantidadDeclarada = (r: { cantidad: number | string | null; cantidad_original?: number | string | null }) =>
  Number(r.cantidad_original ?? r.cantidad) || 0

/** Lo que el cliente se quedó de un renglón aplicado por lo declarado: declarado − aceptado (rechazado = todo). */
export function faltanteDeclarado(r: { cantidad: number | string | null; cantidad_original?: number | string | null; estado_renglon?: string | null }): number {
  const aceptado = r.estado_renglon === "rechazado" ? 0 : Number(r.cantidad) || 0
  return Math.max(0, Math.round((cantidadDeclarada(r) - aceptado) * 1000) / 1000)
}

export interface DiferenciaACobrar {
  neto: number
  iva: number
  /** Base de la percepción IVA */
  baseIva: number
  percepcionIva: number
  percepcionIibb: number
  alicuotaIIBB: number
  total: number
  detalle: Array<{ articulo_id: string; descripcion: string; cantidad: number; neto: number }>
}

/**
 * Valúa lo que el cliente se quedó al precio del comprobante nuevo (el renglón
 * del pedido, ya con la lista nueva: misma cuenta que generar). Factura: neto +
 * IVA, percepciones en la misma proporción que el comprobante de referencia.
 * Presupuesto: precio final (perfumería: neto, como generar).
 */
export function valuarDiferencia(
  renglones: Array<{ articulo_id: string; descripcion: string; cantidad: number; precio_final: number; precio_base?: number | null; perfumeria?: boolean }>,
  fiscal: boolean,
  ref: { neto: number; percepcion_iva: number; percepcion_iibb: number } | null,
): DiferenciaACobrar {
  const detalle: DiferenciaACobrar["detalle"] = []
  let neto = 0
  let iva = 0
  for (const r of renglones) {
    if (!(r.cantidad > 0)) continue
    const final = Number(r.precio_final) || 0
    const base = Number(r.precio_base) > 0 ? Number(r.precio_base) : r2(final / (1 + IVA_RATE))
    const unit = fiscal ? base : r.perfumeria ? base : final
    const n = r2(unit * r.cantidad)
    neto = r2(neto + n)
    if (fiscal) iva = r2(iva + r2(r2(final - base) * r.cantidad))
    detalle.push({ articulo_id: r.articulo_id, descripcion: r.descripcion, cantidad: r.cantidad, neto: n })
  }
  const refNeto = Math.abs(Number(ref?.neto) || 0)
  const prop = (x: number | undefined) => (fiscal && refNeto > 0 ? r2((Math.abs(Number(x) || 0) * neto) / refNeto) : 0)
  const percepcionIva = prop(ref?.percepcion_iva)
  const percepcionIibb = prop(ref?.percepcion_iibb)
  const alicuotaIIBB = fiscal && refNeto > 0 ? r2((Math.abs(Number(ref?.percepcion_iibb) || 0) / refNeto) * 100) : 0
  return { neto, iva, baseIva: neto, percepcionIva, percepcionIibb, alicuotaIIBB, total: r2(neto + iva + percepcionIva + percepcionIibb), detalle }
}

/**
 * Cantidad a facturar de cada renglón del pedido descontando lo devuelto (lo
 * aplicado en la refacturación). Se descuenta de los renglones cobrados (no de
 * la mercadería bonificada), en orden. Devuelve renglón → cantidad.
 */
export function descontarDevuelto(
  renglones: Array<{ id: string; articulo_id: string; cantidad: number; es_bonificado?: boolean | null }>,
  devuelto: Map<string, number>,
): Map<string, number> {
  const resto = new Map(devuelto)
  const out = new Map<string, number>()
  for (const r of renglones) {
    let cant = Math.max(0, Number(r.cantidad) || 0)
    const dev = resto.get(r.articulo_id) ?? 0
    if (dev > 0 && r.es_bonificado !== true) {
      const saca = Math.min(cant, dev)
      cant -= saca
      resto.set(r.articulo_id, dev - saca)
    }
    out.set(r.id, cant)
  }
  return out
}

/**
 * Cuánto stock reingresa la anulación de un comprobante: lo que salió MENOS lo
 * devuelto (la devolución ya reingresó lo vendible; lo no vendible no vuelve a
 * stock; la que depósito no revisó no llega acá). Devuelve índice de renglón → cantidad a reingresar.
 */
export function stockAReingresar(detalle: Array<{ articulo_id: string | null; cantidad: number }>, devuelto: Map<string, number>): number[] {
  const resto = new Map(devuelto)
  return detalle.map((d) => {
    const cant = Math.abs(Number(d.cantidad) || 0)
    if (!d.articulo_id) return cant
    const dev = resto.get(d.articulo_id) ?? 0
    const saca = Math.min(cant, dev)
    if (saca > 0) resto.set(d.articulo_id, dev - saca)
    return cant - saca
  })
}

/** Caso 2: el comprobante se anula por lo que falta cancelar (total − REV/NC de devolución imputadas a él). 0 = no hay inverso. */
export function montoAnulacion(total: number, devolucionesImputadas: number): number {
  return r2(Math.max(0, Math.abs(total) - Math.max(0, devolucionesImputadas)))
}

/**
 * Cuánto de una NC/REV de ANULACIÓN es devolución y no pago. Con la regla de
 * Juan la anulación ya no trae devoluciones (es por total − devoluciones
 * imputadas), así que da 0. Queda para
 * los comprobantes refacturados antes (anulación por el total con la devolución
 * imputada: lo que le sobró incluía lo devuelto).
 *   devuelto: NC/REV de devolución vivas imputadas al comprobante anulado
 *   total: total del comprobante anulado; anulacion: total de la NC/REV de anulación
 */
export function parteDevolucionDeAnulacion(devuelto: number, total: number, anulacion: number): number {
  return r2(Math.max(0, Math.max(0, devuelto) - Math.max(0, Math.abs(total) - Math.abs(anulacion))))
}

/** Reparte la parte devolución de un crédito de anulación entre los comprobantes nuevos a los que se imputó (en orden; el cruce con el anulado no cuenta). */
export function repartirDevolucionDeAnulacion(
  devParte: number,
  imputaciones: Array<{ comprobante_id: string; monto: number; es_original: boolean }>,
): Map<string, number> {
  const out = new Map<string, number>()
  let resto = Math.max(0, r2(devParte))
  for (const i of imputaciones) {
    if (resto < 0.005) break
    if (i.es_original) continue
    const parte = r2(Math.min(resto, Math.max(0, Number(i.monto) || 0)))
    if (parte < 0.005) continue
    resto = r2(resto - parte)
    out.set(i.comprobante_id, r2((out.get(i.comprobante_id) ?? 0) + parte))
  }
  return out
}
