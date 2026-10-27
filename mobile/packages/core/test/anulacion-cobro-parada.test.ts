import { describe, expect, it } from "vitest"
import { efectoAnulacionEnParada } from "../../../../lib/cobranzas/reglas-cobro"

// R4 (27/10, #23): anular el cobro que cerró una parada "NO ENTREGAR SIN COBRAR"
describe("efectoAnulacionEnParada", () => {
  const base = { estado: "entregado", bloqueada: true, minimoExigido: 1000, cobradoSin: 0, viajeEnCurso: true }
  it("bloqueada, cerrada y sin el cobro no cumple: con el viaje en curso vuelve a pendiente", () => {
    expect(efectoAnulacionEnParada(base)).toBe("reabrir")
  })
  it("con el viaje terminado se frena la anulación", () => {
    expect(efectoAnulacionEnParada({ ...base, viajeEnCurso: false })).toBe("frenar")
  })
  it("si sin ese cobro igual cumple (otro cobro o 10 %), nada", () => {
    expect(efectoAnulacionEnParada({ ...base, cobradoSin: 900, descuentos: 100 })).toBe("nada")
  })
  it("sin bloqueo o con la parada pendiente, nada", () => {
    expect(efectoAnulacionEnParada({ ...base, bloqueada: false })).toBe("nada")
    expect(efectoAnulacionEnParada({ ...base, estado: "pendiente" })).toBe("nada")
  })
})
