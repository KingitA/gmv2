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
// Parte pura (sin base), compartida con los tests. La parte con base está en
// lib/pedidos/ajuste-devoluciones-refacturado.ts.

const r2 = (n: number) => Math.round(n * 100) / 100

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
