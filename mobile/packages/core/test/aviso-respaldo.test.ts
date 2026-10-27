import { describe, expect, it } from "vitest"
import { repartirExcedenteAlRespaldo, textoAvisoRespaldo, AL_RESPALDO } from "../../../../lib/cobranzas/respaldo-devolucion"

// Juan (27/10): lo devuelto de más sobre lo comprado en gmv2 (presupuesto) va al
// respaldo "del sistema viejo", y la oficina lo controla con este aviso a la vista
describe("repartirExcedenteAlRespaldo", () => {
  const pres = (cantidad: number) => ({ articulo_id: "naft", cantidad, comprobante_venta_id: "pres20", precio_venta_original: 100 })
  const todos = () => true

  it("compró 25 y devuelve 50: 25 contra el PRES y 25 al respaldo, al mismo precio", () => {
    const r = repartirExcedenteAlRespaldo([pres(50)], new Map([["pres20|naft", 25]]), todos)
    expect(r).toEqual([
      { articulo_id: "naft", cantidad: 25, comprobante_venta_id: "pres20", precio_venta_original: 100 },
      { articulo_id: "naft", cantidad: 25, comprobante_venta_id: AL_RESPALDO, precio_venta_original: 100 },
    ])
  })
  it("ya devolvió todo antes (disponible 0): el renglón entero va al respaldo", () => {
    const r = repartirExcedenteAlRespaldo([pres(6)], new Map([["pres20|naft", 0]]), todos)
    expect(r.map((x) => [x.cantidad, x.comprobante_venta_id])).toEqual([[6, AL_RESPALDO]])
  })
  it("dentro de lo comprado no se toca; dos renglones del mismo artículo comparten lo disponible", () => {
    expect(repartirExcedenteAlRespaldo([pres(10)], new Map([["pres20|naft", 25]]), todos)).toEqual([pres(10)])
    const r = repartirExcedenteAlRespaldo([pres(20), pres(10)], new Map([["pres20|naft", 25]]), todos)
    expect(r.map((x) => [x.cantidad, x.comprobante_venta_id])).toEqual([[20, "pres20"], [5, "pres20"], [5, AL_RESPALDO]])
  })
  it("lo no elegible (factura) no se reparte: ahí sigue el tope", () => {
    const fa = { articulo_id: "naft", cantidad: 50, comprobante_venta_id: "fa1" }
    expect(repartirExcedenteAlRespaldo([fa], new Map([["fa1|naft", 25]]), () => false)).toEqual([fa])
  })
})

describe("textoAvisoRespaldo", () => {
  it("compró 25 y devuelve 50: pregunta por las otras 25", () => {
    const t = textoAvisoRespaldo(25, [{ fecha: "2026-10-20", cantidad: 25, comprobante: "PRES 0001-00000020" }], 25)
    expect(t).toContain("compró 25 el 20/10/2026 (PRES 0001-00000020); contra esas compras ya se devuelven 25.")
    expect(t).toContain("¿Las otras 25 corresponden a un pedido del sistema viejo?")
  })
  it("nunca lo compró en gmv2", () => {
    expect(textoAvisoRespaldo(6, [])).toContain("no compró este artículo en gmv2; ¿las 6 corresponden a un pedido del sistema viejo?")
  })
})
