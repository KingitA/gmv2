// Datasets de la app Depósito (com.gm.deposito). Ver MOBILE.md → "Depósito".
//
//   deposito_pedidos       cola de picking (delta: pedidos + pedidos_detalle)
//   deposito_recepciones   OCs pendientes de recibir + su recepción (= GET web)
//   deposito_devoluciones  devoluciones pendientes de recibir (= GET web)
//   deposito_articulos     catálogo para escanear/buscar/ajustar (delta: articulos)
//   deposito_catalogos     proveedores, tipos de bulto/fracción, transportes
//
// Ninguno depende del usuario: todos los operarios ven la misma cola, por eso la
// app no limpia la réplica al cambiar de usuario (cambio de turno rápido).

import { cargarTiposArticulo } from "@/lib/catalogos/tipos-articulo"
import { ESTADOS_PREPARABLES } from "@/lib/deposito/picking"
import { cargarOrdenesPendientes } from "@/lib/deposito/recepciones"
import { fetchAllRows, fetchByIds } from "@/lib/supabase/fetch-all"
import { GET as devolucionesGET } from "@/app/api/deposito/devoluciones/route"
import type { FilaReplica } from "../contrato"
import type { CtxSync, DatasetDef } from "./motor"

const ROLES = ["deposito"]

async function llamarGET(handler: () => Promise<Response>): Promise<any> {
  const res = await handler()
  const body = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status })
  return body
}

// ─── Cola de picking ─────────────────────────────────────────────────────────

const PEDIDO_COLS = `
  id, numero_pedido, estado, fecha, prioridad, observaciones, created_at, bonif_mercaderia_pct,
  clientes(id, nombre, razon_social, direccion, localidad),
  pedidos_detalle(
    id, cantidad, articulo_id, cantidad_preparada, estado_item, es_bonificado, precio_base, lista_precio_id,
    articulos(id, sku, descripcion, ean13, codigo_bulto, unidades_por_bulto, orden_deposito, proveedores(nombre), marca:marca_id(descripcion))
  )`

/**
 * Pedidos a preparar con sus renglones, quién tomó cada renglón y los datos para
 * recalcular bonificados offline (lib/deposito/bonificados.ts). id = pedido.id.
 * Un pedido que sale de preparación deja de venir ⇒ en delta llega como borrado.
 */
export async function cargarPedidosDeposito(supabase: any, ids?: string[]): Promise<FilaReplica[]> {
  const base = () => supabase.from("pedidos").select(PEDIDO_COLS).in("estado", ESTADOS_PREPARABLES)
  const pedidos: any[] = ids
    ? await fetchByIds((chunk) => base().in("id", chunk), ids, 100)
    : await fetchAllRows(base)
  if (pedidos.length === 0) return []

  const { data: especial } = await supabase.from("listas_precio").select("id").eq("codigo", "especial").maybeSingle()
  const especialId: string | null = especial?.id ?? null

  const prep = await fetchByIds(
    (chunk) =>
      supabase
        .from("picking_items")
        .select("pedido_detalle_id, usuario_id, usuario_nombre, pedidos_detalle!inner(pedido_id)")
        .in("pedidos_detalle.pedido_id", chunk),
    pedidos.map((p) => p.id),
    100,
  )
  const porRenglon = new Map<string, { usuario_id: string | null; usuario_nombre: string }>()
  for (const r of prep as any[]) {
    porRenglon.set(r.pedido_detalle_id, { usuario_id: r.usuario_id ?? null, usuario_nombre: r.usuario_nombre || "Operario" })
  }

  return pedidos.map((p) => {
    const preparadores: Record<string, { usuario_id: string | null; usuario_nombre: string }> = {}
    const detalle = (p.pedidos_detalle || []).map((d: any) => {
      const pr = porRenglon.get(d.id)
      if (pr) preparadores[d.id] = pr
      const { lista_precio_id, ...resto } = d
      return { ...resto, excluye_bonif: !!especialId && lista_precio_id === especialId }
    })
    return { ...p, pedidos_detalle: detalle, preparadores }
  })
}

const depositoPedidos: DatasetDef = {
  nombre: "deposito_pedidos",
  roles: ROLES,
  tablas: ["pedidos", "pedidos_detalle"],
  requiereLogDe: ["pedidos"], // trigger de 20260919_mobile_deposito.sql
  cargar: (ctx, ids) => cargarPedidosDeposito(ctx.supabase, ids),
}

// ─── Recepciones y devoluciones (misma forma que ve la web) ──────────────────

const depositoRecepciones: DatasetDef = {
  nombre: "deposito_recepciones",
  roles: ROLES,
  cargar: (ctx) => cargarOrdenesPendientes(ctx.supabase),
}

const depositoDevoluciones: DatasetDef = {
  nombre: "deposito_devoluciones",
  roles: ROLES,
  cargar: async () => (await llamarGET(devolucionesGET)) as FilaReplica[],
}

export async function cargarRecepcionDeposito(supabase: any, ordenId: string): Promise<FilaReplica | null> {
  return (await cargarOrdenesPendientes(supabase, ordenId))[0] ?? null
}

// ─── Catálogo de artículos ───────────────────────────────────────────────────

export const ARTICULO_DEPOSITO_COLS =
  "id, sku, descripcion, ean13, codigo_bulto, stock_actual, unidades_por_bulto, unidad_de_medida, orden_deposito, proveedor_id, categoria, tipo_fraccion, cantidad_fraccion, activo, marca:marca_id(descripcion)"

export async function cargarArticulosDeposito(supabase: any, ids?: string[]): Promise<FilaReplica[]> {
  const arts: any[] = ids
    ? await fetchByIds((chunk) => supabase.from("articulos").select(ARTICULO_DEPOSITO_COLS).in("id", chunk), ids)
    : await fetchAllRows(() => supabase.from("articulos").select(ARTICULO_DEPOSITO_COLS).eq("activo", true))
  // Inactivos: en delta vuelven como borrados
  return arts
    .filter((a) => a.activo !== false)
    .map(({ activo: _activo, marca, ...a }) => ({ ...a, marca: marca?.descripcion ?? null }))
}

const depositoArticulos: DatasetDef = {
  nombre: "deposito_articulos",
  roles: ROLES,
  tablas: ["articulos"],
  // service role, igual que las server actions web de depósito (lib/actions/deposito.ts)
  cargar: (ctx, ids) => cargarArticulosDeposito(ctx.admin, ids),
}

// ─── Catálogos chicos ────────────────────────────────────────────────────────

const depositoCatalogos: DatasetDef = {
  nombre: "deposito_catalogos",
  roles: ROLES,
  async cargar(ctx: CtxSync) {
    const [{ data: proveedores }, tipos, { data: transportes }] = await Promise.all([
      ctx.admin.from("proveedores").select("id, nombre").eq("activo", true).order("nombre"),
      cargarTiposArticulo(ctx.admin),
      ctx.admin.from("transportes").select("id, nombre, activo").order("nombre"),
    ])
    return [
      { id: "proveedores", items: proveedores || [] },
      { id: "tipos", tiposBulto: tipos.tiposBulto, tiposFraccion: tipos.tiposFraccion },
      { id: "transportes", items: (transportes || []).filter((t: any) => t.activo !== false).map((t: any) => ({ id: t.id, nombre: t.nombre })) },
    ]
  },
}

export const DATASETS_DEPOSITO: DatasetDef[] = [
  depositoPedidos,
  depositoRecepciones,
  depositoDevoluciones,
  depositoArticulos,
  depositoCatalogos,
]
