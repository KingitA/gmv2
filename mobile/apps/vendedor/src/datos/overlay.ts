// Overlay optimista (MOBILE.md §4.2): lo que ve el vendedor = réplica + sus
// operaciones que todavía no llegaron al servidor. Funciones PURAS (tests en
// packages/core/test/vendedor.test.ts). Cuando la operación se aplica, el servidor
// devuelve las filas actualizadas (parche de réplica) y el overlay deja de hacer falta.

import type { ItemOutbox } from "@gm/core"
import type {
  Cliente, ClienteViaje, CuentaCliente, OpBonificaciones, OpClienteEditar, OpCobroAnular, OpPedido, OpViajeEstado, OpViajeNoVa,
  PedidoVendedor, ViajeVendedor,
} from "../datasets"

const r2 = (n: number) => Math.round(n * 100) / 100
const de = <P,>(ops: ItemOutbox[], tipo: string) => ops.filter((o) => o.tipo === tipo).map((o) => ({ op: o, p: o.payload as P }))
/** Una operación RECHAZADA no se aplicó ni se va a aplicar: no forma parte de lo que "va a pasar". */
const vivas = (ops: ItemOutbox[]) => ops.filter((o) => o.estado !== "rechazado")

// ─── Pedidos ─────────────────────────────────────────────────────────────────

export type EstadoLocal = "pendiente" | "enviando" | "rechazado"

/** Fila de "Mis pedidos": un pedido del servidor o uno tomado acá que todavía no salió. */
export interface PedidoVista {
  id: string
  numero_pedido: string | null
  fecha: string
  estado: string
  total: number
  cliente: { id: string; nombre: string } | null
  /** Tomado en este equipo y todavía no está en el servidor */
  local: null | { opKey: string; estado: EstadoLocal; error: string | null; payload: OpPedido; capturadoAt: string }
  /** Pedido del servidor con cambios hechos acá que todavía no salieron */
  cambios: null | { opKey: string; estado: EstadoLocal; error: string | null; payload: OpPedido }
  fila: PedidoVendedor | null
}

export const idLocal = (localId: string) => `local:${localId}`
export const esIdLocal = (id: string | undefined) => !!id && id.startsWith("local:")

export function pedidosVisibles(filas: PedidoVendedor[], ops: ItemOutbox[]): PedidoVista[] {
  const eliminados = new Set(de<{ pedido_id: string }>(vivas(ops), "pedido.eliminar").map((x) => x.p.pedido_id))
  // La ÚLTIMA edición pendiente de cada pedido es la que vale (estado final)
  const ediciones = new Map<string, { op: ItemOutbox; p: OpPedido }>()
  for (const x of de<OpPedido>(ops, "pedido.editar")) if (x.p.pedido_id) ediciones.set(x.p.pedido_id, x)

  const out: PedidoVista[] = []
  for (const f of filas) {
    if (eliminados.has(f.id)) continue
    const e = ediciones.get(f.id)
    out.push({
      id: f.id,
      numero_pedido: f.pedido.numero_pedido,
      fecha: f.pedido.fecha,
      estado: f.pedido.estado,
      total: e && e.op.estado !== "rechazado" ? e.p.vista.total : Number(f.pedido.total) || 0,
      cliente: f.pedido.clientes ? { id: f.pedido.clientes.id, nombre: f.pedido.clientes.nombre } : null,
      local: null,
      cambios: e ? { opKey: e.op.key, estado: e.op.estado as EstadoLocal, error: e.op.error, payload: e.p } : null,
      fila: f,
    })
  }
  for (const { op, p } of de<OpPedido>(ops, "pedido.crear")) {
    out.push({
      id: idLocal(p.local_id),
      numero_pedido: null,
      fecha: op.capturadoAt.slice(0, 10),
      estado: "pendiente",
      total: p.vista.total,
      cliente: { id: p.cliente_id, nombre: p.vista.cliente_nombre },
      local: { opKey: op.key, estado: op.estado as EstadoLocal, error: op.error, payload: p, capturadoAt: op.capturadoAt },
      cambios: null,
      fila: null,
    })
  }
  // Más nuevo primero; los tomados acá (sin número todavía) arriba de todo
  return out.sort((a, b) => (a.local && !b.local ? -1 : !a.local && b.local ? 1 : 0) || (b.fila?.pedido.created_at || b.fecha).localeCompare(a.fila?.pedido.created_at || a.fecha))
}

// ─── Clientes ────────────────────────────────────────────────────────────────

const CLIENTE_VACIO: Omit<Cliente, "id" | "nombre"> = {
  razon_social: null, cuit: null, codigo_cliente: null, direccion: null, localidad: null, localidad_id: null, provincia: null, telefono: null, mail: null,
  condicion_iva: null, condicion_pago: null, condicion_entrega: null, metodo_facturacion: null, vendedor_id: null, lista_precio_id: null, lista: null,
  saldo_actual: 0, saldo_proyectado: 0, pagos_sin_rendir: 0, bonificaciones: { viajante: {}, mercaderia: {} },
}

