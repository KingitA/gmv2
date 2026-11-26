// Decisión de Juan (17/11): un remito controla cantidades pero no alcanza para cerrar la OC.
import { describe, expect, it } from "vitest"
import { evaluarFinalizarOC, type ComprobanteOC } from "../../../../lib/compras/finalizar-oc"

const comp = (tipo: string, estado: string, numero = "0001-00000001"): ComprobanteOC => ({ id: `${tipo}-${numero}-${estado}`, tipo_comprobante: tipo, numero_comprobante: numero, estado })
const rec = (...ids: string[]) => ids.map((id) => ({ articulo_id: id, sku: `SKU-${id}`, descripcion: `Art ${id}` }))

describe("¿se puede finalizar la orden de compra?", () => {
  it("solo remito: no, falta la factura", () => {
    const r = evaluarFinalizarOC({ comprobantes: [comp("Remito", "pendiente_recepcion")], recibidos: rec("a", "b"), cubiertos: [] })
    expect(r.puede).toBe(false)
    expect(r.falta_factura).toBe(true)
    expect(r.faltas[0]).toMatch(/Falta la factura para controlar precios/)
    expect(r.sin_validar).toEqual([]) // el remito no es algo "para validar"
  })

  it("un remito que quedó 'validado' de antes tampoco alcanza", () => {
    const r = evaluarFinalizarOC({ comprobantes: [comp("Remito", "validado")], recibidos: rec("a"), cubiertos: [] })
    expect([r.puede, r.falta_factura]).toEqual([false, true])
  })

  it("sin ningún comprobante: no", () => {
    const r = evaluarFinalizarOC({ comprobantes: [], recibidos: rec("a"), cubiertos: [] })
    expect([r.puede, r.falta_factura]).toEqual([false, true])
  })

  it("factura cargada pero sin validar: no, y dice cuál", () => {
    const r = evaluarFinalizarOC({ comprobantes: [comp("FA", "pendiente_recepcion", "0001-00000123")], recibidos: rec("a"), cubiertos: [] })
    expect(r.puede).toBe(false)
    expect(r.falta_factura).toBe(false)
    expect(r.faltas.join(" ")).toMatch(/sin validar: FA 0001-00000123/)
  })

  it("factura validada que cubre todo lo recibido: sí (con o sin remito al lado)", () => {
    const base = { recibidos: rec("a", "b"), cubiertos: ["a", "b"] }
    expect(evaluarFinalizarOC({ ...base, comprobantes: [comp("FA", "validado")] }).puede).toBe(true)
    expect(evaluarFinalizarOC({ ...base, comprobantes: [comp("FA", "validado"), comp("Remito", "pendiente_recepcion")] }).puede).toBe(true)
    expect(evaluarFinalizarOC({ ...base, comprobantes: [comp("Adquisicion", "validado")] }).puede).toBe(true)
  })

  it("factura validada que NO trae un artículo recibido: no, y lo nombra", () => {
    const r = evaluarFinalizarOC({ comprobantes: [comp("FA", "validado")], recibidos: rec("a", "b", "b"), cubiertos: ["a"] })
    expect(r.puede).toBe(false)
    expect(r.sin_cubrir.map((x) => x.articulo_id)).toEqual(["b"])
    expect(r.faltas.join(" ")).toMatch(/1 artículo\(s\) recibido\(s\).*SKU-b/)
  })

  it("queda otra factura o una nota de crédito sin validar: no", () => {
    const base = { recibidos: rec("a"), cubiertos: ["a"] }
    expect(evaluarFinalizarOC({ ...base, comprobantes: [comp("FA", "validado"), comp("FA", "pendiente_recepcion", "0001-00000002")] }).puede).toBe(false)
    expect(evaluarFinalizarOC({ ...base, comprobantes: [comp("FA", "validado"), comp("NC", "pendiente_recepcion")] }).puede).toBe(false)
  })

  it("una NC esperada no frena (todavía no llegó el documento)", () => {
    const r = evaluarFinalizarOC({ comprobantes: [comp("FA", "validado"), comp("NC", "esperada")], recibidos: rec("a"), cubiertos: ["a"] })
    expect(r.puede).toBe(true)
  })

  it("solo una nota de crédito validada no es una factura", () => {
    const r = evaluarFinalizarOC({ comprobantes: [comp("NC", "validado")], recibidos: rec("a"), cubiertos: [] })
    expect([r.puede, r.falta_factura]).toEqual([false, true])
  })

  it("OC-000014: recibido sin factura pero con la diferencia resuelta (sin cargo, se espera la factura, devuelto o aceptado): no frena", () => {
    const base = { comprobantes: [comp("FA", "validado")], recibidos: rec("a", "800138"), cubiertos: ["a"] }
    const antes = evaluarFinalizarOC(base)
    expect(antes.puede).toBe(false)
    expect(antes.faltas.join(" ")).toMatch(/SKU-800138/)
    const despues = evaluarFinalizarOC({ ...base, resueltos: ["800138"] })
    expect(despues.puede).toBe(true)
    expect(despues.sin_cubrir).toEqual([])
  })

  it("resolver OTRO artículo no cubre al que sigue sin factura", () => {
    const r = evaluarFinalizarOC({ comprobantes: [comp("FA", "validado")], recibidos: rec("a", "b"), cubiertos: ["a"], resueltos: ["z"] })
    expect(r.puede).toBe(false)
    expect(r.sin_cubrir.map((x) => x.articulo_id)).toEqual(["b"])
  })

  it("resuelto no reemplaza a la factura: sin ningún comprobante con precios sigue faltando la factura", () => {
    const r = evaluarFinalizarOC({ comprobantes: [], recibidos: rec("a"), cubiertos: [], resueltos: ["a"] })
    expect([r.puede, r.falta_factura]).toEqual([false, true])
  })

  it("nada recibido y factura validada: se puede (no hay mercadería que cubrir)", () => {
    expect(evaluarFinalizarOC({ comprobantes: [comp("FB", "validado")], recibidos: [], cubiertos: [] }).puede).toBe(true)
  })
})

