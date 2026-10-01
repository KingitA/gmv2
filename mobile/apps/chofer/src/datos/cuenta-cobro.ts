// La CUENTA de un cliente dentro de un cobro: qué se le cobra (comprobantes, anticipos a pedidos
// sin facturar), con qué descuentos (10 % contado, devoluciones como crédito) y cuánto suma.
// Funciones PURAS (tests en packages/core/test/chofer-cuenta-cobro.test.ts): la misma lógica
// sirve para el cliente de la parada y para cada cliente AGREGADO a un cobro conjunto.

import { anticiposDeSeleccion, PEDIDO_PREFIX, pedidosContadoAEnviar, pedidosContadoAlAplicarTodo } from "@gm/cobro"
import type { ComprobanteCobro, CuentaCobro, PedidoCobro } from "../datasets"

const r2 = (n: number) => Math.round(n * 100) / 100
const TIPOS_BONIFICABLES = ["FA", "FB", "FC", "PRES"]

/** Lo que el chofer eligió para UN cliente. Serializable (se guarda tal cual en el estado de la pantalla). */
export interface EstadoCuenta {
  /** { comprobante_id | "pedido:<id>": monto } */
  sel: Record<string, number>
  /** Pedidos sin facturar con el check de 10 % */
  contadoPedidos: string[]
  contadoGeneral: boolean
  incluirDevoluciones: boolean
  /** Plata que se le toma a cuenta, sin imputar (solo clientes agregados) */
  aCuenta: number
}
export const estadoCuentaVacio = (): EstadoCuenta => ({ sel: {}, contadoPedidos: [], contadoGeneral: false, incluirDevoluciones: true, aCuenta: 0 })

/** Los datos de la réplica que hacen falta para cobrarle a un cliente. */
export interface DatosCuenta {
  cobro: CuentaCobro
  devoluciones: Array<{ id: string; monto_total: number; estado: string; local?: boolean }>
}

/** Saldo cobrable HOY: el del comprobante menos lo que ya está en un cobro hecho acá sin enviar. */
export const saldoCobrable = (cp: ComprobanteCobro) => Math.max(0, r2(cp.saldo_pendiente - (cp.en_cobro || 0)))
export const montoAnticipo = (p: PedidoCobro, contado: boolean) => (contado ? r2(p.total * 0.9) : p.total)

/** Agrupa los comprobantes por pedido (= ComprobantesSelector de la web). */
export function agruparCuenta(cobro: CuentaCobro) {
  const vivos = new Set(cobro.pedidos.map((p) => p.id))
  const compsPorPedido = new Map<string, ComprobanteCobro[]>()
  const sinPedido: ComprobanteCobro[] = []
  for (const c of cobro.comprobantes) {
    if (c.pedido_id && vivos.has(c.pedido_id)) {
      if (!compsPorPedido.has(c.pedido_id)) compsPorPedido.set(c.pedido_id, [])
      compsPorPedido.get(c.pedido_id)!.push(c)
    } else sinPedido.push(c)
  }
  const facturados = new Set(cobro.pedidos_facturados)
  const pedidosSinFacturar = cobro.pedidos.filter((p) => !compsPorPedido.has(p.id) && !facturados.has(p.id))
  const esSaldado = (p: PedidoCobro) => facturados.has(p.id) && !compsPorPedido.has(p.id)
  return { compsPorPedido, sinPedido, pedidosSinFacturar, esSaldado }
}

export interface ResumenCuenta {
  totalImputado: number
  bonificacionEstimada: number
  devTotal: number
  /** Lo que hay que entregar por este cliente: seleccionado − devoluciones − 10 % + a cuenta */
  totalCobro: number
  haySeleccion: boolean
  // Lo que viaja al servidor
  imputaciones: Array<{ comprobante_id: string; monto_imputado: number }>
  devolucion_ids: string[]
  pedidos_contado: string[]
  pedidos_anticipo: Array<{ pedido_id: string; monto: number }>
  contado_general: boolean
}

export function resumenCuenta(datos: DatosCuenta | null | undefined, e: EstadoCuenta): ResumenCuenta {
  const comprobantes = datos?.cobro.comprobantes ?? []
  const dtosHechos = new Set(datos?.cobro.dtos_hechos ?? [])
  const devPendientes = (datos?.devoluciones ?? []).filter((d) => d.estado === "pendiente")
  let bonificacion = 0
  if (e.contadoGeneral) {
    for (const cp of comprobantes) {
      const imp = e.sel[cp.id]
      if (imp === undefined || dtosHechos.has(cp.id)) continue
      if (!TIPOS_BONIFICABLES.includes(String(cp.tipo_comprobante || "").toUpperCase())) continue
      if (Math.abs(imp - cp.saldo_pendiente) < 0.01) bonificacion += cp.total_factura * 0.1
    }
  }
  bonificacion = r2(bonificacion)
  const totalImputado = r2(Object.values(e.sel).reduce((s, v) => s + v, 0))
  const devTotal = e.incluirDevoluciones ? r2(devPendientes.reduce((s, d) => s + Number(d.monto_total), 0)) : 0
  const aCuenta = Math.max(0, r2(Number(e.aCuenta) || 0))
  return {
    totalImputado,
    bonificacionEstimada: bonificacion,
    devTotal,
    totalCobro: r2(Math.max(0, r2(totalImputado - devTotal - bonificacion)) + aCuenta),
    haySeleccion: Object.keys(e.sel).length > 0,
    // Imputaciones = solo comprobantes reales. "pedido:<id>" son anticipos → quedan a cuenta.
    imputaciones: Object.entries(e.sel).filter(([k, monto]) => monto > 0 && !k.startsWith(PEDIDO_PREFIX)).map(([comprobante_id, monto_imputado]) => ({ comprobante_id, monto_imputado })),
    devolucion_ids: e.incluirDevoluciones ? devPendientes.map((d) => d.id) : [],
    // 10 % sobre pedidos sin facturar: solo los SELECCIONADOS (el servidor marca solo esos)
    pedidos_contado: pedidosContadoAEnviar(e.contadoPedidos, e.sel),
    pedidos_anticipo: anticiposDeSeleccion(e.sel),
    contado_general: e.contadoGeneral && bonificacion > 0,
  }
}

