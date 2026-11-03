import { describe, expect, it } from "vitest"
import { aSumarConMinimo, minimoDe } from "../../../apps/vendedor/src/datos/borradores"

// Fracción = cantidad mínima por artículo (Juan, 03/11/2026).

describe("Fracción como cantidad mínima", () => {
  it("sin fracción (o fracción 1) se carga cualquier cantidad", () => {
    expect(minimoDe({ cantidad_fraccion: null })).toBe(1)
    expect(minimoDe({ cantidad_fraccion: 1 })).toBe(1)
    expect(aSumarConMinimo(0, 3, minimoDe({}))).toBe(3)
  })
  it("fracción 12: anotar 6 carga 12; 18 queda 18", () => {
    const min = minimoDe({ cantidad_fraccion: 12 })
    expect(aSumarConMinimo(0, 6, min)).toBe(12)
    expect(aSumarConMinimo(0, 18, min)).toBe(18)
  })
  it("si ya tenía algo, completa hasta el mínimo o suma lo nuevo", () => {
    expect(aSumarConMinimo(4, 2, 12)).toBe(8)
    expect(aSumarConMinimo(12, 1, 12)).toBe(1)
  })
})
