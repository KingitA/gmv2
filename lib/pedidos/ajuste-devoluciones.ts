// P2-43 — Devoluciones de un pedido REFACTURADO (regla de Juan 31/10/2026):
// la devolución vale al precio de la factura VIGENTE. Compra a $100, se
// refactura a $110 → la devolución vale $110 (si se quedaba en $100 le
// cobrábamos $10 de más). Al emitir el comprobante nuevo, por cada devolución
// ya acreditada contra el comprobante anulado se emite solo la DIFERENCIA:
//  - precio nuevo más alto → crédito extra (REV si va por presupuesto, NC si por factura);
//  - más bajo → débito por la diferencia (PRES si presupuesto, ND si factura).
// Parte pura (sin base), compartida con los tests. La parte con base está en
// lib/pedidos/ajuste-devoluciones-refacturado.ts.

import { valorDevolucionConOrigen, type OrigenDevolucion, type ValorDevolucionResult } from "../cobranzas/valor-devolucion"

const r2 = (n: number) => Math.round(n * 100) / 100
/** Menos de un centavo no es ajuste */
const MINIMO = 0.005

export interface RenglonAjuste {
  id: string
  articulo_id: string
  descripcion?: string | null
  cantidad: number
  /** Como quedó acreditado: precio y origen del comprobante anulado */
  precio_viejo: number
  origen_viejo: OrigenDevolucion
  /** Como vale hoy: precio y origen del comprobante nuevo */
  precio_nuevo: number
  origen_nuevo: OrigenDevolucion
}

export interface AjusteClase {
  /** NC/ND (true) o REV/PRES (false) */
  fiscal: boolean
  /** +1 = crédito extra al cliente (NC/REV); −1 = débito (ND/PRES) */
  signo: 1 | -1
  /** Importes en positivo (el signo lo pone el tipo de comprobante) */
  neto: number
  iva: number
  baseIva: number
  percepcionIva: number
  percepcionIibb: number
  total: number
  /** Componentes con signos distintos (ej. el comprobante nuevo lleva percepción IVA y el viejo no): no se emite solo */
  mixto: boolean
  /** Diferencia de neto por renglón, en positivo en el sentido del ajuste */
  detalle: Array<{ articulo_id: string; descripcion?: string | null; cantidad: number; neto: number }>
}

export interface CalculoAjuste {
  viejo: ValorDevolucionResult
  nuevo: ValorDevolucionResult
  ajustes: AjusteClase[]
}

/**
 * Valor acreditado vs valor al precio nuevo, con la MISMA regla que la NC/REV
 * (valorDevolucionConOrigen) y la misma alícuota IIBB: la diferencia es solo el
 * cambio de precio. Por clase (factura / presupuesto): si un artículo cambió de
 * clase al refacturar, sale el débito de lo viejo en su clase y el crédito de lo
 * nuevo en la otra.
 */
export function calcularAjusteDevolucion(renglones: RenglonAjuste[], alicuotaIIBB: number): CalculoAjuste {
  const viejo = valorDevolucionConOrigen(
    renglones.map((r) => ({ cantidad: r.cantidad, precio_venta_original: r.precio_viejo, origen: r.origen_viejo })),
    alicuotaIIBB,
  )
  const nuevo = valorDevolucionConOrigen(
    renglones.map((r) => ({ cantidad: r.cantidad, precio_venta_original: r.precio_nuevo, origen: r.origen_nuevo })),
    alicuotaIIBB,
  )
  const ajustes: AjusteClase[] = []
  for (const fiscal of [true, false]) {
    const dif = fiscal
      ? {
          neto: r2(nuevo.fiscal.neto - viejo.fiscal.neto),
          iva: r2(nuevo.fiscal.iva - viejo.fiscal.iva),
          baseIva: r2(nuevo.fiscal.baseIva - viejo.fiscal.baseIva),
          percepcionIva: r2(nuevo.fiscal.percepcionIva - viejo.fiscal.percepcionIva),
          percepcionIibb: r2(nuevo.fiscal.percepcionIibb - viejo.fiscal.percepcionIibb),
          total: r2(nuevo.fiscal.total - viejo.fiscal.total),
        }
      : (() => {
          const t = r2(nuevo.rev.total - viejo.rev.total)
          return { neto: t, iva: 0, baseIva: 0, percepcionIva: 0, percepcionIibb: 0, total: t }
        })()
    if (Math.abs(dif.total) < MINIMO) continue
    const signo: 1 | -1 = dif.total > 0 ? 1 : -1
    const comps = [dif.neto, dif.iva, dif.percepcionIva, dif.percepcionIibb]
    const mixto = comps.some((c) => Math.abs(c) >= MINIMO && Math.sign(c) !== signo)
    const detalle = renglones
      .map((r, i) => {
        const n = (r.origen_nuevo.fiscal === fiscal ? nuevo.netoPorRenglon[i] ?? 0 : 0) - (r.origen_viejo.fiscal === fiscal ? viejo.netoPorRenglon[i] ?? 0 : 0)
        return { articulo_id: r.articulo_id, descripcion: r.descripcion, cantidad: r.cantidad, neto: r2(signo * n) }
      })
      .filter((d) => Math.abs(d.neto) >= MINIMO)
    // El detalle suma el neto del ajuste: el redondeo lo absorbe el último renglón
    if (detalle.length) {
      const suma = detalle.reduce((s, d) => s + d.neto, 0)
      detalle[detalle.length - 1].neto = r2(detalle[detalle.length - 1].neto + Math.abs(dif.neto) - suma)
    }
    ajustes.push({
      fiscal,
      signo,
      neto: Math.abs(dif.neto),
      iva: Math.abs(dif.iva),
      baseIva: Math.abs(dif.baseIva),
      percepcionIva: Math.abs(dif.percepcionIva),
      percepcionIibb: Math.abs(dif.percepcionIibb),
      total: Math.abs(dif.total),
      mixto,
      detalle,
    })
  }
  return { viejo, nuevo, ajustes }
}

/** Tipo del comprobante de ajuste según la clase, el sentido y la factura nueva (A/B/C). */
export function tipoAjuste(fiscal: boolean, signo: 1 | -1, tipoFactura: string | null | undefined): string {
  if (!fiscal) return signo > 0 ? "REV" : "PRES"
  const letra = tipoFactura === "FA" ? "A" : tipoFactura === "FC" ? "C" : "B"
  return (signo > 0 ? "NC" : "ND") + letra
}

/**
 * Cuánto de una NC/REV de ANULACIÓN es devolución y no pago (base del 10 %
 * contado y comisión del comprobante refacturado). Al anular, el inverso cubre
 * todo el comprobante: lo que le queda de crédito es lo pagado + lo devuelto.
 * La parte devolución (`devParte`) va primero a los débitos de ajuste de
 * devoluciones (P2-43, precio más bajo) y lo que sobra, en orden, a los
 * comprobantes nuevos. La imputación contra el comprobante anulado (el cruce de
 * la anulación) no cuenta. Devuelve comprobante_id → parte devolución.
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
