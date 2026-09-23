// Datasets de la app Vendedor (com.gm.vendedor). Ver MOBILE.md → "Vendedor".
//
//   vendedor_me          identidad + resumen del inicio (= GET /api/vendedor/me)
//   vendedor_articulos   catálogo vendible con la forma de la web (delta: articulos)
//   vendedor_catalogos   taxonomía, proveedores, ventas 180 d, listas, catálogos de ficha,
//                        cuentas bancarias y zonas (= los GET de la web, una fila c/u)
//   vendedor_clientes    cartera: fila del listado + ficha + bonificaciones + saldos
//   vendedor_cc          cuenta corriente por cliente (= GET cliente/[id]) + comprados + habituales
//   vendedor_pedidos     pedidos recientes con su detalle (delta: pedidos, pedidos_detalle)
//   vendedor_billetera   billetera, comisiones (+ detalle por pedido), rendiciones, estadísticas
//   vendedor_viajes      viajes de levantamiento con sus clientes (= GET viajes/[id])
//
// Los insumos de PRECIO (precios_*) son de la fundación: lib/mobile/sync/datasets.ts.
//
// Regla: donde la web ya tiene un GET con la forma correcta se ENVUELVE (cero
// duplicación). Donde el GET es por cliente/pedido se usa la función extraída a
// lib/vendedor/* (la misma que llama la route), para no re-autenticar N veces.

import { GET as meGET } from "@/app/api/vendedor/me/route"
import { GET as clientesGET } from "@/app/api/vendedor/clientes/route"
import { GET as catalogoGET } from "@/app/api/vendedor/catalogo/route"
import { GET as proveedoresGET } from "@/app/api/vendedor/proveedores/route"
import { GET as ventasGET } from "@/app/api/vendedor/articulos-ventas/route"
import { GET as preciosListasGET } from "@/app/api/vendedor/precios-listas/route"
import { GET as catalogosFichaGET } from "@/app/api/vendedor/catalogos-ficha/route"
import { GET as cuentasGET } from "@/app/api/vendedor/cuentas-bancarias/route"
import { GET as zonasGET } from "@/app/api/vendedor/zonas/route"
import { GET as billeteraGET } from "@/app/api/vendedor/billetera/route"
import { GET as comisionesGET } from "@/app/api/vendedor/comisiones/route"
import { GET as pagosPendientesGET } from "@/app/api/vendedor/pagos-pendientes/route"
import { GET as estadisticasGET } from "@/app/api/vendedor/estadisticas/route"
import { GET as rendicionesGET } from "@/app/api/viajante/rendiciones/route"
import { GET as viajesGET } from "@/app/api/vendedor/viajes/route"
import { GET as viajeGET } from "@/app/api/vendedor/viajes/[id]/route"
import { fetchAllRows, fetchByIds } from "@/lib/supabase/fetch-all"
import { ARTICULO_SELECT, mapArticuloVendedor } from "@/lib/vendedor/articulos-select"
import { bonificacionesDesdeFilas } from "@/lib/vendedor/bonificaciones"
import { cargarComprados } from "@/lib/vendedor/comprados"
import { agruparPorComprobante, KARDEX_COMISION_COLS, mapArticuloComision } from "@/lib/vendedor/comisiones-detalle"
import { cargarDetallePedido } from "@/lib/vendedor/detalle-pedido"
import { cargarFichaCliente } from "@/lib/vendedor/ficha-cliente"
import { frecuenciaHabituales, TOPE_HABITUALES } from "@/lib/vendedor/habituales"
import type { FilaReplica } from "../contrato"
import type { CtxSync, DatasetDef } from "./motor"

const ROLES = ["vendedor"]

/** Llama a un GET del ERP con la sesión del request original (el bearer llega solo por headers()). */
async function llamarGET(handler: (...a: any[]) => Promise<Response>, ctx: CtxSync, ruta = "/", params: Record<string, string> = {}): Promise<any> {
  const req = new Request(new URL(ruta, ctx.request.url), { headers: ctx.request.headers })
  const res = await handler(req, { params: Promise.resolve(params) })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status })
  return body
}

