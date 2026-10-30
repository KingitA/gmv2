// P2-43 — Devoluciones de un pedido que se REFACTURA (flujo de Juan, 31/10/2026, definitivo).
// Ejemplo: PRES $1.100 (10 trapos × $100 + 10 esponjas × $10); devuelve las
// esponjas (REV −$100). Al refacturar a Neco (+20 %):
//  - REV de anulación por $1.100 (los dos artículos), como siempre;
//  - las esponjas SALEN del pedido: la REV de la devolución queda SIN EFECTO
//    (anulada, imputaciones liberadas y asiento revertido), sin documento nuevo;
//    la devolución queda "aplicada en la refacturación del pedido N";
//  - PRES nuevo solo con los trapos: $1.200. Saldo $1.200.
// Lo que ve el cliente: PRES 1.100, REV 1.100, PRES 1.200.
//  - Devolución mezclada con otros comprobantes o el sistema viejo: la parte de
//    este pedido se aplica igual; lo demás queda acreditado en su NC/REV.
//  - FISCAL: una NC con CAE no se puede dejar sin efecto. La factura se anula
//    por lo que falta acreditar (total − NC de devolución imputada), sin ND.
//  - Devolución aceptada todavía sin REV/NC: no se emite; se aplica igual.
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
 * stock). Devuelve índice de renglón → cantidad a reingresar.
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

/**
 * Qué hacer con la REV (presupuesto) de una devolución al refacturar: su parte de
 * este pedido queda sin efecto. `parte` = lo que vale lo devuelto de este pedido.
 * Total → se anula entera; si no, queda acreditada solo por lo de otros orígenes.
 */
export function revSinEfecto(totalRev: number, parte: number): { entera: boolean; parte: number; queda: number } {
  const total = r2(Math.abs(totalRev))
  const p = r2(Math.min(total, Math.max(0, parte)))
  const queda = r2(total - p)
  return { entera: queda < 0.01, parte: queda < 0.01 ? total : p, queda: queda < 0.01 ? 0 : queda }
}

/** FISCAL: la factura se anula por lo que falta acreditar (total − NC de devolución imputada a ella). */
export function montoAnulacionFiscal(totalFactura: number, ncDevolucionImputada: number): number {
  return r2(Math.max(0, Math.abs(totalFactura) - Math.max(0, ncDevolucionImputada)))
}

/**
 * Cuánto de una NC/REV de ANULACIÓN es devolución y no pago. Con el flujo de
 * Juan la anulación ya no trae devoluciones (la REV de la devolución queda sin
 * efecto; en fiscal la anulación es por total − NC), así que da 0. Queda para
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
