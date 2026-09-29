import { describe, expect, it } from "vitest"
import { valorDevolucion, netoContado } from "../../../../lib/cobranzas/valor-devolucion"

// Regla del dueño (29/09/2026): en cobro contado con 10%, la mercadería
// devuelta se computa NETA del mismo 10%, para coincidir al centavo con la
// NC futura. Los dos casos documentados de sus pruebas, al centavo.

describe("valorDevolucion — regla del 10% contado", () => {
  it("caso (a): factura $500.000 contado, devolución $10.000 → vale $9.000 y se cobran $441.000", () => {
    const v = valorDevolucion({ renglones: [{ subtotal: 10000 }], aplica10: true, conIva: false })
    expect(v.total).toBe(9000)
    const aCobrar = Math.round((netoContado(500000) - v.total) * 100) / 100
    expect(aCobrar).toBe(441000) // el sistema viejo mostraba 440.000
  })

  it("caso (b): pedido $260.930,88 contado, devolución $10.491,36 → a cobrar $225.395,57", () => {
    const v = valorDevolucion({ renglones: [{ subtotal: 10491.36 }], aplica10: true, conIva: false })
    expect(v.total).toBe(9442.22) // 10.491,36 × 0,9
    const aCobrar = Math.round((netoContado(260930.88) - v.total) * 100) / 100
    expect(aCobrar).toBe(225395.57) // (260.930,88 − 10.491,36) × 0,9; el sistema hacía 224.346,43
  })

  it("sin 10%: la devolución vale el precio pleno de factura", () => {
    const v = valorDevolucion({ renglones: [{ subtotal: 10000 }], aplica10: false, conIva: false })
    expect(v.total).toBe(10000)
  })

  it("fiscal: IVA discriminado sobre el neto YA bonificado, por renglón", () => {
    const v = valorDevolucion({ renglones: [{ subtotal: 1000 }, { subtotal: 2000 }], aplica10: true, conIva: true })
    expect(v.netoPorRenglon).toEqual([900, 1800])
    expect(v.neto).toBe(2700)
    expect(v.iva).toBe(567) // 21% de 2.700
    expect(v.total).toBe(3267)
  })

  it("percepciones: sobre el neto bonificado, solo en fiscal", () => {
    const v = valorDevolucion({
      renglones: [{ subtotal: 10000 }],
      aplica10: true,
      conIva: true,
      percepcionesDe: (neto) => neto * 0.03,
    })
    expect(v.neto).toBe(9000)
    expect(v.percepciones).toBe(270)
    expect(v.total).toBe(9000 + 1890 + 270)
  })

  it("redondeo por renglón (como el detalle de la NC), no sobre la suma", () => {
    // 3 renglones de $33,33: por renglón 0,9×33,33 = 29,997 → 30,00 c/u
    const v = valorDevolucion({ renglones: [{ subtotal: 33.33 }, { subtotal: 33.33 }, { subtotal: 33.33 }], aplica10: true, conIva: false })
    expect(v.netoPorRenglon).toEqual([30, 30, 30])
    expect(v.total).toBe(90)
  })
})
