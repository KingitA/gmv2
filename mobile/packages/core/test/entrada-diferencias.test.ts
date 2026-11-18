// E-90 / E-91 — la cuenta de una diferencia de compra: netos por unidad + IVA discriminado.
// Casos reales de la prueba en pantalla del 17/11 (OC-000011).
import { describe, expect, it } from "vitest"
import { calcularDiferencia, importe, netoCompra, reclamablePorDevolucion } from "../../../../lib/compras/diferencias"

describe("precio neto", () => {
  it("descuentos en cascada", () => {
    expect(netoCompra(100, [10, 10])).toBeCloseTo(81, 6)
    expect(netoCompra(1812.5, [20])).toBeCloseTo(1450, 6)
    // el neto por unidad NO se redondea: se redondea el importe del renglón, una sola vez
    expect(netoCompra(1768.81, [20])).toBeCloseTo(1415.048, 6)
    expect(netoCompra(696.04, [20])).toBeCloseTo(556.832, 6)
  })
})

describe("diferencia de PRECIO (caso real: generaba $2.097,12)", () => {
  const d = calcularDiferencia({
    oc: { cantidad_pedida: 48, factor: 1, precio_unitario: 1768.81, descuentos: [20, 0, 0, 0] },
    factura: [{ cantidad_facturada: 48, factor: 1, precio_unitario: 1812.5, descuentos: [20, 0, 0, 0], iva_porcentaje: 21 }],
    recibido_unidades: 48,
  })
  // Un solo redondeo, el del importe: 48 × 1.450,00 − 48 × 1.415,048 = 69.600,00 − 67.922,30 = $1.677,70
  // (lo mismo que da el total de la orden contra el de la factura; redondeando antes el unitario daba $1.677,60)
  it("(1.450,00 − 1.415,048) × 48 = $1.677,70 neto, con IVA aparte", () => {
    expect(d.precio).not.toBeNull()
    expect(d.precio!.por_unidad).toBeCloseTo(34.952, 6)
    expect(d.precio!.unidades).toBe(48)
    expect(d.precio!.neto).toBe(1677.7)
    expect(d.precio!.iva).toBe(352.32)
    expect(d.precio!.total).toBe(2030.02)
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
  it("50 u × $556,832 = $27.841,60 neto + IVA (el importe se redondea una sola vez)", () => {
    expect(d.cantidad).toMatchObject({ tipo: "faltante", unidades: 50, neto: 27841.6, iva: 5846.74, total: 33688.34 })
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
  it("E-42 bonificados: 10 cobradas + 2 sin cargo NO es diferencia de precio", () => {
    const d = calcularDiferencia({
      oc: { cantidad_pedida: 10, factor: 1, precio_unitario: 100, descuentos: [] },
      factura: [
        { cantidad_facturada: 10, factor: 1, precio_unitario: 100, descuentos: [], iva_porcentaje: 21 },
        { cantidad_facturada: 2, factor: 1, precio_unitario: 100, descuentos: [100], iva_porcentaje: 21 },
      ],
      recibido_unidades: 12,
    })
    expect(d.precio).toBeNull()
    expect(d.cantidad).toBeNull()
    expect(d.factura).toMatchObject({ unidades: 12, bonificadas: 2, neto_unidad: 100 })
  })
  it("todo bonificado: sin diferencia de precio", () => {
    const d = calcularDiferencia({
      oc: { cantidad_pedida: 5, factor: 1, precio_unitario: 100, descuentos: [] },
      factura: [{ cantidad_facturada: 5, factor: 1, precio_unitario: 0, descuentos: [], iva_porcentaje: 21 }],
      recibido_unidades: 5,
    })
    expect(d.precio).toBeNull()
  })
  it("E-92 pendiente contra la orden: pedido 96, llegó y se facturó 72 ⇒ faltan recibir 24 (no es plata)", () => {
    const d = calcularDiferencia({
      oc: { cantidad_pedida: 4, factor: 24, precio_unitario: 100, descuentos: [] },
      factura: [{ cantidad_facturada: 3, factor: 24, precio_unitario: 2400, descuentos: [], iva_porcentaje: 21 }],
      recibido_unidades: 72,
    })
    expect(d.pendiente_oc).toBe(24)
    expect(d.cantidad).toBeNull()
  })
  it("facturado completo y recibido de menos: es faltante reclamable, no pendiente de la orden", () => {
    const d = calcularDiferencia({
      oc: { cantidad_pedida: 200, factor: 1, precio_unitario: 10, descuentos: [] },
      factura: [{ cantidad_facturada: 200, factor: 1, precio_unitario: 10, descuentos: [], iva_porcentaje: 21 }],
      recibido_unidades: 150,
    })
    expect(d.pendiente_oc).toBe(0)
    expect(d.cantidad).toMatchObject({ tipo: "faltante", unidades: 50 })
  })
  it("devolución: se reclama lo facturado que no nos quedamos; un sobrante devuelto no genera NC", () => {
    const facturado10 = { oc: null, factura: [{ cantidad_facturada: 10, factor: 1, precio_unitario: 100, descuentos: [], iva_porcentaje: 21 }] }
    // llegaron las 10 y se rechazan 4
    expect(reclamablePorDevolucion(calcularDiferencia({ ...facturado10, recibido_unidades: 10 }), 4)).toMatchObject({ unidades: 4, neto: 400, total: 484 })
    // llegaron 12 (2 de más) y se devuelven las 2 que sobran: nada que reclamar
    expect(reclamablePorDevolucion(calcularDiferencia({ ...facturado10, recibido_unidades: 12 }), 2)).toMatchObject({ unidades: 0, total: 0 })
    // llegaron 8 (faltan 2) y además se rechazan 3: se reclaman 5
    expect(reclamablePorDevolucion(calcularDiferencia({ ...facturado10, recibido_unidades: 8 }), 3)).toMatchObject({ unidades: 5, neto: 500 })
    // no se puede devolver más de lo que entró
    expect(reclamablePorDevolucion(calcularDiferencia({ ...facturado10, recibido_unidades: 8 }), 50)).toMatchObject({ unidades: 10 })
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

describe("descuentos del proveedor: en cascada o sobre precio de lista (decisión de Juan, 17/11)", async () => {
  const { netoCompra, calcularDiferencia, tipoDescuentoDe } = await import("../../../../lib/compras/diferencias")
  it("en cascada: uno sobre el otro — 1.000 con 10 % y 5 % = 855", () => {
    expect(netoCompra(1000, [10, 5], "cascada")).toBeCloseTo(855, 6)
    expect(netoCompra(1000, [10, 5])).toBeCloseTo(855, 6)
  })
  it("sobre lista: se suman — 1.000 con 10 % y 5 % = 850", () => {
    expect(netoCompra(1000, [10, 5], "sobre_lista")).toBeCloseTo(850, 6)
    expect(netoCompra(1768.81, [10, 10], "sobre_lista")).toBeCloseTo(1415.048, 6)
  })
  it("sobre lista: descuentos que suman más de 100 % no dan un precio negativo", () => {
    expect(netoCompra(1000, [60, 50], "sobre_lista")).toBe(0)
  })
  it("un solo descuento: da lo mismo en los dos", () => {
    expect(netoCompra(1000, [20], "sobre_lista")).toBeCloseTo(netoCompra(1000, [20], "cascada"), 6)
  })
  it("la ficha sin dato o con otro valor: en cascada", () => {
    expect(tipoDescuentoDe(null)).toBe("cascada")
    expect(tipoDescuentoDe("sobre_lista")).toBe("sobre_lista")
    expect(tipoDescuentoDe("otra cosa")).toBe("cascada")
  })
  it("la diferencia de precio usa el tipo del proveedor: orden y factura iguales no difieren", () => {
    const base = {
      oc: { cantidad_pedida: 100, factor: 1, precio_unitario: 1000, descuentos: [10, 5] },
      factura: [{ cantidad_facturada: 100, factor: 1, precio_unitario: 1000, descuentos: [10, 5], iva_porcentaje: 21 }],
      recibido_unidades: 100,
    }
    const s = calcularDiferencia({ ...base, tipo_descuento: "sobre_lista" })
    expect(s.oc!.neto_unidad).toBe(850)
    expect(s.factura!.neto_unidad).toBe(850)
    expect(s.precio).toBeNull()
    expect(calcularDiferencia(base).oc!.neto_unidad).toBe(855)
  })
})
