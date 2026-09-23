// Overlay optimista (MOBILE.md §4.2): lo que ve el chofer = réplica + sus operaciones
// que todavía no llegaron al servidor. Funciones PURAS (tests en
// packages/core/test/chofer-overlay.test.ts). Cuando la operación se aplica, el servidor
// devuelve las filas actualizadas (parche de réplica) y el overlay deja de hacer falta.
//
// Es PLATA: cada cobro, anulación, devolución y gasto hecho sin señal se ve al instante
// en la parada, en la ficha del cliente, en la plata del viaje y en la billetera, con la
// marca "sin enviar"; una operación rechazada por el servidor NO cuenta (se muestra aparte).

import type { ItemOutbox } from "@gm/core"
import type {
  BilleteraData, ClienteViajeRow, DineroHoja, MetodoPayload, OpCobrar, OpCobroAnular, OpDevolucion, OpFinalizar, OpGasto, OpIniciar, OpParada,
  PagoHoja, ParadaHoja, ViajeDetalle,
} from "../datasets"

const r2 = (n: number) => Math.round(n * 100) / 100
const de = <P,>(ops: ItemOutbox[], tipo: string) => ops.filter((o) => o.tipo === tipo).map((o) => ({ op: o, p: o.payload as P }))
/** Una operación RECHAZADA no se aplicó ni se va a aplicar: no forma parte de lo que "va a pasar". */
const vivas = (ops: ItemOutbox[]) => ops.filter((o) => o.estado !== "rechazado")
export const idLocal = (opKey: string) => `local:${opKey}`
export const esIdLocal = (id: string | null | undefined) => !!id && id.startsWith("local:")
export const keyDeIdLocal = (id: string) => id.slice("local:".length)

const suma = (metodos: MetodoPayload[] | undefined, tipo?: string) =>
  r2((metodos || []).filter((m) => !tipo || m.tipo === tipo).reduce((s, m) => s + (Number(m.monto) || 0), 0))

/** Cobrado sin enviar por cliente dentro de un viaje (titular + clientes extra del cobro conjunto). */
function cobrosDelViaje(ops: ItemOutbox[], viajeId: string) {
  return de<OpCobrar>(vivas(ops), "viaje.cobrar").filter((x) => x.p.viaje_id === viajeId)
}

// ─── Viaje (hoja de ruta) ────────────────────────────────────────────────────

export type EstadoLocal = "pendiente" | "enviando"

export interface PagoVista extends PagoHoja {
  /** Registrado en este equipo y todavía no llegó al servidor */
  local?: { opKey: string; estado: EstadoLocal }
}
export interface ParadaVista extends ParadaHoja {
  pagos: PagoVista[]
  /** Su resultado (entregado / no entregado…) se marcó acá y todavía no salió */
  resultadoSinEnviar?: boolean
}
export interface ViajeVista extends ViajeDetalle {
  paradas: ParadaVista[]
  /** "Rendir viaje" hecho sin señal: el cierre está en la cola */
  cierrePendiente: boolean
  inicioPendiente: boolean
  sinEnviar: { cobros: number; anulaciones: number; devoluciones: number; paradas: number; gastos: number }
}

function pagoLocal(op: ItemOutbox, monto: number, metodos: MetodoPayload[], p: Pick<OpCobrar, "contado_general" | "ajuste_redondeo">): PagoVista {
  return {
    id: idLocal(op.key),
    monto: r2(monto),
    estado: "pendiente_rendicion",
    fecha: op.capturadoAt,
    cargado_por: "",
    metodos: metodos.map((m) => ({
      tipo: m.tipo,
      monto: Number(m.monto) || 0,
      detalle: m.tipo === "cheque" ? [m.banco_emisor, m.numero_cheque].filter(Boolean).join(" · ") : m.tipo === "transferencia" ? m.numero_comprobante || "" : "",
    })),
    imputaciones: [],
    a_cuenta: 0,
    contado_10: !!p.contado_general,
    ajuste: Number(p.ajuste_redondeo) || 0,
    local: { opKey: op.key, estado: op.estado === "enviando" ? "enviando" : "pendiente" },
  }
}