// ─── Cambios de selección (devuelven un estado nuevo) ────────────────────────

const conSel = (e: EstadoCuenta, key: string, monto: number | null): EstadoCuenta => {
  const sel = { ...e.sel }
  if (monto === null) delete sel[key]
  else sel[key] = monto
  return { ...e, sel }
}

export const fijarMonto = (e: EstadoCuenta, cp: ComprobanteCobro, monto: number): EstadoCuenta => conSel(e, cp.id, Math.min(Math.max(0, monto || 0), saldoCobrable(cp)))

export const alternarComprobante = (e: EstadoCuenta, cp: ComprobanteCobro): EstadoCuenta => conSel(e, cp.id, e.sel[cp.id] !== undefined ? null : saldoCobrable(cp))

export function alternarGrupo(e: EstadoCuenta, comps: ComprobanteCobro[]): EstadoCuenta {
  const todos = comps.every((c) => e.sel[c.id] !== undefined)
  const sel = { ...e.sel }
  for (const c of comps) {
    if (todos) delete sel[c.id]
    else if (saldoCobrable(c) > 0.005) sel[c.id] = saldoCobrable(c)
  }
  return { ...e, sel }
}

/** El 10 % es SOLO de lo seleccionado: con "10% contado a todo" activo, el pedido que se selecciona lo recibe; el que se deselecciona lo pierde. */
export function alternarAnticipo(e: EstadoCuenta, p: PedidoCobro): EstadoCuenta {
  const estaba = e.sel[PEDIDO_PREFIX + p.id] !== undefined
  const tenia = e.contadoPedidos.includes(p.id)
  const conContado = !estaba && (e.contadoGeneral ? true : tenia)
  const contadoPedidos = conContado === tenia ? e.contadoPedidos : conContado ? [...e.contadoPedidos, p.id] : e.contadoPedidos.filter((x) => x !== p.id)
  return conSel({ ...e, contadoPedidos }, PEDIDO_PREFIX + p.id, estaba ? null : montoAnticipo(p, conContado))
}

export function alternarContadoPedido(e: EstadoCuenta, p: PedidoCobro): EstadoCuenta {
  const tenia = e.contadoPedidos.includes(p.id)
  const out = { ...e, contadoPedidos: tenia ? e.contadoPedidos.filter((x) => x !== p.id) : [...e.contadoPedidos, p.id] }
  return e.sel[PEDIDO_PREFIX + p.id] !== undefined ? conSel(out, PEDIDO_PREFIX + p.id, montoAnticipo(p, !tenia)) : out
}

export function clavesDeLaCuenta(cobro: CuentaCobro): string[] {
  return [...cobro.comprobantes.map((c) => c.id), ...agruparCuenta(cobro).pedidosSinFacturar.map((p) => PEDIDO_PREFIX + p.id)]
}

export function alternarTodo(e: EstadoCuenta, cobro: CuentaCobro): EstadoCuenta {
  const claves = clavesDeLaCuenta(cobro)
  const todo = claves.length > 0 && claves.every((k) => e.sel[k] !== undefined)
  if (todo) return { ...e, sel: {}, contadoPedidos: [] }
  const { pedidosSinFacturar } = agruparCuenta(cobro)
  // Con "10% contado a todo" activo, todo lo que se selecciona lo recibe
  const contadoPedidos = e.contadoGeneral ? pedidosSinFacturar.map((p) => p.id) : e.contadoPedidos
  const sel = { ...e.sel }
  for (const c of cobro.comprobantes) sel[c.id] = saldoCobrable(c)
  for (const p of pedidosSinFacturar) sel[PEDIDO_PREFIX + p.id] = montoAnticipo(p, contadoPedidos.includes(p.id))
  return { ...e, sel, contadoPedidos }
}

export function alternarContadoTodo(e: EstadoCuenta, cobro: CuentaCobro): EstadoCuenta {
  const activar = !e.contadoGeneral
  const { pedidosSinFacturar } = agruparCuenta(cobro)
  // Solo a los pedidos SELECCIONADOS para cobrar — nunca a toda la lista (@gm/cobro)
  const contadoPedidos = pedidosContadoAlAplicarTodo(activar, pedidosSinFacturar.map((p) => p.id), e.sel)
  const sel = { ...e.sel }
  for (const p of pedidosSinFacturar) if (sel[PEDIDO_PREFIX + p.id] !== undefined) sel[PEDIDO_PREFIX + p.id] = montoAnticipo(p, activar)
  return { ...e, sel, contadoPedidos, contadoGeneral: activar }
}
