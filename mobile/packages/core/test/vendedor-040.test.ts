import { describe, expect, it } from "vitest"
import { prepararMotorCliente, type ArticuloMotor, type InsumosCliente } from "@gm/pricing"
import { valorDevolucion } from "@gm/vendedor"
import { bonifFichaPorSeg, cuposDelPedido } from "../../../apps/vendedor/src/datos/condiciones"
import { billeteraVisible, efectivoARendir, retirosSinEnviar, type BilleteraData } from "../../../apps/vendedor/src/datos/billetera"
import { clientesVisibles } from "../../../apps/vendedor/src/datos/overlay"
import type { Cliente, CondPedido } from "../../../apps/vendedor/src/datasets"

// App Vendedor v0.4.0 (20/10/2026): precios pendientes del 06/10, billetera en dos cajitas,
// retiro y devoluciones valuadas como el servidor.

const LISTA = { id: "L", codigo: "neco", recargo_limpieza_bazar: 20, recargo_perfumeria_negro: 10, recargo_perfumeria_blanco: 15 }
const art = (id: string, extra: Partial<ArticuloMotor> = {}): ArticuloMotor => ({
  id, precio_compra: 500, precio_base: 1000, categoria: "LIMPIEZA", iva_compras: "factura", iva_ventas: "factura",
  descuentos: [], proveedor_id: "P1", marca_id: "M1", ...extra,
})
const insumos = (extra: Partial<InsumosCliente> = {}): InsumosCliente => ({
  cliente: { lista_precio_id: "L", metodo_facturacion: "Factura" }, listas: [LISTA], reglas: [],
  condicionesProveedor: [], condicionesMarca: [], bonificaciones: [], ...extra,
})

describe("Sin precio base, sin precio (regla del dueño 06/10)", () => {
  it("un artículo con costo pero sin precio base no tiene precio de venta", () => {
    const m = prepararMotorCliente(insumos())
    expect(m.precio(art("A", { precio_base: null })).precio).toBe(0)
    expect(m.precio(art("B")).precio).toBeGreaterThan(0)
  })
})

describe("Condiciones por proveedor/marca del pedido = lista COMPLETA (como createPedido)", () => {
  const ficha = insumos({ condicionesProveedor: [{ proveedor_id: "P1", lista_precio_id: null, metodo_facturacion: "Presupuesto", dto_general_pct: null, dto_viajante_pct: null, dto_mercaderia_pct: null }] })
  it("con la ficha, el proveedor P1 va en presupuesto", () => {
    expect(prepararMotorCliente(ficha).precio(art("A")).metodoRaw).toBe("Presupuesto")
  })
  it("si el pedido manda su lista sin P1, P1 sale como el resto del pedido (antes se mezclaba con la ficha)", () => {
    expect(prepararMotorCliente(ficha, { condiciones_proveedor: [] }).precio(art("A")).metodoRaw).toBe("Factura")
  })
})

