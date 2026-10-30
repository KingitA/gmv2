// P2-43 (flujo de Juan, 31/10/2026, definitivo): al refacturar, lo devuelto SALE
// del pedido. La REV de la devolución queda sin efecto; en fiscal la factura se
// anula por total − NC de devolución (lib/pedidos/ajuste-devoluciones.ts).
import { describe, expect, it } from "vitest"
import {
  descontarDevuelto,
  montoAnulacionFiscal,
  parteDevolucionDeAnulacion,
  repartirDevolucionDeAnulacion,
  revSinEfecto,
  stockAReingresar,
} from "../../../../lib/pedidos/ajuste-devoluciones"

const r2 = (n: number) => Math.round(n * 100) / 100
// PRES viejo: 10 trapos × $100 + 10 esponjas × $10 = $1.100. Se refactura a Neco (+20 %)
const detallePedido = [
  { id: "t", articulo_id: "trapo", cantidad: 10 },
  { id: "e", articulo_id: "esponja", cantidad: 10 },
]
const devueltas = new Map([["esponja", 10]])

describe("P2-43 ejemplo de Juan", () => {
  it("REV de la devolución ya emitida: queda sin efecto; PRES 1.100, REV 1.100, PRES 1.200 → saldo $1.200", () => {
    const sinEfecto = revSinEfecto(100, 100)
    expect(sinEfecto).toEqual({ entera: true, parte: 100, queda: 0 })
    // El PRES nuevo sale sin las esponjas
    const cant = descontarDevuelto(detallePedido, devueltas)
    expect(Object.fromEntries(cant)).toEqual({ t: 10, e: 0 })
    const presNuevo = cant.get("t")! * 120 + cant.get("e")! * 12
    expect(presNuevo).toBe(1200)
    // Cuenta: PRES viejo − REV devolución + su asiento revertido − anulación (por el total) + PRES nuevo
    expect(r2(1100 - 100 + sinEfecto.parte - 1100 + presNuevo)).toBe(1200)
    // La anulación ya no trae lo devuelto: lo que pasa al nuevo es solo lo pagado
    expect(parteDevolucionDeAnulacion(0, 1100, 1100)).toBe(0)
    // Stock: la anulación reingresa los trapos; las esponjas ya volvieron con la devolución
    expect(stockAReingresar(detallePedido, devueltas)).toEqual([10, 0])
  })

  it("devolución todavía pendiente (sin REV): no se emite, sale del pedido igual → saldo $1.200", () => {
    const cant = descontarDevuelto(detallePedido, devueltas)
    expect(r2(1100 - 1100 + cant.get("t")! * 120)).toBe(1200)
  })

  it("con un pago de $500: la anulación deja a favor solo lo pagado, que pasa al PRES nuevo", () => {
    // Saldo del PRES viejo: 1.100 − 100 (REV) − 500 = 500; la REV queda sin efecto → 600
    const saldoViejo = 1100 - 100 - 500 + revSinEfecto(100, 100).parte
    const aFavor = r2(1100 - saldoViejo) // la REV de anulación (1.100) cruza el saldo; sobra lo pagado
    expect(aFavor).toBe(500)
    expect(r2(1200 - aFavor)).toBe(700)
  })

  it("se devolvió TODO: anulación total, REV sin efecto, ningún comprobante nuevo → saldo $0", () => {
    const cant = descontarDevuelto(detallePedido, new Map([["trapo", 10], ["esponja", 10]]))
    expect([...cant.values()].every((c) => c === 0)).toBe(true)
    expect(r2(1100 - 1100 + revSinEfecto(1100, 1100).parte - 1100)).toBe(0)
  })
})

describe("P2-43 devolución mezclada y bonificada", () => {
  it("REV de $150 (100 de este pedido + 50 del sistema viejo): queda acreditada solo por $50", () => {
    expect(revSinEfecto(-150, 100)).toEqual({ entera: false, parte: 100, queda: 50 })
  })

  it("devolución parcial: se factura lo que el cliente se quedó", () => {
    expect(descontarDevuelto([{ id: "e", articulo_id: "esponja", cantidad: 10 }], new Map([["esponja", 4]])).get("e")).toBe(6)
  })

  it("lo devuelto no se descuenta de la mercadería bonificada", () => {
    const cant = descontarDevuelto(
      [{ id: "regalo", articulo_id: "a", cantidad: 2, es_bonificado: true }, { id: "cobrado", articulo_id: "a", cantidad: 10 }],
      new Map([["a", 3]]),
    )
    expect(Object.fromEntries(cant)).toEqual({ regalo: 2, cobrado: 7 })
  })
})

describe("P2-43 fiscal (NC con CAE no se deja sin efecto)", () => {
  it("FA $1.100 con NC de devolución $100 → NC de anulación por $1.000, sin ND", () => {
    expect(montoAnulacionFiscal(1100, 100)).toBe(1000)
    // FA − NC devolución − NC anulación + FA nueva
    expect(r2(1100 - 100 - montoAnulacionFiscal(1100, 100) + 1200)).toBe(1200)
  })

  it("si la NC de la devolución cubre toda la factura, no hay nada que anular en ARCA", () => {
    expect(montoAnulacionFiscal(1100, 1100)).toBe(0)
  })

  it("la anulación por total − NC no trae devolución al comprobante nuevo", () => {
    expect(parteDevolucionDeAnulacion(100, 1100, 1000)).toBe(0)
  })
})

describe("P2-43 refacturados antes de este cambio (anulación por el total con la devolución viva)", () => {
  it("lo que sobró de la anulación incluye lo devuelto: cuenta como devolución, no como pago", () => {
    const dev = parteDevolucionDeAnulacion(100, 1100, 1100)
    expect(dev).toBe(100)
    const rep = repartirDevolucionDeAnulacion(dev, [
      { comprobante_id: "viejo", monto: 600, es_original: true },
      { comprobante_id: "nuevo", monto: 400, es_original: false },
    ])
    expect(Object.fromEntries(rep)).toEqual({ nuevo: 100 })
  })
})