export function viajeVisible(v: ViajeDetalle, ops: ItemOutbox[]): ViajeVista {
  const viv = vivas(ops)
  const paradas: ParadaVista[] = v.paradas.map((p) => ({ ...p, pagos: [...p.pagos] }))
  const porCliente = new Map(paradas.map((p) => [p.cliente_id, p]))
  const dinero: DineroHoja | null = v.dinero ? { ...v.dinero, gastos: [...v.dinero.gastos] } : null
  const sinEnviar = { cobros: 0, anulaciones: 0, devoluciones: 0, paradas: 0, gastos: 0 }

  const sumarDinero = (metodos: MetodoPayload[], signo: 1 | -1) => {
    if (!dinero) return
    const ef = suma(metodos, "efectivo"), ch = suma(metodos, "cheque"), tr = suma(metodos, "transferencia")
    dinero.cobrado_efectivo = r2(dinero.cobrado_efectivo + signo * ef)
    dinero.cobrado_cheques = r2(dinero.cobrado_cheques + signo * ch)
    dinero.cheques_cantidad += signo * metodos.filter((m) => m.tipo === "cheque").length
    dinero.cobrado_transferencias = r2(dinero.cobrado_transferencias + signo * tr)
    dinero.efectivo_en_mano = r2(dinero.efectivo_en_mano + signo * ef)
  }

  // Cobros hechos acá (cliente principal + clientes extra del cobro conjunto)
  for (const { op, p } of cobrosDelViaje(ops, v.id)) {
    sinEnviar.cobros++
    const principal = porCliente.get(p.cliente_id)
    if (principal) {
      principal.cobrado = r2(principal.cobrado + Number(p.monto_total))
      principal.pagos.push(pagoLocal(op, Number(p.monto_total), p.metodos, p))
    }
    sumarDinero(p.metodos, 1)
    for (const ex of p.cobros_extra || []) {
      const par = porCliente.get(ex.cliente_id)
      const monto = suma(ex.metodos)
      if (par) {
        par.cobrado = r2(par.cobrado + monto)
        par.pagos.push(pagoLocal(op, monto, ex.metodos, p))
      }
      sumarDinero(ex.metodos, 1)
    }
  }

  // Anulaciones de cobros del servidor hechas acá
  for (const { p } of de<OpCobroAnular>(viv, "viaje.cobro_anular").filter((x) => x.p.viaje_id === v.id)) {
    sinEnviar.anulaciones++
    const par = porCliente.get(p.cliente_id)
    const pago = par?.pagos.find((x) => x.id === p.pago_id)
    if (par && pago) {
      par.cobrado = r2(par.cobrado - pago.monto)
      par.pagos = par.pagos.filter((x) => x.id !== p.pago_id)
      sumarDinero(pago.metodos.map((m) => ({ tipo: m.tipo as MetodoPayload["tipo"], monto: m.monto })), -1)
    }
  }

  // Devoluciones
  for (const { p } of de<OpDevolucion>(viv, "viaje.devolucion").filter((x) => x.p.viaje_id === v.id)) {
    sinEnviar.devoluciones++
    const par = porCliente.get(p.cliente_id)
    if (par) par.devuelto = r2(par.devuelto + p.items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_venta_original), 0))
  }

  // Resultado de paradas (valor absoluto: la última manda)
  for (const { op, p } of de<OpParada>(viv, "viaje.parada").filter((x) => x.p.viaje_id === v.id)) {
    sinEnviar.paradas++
    const par = paradas.find((x) => x.id === p.parada_id)
    if (!par) continue
    par.resultadoSinEnviar = true
    if (p.estado === "pendiente") {
      Object.assign(par, { estado: "pendiente", bultos_entregados: null, motivo_no_entrega: null, motivo_no_cobro: null, resuelto_at: null })
    } else {
      const bultos = p.estado === "entregado" ? par.bultos : p.estado === "entregado_parcial" ? Math.max(0, Math.min(par.bultos, Number(p.bultos_entregados) || 0)) : p.estado === "no_entregado" ? 0 : null
      Object.assign(par, { estado: p.estado, bultos_entregados: bultos, motivo_no_entrega: p.motivo_no_entrega || null, motivo_no_cobro: p.motivo_no_cobro || null, resuelto_at: op.capturadoAt })
    }
  }

  // Gastos
  for (const { op, p } of de<OpGasto>(viv, "viaje.gasto").filter((x) => x.p.viaje_id === v.id)) {
    sinEnviar.gastos++
    if (!dinero) continue
    const monto = r2(Number(p.monto))
    dinero.gastos.push({ id: idLocal(op.key), categoria: p.categoria, monto, observaciones: p.observaciones, estado: "declarado", cargado_por: "", foto_url: p.foto_url, fecha: op.capturadoAt })
    dinero.gastos_total = r2(dinero.gastos_total + monto)
    dinero.efectivo_en_mano = r2(dinero.efectivo_en_mano - monto)
  }

  for (const p of paradas) p.cobro_cumplido = p.cobrado + 0.01 >= p.minimo_exigido

  let estado = v.viaje.estado
  const inicioPendiente = estado === "despachado" && de<OpIniciar>(viv, "viaje.iniciar").some((x) => x.p.viaje_id === v.id)
  if (inicioPendiente) estado = "en_curso"
  const cierrePendiente = (estado === "en_curso" || estado === "despachado") && de<OpFinalizar>(viv, "viaje.finalizar").some((x) => x.p.viaje_id === v.id)
  if (cierrePendiente) estado = "en_rendicion"

  return { ...v, viaje: { ...v.viaje, estado }, paradas, dinero, cierrePendiente, inicioPendiente, sinEnviar }
}