function conEdiciones(c: Cliente, ops: ItemOutbox[]): Cliente {
  let out = c
  for (const { p } of de<OpClienteEditar>(vivas(ops), "cliente.editar")) {
    if (p.cliente_id !== c.id) continue
    const cambios: Record<string, unknown> = {}
    for (const [campo, v] of Object.entries(p.cambios)) cambios[campo] = v.despues
    out = { ...out, ...cambios }
  }
  for (const { p } of de<OpBonificaciones>(vivas(ops), "cliente.bonificaciones")) {
    if (p.cliente_id === c.id) out = { ...out, bonificaciones: { viajante: { ...p.viajante }, mercaderia: { ...p.mercaderia } } }
  }
  return out
}

/** Plata cobrada acá y todavía sin enviar, por cliente (para el saldo proyectado del listado). */
function cobradoSinEnviar(ops: ItemOutbox[]): Map<string, { monto: number; cantidad: number }> {
  const m = new Map<string, { monto: number; cantidad: number }>()
  for (const { p } of de<any>(vivas(ops), "cobro.registrar")) {
    for (const c of p.clientes || []) {
      const monto = montoDeCobro(c)
      const a = m.get(c.cliente_id) || { monto: 0, cantidad: 0 }
      m.set(c.cliente_id, { monto: a.monto + monto, cantidad: a.cantidad + 1 })
    }
  }
  return m
}

/** Lo que un cobro va a descontar del saldo al confirmarse (= lo que proyecta el servidor). */
function montoDeCobro(c: any): number {
  const suma = (l: any[] | undefined) => (l || []).reduce((s, x) => s + Number(x.monto || 0), 0)
  // Servidor: proyectado = real − (monto del pago + 10% contado + ajuste), y el monto del pago es
  // imputado + anticipos + a cuenta − bonificación − ajuste − créditos − devoluciones ⇒ queda:
  return r2(suma(c.imputaciones) + suma(c.pedidos) + Number(c.pago_a_cuenta || 0) - suma(c.creditos) - suma(c.devoluciones))
}

