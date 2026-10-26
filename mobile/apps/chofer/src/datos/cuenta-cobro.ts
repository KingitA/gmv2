// La CUENTA de un cliente dentro de un cobro: qué se le cobra (comprobantes, anticipos a pedidos
// sin facturar), con qué descuentos (10 % contado, devoluciones como crédito) y cuánto suma.
// Funciones PURAS (tests en packages/core/test/chofer-cuenta-cobro.test.ts): la misma lógica
// sirve para el cliente de la parada y para cada cliente AGREGADO a un cobro conjunto.

import { anticiposDeSeleccion, PEDIDO_PREFIX, pedidosContadoAEnviar, pedidosContadoAlAplicarTodo } from "@gm/cobro"
import { redondear } from "@gm/formato"
import { origenDesdeComprado, valorDevolucionConOrigen, type CompradoConOrigen, type OrigenDevolucion } from "@gm/vendedor"
import type { ComprobanteCobro, CuentaCobro, PedidoCobro } from "../datasets"

const r2 = (n: number) => redondear(n)
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
  devoluciones: Array<{
    id: string
    monto_total: number
    valor_cobro?: number
    /** La factura de origen ya tenía el 10 % contado: el valor ya viene neto */
    aplica_10?: boolean
    estado: string
    local?: boolean
    numero_devolucion?: string
    devoluciones_detalle?: Array<{ cantidad: number; precio_venta_original: number; comprobante_venta_id?: string | null; estado_renglon?: string | null; articulos?: { sku: string | null; descripcion: string } | null }>
  }>
}

/**
 * #26: una devolución que todavía no tiene su NC, contra un comprobante que se cobra CONTADO en este
 * cobro, el servidor la termina revirtiendo al 90 % (la base del 10 % es lo que el cliente se queda:
 * total − devuelto, `devueltoPorComprobante`). Entonces el 10 % de ESE comprobante baja en el 10 % de
 * lo devuelto contra él. Ej.: PRES $100.000, devolución $10.000 → se cobran $81.000, no $80.000.
 * Devuelve, por comprobante, el valor de lo devuelto contra él (renglón por renglón, a su valor).
 * Una devolución que ya vino neta del 10 % (`aplica_10`) o sin origen por renglón (réplica vieja) no cuenta.
 */
export function devueltoSinNcPorComprobante(devoluciones: DatosCuenta["devoluciones"]): Map<string, number> {
  const out = new Map<string, number>()
  for (const d of devoluciones) {
    if (d.aplica_10) continue
    const renglones = (d.devoluciones_detalle ?? []).filter((x) => x.estado_renglon !== "rechazado")
    const bruto = renglones.reduce((s, x) => s + (Number(x.cantidad) || 0) * (Number(x.precio_venta_original) || 0), 0)
    if (!(bruto > 0)) continue
    const valor = valorDeDevolucion(d)
    for (const x of renglones) {
      if (!x.comprobante_venta_id) continue
      const parte = (valor * (Number(x.cantidad) || 0) * (Number(x.precio_venta_original) || 0)) / bruto
      out.set(x.comprobante_venta_id, r2((out.get(x.comprobante_venta_id) ?? 0) + parte))
    }
  }
  return out
}

/**
 * Valor de una devolución cargada en el equipo (= servidor, regla del dueño 21/10/2026): cada
 * renglón tal cual fue facturado en su comprobante de origen — neto e IVA del renglón,
 * percepción IVA si esa factura la llevó, IIBB vigente del cliente, −10 % si fue contado.
 * Misma función que la app Vendedor y que la NC (valorDevolucionConOrigen).
 */
export function valorEstimadoDevolucion(
  items: Array<{ cantidad: number; precio_venta_original: number; comprobante_venta_id?: string | null; origen_comp?: OrigenDevolucion | null }>,
  comprados: Array<Partial<CompradoConOrigen> & { comprobante_venta_id: string | null; tipo_comprobante: string }>,
  alicuotaIIBB = 0,
): number {
  return valorDevolucionConOrigen(
    items.map((i) => {
      const c = comprados.find((x) => x.comprobante_venta_id && x.comprobante_venta_id === i.comprobante_venta_id)
      const origen = i.origen_comp ?? (c ? origenDesdeComprado({ numero_comprobante: "", ultimo_precio: Number(i.precio_venta_original) || 0, ...c }) : null)
      return { cantidad: Number(i.cantidad) || 0, precio_venta_original: Number(i.precio_venta_original) || 0, origen }
    }),
    alicuotaIIBB,
  ).total
}

/** Lo que una devolución descuenta en el cobro: su valor con la regla única (−10 % si la factura fue contado); el bruto solo en réplicas viejas. */
export const valorDeDevolucion = (d: { monto_total: number; valor_cobro?: number }) => r2(Number(d.valor_cobro ?? d.monto_total) || 0)

/**
 * NC del 10 % contado que le corresponde a un comprobante seleccionado (regla del dueño 07/10/2026):
 * el 10 % del TOTAL del comprobante, una sola vez, aunque el pago sea parcial. `nc_contado` lo manda
 * el servidor con esa regla (0 = ya la tiene o no bonifica). Réplica vieja sin `nc_contado`: regla
 * anterior (solo si se salda completo), que es lo que esas APK también mostraban.
 */
export function ncContadoDe(cp: ComprobanteCobro, imputado: number, dtosHechos: Set<string>): number {
  if (!(imputado > 0.005) || dtosHechos.has(cp.id)) return 0
  if (!TIPOS_BONIFICABLES.includes(String(cp.tipo_comprobante || "").toUpperCase())) return 0
  if (cp.nc_contado !== undefined) return r2(Number(cp.nc_contado) || 0)
  return Math.abs(imputado - cp.saldo_pendiente) < 0.01 ? r2(cp.total_factura * 0.1) : 0
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
    // #26: lo devuelto en este cobro (sin NC todavía) no lleva el 10 %: sale de la base de su comprobante
    const devueltoSinNc = e.incluirDevoluciones ? devueltoSinNcPorComprobante(devPendientes) : new Map<string, number>()
    for (const cp of comprobantes) {
      const nc = ncContadoDe(cp, e.sel[cp.id] ?? 0, dtosHechos)
      bonificacion += nc > 0 ? Math.max(0, nc - r2((devueltoSinNc.get(cp.id) ?? 0) * 0.1)) : 0
    }
  }
  bonificacion = r2(bonificacion)
  const totalImputado = r2(Object.values(e.sel).reduce((s, v) => s + v, 0))
  // Las devoluciones descuentan por su VALOR (= la NC futura), no por el bruto
  const devTotal = e.incluirDevoluciones ? r2(devPendientes.reduce((s, d) => s + valorDeDevolucion(d), 0)) : 0
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

/**
 * Pedidos de ESTE viaje primero; el resto queda plegado en "Debe de antes" (dueño, 21/10/2026: el
 * chofer está en la puerta con el cliente, lo de hoy tiene que estar arriba). Los saldados no se listan
 * entre los del viaje (no hay nada que cobrarles).
 */
export function separarPorViaje(cobro: CuentaCobro, pedidosViaje: string[]): { delViaje: PedidoCobro[]; anteriores: PedidoCobro[] } {
  const ids = new Set(pedidosViaje)
  return {
    delViaje: cobro.pedidos.filter((p) => ids.has(p.id)),
    anteriores: cobro.pedidos.filter((p) => !ids.has(p.id)),
  }
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