/** Paradas que todavía hay que resolver antes de rendir (misma regla que el servidor). */
export const paradasSinResolver = (v: ViajeVista) => v.paradas.filter((p) => p.estado === "pendiente")

// ─── Ficha del cliente en el viaje ───────────────────────────────────────────

export type ClienteVista = ClienteViajeRow & {
  /** El equipo todavía no tiene la ficha completa (solo lo que trae la hoja de ruta) */
  parcial?: boolean
}

export function clienteVisible(c: ClienteViajeRow, ops: ItemOutbox[]): ClienteVista {
  const viv = vivas(ops)
  let out: ClienteVista = {
    ...c,
    pagos_registrados: [...c.pagos_registrados],
    devoluciones: [...c.devoluciones],
    resumen: { ...c.resumen },
    cobro: { ...c.cobro, comprobantes: c.cobro.comprobantes.map((k) => ({ ...k, en_cobro: k.en_cobro || 0 })), pedidos: c.cobro.pedidos.map((p) => ({ ...p })) },
  }

  for (const { op, p } of cobrosDelViaje(ops, c.viaje_id)) {
    const propio = p.cliente_id === c.cliente_id
    const extra = (p.cobros_extra || []).find((x) => x.cliente_id === c.cliente_id)
    if (!propio && !extra) continue
    const monto = propio ? Number(p.monto_total) : suma(extra!.metodos)
    out.pagos_registrados = [{ id: idLocal(op.key), monto: r2(monto), estado: "pendiente_rendicion", created_at: op.capturadoAt, local: { opKey: op.key, estado: op.estado, error: op.error } }, ...out.pagos_registrados]
    out.resumen.total_cobrado = r2(out.resumen.total_cobrado + monto)
    if (propio) {
      // Lo imputado sin señal queda RESERVADO: no se puede cobrar dos veces el mismo comprobante
      const imp = new Map(p.imputaciones.map((i) => [i.comprobante_id, Number(i.monto_imputado) || 0]))
      out.cobro.comprobantes = out.cobro.comprobantes.map((k) => (imp.has(k.id) ? { ...k, en_cobro: r2((k.en_cobro || 0) + imp.get(k.id)!) } : k))
      const anticipados = new Set(p.pedidos_contado || [])
      out.cobro.pedidos = out.cobro.pedidos.map((k) => (anticipados.has(k.id) ? { ...k, pago_contado_10: true, anticipo_pago_id: k.anticipo_pago_id || idLocal(op.key) } : k))
      // Devoluciones descontadas en el cobro dejan de estar pendientes de descuento
      const dev = new Set(p.devolucion_ids || [])
      out.devoluciones = out.devoluciones.map((d) => (dev.has(d.id) ? { ...d, estado: "descontada_sin_enviar" } : d))
    }
  }

  for (const { p } of de<OpCobroAnular>(viv, "viaje.cobro_anular").filter((x) => x.p.viaje_id === c.viaje_id && x.p.cliente_id === c.cliente_id)) {
    const pago = out.pagos_registrados.find((x) => x.id === p.pago_id)
    if (!pago) continue
    out.pagos_registrados = out.pagos_registrados.filter((x) => x.id !== p.pago_id)
    out.resumen.total_cobrado = r2(out.resumen.total_cobrado - pago.monto)
  }

  for (const { p } of de<OpDevolucion>(viv, "viaje.devolucion").filter((x) => x.p.viaje_id === c.viaje_id && x.p.cliente_id === c.cliente_id)) {
    if (out.devoluciones.some((d) => d.id === p.id)) continue
    const total = r2(p.items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_venta_original), 0))
    out.devoluciones = [
      {
        id: p.id,
        numero_devolucion: "sin enviar",
        monto_total: total,
        estado: "pendiente",
        local: true,
        devoluciones_detalle: p.items.map((i, n) => ({ id: `${p.id}:${n}`, articulo_id: i.articulo_id, cantidad: i.cantidad, precio_venta_original: i.precio_venta_original, motivo: i.motivo, condicion: i.condicion, articulos: { sku: i.sku, descripcion: i.descripcion } })),
      },
      ...out.devoluciones,
    ]
    out.resumen.total_devuelto = r2(out.resumen.total_devuelto + total)
    out.resumen.total_a_cobrar = r2(out.resumen.total_a_cobrar - total)
  }

  out.resumen.ya_cobrado = out.resumen.total_cobrado > 0
  return out
}

