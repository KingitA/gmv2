import { describe, expect, it } from "vitest"
import { importePorOrigen, netoContado } from "../../../../lib/cobranzas/valor-devolucion"

// P2-41 (regla de Juan, 29/10): el 10 % contado es por comprobante. Lo devuelto que fue al
// respaldo 0002-00000001 (mercadería del sistema viejo) no baja la base del PRES nuevo: la
// NC/REV de la devolución se imputa a cada origen solo por lo que vale lo devuelto de él.
describe("NC/REV de devolución imputada por origen", () => {
  it("URQUIZA: REV $67.751,28 → $45.167,52 al PRES 0027 y $22.583,76 del respaldo a favor", () => {
    const tope = importePorOrigen(
      [
        { origen_id: "pres-27", neto: 45167.52, iva: 0 },
        { origen_id: "respaldo", neto: 22583.76, iva: 0 },
      ],
      0,
    )
    expect(tope.get("pres-27")).toBe(45167.52)
    expect(tope.get("respaldo")).toBe(22583.76)
    // Base del 10 % del PRES 0027 = total − lo devuelto de ÉL
    const base = 318366.48 - tope.get("pres-27")!
    expect(Math.round((base - netoContado(base)) * 100) / 100).toBe(27319.9)
  })

  it("fiscal: neto + IVA de cada origen + percepciones repartidas por neto; suma = total", () => {
    const tope = importePorOrigen(
      [
        { origen_id: "fa-1", neto: 1000, iva: 210 },
        { origen_id: "fa-1", neto: 333.33, iva: 70 },
        { origen_id: "fa-2", neto: 500, iva: 105 },
        { origen_id: null, neto: 100, iva: 21 },
      ],
      58.01,
    )
    const total = 1000 + 210 + 333.33 + 70 + 500 + 105 + 100 + 21 + 58.01
    const suma = [...tope.values()].reduce((s, v) => s + Math.round(v * 100), 0)
    expect(suma).toBe(Math.round(total * 100))
    expect(tope.get("fa-1")).toBeCloseTo(1613.33 + 58.01 * (1333.33 / 1933.33), 1)
    // Lo sin origen queda a favor (no se imputa a nada)
    expect(tope.has(null)).toBe(true)
  })
})