describe("Mercadería por cupo: mismos cupos que el servidor", () => {
  const filas = [
    { tipo: "mercaderia", segmento: null, porcentaje: 5 },
    { tipo: "contado", segmento: "perf0", porcentaje: 10 },
  ]
  const ficha = { filas, bonif: { general: {}, viajante: {}, mercaderia: bonifFichaPorSeg(filas, "mercaderia"), contado: bonifFichaPorSeg(filas, "contado") }, condProv: [], condMarca: [] }
  const nombres = { proveedor: () => "Prov", marca: () => "Marca" }
  const cond: CondPedido = { metodo: "", lista: "", bonif: null }

  it("la fila 'todos' de la ficha es el cupo 'todo' y vale el % del neto", () => {
    const c = cuposDelPedido([{ art: art("A"), cantidad: 2, neto: 1000 }], ficha as never, cond, nombres)
    expect(c).toEqual([{ origen: "todo", nombre: "Todo el pedido", pct: 5, base: 2000, monto: 100 }])
  })
  it("un % por segmento solo para el pedido es el cupo 'seg:<segmento>'", () => {
    const c = cuposDelPedido([{ art: art("A"), cantidad: 1, neto: 1000 }], ficha as never, { ...cond, bonif: { mercaderia: { limpieza_bazar: 3 } } }, nombres)
    expect(c[0]).toMatchObject({ origen: "seg:limpieza_bazar", pct: 3, monto: 30 })
  })
  it("una condición de proveedor con mercadería es su propio cupo 'prov:<id>'", () => {
    const condProv = [{ proveedor_id: "P1", lista_precio_id: null, metodo_facturacion: null, dto_general_pct: null, dto_viajante_pct: null, dto_mercaderia_pct: 8 }]
    const c = cuposDelPedido([{ art: art("A"), cantidad: 1, neto: 1000 }], ficha as never, { ...cond, condProv }, nombres)
    expect(c[0]).toMatchObject({ origen: "prov:P1", nombre: "Proveedor Prov", pct: 8 })
  })
  it("contado de la ficha por segmento = 10", () => {
    expect(ficha.bonif.contado).toEqual({ perf0: 10 })
  })
})

describe("Billetera en dos cajitas + retiro sin señal", () => {
  const b: BilleteraData = {
    balance: 100000, desglose: { efectivo: 100000, cheques: 0, transferencias: 0 }, pagos_sin_rendir: 2, en_viaje: { total: 0, cantidad: 0 },
    comisiones_pendientes: [], total_pendiente_comisiones: 0, historial: [], retiros_sin_rendir: 0,
    cuenta_personal: { cliente_id: "c", saldo_real: -30000, saldo_proyectado: -30000, a_favor: 30000, comisiones_ganadas: 30000, retiros: 0 },
  }
  const op = (estado: string, monto: number) => ({ tipo: "retiro.registrar", estado, payload: { monto } }) as never
  it("un retiro sin enviar baja la plata de la empresa y lo que tiene a favor", () => {
    const n = retirosSinEnviar([op("pendiente", 50000), op("rechazado", 999), op("enviado", 1)])
    expect(n).toBe(50000)
    expect(billeteraVisible(b, n)).toMatchObject({ balance: 50000, retiros_sin_rendir: 50000, cuenta_personal: { a_favor: -20000, retiros: 50000 } })
  })
})

describe("Devolución sin enviar valuada como el servidor", () => {
  it("usa el valor calculado al cargarla (regla única), no el bruto", () => {
    const v = valorDevolucion({ renglones: [{ subtotal: 10000 }], aplica10: true, conIva: false }).total
    expect(v).toBe(9000)
    const cliente = { id: "c1", nombre: "X", saldo_actual: 50000, saldo_proyectado: 50000, pagos_sin_rendir: 0, bonificaciones: { viajante: {}, mercaderia: {} } } as unknown as Cliente
    const ops = [{ tipo: "devolucion.registrar", estado: "pendiente", payload: { cliente_id: "c1", items: [{ cantidad: 1, precio_venta_original: 10000 }], valor_estimado: v } }] as never
    expect(clientesVisibles([cliente], ops)[0]!.saldo_proyectado).toBe(41000)
  })
})

describe("Rendición: el efectivo a llevar descuenta los retiros (auditoría 21/10)", () => {
  it("cobró 122.000 y retiró 122.000: lleva 0 (antes proponía 122.000 y el retiro quedaba a su favor)", () => {
    expect(efectivoARendir(122000, 122000)).toBe(0)
  })
  it("cobró 300.000 y retiró 50.000: lleva 250.000", () => {
    expect(efectivoARendir(300000, 50000)).toBe(250000)
  })
  it("sin retiros lleva todo el efectivo y nunca propone un número negativo", () => {
    expect(efectivoARendir(80000.5, 0)).toBe(80000.5)
    expect(efectivoARendir(10000, 30000)).toBe(0)
  })
})
