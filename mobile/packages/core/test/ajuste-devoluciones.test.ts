// P2-43 (regla DEFINITIVA de Juan, 31/10/2026): al refacturar, lo devuelto SALE
// del pedido. Las REV/NC de devolución ya emitidas son intocables: la anulación
// es por total − devoluciones imputadas (lib/pedidos/ajuste-devoluciones.ts).
import { describe, expect, it } from "vitest"
import {
  cantidadDeclarada,
  comprobantesAplicados,
  descontarDevuelto,
  esAplicadaDeclarada,
  faltanteDeclarado,
  montoAnulacion,
  parteDevolucionDeAnulacion,
  renglonAplicado,
  repartirDevolucionDeAnulacion,
  stockAReingresar,
  valuarDiferencia,
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

describe("P2-43 devolución PENDIENTE al refacturar (Juan 1/11: no traba la refacturación)", () => {
  // DEV pendiente: el chofer declaró 10 esponjas; depósito todavía no la revisó
  const obs = "Aplicada en la refacturación del pedido 002017 [aplicada:pres-viejo] · [declarada]"
  const saldoRefacturado = 1100 - montoAnulacion(1100, 0) + presNuevo()
  const precioPedido = { articulo_id: "esponja", descripcion: "ESPONJA", precio_final: 12, precio_base: 12 / 1.21 }

  it("se aplica como el caso 1 por lo declarado: anulación por el total, PRES nuevo sin las esponjas → saldo $1.200", () => {
    expect(montoAnulacion(1100, 0)).toBe(1100)
    expect(saldoRefacturado).toBe(1200)
    // La anulación no reingresa las esponjas: las reingresa depósito al revisarla (lo que llegue)
    expect(stockAReingresar(detallePedido, devueltas)).toEqual([10, 0])
  })

  it("queda marcada: ya no es crédito en proceso (ni en el saldo ni en las apps) y no emite REV/NC", () => {
    expect([...comprobantesAplicados(obs)]).toEqual(["pres-viejo"])
    expect(esAplicadaDeclarada(obs)).toBe(true)
    expect(renglonAplicado(obs, "pres-viejo")).toBe(true)
    // Un renglón contra otro comprobante sigue su curso (NC/REV aparte)
    expect(renglonAplicado(obs, "otra-factura")).toBe(false)
    expect(renglonAplicado("Devolución común", "pres-viejo")).toBe(false)
  })

  it("revisión aceptando TODO lo declarado: no se emite nada → saldo $1.200", () => {
    // revisarDevolucion guarda lo declarado en cantidad_original
    expect(faltanteDeclarado({ cantidad: 10, cantidad_original: 10, estado_renglon: "aceptado" })).toBe(0)
    expect(saldoRefacturado).toBe(1200)
  })

  it("revisión aceptando MENOS (llegaron 6): se cobran las 4 que faltan al precio del PRES nuevo → PRES $48, saldo $1.248", () => {
    const falta = faltanteDeclarado({ cantidad: 6, cantidad_original: 10, estado_renglon: "aceptado" })
    expect(falta).toBe(4)
    const v = valuarDiferencia([{ ...precioPedido, cantidad: falta }], false, null)
    expect(v.total).toBe(48)
    expect(v.iva).toBe(0)
    expect(r2(saldoRefacturado + v.total)).toBe(1248)
  })

  it("revisión con el renglón RECHAZADO: se cobran las 10 declaradas → PRES $120, saldo $1.320", () => {
    const falta = faltanteDeclarado({ cantidad: 0, cantidad_original: 10, estado_renglon: "rechazado" })
    expect(falta).toBe(10)
    const v = valuarDiferencia([{ ...precioPedido, cantidad: falta }], false, null)
    expect(v.total).toBe(120)
    expect(r2(saldoRefacturado + v.total)).toBe(1320)
  })

  it("lo aplicado sigue valiendo lo declarado aunque depósito acepte menos (el comprobante nuevo ya salió así)", () => {
    expect(cantidadDeclarada({ cantidad: 6, cantidad_original: 10 })).toBe(10)
    expect(cantidadDeclarada({ cantidad: 10, cantidad_original: null })).toBe(10)
  })

  it("origen factura: ND por neto + IVA y percepciones en la proporción de la factura nueva", () => {
    // FA nueva: neto $1.000 con perc. IVA $30 e IIBB $20; esponja a $12,10 final ($10 neto)
    const v = valuarDiferencia(
      [{ articulo_id: "esponja", descripcion: "ESPONJA", cantidad: 4, precio_final: 12.1, precio_base: 10 }],
      true,
      { neto: 1000, percepcion_iva: 30, percepcion_iibb: 20 },
    )
    expect([v.neto, v.iva, v.percepcionIva, v.percepcionIibb, v.alicuotaIIBB]).toEqual([40, 8.4, 1.2, 0.8, 2])
    expect(v.total).toBe(50.4)
  })

  it("presupuesto de perfumería: se cobra al neto, como lo factura generar", () => {
    const v = valuarDiferencia([{ articulo_id: "p", descripcion: "PERFUME", cantidad: 2, precio_final: 121, precio_base: 100, perfumeria: true }], false, null)
    expect(v.total).toBe(200)
  })
})
