// Mutaciones de la app Vendedor (outbox). Ver MOBILE.md → "Vendedor" y §6.
//
// Cada handler ejecuta la MISMA lógica que la web:
//  - pedidos: las server actions de lib/actions/pedidos.ts, dentro del contexto de
//    captura (precios vigentes cuando el vendedor los vio: lib/mobile/contexto-captura.ts);
//  - clientes, cobros, devoluciones, viajes: el route handler de la web, invocado en
//    proceso con la sesión (bearer) del request original. Cero duplicación de reglas.
// Y devuelve `replica`: las filas ya actualizadas de los datasets afectados.
//
// Errores: respuesta 4xx de la web / regla de negocio ⇒ RechazoNegocio (definitivo, el
// vendedor lo ve). Cualquier otra cosa (5xx, red, base) ⇒ transitorio, se reintenta.

import { POST as clientesPOST } from "@/app/api/vendedor/clientes/route"
import { PATCH as clientePATCH } from "@/app/api/vendedor/cliente/[id]/route"
import { PUT as bonificacionesPUT } from "@/app/api/vendedor/cliente/[id]/bonificaciones/route"
import { POST as viajesPOST } from "@/app/api/vendedor/viajes/route"
import { PATCH as viajePATCH } from "@/app/api/vendedor/viajes/[id]/route"
import { POST as cobroPOST } from "@/app/api/viajante/cobro/route"
import { DELETE as cobroDELETE } from "@/app/api/viajante/cobro/[id]/route"
import { POST as devolucionPOST } from "@/app/api/viajante/devolucion/route"
import {
  actualizarCantidadItem,
  agregarItemPedido,
  aplicarCondicionesPedidoVendedor,
  confirmarPedidoVendedor,
  createPedido,
  eliminarItemPedido,
  softDeletePedido,
} from "@/lib/actions/pedidos"
import { esPedidoEditable, motivoBloqueo } from "@/lib/pedidos/estados"
import type { BonifPedido } from "@/lib/pricing/segmento"
import { vigenciaDelPedido } from "@/lib/vendedor/vigencia-precios"
import type { FilaReplica } from "../contrato"
import { conCaptura, type CapturaPedido } from "../contexto-captura"
import { insumosAFecha, verificarPreciosCapturados } from "../precios-integridad"
import { cargarClientesVendedor, cargarCuentaCliente, cargarPedidosVendedor, cargarViajeVendedor, vendedorIdsDe } from "../sync/vendedor"
import { esUuid } from "../uuid"
import { subirFotosPendientes } from "@/lib/cobranzas/fotos"
import { llamarRuta } from "./rutas"
import { RechazoNegocio, type CtxOutbox, type HandlerDef } from "./tipos"

const ROLES = ["vendedor"]

interface ParcheReplica {
  dataset: string
  upserts: FilaReplica[]
  deletes: string[]
}

// ─── Infraestructura ─────────────────────────────────────────────────────────

// llamarRuta (ejecutar un route handler de la web en proceso): lib/mobile/outbox/rutas.ts

async function sesionVendedor(ctx: CtxOutbox) {
  const vendedorIds = await vendedorIdsDe(ctx.supabase, ctx.sesion.user.id)
  if (!vendedorIds.length) throw new RechazoNegocio("Tu usuario no está vinculado a ningún vendedor.")
  return { vendedorIds, user: { id: ctx.sesion.user.id } }
}

/**
 * Cartera y cuenta corriente son parches INDEPENDIENTES: si uno no se puede armar, el otro
 * viaja igual (visto contra producción: una consulta rota de la cuenta corriente dejaba al
 * equipo sin enterarse del cliente recién creado). Lo que falte llega en el próximo sync.
 */
async function parcheCliente(ctx: CtxOutbox, clienteId: string): Promise<ParcheReplica[]> {
  const sesion = await sesionVendedor(ctx)
  const [fila, cc] = await Promise.allSettled([
    cargarClientesVendedor(ctx, [clienteId]),
    cargarCuentaCliente(ctx.supabase, sesion, clienteId),
  ])
  const out: ParcheReplica[] = []
  if (fila.status === "fulfilled") out.push({ dataset: "vendedor_clientes", upserts: fila.value, deletes: fila.value.length ? [] : [clienteId] })
  else console.error("[outbox/vendedor] parche vendedor_clientes:", fila.reason)
  if (cc.status === "fulfilled") out.push({ dataset: "vendedor_cc", upserts: cc.value ? [cc.value] : [], deletes: cc.value ? [] : [clienteId] })
  else console.error("[outbox/vendedor] parche vendedor_cc:", cc.reason)
  return out
}

