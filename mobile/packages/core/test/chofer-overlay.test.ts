import { describe, expect, it } from "vitest"
import type { ItemOutbox } from "../src/db/idb"
import { billeteraVisible, clienteDesdeParada, clienteVisible, estadoDescarga, paradasSinResolver, viajeVisible } from "../../../apps/chofer/src/datos/overlay"
import { buscarArticulos, buscarClientes } from "../../../apps/chofer/src/datos/hooks"
import type { BilleteraData, ClienteViajeRow, OpCobrar, ParadaHoja, ViajeDetalle } from "../../../apps/chofer/src/datasets"

// App Chofer: reglas PURAS que hacen que lo que ve el chofer sin señal sea fiel a lo que
// va a quedar en el servidor. Es PLATA: cada cobro, anulación, devolución y gasto hecho
// sin señal tiene que verse al instante en la parada, la ficha, la plata del viaje y la
// billetera, y una operación rechazada NO puede contar.

let seq = 0
const op = (tipo: string, payload: unknown, estado: ItemOutbox["estado"] = "pendiente"): ItemOutbox => ({
  key: `k${++seq}`, seq, tipo, payload, capturadoAt: "2026-09-23T12:00:00Z", estado, intentos: 0, proximoIntentoAt: 0,
  error: estado === "rechazado" ? "el comprobante está anulado — no se puede cobrar" : null, resultado: null, enviadoAt: null, usuarioId: "yo", etiqueta: null,
})

const V = "00000000-0000-4000-8000-000000005001"
const C1 = "c1", C2 = "c2"
const parada = (n: number, cliente_id: string, extra: Partial<ParadaHoja> = {}): ParadaHoja => ({
  id: `p${n}`, orden: n, cliente_id, cliente_nombre: `Cliente ${n}`, direccion: "Belgrano 1", localidad: "Necochea", telefono: "", vendedores: [],
  exigir_cobro_anterior: false, exigir_cobro_actual: false, bloquear_entrega: false, motivo_bloqueo: null, nota_oficina: null,
  estado: "pendiente", bultos_entregados: null, motivo_no_entrega: null, motivo_no_cobro: null, resuelto_at: null,
  pedidos: [{ id: `ped${n}`, numero: "000100", estado: "en_viaje", total: 10000, bultos: 3, vendedor: "", comprobantes: [], remitos: [] }],
  bultos: 3, total_viaje: 10000, saldo_anterior: 2000, total_a_cobrar: 12000, minimo_exigido: 0, cobrado: 0, cobrado_anterior: 0, cobrado_viaje: 0, devuelto: 0, cobro_cumplido: true,
  pagos: [], ...extra,
})
const viaje = (extra: Partial<ViajeDetalle["viaje"]> = {}, paradas = [parada(1, C1), parada(2, C2, { minimo_exigido: 5000, exigir_cobro_actual: true, cobro_cumplido: false })]): ViajeDetalle => ({
  id: V,
  viaje: { id: V, nombre: "Reparto", fecha: "2026-09-23", estado: "en_curso", zona_nombre: "NECOCHEA", es_titular: true, chofer_id: "yo", ...extra },
  paradas,
  dinero: { fondo_entregado: 50000, fondos: [], gastos: [], gastos_total: 0, cobrado_efectivo: 0, cobrado_cheques: 0, cheques_cantidad: 0, cobrado_transferencias: 0, efectivo_en_mano: 50000, saldo_billetera_titular: 0 },
  tripulacion: [],
})
const cobro = (cliente_id: string, monto: number, extra: Partial<OpCobrar> = {}): OpCobrar => ({
  viaje_id: V, cliente_id, cliente_nombre: "Cliente", monto_total: monto, metodos: [{ tipo: "efectivo", monto }], imputaciones: [], devolucion_ids: [], comprobante_urls: [],
  pedidos_contado: [], contado_general: false, ajuste_redondeo: 0, cobros_extra: [], fotos_pendientes: [], ...extra,
})

