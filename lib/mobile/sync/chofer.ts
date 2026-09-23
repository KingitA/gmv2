// Datasets de la app Chofer (com.gm.chofer). Ver MOBILE.md → "Chofer".
//
//   chofer_me              identidad + viaje activo + historial (= GET /api/chofer/me)
//   chofer_viajes          hoja de ruta calculada de cada viaje visible (= GET viaje/[id],
//                          leído SIN iniciar el viaje: descargar ≠ abrir)
//   chofer_viaje_clientes  ficha de cada parada de los viajes operables (= GET cliente/[clienteId])
//                          + lo que el selector de cobro leía con supabase-js desde el navegador
//                          + últimos precios facturados al cliente (devolución de mercadería vieja)
//   chofer_billetera       = GET /api/chofer/billetera (fila única "billetera")
//   chofer_clientes        todos los clientes activos con su saldo (cobro conjunto en la calle)
//   chofer_articulos       catálogo vendible (delta: articulos), para buscar un artículo a devolver
//   chofer_catalogos       cuentas bancarias destino de transferencias
//
// Regla: donde la web ya tiene un GET con la forma correcta se ENVUELVE (cero
// duplicación). Donde el GET es por viaje/cliente se usa la función extraída a
// lib/viajes/* (la misma que llama la route), para no re-autenticar N veces.

import { GET as meGET } from "@/app/api/chofer/me/route"
import { GET as viajeGET } from "@/app/api/chofer/viaje/[id]/route"
import { GET as billeteraGET } from "@/app/api/chofer/billetera/route"
import { GET as cuentasGET } from "@/app/api/chofer/cuentas-bancarias/route"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { cargarComprados } from "@/lib/vendedor/comprados"
import { HEADER_SIN_INICIAR, viajesDelChofer } from "@/lib/viajes/chofer"
import { cargarClienteViaje, cargarCuentaCobro } from "@/lib/viajes/cliente-viaje"
import type { FilaReplica } from "../contrato"
import { llamarGET } from "../outbox/rutas"
import type { CtxSync, DatasetDef } from "./motor"
import { cargarArticulosVendedor, enParalelo } from "./vendedor"

const ROLES = ["chofer"]

/** Estados en los que el chofer todavía opera el viaje (cobra, devuelve, cierra paradas, corrige cobros). */
export const ESTADOS_OPERABLES = ["despachado", "en_curso", "en_rendicion"]

/** Clave de la fila de chofer_viaje_clientes. */
export const idClienteViaje = (viajeId: string, clienteId: string) => `${viajeId}:${clienteId}`

// ─── Identidad ───────────────────────────────────────────────────────────────

const me: DatasetDef = {
  nombre: "chofer_me",
  roles: ROLES,
  async cargar(ctx) {
    return [{ id: "me", ...(await llamarGET(meGET, ctx, "/api/chofer/me")) }]
  },
}

// ─── Viajes (hoja de ruta) ───────────────────────────────────────────────────

/** = GET /api/chofer/viaje/[id] sin el efecto "iniciar". null = no existe o no es de esta tripulación. */
export async function cargarViajeChofer(ctx: { request: Request }, id: string): Promise<FilaReplica | null> {
  try {
    const d = await llamarGET(viajeGET, ctx, `/api/chofer/viaje/${id}`, { id }, { [HEADER_SIN_INICIAR]: "1" })
    return { id, ...d }
  } catch (e: any) {
    if (e.status === 404 || e.status === 403) return null
    throw e
  }
}

async function viajesVisibles(ctx: CtxSync): Promise<string[]> {
  const meData = await llamarGET(meGET, ctx, "/api/chofer/me")
  return [...new Set<string>([meData.viaje_activo?.id, ...(meData.historial || []).slice(0, 5).map((v: any) => v.id)].filter(Boolean))]
}

const viajes: DatasetDef = {
  nombre: "chofer_viajes",
  roles: ROLES,
  async cargar(ctx, ids) {
    const viajeIds = ids ?? (await viajesVisibles(ctx))
    const filas = await enParalelo(viajeIds, 3, (id) => cargarViajeChofer(ctx, id))
    return filas.filter((f): f is FilaReplica => !!f)
  },
  async porIds(ctx, ids) {
    const filas = await enParalelo(ids, 3, (id) => cargarViajeChofer(ctx, id))
    return filas.filter((f): f is FilaReplica => !!f)
  },
}

// ─── Clientes de cada viaje (la pantalla crítica) ────────────────────────────

/** Viajes del usuario que todavía se operan, con su estado. */
async function viajesOperables(ctx: CtxSync): Promise<Array<{ id: string; estado: string }>> {
  const ids = await viajesDelChofer(ctx.supabase, ctx.sesion.user.id)
  if (!ids.length) return []
  const { data, error } = await ctx.supabase.from("viajes").select("id, estado").in("id", ids).in("estado", ESTADOS_OPERABLES)
  if (error) throw error
  return data || []
}

