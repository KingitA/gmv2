import { describe, expect, it } from "vitest"
import { componentesNCFiscal, esComprobanteApertura } from "../../../../lib/comprobantes/nc-fiscal-componentes"

// Regla del dueño (02/10/2026, caso GRUPO HEMA): las NC/ND fiscales emitidas
// contra comprobantes migrados del sistema anterior (APERTURA GM, sin IVA
// discriminado: total_neto = importe final) calculan el neto como total ÷ 1,21
// y el IVA sale de ADENTRO del total — nunca 21% agregado encima. La NC del
// 10% sobre esas FA sale por exactamente el 10% del total de factura.

const OBS_APERTURA = "APERTURA GM FREIJE — saldo migrado del sistema anterior el 01/10/2026 (sin desglose de IVA/artículos)"

// Las 3 FA reales de la apertura de GRUPO HEMA (total_neto = total_factura, IVA 0)
const FAS_HEMA = [
  { id: "fa1", tipo_comprobante: "FA", numero_comprobante: "0002-00047634", total_neto: 612773.68, total_factura: 612773.68, apertura: true },
  { id: "fa2", tipo_comprobante: "FA", numero_comprobante: "0002-00047635", total_neto: 10842848.36, total_factura: 10842848.36, apertura: true },
  { id: "fa3", tipo_comprobante: "FA", numero_comprobante: "0002-00047636", total_neto: 2129457.91, total_factura: 2129457.91, apertura: true },
]

describe("componentesNCFiscal — comprobantes de apertura (IVA adentro)", () => {
  it("caso real GRUPO HEMA: 10% de las 3 FA de apertura = NC de $1.358.508,00 (no $1.643.794,68)", () => {
    const r = componentesNCFiscal(FAS_HEMA, () => 1)
    expect(r.totalFactura).toBe(1358508.0)
    // el desglose sale de adentro: neto = total ÷ 1,21
    expect(r.totalNeto).toBe(1122733.88)
    expect(r.totalIva).toBe(235774.12)
    expect(r.totalNeto + r.totalIva).toBeCloseTo(r.totalFactura, 2)
    // validación ARCA: IVA ≈ 21% del neto (tolerancia de redondeo, 1 centavo)
    expect(Math.abs(r.totalIva - r.totalNeto * 0.21)).toBeLessThan(0.011)
    // las líneas suman el neto al centavo
    const sumaLineas = Math.round(r.lineas.reduce((s, l) => s + l.precio_neto, 0) * 100) / 100
    expect(sumaLineas).toBe(r.totalNeto)
  })

  it("el bruto por comprobante coincide al centavo con la imputación del cobro (10% de cada total)", () => {
    // 61.277,37 + 1.084.284,84 + 212.945,79 = 1.358.508,00 — los mismos montos
    // que cc_imputar_credito aplicó contra cada FA en el cobro real.
    const r = componentesNCFiscal(FAS_HEMA, () => 1)
    expect(r.totalFactura).toBe(Math.round((61277.37 + 1084284.84 + 212945.79) * 100) / 100)
  })

  it("factura propia (IVA discriminado): regla de siempre, 10% de cada componente", () => {
    const r = componentesNCFiscal(
      [{ id: "f", tipo_comprobante: "FA", numero_comprobante: "0007-00000100", total_neto: 100000, total_factura: 121000, percepcion_iva: 0, percepcion_iibb: 0, apertura: false }],
      () => 1,
    )
    expect(r.totalNeto).toBe(10000)
    expect(r.totalIva).toBe(2100)
    expect(r.totalFactura).toBe(12100)
  })

  it("mezcla apertura + propia en una misma NCA: cada una con su regla, total = 10% de ambos totales", () => {
    const r = componentesNCFiscal(
      [
        { id: "ap", tipo_comprobante: "FA", numero_comprobante: "0002-00000001", total_neto: 121000, total_factura: 121000, apertura: true },
        { id: "nu", tipo_comprobante: "FA", numero_comprobante: "0007-00000200", total_neto: 100000, total_factura: 121000, percepcion_iva: 0, percepcion_iibb: 0, apertura: false },
      ],
      () => 1,
    )
    expect(r.totalFactura).toBe(24200) // 12.100 + 12.100
    expect(r.totalNeto).toBe(20000) // 10.000 (121.000÷1,21×10%) + 10.000
    expect(r.totalIva).toBe(4200)
  })

  it("respeta la fracción por comprobante (cobro parcial)", () => {
    const r = componentesNCFiscal(
      [{ id: "ap", tipo_comprobante: "FA", numero_comprobante: "0002-00000002", total_neto: 121000, total_factura: 121000, apertura: true }],
      () => 0.5,
    )
    expect(r.totalFactura).toBe(6050) // 10% × 121.000 × 0,5
    expect(r.totalNeto).toBe(5000)
    expect(r.totalIva).toBe(1050)
  })

  it("esComprobanteApertura: detecta la marca del saldo migrado", () => {
    expect(esComprobanteApertura(OBS_APERTURA)).toBe(true)
    expect(esComprobanteApertura("apertura gm freije — saldo migrado")).toBe(true)
    expect(esComprobanteApertura("Bonificación contado 10%")).toBe(false)
    expect(esComprobanteApertura(null)).toBe(false)
    expect(esComprobanteApertura(undefined)).toBe(false)
  })
})