/** Ficha mínima de un cliente cuyo detalle todavía no se descargó (solo lo que trae la hoja de ruta). */
export function clienteDesdeParada(viajeId: string, parada: ParadaHoja, viajeEstado: string): ClienteViajeRow {
  return {
    id: `${viajeId}:${parada.cliente_id}`,
    viaje_id: viajeId,
    cliente_id: parada.cliente_id,
    cliente: { nombre: parada.cliente_nombre, razon_social: null, direccion: parada.direccion, telefono: parada.telefono, cuit: null, condicion_pago: null },
    pedido: null,
    comprobantes_pendientes: [],
    devoluciones: [],
    pagos_registrados: parada.pagos.map((p) => ({ id: p.id, monto: p.monto, estado: p.estado, created_at: p.fecha })),
    resumen: {
      saldo_anterior: parada.saldo_anterior,
      saldo_real: parada.saldo_anterior,
      saldo_proyectado: parada.saldo_anterior,
      pendiente_verificacion: 0,
      total_pedido: parada.total_viaje,
      total_devuelto: parada.devuelto,
      total_cobrado: parada.cobrado,
      total_a_cobrar: r2(parada.total_a_cobrar - parada.devuelto),
      ya_cobrado: parada.cobrado > 0,
    },
    viaje_estado: viajeEstado,
    cobro: { comprobantes: [], pedidos: [], pedidos_facturados: [], dtos_hechos: [] },
    comprados: [],
  }
}

// ─── Billetera ───────────────────────────────────────────────────────────────

