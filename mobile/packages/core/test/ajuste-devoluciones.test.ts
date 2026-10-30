// P2-43 (Juan 31/10/2026, 2ª versión): la refacturación sale SIN los artículos
// devueltos y el crédito de esa devolución se neutraliza (lib/pedidos/ajuste-devoluciones.ts).
import { describe, expect, it } from "vitest"
import { descontarDevuelto, neutralizacionDevolucion, repartirDevolucionDeAnulacion, tipoNeutralizacion, type RenglonDevuelto } from "../../../../lib/pedidos/ajuste-devoluciones"
import type { OrigenDevolucion } from "../../../../lib/cobranzas/valor-devolucion"

const pres = (precio: number, o: Partial<OrigenDevolucion> = {}): OrigenDevolucion => ({
  comprobante_venta_id: "pres", tipo_comprobante: "PRES", numero_comprobante: "0001-00000001",
  fiscal: false, percepcion_iva: false, bonificado_contado: false, exacto: true, precio, iva_unitario: null, ...o,
})
const fa = (neto: number, o: Partial<OrigenDevolucion> = {}): OrigenDevolucion => ({
  comprobante_venta_id: "fa", tipo_comprobante: "FA", numero_comprobante: "0007-00000001",
  fiscal: true, percepcion_iva: true, bonificado_contado: false, exacto: true, precio: neto, iva_unitario: null, ...o,
})
const dev = (articulo_id: string, cantidad: number, precio: number, origen: OrigenDevolucion): RenglonDevuelto => ({
  id: articulo_id, articulo_id, descripcion: articulo_id, cantidad, precio, origen,
})
const r2 = (n: number) => Math.round(n * 100) / 100

describe("P2-43 refacturar sin lo devuelto", () => {
  it("ejemplo de Juan: PRES $1.100, devuelve las esponjas, se refactura +20 % → saldo $1.200", () => {
    // PRES viejo: 10 trapos × $100 + 10 esponjas × $10. Devolución: REV −$100
    const n = neutralizacionDevolucion([dev("esponja", 10, 10, pres(10))], 0)
    expect(n).toHaveLength(1)
    expect([n[0].fiscal, n[0].total, tipoNeutralizacion(n[0].fiscal, "REV")]).toEqual([false, 100, "PRES"])

    // El comprobante nuevo sale sin las esponjas
    const cant = descontarDevuelto(
      [{ id: "t", articulo_id: "trapo", cantidad: 10 }, { id: "e", articulo_id: "esponja", cantidad: 10 }],
      new Map([["esponja", 10]]),
    )
    expect(Object.fromEntries(cant)).toEqual({ t: 10, e: 0 })
    const presNuevo = cant.get("t")! * 120 + cant.get("e")! * 12
    expect(presNuevo).toBe(1200)

    // Cuenta: PRES viejo + REV devolución + anulación + PRES neutralización + PRES nuevo
    const saldo = r2(1100 - 100 - 1100 + n[0].total + presNuevo)
    expect(saldo).toBe(1200)
    // El crédito de la anulación (lo que sobró: los $100 devueltos) va a la neutralización, no al PRES nuevo
    const rep = repartirDevolucionDeAnulacion(100, [
      { comprobante_id: "viejo", monto: 1000, es_ajuste: false, es_original: true },
      { comprobante_id: "neutraliza", monto: 100, es_ajuste: true, es_original: false },
    ])
    expect(Object.fromEntries(rep)).toEqual({ neutraliza: 100 })
  })

  it("devolución parcial: se factura lo que el cliente se quedó", () => {
    const cant = descontarDevuelto([{ id: "e", articulo_id: "esponja", cantidad: 10 }], new Map([["esponja", 4]]))
    expect(cant.get("e")).toBe(6)
  })

  it("lo devuelto no se descuenta de la mercadería bonificada", () => {
    const cant = descontarDevuelto(
      [{ id: "regalo", articulo_id: "a", cantidad: 2, es_bonificado: true }, { id: "cobrado", articulo_id: "a", cantidad: 10 }],
      new Map([["a", 3]]),
    )
    expect(Object.fromEntries(cant)).toEqual({ regalo: 2, cobrado: 7 })
  })

  it("devolución mixta: solo se neutraliza la parte de este pedido (lo del respaldo queda aparte)", () => {
    // DEV con 10 esponjas de este pedido ($10) y 3 baldes del sistema viejo ($50, respaldo):
    // a la neutralización llegan solo los renglones de este pedido
    const n = neutralizacionDevolucion([dev("esponja", 10, 10, pres(10))], 0)
    expect(n.map((x) => x.total)).toEqual([100])
    const cant = descontarDevuelto([{ id: "e", articulo_id: "esponja", cantidad: 10 }, { id: "b", articulo_id: "balde", cantidad: 5 }], new Map([["esponja", 10]]))
    expect(cant.get("b")).toBe(5)
  })

  it("devolución de una FACTURA A: se neutraliza con ND A, con IVA, percepción IVA e IIBB tal cual se acreditó", () => {
    const [n] = neutralizacionDevolucion([dev("a", 10, 100, fa(100))], 3)
    expect({ fiscal: n.fiscal, neto: n.neto, iva: n.iva, perc: n.percepcionIva, iibb: n.percepcionIibb, total: n.total })
      .toEqual({ fiscal: true, neto: 1000, iva: 210, perc: 30, iibb: 30, total: 1270 })
    expect(tipoNeutralizacion(true, "NCA")).toBe("NDA")
    expect(tipoNeutralizacion(true, "NCB")).toBe("NDB")
    expect(n.detalle).toEqual([{ articulo_id: "a", descripcion: "a", cantidad: 10, neto: 1000 }])
  })

  it("una devolución con parte factura y parte presupuesto neutraliza cada una con su tipo", () => {
    const ns = neutralizacionDevolucion([dev("a", 1, 100, fa(100, { percepcion_iva: false })), dev("b", 2, 50, pres(50))], 0)
    expect(ns.map((n) => [n.fiscal, n.total])).toEqual([[true, 121], [false, 100]])
  })

  it("si se acreditó con el 10 % contado, se neutraliza lo acreditado (90 %)", () => {
    const [n] = neutralizacionDevolucion([dev("e", 10, 10, pres(10, { bonificado_contado: true }))], 0)
    expect(n.total).toBe(90)
  })
})

describe("P2-43 parte devolución del crédito de anulación", () => {
  it("con pago: primero la neutralización, el resto (lo pagado) al comprobante nuevo no es devolución", () => {
    // Anulación sobrante $400 = $300 pagados + $100 devueltos
    const rep = repartirDevolucionDeAnulacion(100, [
      { comprobante_id: "orig", monto: 600, es_ajuste: false, es_original: true },
      { comprobante_id: "nuevo", monto: 300, es_ajuste: false, es_original: false },
      { comprobante_id: "neutraliza", monto: 100, es_ajuste: true, es_original: false },
    ])
    expect(Object.fromEntries(rep)).toEqual({ neutraliza: 100 })
  })

  it("sin neutralización (falló o es de antes), lo devuelto que llega al nuevo cuenta como devolución", () => {
    const rep = repartirDevolucionDeAnulacion(50, [{ comprobante_id: "nuevo", monto: 300, es_ajuste: false, es_original: false }])
    expect(rep.get("nuevo")).toBe(50)
  })
})
