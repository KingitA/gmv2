// P2-43 (regla DEFINITIVA de Juan, 31/10/2026): al refacturar, lo devuelto SALE
// del pedido. Las REV/NC de devolución ya emitidas son intocables: la anulación
// es por total − devoluciones imputadas (lib/pedidos/ajuste-devoluciones.ts).
import { describe, expect, it } from "vitest"
import {
  descontarDevuelto,
  montoAnulacion,
  parteDevolucionDeAnulacion,
  repartirDevolucionDeAnulacion,
  stockAReingresar,
} from "../../../../lib/pedidos/ajuste-devoluciones"

const r2 = (n: number) => Math.round(n * 100) / 100
// PRES viejo: 10 trapos × $100 + 10 esponjas × $10 = $1.100. Se refactura a Neco (+20 %)
const detallePedido = [
  { id: "t", articulo_id: "trapo", cantidad: 10 },
  { id: "e", articulo_id: "esponja", cantidad: 10 },
]
const devueltas = new Map([["esponja", 10]])
const presNuevo = () => {
  const cant = descontarDevuelto(detallePedido, devueltas)
  return cant.get("t")! * 120 + cant.get("e")! * 12
}

describe("P2-43 ejemplo de Juan", () => {
  it("comprobante nuevo sin lo devuelto: solo trapos a Neco, $1.200", () => {
    expect(Object.fromEntries(descontarDevuelto(detallePedido, devueltas))).toEqual({ t: 10, e: 0 })
    expect(presNuevo()).toBe(1200)
  })

  it("CASO 1 — devolución sin REV: anulación por el total $1.100 → saldo $1.200", () => {
    const anulacion = montoAnulacion(1100, 0)
    expect(anulacion).toBe(1100)
    expect(r2(1100 - anulacion + presNuevo())).toBe(1200)
  })

  it("CASO 2 — REV de devolución $100 ya emitida e intocable: anulación por $1.000 → saldo $1.200", () => {
    const anulacion = montoAnulacion(1100, 100)
    expect(anulacion).toBe(1000)
    expect(r2(1100 - 100 - anulacion + presNuevo())).toBe(1200)
    // La anulación no trae lo devuelto: lo que pasa al nuevo es solo lo pagado
    expect(parteDevolucionDeAnulacion(100, 1100, anulacion)).toBe(0)
  })

  it("CASO 2 con un pago de $500: a favor queda solo lo pagado y pasa al PRES nuevo", () => {
    const saldoViejo = 1100 - 100 - 500
    const aFavor = r2(montoAnulacion(1100, 100) - saldoViejo) // la REV de anulación cruza el saldo
    expect(aFavor).toBe(500)
    expect(r2(presNuevo() - aFavor)).toBe(700)
  })

  it("stock: la anulación reingresa los trapos; las esponjas ya volvieron con la devolución", () => {
    expect(stockAReingresar(detallePedido, devueltas)).toEqual([10, 0])
  })
})

describe("P2-43 fiscal", () => {
  it("CASO 2 — FA $1.100 con NC de devolución $100 → NC de anulación por $1.000, sin ND", () => {
    expect(montoAnulacion(1100, 100)).toBe(1000)
    expect(r2(1100 - 100 - 1000 + 1200)).toBe(1200)
  })
})

describe("P2-43 todo devuelto", () => {
  const todo = new Map([["trapo", 10], ["esponja", 10]])
  it("no queda nada para el comprobante nuevo", () => {
    expect([...descontarDevuelto(detallePedido, todo).values()].every((c) => c === 0)).toBe(true)
    expect(stockAReingresar(detallePedido, todo)).toEqual([0, 0])
  })
  it("CASO 1: anulación total, devolución cerrada sin emitir → $0", () => {
    expect(r2(1100 - montoAnulacion(1100, 0))).toBe(0)
  })
  it("CASO 2: la REV de devolución ya canceló todo → anulación sin inverso → $0", () => {
    expect(montoAnulacion(1100, 1100)).toBe(0)
    expect(r2(1100 - 1100 - montoAnulacion(1100, 1100))).toBe(0)
  })
})

describe("P2-43 mixtas, parciales y bonificadas", () => {
  it("REV de $150 (100 de este PRES + 50 imputados al respaldo): solo resta lo imputado a ESTE comprobante", () => {
    // P2-41 imputó 100 a este PRES y 50 al respaldo 0002-00000001: la REV no se toca
    expect(montoAnulacion(1100, 100)).toBe(1000)
  })

  it("una devolución con renglones en los dos casos: cada comprobante resta solo lo suyo", () => {
    // Renglón contra el PRES A (con REV emitida) y renglón contra el PRES B (sin REV): A se anula por total − REV, B por el total
    expect([montoAnulacion(600, 60), montoAnulacion(500, 0)]).toEqual([540, 500])
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
