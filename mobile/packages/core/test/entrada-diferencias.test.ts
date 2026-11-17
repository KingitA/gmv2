// E-90 / E-91 — la cuenta de una diferencia de compra: netos por unidad + IVA discriminado.
// Casos reales de la prueba en pantalla del 17/11 (OC-000011).
import { describe, expect, it } from "vitest"
import { calcularDiferencia, importe, netoDocumento, precioNeto } from "../../../../lib/compras/diferencias"

describe("precio neto", () => {
  it("descuentos en cascada", () => {
    expect(precioNeto(100, [10, 10])).toBeCloseTo(81, 6)
    expect(netoDocumento(1812.5, [20])).toBe(1450)
    expect(netoDocumento(1768.81, [20])).toBe(1415.05)
    expect(netoDocumento(696.04, [20])).toBe(556.83)
  })
})

describe("diferencia de PRECIO (caso real: generaba $2.097,12)", () => {
  const d = calcularDiferencia({
    oc: { cantidad_pedida: 48, factor: 1, precio_unitario: 1768.81, descuentos: [20, 0, 0, 0] },
    factura: [{ cantidad_facturada: 48, factor: 1, precio_unitario: 1812.5, descuentos: [20, 0, 0, 0], iva_porcentaje: 21 }],
    recibido_unidades: 48,
  })
  it("(1.450,00 − 1.415,05) × 48 = $1.677,60 neto, con IVA aparte", () => {
    expect(d.precio).not.toBeNull()
    expect(d.precio!.por_unidad).toBe(34.95)
    expect(d.precio!.unidades).toBe(48)
    expect(d.precio!.neto).toBe(1677.6)
    expect(d.precio!.iva).toBe(352.3)
    expect(d.precio!.total).toBe(2029.9)
    expect(d.precio!.a_favor).toBe("nuestro")
  })
  it("no hay diferencia de cantidad", () => expect(d.cantidad).toBeNull())
  it("para tomar el precio facturado como costo: lista y descuentos de la factura, no el neto", () => {
    expect(d.factura!.lista_unidad).toBe(1812.5)
    expect(d.factura!.descuentos).toEqual([20, 0, 0, 0])
  })
})

describe("FALTANTE (caso real: generaba $34.802,00 y bajaba 50 de stock)", () => {
  const d = calcularDiferencia({
    oc: { cantidad_pedida: 200, factor: 1, precio_unitario: 696.04, descuentos: [20] },
    factura: [{ cantidad_facturada: 200, factor: 1, precio_unitario: 696.04, descuentos: [20], iva_porcentaje: 21 }],
    recibido_unidades: 150,
  })
  it("50 u × $556,83 = $27.841,50 neto + IVA", () => {
    expect(d.cantidad).toMatchObject({ tipo: "faltante", unidades: 50, neto: 27841.5, iva: 5846.72, total: 33688.22 })
  })
  it("sin diferencia de precio", () => expect(d.precio).toBeNull())
})

describe("bultos y unidades", () => {
  it("OC por bulto y factura por bulto: 1 bulto de 24 u a $2.400 que falta = $2.400, no 24 × $2.400", () => {
    const d = calcularDiferencia({
      oc: { cantidad_pedida: 4, factor: 24, precio_unitario: 100, descuentos: [] },
      factura: [{ cantidad_facturada: 4, factor: 24, precio_unitario: 2400, descuentos: [], iva_porcentaje: 21 }],
      recibido_unidades: 72,
    })
    expect(d.oc).toEqual({ unidades: 96, neto_unidad: 100 })
    expect(d.factura!.unidades).toBe(96)
    expect(d.factura!.neto_unidad).toBe(100)
    expect(d.precio).toBeNull()
    expect(d.cantidad).toMatchObject({ tipo: "faltante", unidades: 24, neto: 2400, total: 2904 })
  })
  it("OC por bulto, factura por unidad: se comparan en unidades", () => {
    const d = calcularDiferencia({
      oc: { cantidad_pedida: 2, factor: 24, precio_unitario: 50, descuentos: [] },
      factura: [{ cantidad_facturada: 48, factor: 1, precio_unitario: 50, descuentos: [], iva_porcentaje: 21 }],
      recibido_unidades: 48,
    })
    expect([d.precio, d.cantidad]).toEqual([null, null])
  })
})

describe("otros casos", () => {
  it("sin factura: no hay diferencia en plata (falta contra la OC no se reclama)", () => {
    const d = calcularDiferencia({ oc: { cantidad_pedida: 4, factor: 24, precio_unitario: 100, descuentos: [] }, factura: [], recibido_unidades: 72 })
    expect([d.factura, d.precio, d.cantidad]).toEqual([null, null, null])
    expect(d.oc!.unidades).toBe(96)
  })
  it("llegó más de lo facturado: sobrante", () => {
    const d = calcularDiferencia({ oc: null, factura: [{ cantidad_facturada: 10, factor: 1, precio_unitario: 100, descuentos: [], iva_porcentaje: 21 }], recibido_unidades: 12 })
    expect(d.cantidad).toMatchObject({ tipo: "sobrante", unidades: 2, neto: 200 })
  })
  it("facturado más barato que lo acordado: a favor del proveedor (no se reclama)", () => {
    const d = calcularDiferencia({
      oc: { cantidad_pedida: 10, factor: 1, precio_unitario: 100, descuentos: [] },
      factura: [{ cantidad_facturada: 10, factor: 1, precio_unitario: 90, descuentos: [], iva_porcentaje: 21 }],
      recibido_unidades: 10,
    })
    expect(d.precio).toMatchObject({ a_favor: "proveedor", neto: 100 })
  })
  it("redondeos de centavos no son diferencia de precio (tolerancia 0,5 %)", () => {
    const d = calcularDiferencia({
      oc: { cantidad_pedida: 10, factor: 1, precio_unitario: 100, descuentos: [] },
      factura: [{ cantidad_facturada: 10, factor: 1, precio_unitario: 100.3, descuentos: [], iva_porcentaje: 21 }],
      recibido_unidades: 10,
    })
    expect(d.precio).toBeNull()
  })
  it("adquisición (sin IVA): el importe no lleva IVA", () => {
    expect(importe(1000, 0)).toEqual({ neto: 1000, iva: 0, total: 1000 })
  })
  it("el artículo en dos renglones de la factura: se suman", () => {
    const d = calcularDiferencia({
      oc: null,
      factura: [
        { cantidad_facturada: 30, factor: 1, precio_unitario: 100, descuentos: [], iva_porcentaje: 21 },
        { cantidad_facturada: 20, factor: 1, precio_unitario: 100, descuentos: [], iva_porcentaje: 21 },
      ],
      recibido_unidades: 40,
    })
    expect(d.factura!.unidades).toBe(50)
    expect(d.cantidad).toMatchObject({ tipo: "faltante", unidades: 10, neto: 1000 })
  })
})