/** Ejecuta `fn` sobre cada item con un tope de concurrencia (no satura PostgREST). */
export async function enParalelo<T, R>(items: T[], tope: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(tope, items.length) }, async () => {
      while (i < items.length) {
        const k = i++
        out[k] = await fn(items[k]!)
      }
    }),
  )
  return out
}

/** Registros de vendedor del usuario (mismo criterio que requireVendedor). */
export async function vendedorIdsDe(supabase: any, userId: string): Promise<string[]> {
  const { data, error } = await supabase.from("vendedores").select("id").eq("usuario_id", userId).eq("activo", true)
  if (error) throw error
  return (data || []).map((v: any) => v.id)
}

// ─── Identidad ───────────────────────────────────────────────────────────────

const me: DatasetDef = {
  nombre: "vendedor_me",
  roles: ROLES,
  async cargar(ctx) {
    return [{ id: "me", ...(await llamarGET(meGET, ctx)) }]
  },
}

// ─── Catálogo ────────────────────────────────────────────────────────────────

// Forma de la web (mapArticuloVendedor) + lo que la app necesita para resolver SIN
// red lo que hoy hace el servidor: proveedor_id (vista por proveedor), created_at
// (novedades), codigo_bulto y sigla (búsqueda por código).
const ARTICULO_COLS = `${ARTICULO_SELECT}, proveedor_id, marca_id, codigo_bulto, sigla, created_at, activo, precio_base`

export async function cargarArticulosVendedor(supabase: any, ids?: string[]): Promise<FilaReplica[]> {
  const arts: any[] = ids
    ? await fetchByIds((chunk) => supabase.from("articulos").select(ARTICULO_COLS).in("id", chunk), ids)
    : await fetchAllRows(() => supabase.from("articulos").select(ARTICULO_COLS).eq("activo", true).gt("precio_base", 0))
  // Mismo filtro que todas las vistas de /api/vendedor/articulos. En delta, lo que
  // deja de cumplirlo vuelve como borrado.
  return arts
    .filter((a) => a.activo !== false && Number(a.precio_base) > 0)
    .map((a) =>
      mapArticuloVendedor(a, {
        proveedor_id: a.proveedor_id || null,
        marca_id: a.marca_id || null,
        codigo_bulto: a.codigo_bulto || null,
        sigla: a.sigla || null,
        created_at: a.created_at || null,
      }),
    )
}

const articulos: DatasetDef = {
  nombre: "vendedor_articulos",
  roles: ROLES,
  tablas: ["articulos"],
  cargar: (ctx, ids) => cargarArticulosVendedor(ctx.supabase, ids),
}

const catalogos: DatasetDef = {
  nombre: "vendedor_catalogos",
  roles: ROLES,
  async cargar(ctx) {
    const [catalogo, proveedores, ventas, listas, ficha, cuentas, zonas] = await Promise.all([
      llamarGET(catalogoGET, ctx),
      llamarGET(proveedoresGET, ctx),
      llamarGET(ventasGET, ctx),
      llamarGET(preciosListasGET, ctx),
      llamarGET(catalogosFichaGET, ctx),
      llamarGET(cuentasGET, ctx),
      llamarGET(zonasGET, ctx),
    ])
    return [
      { id: "catalogo", ...catalogo },
      { id: "proveedores", ...proveedores },
      { id: "ventas", ...ventas },
      { id: "precios_listas", ...listas },
      { id: "ficha", ...ficha },
      { id: "cuentas", ...cuentas },
      { id: "zonas", ...zonas },
    ]
  },
}

// ─── Cartera ─────────────────────────────────────────────────────────────────

const CLIENTE_FICHA_COLS =
  "id, nombre, razon_social, cuit, direccion, localidad, localidad_id, provincia, telefono, mail, condicion_iva, condicion_pago, condicion_entrega, metodo_facturacion, vendedor_id, codigo_cliente, lista_precio_id, lista:lista_precio_id(nombre)"

