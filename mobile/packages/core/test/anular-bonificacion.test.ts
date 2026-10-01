import { describe, expect, it } from "vitest"
import { marcaPagoBonif, esBonifDelPago, tieneMarcaPago, debeRevertirBonificacion } from "../../../../lib/cobranzas/marca-pago"

// Bug Gioventu (01/10/2026, preexistente): cobranza_anular paso 1b revertía
// TODA bonificación 10% viva del comprobante, sin mirar qué pago la generó.
// Caso real: anular el cobro de hoy revirtió también la REV 0001-00000014
// ($26.093,09) de un pago confirmado del 28/09 — el saldo del presupuesto
// saltó de 10.491,36 a 36.584,45.
// Regla nueva (contrato con cobranza_anular v7): la NC/REV nace con la marca
// [pago:<id>] y la anulación revierte SOLO las de ESE pago; las históricas sin
// marca solo se revierten si ningún otro pago confirmado participó.

const PAGO_HOY = "11111111-aaaa-bbbb-cccc-000000000001"
const PAGO_28_09 = "22222222-aaaa-bbbb-cccc-000000000002"

describe("bonificación 10% — reversa solo del pago que la generó", () => {
  it("la marca identifica al pago exacto", () => {
    const obs = `Bonificación contado 10% — presupuestos 0001-00000013 ${marcaPagoBonif(PAGO_HOY)}`
    expect(esBonifDelPago(obs, PAGO_HOY)).toBe(true)
    expect(esBonifDelPago(obs, PAGO_28_09)).toBe(false)
    expect(tieneMarcaPago(obs)).toBe(true)
  })

  it("caso Gioventu, dos pagos: anular el de hoy NO toca la REV del 28/09", () => {
    const revDel28 = `Bonificación contado 10% — presupuestos 0001-00119xxx ${marcaPagoBonif(PAGO_28_09)}`
    const revDeHoy = `Bonificación contado 10% — presupuestos 0001-00119xxx ${marcaPagoBonif(PAGO_HOY)}`
    // Anulando el pago de HOY:
    expect(debeRevertirBonificacion({ obs: revDeHoy, pagoId: PAGO_HOY, hayOtroPagoConfirmado: true })).toBe(true)
    expect(debeRevertirBonificacion({ obs: revDel28, pagoId: PAGO_HOY, hayOtroPagoConfirmado: true })).toBe(false)
    // Y anulando el del 28/09, al revés:
    expect(debeRevertirBonificacion({ obs: revDel28, pagoId: PAGO_28_09, hayOtroPagoConfirmado: true })).toBe(true)
    expect(debeRevertirBonificacion({ obs: revDeHoy, pagoId: PAGO_28_09, hayOtroPagoConfirmado: true })).toBe(false)
  })

  it("NC histórica sin marca: se revierte solo si este pago es el único confirmado", () => {
    const legada = "Bonificación contado 10% — presupuestos 0001-00000011"
    expect(debeRevertirBonificacion({ obs: legada, pagoId: PAGO_HOY, hayOtroPagoConfirmado: false })).toBe(true)
    // Con otro pago confirmado en el comprobante: NO se toca (puede ser suya) → se avisa a oficina
    expect(debeRevertirBonificacion({ obs: legada, pagoId: PAGO_HOY, hayOtroPagoConfirmado: true })).toBe(false)
  })

  it("el formato de la marca es el que el SQL busca con LIKE", () => {
    // contrato: obs LIKE '%[pago:' || p_pago_id || ']%'
    expect(marcaPagoBonif(PAGO_HOY)).toBe(`[pago:${PAGO_HOY}]`)
  })
})
