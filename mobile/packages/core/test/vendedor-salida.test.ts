import { describe, expect, it } from "vitest"
import type { ArticuloMotor } from "@gm/pricing"
import { contadoInicial, descuentoContado, type CondicionesFicha } from "../../../apps/vendedor/src/datos/condiciones"
import { transferenciasSinEnviar } from "../../../apps/vendedor/src/datos/billetera"
import type { CondPedido } from "../../../apps/vendedor/src/datasets"

// App Vendedor — pendientes de la prueba de salida (26/10/2026, docs/PENDIENTES-APPS-SALIDA.md).

const art = (id: string, extra: Partial<ArticuloMotor> = {}): ArticuloMotor => ({
  id, precio_compra: 500, precio_base: 1000, categoria: "LIMPIEZA", iva_compras: "factura", iva_ventas: "factura",
  descuentos: [], proveedor_id: "P1", marca_id: "M1", ...extra,
})
const ficha = (filas: CondicionesFicha["filas"]): CondicionesFicha => ({ filas, bonif: { general: {}, viajante: {}, mercaderia: {}, contado: {} }, condProv: [], condMarca: [] })
const cond = (bonif: CondPedido["bonif"] = null): CondPedido => ({ metodo: "", lista: "", bonif })
const linea = (a: ArticuloMotor, precio = 1000, especial = false) => ({ art: a, cantidad: 10, precio, especial })

describe("V1 — 10 % contado al finalizar el pedido (#13)", () => {
  it("cliente con contado en la ficha para todo: arranca tildado y el total ya lo descuenta", () => {
    const f = ficha([{ tipo: "contado", segmento: null, porcentaje: 10 }])
    expect(contadoInicial(f, cond())).toBe("todo")
    expect(descuentoContado([linea(art("A"))], f, cond())).toBe(1000)
  })
  it("cliente sin contado: arranca destildado; tildarlo (contado_todo) descuenta el 10 % de todo", () => {
    const f = ficha([])
    expect(contadoInicial(f, cond())).toBe("nada")
    expect(descuentoContado([linea(art("A"))], f, cond())).toBe(0)
    expect(descuentoContado([linea(art("A"))], f, cond({ contado_todo: true }))).toBe(1000)
  })
  it("destildar le gana a la ficha, y la lista Especial nunca va contado", () => {
    const f = ficha([{ tipo: "contado", segmento: null, porcentaje: 10 }])
    expect(descuentoContado([linea(art("A"))], f, cond({ contado_todo: false }))).toBe(0)
    expect(descuentoContado([linea(art("A"), 1000, true)], f, cond({ contado_todo: true }))).toBe(0)
  })
  it("contado solo en un segmento: parcial", () => {
    expect(contadoInicial(ficha([{ tipo: "contado", segmento: "perf0", porcentaje: 10 }]), cond())).toBe("parcial")
  })
})

describe("V5 — transferencias fuera de la rendición (#35)", () => {
  it("un cobro sin enviar con transferencia se lista aparte (no suma a la mano)", () => {
    const ops = [
      { key: "k1", tipo: "cobro.registrar", estado: "pendiente", capturadoAt: "2026-10-26T13:00:00Z", etiqueta: "Cobro LI YUTAO $150.000,00", payload: { metodos: [{ tipo: "efectivo", monto: 100000 }, { tipo: "transferencia", monto: 50000 }] } },
      { key: "k2", tipo: "cobro.registrar", estado: "pendiente", capturadoAt: "2026-10-26T13:00:00Z", etiqueta: "Cobro X $10,00", payload: { metodos: [{ tipo: "efectivo", monto: 10 }] } },
      { key: "k3", tipo: "cobro.registrar", estado: "enviado", capturadoAt: "2026-10-26T13:00:00Z", etiqueta: "Cobro Y $5,00", payload: { metodos: [{ tipo: "transferencia", monto: 5 }] } },
    ] as never
    expect(transferenciasSinEnviar(ops)).toEqual([
      { pago_id: "local:k1", fecha: "2026-10-26T13:00:00Z", cliente: "LI YUTAO", monto: 50000, medio: "transferencia", estado: "sin_enviar" },
    ])
  })
})