async function parchePedido(ctx: CtxOutbox, pedidoId: string): Promise<ParcheReplica> {
  const { vendedorIds } = await sesionVendedor(ctx)
  const filas = await cargarPedidosVendedor(ctx.supabase, vendedorIds, [pedidoId])
  return { dataset: "vendedor_pedidos", upserts: filas, deletes: filas.length ? [] : [pedidoId] }
}

/** Un parche que falla no debe convertir en "transitoria" una operación YA aplicada. */
async function parches(...fns: Array<() => Promise<ParcheReplica | ParcheReplica[]>>): Promise<ParcheReplica[]> {
  const out: ParcheReplica[] = []
  for (const fn of fns) {
    try {
      const r = await fn()
      out.push(...(Array.isArray(r) ? r : [r]))
    } catch (e) {
      console.error("[outbox/vendedor] parche de réplica:", e)
    }
  }
  return out
}

// ─── Pedidos ─────────────────────────────────────────────────────────────────

interface ItemPedido {
  articulo_id: string
  cantidad: number
  /** Precio unitario al cliente que mostró el equipo */
  precio: number
  /** Renglón existente (al editar un pedido que ya está en el servidor) */
  detalle_id?: string | null
  /**
   * true = el equipo mostró el precio YA GUARDADO del renglón (pedido confirmado que se
   * edita sin cambiar condiciones: la web tampoco lo re-precia). No se verifica contra
   * el motor: ese precio lo fijó el servidor cuando se tomó el renglón.
   */
  precio_fijo?: boolean
}

interface CondPedido {
  metodo_facturacion_pedido?: string | null
  lista_precio_pedido_id?: string | null
  bonif_pedido?: BonifPedido | null
}

interface PayloadPedido {
  /** Id del pedido en el equipo. Misma clave lógica entre reintentos y re-ediciones. */
  local_id: string
  /** Presente = edición de un pedido que ya existe en el servidor */
  pedido_id?: string | null
  cliente_id: string
  items: ItemPedido[]
  cond?: CondPedido | null
  observaciones?: string | null
  /**
   * Hora (servidor) de los precios que el equipo tenía a la vista: la frescura más
   * VIEJA de sus datasets precios_*. Ver MOBILE.md §18 "Vigencia de precios".
   */
  precios_al?: string | null
  /**
   * false = solo guardar renglones (edición de cantidades desde el detalle del pedido:
   * la web tampoco confirma ahí). Default true = "Confirmar pedido" / "Guardar cambios".
   */
  confirmar?: boolean
}

function validarPedido(p: PayloadPedido): string | null {
  if (!esUuid(p?.local_id)) return "Pedido inválido"
  if (!esUuid(p?.cliente_id)) return "Cliente inválido"
  if (p.pedido_id != null && !esUuid(p.pedido_id)) return "Pedido inválido"
  if (!Array.isArray(p.items) || !p.items.length) return "El pedido no tiene artículos"
  if (p.items.length > 600) return "Demasiados artículos en un pedido"
  const vistos = new Set<string>()
  for (const i of p.items) {
    if (!esUuid(i?.articulo_id)) return "Artículo inválido"
    if (!(Number(i.cantidad) > 0) || !Number.isFinite(Number(i.cantidad))) return "Cantidad inválida"
    if (!(Number(i.precio) >= 0)) return "Precio inválido"
    if (vistos.has(i.articulo_id)) return "Artículo repetido en el pedido"
    vistos.add(i.articulo_id)
  }
  return null
}

const fechaArgentina = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })

const overridesDe = (c?: CondPedido | null) => ({
  ...(c?.metodo_facturacion_pedido ? { metodo_facturacion_pedido: c.metodo_facturacion_pedido } : {}),
  ...(c?.lista_precio_pedido_id ? { lista_precio_pedido_id: c.lista_precio_pedido_id } : {}),
  ...(c?.bonif_pedido ? { bonif_pedido: c.bonif_pedido } : {}),
})

