// Overlay optimista (MOBILE.md §4.2): lo que ve el chofer = réplica + sus operaciones
// que todavía no llegaron al servidor. Funciones PURAS (tests en
// packages/core/test/chofer-overlay.test.ts). Cuando la operación se aplica, el servidor
// devuelve las filas actualizadas (parche de réplica) y el overlay deja de hacer falta.
//
// Es PLATA: cada cobro, anulación, devolución y gasto hecho sin señal se ve al instante
// en la parada, en la ficha del cliente, en la plata del viaje y en la billetera, con la
// marca "sin enviar"; una operación rechazada por el servidor NO cuenta (se muestra aparte).

import type { ItemOutbox } from "@gm/core"
import { cobroCumple, efectoAnulacionEnParada } from "@gm/cobro"
import { redondear } from "@gm/formato"
import { claveDelCliente, montoDelPrincipal, repartirMetodos } from "@gm/cobro/conjunto"
import type {
  BilleteraData, ClienteViajeRow, DineroHoja, MetodoPayload, OpCobrar, OpCobroAnular, OpDevolucion, OpFinalizar, OpGasto, OpIniciar, OpParada,
  PagoHoja, ParadaHoja, ViajeDetalle,
} from "../datasets"

const r2 = (n: number) => redondear(n)
const de = <P,>(ops: ItemOutbox[], tipo: string) => ops.filter((o) => o.tipo === tipo).map((o) => ({ op: o, p: o.payload as P }))
/** Una operación RECHAZADA no se aplicó ni se va a aplicar: no forma parte de lo que "va a pasar". */
const vivas = (ops: ItemOutbox[]) => ops.filter((o) => o.estado !== "rechazado")
export const idLocal = (opKey: string) => `local:${opKey}`
export const esIdLocal = (id: string | null | undefined) => !!id && id.startsWith("local:")
export const keyDeIdLocal = (id: string) => id.slice("local:".length)

/** Lo que descuenta una devolución cargada acá: su valor con la regla única (lo manda la pantalla); el bruto solo si la operación es de una APK anterior. */
const valorDevolucionLocal = (p: OpDevolucion) =>
  p.valor_estimado != null ? r2(Number(p.valor_estimado)) : r2(p.items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_venta_original), 0))

const suma = (metodos: MetodoPayload[] | undefined, tipo?: string) =>
  r2((metodos || []).filter((m) => !tipo || m.tipo === tipo).reduce((s, m) => s + (Number(m.monto) || 0), 0))

/** Cobrado sin enviar por cliente dentro de un viaje (titular + clientes extra del cobro conjunto). */
function cobrosDelViaje(ops: ItemOutbox[], viajeId: string) {
  return de<OpCobrar>(vivas(ops), "viaje.cobrar").filter((x) => x.p.viaje_id === viajeId)
}

/**
 * Claves con las que el servidor registra los pagos de una operación de cobro: la del principal es la
 * de la operación; cada cliente agregado lleva una derivada (misma regla que el servidor, @gm/cobro/conjunto).
 */
export function clavesDelCobro(op: ItemOutbox, p: OpCobrar): string[] {
  return Array.from({ length: 1 + (p.clientes_extra || []).length }, (_, i) => claveDelCliente(op.key, i)).filter((k): k is string => !!k)
}

/**
 * ¿La réplica ya tiene el pago de esta operación? Pasa cuando la hoja o la ficha se refrescan mientras
 * el cobro todavía figura en la cola (el servidor tardó unos segundos con la foto y el cheque): sin
 * esto, lo cobrado se veía DUPLICADO hasta que la operación salía de la cola (pasada del 01/10/2026).
 */
export const yaEnReplica = (op: ItemOutbox, p: OpCobrar, claves: Iterable<string | null | undefined>) => {
  const vistas = new Set([...claves].filter(Boolean))
  return clavesDelCobro(op, p).some((k) => vistas.has(k))
}

/**
 * Reparto de un cobro entre sus clientes (misma función que usa el servidor): el principal y cada
 * cliente agregado con SU monto y SUS medios de pago. Sin agregados, todo es del principal.
 */
