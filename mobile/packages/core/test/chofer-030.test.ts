import { describe, expect, it } from "vitest"
import type { ItemOutbox } from "../src/db/idb"
import { claveDelCliente } from "@gm/cobro/conjunto"
import { estadoCuentaVacio, ncContadoDe, resumenCuenta, valorDeDevolucion, valorEstimadoDevolucion, type DatosCuenta } from "../../../apps/chofer/src/datos/cuenta-cobro"
import { billeteraVisible, clavesDelCobro, clienteVisible, viajeVisible, yaEnReplica } from "../../../apps/chofer/src/datos/overlay"
import type { BilleteraData, ClienteViajeRow, ComprobanteCobro, OpCobrar, ParadaHoja, ViajeDetalle } from "../../../apps/chofer/src/datasets"

// App Chofer v0.3.0 (21/10/2026): 10 % contado con la regla del 07/10, devoluciones por su VALOR,
// y el cobro que el servidor ya tiene no se cuenta dos veces mientras sale de la cola.

const V = "00000000-0000-4000-8000-000000005001"
const C1 = "c1", C2 = "c2"
const KEY = "3f2b9c1e-6d4a-4b8e-9f10-1a2b3c4d5e60" // uuid v4 como las claves reales del equipo
let seq = 0
const op = (tipo: string, payload: unknown, key = KEY, estado: ItemOutbox["estado"] = "pendiente"): ItemOutbox => ({
  key, seq: ++seq, tipo, payload, capturadoAt: "2026-10-21T12:00:00Z", estado, intentos: 0, proximoIntentoAt: 0, error: null, resultado: null, enviadoAt: null, usuarioId: "yo", etiqueta: null,
})
const comp = (extra: Partial<ComprobanteCobro> = {}): ComprobanteCobro => ({
  id: "fa1", tipo_comprobante: "FA", numero_comprobante: "0003-1", fecha: "2026-10-01", total_neto: 8264, total_factura: 10000, saldo_pendiente: 10000, estado_pago: "pendiente", pedido_id: null, ...extra,
})
const cuenta = (comprobantes: ComprobanteCobro[], devoluciones: DatosCuenta["devoluciones"] = []): DatosCuenta => ({
  cobro: { comprobantes, pedidos: [], pedidos_facturados: [], dtos_hechos: [] },
  devoluciones,
})

describe("Chofer v0.3.0 · 10 % contado con la regla del 07/10", () => {
  it("la NC es el 10 % del TOTAL del comprobante, una vez, aunque el pago sea parcial (nc_contado del servidor)", () => {
    const cp = comp({ nc_contado: 1000 })
    expect(ncContadoDe(cp, 3000, new Set())).toBe(1000) // pago parcial: igual bonifica el total
    expect(ncContadoDe(cp, 10000, new Set())).toBe(1000)
    expect(ncContadoDe(cp, 0, new Set())).toBe(0) // no seleccionado
    expect(ncContadoDe(cp, 3000, new Set(["fa1"]))).toBe(0) // ya tiene el 10 %
    expect(ncContadoDe(comp({ nc_contado: 0 }), 3000, new Set())).toBe(0) // el servidor dice que no bonifica
    expect(ncContadoDe(comp({ tipo_comprobante: "ND", nc_contado: 1000 }), 3000, new Set())).toBe(0) // una ND nunca bonifica
  })

  it("réplica vieja sin nc_contado: regla anterior (solo si se salda completo), como mostraban esas APK", () => {
    const cp = comp()
    expect(ncContadoDe(cp, 3000, new Set())).toBe(0)
    expect(ncContadoDe(cp, 10000, new Set())).toBe(1000)
  })

  it("resumen de la cuenta: pago parcial con contado paga lo seleccionado menos la NC completa", () => {
    const d = cuenta([comp({ nc_contado: 1000 })])
    const e = { ...estadoCuentaVacio(), sel: { fa1: 3000 }, contadoGeneral: true }
    const r = resumenCuenta(d, e)
    expect(r.bonificacionEstimada).toBe(1000)
    expect(r.totalCobro).toBe(2000) // presupuesto $100 → NC $10, queda $90: entrega $20 de los $30 seleccionados
    expect(r.contado_general).toBe(true)
  })
})