/**
 * Lleva los renglones NO bonificados del pedido al estado final que capturó el equipo
 * (cantidades absolutas). Idempotente: aplicarlo dos veces deja lo mismo.
 */
async function reconciliarRenglones(ctx: CtxOutbox, pedidoId: string, items: ItemPedido[]) {
  const { data: actuales, error } = await ctx.supabase
    .from("pedidos_detalle")
    .select("id, articulo_id, cantidad, es_bonificado")
    .eq("pedido_id", pedidoId)
  if (error) throw error
  const libres: Array<{ id: string; articulo_id: string; cantidad: number }> = (actuales || []).filter((d: any) => !d.es_bonificado)
  const tomar = (pred: (d: { id: string; articulo_id: string }) => boolean) => {
    const k = libres.findIndex(pred)
    return k >= 0 ? libres.splice(k, 1)[0]! : null
  }
  // 1º los que el equipo identificó por renglón; 2º por artículo (alta reintentada)
  const destino = new Map<ItemPedido, { id: string; cantidad: number } | null>()
  for (const it of items) if (it.detalle_id) destino.set(it, tomar((d) => d.id === it.detalle_id))
  for (const it of items) if (!destino.get(it)) destino.set(it, tomar((d) => d.articulo_id === it.articulo_id))

  for (const sobra of libres) await eliminarItemPedido(sobra.id, pedidoId)
  for (const it of items) {
    const d = destino.get(it)
    if (!d) await agregarItemPedido(pedidoId, it.articulo_id, Number(it.cantidad))
    else if (Number(d.cantidad) !== Number(it.cantidad)) await actualizarCantidadItem(d.id, pedidoId, Number(it.cantidad))
  }
}