export function partesDelCobro(p: OpCobrar): Array<{ cliente_id: string; monto: number; metodos: MetodoPayload[]; principal: boolean }> {
  const extras = p.clientes_extra || []
  if (!extras.length) return [{ cliente_id: p.cliente_id, monto: r2(Number(p.monto_total)), metodos: p.metodos, principal: true }]
  const montos = [montoDelPrincipal(Number(p.monto_total), extras.map((e) => Number(e.monto))), ...extras.map((e) => Number(e.monto))]
  let reparto: MetodoPayload[][]
  try {
    reparto = repartirMetodos(p.metodos, montos)
  } catch {
    reparto = montos.map((m) => [{ tipo: "efectivo", monto: m }])
  }
  return montos.map((monto, i) => ({ cliente_id: i === 0 ? p.cliente_id : extras[i - 1]!.cliente_id, monto: r2(monto), metodos: reparto[i] || [], principal: i === 0 }))
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
  /** R4/C7: volvió a pendiente porque se anuló (sin enviar) el cobro que la cerró estando bloqueada */
  reabiertaPorAnulacion?: boolean
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
  const clavesServidor = v.paradas.flatMap((pa) => pa.pagos.map((x) => x.idempotency_key))
  for (const { op, p } of cobrosDelViaje(ops, v.id)) {
    if (yaEnReplica(op, p, clavesServidor)) continue // el servidor ya lo tiene: no se cuenta dos veces
    sinEnviar.cobros++
    // Cobro conjunto: cada cliente ve SU parte (el principal ya no se lleva todo el monto)
    for (const parte of partesDelCobro(p)) {
      const par = porCliente.get(parte.cliente_id)
      if (!par) continue
      par.cobrado = r2(par.cobrado + parte.monto)
      par.pagos.push(pagoLocal(op, parte.monto, parte.metodos, parte.principal ? p : { contado_general: false, ajuste_redondeo: 0 }))
      // El 10 % contado y el ajuste también cubren lo exigido (#27), igual que en el servidor
      const desc = parte.principal ? Number(p.descuento_estimado) || 0 : Number((p.clientes_extra || []).find((x) => x.cliente_id === parte.cliente_id)?.descuento_estimado) || 0
      if (desc > 0) par.descuentos_cobro = r2((par.descuentos_cobro ?? 0) + desc)
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
    if (par) {
      const total = valorDevolucionLocal(p)
      par.devuelto = r2(par.devuelto + total)
      // Lo devuelto en el viaje baja el total a cobrar (misma regla que el servidor: saldoDeParada)
      par.total_a_cobrar = r2(par.total_a_cobrar - total)
      // …y lo exigido, que viene NETO de lo devuelto (#27)
      if (par.minimo_exigido > 0) par.minimo_exigido = r2(Math.max(0, par.minimo_exigido - total))
    }
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

  // P2-33 (Juan 28/10): cobrar NO cierra la parada: la entrega la confirma el chofer ("Confirmar
  // parada"). Una parada cobrada y sin cerrar queda en "Visitados · falta cerrar la parada".

  // R4/C7 (27/10, = servidor): anular el cobro con el que se cerró una parada "NO ENTREGAR SIN
  // COBRAR" la deja sin cubrir lo exigido ⇒ con el viaje en curso vuelve a PENDIENTE (cobrar de
  // nuevo o "no entregado"). Un resultado de parada posterior a la anulación manda.
  const viajeEnCurso = ["despachado", "en_curso"].includes(v.viaje.estado)
  for (const { op, p } of de<OpCobroAnular>(viv, "viaje.cobro_anular").filter((x) => x.p.viaje_id === v.id)) {
    const par = porCliente.get(p.cliente_id)
    if (!par || !viajeEnCurso) continue
    if (viv.some((o) => o.tipo === "viaje.parada" && o.seq > op.seq && (o.payload as OpParada).parada_id === par.id)) continue
    const efecto = efectoAnulacionEnParada({ estado: par.estado, bloqueada: !!par.bloquear_entrega, minimoExigido: par.minimo_exigido, cobradoSin: par.cobrado, descuentos: par.descuentos_cobro ?? 0, viajeEnCurso })
    if (efecto === "reabrir") Object.assign(par, { estado: "pendiente", bultos_entregados: null, motivo_no_entrega: null, motivo_no_cobro: null, resuelto_at: null, resultadoSinEnviar: true, reabiertaPorAnulacion: true })
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

  // Misma regla que el servidor (@gm/cobro): lo cobrado más el 10 % contado / ajuste cubre lo exigido.
  // Bloqueada y sin cubrir ⇒ solo se puede marcar "no entregado" (#23).
  for (const p of paradas) {
    p.cobro_cumplido = cobroCumple({ minimoExigido: p.minimo_exigido, cobrado: p.cobrado, descuentos: p.descuentos_cobro ?? 0 })
    p.entrega_bloqueada = !!p.bloquear_entrega && !p.cobro_cumplido
  }

  let estado = v.viaje.estado
  const inicioPendiente = estado === "despachado" && de<OpIniciar>(viv, "viaje.iniciar").some((x) => x.p.viaje_id === v.id)
  if (inicioPendiente) estado = "en_curso"
  const cierrePendiente = (estado === "en_curso" || estado === "despachado") && de<OpFinalizar>(viv, "viaje.finalizar").some((x) => x.p.viaje_id === v.id)
  if (cierrePendiente) estado = "en_rendicion"

  return { ...v, viaje: { ...v.viaje, estado }, paradas, dinero, cierrePendiente, inicioPendiente, sinEnviar }
}

/**
 * Transferencias del viaje, aparte (#35): no son plata en mano ni van a la rendición; las confirma
 * oficina en Caja. Desde el 26/10 el servidor guarda la parte digital de un cobro como un pago
 * `pendiente` (a confirmar) que pasa a `confirmado`. Un cobro sin enviar con transferencia figura
 * como "sin enviar".
 */
export function transferenciasDelViaje(v: ViajeVista): Array<{ id: string; cliente: string; monto: number; estado: "a_confirmar" | "confirmada" | "sin_enviar" }> {
  const out: Array<{ id: string; cliente: string; monto: number; estado: "a_confirmar" | "confirmada" | "sin_enviar" }> = []
  for (const p of v.paradas)
    for (const pago of p.pagos) {
      const monto = r2(pago.metodos.filter((m) => m.tipo === "transferencia" || m.tipo === "deposito").reduce((s, m) => s + (Number(m.monto) || 0), 0))
      if (!(monto > 0)) continue
      out.push({ id: `${pago.id}:tr`, cliente: p.cliente_nombre, monto, estado: pago.local ? "sin_enviar" : pago.estado === "confirmado" ? "confirmada" : "a_confirmar" })
    }
  return out
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

  const clavesServidor = c.pagos_registrados.map((x) => x.idempotency_key)
  for (const { op, p } of cobrosDelViaje(ops, c.viaje_id)) {
    if (yaEnReplica(op, p, clavesServidor)) continue // la ficha ya trae el pago del servidor
    const propio = p.cliente_id === c.cliente_id
    const extra = (p.cobros_extra || []).find((x) => x.cliente_id === c.cliente_id)
    // Cliente AGREGADO a un cobro conjunto: lleva su propia selección, que se reserva igual
    const agregado = (p.clientes_extra || []).find((x) => x.cliente_id === c.cliente_id)
    if (!propio && !extra && !agregado) continue
    const parte = partesDelCobro(p).find((x) => x.cliente_id === c.cliente_id)
    const monto = extra ? suma(extra.metodos) : parte ? parte.monto : Number(p.monto_total)
    out.pagos_registrados = [{ id: idLocal(op.key), monto: r2(monto), estado: "pendiente_rendicion", created_at: op.capturadoAt, local: { opKey: op.key, estado: op.estado, error: op.error } }, ...out.pagos_registrados]
    out.resumen.total_cobrado = r2(out.resumen.total_cobrado + monto)
    const seleccion = propio ? p : agregado
    if (seleccion) {
      // Lo imputado sin señal queda RESERVADO: no se puede cobrar dos veces el mismo comprobante
      const imp = new Map(seleccion.imputaciones.map((i) => [i.comprobante_id, Number(i.monto_imputado) || 0]))
      out.cobro.comprobantes = out.cobro.comprobantes.map((k) => (imp.has(k.id) ? { ...k, en_cobro: r2((k.en_cobro || 0) + imp.get(k.id)!) } : k))
      const anticipados = new Set(seleccion.pedidos_contado || [])
      out.cobro.pedidos = out.cobro.pedidos.map((k) => (anticipados.has(k.id) ? { ...k, pago_contado_10: true, anticipo_pago_id: k.anticipo_pago_id || idLocal(op.key) } : k))
      // Devoluciones descontadas en el cobro dejan de estar pendientes de descuento
      const dev = new Set(seleccion.devolucion_ids || [])
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
    const total = valorDevolucionLocal(p)
    out.devoluciones = [
      {
        id: p.id,
        numero_devolucion: "sin enviar",
        monto_total: r2(p.items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_venta_original), 0)),
        valor_cobro: total,
        estado: "pendiente",
        local: true,
        // Origen por renglón y si ya venía con el 10 %: el cobro contado lo necesita (#26). Toda la
        // devolución es "neta" solo si TODOS sus renglones lo son; si es mixta se decide por renglón
        // (bonificado_contado en cada uno, revisión 27/10).
        aplica_10: p.items.length > 0 && p.items.every((i) => !!i.origen_comp?.bonificado_contado),
        devoluciones_detalle: p.items.map((i, n) => ({ id: `${p.id}:${n}`, articulo_id: i.articulo_id, cantidad: i.cantidad, precio_venta_original: i.precio_venta_original, motivo: i.motivo, condicion: i.condicion, comprobante_venta_id: i.comprobante_venta_id ?? i.origen_comp?.comprobante_venta_id ?? null, bonificado_contado: !!i.origen_comp?.bonificado_contado, articulos: { sku: i.sku, descripcion: i.descripcion } })),
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
  const clavesServidor = b.cobros.map((x) => x.idempotency_key)
  for (const { op, p } of de<OpCobrar>(ops, "viaje.cobrar")) {
    if (yaEnReplica(op, p, clavesServidor)) continue // la billetera ya trae el cobro del servidor
    const rechazado = op.estado === "rechazado"
    // La PLATA se cuenta una vez por medio físico (un cheque repartido entre dos clientes es UN cheque)
    if (!rechazado) {
      for (const metodos of [p.metodos, ...(p.cobros_extra || []).map((x) => x.metodos)]) {
        const ef = suma(metodos, "efectivo"), ch = suma(metodos, "cheque"), tr = suma(metodos, "transferencia")
        out.efectivo = r2(out.efectivo + ef)
        out.desglose.cobros_efectivo = r2(out.desglose.cobros_efectivo + ef)
        out.desglose.cheques_monto = r2(out.desglose.cheques_monto + ch)
        out.desglose.transferencias = r2(out.desglose.transferencias + tr)
        out.cheques_cantidad += metodos.filter((m) => m.tipo === "cheque").length
      }
    }
    // La LISTA muestra un renglón por cliente, con su parte (cobro conjunto) o su monto (legado)
    const nombreExtra = new Map((p.clientes_extra || []).map((x) => [x.cliente_id, x.cliente_nombre || "Cliente"]))
    const todos = [
      ...partesDelCobro(p).map((x) => ({ cliente_nombre: x.principal ? p.cliente_nombre : nombreExtra.get(x.cliente_id) || "Cliente", metodos: x.metodos })),
      ...(p.cobros_extra || []).map((x) => ({ cliente_nombre: x.cliente_nombre || "Cliente", metodos: x.metodos })),
    ]
    for (const c of todos) {
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