describe("no pedido y sin factura (OC-000014): qué se espera facturar", async () => {
  const { calcularDiferencia, costoDeFicha, cuentaNoPedidoSinFactura } = await import("../../../../lib/compras/diferencias")
  const noPedido = (recibido: number) => calcularDiferencia({ oc: null, factura: [], recibido_unidades: recibido })

  it("300 u al costo neto de la ficha (en cascada) + IVA", () => {
    const costo = costoDeFicha({ precio_compra: 1000, descuento1: 10, descuento2: 5, iva_compras: "factura" }, "cascada")
    expect(costo.neto_unidad).toBeCloseTo(855, 6)
    const x = cuentaNoPedidoSinFactura(noPedido(300), costo)!
    expect(x.unidades).toBe(300)
    expect(x.importe_a_confirmar).toBe(false)
    expect(x.espera_factura).toEqual({ neto: 256500, iva: 53865, total: 310365 })
  })

  it("descuentos sobre lista según la ficha del proveedor", () => {
    const costo = costoDeFicha({ precio_compra: 1000, descuento1: 10, descuento2: 5 }, "sobre_lista")
    expect(costo.neto_unidad).toBeCloseTo(850, 6)
  })

  it("artículo sin factura (adquisición): sin IVA", () => {
    const x = cuentaNoPedidoSinFactura(noPedido(10), costoDeFicha({ precio_compra: 100, iva_compras: "adquisicion_stock" }))!
    expect(x.espera_factura).toEqual({ neto: 1000, iva: 0, total: 1000 })
  })

  it("sin costo en la ficha: se anota igual con las unidades, importe a confirmar", () => {
    const x = cuentaNoPedidoSinFactura(noPedido(300), costoDeFicha({ precio_compra: 0 }))!
    expect(x.unidades).toBe(300)
    expect(x.importe_a_confirmar).toBe(true)
    expect(x.espera_factura.total).toBe(0)
  })

  it("no aplica si está en la orden, si ya está facturado o si no llegó nada", () => {
    const costo = costoDeFicha({ precio_compra: 100 })
    expect(cuentaNoPedidoSinFactura(noPedido(0), costo)).toBeNull()
    expect(cuentaNoPedidoSinFactura(calcularDiferencia({ oc: { cantidad_pedida: 10, factor: 1, precio_unitario: 100, descuentos: [] }, factura: [], recibido_unidades: 10 }), costo)).toBeNull()
    expect(cuentaNoPedidoSinFactura(calcularDiferencia({ oc: null, factura: [{ cantidad_facturada: 10, factor: 1, precio_unitario: 100, descuentos: [], iva_porcentaje: 21 }], recibido_unidades: 10 }), costo)).toBeNull()
  })
})

describe("adquisición: 'Adquisicion' y el valor viejo del mail 'ADQ' se leen igual", async () => {
  const { esAdquisicion, esComprobanteConPrecios: conPrecios, evaluarFinalizarOC: evaluar } = await import("../../../../lib/compras/finalizar-oc")
  it("los dos son adquisición y traen precios", () => {
    expect(esAdquisicion("Adquisicion")).toBe(true)
    expect(esAdquisicion("ADQ")).toBe(true)
    expect(esAdquisicion("FA")).toBe(false)
    expect(conPrecios("ADQ")).toBe(true)
  })
  it("una adquisición vieja ('ADQ') validada cubre lo recibido", () => {
    const r = evaluar({
      comprobantes: [{ id: "c", tipo_comprobante: "ADQ", numero_comprobante: "1", estado: "validado" }],
      recibidos: [{ articulo_id: "a" }], cubiertos: ["a"],
    })
    expect(r.puede).toBe(true)
  })
})