async function aplicarPedido(ctx: CtxOutbox, m: { payload: PayloadPedido; capturado_at: string; idempotency_key: string; device_id: string; tipo: string }) {
  const p = m.payload
  const sesion = await sesionVendedor(ctx)

  const { data: cliente } = await ctx.supabase.from("clientes").select("id, nombre, activo, vendedor_id").eq("id", p.cliente_id).maybeSingle()
  if (!cliente) throw new RechazoNegocio("El cliente ya no existe.")
  if (cliente.activo === false) throw new RechazoNegocio(`${cliente.nombre} fue dado de baja: el pedido no se puede tomar.`)
  if (!ctx.sesion.roles.includes("admin") && !sesion.vendedorIds.includes(cliente.vendedor_id)) {
    throw new RechazoNegocio(`${cliente.nombre} ya no está asignado a vos: el pedido no se puede tomar.`)
  }

  // ¿Ya existe? (reintento tras un corte, o re-edición de un pedido que sí había llegado)
  let pedidoId: string | null = p.pedido_id || null
  if (!pedidoId) {
    const { data: previo, error } = await ctx.admin.from("pedidos").select("id").eq("movil_local_id", p.local_id).maybeSingle()
    // Sin la migración 20260921_mobile_vendedor.sql no hay forma segura de no duplicar:
    // queda pendiente en el equipo (nada se pierde) hasta que se aplique.
    if (error) throw new Error(`pedidos.movil_local_id: ${error.message}`)
    pedidoId = previo?.id ?? null
  }
  if (pedidoId) {
    const { data: ped } = await ctx.supabase.from("pedidos").select("id, estado, vendedor_id, cliente_id, eliminado_at").eq("id", pedidoId).maybeSingle()
    if (!ped || ped.eliminado_at) throw new RechazoNegocio("El pedido fue eliminado: los cambios no se aplicaron.")
    if (ped.cliente_id !== p.cliente_id) throw new RechazoNegocio("El pedido es de otro cliente.")
    if (!esPedidoEditable(ped.estado)) throw new RechazoNegocio(motivoBloqueo(ped.estado) || "El pedido ya no se puede modificar.")
  }

  // Precios: los vigentes cuando el vendedor los vio (mismo motor, insumos reconstruidos).
  // TOPE de 24 hs: con precios más viejos que eso al capturar, rige el precio del sistema
  // al INGRESAR el pedido y la diferencia con lo que mostró el equipo es esperable (la app
  // se lo avisó con un cartel): no es una alerta de integridad. lib/vendedor/vigencia-precios.ts
  const { vigenciaAt, garantizada } = vigenciaDelPedido(m.capturado_at, p.precios_al)
  const articuloIds = [...new Set(p.items.map((i) => i.articulo_id))]
  const reconstruido = await insumosAFecha(ctx.admin, p.cliente_id, articuloIds, vigenciaAt)
  const faltan = articuloIds.filter((id) => !reconstruido.articulos.some((a: any) => a.id === id))
  if (faltan.length) throw new RechazoNegocio("Hay artículos del pedido que ya no existen en el catálogo.")
  const overrides = overridesDe(p.cond)
  const verificacion = !garantizada ? null : await verificarPreciosCapturados(ctx.admin, {
    clienteId: p.cliente_id,
    capturadoAt: vigenciaAt,
    overrides,
    items: p.items.filter((i) => !i.precio_fijo).map((i) => ({ articulo_id: i.articulo_id, precio: Number(i.precio) })),
    contexto: { usuarioId: ctx.sesion.user.id, deviceId: m.device_id, idempotencyKey: m.idempotency_key, tipo: m.tipo },
    precargado: reconstruido,
  })

  const captura: CapturaPedido = {
    clienteId: p.cliente_id,
    vigenciaAt,
    insumos: reconstruido.insumos,
    articulos: new Map(reconstruido.articulos.map((a: any) => [a.id, a])),
    localId: p.local_id,
    fecha: fechaArgentina(m.capturado_at),
  }

  const creado = !pedidoId
  const resultado = await conCaptura(captura, async () => {
    if (!pedidoId) {
      const pedido: any = await createPedido({
        cliente_id: p.cliente_id,
        items: p.items.map((i) => ({ producto_id: i.articulo_id, cantidad: Number(i.cantidad), precio_unitario: 0, descuento: 0 })),
        observaciones: p.observaciones || undefined,
        estado_inicial: "pendiente",
        ...overrides,
      })
      pedidoId = pedido.id as string
      // createPedido no es transaccional: si se cortó a mitad, el reintento entra por
      // la rama de abajo (movil_local_id) y completa los renglones que falten.
      return { numero_pedido: pedido.numero_pedido as string | null, total: Number(pedido.total) }
    }
    await aplicarCondicionesPedidoVendedor(pedidoId, {
      metodo_facturacion_pedido: p.cond?.metodo_facturacion_pedido || null,
      lista_precio_pedido_id: p.cond?.lista_precio_pedido_id || null,
      bonif_pedido: p.cond?.bonif_pedido || null,
    })
    await reconciliarRenglones(ctx, pedidoId, p.items)
    if (p.confirmar === false) {
      const { data: ped } = await ctx.supabase.from("pedidos").select("numero_pedido, total").eq("id", pedidoId).maybeSingle()
      return { numero_pedido: (ped?.numero_pedido ?? null) as string | null, total: Number(ped?.total) || 0 }
    }
    const r = await confirmarPedidoVendedor(pedidoId, {
      observaciones: p.observaciones ?? "",
      metodo_facturacion_pedido: p.cond?.metodo_facturacion_pedido || "",
    })
    return { numero_pedido: r.numero_pedido, total: Number(r.total) }
  })

  return {
    pedido_id: pedidoId,
    numero_pedido: resultado.numero_pedido,
    total: resultado.total,
    creado,
    precios_garantizados: garantizada,
    precios_verificados: verificacion ? verificacion.ok : null,
    replica: await parches(
      () => parchePedido(ctx, pedidoId!),
      () => parcheCliente(ctx, p.cliente_id),
    ),
  }
}

const pedidoCrear: HandlerDef<PayloadPedido> = {
  tipo: "pedido.crear",
  roles: ROLES,
  validar: (p) => validarPedido({ ...p, pedido_id: null }),
  aplicar: (ctx, m) => aplicarPedido(ctx, { ...m, payload: { ...m.payload, pedido_id: null } }),
}

const pedidoEditar: HandlerDef<PayloadPedido> = {
  tipo: "pedido.editar",
  roles: ROLES,
  validar: (p) => (esUuid(p?.pedido_id) ? validarPedido(p) : "Pedido inválido"),
  aplicar: (ctx, m) => aplicarPedido(ctx, m),
}

