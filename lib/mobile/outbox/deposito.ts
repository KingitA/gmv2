// Mutaciones de la app Depósito (outbox). Ver MOBILE.md → "Depósito" y §6.
//
// Cada handler llama a la MISMA función que usa la API route web
// (lib/deposito/*) y devuelve, además del resultado, `replica`: las filas ya
// actualizadas de los datasets afectados. El dispositivo las aplica a su réplica
// apenas recibe la respuesta, así la pantalla nunca "vuelve atrás" entre que se
// envía la operación y llega el próximo sync.
//
// Errores: ErrorDeposito 4xx ⇒ RechazoNegocio (definitivo, el operario lo ve);
// cualquier otra cosa (5xx, red, base) ⇒ transitorio, el outbox reintenta.

import {
  aplicarAjusteStock,
  aplicarDatosArticuloCAS,
  enviarArticuloAInexistente,
  type CambiosArticulo,
  type TipoAjusteStock,
} from "@/lib/deposito/articulos"
import { confirmarDevolucion, type ItemDevolucionConfirmado } from "@/lib/deposito/devoluciones"
import { abrirPicking, aplicarPickingItem, cerrarPicking, ErrorDeposito } from "@/lib/deposito/picking"
import { getUsuarioActual } from "@/lib/deposito/preparadores"
import {
  aplicarItemRecepcion,
  finalizarRecepcion,
  guardarConformidad,
  obtenerOCrearRecepcion,
  type ConformidadTransporte,
} from "@/lib/deposito/recepciones"
import type { FilaReplica } from "../contrato"
import { cargarArticulosDeposito, cargarPedidosDeposito, cargarRecepcionDeposito } from "../sync/deposito"
import { RechazoNegocio, type CtxOutbox, type HandlerDef } from "./tipos"

const ROLES = ["deposito"]
const UUID = /^[0-9a-f-]{36}$/i
const esId = (v: unknown): v is string => typeof v === "string" && UUID.test(v)

export interface ParcheReplica {
  dataset: string
  upserts: FilaReplica[]
  deletes: string[]
}

/** Convierte los errores de negocio en rechazo definitivo; el resto sigue como transitorio. */
async function negocio<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ErrorDeposito && e.status >= 400 && e.status < 500) {
      throw new RechazoNegocio(e.message, typeof e.extra.codigo === "string" ? e.extra.codigo : undefined)
    }
    throw e
  }
}

async function parchePedido(ctx: CtxOutbox, pedidoId: string): Promise<ParcheReplica> {
  const filas = await cargarPedidosDeposito(ctx.supabase, [pedidoId])
  return { dataset: "deposito_pedidos", upserts: filas, deletes: filas.length ? [] : [pedidoId] }
}

async function parcheRecepcion(ctx: CtxOutbox, ordenId: string): Promise<ParcheReplica> {
  const fila = await cargarRecepcionDeposito(ctx.supabase, ordenId)
  return { dataset: "deposito_recepciones", upserts: fila ? [fila] : [], deletes: fila ? [] : [ordenId] }
}

async function parcheArticulo(ctx: CtxOutbox, articuloId: string): Promise<ParcheReplica> {
  const filas = await cargarArticulosDeposito(ctx.admin, [articuloId])
  return { dataset: "deposito_articulos", upserts: filas, deletes: filas.length ? [] : [articuloId] }
}

// ─── Picking ─────────────────────────────────────────────────────────────────

const pickingAbrir: HandlerDef<{ pedido_id: string }> = {
  tipo: "picking.abrir",
  roles: ROLES,
  validar: (p) => (esId(p?.pedido_id) ? null : "Pedido inválido"),
  async aplicar(ctx, m) {
    try {
      await abrirPicking(ctx.supabase, m.payload.pedido_id)
    } catch (e) {
      // Ya no está para preparar (lo cerró otro): no es un error del operario
      if (!(e instanceof ErrorDeposito && e.status === 404)) throw e
    }
    return { replica: [await parchePedido(ctx, m.payload.pedido_id)] }
  },
}

interface PayloadPickingItem {
  pedido_id: string
  pedido_detalle_id: string
  cantidad_preparada: number
  es_faltante: boolean
}

