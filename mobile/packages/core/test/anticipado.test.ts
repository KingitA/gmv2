import { describe, expect, it } from "vitest"
import { anticipadoSinCobro, CODIGO_ANTICIPADO_SIN_COBRO, condicionPagoEfectiva, TEXTO_ANTICIPADO_SIN_COBRO } from "@gm/cobro"

// Condiciones de pago, fase 3: freno de entrega para ANTICIPADO (regla de Juan, 19/11).
describe("anticipado: no se entrega sin un cobro registrado", () => {
  it("manda la condición del pedido; si no tiene, la de la ficha", () => {
    expect(condicionPagoEfectiva("anticipado", "contado")).toBe("anticipado")
    expect(condicionPagoEfectiva(null, "anticipado")).toBe("anticipado")
    expect(condicionPagoEfectiva("contado", "anticipado")).toBe("contado")
    expect(condicionPagoEfectiva(null, null)).toBeNull()
  })

  it("anticipado sin cobro → frena; con un cobro registrado (aunque pendiente) → entrega", () => {
    expect(anticipadoSinCobro({ condicionPedido: "anticipado", tieneCobro: false })).toBe(true)
    expect(anticipadoSinCobro({ condicionCliente: "anticipado", tieneCobro: true })).toBe(false)
  })

  it("contado o cuenta corriente nunca frenan por esta regla", () => {
    expect(anticipadoSinCobro({ condicionPedido: "contado", tieneCobro: false })).toBe(false)
    expect(anticipadoSinCobro({ condicionCliente: "cuenta_corriente", tieneCobro: false })).toBe(false)
    expect(anticipadoSinCobro({ tieneCobro: false })).toBe(false)
  })

  it("texto y código que recibe la app", () => {
    expect(TEXTO_ANTICIPADO_SIN_COBRO).toBe("Este cliente paga por ANTICIPADO: registrá el cobro antes de entregar.")
    expect(CODIGO_ANTICIPADO_SIN_COBRO).toBe("ANTICIPADO_SIN_COBRO")
  })
})