const pedidoEliminar: HandlerDef<{ pedido_id: string }> = {
  tipo: "pedido.eliminar",
  roles: ROLES,
  validar: (p) => (esUuid(p?.pedido_id) ? null : "Pedido inválido"),
  async aplicar(ctx, m) {
    const { vendedorIds } = await sesionVendedor(ctx)
    const { data: ped } = await ctx.supabase.from("pedidos").select("id, estado, vendedor_id, cliente_id").eq("id", m.payload.pedido_id).maybeSingle()
    if (!ped) return { ya_eliminado: true, replica: [{ dataset: "vendedor_pedidos", upserts: [], deletes: [m.payload.pedido_id] }] }
    if (!ctx.sesion.roles.includes("admin") && !vendedorIds.includes(ped.vendedor_id)) throw new RechazoNegocio("El pedido no está asignado a vos.")
    if (ped.estado !== "eliminado") {
      if (!esPedidoEditable(ped.estado)) throw new RechazoNegocio(motivoBloqueo(ped.estado) || "El pedido ya no se puede eliminar.")
      try {
        await softDeletePedido(ped.id)
      } catch (e: any) {
        // Única regla de negocio propia de softDeletePedido: comprobante vivo
        if (/comprobante/i.test(e?.message || "")) throw new RechazoNegocio(e.message)
        throw e
      }
    }
    return { replica: await parches(() => parchePedido(ctx, ped.id), () => parcheCliente(ctx, ped.cliente_id)) }
  },
}

// ─── Clientes ────────────────────────────────────────────────────────────────

const clienteCrear: HandlerDef<Record<string, any>> = {
  tipo: "cliente.crear",
  roles: ROLES,
  validar: (p) => (esUuid(p?.id) && String(p?.nombre || p?.razon_social || "").trim() ? null : "Datos del cliente incompletos"),
  async aplicar(ctx, m) {
    const { data: previo } = await ctx.admin.from("clientes").select("id").eq("id", m.payload.id).maybeSingle()
    if (!previo) {
      await llamarRuta(clientesPOST, ctx, {
        ruta: "/api/vendedor/clientes",
        method: "POST",
        body: m.payload,
        rechazo: (status, body) => (status === 409 ? `${body?.error || "Ya existe un cliente con ese CUIT"}. Buscalo en tu cartera o pedile a oficina que te lo asigne.` : null),
      })
    }
    return { cliente_id: m.payload.id, replica: await parches(() => parcheCliente(ctx, m.payload.id)) }
  },
}

/** Compare-and-set por campo (MOBILE.md §6): lo que otro cambió mientras tanto NO se pisa. */
const clienteEditar: HandlerDef<{ cliente_id: string; cambios: Record<string, { antes: unknown; despues: unknown }> }> = {
  tipo: "cliente.editar",
  roles: ROLES,
  validar: (p) => (esUuid(p?.cliente_id) && p?.cambios && typeof p.cambios === "object" && Object.keys(p.cambios).length ? null : "Cambios inválidos"),
  async aplicar(ctx, m) {
    const { cliente_id, cambios } = m.payload
    const campos = Object.keys(cambios)
    const { data: actual } = await ctx.supabase.from("clientes").select("*").eq("id", cliente_id).maybeSingle()
    if (!actual) throw new RechazoNegocio("El cliente ya no existe o no está asignado a vos.")
    const igual = (a: unknown, b: unknown) => (a ?? "") === (b ?? "") || String(a ?? "").trim() === String(b ?? "").trim()
    const aplicables: Record<string, unknown> = {}
    const pisados: string[] = []
    for (const c of campos) {
      if (igual(actual[c], cambios[c]!.despues)) continue // ya está como lo quería
      if (igual(actual[c], cambios[c]!.antes)) aplicables[c] = cambios[c]!.despues
      else pisados.push(c)
    }
    if (Object.keys(aplicables).length) {
      await llamarRuta(clientePATCH, ctx, { ruta: `/api/vendedor/cliente/${cliente_id}`, method: "PATCH", params: { id: cliente_id }, body: aplicables })
    }
    const replica = await parches(() => parcheCliente(ctx, cliente_id))
    if (pisados.length) {
      // Lo aplicable quedó aplicado; el rechazo informa qué NO se tocó
      throw new RechazoNegocio(`Otra persona cambió ${pisados.join(", ")} mientras estabas sin señal: esos campos no se modificaron. Revisá la ficha.`, "cas_parcial")
    }
    return { replica }
  },
}