describe("Chofer · overlay del viaje (hoja de ruta)", () => {
  it("un cobro sin señal se ve en la parada (cobrado, pago 'sin enviar') y en la plata del viaje", () => {
    const v = viajeVisible(viaje(), [op("viaje.cobrar", cobro(C1, 7000, { metodos: [{ tipo: "efectivo", monto: 4000 }, { tipo: "cheque", monto: 3000, banco_emisor: "Macro", numero_cheque: "1" }] }))])
    const p1 = v.paradas[0]!
    expect(p1.cobrado).toBe(7000)
    expect(p1.pagos).toHaveLength(1)
    expect(p1.pagos[0]!.local?.estado).toBe("pendiente")
    expect(p1.pagos[0]!.metodos.map((m) => m.tipo)).toEqual(["efectivo", "cheque"])
    expect(v.dinero!.cobrado_efectivo).toBe(4000)
    expect(v.dinero!.cobrado_cheques).toBe(3000)
    expect(v.dinero!.cheques_cantidad).toBe(1)
    expect(v.dinero!.efectivo_en_mano).toBe(54000)
    expect(v.sinEnviar.cobros).toBe(1)
  })

  it("un cobro RECHAZADO por el servidor no cuenta (se muestra aparte)", () => {
    const v = viajeVisible(viaje(), [op("viaje.cobrar", cobro(C1, 7000), "rechazado")])
    expect(v.paradas[0]!.cobrado).toBe(0)
    expect(v.dinero!.efectivo_en_mano).toBe(50000)
    expect(v.sinEnviar.cobros).toBe(0)
  })

  it("'cobrar sí o sí' se recalcula con lo cobrado sin señal, y un cliente extra del cobro conjunto suma en su parada", () => {
    const v = viajeVisible(viaje(), [op("viaje.cobrar", cobro(C1, 1000, { cobros_extra: [{ cliente_id: C2, metodos: [{ tipo: "efectivo", monto: 5000 }], imputaciones: [] }] }))])
    expect(v.paradas[1]!.cobrado).toBe(5000)
    expect(v.paradas[1]!.cobro_cumplido).toBe(true)
    expect(v.dinero!.cobrado_efectivo).toBe(6000)
  })

  it("anular un cobro del servidor sin señal lo saca de la parada y de la plata", () => {
    const base = viaje({}, [parada(1, C1, { cobrado: 3000, pagos: [{ id: "pago-srv", monto: 3000, estado: "pendiente_rendicion", fecha: "2026-09-23", cargado_por: "", metodos: [{ tipo: "efectivo", monto: 3000, detalle: "" }], imputaciones: [], a_cuenta: 0, contado_10: false, ajuste: 0 }] })])
    base.dinero!.cobrado_efectivo = 3000
    base.dinero!.efectivo_en_mano = 53000
    const v = viajeVisible(base, [op("viaje.cobro_anular", { viaje_id: V, pago_id: "pago-srv", cliente_id: C1 })])
    expect(v.paradas[0]!.cobrado).toBe(0)
    expect(v.paradas[0]!.pagos).toHaveLength(0)
    expect(v.dinero!.efectivo_en_mano).toBe(50000)
    expect(v.sinEnviar.anulaciones).toBe(1)
  })

  it("devolución, gasto y resultado de parada sin señal", () => {
    const v = viajeVisible(viaje(), [
      op("viaje.devolucion", { viaje_id: V, id: "d1", cliente_id: C1, pedido_id: "ped1", items: [{ articulo_id: "a", sku: null, descripcion: "x", cantidad: 2, precio_venta_original: 250, motivo: "otro", condicion: "vendible", origen: "pedido" }] }),
      op("viaje.gasto", { viaje_id: V, categoria: "nafta", monto: 12000, observaciones: null, foto_url: null }),
      op("viaje.parada", { viaje_id: V, parada_id: "p1", cliente_id: C1, estado: "entregado_parcial", bultos_entregados: 99, motivo_no_entrega: "cerrado" }),
    ])
    expect(v.paradas[0]!.devuelto).toBe(500)
    expect(v.paradas[0]!.estado).toBe("entregado_parcial")
    expect(v.paradas[0]!.bultos_entregados).toBe(3) // tope: los bultos de la parada (= servidor)
    expect(v.paradas[0]!.resultadoSinEnviar).toBe(true)
    expect(v.dinero!.gastos_total).toBe(12000)
    expect(v.dinero!.efectivo_en_mano).toBe(38000)
    expect(v.dinero!.gastos[0]!.id).toBe("local:" + v.dinero!.gastos[0]!.id.slice(6))
    expect(paradasSinResolver(v).map((p) => p.id)).toEqual(["p2"])
  })

  it("reabrir una parada (estado pendiente) y el último resultado manda", () => {
    const v = viajeVisible(viaje(), [
      op("viaje.parada", { viaje_id: V, parada_id: "p1", cliente_id: C1, estado: "entregado" }),
      op("viaje.parada", { viaje_id: V, parada_id: "p1", cliente_id: C1, estado: "pendiente" }),
    ])
    expect(v.paradas[0]!.estado).toBe("pendiente")
    expect(v.paradas[0]!.bultos_entregados).toBeNull()
  })

  it("iniciar y finalizar sin señal cambian el estado visible; el cierre queda marcado 'pendiente'", () => {
    const ini = viajeVisible(viaje({ estado: "despachado" }), [op("viaje.iniciar", { viaje_id: V })])
    expect(ini.viaje.estado).toBe("en_curso")
    expect(ini.inicioPendiente).toBe(true)
    const fin = viajeVisible(viaje(), [op("viaje.finalizar", { viaje_id: V, efectivo_declarado: 1 })])
    expect(fin.viaje.estado).toBe("en_rendicion")
    expect(fin.cierrePendiente).toBe(true)
    // Otro viaje: no lo toca
    expect(viajeVisible(viaje(), [op("viaje.finalizar", { viaje_id: "otro", efectivo_declarado: 1 })]).viaje.estado).toBe("en_curso")
  })
})

