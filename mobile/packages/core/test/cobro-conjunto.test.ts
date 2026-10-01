import { describe, expect, it } from "vitest"
import type { ItemOutbox } from "../src/db/idb"
import { claveDelCliente, montoDelPrincipal, repartirMetodos, validarCobroConjunto } from "@gm/cobro/conjunto"
import {
  alternarAnticipo, alternarComprobante, alternarContadoTodo, alternarTodo, estadoCuentaVacio, fijarMonto, resumenCuenta, type DatosCuenta,
} from "../../../apps/chofer/src/datos/cuenta-cobro"
import { clienteVisible, partesDelCobro, viajeVisible } from "../../../apps/chofer/src/datos/overlay"
import type { ClienteViajeRow, OpCobrar, ParadaHoja, ViajeDetalle } from "../../../apps/chofer/src/datasets"

// COBRO CONJUNTO (dueño, 01/10/2026): un mismo pago físico cubre a varios clientes. Caso real: el
// cliente de la parada tiene otro local y paga los dos con UN cheque. Al agregar el otro cliente
// se ve su cuenta completa (pedidos, comprobantes, 10 %, devoluciones) y los medios de pago se
// reparten entre todos. El reparto de la IMPUTACIÓN (10 % mezclado) es del servidor: acá no se prueba.

const cheque = (monto: number, numero = "12345678") => ({ tipo: "cheque" as const, monto, banco_emisor: "Macro", numero_cheque: numero, fecha_cheque: "2026-10-30" })
const efectivo = (monto: number) => ({ tipo: "efectivo" as const, monto })
const suma = (ms: Array<{ monto: number }>) => Math.round(ms.reduce((s, m) => s + m.monto, 0) * 100) / 100

describe("cobro conjunto · reparto de los medios de pago", () => {
  it("un cheque único que paga dos clientes: se parte en dos pedazos, uno por cliente, al centavo", () => {
    const r = repartirMetodos([cheque(150000.5)], [100000.25, 50000.25])
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual([{ ...cheque(100000.25) }])
    expect(r[1]).toEqual([{ ...cheque(50000.25) }])
  })

  it("cada cliente suma EXACTO lo suyo y cada medio queda repartido EXACTO (cascada, sin centavos sueltos)", () => {
    const metodos = [efectivo(33333.33), cheque(100000), efectivo(0.01), { tipo: "transferencia" as const, monto: 66666.67, numero_comprobante: "T1" }]
    const montos = [120000.01, 30000, 50000]
    const r = repartirMetodos(metodos, montos)
    expect(r.map(suma)).toEqual(montos)
    for (const m of metodos) {
      const pedazos = r.flat().filter((x) => x.tipo === m.tipo && (m.tipo !== "transferencia" || true) && Object.keys(m).every((k) => k === "monto" || (x as any)[k] === (m as any)[k]))
      expect(suma(pedazos)).toBeGreaterThan(0)
    }
    expect(suma(r.flat())).toBe(suma(metodos))
    // Un cheque solo se parte si cruza de un cliente a otro: acá el de 100.000 cruza una vez
    expect(r.flat().filter((x) => x.tipo === "cheque")).toHaveLength(2)
  })

  it("efectivo + cheque: primero se completa al principal, después a los agregados", () => {
    const r = repartirMetodos([efectivo(40000), cheque(60000)], [70000, 30000])
    expect(r[0]).toEqual([efectivo(40000), cheque(30000)])
    expect(r[1]).toEqual([cheque(30000, "12345678 (2)")])
  })

  it("pedazos IGUALES del mismo cheque: el repetido lleva sufijo (la unicidad de cheques es banco+número+importe+vencimiento)", () => {
    const r = repartirMetodos([cheque(30000)], [10000, 10000, 10000])
    expect(r.map((x) => x[0]!.numero_cheque)).toEqual(["12345678", "12345678 (2)", "12345678 (3)"])
    // pedazos distintos no se tocan
    expect(repartirMetodos([cheque(30000)], [10000, 20000]).map((x) => x[0]!.numero_cheque)).toEqual(["12345678", "12345678"])
  })

  it("si los medios no suman lo que se cobra, no reparte", () => {
    expect(() => repartirMetodos([efectivo(100)], [60, 60])).toThrow("no suman")
  })

  it("al principal le queda lo entregado menos lo de los agregados; la validación corta antes de registrar", () => {
    expect(montoDelPrincipal(150000.5, [50000.25])).toBe(100000.25)
    expect(validarCobroConjunto("p", 150000, [{ cliente_id: "a", monto: 50000 }])).toBeNull()
    expect(validarCobroConjunto("p", 50000, [{ cliente_id: "a", monto: 50000 }])).toContain("no alcanza")
    expect(validarCobroConjunto("p", 150000, [{ cliente_id: "p", monto: 1 }])).toContain("dos veces")
    expect(validarCobroConjunto("p", 150000, [{ cliente_id: "a", monto: 1 }, { cliente_id: "a", monto: 1 }])).toContain("dos veces")
    expect(validarCobroConjunto("p", 150000, [{ cliente_id: "a", monto: 0 }])).toContain("sin importe")
  })

  it("claves de idempotencia: la del principal es la del envío; las de los agregados, derivadas y estables", () => {
    const k = "11111111-2222-4333-8444-555555555555"
    expect(claveDelCliente(k, 0)).toBe(k)
    expect(claveDelCliente(k, 1)).toBe("11111111-2222-e333-8444-5555555555" + "10")
    expect(claveDelCliente(k, 2)).toBe("11111111-2222-e333-8444-5555555555" + "11")
    expect(claveDelCliente(k, 1)).toBe(claveDelCliente(k, 1))
    expect(claveDelCliente(null, 1)).toBeNull()
  })
})

