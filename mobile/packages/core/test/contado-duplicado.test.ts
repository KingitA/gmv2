import { describe, expect, it } from "vitest"
import { mensajeContadoYaAplicado, separarYaBonificados, TIPOS_BONIFICABLES } from "../../../../lib/comprobantes/ya-bonificados"

// 10 % contado: un mismo comprobante jamás lo recibe dos veces. La detección de "ya lo
// tiene" es la misma que usa la generación de la NC (lib/comprobantes/ya-bonificados.ts):
// una NC/REV de bonificación viva imputada como crédito, o que lo menciona por número.

const comps = [
  { id: "a", numero_comprobante: "0003-00005001" },
  { id: "b", numero_comprobante: "0003-00005002" },
  { id: "c", numero_comprobante: "0001-00000003" },
]

describe("10% contado · detección de comprobantes ya bonificados", () => {
  it("por imputación de la NC como crédito (modelo actual) y por mención en observaciones (legado)", () => {
    const r = separarYaBonificados(comps, { bonificadosPorImputacion: new Set(["a"]), obsNcs: ["Bonificación contado 10% — presupuestos 0001-00000012, 0001-00000003"] })
    expect(r.yaBonificados.map((c) => c.id)).toEqual(["a", "c"])
    expect(r.pendientes.map((c) => c.id)).toEqual(["b"])
  })

  it("sin marcas, todos pendientes; un número vacío nunca 'matchea' por observaciones", () => {
    const r = separarYaBonificados([...comps, { id: "d", numero_comprobante: "" }], { bonificadosPorImputacion: new Set(), obsNcs: ["Bonificación contado 10% — facturas "] })
    expect(r.yaBonificados).toEqual([])
    expect(r.pendientes).toHaveLength(4)
  })

  it("solo FA/FB/FC/PRES bonifican", () => {
    expect(TIPOS_BONIFICABLES).toEqual(["FA", "FB", "FC", "PRES"])
  })

  it("mensajes: rechazo cuando TODOS ya lo tienen; aviso cuando solo algunos", () => {
    expect(mensajeContadoYaAplicado(["0003-00005001"], true)).toBe("El 10% de contado ya está aplicado en el comprobante 0003-00005001: no se aplica dos veces. Destildá «10% contado» para registrar el cobro.")
    expect(mensajeContadoYaAplicado(["0003-00005001", "0003-00005002"], false)).toBe("El 10% de contado no se aplica a 0003-00005001, 0003-00005002: ya lo tienen. Se aplica solo al resto.")
  })
})
