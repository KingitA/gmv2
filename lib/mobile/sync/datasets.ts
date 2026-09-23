// Registro de datasets replicables en los dispositivos. Cada app declara en
// mobile/apps/<app>/src/datasets.ts cuáles sincroniza. Las sesiones por app
// agregan acá sus datasets (ver MOBILE.md → "Matriz endpoint → estrategia").

import { fetchAllRows, fetchByIds } from "@/lib/supabase/fetch-all"
import {
  ARTICULO_PRECIO_COLS,
  CLIENTE_LISTAS_COLS,
  CONDICION_MARCA_COLS,
  CONDICION_PROVEEDOR_COLS,
  LISTA_PRECIO_COLS,
} from "@/lib/pricing/cargar-insumos"
import type { CtxSync, DatasetDef } from "./motor"
import { DATASETS_CHOFER } from "./chofer"
import { DATASETS_DEPOSITO } from "./deposito"
import { DATASETS_VENDEDOR } from "./vendedor"

async function vendedorIdsDe(ctx: CtxSync): Promise<string[] | null> {
  if (ctx.sesion.roles.includes("admin")) return null // admin: sin filtro
  const { data } = await ctx.supabase
    .from("vendedores")
    .select("id")
    .eq("usuario_id", ctx.sesion.user.id)
    .eq("activo", true)
  return (data || []).map((v: any) => v.id)
}

// ─── Chofer: lib/mobile/sync/chofer.ts ───────────────────────────────────────

// ─── Insumos de precio (vendedor; ver lib/pricing/motor.ts) ────────────────

/** Artículos con columnas de precio + descuentos tipados embebidos. id = articulo.id */
const preciosArticulos: DatasetDef = {
  nombre: "precios_articulos",
  roles: ["vendedor"],
  tablas: ["articulos", "articulos_descuentos"],
  async cargar(ctx, ids) {
    const cols = `${ARTICULO_PRECIO_COLS},sku,descripcion,activo,unidades_por_bulto`
    const arts = ids
      ? await fetchByIds((chunk) => ctx.supabase.from("articulos").select(cols).in("id", chunk), ids)
      : await fetchAllRows(() => ctx.supabase.from("articulos").select(cols).eq("activo", true))
    const artIds = arts.map((a: any) => a.id)
    const descs = await fetchByIds(
      (chunk) => ctx.supabase.from("articulos_descuentos").select("articulo_id,tipo,porcentaje,orden").in("articulo_id", chunk),
      artIds,
    )
    const porArt = new Map<string, any[]>()
    for (const d of descs.sort((a: any, b: any) => a.orden - b.orden)) {
      const l = porArt.get(d.articulo_id) || []
      l.push({ tipo: d.tipo, porcentaje: d.porcentaje, orden: d.orden })
      porArt.set(d.articulo_id, l)
    }
    // Inactivos: en delta vuelven como borrados (no se venden)
    return arts.filter((a: any) => a.activo !== false).map((a: any) => ({ ...a, descuentos: porArt.get(a.id) || [] }))
  },
}

const preciosListas: DatasetDef = {
  nombre: "precios_listas",
  roles: ["vendedor"],
  tablas: ["listas_precio"],
  async cargar(ctx, ids) {
    let q = ctx.supabase.from("listas_precio").select(`${LISTA_PRECIO_COLS},nombre,activo`)
    if (ids) q = q.in("id", ids)
    const { data, error } = await q
    if (error) throw error
    return data || []
  },
}

const preciosReglas: DatasetDef = {
  nombre: "precios_reglas",
  roles: ["vendedor"],
  tablas: ["listas_precio_reglas"],
  async cargar(ctx, ids) {
    let q = ctx.supabase.from("listas_precio_reglas").select("id,grupo_precio,iva_compras,iva_ventas,formulas")
    if (ids) q = q.in("id", ids)
    const { data, error } = await q
    if (error) throw error
    return data || []
  },
}

/** Cambios de precio programados pendientes (los aplica el dispositivo al llegar la hora). */
const preciosProgramados: DatasetDef = {
  nombre: "precios_programados",
  roles: ["vendedor"],
  tablas: ["precios_programados"],
  async cargar(ctx, ids) {
    let q = ctx.supabase
      .from("precios_programados")
      .select("id,tabla,registro_id,cambios,vigencia_desde,estado")
      .eq("estado", "pendiente")
    if (ids) q = q.in("id", ids)
    const { data, error } = await q
    if (error) {
      // Migración sin aplicar: sin programados (el motor funciona igual)
      if (/precios_programados/.test(error.message || "")) return []
      throw error
    }
    return data || []
  },
}

/**
 * Insumos por cliente del vendedor: listas/métodos de la ficha, condiciones por
 * proveedor/marca y bonificaciones activas. id = cliente.id. Alcance = clientes
 * de los registros de vendedor del usuario (igual que /api/vendedor/clientes).
 */
const preciosClientes: DatasetDef = {
  nombre: "precios_clientes",
  roles: ["vendedor"],
  tablas: ["clientes", "bonificaciones", "cliente_proveedor_condicion", "cliente_marca_condicion"],
  async cargar(ctx, ids) {
    const vendIds = await vendedorIdsDe(ctx)
    const build = () => {
      let q = ctx.supabase.from("clientes").select(`${CLIENTE_LISTAS_COLS},activo`).eq("activo", true)
      if (vendIds) q = q.in("vendedor_id", vendIds.length ? vendIds : ["00000000-0000-0000-0000-000000000000"])
      return q
    }
    const clientes = ids
      ? await fetchByIds((chunk) => build().in("id", chunk), ids)
      : await fetchAllRows(build)
    const cids = clientes.map((c: any) => c.id)
    const [condProv, condMarca, bonifs] = await Promise.all([
      fetchByIds((ch) => ctx.supabase.from("cliente_proveedor_condicion").select(`cliente_id,${CONDICION_PROVEEDOR_COLS}`).in("cliente_id", ch), cids),
      fetchByIds((ch) => ctx.supabase.from("cliente_marca_condicion").select(`cliente_id,${CONDICION_MARCA_COLS}`).in("cliente_id", ch), cids),
      fetchByIds(
        (ch) =>
          ctx.supabase
            .from("bonificaciones")
            .select("cliente_id,tipo,segmento,porcentaje")
            .eq("activo", true)
            .in("tipo", ["general", "viajante"])
            .in("cliente_id", ch),
        cids,
      ),
    ])
    const agrupar = (rows: any[]) => {
      const m = new Map<string, any[]>()
      for (const { cliente_id, ...r } of rows) {
        const l = m.get(cliente_id) || []
        l.push(r)
        m.set(cliente_id, l)
      }
      return m
    }
    const cp = agrupar(condProv), cm = agrupar(condMarca), bo = agrupar(bonifs)
    return clientes.map((c: any) => ({
      id: c.id,
      cliente: c,
      condicionesProveedor: cp.get(c.id) || [],
      condicionesMarca: cm.get(c.id) || [],
      bonificaciones: bo.get(c.id) || [],
    }))
  },
}

// ─── Registro ───────────────────────────────────────────────────────────────

const REGISTRO: DatasetDef[] = [
  ...DATASETS_CHOFER,
  preciosArticulos,
  preciosListas,
  preciosReglas,
  preciosProgramados,
  preciosClientes,
  ...DATASETS_DEPOSITO,
  ...DATASETS_VENDEDOR,
]

export const DATASETS = new Map(REGISTRO.map((d) => [d.nombre, d]))

export function puedeLeer(def: DatasetDef, roles: string[]) {
  return roles.includes("admin") || def.roles.some((r) => roles.includes(r))
}
