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

  it("nada recibido y factura validada: se puede (no hay mercadería que cubrir)", () => {
    expect(evaluarFinalizarOC({ comprobantes: [comp("FB", "validado")], recibidos: [], cubiertos: [] }).puede).toBe(true)
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