export function billeteraVisible(b: BilleteraData, ops: ItemOutbox[]): BilleteraData {
  const out: BilleteraData = { ...b, desglose: { ...b.desglose }, cobros: [...b.cobros], gastos: [...b.gastos] }
  // Cobros: los vivos suman plata; los rechazados se listan (para que no pasen inadvertidos) sin sumar
  for (const { op, p } of de<OpCobrar>(ops, "viaje.cobrar")) {
    const todos = [{ cliente_nombre: p.cliente_nombre, metodos: p.metodos }, ...(p.cobros_extra || []).map((x) => ({ cliente_nombre: x.cliente_nombre || "Cliente", metodos: x.metodos }))]
    for (const c of todos) {
      const rechazado = op.estado === "rechazado"
      if (!rechazado) {
        const ef = suma(c.metodos, "efectivo"), ch = suma(c.metodos, "cheque"), tr = suma(c.metodos, "transferencia")
        out.efectivo = r2(out.efectivo + ef)
        out.desglose.cobros_efectivo = r2(out.desglose.cobros_efectivo + ef)
        out.desglose.cheques_monto = r2(out.desglose.cheques_monto + ch)
        out.desglose.transferencias = r2(out.desglose.transferencias + tr)
        out.cheques_cantidad += c.metodos.filter((m) => m.tipo === "cheque").length
      }
      out.cobros.unshift({
        id: `${idLocal(op.key)}:${c.cliente_nombre}`,
        fecha: op.capturadoAt,
        cliente: c.cliente_nombre,
        viaje: "",
        monto: suma(c.metodos),
        metodos: [...new Set(c.metodos.map((m) => (m.tipo === "cheque" ? `Cheque ${m.banco_emisor || ""} ${m.numero_cheque || ""}`.trim() : m.tipo === "transferencia" ? "Transferencia" : "Efectivo")))],
        estado: rechazado ? "rechazado" : "sin_enviar",
        error: rechazado ? op.error : null,
      })
    }
  }
  for (const { p } of de<OpCobroAnular>(vivas(ops), "viaje.cobro_anular")) {
    const cobro = out.cobros.find((c) => c.id === p.pago_id)
    if (!cobro) continue
    out.cobros = out.cobros.filter((c) => c.id !== p.pago_id)
    // Solo se puede descontar del efectivo lo que era todo efectivo (el desglose por método no viaja en la lista)
    if (cobro.estado === "en_mano" && cobro.metodos.every((m) => m === "Efectivo")) {
      out.efectivo = r2(out.efectivo - cobro.monto)
      out.desglose.cobros_efectivo = r2(out.desglose.cobros_efectivo - cobro.monto)
    }
  }
  for (const { op, p } of de<OpGasto>(vivas(ops), "viaje.gasto")) {
    const monto = r2(Number(p.monto))
    out.efectivo = r2(out.efectivo - monto)
    out.desglose.gastos = r2(out.desglose.gastos + monto)
    out.gastos.unshift({ id: idLocal(op.key), viaje: p.viaje_nombre || "", categoria: p.categoria, monto, estado: "declarado", observaciones: p.observaciones, created_at: op.capturadoAt, local: true })
  }
  return out
}

// ─── Descarga del viaje ──────────────────────────────────────────────────────

export interface EstadoDescarga {
  completa: boolean
  total: number
  descargados: number
  /** Nombres de las paradas cuya ficha todavía no está en el equipo */
  faltan: string[]
}

export function estadoDescarga(v: ViajeDetalle | null, idsClientes: Set<string>): EstadoDescarga {
  if (!v) return { completa: false, total: 0, descargados: 0, faltan: [] }
  const faltan = v.paradas.filter((p) => !idsClientes.has(`${v.id}:${p.cliente_id}`)).map((p) => p.cliente_nombre)
  return { completa: faltan.length === 0, total: v.paradas.length, descargados: v.paradas.length - faltan.length, faltan }
}
