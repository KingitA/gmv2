// P2-43 (Juan 31/10/2026): al refacturar, la devolución vale al precio de la
// factura vigente y sale solo la diferencia (lib/pedidos/ajuste-devoluciones.ts).
import { describe, expect, it } from "vitest"
import { calcularAjusteDevolucion, repartirDevolucionDeAnulacion, tipoAjuste, type RenglonAjuste } from "../../../../lib/pedidos/ajuste-devoluciones"
import type { OrigenDevolucion } from "../../../../lib/cobranzas/valor-devolucion"

const pres = (precio: number, o: Partial<OrigenDevolucion> = {}): OrigenDevolucion => ({
  comprobante_venta_id: "pres", tipo_comprobante: "PRES", numero_comprobante: "0001-00000001",
  fiscal: false, percepcion_iva: false, bonificado_contado: false, exacto: true, precio, iva_unitario: null, ...o,
})
const fa = (neto: number, o: Partial<OrigenDevolucion> = {}): OrigenDevolucion => ({
  comprobante_venta_id: "fa", tipo_comprobante: "FA", numero_comprobante: "0007-00000001",
  fiscal: true, percepcion_iva: true, bonificado_contado: false, exacto: true, precio: neto, iva_unitario: null, ...o,
})
const renglon = (cantidad: number, viejo: number, ov: OrigenDevolucion, nuevo: number, on: OrigenDevolucion): RenglonAjuste => ({
  id: "r", articulo_id: "a", descripcion: "Art", cantidad, precio_viejo: viejo, origen_viejo: ov, precio_nuevo: nuevo, origen_nuevo: on,
})

describe("P2-43 ajuste de devoluciones al refacturar", () => {
  it("ejemplo de Juan: compra a $100, devuelve, se refactura a $110 → REV por $10", () => {
    const c = calcularAjusteDevolucion([renglon(1, 100, pres(100), 110, pres(110))], 0)
    expect(c.viejo.total).toBe(100)
    expect(c.nuevo.total).toBe(110)
    expect(c.ajustes).toHaveLength(1)
    const a = c.ajustes[0]
    expect([a.fiscal, a.signo, a.total, tipoAjuste(a.fiscal, a.signo, "PRES")]).toEqual([false, 1, 10, "REV"])
    expect(a.detalle).toEqual([{ articulo_id: "a", descripcion: "Art", cantidad: 1, neto: 10 }])
  })

  it("precio más bajo → débito PRES por la diferencia", () => {
    const [a] = calcularAjusteDevolucion([renglon(3, 100, pres(100), 90, pres(90))], 0).ajustes
    expect([a.signo, a.total, tipoAjuste(a.fiscal, a.signo, "PRES")]).toEqual([-1, 30, "PRES"])
  })

  it("mismo precio → no sale nada", () => {
    expect(calcularAjusteDevolucion([renglon(5, 100, pres(100), 100, pres(100))], 3).ajustes).toEqual([])
  })

  it("factura A con IVA, percepción IVA e IIBB: la NC de ajuste lleva cada componente", () => {
    // 10 u. a $100 neto → $110 neto; 21 % IVA, 3 % percepción IVA, 3 % IIBB
    const c = calcularAjusteDevolucion([renglon(10, 100, fa(100), 110, fa(110))], 3)
    expect(c.viejo.total).toBe(1270)
    expect(c.nuevo.total).toBe(1397)
    const [a] = c.ajustes
    expect({ neto: a.neto, iva: a.iva, perc: a.percepcionIva, iibb: a.percepcionIibb, total: a.total, mixto: a.mixto })
      .toEqual({ neto: 100, iva: 21, perc: 3, iibb: 3, total: 127, mixto: false })
    expect(tipoAjuste(a.fiscal, a.signo, "FA")).toBe("NCA")
    expect(tipoAjuste(true, -1, "FB")).toBe("NDB")
  })

  it("con 10 % contado en lo acreditado, el ajuste compara contra lo que se acreditó", () => {
    // Se acreditó $90 (100 − 10 %); el comprobante nuevo no tiene contado: vale $110
    const [a] = calcularAjusteDevolucion([renglon(1, 100, pres(100, { bonificado_contado: true }), 110, pres(110))], 0).ajustes
    expect([a.signo, a.total]).toEqual([1, 20])
  })

  it("el artículo pasó de presupuesto a factura: débito PRES de lo viejo y NC de lo nuevo", () => {
    const c = calcularAjusteDevolucion([renglon(1, 121, pres(121), 100, fa(100, { percepcion_iva: false }))], 0)
    const fiscal = c.ajustes.find((a) => a.fiscal)!
    const rev = c.ajustes.find((a) => !a.fiscal)!
    expect([fiscal.signo, fiscal.total, tipoAjuste(true, fiscal.signo, "FA")]).toEqual([1, 121, "NCA"])
    expect([rev.signo, rev.total, tipoAjuste(false, rev.signo, "PRES")]).toEqual([-1, 121, "PRES"])
  })

  it("percepción en sentido contrario al precio → marcado mixto (no se emite solo)", () => {
    // Baja el neto pero el comprobante nuevo lleva percepción IVA y el viejo no: el total sube
    const [a] = calcularAjusteDevolucion([renglon(1, 100, fa(100, { percepcion_iva: false }), 99, fa(99))], 0).ajustes
    expect([a.signo, a.neto, a.percepcionIva]).toEqual([1, 1, 2.97])
    expect(a.mixto).toBe(true)
  })

  it("el detalle suma el neto del ajuste al centavo", () => {
    const rs = [
      { ...renglon(3, 33.33, pres(33.33), 36.67, pres(36.67)), id: "1", articulo_id: "a" },
      { ...renglon(7, 12.01, pres(12.01), 13.13, pres(13.13)), id: "2", articulo_id: "b" },
    ]
    const [a] = calcularAjusteDevolucion(rs, 0).ajustes
    expect(Math.round(a.detalle.reduce((s, d) => s + d.neto, 0) * 100) / 100).toBe(a.neto)
  })
})

describe("P2-43 parte devolución del crédito de anulación", () => {
  it("primero el débito de ajuste, después el comprobante nuevo; el cruce con el anulado no cuenta", () => {
    const rep = repartirDevolucionDeAnulacion(100, [
      { comprobante_id: "orig", monto: 500, es_ajuste: false, es_original: true },
      { comprobante_id: "nuevo", monto: 300, es_ajuste: false, es_original: false },
      { comprobante_id: "ajuste", monto: 20, es_ajuste: true, es_original: false },
    ])
    expect(Object.fromEntries(rep)).toEqual({ ajuste: 20, nuevo: 80 })
  })

  it("lo que pasa de lo devuelto es pago (no se reparte de más)", () => {
    const rep = repartirDevolucionDeAnulacion(50, [{ comprobante_id: "nuevo", monto: 300, es_ajuste: false, es_original: false }])
    expect(rep.get("nuevo")).toBe(50)
  })
})