const ficha = (extra: Partial<ClienteViajeRow> = {}): ClienteViajeRow => ({
  id: `${V}:${C1}`, viaje_id: V, cliente_id: C1,
  cliente: { nombre: "Cliente 1", razon_social: null, direccion: null, telefono: null, cuit: null, condicion_pago: null },
  pedido: { id: "ped1", numero: "000100", fecha: "2026-09-23", estado: "en_viaje", total: 10000, bultos: 3, observaciones: null, detalle: [] },
  comprobantes_pendientes: [], devoluciones: [], pagos_registrados: [],
  resumen: { saldo_anterior: 2000, saldo_real: 2000, saldo_proyectado: 2000, pendiente_verificacion: 0, total_pedido: 10000, total_devuelto: 0, total_cobrado: 0, total_a_cobrar: 12000, ya_cobrado: false },
  viaje_estado: "en_curso",
  cobro: {
    comprobantes: [{ id: "fa1", tipo_comprobante: "FA", numero_comprobante: "0003-1", fecha: "2026-09-23", total_neto: 8264, total_factura: 10000, saldo_pendiente: 10000, estado_pago: "pendiente", pedido_id: "ped1" }],
    pedidos: [{ id: "ped1", numero_pedido: "000100", fecha: "2026-09-23", total: 10000, estado: "en_viaje" }, { id: "ped2", numero_pedido: "000101", fecha: "2026-09-23", total: 3000, estado: "pendiente" }],
    pedidos_facturados: ["ped1"], dtos_hechos: [],
  },
  comprados: [], ...extra,
})