/**
 * Cartera del vendedor. Cada fila = la del listado web (saldos, sin rendir) + los
 * campos de la ficha + bonificaciones por tipo/segmento. Todo en consultas por
 * lote: no crece con la cantidad de clientes.
 */
export async function cargarClientesVendedor(ctx: CtxSync, ids?: string[]): Promise<FilaReplica[]> {
  const lista = await llamarGET(clientesGET, ctx, "/api/vendedor/clientes")
  let filas: any[] = lista.clientes || []
  if (ids) filas = filas.filter((c) => ids.includes(c.id))
  const cids = filas.map((c) => c.id)
  const [fichas, bonifs] = await Promise.all([
    fetchByIds((ch) => ctx.supabase.from("clientes").select(CLIENTE_FICHA_COLS).in("id", ch), cids),
    fetchByIds(
      (ch) => ctx.supabase.from("bonificaciones").select("cliente_id, tipo, segmento, porcentaje").eq("activo", true).in("tipo", ["viajante", "mercaderia"]).in("cliente_id", ch),
      cids,
    ),
  ])
  const fichaPorId = new Map(fichas.map((f: any) => [f.id, f]))
  const bonifPorCliente = new Map<string, any[]>()
  for (const b of bonifs as any[]) {
    const l = bonifPorCliente.get(b.cliente_id) || []
    l.push(b)
    bonifPorCliente.set(b.cliente_id, l)
  }
  return filas.map((c) => {
    const b = bonificacionesDesdeFilas(bonifPorCliente.get(c.id) || [])
    return { ...(fichaPorId.get(c.id) || {}), ...c, bonificaciones: { viajante: b.viajante, mercaderia: b.mercaderia } }
  })
}

const clientes: DatasetDef = {
  nombre: "vendedor_clientes",
  roles: ROLES,
  cargar: (ctx) => cargarClientesVendedor(ctx),
  porIds: (ctx, ids) => cargarClientesVendedor(ctx, ids),
}

/** Cuenta corriente de UN cliente (= GET cliente/[id]) + comprados + habituales. null = no es suyo. */
export async function cargarCuentaCliente(supabase: any, sesion: { vendedorIds: string[]; user: { id: string } }, id: string): Promise<FilaReplica | null> {
  const ficha = await cargarFichaCliente(supabase, sesion, id)
  if (!ficha) return null
  // Comprados y habituales son ACCESORIOS de la cuenta corriente: si una consulta falla, el
  // vendedor igual tiene que poder ver la deuda y cobrar (no tumban toda la fila).
  const [comprados, frecuencia] = await Promise.all([
    cargarComprados(supabase, id).catch((e) => { console.error("[sync/vendedor_cc] comprados:", e?.message || e); return [] as Awaited<ReturnType<typeof cargarComprados>> }),
    frecuenciaHabituales(supabase, id).catch((e) => { console.error("[sync/vendedor_cc] habituales:", e?.message || e); return new Map<string, { veces: number; ultCantidad: number }>() }),
  ])
  const habituales = [...frecuencia.entries()]
    .sort((a, b) => b[1].veces - a[1].veces)
    .slice(0, TOPE_HABITUALES)
    .map(([articulo_id, f]) => ({ articulo_id, veces_pedido: f.veces, cantidad_habitual: f.ultCantidad }))
  return {
    id,
    ...ficha,
    comprados: [...comprados].sort((a: any, b: any) => (b.ultima_fecha || "").localeCompare(a.ultima_fecha || "")).slice(0, 100),
    habituales,
  }
}