const clienteBonificaciones: HandlerDef<{ cliente_id: string; viajante?: Record<string, number>; mercaderia?: Record<string, number> }> = {
  tipo: "cliente.bonificaciones",
  roles: ROLES,
  validar: (p) => (esUuid(p?.cliente_id) && (p.viajante || p.mercaderia) ? null : "Bonificaciones inválidas"),
  async aplicar(ctx, m) {
    const { cliente_id, ...body } = m.payload
    await llamarRuta(bonificacionesPUT, ctx, { ruta: `/api/vendedor/cliente/${cliente_id}/bonificaciones`, method: "PUT", params: { id: cliente_id }, body })
    return { replica: await parches(() => parcheCliente(ctx, cliente_id)) }
  },
}

// ─── Cobros y devoluciones ───────────────────────────────────────────────────

/** Payload = body de POST /api/viajante/cobro (la clave de idempotencia es la de la operación). */
const cobroRegistrar: HandlerDef<Record<string, any>> = {
  tipo: "cobro.registrar",
  roles: ROLES,
  validar: (p) => (Array.isArray(p?.clientes) && p.clientes.length && Array.isArray(p?.metodos) && p.metodos.length ? null : "Cobro incompleto"),
  async aplicar(ctx, m) {
    // Fotos capturadas SIN señal: viajan en base64 dentro del cobro (fotos_pendientes) y
    // se suben acá, antes de registrar, para que queden en pago_comprobantes como las demás.
    const { fotos_pendientes, ...resto } = m.payload
    const subidas = await subirFotosPendientes(ctx.admin, fotos_pendientes)
    const comprobante_urls = [...(Array.isArray(resto.comprobante_urls) ? resto.comprobante_urls : []), ...subidas.map((f) => f.url)]
    const r = await llamarRuta(cobroPOST, ctx, { ruta: "/api/viajante/cobro", method: "POST", body: { ...resto, comprobante_urls, idempotency_key: m.idempotency_key } })
    const clienteIds: string[] = [...new Set<string>(m.payload.clientes.map((c: any) => c.cliente_id).filter(esUuid))]
    return { ...r, replica: await parches(...clienteIds.map((id) => () => parcheCliente(ctx, id))) }
  },
}

const cobroAnular: HandlerDef<{ pago_id: string; cliente_id: string }> = {
  tipo: "cobro.anular",
  roles: ROLES,
  validar: (p) => (esUuid(p?.pago_id) && esUuid(p?.cliente_id) ? null : "Cobro inválido"),
  async aplicar(ctx, m) {
    const { pago_id, cliente_id } = m.payload
    const { data: pago } = await ctx.supabase.from("pagos_clientes").select("id, estado").eq("id", pago_id).maybeSingle()
    // Ya anulado (reintento tras un corte): éxito, no un rechazo
    if (pago && pago.estado !== "anulado") {
      await llamarRuta(cobroDELETE, ctx, { ruta: `/api/viajante/cobro/${pago_id}`, method: "DELETE", params: { id: pago_id } })
    }
    return { replica: await parches(() => parcheCliente(ctx, cliente_id)) }
  },
}

/** Payload = body de POST /api/viajante/devolucion + `id` generado en el equipo. */
const devolucionRegistrar: HandlerDef<Record<string, any>> = {
  tipo: "devolucion.registrar",
  roles: ROLES,
  validar: (p) => (esUuid(p?.id) && esUuid(p?.cliente_id) && Array.isArray(p?.items) && p.items.length ? null : "Devolución incompleta"),
  async aplicar(ctx, m) {
    const { data: previa } = await ctx.admin.from("devoluciones").select("id, numero_devolucion").eq("id", m.payload.id).maybeSingle()
    const r = previa
      ? { devolucion_id: previa.id, numero_devolucion: previa.numero_devolucion }
      : await llamarRuta(devolucionPOST, ctx, { ruta: "/api/viajante/devolucion", method: "POST", body: m.payload })
    return { ...r, replica: await parches(() => parcheCliente(ctx, m.payload.cliente_id)) }
  },
}