describe("Chofer · overlay de la ficha del cliente", () => {
  it("lo imputado sin señal queda RESERVADO (no se cobra dos veces), el anticipo marca el pedido y la devolución descontada deja de estar pendiente", () => {
    const c = clienteVisible(ficha({ devoluciones: [{ id: "d1", numero_devolucion: "DEV-1", monto_total: 500, estado: "pendiente" }] }), [
      op("viaje.cobrar", cobro(C1, 9500, { imputaciones: [{ comprobante_id: "fa1", monto_imputado: 10000 }], pedidos_contado: ["ped2"], devolucion_ids: ["d1"] })),
    ])
    expect(c.cobro.comprobantes[0]!.en_cobro).toBe(10000)
    expect(c.cobro.pedidos[1]!.pago_contado_10).toBe(true)
    expect(c.cobro.pedidos[1]!.anticipo_pago_id).toMatch(/^local:/)
    expect(c.devoluciones[0]!.estado).toBe("descontada_sin_enviar")
    expect(c.pagos_registrados[0]!.local?.estado).toBe("pendiente")
    expect(c.resumen.total_cobrado).toBe(9500)
    expect(c.resumen.ya_cobrado).toBe(true)
  })

  it("devolución sin enviar aparece con su detalle y baja lo a cobrar; la del cobro conjunto como extra también suma", () => {
    const c = clienteVisible(ficha(), [
      op("viaje.devolucion", { viaje_id: V, id: "d-local", cliente_id: C1, pedido_id: "ped1", items: [{ articulo_id: "a", sku: "1", descripcion: "Shampoo", cantidad: 2, precio_venta_original: 250, motivo: "rotura", condicion: "no_vendible", origen: "pedido" }] }),
      op("viaje.cobrar", cobro(C2, 100, { cobros_extra: [{ cliente_id: C1, metodos: [{ tipo: "efectivo", monto: 700 }], imputaciones: [] }] })),
    ])
    expect(c.devoluciones[0]).toMatchObject({ id: "d-local", local: true, monto_total: 500, estado: "pendiente" })
    expect(c.devoluciones[0]!.devoluciones_detalle![0]!.articulos!.descripcion).toBe("Shampoo")
    expect(c.resumen.total_a_cobrar).toBe(11500)
    expect(c.resumen.total_cobrado).toBe(700)
  })

  it("anular sin señal un cobro del servidor lo saca de los cobros registrados", () => {
    const c = clienteVisible(ficha({ pagos_registrados: [{ id: "pago-srv", monto: 3000, estado: "pendiente_rendicion", created_at: "2026-09-23" }], resumen: { ...ficha().resumen, total_cobrado: 3000, ya_cobrado: true } }), [
      op("viaje.cobro_anular", { viaje_id: V, pago_id: "pago-srv", cliente_id: C1 }),
    ])
    expect(c.pagos_registrados).toHaveLength(0)
    expect(c.resumen.total_cobrado).toBe(0)
    expect(c.resumen.ya_cobrado).toBe(false)
  })

  it("ficha parcial desde la hoja de ruta (cliente todavía no descargado): lo cobrado ya viene de la parada", () => {
    const p = parada(1, C1, { cobrado: 1500, pagos: [{ id: "x", monto: 1500, estado: "pendiente_rendicion", fecha: "2026-09-23", cargado_por: "", metodos: [], imputaciones: [], a_cuenta: 0, contado_10: false, ajuste: 0 }] })
    const c = clienteDesdeParada(V, p, "en_curso")
    expect(c.id).toBe(`${V}:${C1}`)
    expect(c.resumen.total_cobrado).toBe(1500)
    expect(c.pagos_registrados).toHaveLength(1)
    expect(c.cobro.comprobantes).toEqual([])
  })
})