const cuentas: DatasetDef = {
  nombre: "vendedor_cc",
  roles: ROLES,
  async cargar(ctx) {
    const vendedorIds = await vendedorIdsDe(ctx.supabase, ctx.sesion.user.id)
    if (!vendedorIds.length) return []
    const cli = await fetchAllRows<{ id: string }>(() => ctx.supabase.from("clientes").select("id").in("vendedor_id", vendedorIds).eq("activo", true))
    const sesion = { vendedorIds, user: { id: ctx.sesion.user.id } }
    const filas = await enParalelo(cli, 8, (c) => cargarCuentaCliente(ctx.supabase, sesion, c.id))
    return filas.filter((f): f is FilaReplica => !!f)
  },
  async porIds(ctx, ids) {
    const sesion = { vendedorIds: await vendedorIdsDe(ctx.supabase, ctx.sesion.user.id), user: { id: ctx.sesion.user.id } }
    const filas = await enParalelo(ids, 8, (id) => cargarCuentaCliente(ctx.supabase, sesion, id))
    return filas.filter((f): f is FilaReplica => !!f)
  },
}

// ─── Pedidos ─────────────────────────────────────────────────────────────────

/** Alcance: lo que el vendedor abre en la calle. El historial viejo se ve en la web. */
export const DIAS_PEDIDOS = 90
export const TOPE_PEDIDOS = 250
const ESTADOS_VIVOS = ["en_venta", "pendiente", "impreso", "en_preparacion"]

export async function cargarPedidosVendedor(supabase: any, vendedorIds: string[], ids?: string[]): Promise<FilaReplica[]> {
  if (!vendedorIds.length) return []
  let pedidoIds = ids
  if (!pedidoIds) {
    const corte = new Date(Date.now() - DIAS_PEDIDOS * 86_400_000).toISOString().slice(0, 10)
    const { data, error } = await supabase
      .from("pedidos")
      .select("id")
      .in("vendedor_id", vendedorIds)
      .is("eliminado_at", null)
      .or(`fecha.gte.${corte},estado.in.(${ESTADOS_VIVOS.join(",")})`)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(TOPE_PEDIDOS)
    if (error) throw error
    pedidoIds = (data || []).map((p: any) => p.id)
  }
  const filas = await enParalelo(pedidoIds!, 8, async (id) => {
    const d = await cargarDetallePedido(supabase, vendedorIds, id)
    return d ? ({ id, ...d } as FilaReplica) : null
  })
  return filas.filter((f): f is FilaReplica => !!f)
}

const pedidos: DatasetDef = {
  nombre: "vendedor_pedidos",
  roles: ROLES,
  tablas: ["pedidos", "pedidos_detalle"],
  // El trigger de pedidos llegó con la migración de Depósito: sin él, snapshot
  requiereLogDe: ["pedidos"],
  async cargar(ctx, ids) {
    return cargarPedidosVendedor(ctx.supabase, await vendedorIdsDe(ctx.supabase, ctx.sesion.user.id), ids)
  },
}

// ─── Billetera, comisiones, rendiciones, estadísticas ────────────────────────

/** Detalle de comisión de los pedidos recientes, de UNA lectura del kardex. */
async function detallesComision(ctx: CtxSync, vendedorIds: string[], pedidoIds: string[]): Promise<FilaReplica[]> {
  if (!pedidoIds.length) return []
  const rows: any[] = await fetchByIds(
    (ch) =>
      ctx.supabase
        .from("kardex")
        .select(KARDEX_COMISION_COLS)
        .in("pedido_id", ch)
        .eq("tipo_movimiento", "venta")
        .not("comision_viajante_monto", "is", null)
        .neq("comision_viajante_monto", 0)
        .eq("pedido_eliminado", false)
        .in("vendedor_id", vendedorIds)
        .limit(5000),
    pedidoIds,
    40,
  )
  const compIds = [...new Set(rows.map((r) => r.comprobante_venta_id).filter(Boolean))] as string[]
  const comps = await fetchByIds(
    (ch) => ctx.supabase.from("comprobantes_venta").select("id, numero_comprobante, tipo_comprobante, total_neto, total_iva, total_factura").in("id", ch),
    compIds,
  )
  const compMap = new Map(comps.map((c: any) => [c.id, c]))
  const porPedido = new Map<string, any[]>()
  for (const r of rows) {
    const l = porPedido.get(r.pedido_id) || []
    l.push(r)
    porPedido.set(r.pedido_id, l)
  }
  const out: FilaReplica[] = []
  for (const [pid, filas] of porPedido) {
    out.push({ id: `detalle:vendida:${pid}`, tipo: "vendida", articulos: filas.map(mapArticuloComision) })
    const cobradas = filas.filter((r) => r.comprobante_cobrado)
    if (cobradas.length) out.push({ id: `detalle:cobrada:${pid}`, tipo: "cobrada", comprobantes: agruparPorComprobante(cobradas, compMap) })
  }
  return out
}

