import { describe, expect, it } from "vitest"
import { pasaFiltroDeuda, resumenDeuda, textoCondicionCliente } from "../../../apps/vendedor/src/datos/condicion-pago"
import { condDesdePayload, condParaServidor } from "../../../apps/vendedor/src/pantallas/pedido-nuevo/Marco"
import { COND_VACIA } from "../../../apps/vendedor/src/datasets"

// Condiciones de pago, fase 4 (19/11/2026): Mis clientes → deuda vencida / a vencer,
// texto de la condición y "solo este pedido".

describe("Mis clientes: deuda vencida / a vencer", () => {
  const vencida = { deuda_vencida: 1500, deuda_a_vencer: 800, proximo_vencimiento: "2026-12-01" }
  const aVencer = { deuda_vencida: 0, deuda_a_vencer: 800, proximo_vencimiento: "2026-12-01" }
  const sinDato = { deuda_vencida: null, deuda_a_vencer: null, proximo_vencimiento: null }

  it("vencida = algo vencido; a vencer = debe y nada vencido", () => {
    expect(pasaFiltroDeuda(vencida, "vencida")).toBe(true)
    expect(pasaFiltroDeuda(vencida, "a_vencer")).toBe(false)
    expect(pasaFiltroDeuda(aVencer, "a_vencer")).toBe(true)
    expect(pasaFiltroDeuda(aVencer, "vencida")).toBe(false)
    expect(pasaFiltroDeuda(sinDato, "vencida")).toBe(false)
    expect(pasaFiltroDeuda(sinDato, "")).toBe(true)
  })
  it("en la fila: lo vencido primero; si no, lo a vencer con su fecha", () => {
    expect(resumenDeuda(vencida)).toEqual({ tipo: "vencida", monto: 1500, vence: null })
    expect(resumenDeuda(aVencer)).toEqual({ tipo: "a_vencer", monto: 800, vence: "2026-12-01" })
    expect(resumenDeuda(sinDato)).toBeNull()
  })
})

describe("Condición de pago del cliente", () => {
  it("el texto nuevo (= ERP); si no hay, el viejo; nunca uno inventado", () => {
    expect(textoCondicionCliente({ condicion_pago_tipo: "cuenta_corriente", plazo_dias: 30, forma_pago: "cheque", cheque_dias_desde: 60, cheque_dias_hasta: 90 }))
      .toBe("Cuenta corriente 30 días · Cheques de 60 a 90 días")
    expect(textoCondicionCliente({ condicion_pago_tipo: "contado", forma_pago: "efectivo" })).toBe("Contado · Efectivo")
    expect(textoCondicionCliente({ condicion_pago: "Cheque 30 días" })).toBe("Cheque 30 días")
    expect(textoCondicionCliente({})).toBe("")
  })
})

describe("Pedido: condición solo este pedido", () => {
  it("viaja al servidor solo si se cambió y vuelve igual al retomar", () => {
    expect(condParaServidor(COND_VACIA)).not.toHaveProperty("condicion_pago_pedido")
    const condPago = { condicion_pago_tipo: "cuenta_corriente" as const, plazo_dias: 15, forma_pago: "transferencia" as const, cheque_dias_desde: null, cheque_dias_hasta: null }
    const ida = condParaServidor({ ...COND_VACIA, condPago })
    expect(ida.condicion_pago_pedido).toEqual(condPago)
    expect(condDesdePayload(ida).condPago).toEqual(condPago)
  })
  it("normaliza sin frenar: plazo solo en cuenta corriente", () => {
    const ida = condParaServidor({ ...COND_VACIA, condPago: { condicion_pago_tipo: "contado", plazo_dias: 30, forma_pago: null, cheque_dias_desde: null, cheque_dias_hasta: null } })
    expect(ida.condicion_pago_pedido?.plazo_dias).toBe(0)
  })
})
