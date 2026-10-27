import { describe, expect, it } from "vitest"
import { pareceComprobanteNoReconocido } from "../../../../lib/apertura/parsear-chr"

// R12 (#6, 27/10): un comprobante de un tipo que gmv2 no reconoce no entra callado como ajuste
describe("pareceComprobanteNoReconocido", () => {
  it("Fact.E, N.Cr.X y N.Db.E (formato del sistema viejo) frenan", () => {
    expect(pareceComprobanteNoReconocido("Fact.E Electronica")).toBe(true)
    expect(pareceComprobanteNoReconocido("N.Cr.X")).toBe(true)
    expect(pareceComprobanteNoReconocido("N.Db.E Electronica")).toBe(true)
  })
  it("los tipos conocidos y el texto libre del reporte real pasan", () => {
    for (const d of ["Fact.A Electronica", "N.Cr.A Electronica", "N.Db.A Electronica", "Fact.B Electronica", "Presupuesto", "Reversa Especial", "A Cuenta"])
      expect(pareceComprobanteNoReconocido(d)).toBe(false)
    for (const d of ["TELEFONO X3", "SEGURO FORD K PULSE", "10%", "CHEQUE RECH (YASH)", "RETIRO EFF", "COMI SEPT", "FACTURA LOREAL 20670"])
      expect(pareceComprobanteNoReconocido(d)).toBe(false)
  })
})
