import { describe, expect, it } from "vitest"
import type { ItemOutbox } from "../src/db/idb"
import { TEXTO_ENTREGA_BLOQUEADA } from "@gm/cobro"
import { estadoCuentaVacio, resumenCuenta, type DatosCuenta } from "../../../apps/chofer/src/datos/cuenta-cobro"
import { excedenteSistemaViejo, frena, primerExceso, textoExcedente, textoTope, topeDevolucion } from "../../../apps/chofer/src/datos/devolucion-tope"
import { transferenciasDelViaje, viajeVisible } from "../../../apps/chofer/src/datos/overlay"
import { avisosParadaReabierta, formatResta, nombreGasto } from "../../../apps/chofer/src/ui"
import type { ComprobanteCobro, OpCobrar, ParadaHoja, ViajeDetalle } from "../../../apps/chofer/src/datasets"

// App Chofer — pendientes de la prueba integral de salida (26/10/2026, docs/PENDIENTES-APPS-SALIDA.md):
// C1 bloqueo de entrega, C2 tope de devolución, C3 10 % contado con devoluciones, C5 sin "−$0,00",
// C6 transferencias aparte.

const V = "00000000-0000-4000-8000-000000009001"
let seq = 0
const op = (tipo: string, payload: unknown, estado: ItemOutbox["estado"] = "pendiente"): ItemOutbox => ({
  key: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, seq, tipo, payload, capturadoAt: "2026-10-26T12:00:00Z", estado, intentos: 0, proximoIntentoAt: 0, error: null, resultado: null, enviadoAt: null, usuarioId: "yo", etiqueta: null,
})
const parada = (extra: Partial<ParadaHoja> = {}): ParadaHoja => ({
  id: "p1", orden: 1, cliente_id: "c1", cliente_nombre: "FITTERER", direccion: "", localidad: "", telefono: "", vendedores: [],
  exigir_cobro_anterior: true, exigir_cobro_actual: false, bloquear_entrega: true, motivo_bloqueo: "DEBE MUCHO", nota_oficina: null,
  estado: "pendiente", bultos_entregados: null, motivo_no_entrega: null, motivo_no_cobro: null, resuelto_at: null,
  pedidos: [{ id: "ped1", numero: "001941", estado: "en_viaje", total: 50000, bultos: 3, vendedor: "", comprobantes: [], remitos: [] }],
  bultos: 3, total_viaje: 50000, saldo_anterior: 100000, total_a_cobrar: 150000, minimo_exigido: 100000, descuentos_cobro: 0,
  cobrado: 0, cobrado_anterior: 0, cobrado_viaje: 0, devuelto: 0, cobro_cumplido: false, entrega_bloqueada: true, pagos: [], ...extra,
})
const viaje = (p: ParadaHoja): ViajeDetalle => ({
  id: V,
  viaje: { id: V, nombre: "TEST", fecha: "2026-10-26", estado: "en_curso", zona_nombre: "BAHIA", es_titular: true, chofer_id: "yo" },
  paradas: [p],
  dinero: { fondo_entregado: 0, fondos: [], gastos: [], gastos_total: 0, cobrado_efectivo: 0, cobrado_cheques: 0, cheques_cantidad: 0, cobrado_transferencias: 0, efectivo_en_mano: 0, saldo_billetera_titular: 0 },
  tripulacion: [],
})
const cobro = (monto: number, extra: Partial<OpCobrar> = {}): OpCobrar => ({
  viaje_id: V, cliente_id: "c1", cliente_nombre: "FITTERER", monto_total: monto, metodos: [{ tipo: "efectivo", monto }], imputaciones: [], devolucion_ids: [], comprobante_urls: [],
  pedidos_contado: [], contado_general: false, ajuste_redondeo: 0, cobros_extra: [], fotos_pendientes: [], ...extra,
})

