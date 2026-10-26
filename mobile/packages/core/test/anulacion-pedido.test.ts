// Refacturar un pedido (#19/#20) — reglas del dueño 26/10/2026: hasta que se cobra
// al 100 %, se anula todo (incluido el 10 % contado, no las devoluciones), lo pagado
// queda a cuenta y el pedido vuelve a "pendiente_facturacion".
import { describe, expect, it } from "vitest"
import { ESTADO_TRAS_ANULAR, reglaAnulacionPedido, type ComprobanteAnulable } from "../../../../lib/pedidos/anulacion-pedido"

const comp = (o: Partial<ComprobanteAnulable>): ComprobanteAnulable => ({
  id: "x", tipo_comprobante: "PRES", numero_comprobante: "0001-00000001", total_factura: 1000,
  saldo_pendiente: 1000, anulado_en: null, observaciones: null, propio: true, ...o,
})

describe("anular comprobantes de un pedido para refacturar (#19/#20)", () => {
  it("sin cobrar o cobrado en parte: se puede, en cualquier estado (también entregado)", () => {
    expect(reglaAnulacionPedido("facturado", [comp({})]).puede).toBe(true)
    expect(reglaAnulacionPedido("entregado", [comp({ saldo_pendiente: 400 })]).puede).toBe(true)
    expect(reglaAnulacionPedido("en_viaje", [comp({ id: "a", saldo_pendiente: 0 }), comp({ id: "b", saldo_pendiente: 10 })]).puede).toBe(true)
  })

  it("cobrado al 100 %: bloqueado", () => {
    const r = reglaAnulacionPedido("entregado", [comp({ saldo_pendiente: 0 }), comp({ id: "b", tipo_comprobante: "FA", saldo_pendiente: 0.001 })])
    expect(r.puede).toBe(false)
    expect(r.motivo).toMatch(/cobrado al 100/)
  })

  it("se anula todo: primero el 10 % contado, después los del pedido (fiscales antes que PRES); las devoluciones no", () => {
    const r = reglaAnulacionPedido("facturado", [
      comp({ id: "pres", numero_comprobante: "0001-00000010" }),
      comp({ id: "fa", tipo_comprobante: "FA", numero_comprobante: "0007-00000003" }),
      comp({ id: "rev10", tipo_comprobante: "REV", propio: false, observaciones: "Bonificación contado 10% — presupuestos 0001-00000010" }),
      comp({ id: "revdev", tipo_comprobante: "REV", propio: false, observaciones: "Devolución DEV-00004" }),
      comp({ id: "viejo", anulado_en: "2026-10-01" }),
    ])
    expect(r.aAnular.map((c) => c.id)).toEqual(["rev10", "fa", "pres"])
  })

  it("sin comprobantes vivos, eliminado o del sistema viejo: no", () => {
    expect(reglaAnulacionPedido("facturado", [comp({ anulado_en: "2026-10-01" })]).puede).toBe(false)
    expect(reglaAnulacionPedido("eliminado", [comp({})]).puede).toBe(false)
    expect(reglaAnulacionPedido("sistema_viejo", [comp({})]).puede).toBe(false)
  })

  it("después de anular, el pedido vuelve a pendiente de facturación", () => {
    expect(ESTADO_TRAS_ANULAR).toBe("pendiente_facturacion")
  })
})
