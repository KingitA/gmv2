// Condiciones de pago, fase 2 (19/11/2026): el pedido congela la condición de la
// ficha (vacía si no hay: no frena nada) y cada comprobante guarda el texto y el
// vencimiento = fecha + plazo (contado, anticipado y sin condición: el mismo día).
import { describe, expect, it } from "vitest"
import {
  columnasPedido,
  condicionDeFicha,
  condicionDePedido,
  condicionParaComprobante,
  datosPagoComprobante,
  etiquetaCortaCondicion,
} from "../../../../lib/pedidos/condicion-pago-pedido"

const fichaCC = { condicion_pago_tipo: "cuenta_corriente", plazo_dias: 30, forma_pago: "cheque", cheque_dias_desde: 60, cheque_dias_hasta: 90 }

describe("el pedido congela la condición de la ficha", () => {
  it("copia la de la ficha a las columnas _pedido", () => {
    expect(columnasPedido(condicionDeFicha(fichaCC))).toEqual({
      condicion_pago_tipo_pedido: "cuenta_corriente",
      plazo_dias_pedido: 30,
      forma_pago_pedido: "cheque",
      cheque_dias_desde_pedido: 60,
      cheque_dias_hasta_pedido: 90,
    })
  })

  it("ficha vacía → pedido vacío, sin suponer nada ni rechazar", () => {
    expect(columnasPedido(condicionDeFicha({}))).toEqual({
      condicion_pago_tipo_pedido: null, plazo_dias_pedido: null, forma_pago_pedido: null, cheque_dias_desde_pedido: null, cheque_dias_hasta_pedido: null,
    })
    expect(etiquetaCortaCondicion(condicionDeFicha(null))).toBe("")
  })

  it("lo incoherente se acomoda: plazo sin cuenta corriente queda en 0, días de cheque sin cheque se borran", () => {
    expect(columnasPedido({ condicion_pago_tipo: "contado", plazo_dias: 30, forma_pago: "efectivo", cheque_dias_desde: 30, cheque_dias_hasta: 30 })).toMatchObject({
      plazo_dias_pedido: 0, cheque_dias_desde_pedido: null, cheque_dias_hasta_pedido: null,
    })
  })
})

describe("comprobante: texto y vencimiento", () => {
  const pedidoCC = columnasPedido(condicionDeFicha(fichaCC))

  it("cuenta corriente 30 días: vence 30 días después (19/11 → 19/12)", () => {
    expect(datosPagoComprobante("2026-11-19", condicionParaComprobante(pedidoCC, null))).toEqual({
      condicion_pago_texto: "Cuenta corriente 30 días · Cheques de 60 a 90 días",
      fecha_vencimiento: "2026-12-19",
    })
  })

  it("contado y anticipado vencen el mismo día", () => {
    const contado = condicionDeFicha({ condicion_pago_tipo: "contado", forma_pago: "efectivo" })
    expect(datosPagoComprobante("2026-11-19", contado)).toEqual({ condicion_pago_texto: "Contado · Efectivo", fecha_vencimiento: "2026-11-19" })
    expect(datosPagoComprobante("2026-11-19", condicionDeFicha({ condicion_pago_tipo: "anticipado" })).fecha_vencimiento).toBe("2026-11-19")
  })

  it("sin condición: texto vacío y vence el mismo día", () => {
    expect(datosPagoComprobante("2026-11-19", condicionDeFicha({}))).toEqual({ condicion_pago_texto: null, fecha_vencimiento: "2026-11-19" })
  })

  it("rige la del pedido; un pedido sin condición propia (anterior a la fase 2) toma la de la ficha", () => {
    const pedidoContado = columnasPedido({ condicion_pago_tipo: "contado", forma_pago: "transferencia" })
    expect(condicionParaComprobante(pedidoContado, fichaCC).condicion_pago_tipo).toBe("contado")
    expect(condicionParaComprobante({}, fichaCC)).toEqual(condicionDeFicha(fichaCC))
    expect(condicionDePedido(pedidoCC).plazo_dias).toBe(30)
  })

  it("etiqueta corta del listado", () => {
    expect(etiquetaCortaCondicion(condicionDeFicha(fichaCC))).toBe("CC 30 d")
    expect(etiquetaCortaCondicion(condicionDeFicha({ condicion_pago_tipo: "anticipado" }))).toBe("Anticipado")
  })
})