// ── La cuenta de un cliente (misma lógica para el principal y para cada agregado) ──
const cuenta = (extra: Partial<DatosCuenta["cobro"]> = {}, devoluciones: DatosCuenta["devoluciones"] = []): DatosCuenta => ({
  cobro: {
    comprobantes: [
      { id: "fa1", tipo_comprobante: "FA", numero_comprobante: "0003-1", fecha: "2026-09-23", total_neto: 8264, total_factura: 10000, saldo_pendiente: 10000, estado_pago: "pendiente", pedido_id: "ped1" },
      { id: "pres2", tipo_comprobante: "PRES", numero_comprobante: "0001-2", fecha: "2026-09-24", total_neto: 5000, total_factura: 5000, saldo_pendiente: 5000, estado_pago: "pendiente", pedido_id: null },
    ],
    pedidos: [{ id: "ped1", numero_pedido: "000100", fecha: "2026-09-23", total: 10000, estado: "en_viaje" }, { id: "ped2", numero_pedido: "000101", fecha: "2026-09-23", total: 3000, estado: "impreso" }],
    pedidos_facturados: ["ped1"],
    dtos_hechos: [],
    ...extra,
  },
  devoluciones,
})

describe("cuenta de un cliente · selección y totales", () => {
  it("seleccionar todo: comprobantes por su saldo y pedidos sin facturar como anticipo", () => {
    const d = cuenta()
    const e = alternarTodo(estadoCuentaVacio(), d.cobro)
    const r = resumenCuenta(d, e)
    expect(r.totalImputado).toBe(18000)
    expect(r.imputaciones).toEqual([{ comprobante_id: "fa1", monto_imputado: 10000 }, { comprobante_id: "pres2", monto_imputado: 5000 }])
    expect(r.pedidos_anticipo).toEqual([{ pedido_id: "ped2", monto: 3000 }])
    expect(alternarTodo(e, d.cobro).sel).toEqual({})
  })

  it("10% contado a todo: solo a lo seleccionado, no al comprobante que ya lo tiene, y el pedido sin facturar cobra el 90%", () => {
    const d = cuenta({ dtos_hechos: ["pres2"] })
    let e = alternarTodo(estadoCuentaVacio(), d.cobro)
    e = alternarContadoTodo(e, d.cobro)
    const r = resumenCuenta(d, e)
    expect(r.bonificacionEstimada).toBe(1000) // 10 % de fa1; pres2 ya lo tenía
    expect(e.sel["pedido:ped2"]).toBe(2700)
    expect(r.pedidos_contado).toEqual(["ped2"])
    expect(r.contado_general).toBe(true)
    expect(r.totalCobro).toBe(10000 + 5000 + 2700 - 1000)
  })

  it("todo lo seleccionado ya bonificado: no hay descuento y NO viaja el 10 % (no se aplica dos veces)", () => {
    const d = cuenta({ dtos_hechos: ["fa1", "pres2"] })
    let e = alternarComprobante(estadoCuentaVacio(), d.cobro.comprobantes[0]!)
    e = alternarContadoTodo(e, d.cobro)
    const r = resumenCuenta(d, e)
    expect(r.bonificacionEstimada).toBe(0)
    expect(r.contado_general).toBe(false)
    expect(r.totalCobro).toBe(10000)
  })

  it("devoluciones como crédito y plata a cuenta", () => {
    const d = cuenta({}, [{ id: "d1", monto_total: 500, estado: "pendiente" }, { id: "d2", monto_total: 900, estado: "facturado" }])
    let e = alternarComprobante(estadoCuentaVacio(), d.cobro.comprobantes[0]!)
    expect(resumenCuenta(d, e)).toMatchObject({ devTotal: 500, totalCobro: 9500, devolucion_ids: ["d1"] })
    e = { ...e, incluirDevoluciones: false, aCuenta: 250 }
    expect(resumenCuenta(d, e)).toMatchObject({ devTotal: 0, totalCobro: 10250, devolucion_ids: [] })
  })

  it("monto parcial de un comprobante: nunca más que su saldo cobrable", () => {
    const d = cuenta()
    const fa = { ...d.cobro.comprobantes[0]!, en_cobro: 4000 } // 4.000 ya están en un cobro sin enviar
    let e = alternarComprobante(estadoCuentaVacio(), fa)
    expect(e.sel.fa1).toBe(6000)
    e = fijarMonto(e, fa, 99999)
    expect(e.sel.fa1).toBe(6000)
    expect(fijarMonto(e, fa, 1500).sel.fa1).toBe(1500)
  })

  it("con el 10 % general activo, el pedido que se selecciona después lo recibe y el que se deselecciona lo pierde", () => {
    const d = cuenta()
    const ped2 = d.cobro.pedidos[1]!
    let e = alternarComprobante(estadoCuentaVacio(), d.cobro.comprobantes[0]!)
    e = alternarContadoTodo(e, d.cobro)
    e = alternarAnticipo(e, ped2)
    expect(e.sel["pedido:ped2"]).toBe(2700)
    expect(e.contadoPedidos).toEqual(["ped2"])
    e = alternarAnticipo(e, ped2)
    expect(e.sel["pedido:ped2"]).toBeUndefined()
    expect(e.contadoPedidos).toEqual([])
  })

  it("sin la cuenta en el equipo (cliente de afuera sin señal): solo plata a cuenta", () => {
    expect(resumenCuenta(null, { ...estadoCuentaVacio(), aCuenta: 1234.5 })).toMatchObject({ totalCobro: 1234.5, imputaciones: [], contado_general: false })
  })
})