describe("C1 · bloqueo de entrega (#23)", () => {
  it("el texto es el de la regla del dueño (compartido con el servidor)", () => {
    expect(TEXTO_ENTREGA_BLOQUEADA).toBe("Si no salda lo solicitado, retirar el pedido")
  })

  it("sin cobro: sigue bloqueada y pendiente", () => {
    const v = viajeVisible(viaje(parada()), [])
    expect(v.paradas[0]).toMatchObject({ entrega_bloqueada: true, cobro_cumplido: false, estado: "pendiente" })
  })

  it("cobro sin señal que NO llega a lo exigido: el cobro entra, la parada NO se cierra y sigue bloqueada", () => {
    const v = viajeVisible(viaje(parada()), [op("viaje.cobrar", cobro(60000))])
    expect(v.paradas[0]!.cobrado).toBe(60000)
    expect(v.paradas[0]).toMatchObject({ estado: "pendiente", entrega_bloqueada: true, cobro_cumplido: false })
  })

  it("cobro sin señal que cubre lo exigido: se habilita la entrega (la confirma el chofer, P2-33)", () => {
    const v = viajeVisible(viaje(parada()), [op("viaje.cobrar", cobro(100000))])
    expect(v.paradas[0]).toMatchObject({ estado: "pendiente", entrega_bloqueada: false, cobro_cumplido: true })
  })

  it("el 10 % contado / ajuste del cobro también cubre lo exigido (#27)", () => {
    const v = viajeVisible(viaje(parada()), [op("viaje.cobrar", cobro(90000, { contado_general: true, descuento_estimado: 10000 }))])
    expect(v.paradas[0]).toMatchObject({ descuentos_cobro: 10000, cobro_cumplido: true, entrega_bloqueada: false })
  })

  it("una devolución sin señal baja lo exigido (viene neto de lo devuelto, #27)", () => {
    const items = [{ articulo_id: "a", sku: "1", descripcion: "Naftalina", cantidad: 1, precio_venta_original: 30000, motivo: "otro", condicion: "vendible" as const, origen: "pedido" as const }]
    const v = viajeVisible(viaje(parada()), [op("viaje.devolucion", { viaje_id: V, id: "d1", cliente_id: "c1", pedido_id: "ped1", items, valor_estimado: 30000 }), op("viaje.cobrar", cobro(70000))])
    expect(v.paradas[0]!.minimo_exigido).toBe(70000)
    expect(v.paradas[0]).toMatchObject({ cobro_cumplido: true, entrega_bloqueada: false })
  })

  it("sin bloqueo, el cobro parcial no cierra (P2-33) y nunca queda bloqueada", () => {
    const v = viajeVisible(viaje(parada({ bloquear_entrega: false, entrega_bloqueada: false })), [op("viaje.cobrar", cobro(1000))])
    expect(v.paradas[0]).toMatchObject({ estado: "pendiente", entrega_bloqueada: false })
  })

  it("réplica vieja (sin entrega_bloqueada ni descuentos): se deriva igual", () => {
    const vieja = parada()
    delete (vieja as any).entrega_bloqueada
    delete (vieja as any).descuentos_cobro
    expect(viajeVisible(viaje(vieja), [])).toMatchObject({ paradas: [{ entrega_bloqueada: true }] })
  })
})

describe("C2 · no devolver más de lo vendido (#25)", () => {
  const devolvible = [{ comprobante_venta_id: "pres22", articulo_id: "naft", vendido: 6, devuelto: 0 }]
  it("máximo = vendido − devuelto (servidor) − lo cargado en el equipo sin enviar", () => {
    expect(topeDevolucion(devolvible, { articulo_id: "naft", cantidad: 6, comprobante_venta_id: "pres22" })).toEqual({ vendido: 6, devuelto: 0, maximo: 6, presupuesto: false })
    const sinEnviar = [{ articulo_id: "naft", cantidad: 6, origen_comp: { comprobante_venta_id: "pres22" } }]
    const t = topeDevolucion(devolvible, { articulo_id: "naft", cantidad: 1, comprobante_venta_id: "pres22" }, sinEnviar)
    expect(t).toEqual({ vendido: 6, devuelto: 6, maximo: 0, presupuesto: false })
    expect(textoTope(t!, "NAFTALINA")).toBe("NAFTALINA: ya se devolvieron 6 de 6. No se puede devolver más.")
  })
  it("lo ya devuelto en el servidor (de cualquier app) cuenta", () => {
    const t = topeDevolucion([{ comprobante_venta_id: "pres22", articulo_id: "naft", vendido: 6, devuelto: 2 }], { articulo_id: "naft", cantidad: 1, comprobante_venta_id: "pres22" })
    expect(t!.maximo).toBe(4)
    expect(textoTope(t!)).toBe("se vendieron 6, ya se devolvieron 2: podés devolver hasta 4.")
  })
  it("primerExceso no deja registrar la segunda devolución de lo mismo", () => {
    const sinEnviar = [{ articulo_id: "naft", cantidad: 6, comprobante_venta_id: "pres22" }]
    expect(primerExceso(devolvible, [{ articulo_id: "naft", cantidad: 6, comprobante_venta_id: "pres22", descripcion: "NAFTALINA" }], sinEnviar)).toMatch(/ya se devolvieron 6 de 6/)
    expect(primerExceso(devolvible, [{ articulo_id: "naft", cantidad: 6, comprobante_venta_id: "pres22" }])).toBeNull()
  })
  it("sin datos del origen (réplica vieja, comprobante sin detalle): no se topea en el equipo (lo hace el servidor)", () => {
    expect(topeDevolucion(null, { articulo_id: "naft", cantidad: 99, comprobante_venta_id: "pres22" })).toBeNull()
    expect(topeDevolucion(devolvible, { articulo_id: "otro", cantidad: 99, comprobante_venta_id: "pres22" })).toBeNull()
    expect(topeDevolucion(devolvible, { articulo_id: "naft", cantidad: 99 })).toBeNull()
  })
})

