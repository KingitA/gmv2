import { describe, expect, it } from "vitest"
import { devolucionesFueraDelCobro } from "@gm/cobro"

// P2-29 (regla de Juan, 2ª prueba): una devolución descuenta solo del comprobante al que pertenece.
describe("devolución contra su comprobante al cobrar", () => {
  it("CHEN: la devolución del PRES 0028 no se puede restar cobrando solo el 0026", () => {
    const fuera = devolucionesFueraDelCobro([{ devolucion_id: "dev-1", comprobante_venta_id: "pres-28" }], ["pres-26"])
    expect([...fuera]).toEqual([["dev-1", ["pres-28"]]])
  })

  it("cobrando su comprobante, pasa", () => {
    expect(devolucionesFueraDelCobro([{ devolucion_id: "dev-1", comprobante_venta_id: "pres-28" }], ["pres-26", "pres-28"]).size).toBe(0)
  })

  it("renglones sin origen, al respaldo 0002-00000001 o rechazados no atan la devolución", () => {
    const fuera = devolucionesFueraDelCobro(
      [
        { devolucion_id: "dev-1", comprobante_venta_id: "pres-27" },
        { devolucion_id: "dev-1", comprobante_venta_id: "respaldo", sin_comprobante_cobrable: true },
        { devolucion_id: "dev-2", comprobante_venta_id: null },
        { devolucion_id: "dev-3", comprobante_venta_id: "pres-99", rechazado: true },
      ],
      ["pres-27"],
    )
    expect(fuera.size).toBe(0)
  })

  it("una devolución con renglones de dos comprobantes: alcanza con que falte uno", () => {
    const fuera = devolucionesFueraDelCobro(
      [
        { devolucion_id: "dev-1", comprobante_venta_id: "pres-26" },
        { devolucion_id: "dev-1", comprobante_venta_id: "pres-28" },
        { devolucion_id: "dev-1", comprobante_venta_id: "pres-28" },
      ],
      ["pres-26"],
    )
    expect(fuera.get("dev-1")).toEqual(["pres-28"])
  })
})
