import { describe, expect, it } from "vitest"
import { repartirImputacionesContado, recortarImputaciones } from "../../../../lib/cobranzas/crear"

// Bug detectado por la sesión chofer (01/10/2026): en un cobro contado con
// comprobantes MEZCLADOS (algunos ya bonificados con el 10%, otros no), el
// reparto proporcional parejo repartía el descuento entre todos. Regla
// correcta: cada comprobante recibe su saldo menos SU propio 10% si
// corresponde; los ya bonificados, su saldo completo.

const imp = (comprobante_id: string, monto_imputado: number) => ({ comprobante_id, monto_imputado })

describe("repartirImputacionesContado — 10% por comprobante", () => {
  it("caso del bug: A $100 sin bonificar y B $50 ya bonificado, entregan $140 → 90 / 50", () => {
    const out = repartirImputacionesContado(
      [imp("A", 100), imp("B", 50)],
      140,
      { A: 10 }, // a A le falta su NC de $10; B no figura (ya bonificado)
    )
    expect(out).toEqual([imp("A", 90), imp("B", 50)])
    // El proporcional viejo daba 93,33 / 46,67: a A le sobraba nota y B quedaba con saldo
    const viejo = recortarImputaciones([imp("A", 100), imp("B", 50)], 140, "proporcional")
    expect(viejo.map((i) => i.monto_imputado)).toEqual([93.33, 46.67])
  })

  it("todos sin bonificar: cada uno su 90% (equivale al proporcional de siempre)", () => {
    const out = repartirImputacionesContado([imp("A", 100), imp("B", 50)], 135, { A: 10, B: 5 })
    expect(out).toEqual([imp("A", 90), imp("B", 45)])
  })

  it("todos ya bonificados: saldo completo para cada uno", () => {
    const out = repartirImputacionesContado([imp("A", 100), imp("B", 50)], 150, {})
    expect(out).toEqual([imp("A", 100), imp("B", 50)])
  })

  it("pago parcial: escala sobre los OBJETIVOS y cierra al centavo", () => {
    // objetivos 90 y 50 = 140; entregan 70 → mitad de cada objetivo
    const out = repartirImputacionesContado([imp("A", 100), imp("B", 50)], 70, { A: 10 })
    expect(out).toEqual([imp("A", 45), imp("B", 25)])
    expect(out.reduce((s, i) => s + i.monto_imputado, 0)).toBe(70)
  })

  it("sobra plata: nunca imputa más que el objetivo (el resto queda a cuenta)", () => {
    const out = repartirImputacionesContado([imp("A", 100)], 120, { A: 10 })
    expect(out).toEqual([imp("A", 90)])
  })

  it("multi-cliente: la regla es por llamada (cada cliente con su monto)", () => {
    // Cliente 1: A sin bonificar · Cliente 2: B ya bonificado — dos llamadas
    const c1 = repartirImputacionesContado([imp("A", 100)], 90, { A: 10 })
    const c2 = repartirImputacionesContado([imp("B", 50)], 50, {})
    expect(c1).toEqual([imp("A", 90)])
    expect(c2).toEqual([imp("B", 50)])
  })

  it("redondeo en parcial: el último absorbe la diferencia", () => {
    const out = repartirImputacionesContado([imp("A", 100), imp("B", 100), imp("C", 100)], 100, { A: 10, B: 10, C: 10 })
    expect(out.reduce((s, i) => s + i.monto_imputado, 0)).toBe(100)
  })
})