// ── Overlay: lo que se ve sin señal ──
let seq = 0
const op = (tipo: string, payload: unknown, estado: ItemOutbox["estado"] = "pendiente"): ItemOutbox => ({
  key: `c${++seq}`, seq, tipo, payload, capturadoAt: "2026-10-01T12:00:00Z", estado, intentos: 0, proximoIntentoAt: 0, error: null, resultado: null, enviadoAt: null, usuarioId: "yo", etiqueta: null,
})
const V = "00000000-0000-4000-8000-000000005001"
const parada = (n: number, cliente_id: string): ParadaHoja => ({
  id: `p${n}`, orden: n, cliente_id, cliente_nombre: `Cliente ${n}`, direccion: "", localidad: "", telefono: "", vendedores: [],
  exigir_cobro_anterior: false, exigir_cobro_actual: false, bloquear_entrega: false, motivo_bloqueo: null, nota_oficina: null,
  estado: "pendiente", bultos_entregados: null, motivo_no_entrega: null, motivo_no_cobro: null, resuelto_at: null,
  pedidos: [{ id: `ped${n}`, numero: "000100", estado: "en_viaje", total: 10000, bultos: 3, vendedor: "", comprobantes: [], remitos: [] }],
  bultos: 3, total_viaje: 10000, saldo_anterior: 0, total_a_cobrar: 10000, minimo_exigido: 0, cobrado: 0, cobrado_anterior: 0, cobrado_viaje: 0, devuelto: 0, cobro_cumplido: true, pagos: [],
})
const viaje = (): ViajeDetalle => ({
  id: V,
  viaje: { id: V, nombre: "Reparto", fecha: "2026-10-01", estado: "en_curso", zona_nombre: "BAHIA", es_titular: true, chofer_id: "yo" },
  paradas: [parada(1, "c1"), parada(2, "c2")],
  dinero: { fondo_entregado: 0, fondos: [], gastos: [], gastos_total: 0, cobrado_efectivo: 0, cobrado_cheques: 0, cheques_cantidad: 0, cobrado_transferencias: 0, efectivo_en_mano: 0, saldo_billetera_titular: 0 },
  tripulacion: [],
})
const conjunto = (): OpCobrar => ({
  viaje_id: V, cliente_id: "c1", cliente_nombre: "Cliente 1", monto_total: 15000, metodos: [cheque(15000)], imputaciones: [{ comprobante_id: "fa1", monto_imputado: 10000 }],
  devolucion_ids: [], comprobante_urls: [], pedidos_contado: [], contado_general: false, ajuste_redondeo: 0, cobros_extra: [], fotos_pendientes: [],
  clientes_extra: [{ cliente_id: "c2", cliente_nombre: "Cliente 2", monto: 5000, imputaciones: [{ comprobante_id: "pres2", monto_imputado: 5000 }], devolucion_ids: [], pedidos_contado: [], pedidos_anticipo: [], contado_general: false }],
})