describe("C3 · cobro contado con devoluciones (#26)", () => {
  const comp = (id: string, total: number, extra: Partial<ComprobanteCobro> = {}): ComprobanteCobro => ({
    id, tipo_comprobante: "PRES", numero_comprobante: "0001-00000022", fecha: "2026-10-25", total_neto: total, total_factura: total, saldo_pendiente: total, estado_pago: "pendiente", pedido_id: null, nc_contado: total * 0.1, ...extra,
  })
  const dev = (valor: number, compId: string, extra: Record<string, unknown> = {}) => ({
    id: `d${valor}`, monto_total: valor, valor_cobro: valor, aplica_10: false, estado: "pendiente",
    devoluciones_detalle: [{ cantidad: 1, precio_venta_original: valor, comprobante_venta_id: compId }], ...extra,
  })
  const cuenta = (comps: ComprobanteCobro[], devs: DatosCuenta["devoluciones"]): DatosCuenta => ({ cobro: { comprobantes: comps, pedidos: [], pedidos_facturados: [], dtos_hechos: [] }, devoluciones: devs })
  const contado = (sel: Record<string, number>) => ({ ...estadoCuentaVacio(), sel, contadoGeneral: true })

  it("PRES $100.000 con devolución de $10.000 cobrado contado → $81.000 = (100.000 − 10.000) × 0,9", () => {
    const r = resumenCuenta(cuenta([comp("pres", 100000)], [dev(10000, "pres")]), contado({ pres: 100000 }))
    expect(r.devTotal).toBe(10000)
    expect(r.bonificacionEstimada).toBe(9000)
    expect(r.totalCobro).toBe(81000)
  })

  it("el caso de CHEN: $154.329,05 con devoluciones por $47.005,44 → $96.591,25 (la app pedía $91.890,70)", () => {
    const r = resumenCuenta(cuenta([comp("pres", 154329.05, { nc_contado: 15432.91 })], [dev(23502.72, "pres"), dev(23502.72, "pres", { id: "d2" })]), contado({ pres: 154329.05 }))
    expect(r.totalCobro).toBeCloseTo(96591.25, 1)
  })

  it("una devolución que ya vino neta del 10 % (factura contado) no se vuelve a descontar", () => {
    const r = resumenCuenta(cuenta([comp("pres", 100000)], [dev(9000, "pres", { aplica_10: true })]), contado({ pres: 100000 }))
    expect(r.bonificacionEstimada).toBe(10000)
    expect(r.totalCobro).toBe(81000)
  })

  it("devolución MIXTA (un renglón ya neto del 10 %, otro no): se decide por renglón (revisión 27/10)", () => {
    const mixta = { id: "dm", monto_total: 19000, valor_cobro: 19000, aplica_10: false, estado: "pendiente", devoluciones_detalle: [
      { cantidad: 1, precio_venta_original: 9000, comprobante_venta_id: "pres", bonificado_contado: true },
      { cantidad: 1, precio_venta_original: 10000, comprobante_venta_id: "pres", bonificado_contado: false },
    ] }
    const r = resumenCuenta(cuenta([comp("pres", 100000)], [mixta]), contado({ pres: 100000 }))
    expect(r.devTotal).toBe(19000)
    // Solo el renglón sin contado baja la base del 10 %: 10 % de (100.000 − 10.000) = 9.000
    expect(r.bonificacionEstimada).toBe(9000)
    expect(r.totalCobro).toBe(72000)
  })

  it("una devolución contra OTRO comprobante (no cobrado contado) no toca el 10 %", () => {
    const r = resumenCuenta(cuenta([comp("pres", 100000)], [dev(10000, "otro")]), contado({ pres: 100000 }))
    expect(r.bonificacionEstimada).toBe(10000)
  })

  it("sin incluir devoluciones, o sin contado, como antes", () => {
    const d = cuenta([comp("pres", 100000)], [dev(10000, "pres")])
    expect(resumenCuenta(d, { ...contado({ pres: 100000 }), incluirDevoluciones: false }).totalCobro).toBe(90000)
    expect(resumenCuenta(d, { ...estadoCuentaVacio(), sel: { pres: 100000 } }).totalCobro).toBe(90000)
  })
})