describe("Chofer · billetera y descarga", () => {
  const bill = (): BilleteraData => ({
    id: "billetera", efectivo: 20000, desglose: { cobros_efectivo: 20000, fondo_viaje: 0, gastos: 0, cheques_monto: 0, transferencias: 0, en_rendicion: 0 }, cheques_cantidad: 0, saldo_cuenta_corriente: 0,
    cobros: [{ id: "pago-srv", fecha: "2026-09-23", cliente: "Cliente 1", viaje: "Reparto", monto: 20000, metodos: ["Efectivo"], estado: "en_mano" }], gastos: [], fondos: [],
  })

  it("cobros y gastos sin enviar mueven el efectivo en mano; los rechazados se listan sin sumar", () => {
    const b = billeteraVisible(bill(), [
      op("viaje.cobrar", cobro(C1, 5000, { cliente_nombre: "Cliente 1", metodos: [{ tipo: "efectivo", monto: 2000 }, { tipo: "cheque", monto: 3000 }] })),
      op("viaje.cobrar", cobro(C2, 999, { cliente_nombre: "Cliente 2" }), "rechazado"),
      op("viaje.gasto", { viaje_id: V, viaje_nombre: "Reparto", categoria: "peaje", monto: 800, observaciones: null, foto_url: null }),
    ])
    expect(b.efectivo).toBe(21200)
    expect(b.desglose.cheques_monto).toBe(3000)
    expect(b.cheques_cantidad).toBe(1)
    expect(b.cobros.map((c) => c.estado)).toEqual(["rechazado", "sin_enviar", "en_mano"])
    expect(b.cobros[0]!.error).toMatch(/anulado/)
    expect(b.gastos[0]).toMatchObject({ categoria: "peaje", monto: 800, local: true, viaje: "Reparto" })
  })

  it("anular sin señal un cobro en mano (todo efectivo) lo saca y descuenta", () => {
    const b = billeteraVisible(bill(), [op("viaje.cobro_anular", { viaje_id: V, pago_id: "pago-srv", cliente_id: C1 })])
    expect(b.cobros).toHaveLength(0)
    expect(b.efectivo).toBe(0)
  })

  it("estado de descarga: completa solo cuando están las fichas de TODAS las paradas", () => {
    const v = viaje()
    expect(estadoDescarga(v, new Set([`${V}:${C1}`]))).toEqual({ completa: false, total: 2, descargados: 1, faltan: ["Cliente 2"] })
    expect(estadoDescarga(v, new Set([`${V}:${C1}`, `${V}:${C2}`])).completa).toBe(true)
    expect(estadoDescarga(null, new Set()).completa).toBe(false)
  })

  it("búsqueda local de clientes (cobro conjunto) y artículos (devolución): todas las palabras, sin acentos, código exacto primero", () => {
    const clientes = [
      { id: "1", nombre: "Almacén Don José", razon_social: null, nombre_razon_social: null, cuit: "30-1-1", codigo_cliente: "C1", direccion: null, localidad: "Necochea", saldo_actual: 0 },
      { id: "2", nombre: "Kiosco La Esquina", razon_social: "Pérez SRL", nombre_razon_social: null, cuit: "30-2-2", codigo_cliente: "C2", direccion: null, localidad: "Quequén", saldo_actual: 100 },
    ]
    expect(buscarClientes(clientes, "jose almacen").map((c) => c.id)).toEqual(["1"])
    expect(buscarClientes(clientes, "perez").map((c) => c.id)).toEqual(["2"])
    expect(buscarClientes(clientes, "")).toEqual([])
    const arts = [
      { id: "a", sku: "1001", ean13: ["7790000000001"], descripcion: "Shampoo Kenvue 400ml", imagen_url: null, unidades_por_bulto: 12 },
      { id: "b", sku: "1002", ean13: null, descripcion: "Jabón líquido avena", imagen_url: null, unidades_por_bulto: 12 },
    ]
    expect(buscarArticulos(arts, "7790000000001").map((a) => a.id)).toEqual(["a"])
    expect(buscarArticulos(arts, "liquido jabon").map((a) => a.id)).toEqual(["b"])
  })
})