// ─── Viajes ──────────────────────────────────────────────────────────────────

async function parcheViaje(ctx: CtxOutbox, id: string): Promise<ParcheReplica> {
  const fila = await cargarViajeVendedor(ctx, id)
  const viaje = (fila as any)?.viaje
  const resumen = viaje && { id, nombre: viaje.nombre, estado: viaje.estado, fecha_inicio: viaje.fecha_inicio, fecha_fin_estimada: viaje.fecha_fin_estimada, zonas: viaje.zonas }
  return { dataset: "vendedor_viajes", upserts: fila ? [{ ...fila, resumen }] : [], deletes: fila ? [] : [id] }
}

const viajeCrear: HandlerDef<Record<string, any>> = {
  tipo: "viaje.crear",
  roles: ROLES,
  validar: (p) => (esUuid(p?.id) && p?.fecha_inicio && Array.isArray(p?.zona_ids) && p.zona_ids.length ? null : "Viaje incompleto"),
  async aplicar(ctx, m) {
    const { data: previo } = await ctx.admin.from("viajes").select("id").eq("id", m.payload.id).maybeSingle()
    if (!previo) await llamarRuta(viajesPOST, ctx, { ruta: "/api/vendedor/viajes", method: "POST", body: m.payload })
    else {
      // Alta cortada entre el viaje y sus zonas: completar (viaje_zonas no es transaccional en la web)
      const { data: vz } = await ctx.admin.from("viaje_zonas").select("zona_id").eq("viaje_id", m.payload.id)
      const tiene = new Set((vz || []).map((z: any) => z.zona_id))
      const faltan = (m.payload.zona_ids as string[]).filter((z) => !tiene.has(z))
      if (faltan.length) {
        const { error } = await ctx.admin.from("viaje_zonas").insert(faltan.map((zona_id) => ({ viaje_id: m.payload.id, zona_id })))
        if (error) throw error
      }
    }
    return { viaje_id: m.payload.id, replica: await parches(() => parcheViaje(ctx, m.payload.id)) }
  },
}

/** Valor ABSOLUTO (va / no va): reenviar es inocuo. */
const viajeClienteNoVa: HandlerDef<{ viaje_id: string; cliente_id: string; no_va: boolean }> = {
  tipo: "viaje.cliente_no_va",
  roles: ROLES,
  validar: (p) => (esUuid(p?.viaje_id) && esUuid(p?.cliente_id) && typeof p?.no_va === "boolean" ? null : "Datos inválidos"),
  async aplicar(ctx, m) {
    const { viaje_id, cliente_id, no_va } = m.payload
    await llamarRuta(viajePATCH, ctx, { ruta: `/api/vendedor/viajes/${viaje_id}`, method: "PATCH", params: { id: viaje_id }, body: { accion: "cliente_no_va", cliente_id, no_va } })
    return { replica: await parches(() => parcheViaje(ctx, viaje_id)) }
  },
}

/** Transición idempotente: completar dos veces = una. */
const viajeEstado: HandlerDef<{ viaje_id: string; estado: "completado" | "en_curso" }> = {
  tipo: "viaje.estado",
  roles: ROLES,
  validar: (p) => (esUuid(p?.viaje_id) && ["completado", "en_curso"].includes(p?.estado) ? null : "Estado inválido"),
  async aplicar(ctx, m) {
    const { viaje_id, estado } = m.payload
    await llamarRuta(viajePATCH, ctx, { ruta: `/api/vendedor/viajes/${viaje_id}`, method: "PATCH", params: { id: viaje_id }, body: { accion: "estado", estado } })
    return { replica: await parches(() => parcheViaje(ctx, viaje_id)) }
  },
}

export const HANDLERS_VENDEDOR: HandlerDef[] = [
  pedidoCrear, pedidoEditar, pedidoEliminar,
  clienteCrear, clienteEditar, clienteBonificaciones,
  cobroRegistrar, cobroAnular, devolucionRegistrar,
  viajeCrear, viajeClienteNoVa, viajeEstado,
]