describe("C5 / #43 · billetera", () => {
  it("nada de signos sobre cero (#3)", () => {
    expect(formatResta(0)).toBe(formatResta(-0))
    expect(formatResta(0)).not.toMatch(/−/)
    expect(formatResta(1500)).toMatch(/^−/)
  })
  it("el concepto \"camion\" que pone la oficina se lee bien", () => {
    expect(nombreGasto("camion")).toBe("Camión")
    expect(nombreGasto("nafta")).toBe("nafta")
  })
})

describe("C6 · transferencias aparte (#35)", () => {
  it("la parte digital (pago pendiente) figura 'a confirmar'; la confirmada, 'confirmada'; el efectivo no", () => {
    const pago = (id: string, estado: string, metodos: Array<{ tipo: string; monto: number }>) => ({ id, monto: metodos.reduce((s, m) => s + m.monto, 0), estado, fecha: "", cargado_por: "", metodos: metodos.map((m) => ({ ...m, detalle: "" })), imputaciones: [], a_cuenta: 0, contado_10: false, ajuste: 0 })
    const v = viajeVisible(viaje(parada({ bloquear_entrega: false, pagos: [pago("f", "pendiente_rendicion", [{ tipo: "efectivo", monto: 1000 }]), pago("t1", "pendiente", [{ tipo: "transferencia", monto: 5000 }]), pago("t2", "confirmado", [{ tipo: "transferencia", monto: 7000 }])] })), [
      op("viaje.cobrar", cobro(3000, { metodos: [{ tipo: "transferencia", monto: 3000 }] })),
    ])
    expect(transferenciasDelViaje(v).map((t) => [t.monto, t.estado])).toEqual([[5000, "a_confirmar"], [7000, "confirmada"], [3000, "sin_enviar"]])
    // Sin señal, la transferencia no suma a la plata en mano
    expect(v.dinero!.efectivo_en_mano).toBe(0)
  })
})

describe("C7 · anular el cobro de una parada bloqueada la reabre (R4)", () => {
  const pagoSrv = (id: string, monto: number) => ({ id, monto, estado: "pendiente_rendicion", fecha: "", cargado_por: "", metodos: [{ tipo: "efectivo", monto, detalle: "" }], imputaciones: [], a_cuenta: 0, contado_10: false, ajuste: 0 })
  const cerrada = (extra: Partial<ParadaHoja> = {}) => parada({ estado: "entregado", cobrado: 100000, cobro_cumplido: true, entrega_bloqueada: false, pagos: [pagoSrv("pg1", 100000)], ...extra })
  const anular = (pago_id = "pg1") => op("viaje.cobro_anular", { viaje_id: V, pago_id, cliente_id: "c1" })

  it("sin señal: la parada entregada vuelve a pendiente y queda bloqueada otra vez", () => {
    const v = viajeVisible(viaje(cerrada()), [anular()])
    expect(v.paradas[0]).toMatchObject({ estado: "pendiente", cobrado: 0, entrega_bloqueada: true, cobro_cumplido: false, reabiertaPorAnulacion: true })
  })
  it("si queda otro cobro que cubre lo exigido, no se toca", () => {
    const v = viajeVisible(viaje(cerrada({ cobrado: 200000, pagos: [pagoSrv("pg1", 100000), pagoSrv("pg2", 100000)] })), [anular()])
    expect(v.paradas[0]).toMatchObject({ estado: "entregado", entrega_bloqueada: false })
  })
  it("sin bloqueo, anular no reabre (regla del 29/09)", () => {
    const v = viajeVisible(viaje(cerrada({ bloquear_entrega: false })), [anular()])
    expect(v.paradas[0]!.estado).toBe("entregado")
  })
  it("un resultado de parada posterior a la anulación manda", () => {
    const v = viajeVisible(viaje(cerrada()), [anular(), op("viaje.parada", { viaje_id: V, parada_id: "p1", cliente_id: "c1", estado: "no_entregado", motivo_no_entrega: "No pagó", motivo_no_cobro: "No pagó" })])
    expect(v.paradas[0]!.estado).toBe("no_entregado")
  })
  it("viaje terminado: el equipo no la reabre (el servidor frena con 422)", () => {
    const d = viaje(cerrada())
    d.viaje.estado = "en_rendicion"
    expect(viajeVisible(d, [anular()]).paradas[0]!.estado).toBe("entregado")
  })
  it("el aviso del servidor (parada_reabierta + mensaje) se muestra hasta marcarlo visto", () => {
    const it1 = { ...anular(), estado: "enviado" as const, resultado: { parada_reabierta: true, mensaje: "volvió a pendiente" } }
    const it2 = { ...anular(), estado: "enviado" as const, resultado: {} }
    expect(avisosParadaReabierta([it1, it2], []).map((a) => a.mensaje)).toEqual(["volvió a pendiente"])
    expect(avisosParadaReabierta([it1], [it1.key])).toEqual([])
  })
})

