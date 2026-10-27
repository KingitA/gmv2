// Refacturar un pedido (#19/#20) — reglas del dueño 26/10/2026: hasta que se cobra
// al 100 %, se anula todo (incluido el 10 % contado, no las devoluciones), lo pagado
// queda a cuenta. 27/10: el pedido QUEDA EN SU ESTADO; lo pagado contra el pedido pasa al comprobante nuevo.
import { describe, expect, it } from "vitest"
import { reglaAnulacionPedido, type ComprobanteAnulable } from "../../../../lib/pedidos/anulacion-pedido"
import { estadoAlFacturar, motivoBloqueo, puedeEditarCondiciones } from "../../../../lib/pedidos/estados"

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

  it("R3: la REV del 10 % que cubre también otros pedidos se anula SOLO en la parte de este pedido", () => {
    const r = reglaAnulacionPedido("entregado", [
      comp({ id: "pres", saldo_pendiente: 500 }),
      comp({ id: "rev10", tipo_comprobante: "REV", propio: false, observaciones: "Bonificación contado 10% — presupuestos …", parte_pedido: 100, parte_otros: 50 }),
    ])
    expect(r.puede).toBe(true)
    expect(r.aAnular.map((c) => [c.id, c.parcial])).toEqual([["rev10", 100], ["pres", undefined]])
  })

  it("R3 (opción B de Juan): la NC fiscal del 10 % compartida se anula en parte (ND con CAE por la parte del pedido), antes que la FA", () => {
    const r = reglaAnulacionPedido("facturado", [
      comp({ id: "fa", tipo_comprobante: "FA" }),
      comp({ id: "nca10", tipo_comprobante: "NCA", propio: false, observaciones: "Bonificación contado 10%", parte_pedido: 100, parte_otros: 30 }),
    ])
    expect(r.puede).toBe(true)
    expect(r.aAnular.map((c) => [c.id, c.parcial])).toEqual([["nca10", 100], ["fa", undefined]])
  })

  it("sin comprobantes vivos, eliminado o del sistema viejo: no", () => {
    expect(reglaAnulacionPedido("facturado", [comp({ anulado_en: "2026-10-01" })]).puede).toBe(false)
    expect(reglaAnulacionPedido("eliminado", [comp({})]).puede).toBe(false)
    expect(reglaAnulacionPedido("sistema_viejo", [comp({})]).puede).toBe(false)
  })

  it("anulado para refacturar, el pedido sigue en su estado y sus condiciones se pueden cambiar (R1, 27/10)", () => {
    // Sin débitos vivos (la REV espejo no cuenta): condiciones editables en cualquier estado
    for (const e of ["facturado", "listo_para_enviar", "en_viaje", "entregado", "pendiente_facturacion"]) {
      expect(puedeEditarCondiciones(e, false)).toBe(true)
      expect(puedeEditarCondiciones(e, true)).toBe(false)
    }
    expect(puedeEditarCondiciones("impreso", true)).toBe(true) // editable de siempre
    expect(puedeEditarCondiciones("eliminado", false)).toBe(false)
    expect(puedeEditarCondiciones("sistema_viejo", false)).toBe(false)
    // Pantallas sin el dato: solo pendiente de facturación
    expect(puedeEditarCondiciones("pendiente_facturacion")).toBe(true)
    expect(puedeEditarCondiciones("entregado")).toBe(false)
    expect(motivoBloqueo("facturado", true)).toMatch(/Anular comprobantes/)
  })

  it("al volver a facturar, el pedido no retrocede de estado", () => {
    expect(estadoAlFacturar("pendiente_facturacion")).toBe("facturado")
    expect(estadoAlFacturar("impreso")).toBe("facturado")
    expect(estadoAlFacturar("entregado")).toBe("entregado")
    expect(estadoAlFacturar("en_viaje")).toBe("en_viaje")
    expect(estadoAlFacturar("listo_para_retirar")).toBe("listo_para_retirar")
  })
})
