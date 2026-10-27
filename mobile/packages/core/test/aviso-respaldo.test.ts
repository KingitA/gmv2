import { describe, expect, it } from "vitest"
import { textoAvisoRespaldo } from "../../../../lib/cobranzas/respaldo-devolucion"

// Juan (27/10): lo devuelto contra el PRES de respaldo lo controla la oficina, con lo que compró el cliente a la vista
describe("textoAvisoRespaldo", () => {
  it("compró 25 y devuelve 50: pregunta por las otras 25", () => {
    const t = textoAvisoRespaldo(50, [{ fecha: "2026-10-20", cantidad: 25, comprobante: "PRES 0001-00000020" }])
    expect(t).toContain("compró 25 el 20/10/2026 (PRES 0001-00000020)")
    expect(t).toContain("¿las otras 25 corresponden a un pedido del sistema viejo?")
  })
  it("nunca lo compró en gmv2", () => {
    expect(textoAvisoRespaldo(6, [])).toContain("no compró este artículo en gmv2; ¿las 6 corresponden a un pedido del sistema viejo?")
  })
  it("compró más de lo que devuelve: solo avisa lo comprado", () => {
    const t = textoAvisoRespaldo(4, [{ fecha: "2026-10-01", cantidad: 3, comprobante: "PRES 0001-00000005" }, { fecha: "2026-10-15", cantidad: 3, comprobante: "PRES 0001-00000009" }])
    expect(t).toContain("compró 3 el 15/10/2026 (PRES 0001-00000009), 3 el 01/10/2026 (PRES 0001-00000005).")
    expect(t).not.toContain("sistema viejo")
  })
})