/** Una fila = un cliente dentro de un viaje: todo lo que la ficha, el cobro y la devolución necesitan sin red. */
export async function filaClienteViaje(ctx: CtxSync, viajeId: string, clienteId: string, viajeEstado: string): Promise<FilaReplica> {
  const [ficha, cobro, comprados] = await Promise.all([
    cargarClienteViaje(ctx.supabase, viajeId, clienteId, viajeEstado),
    cargarCuentaCobro(ctx.supabase, clienteId),
    // Accesorio: si falla, la ficha y el cobro igual tienen que andar
    cargarComprados(ctx.supabase, clienteId).catch((e) => {
      console.error("[sync/chofer_viaje_clientes] comprados:", e?.message || e)
      return [] as Awaited<ReturnType<typeof cargarComprados>>
    }),
  ])
  return {
    id: idClienteViaje(viajeId, clienteId),
    viaje_id: viajeId,
    cliente_id: clienteId,
    ...ficha,
    cobro,
    comprados: [...comprados].sort((a: any, b: any) => (b.ultima_fecha || "").localeCompare(a.ultima_fecha || "")).slice(0, 150),
  }
}

const viajeClientes: DatasetDef = {
  nombre: "chofer_viaje_clientes",
  roles: ROLES,
  async cargar(ctx) {
    const operables = await viajesOperables(ctx)
    if (!operables.length) return []
    const estadoDe = new Map(operables.map((v) => [v.id, v.estado]))
    const { data: paradas, error } = await ctx.supabase.from("viajes_paradas").select("viaje_id, cliente_id").in("viaje_id", [...estadoDe.keys()])
    if (error) throw error
    const pares = (paradas || []) as Array<{ viaje_id: string; cliente_id: string }>
    return enParalelo(pares, 6, (p) => filaClienteViaje(ctx, p.viaje_id, p.cliente_id, estadoDe.get(p.viaje_id) || "en_curso"))
  },
  async porIds(ctx, ids) {
    const operables = await viajesOperables(ctx)
    const estadoDe = new Map(operables.map((v) => [v.id, v.estado]))
    const pares = ids
      .map((id) => {
        const i = id.indexOf(":")
        return i > 0 ? { viaje_id: id.slice(0, i), cliente_id: id.slice(i + 1) } : null
      })
      .filter((p): p is { viaje_id: string; cliente_id: string } => !!p && estadoDe.has(p.viaje_id))
    return enParalelo(pares, 6, (p) => filaClienteViaje(ctx, p.viaje_id, p.cliente_id, estadoDe.get(p.viaje_id)!))
  },
}

// ─── Billetera ───────────────────────────────────────────────────────────────

export async function filaBillletera(ctx: { request: Request }): Promise<FilaReplica> {
  return { id: "billetera", ...(await llamarGET(billeteraGET, ctx, "/api/chofer/billetera")) }
}

const billetera: DatasetDef = {
  nombre: "chofer_billetera",
  roles: ROLES,
  async cargar(ctx) {
    return [await filaBillletera(ctx)]
  },
}

// ─── Clientes (cobro conjunto: "Agregar cliente para cobrar") ────────────────

const CLIENTE_COLS = "id, nombre, razon_social, nombre_razon_social, cuit, codigo_cliente, direccion, localidad, activo"

const clientes: DatasetDef = {
  nombre: "chofer_clientes",
  roles: ROLES,
  async cargar(ctx) {
    const [filas, saldos] = await Promise.all([
      fetchAllRows<any>(() => ctx.supabase.from("clientes").select(CLIENTE_COLS).eq("activo", true)),
      fetchAllRows<any>(() => ctx.supabase.from("v_saldo_clientes").select("cliente_id, saldo_actual"), "cliente_id"),
    ])
    const saldoDe = new Map(saldos.map((s) => [s.cliente_id, Number(s.saldo_actual) || 0]))
    return filas.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      razon_social: c.razon_social,
      nombre_razon_social: c.nombre_razon_social,
      cuit: c.cuit,
      codigo_cliente: c.codigo_cliente,
      direccion: c.direccion,
      localidad: c.localidad,
      saldo_actual: saldoDe.get(c.id) ?? 0,
    }))
  },
}

// ─── Catálogo (buscar un artículo a devolver) ────────────────────────────────

const articulos: DatasetDef = {
  nombre: "chofer_articulos",
  roles: ROLES,
  tablas: ["articulos"],
  cargar: (ctx, ids) => cargarArticulosVendedor(ctx.supabase, ids),
}

const catalogos: DatasetDef = {
  nombre: "chofer_catalogos",
  roles: ROLES,
  async cargar(ctx) {
    return [{ id: "cuentas", ...(await llamarGET(cuentasGET, ctx, "/api/chofer/cuentas-bancarias")) }]
  },
}

export const DATASETS_CHOFER: DatasetDef[] = [me, viajes, viajeClientes, billetera, clientes, articulos, catalogos]