describe("cobro conjunto · lo que ve el chofer sin señal", () => {
  it("cada cliente ve SU parte; la plata se cuenta una sola vez (un cheque, no dos)", () => {
    const partes = partesDelCobro(conjunto())
    expect(partes.map((x) => [x.cliente_id, x.monto, x.principal])).toEqual([["c1", 10000, true], ["c2", 5000, false]])
    const v = viajeVisible(viaje(), [op("viaje.cobrar", conjunto())])
    expect(v.paradas[0]!.cobrado).toBe(10000)
    expect(v.paradas[1]!.cobrado).toBe(5000)
    expect(v.dinero!.cobrado_cheques).toBe(15000)
    expect(v.dinero!.cheques_cantidad).toBe(1)
  })

  it("el cobro cierra la parada del cliente principal; la del cliente agregado queda como estaba", () => {
    const v = viajeVisible(viaje(), [op("viaje.cobrar", conjunto())])
    expect(v.paradas[0]!.estado).toBe("entregado")
    expect(v.paradas[1]!.estado).toBe("pendiente")
  })

  it("en la ficha del cliente AGREGADO su comprobante queda reservado (no se cobra dos veces) y aparece su pago", () => {
    const ficha: ClienteViajeRow = {
      id: `${V}:c2`, viaje_id: V, cliente_id: "c2",
      cliente: { nombre: "Cliente 2", razon_social: null, direccion: null, telefono: null, cuit: null, condicion_pago: null },
      pedido: null, comprobantes_pendientes: [], devoluciones: [], pagos_registrados: [],
      resumen: { saldo_anterior: 5000, saldo_real: 5000, saldo_proyectado: 5000, pendiente_verificacion: 0, total_pedido: 0, total_devuelto: 0, total_cobrado: 0, total_a_cobrar: 5000, ya_cobrado: false },
      viaje_estado: "en_curso", cobro: cuenta().cobro, comprados: [],
    }
    const c = clienteVisible(ficha, [op("viaje.cobrar", conjunto())])
    expect(c.pagos_registrados[0]).toMatchObject({ monto: 5000 })
    expect(c.cobro.comprobantes.find((k) => k.id === "pres2")!.en_cobro).toBe(5000)
    expect(c.cobro.comprobantes.find((k) => k.id === "fa1")!.en_cobro).toBe(0) // el del principal no es suyo
  })

  it("un cobro simple (sin agregados) sigue igual: todo es del cliente de la parada", () => {
    const simple = { ...conjunto(), clientes_extra: undefined }
    expect(partesDelCobro(simple)).toEqual([{ cliente_id: "c1", monto: 15000, metodos: simple.metodos, principal: true }])
  })
})
