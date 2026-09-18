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
import { enTandas, porTandas } from "@/lib/deposito/cola"
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

const PEDIDO_COLS = "id, numero_pedido, estado, fecha, prioridad, observaciones, created_at, bonif_mercaderia_pct, clientes(id, nombre, razon_social, direccion, localidad)"
const DETALLE_COLS =
  "id, pedido_id, cantidad, articulo_id, cantidad_preparada, estado_item, es_bonificado, precio_base, lista_precio_id, articulos(id, sku, descripcion, ean13, codigo_bulto, unidades_por_bulto, orden_deposito, proveedores(nombre), marca:marca_id(descripcion))"

/**
 * ALCANCE de la cola que se replica en el handheld (decidido por el dueño el 18/09/2026,
 * ver MOBILE.md §17 "Alcance de la cola"). La cola web completa son 1.285 pedidos /
 * 53.867 renglones = 21 MB (1.267 "impreso" que vienen desde abril): no entra en una
 * respuesta (Vercel corta en 4,5 MB) ni tiene sentido llevarla en el bolsillo.
 * Se replican, con todos sus renglones:
 *   - todos los `pendiente` y `en_preparacion`
 *   - los `impreso` creados en los últimos DIAS_IMPRESO días
 *   - cualquier pedido con un picking empezado (sesión EN_PROGRESO), tenga la edad que tenga
 */
export const DIAS_IMPRESO = 7

async function idsConPickingEnCurso(supabase: any): Promise<string[]> {
  const { data } = await supabase.from("picking_sesiones").select("pedido_id").eq("estado", "EN_PROGRESO").limit(1000)
  return [...new Set<string>((data || []).map((s: any) => s.pedido_id).filter(Boolean))]
}

/**
 * Pedidos a preparar con sus renglones, quién tomó cada renglón y los datos para
 * recalcular bonificados offline (lib/deposito/bonificados.ts). id = pedido.id.
 * Un pedido que sale de preparación deja de venir ⇒ en delta llega como borrado.
 * Los renglones NO se embeben en el select de pedidos (lib/deposito/cola.ts explica por qué).
 */
export async function cargarPedidosDeposito(supabase: any, ids?: string[]): Promise<FilaReplica[]> {
  const corte = new Date(Date.now() - DIAS_IMPRESO * 86_400_000).toISOString()
  const enCurso = await idsConPickingEnCurso(supabase)
  const alcance = (q: any) => {
    const partes = ["estado.in.(pendiente,en_preparacion)", `and(estado.eq.impreso,created_at.gte.${corte})`]
    if (enCurso.length) partes.push(`id.in.(${enCurso.join(",")})`)
    return q.in("estado", ESTADOS_PREPARABLES).or(partes.join(","))
  }
  const pedidos: any[] = ids
    ? await fetchByIds((chunk) => alcance(supabase.from("pedidos").select(PEDIDO_COLS)).in("id", chunk), ids, 100)
    : await fetchAllRows(() => alcance(supabase.from("pedidos").select(PEDIDO_COLS)))
  if (pedidos.length === 0) return []

  const { data: especial } = await supabase.from("listas_precio").select("id").eq("codigo", "especial").maybeSingle()
  const especialId: string | null = especial?.id ?? null

  const tandas = enTandas(pedidos.map((p) => p.id), 40)
  const [renglones, prep] = await Promise.all([
    porTandas(tandas, 6, (chunk) => fetchAllRows(() => supabase.from("pedidos_detalle").select(DETALLE_COLS).in("pedido_id", chunk))),
    porTandas(tandas, 6, (chunk) =>
      fetchAllRows(() =>
        supabase
          .from("picking_items")
          .select("id, pedido_detalle_id, usuario_id, usuario_nombre, pedidos_detalle!inner(pedido_id)")
          .in("pedidos_detalle.pedido_id", chunk),
      ),
    ),
  ])
  const porRenglon = new Map<string, { usuario_id: string | null; usuario_nombre: string }>()
  for (const r of prep.flat() as any[]) {
    porRenglon.set(r.pedido_detalle_id, { usuario_id: r.usuario_id ?? null, usuario_nombre: r.usuario_nombre || "Operario" })
  }
  const porPedido = new Map<string, any[]>()
  for (const d of renglones.flat() as any[]) {
    const l = porPedido.get(d.pedido_id) || []
    l.push(d)
    porPedido.set(d.pedido_id, l)
  }

  return pedidos.map((p) => {
    const preparadores: Record<string, { usuario_id: string | null; usuario_nombre: string }> = {}
    const detalle = (porPedido.get(p.id) || []).map((d: any) => {
      const pr = porRenglon.get(d.id)
      if (pr) preparadores[d.id] = pr
      const { lista_precio_id, pedido_id: _pedido, ...resto } = d
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
