import { describe, expect, it } from "vitest"
import {
  anticiposDeSeleccion, baseTopeAjuste, normalizarAnticipos, ofreceAjuste, pedidosContadoAEnviar, pedidosContadoAlAplicarTodo,
  pedidosContadoValidos, resolverAjuste, topeAjuste, TOPE_AJUSTE_PCT,
} from "@gm/cobro"
import { topeAjuste as topeAjusteErp, TOPE_AJUSTE_PCT as PCT_ERP } from "../../../../lib/cobranzas/ajuste"

// Dos bugs de la pasada del dueño (29/09/2026):
//  1. "10% contado a todo" tildaba el 10 % en TODOS los pedidos de la lista (y el servidor
//     marcaba pago_contado_10 en todos). Regla: solo lo seleccionado para cobrar.
//  2. Total a cobrar $317.446,92, entrega $317.447 (sobran $0,08) ⇒ el servidor rebotaba con
//     "supera el tope del 1% (0.00)". La base daba 0 porque lo seleccionado eran pedidos sin
//     facturar (anticipos), que no viajan como imputaciones. Y el sobrante jamás debe rebotar.

const LISTA = ["p1", "p2", "p3"]

describe("10% contado a todo · solo lo seleccionado", () => {
  it("un solo pedido tildado para cobrar: el toggle marca solo ese", () => {
    const seleccion = { "pedido:p2": 1000 }
    expect(pedidosContadoAlAplicarTodo(true, LISTA, seleccion)).toEqual(["p2"])
  })

  it("sin pedidos seleccionados (solo comprobantes) no marca ninguno; al desactivar limpia todo", () => {
    expect(pedidosContadoAlAplicarTodo(true, LISTA, { "comp-1": 500 })).toEqual([])
    expect(pedidosContadoAlAplicarTodo(false, LISTA, { "pedido:p1": 10, "pedido:p2": 10 })).toEqual([])
  })

  it("al servidor viajan solo los tildados con 10% que están seleccionados, y los anticipos de la selección", () => {
    const seleccion = { "pedido:p2": 900, "comp-1": 500 }
    // p1 tiene el check individual pero NO está seleccionado para cobrar
    expect(pedidosContadoAEnviar(new Set(["p1", "p2"]), seleccion)).toEqual(["p2"])
    expect(anticiposDeSeleccion(seleccion)).toEqual([{ pedido_id: "p2", monto: 900 }])
  })

  it("servidor: con pedidos_anticipo marca solo los de la selección aunque llegue la lista entera", () => {
    const anticipos = normalizarAnticipos([{ pedido_id: "p2", monto: 900 }, { pedido_id: "p9", monto: 0 }])
    expect(anticipos).toEqual([{ pedido_id: "p2", monto: 900 }])
    expect(pedidosContadoValidos(["p1", "p2", "p3"], anticipos)).toEqual(["p2"])
    expect(pedidosContadoValidos(["p1"], normalizarAnticipos([]))).toEqual([])
  })

  it("servidor: un cliente anterior (sin pedidos_anticipo) conserva el comportamiento previo", () => {
    expect(normalizarAnticipos(undefined)).toBeNull()
    expect(pedidosContadoValidos(["p1", "p1", "p2"], null)).toEqual(["p1", "p2"])
    expect(pedidosContadoValidos(undefined, null)).toEqual([])
  })
})

describe("ajuste por redondeo · tope solo en contra, el sobrante nunca rebota", () => {
  it("misma constante y mismo tope que lib/cobranzas/ajuste.ts", () => {
    expect(TOPE_AJUSTE_PCT).toBe(PCT_ERP)
    for (const n of [0, 100, 317446.92, -5, NaN]) expect(topeAjuste(n)).toBe(topeAjusteErp(n))
  })

  it("caso del dueño: $317.446,92 en pedidos sin facturar, entrega $317.447 (sobran $0,08)", () => {
    // Antes: base = Σ imputaciones a comprobantes = 0 ⇒ tope $0,00 ⇒ rebote
    const base = baseTopeAjuste({ imputado: 0, anticipos: 317446.92, montoTotal: 317447, ajuste: -0.08 })
    expect(base).toBe(317447)
    const r = resolverAjuste(-0.08, base)
    expect(r.tope).toBe(3174.47)
    expect(r).toMatchObject({ ajuste: -0.08, rechazo: null, aviso: null })
  })

  it("el mismo caso desde un cliente que no manda los anticipos (APK anterior): tampoco rebota", () => {
    const base = baseTopeAjuste({ imputado: 0, anticipos: 0, montoTotal: 317447, ajuste: -0.08 })
    expect(resolverAjuste(-0.08, base)).toMatchObject({ ajuste: -0.08, rechazo: null, tope: 3174.47 })
  })

  it("base = comprobantes + anticipos", () => {
    expect(baseTopeAjuste({ imputado: 1000, anticipos: 500, montoTotal: 1200, ajuste: 0 })).toBe(1500)
  })

  it("en contra (perdonar saldo): hasta el 1 % pasa, más que eso se rechaza", () => {
    expect(resolverAjuste(10, 1000)).toMatchObject({ ajuste: 10, rechazo: null })
    const r = resolverAjuste(10.5, 1000)
    expect(r.ajuste).toBe(0)
    expect(r.rechazo).toContain("supera el tope del 1%")
    expect(r.rechazo).toContain("$ 10,00")
  })

  it("sobrante grande: NUNCA rechazo; no se ajusta, queda a cuenta del cliente con aviso", () => {
    const r = resolverAjuste(-5000, 1000)
    expect(r.rechazo).toBeNull()
    expect(r.ajuste).toBe(0)
    expect(r.aviso).toContain("a cuenta del cliente")
  })

  it("ningún sobrante rebota, sea cual sea la base", () => {
    for (const base of [0, 0.5, 100, 317446.92]) for (const sobra of [0.01, 0.08, 99, 1e6]) expect(resolverAjuste(-sobra, base).rechazo).toBeNull()
  })

  it("sin diferencia no hay ajuste", () => {
    expect(resolverAjuste(0.004, 1000)).toMatchObject({ ajuste: 0, rechazo: null, aviso: null })
  })

  it("pantalla: el ajuste se ofrece solo si la diferencia entra en el 1 % de lo seleccionado", () => {
    expect(ofreceAjuste(0.08, 317446.92)).toBe(true)
    expect(ofreceAjuste(-3174.47, 317446.92)).toBe(true)
    expect(ofreceAjuste(-3174.6, 317446.92)).toBe(false)
    expect(ofreceAjuste(4000, 317446.92)).toBe(false)
  })
})