/** Pedidos más recientes de cada lista de comisiones cuyo detalle viaja al equipo. */
export const TOPE_DETALLE_COMISIONES = 150

const billetera: DatasetDef = {
  nombre: "vendedor_billetera",
  roles: ROLES,
  async cargar(ctx) {
    const [bill, cobrada, vendida, pendientes, rendiciones, estadisticas, vendedorIds] = await Promise.all([
      llamarGET(billeteraGET, ctx, "/api/vendedor/billetera"),
      llamarGET(comisionesGET, ctx, "/api/vendedor/comisiones?tipo=cobrada"),
      llamarGET(comisionesGET, ctx, "/api/vendedor/comisiones?tipo=vendida"),
      llamarGET(pagosPendientesGET, ctx),
      llamarGET(rendicionesGET, ctx),
      llamarGET(estadisticasGET, ctx),
      vendedorIdsDe(ctx.supabase, ctx.sesion.user.id),
    ])
    const recientes = new Set<string>()
    for (const l of [cobrada.pedidos || [], vendida.pedidos || []])
      for (const p of (l as any[]).slice(0, TOPE_DETALLE_COMISIONES)) if (p.pedido_id && p.pedido_id !== "sin_pedido") recientes.add(p.pedido_id)
    const detalles = await detallesComision(ctx, vendedorIds, [...recientes])
    return [
      { id: "billetera", ...bill },
      { id: "comisiones:cobrada", ...cobrada },
      { id: "comisiones:vendida", ...vendida },
      { id: "pagos_pendientes", ...pendientes },
      { id: "rendiciones", ...rendiciones },
      { id: "estadisticas", ...estadisticas },
      ...detalles,
    ]
  },
}

// ─── Viajes ──────────────────────────────────────────────────────────────────

export async function cargarViajeVendedor(ctx: { request: Request }, id: string): Promise<FilaReplica | null> {
  try {
    const d = await llamarGET(viajeGET, ctx as CtxSync, `/api/vendedor/viajes/${id}`, { id })
    return { id, ...d }
  } catch (e: any) {
    if (e.status === 404 || e.status === 403) return null
    throw e
  }
}

const viajes: DatasetDef = {
  nombre: "vendedor_viajes",
  roles: ROLES,
  async cargar(ctx) {
    const lista = await llamarGET(viajesGET, ctx)
    const resumen: any[] = lista.viajes || []
    // Detalle (clientes de la zona + pedido levantado) de los viajes en curso y los
    // últimos cerrados; del resto queda el resumen del listado.
    const conDetalle = [...resumen.filter((v) => v.estado === "en_curso"), ...resumen.filter((v) => v.estado !== "en_curso").slice(0, 5)]
    const detalles = await enParalelo(conDetalle, 4, (v) => cargarViajeVendedor(ctx, v.id))
    const porId = new Map(detalles.filter(Boolean).map((d) => [d!.id, d!]))
    return resumen.map((v) => ({ id: v.id, resumen: v, ...(porId.get(v.id) || {}) }))
  },
  async porIds(ctx, ids) {
    const lista = await llamarGET(viajesGET, ctx)
    const resumen = new Map<string, any>((lista.viajes || []).map((v: any) => [v.id, v]))
    const detalles = await enParalelo(ids.filter((id) => resumen.has(id)), 4, (id) => cargarViajeVendedor(ctx, id))
    return detalles.filter((d): d is FilaReplica => !!d).map((d) => ({ ...d, resumen: resumen.get(d.id) }))
  },
}

export const DATASETS_VENDEDOR: DatasetDef[] = [me, articulos, catalogos, clientes, cuentas, pedidos, billetera, viajes]