/** Valor ABSOLUTO por renglón; el renglón es de quien lo reclamó primero (MOBILE.md → Depósito). */
const pickingItem: HandlerDef<PayloadPickingItem> = {
  tipo: "picking.item",
  roles: ROLES,
  validar: (p) =>
    esId(p?.pedido_detalle_id) && esId(p?.pedido_id) && Number.isFinite(Number(p?.cantidad_preparada)) && Number(p.cantidad_preparada) >= 0
      ? null
      : "Renglón o cantidad inválidos",
  async aplicar(ctx, m) {
    const p = m.payload
    const r = await negocio(() =>
      aplicarPickingItem(ctx.supabase, {
        pedido_detalle_id: p.pedido_detalle_id,
        cantidad_preparada: Number(p.cantidad_preparada),
        es_faltante: !!p.es_faltante,
        fecha: m.capturado_at,
        exigirPedidoAbierto: true,
      }),
    )
    return { estado_item: r.estado_item, preparado_por: r.preparado_por, replica: [await parchePedido(ctx, r.pedido_id || p.pedido_id)] }
  },
}

const pickingCerrar: HandlerDef<{ pedido_id: string }> = {
  tipo: "picking.cerrar",
  roles: ROLES,
  validar: (p) => (esId(p?.pedido_id) ? null : "Pedido inválido"),
  async aplicar(ctx, m) {
    const r = await negocio(() => cerrarPicking(ctx.supabase, m.payload.pedido_id))
    return { ...r, replica: [await parchePedido(ctx, m.payload.pedido_id)] }
  },
}

// ─── Recepción de mercadería ─────────────────────────────────────────────────
// Todo se direcciona por la OC: la recepción se crea sola en el servidor la
// primera vez (el handheld puede haber empezado a contar sin señal).

async function recepcionAbierta(ctx: CtxOutbox, ordenId: string) {
  const rec = await negocio(() => obtenerOCrearRecepcion(ctx.supabase, ordenId, ctx.sesion.user.id))
  if (rec.estado === "finalizada") throw new RechazoNegocio("La recepción de esta orden ya se finalizó: este cambio no se aplicó.", "recepcion_finalizada")
  return rec
}

const recepcionIniciar: HandlerDef<{ orden_compra_id: string }> = {
  tipo: "recepcion.iniciar",
  roles: ROLES,
  validar: (p) => (esId(p?.orden_compra_id) ? null : "Orden inválida"),
  async aplicar(ctx, m) {
    const rec = await negocio(() => obtenerOCrearRecepcion(ctx.supabase, m.payload.orden_compra_id, ctx.sesion.user.id))
    return { recepcion_id: rec.id, replica: [await parcheRecepcion(ctx, m.payload.orden_compra_id)] }
  },
}

const recepcionConformidad: HandlerDef<{ orden_compra_id: string; conformidad: ConformidadTransporte }> = {
  tipo: "recepcion.conformidad",
  roles: ROLES,
  validar: (p) => (esId(p?.orden_compra_id) && p?.conformidad?.estado ? null : "Datos de conformidad inválidos"),
  async aplicar(ctx, m) {
    const rec = await recepcionAbierta(ctx, m.payload.orden_compra_id)
    // El primer control registrado es el que vale (dos equipos sobre la misma OC)
    if (!rec.conformidad_transporte) {
      await negocio(() => guardarConformidad(ctx.supabase, rec.id, m.payload.conformidad, m.capturado_at))
    }
    return { recepcion_id: rec.id, replica: [await parcheRecepcion(ctx, m.payload.orden_compra_id)] }
  },
}

/** Conteo ABSOLUTO por artículo (último escritor gana por línea). */
const recepcionItem: HandlerDef<{ orden_compra_id: string; articulo_id: string; cantidad_fisica: number }> = {
  tipo: "recepcion.item",
  roles: ROLES,
  validar: (p) =>
    esId(p?.orden_compra_id) && esId(p?.articulo_id) && Number.isFinite(Number(p?.cantidad_fisica)) && Number(p.cantidad_fisica) >= -1
      ? null
      : "Artículo o cantidad inválidos",
  async aplicar(ctx, m) {
    const rec = await recepcionAbierta(ctx, m.payload.orden_compra_id)
    await negocio(() => aplicarItemRecepcion(ctx.supabase, rec.id, m.payload.articulo_id, Number(m.payload.cantidad_fisica)))
    return { recepcion_id: rec.id, replica: [await parcheRecepcion(ctx, m.payload.orden_compra_id)] }
  },
}