export function clientesVisibles(filas: Cliente[], ops: ItemOutbox[]): Cliente[] {
  const cobrado = cobradoSinEnviar(ops)
  const ids = new Set(filas.map((c) => c.id))
  const out = filas.map((c) => {
    const e = conEdiciones(c, ops)
    const k = cobrado.get(c.id)
    return k ? { ...e, saldo_proyectado: r2(e.saldo_proyectado - k.monto), pagos_sin_rendir: e.pagos_sin_rendir + k.cantidad } : e
  })
  for (const { p } of de<any>(vivas(ops), "cliente.crear")) {
    if (ids.has(p.id)) continue
    const nombre = String(p.nombre || p.razon_social || "").trim()
    out.push(conEdiciones({ ...CLIENTE_VACIO, ...p, id: p.id, nombre, sinEnviar: true }, ops))
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
}

// ─── Cuenta corriente ────────────────────────────────────────────────────────

/**
 * Cuenta corriente + cobros/devoluciones hechos acá sin enviar. Lo cobrado sin señal
 * se RESERVA igual que hace el servidor con `en_cobro`: sin esto el vendedor podría
 * cobrar dos veces el mismo comprobante antes de recuperar la red.
 */
export function cuentaVisible(cc: CuentaCliente, ops: ItemOutbox[], marcaContado = "[10% CONTADO]"): CuentaCliente {
  const anulando = new Set(de<OpCobroAnular>(vivas(ops), "cobro.anular").map((x) => x.p.pago_id))
  let out: CuentaCliente = { ...cc, pagos_recientes: cc.pagos_recientes.filter((p) => !anulando.has(p.id)) }

  for (const { op, p } of de<any>(vivas(ops), "cobro.registrar")) {
    for (const c of (p.clientes || []).filter((x: any) => x.cliente_id === cc.id)) {
      const contado = String(p.observaciones || "").includes(marcaContado)
      const imp = new Map<string, number>((c.imputaciones || []).map((i: any) => [i.comprobante_id, Number(i.monto) || 0]))
      const ped = new Map<string, any>((c.pedidos || []).map((x: any) => [x.pedido_id, x]))
      const dev = new Map<string, number>((c.devoluciones || []).map((d: any) => [d.devolucion_id, Number(d.monto) || 0]))
      const cred = new Map<string, number>((c.creditos || []).map((x: any) => [`${x.tipo}:${x.id}`, Number(x.monto) || 0]))
      const totalMetodos = (p.metodos || []).reduce((s: number, m: any) => s + Number(m.monto || 0), 0)
      out = {
        ...out,
        comprobantes: out.comprobantes.map((k) =>
          imp.has(k.id) ? { ...k, en_cobro: r2(k.en_cobro + imp.get(k.id)!), en_cobro_contado: r2(k.en_cobro_contado + (contado ? imp.get(k.id)! : 0)) } : k,
        ),
        pedidos_cobro: out.pedidos_cobro.map((k) => (ped.has(k.id) ? { ...k, anticipo_pago_id: `local:${op.key}`, cobrable: false, pago_contado_10: !!ped.get(k.id).contado } : k)),
        devoluciones_pendientes: out.devoluciones_pendientes.map((d) => (dev.has(d.id) ? { ...d, restante: Math.max(0, r2(d.restante - dev.get(d.id)!)) } : d)),
        creditos: out.creditos.map((k) => (cred.has(`nc:${k.id}`) ? { ...k, saldo_pendiente: Math.min(0, r2(k.saldo_pendiente + cred.get(`nc:${k.id}`)!)) } : k)),
        a_cuenta: out.a_cuenta.map((k) => (cred.has(`ac:${k.pago_id}`) ? { ...k, disponible: Math.max(0, r2(k.disponible - cred.get(`ac:${k.pago_id}`)!)) } : k)),
        pagos_recientes: [
          { id: `local:${op.key}`, fecha_pago: op.capturadoAt.slice(0, 10), monto: r2(totalMetodos), estado: "sin_enviar", forma_pago: null, verificado: false, eliminable: false },
          ...out.pagos_recientes,
        ],
        cliente: { ...out.cliente, saldo_proyectado: r2(Number(out.cliente.saldo_proyectado ?? out.cliente.saldo_actual) - montoDeCobro(c)) },
      }
    }
  }
  for (const { p } of de<any>(vivas(ops), "devolucion.registrar")) {
    if (p.cliente_id !== cc.id || out.devoluciones_pendientes.some((d) => d.id === p.id)) continue
    const total = r2((p.items || []).reduce((s: number, i: any) => s + Number(i.cantidad || 0) * Number(i.precio_venta_original || 0), 0))
    out = { ...out, devoluciones_pendientes: [{ id: p.id, numero_devolucion: "Sin enviar", pedido_id: p.pedido_id ?? null, monto_total: total, restante: total }, ...out.devoluciones_pendientes] }
  }
  return out
}

/** Cuenta corriente vacía de un cliente dado de alta acá (o que todavía no se descargó). */
export function cuentaVacia(c: Cliente): CuentaCliente {
  return { id: c.id, cliente: c, comprobantes: [], creditos: [], a_cuenta: [], total_a_favor: 0, pedidos_cobro: [], devoluciones_pendientes: [], pagos_recientes: [], comprados: [], habituales: [] }
}

// ─── Viajes ──────────────────────────────────────────────────────────────────

export function viajesVisibles(filas: ViajeVendedor[], ops: ItemOutbox[]): ViajeVendedor[] {
  const ids = new Set(filas.map((v) => v.id))
  const estados = new Map(de<OpViajeEstado>(vivas(ops), "viaje.estado").map((x) => [x.p.viaje_id, x.p.estado]))
  const noVa = de<OpViajeNoVa>(vivas(ops), "viaje.cliente_no_va")
  // Pedidos tomados acá sin enviar: el cliente ya cuenta como "pedido levantado"
  const levantados = new Map(de<OpPedido>(vivas(ops), "pedido.crear").map((x) => [x.p.cliente_id, x.p]))

  const out = filas.map((v): ViajeVendedor => {
    const estado = estados.get(v.id)
    const resumen = estado ? { ...v.resumen, estado } : v.resumen
    const marcas = new Map(noVa.filter((x) => x.p.viaje_id === v.id).map((x) => [x.p.cliente_id, x.p.no_va]))
    const clientes = v.clientes?.map((c): ClienteViaje => {
      const local = levantados.get(c.id)
      const pedido = c.pedido ?? (local && resumen.estado === "en_curso" ? { id: `local:${local.local_id}`, numero_pedido: null, total: local.vista.total, estado: "pendiente" } : null)
      const va = marcas.has(c.id) ? !marcas.get(c.id) : c.estado_viaje !== "no_va"
      // Misma regla que el servidor: "no va" gana aunque haya pedido
      return { ...c, pedido, estado_viaje: !va ? "no_va" : pedido ? "pedido_levantado" : "pendiente" }
    })
    return { ...v, resumen, viaje: v.viaje && estado ? { ...v.viaje, estado } : v.viaje, clientes }
  })
  for (const { p } of de<any>(vivas(ops), "viaje.crear")) {
    if (ids.has(p.id)) continue
    const zonas = (p.vista?.zonas || []) as Array<{ id: string; nombre: string }>
    out.unshift({
      id: p.id,
      sinEnviar: true,
      resumen: { id: p.id, nombre: p.nombre || p.vista?.nombre || "Viaje nuevo", estado: estados.get(p.id) || "en_curso", fecha_inicio: p.fecha_inicio, fecha_fin_estimada: p.fecha_fin_estimada || null, zonas },
    })
  }
  return out
}
