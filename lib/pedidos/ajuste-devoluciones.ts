// P2-43 — Devoluciones de un pedido REFACTURADO (regla de Juan, 31/10/2026, 2ª versión):
// la refacturación sale SIN los artículos devueltos.
//  1. Lo devuelto contra los comprobantes de ESTE pedido no se vuelve a facturar:
//     cantidad a facturar = lo preparado − lo devuelto. El crédito de esa parte
//     de la devolución se NEUTRALIZA con un débito (PRES si fue REV, ND si fue NC):
//     el pedido queda como si se hubiera vendido sin esos artículos.
//  2. Lo devuelto de OTROS comprobantes o del sistema viejo (respaldo
//     0002-00000001) queda aparte: su NC/REV sigue acreditando por su lado. Si
//     una NC/REV mezcla las dos partes, se neutraliza solo la de este pedido.
// Ejemplo de Juan: PRES $1.100 (10 trapos × $100 + 10 esponjas × $10), devuelve
// las esponjas (REV $100), se refactura +20 %: anulación −$1.100, PRES de
// neutralización +$100, PRES nuevo solo con los trapos $1.200. Saldo $1.200.
// Parte pura (sin base), compartida con los tests. La parte con base está en
// lib/pedidos/ajuste-devoluciones-refacturado.ts.

import { valorDevolucionConOrigen, type OrigenDevolucion } from "../cobranzas/valor-devolucion"

const r2 = (n: number) => Math.round(n * 100) / 100
const MINIMO = 0.005

export interface RenglonDevuelto {
  id: string
  articulo_id: string
  descripcion?: string | null
  cantidad: number
  /** Precio y origen con que se acreditó (comprobante anulado de este pedido) */
  precio: number
  origen: OrigenDevolucion
}

export interface Neutralizacion {
  /** ND (true) o PRES (false) */
  fiscal: boolean
  /** Importes en positivo: es un débito al cliente */
  neto: number
  iva: number
  baseIva: number
  percepcionIva: number
  percepcionIibb: number
  total: number
  detalle: Array<{ articulo_id: string; descripcion?: string | null; cantidad: number; neto: number }>
}

/**
 * Cuánto se acreditó por la parte de la devolución que es de este pedido, por
 * clase (factura / presupuesto), con la MISMA regla que emitió la NC/REV
 * (valorDevolucionConOrigen, misma alícuota IIBB): es lo que hay que neutralizar.
 */
export function neutralizacionDevolucion(renglones: RenglonDevuelto[], alicuotaIIBB: number): Neutralizacion[] {
  const v = valorDevolucionConOrigen(
    renglones.map((r) => ({ cantidad: r.cantidad, precio_venta_original: r.precio, origen: r.origen })),
    alicuotaIIBB,
  )
  const out: Neutralizacion[] = []
  for (const fiscal of [true, false]) {
    const total = fiscal ? v.fiscal.total : v.rev.total
    if (total < MINIMO) continue
    const detalle = renglones
      .map((r, i) => ({ r, neto: v.netoPorRenglon[i] ?? 0 }))
      .filter(({ r, neto }) => !!r.origen.fiscal === fiscal && neto >= MINIMO)
      .map(({ r, neto }) => ({ articulo_id: r.articulo_id, descripcion: r.descripcion, cantidad: r.cantidad, neto: r2(neto) }))
    out.push(
      fiscal
        ? { fiscal, neto: v.fiscal.neto, iva: v.fiscal.iva, baseIva: v.fiscal.baseIva, percepcionIva: v.fiscal.percepcionIva, percepcionIibb: v.fiscal.percepcionIibb, total: v.fiscal.total, detalle }
        : { fiscal, neto: v.rev.total, iva: 0, baseIva: 0, percepcionIva: 0, percepcionIibb: 0, total: v.rev.total, detalle },
    )
  }
  return out
}

/** Tipo del débito que neutraliza: PRES (la devolución fue REV) o ND A/B/C (fue NC). */
export function tipoNeutralizacion(fiscal: boolean, tipoCredito: string | null | undefined): string {
  if (!fiscal) return "PRES"
  return tipoCredito === "NCA" ? "NDA" : tipoCredito === "NCC" ? "NDC" : "NDB"
}

/**
 * Cantidad a facturar de cada renglón del pedido descontando lo devuelto contra
 * sus comprobantes anulados. Lo devuelto se descuenta de los renglones cobrados
 * (no de la mercadería bonificada), en orden. Devuelve renglón → cantidad.
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
 * Cuánto de una NC/REV de ANULACIÓN es devolución y no pago (base del 10 %
 * contado y comisión del comprobante refacturado). Al anular, el inverso cubre
 * todo el comprobante: lo que le queda de crédito es lo pagado + lo devuelto.
 * La parte devolución (`devParte`) va primero a los débitos que neutralizan
 * devoluciones y lo que sobra, en orden, a los comprobantes nuevos. La
 * imputación contra el comprobante anulado (el cruce de la anulación) no
 * cuenta. Devuelve comprobante_id → parte devolución.
 */
export function repartirDevolucionDeAnulacion(
  devParte: number,
  imputaciones: Array<{ comprobante_id: string; monto: number; es_ajuste: boolean; es_original: boolean }>,
): Map<string, number> {
  const out = new Map<string, number>()
  let resto = Math.max(0, r2(devParte))
  const orden = [...imputaciones.filter((i) => i.es_ajuste && !i.es_original), ...imputaciones.filter((i) => !i.es_ajuste && !i.es_original)]
  for (const i of orden) {
    if (resto < MINIMO) break
    const parte = r2(Math.min(resto, Math.max(0, Number(i.monto) || 0)))
    if (parte < MINIMO) continue
    resto = r2(resto - parte)
    out.set(i.comprobante_id, r2((out.get(i.comprobante_id) ?? 0) + parte))
  }
  return out
}