describe("C8 · presupuesto: lo devuelto de más va como sistema viejo (Juan 27/10)", () => {
  const pres = [{ comprobante_venta_id: "pres22", articulo_id: "naft", vendido: 6, devuelto: 0, presupuesto: true }]
  const fa = [{ comprobante_venta_id: "fa1", articulo_id: "naft", vendido: 6, devuelto: 0, presupuesto: false }]
  it("en presupuesto no frena: primerExceso no corta y el excedente se informa", () => {
    const t = topeDevolucion(pres, { articulo_id: "naft", cantidad: 10, comprobante_venta_id: "pres22" })
    expect(t).toMatchObject({ maximo: 6, presupuesto: true })
    expect(frena(t)).toBe(false)
    expect(primerExceso(pres, [{ articulo_id: "naft", cantidad: 10, comprobante_venta_id: "pres22" }])).toBeNull()
    expect(excedenteSistemaViejo(t, 10)).toBe(4)
    expect(excedenteSistemaViejo(t, 5)).toBe(0)
    expect(textoExcedente(4)).toBe("Lo que pasa de lo comprado (4) va como sistema viejo: lo revisa la oficina.")
  })
  it("ya devuelto todo en presupuesto: igual deja cargar (todo va al respaldo)", () => {
    const sinEnviar = [{ articulo_id: "naft", cantidad: 6, comprobante_venta_id: "pres22" }]
    const t = topeDevolucion(pres, { articulo_id: "naft", cantidad: 2, comprobante_venta_id: "pres22" }, sinEnviar)
    expect(t!.maximo).toBe(0)
    expect(frena(t)).toBe(false)
    expect(excedenteSistemaViejo(t, 2)).toBe(2)
  })
  it("en factura el tope sigue igual", () => {
    const t = topeDevolucion(fa, { articulo_id: "naft", cantidad: 10, comprobante_venta_id: "fa1" })
    expect(frena(t)).toBe(true)
    expect(excedenteSistemaViejo(t, 10)).toBe(0)
    expect(primerExceso(fa, [{ articulo_id: "naft", cantidad: 10, comprobante_venta_id: "fa1", descripcion: "NAFTALINA" }])).toMatch(/podés devolver hasta 6/)
  })
  it("réplica vieja sin el dato: decide el origen (fiscal false = presupuesto; el respaldo no cuenta)", () => {
    const viejo = [{ comprobante_venta_id: "pres22", articulo_id: "naft", vendido: 6, devuelto: 0 }]
    expect(topeDevolucion(viejo, { articulo_id: "naft", cantidad: 1, origen_comp: { comprobante_venta_id: "pres22", fiscal: false, numero_comprobante: "0001-00000022" } })!.presupuesto).toBe(true)
    expect(topeDevolucion(viejo, { articulo_id: "naft", cantidad: 1, origen_comp: { comprobante_venta_id: "pres22", fiscal: true } })!.presupuesto).toBe(false)
    expect(topeDevolucion(viejo, { articulo_id: "naft", cantidad: 1, origen_comp: { comprobante_venta_id: "pres22", fiscal: false, numero_comprobante: "0002-00000001" } })!.presupuesto).toBe(false)
  })
})