describe("Chofer v0.3.0 · devoluciones por su valor (= la NC futura)", () => {
  it("la devolución descuenta valor_cobro (con el 10 % de la factura ya aplicado), no el bruto", () => {
    expect(valorDeDevolucion({ monto_total: 10000, valor_cobro: 9000 })).toBe(9000)
    expect(valorDeDevolucion({ monto_total: 10000 })).toBe(10000) // réplica vieja: bruto
    const d = cuenta([comp()], [{ id: "d1", monto_total: 10000, valor_cobro: 9000, estado: "pendiente" }])
    const r = resumenCuenta(d, { ...estadoCuentaVacio(), sel: { fa1: 10000 } })
    expect(r.devTotal).toBe(9000)
    expect(r.totalCobro).toBe(1000)
    expect(r.devolucion_ids).toEqual(["d1"])
  })

  it("valor estimado de una devolución cargada acá: −10 % si la factura fue contado, + IVA si es fiscal (misma regla que el servidor)", () => {
    const comprados = [
      { comprobante_venta_id: "fa-contado", tipo_comprobante: "FA", bonificado_contado: true },
      { comprobante_venta_id: "pres", tipo_comprobante: "PRES", bonificado_contado: false },
    ]
    // Caso (a) del dueño: $10.000 de factura contado → vale $9.000 (+ IVA porque es FA)
    expect(valorEstimadoDevolucion([{ cantidad: 2, precio_venta_original: 5000, comprobante_venta_id: "fa-contado" }], comprados)).toBe(10890)
    expect(valorEstimadoDevolucion([{ cantidad: 2, precio_venta_original: 5000, comprobante_venta_id: "pres" }], comprados)).toBe(10000)
    expect(valorEstimadoDevolucion([{ cantidad: 2, precio_venta_original: 5000, comprobante_venta_id: null }], comprados)).toBe(10000)
  })
})

// ─── El servidor ya tiene el cobro: no se cuenta dos veces ──────────────────
const parada = (n: number, cliente_id: string, pagos: ParadaHoja["pagos"] = []): ParadaHoja => ({
  id: `p${n}`, orden: n, cliente_id, cliente_nombre: `Cliente ${n}`, direccion: "", localidad: "", telefono: "", vendedores: [],
  exigir_cobro_anterior: false, exigir_cobro_actual: false, bloquear_entrega: false, motivo_bloqueo: null, nota_oficina: null,
  estado: "pendiente", bultos_entregados: null, motivo_no_entrega: null, motivo_no_cobro: null, resuelto_at: null,
  pedidos: [{ id: `ped${n}`, numero: "000100", estado: "en_viaje", total: 10000, bultos: 3, vendedor: "", comprobantes: [], remitos: [] }],
  bultos: 3, total_viaje: 10000, saldo_anterior: 0, total_a_cobrar: 10000, minimo_exigido: 0, cobrado: pagos.reduce((s, p) => s + p.monto, 0), cobrado_anterior: 0, cobrado_viaje: 0, devuelto: 0, cobro_cumplido: true,
  pagos,
})
const pagoSrv = (id: string, monto: number, idempotency_key: string | null): ParadaHoja["pagos"][number] => ({
  id, monto, estado: "pendiente_rendicion", fecha: "2026-10-21T12:00:05Z", cargado_por: "", metodos: [{ tipo: "efectivo", monto, detalle: "" }], imputaciones: [], a_cuenta: monto, contado_10: false, ajuste: 0, idempotency_key,
})
const viaje = (paradas: ParadaHoja[]): ViajeDetalle => ({
  id: V,
  viaje: { id: V, nombre: "Reparto", fecha: "2026-10-21", estado: "en_curso", zona_nombre: "BAHIA", es_titular: true, chofer_id: "yo" },
  paradas,
  dinero: { fondo_entregado: 50000, fondos: [], gastos: [], gastos_total: 0, cobrado_efectivo: 0, cobrado_cheques: 0, cheques_cantidad: 0, cobrado_transferencias: 0, efectivo_en_mano: 50000, saldo_billetera_titular: 0 },
  tripulacion: [],
})
const cobro = (cliente_id: string, monto: number, extra: Partial<OpCobrar> = {}): OpCobrar => ({
  viaje_id: V, cliente_id, cliente_nombre: "Cliente", monto_total: monto, metodos: [{ tipo: "efectivo", monto }], imputaciones: [], devolucion_ids: [], comprobante_urls: [],
  pedidos_contado: [], contado_general: false, ajuste_redondeo: 0, cobros_extra: [], fotos_pendientes: [], ...extra,
})