const recepcionCerrar: HandlerDef<{ orden_compra_id: string }> = {
  tipo: "recepcion.cerrar",
  roles: ROLES,
  validar: (p) => (esId(p?.orden_compra_id) ? null : "Orden inválida"),
  async aplicar(ctx, m) {
    const rec = await negocio(() => obtenerOCrearRecepcion(ctx.supabase, m.payload.orden_compra_id, ctx.sesion.user.id))
    const r = await negocio(() => finalizarRecepcion(ctx.supabase, rec.id, { exigirResuelta: true }))
    return { ...r, replica: [await parcheRecepcion(ctx, m.payload.orden_compra_id)] }
  },
}

// ─── Devoluciones ────────────────────────────────────────────────────────────

const devolucionRecibir: HandlerDef<{ devolucion_id: string; items_confirmados: ItemDevolucionConfirmado[] }> = {
  tipo: "devolucion.recibir",
  roles: ROLES,
  validar: (p) => (esId(p?.devolucion_id) && Array.isArray(p?.items_confirmados) ? null : "Devolución inválida"),
  async aplicar(ctx, m) {
    const usuario = await getUsuarioActual(ctx.supabase)
    const r = await negocio(() =>
      confirmarDevolucion(ctx.supabase, m.payload.devolucion_id, m.payload.items_confirmados, usuario.nombre, m.capturado_at),
    )
    const articulos = [...new Set(m.payload.items_confirmados.map((i) => i.articulo_id).filter(esId))]
    const arts = await cargarArticulosDeposito(ctx.admin, articulos)
    return {
      ...r,
      replica: [
        { dataset: "deposito_devoluciones", upserts: [], deletes: [m.payload.devolucion_id] },
        { dataset: "deposito_articulos", upserts: arts, deletes: [] },
      ] satisfies ParcheReplica[],
    }
  },
}

// ─── Stock y datos de artículo ───────────────────────────────────────────────

interface PayloadAjuste {
  articulo_id: string
  tipo: TipoAjusteStock
  cantidad: number
  motivo?: string | null
  /** Stock que mostraba el handheld cuando el operario contó */
  stock_visto: number | null
}

const faltaTabla = (e: any) => e?.code === "42P01" || e?.code === "PGRST205" || /deposito_ajustes_movil/.test(e?.message || "")

/**
 * El ajuste es un CONTEO del operario: se aplica siempre (el servidor no lo
 * descarta). Si el stock cambió entre el conteo y el sync, queda una alerta para
 * la oficina. `deposito_ajustes_movil` (clave = idempotency_key) es la segunda
 * defensa: una entrada/salida nunca se suma dos veces, y deja la auditoría.
 */
const stockAjustar: HandlerDef<PayloadAjuste> = {
  tipo: "stock.ajustar",
  roles: ROLES,
  validar: (p) =>
    esId(p?.articulo_id) && ["correccion", "entrada", "salida"].includes(p?.tipo) && Number.isFinite(Number(p?.cantidad))
      ? null
      : "Ajuste inválido",
  async aplicar(ctx, m) {
    const p = m.payload
    const cantidad = Number(p.cantidad)
    const { data: art } = await ctx.admin.from("articulos").select("id, descripcion, stock_actual, activo").eq("id", p.articulo_id).maybeSingle()
    if (!art) throw new RechazoNegocio("El artículo ya no existe: el ajuste no se aplicó.", "articulo_inexistente")

    let conRegistro = true
    const { error: insErr } = await ctx.admin.from("deposito_ajustes_movil").insert({
      idempotency_key: m.idempotency_key,
      articulo_id: p.articulo_id,
      tipo: p.tipo,
      cantidad,
      motivo: p.motivo || null,
      stock_visto: p.stock_visto,
      stock_anterior: art.stock_actual ?? 0,
      usuario_id: ctx.sesion.user.id,
      device_id: m.device_id,
      capturado_at: m.capturado_at,
    })
    if (insErr?.code === "23505") {
      const { data: prev } = await ctx.admin
        .from("deposito_ajustes_movil")
        .select("stock_nuevo")
        .eq("idempotency_key", m.idempotency_key)
        .maybeSingle()
      if (prev?.stock_nuevo !== null && prev?.stock_nuevo !== undefined) {
        return { nuevoStock: Number(prev.stock_nuevo), replica: [await parcheArticulo(ctx, p.articulo_id)] }
      }
    } else if (insErr) {
      if (!faltaTabla(insErr)) throw insErr
      conRegistro = false // migración sin aplicar: queda la idempotencia de la reserva
    }

    const r = await aplicarAjusteStock(ctx.admin, p.articulo_id, cantidad, p.tipo)
    if (conRegistro) {
      await ctx.admin.from("deposito_ajustes_movil").update({ stock_nuevo: r.nuevoStock, stock_anterior: r.stockAnterior }).eq("idempotency_key", m.idempotency_key)
    }

    const cambio = p.stock_visto !== null && p.stock_visto !== undefined && Number(p.stock_visto) !== r.stockAnterior
    if (cambio) {
      await ctx.admin
        .from("mobile_alertas_integridad")
        .insert({
          tipo: "stock_conteo",
          operacion: m.tipo,
          idempotency_key: m.idempotency_key,
          usuario_id: ctx.sesion.user.id,
          device_id: m.device_id,
          capturado_at: m.capturado_at,
          detalle: {
            articulo_id: p.articulo_id,
            descripcion: art.descripcion,
            tipo: p.tipo,
            cantidad,
            motivo: p.motivo || null,
            stock_visto: p.stock_visto,
            stock_servidor_al_aplicar: r.stockAnterior,
            stock_nuevo: r.nuevoStock,
          },
        })
        .then(() => {}, () => {})
    }
    return { nuevoStock: r.nuevoStock, stock_cambio_entre_medio: cambio, replica: [await parcheArticulo(ctx, p.articulo_id)] }
  },
}

/** Datos del artículo con compare-and-set por campo: lo que otro cambió mientras tanto NO se pisa. */
const articuloDatos: HandlerDef<{ articulo_id: string; cambios: CambiosArticulo }> = {
  tipo: "articulo.datos",
  roles: ROLES,
  validar: (p) => (esId(p?.articulo_id) && p?.cambios && typeof p.cambios === "object" ? null : "Cambios inválidos"),
  async aplicar(ctx, m) {
    const r = await negocio(() => aplicarDatosArticuloCAS(ctx.admin, m.payload.articulo_id, m.payload.cambios))
    if (r.conflictos.length > 0) {
      const ok = r.aplicados.length ? " El resto de los cambios sí se guardó." : ""
      throw new RechazoNegocio(
        `${r.descripcion || "Artículo"}: otra persona cambió ${r.conflictos.join(", ")} mientras estabas sin señal y no se pisó.${ok} Abrí el artículo y revisalo.`,
        "conflicto_campos",
      )
    }
    return { aplicados: r.aplicados, replica: [await parcheArticulo(ctx, m.payload.articulo_id)] }
  },
}

const articuloInexistente: HandlerDef<{ articulo_id: string }> = {
  tipo: "articulo.inexistente",
  roles: ROLES,
  validar: (p) => (esId(p?.articulo_id) ? null : "Artículo inválido"),
  async aplicar(ctx, m) {
    await negocio(() => enviarArticuloAInexistente(ctx.admin, m.payload.articulo_id))
    return { replica: [await parcheArticulo(ctx, m.payload.articulo_id)] }
  },
}

export const HANDLERS_DEPOSITO: HandlerDef[] = [
  pickingAbrir,
  pickingItem,
  pickingCerrar,
  recepcionIniciar,
  recepcionConformidad,
  recepcionItem,
  recepcionCerrar,
  devolucionRecibir,
  stockAjustar,
  articuloDatos,
  articuloInexistente,
]