describe("Chofer v0.3.0 · el cobro que el servidor ya tiene no se duplica mientras sale de la cola", () => {
  it("las claves de una operación: la del principal es la de la operación; cada agregado lleva la derivada del servidor", () => {
    const o = op("viaje.cobrar", cobro(C1, 100))
    expect(clavesDelCobro(o, cobro(C1, 100))).toEqual([KEY])
    const conjunto = cobro(C1, 300, { clientes_extra: [{ cliente_id: C2, monto: 200, imputaciones: [], devolucion_ids: [], pedidos_contado: [], pedidos_anticipo: [], contado_general: false }] })
    expect(clavesDelCobro(o, conjunto)).toEqual([KEY, claveDelCliente(KEY, 1)])
    expect(yaEnReplica(o, conjunto, [claveDelCliente(KEY, 1)])).toBe(true)
    expect(yaEnReplica(o, conjunto, [null, undefined, "otra"])).toBe(false)
  })

  it("hoja de ruta: la parada ya trae el pago con la clave de la operación → cobrado una sola vez y nada 'sin enviar'", () => {
    const antes = viajeVisible(viaje([parada(1, C1)]), [op("viaje.cobrar", cobro(C1, 5000))])
    expect(antes.paradas[0]!.cobrado).toBe(5000)
    expect(antes.sinEnviar.cobros).toBe(1)
    expect(antes.dinero!.cobrado_efectivo).toBe(5000)

    const despues = viajeVisible(viaje([parada(1, C1, [pagoSrv("pago-srv", 5000, KEY)])]), [op("viaje.cobrar", cobro(C1, 5000))])
    expect(despues.paradas[0]!.cobrado).toBe(5000) // no 10.000
    expect(despues.paradas[0]!.pagos).toHaveLength(1)
    expect(despues.sinEnviar.cobros).toBe(0)
    expect(despues.dinero!.cobrado_efectivo).toBe(0) // la plata del servidor ya está en v.dinero: el overlay no la suma
    // Un pago del servidor de OTRA operación no tapa a este cobro
    const otro = viajeVisible(viaje([parada(1, C1, [pagoSrv("pago-srv", 5000, "11111111-2222-4333-8444-555555555555")])]), [op("viaje.cobrar", cobro(C1, 5000))])
    expect(otro.paradas[0]!.cobrado).toBe(10000)
  })

  it("cobro conjunto: con el pago del cliente agregado ya en la hoja, ninguna parte se duplica", () => {
    const conjunto = cobro(C1, 300, { clientes_extra: [{ cliente_id: C2, monto: 200, imputaciones: [], devolucion_ids: [], pedidos_contado: [], pedidos_anticipo: [], contado_general: false }] })
    const v = viajeVisible(viaje([parada(1, C1, [pagoSrv("s1", 100, KEY)]), parada(2, C2, [pagoSrv("s2", 200, claveDelCliente(KEY, 1))])]), [op("viaje.cobrar", conjunto)])
    expect(v.paradas.map((p) => p.cobrado)).toEqual([100, 200])
    expect(v.sinEnviar.cobros).toBe(0)
  })

  it("ficha del cliente y billetera: mismo criterio", () => {
    const ficha: ClienteViajeRow = {
      id: `${V}:${C1}`, viaje_id: V, cliente_id: C1, cliente: null, pedido: null, comprobantes_pendientes: [], devoluciones: [],
      pagos_registrados: [{ id: "pago-srv", monto: 5000, estado: "pendiente_rendicion", created_at: "2026-10-21T12:00:05Z", idempotency_key: KEY }],
      resumen: { saldo_anterior: 0, saldo_real: 0, saldo_proyectado: 0, pendiente_verificacion: 0, total_pedido: 10000, total_devuelto: 0, total_cobrado: 5000, total_a_cobrar: 10000, ya_cobrado: true },
      viaje_estado: "en_curso", cobro: { comprobantes: [], pedidos: [], pedidos_facturados: [], dtos_hechos: [] }, comprados: [],
    }
    const c = clienteVisible(ficha, [op("viaje.cobrar", cobro(C1, 5000))])
    expect(c.pagos_registrados).toHaveLength(1)
    expect(c.resumen.total_cobrado).toBe(5000)

    const bill: BilleteraData = {
      id: "billetera", efectivo: 5000, desglose: { cobros_efectivo: 5000, fondo_viaje: 0, gastos: 0, cheques_monto: 0, transferencias: 0, en_rendicion: 0 }, cheques_cantidad: 0, saldo_cuenta_corriente: 0,
      cobros: [{ id: "pago-srv", fecha: "2026-10-21", cliente: "Cliente 1", viaje: "Reparto", monto: 5000, metodos: ["Efectivo"], estado: "en_mano", idempotency_key: KEY }], gastos: [], fondos: [],
    }
    const b = billeteraVisible(bill, [op("viaje.cobrar", cobro(C1, 5000, { cliente_nombre: "Cliente 1" }))])
    expect(b.efectivo).toBe(5000)
    expect(b.cobros).toHaveLength(1)
  })

  it("devolución sin enviar: descuenta por su valor estimado (regla única), el bruto queda informativo", () => {
    const ficha: ClienteViajeRow = {
      id: `${V}:${C1}`, viaje_id: V, cliente_id: C1, cliente: null, pedido: null, comprobantes_pendientes: [], devoluciones: [], pagos_registrados: [],
      resumen: { saldo_anterior: 0, saldo_real: 0, saldo_proyectado: 0, pendiente_verificacion: 0, total_pedido: 10000, total_devuelto: 0, total_cobrado: 0, total_a_cobrar: 10000, ya_cobrado: false },
      viaje_estado: "en_curso", cobro: { comprobantes: [], pedidos: [], pedidos_facturados: [], dtos_hechos: [] }, comprados: [],
    }
    const items = [{ articulo_id: "a", sku: "1", descripcion: "Shampoo", cantidad: 2, precio_venta_original: 500, motivo: "rotura", condicion: "no_vendible" as const, origen: "pedido" as const }]
    const c = clienteVisible(ficha, [op("viaje.devolucion", { viaje_id: V, id: "d-local", cliente_id: C1, pedido_id: null, items, valor_estimado: 900 })])
    expect(c.devoluciones[0]).toMatchObject({ monto_total: 1000, valor_cobro: 900 })
    expect(c.resumen.total_a_cobrar).toBe(9100)
    const v = viajeVisible(viaje([parada(1, C1)]), [op("viaje.devolucion", { viaje_id: V, id: "d-local", cliente_id: C1, pedido_id: null, items, valor_estimado: 900 })])
    expect(v.paradas[0]!.total_a_cobrar).toBe(9100)
  })
})
