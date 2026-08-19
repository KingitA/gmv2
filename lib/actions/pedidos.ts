"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { getNextOrderNumber } from "@/lib/utils/next-order-number"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { calcularPrecioPedido } from "@/lib/pricing/calcular-precio-pedido"
import type { DatosLista, MetodoFacturacion, DescuentoTipado } from "@/lib/pricing/calculator"
import { insertarKardex, type DescuentoKardex } from "@/lib/kardex/insertar-kardex"
import { getComisionPorcentaje, getPrecioNeto, calcularComisionMonto } from "@/lib/comisiones/calcular"

// ─── Tipos de segmento de proveedor ──────────────────────────────────────────
type Segmento = "limpieza" | "perf0" | "perf_plus"

function detectarSegmento(articulo: {
  categoria?: string | null
  iva_compras?: string | null
  iva_ventas?: string | null
  segmento_precio?: string | null
  rubros?: { slug: string } | null
}): Segmento {
  // 1. Override explícito
  if (articulo.segmento_precio === "perfumeria") return _segPerf(articulo)
  if (articulo.segmento_precio === "limpieza_bazar") return "limpieza"

  // 2. Slug relacional del rubro
  const slug = articulo.rubros?.slug
  if (slug === "perfumeria") return _segPerf(articulo)
  if (slug === "limpieza" || slug === "bazar") return "limpieza"

  // 3. Fallback: texto de categoría
  const cat = (articulo.categoria || "").toUpperCase()
  if (cat.includes("PERFUMERIA") || cat.includes("PERFUMERÍA")) return _segPerf(articulo)
  return "limpieza"
}

function _segPerf(a: { iva_ventas?: string | null }): Segmento {
  return a.iva_ventas === "presupuesto" ? "perf0" : "perf_plus"
}

function toMetodoFacturacion(raw: string | null | undefined): MetodoFacturacion {
  if (!raw) return "Final"
  if (raw === "Factura (21% IVA)" || raw === "Factura") return "Factura"
  if (raw === "Presupuesto") return "Presupuesto"
  return "Final"
}

// Resuelve qué listaId + metodoRaw usar para un segmento dado
// Jerarquía: override pedido → default cliente → fallback general
// Centinelas de UI que NUNCA deben llegar como lista/método concretos: si el
// usuario eligió "por segmento", el valor general queda vacío y resuelve por segmento.
const CENTINELAS_SEGMENTO = new Set(["PorSegmento", "porsegmento", "__por_segmento__", "por_segmento"])
function limpiarCentinela(v?: string | null): string | undefined {
  return v && !CENTINELAS_SEGMENTO.has(v) ? v : undefined
}

function resolverListaSegmento(
  segmento: Segmento,
  overrides: {
    lista_limpieza_pedido_id?: string; metodo_limpieza_pedido?: string
    lista_perf0_pedido_id?: string;    metodo_perf0_pedido?: string
    lista_perf_plus_pedido_id?: string; metodo_perf_plus_pedido?: string
    lista_precio_pedido_id?: string;   metodo_facturacion_pedido?: string
  },
  cliente: {
    lista_limpieza_id?: string; metodo_limpieza?: string
    lista_perf0_id?: string;    metodo_perf0?: string
    lista_perf_plus_id?: string; metodo_perf_plus?: string
    lista_precio_id?: string;   metodo_facturacion?: string
  },
): { listaId: string | null; metodoRaw: string } {
  const lc = limpiarCentinela
  const general = {
    listaId: lc(overrides.lista_precio_pedido_id) || lc(cliente.lista_precio_id) || null,
    metodoRaw: lc(overrides.metodo_facturacion_pedido) || lc(cliente.metodo_facturacion) || "Final",
  }

  if (segmento === "limpieza") {
    return {
      listaId: lc(overrides.lista_limpieza_pedido_id) || lc(cliente.lista_limpieza_id) || general.listaId,
      metodoRaw: lc(overrides.metodo_limpieza_pedido) || lc(cliente.metodo_limpieza) || general.metodoRaw,
    }
  }
  if (segmento === "perf0") {
    return {
      listaId: lc(overrides.lista_perf0_pedido_id) || lc(cliente.lista_perf0_id) || general.listaId,
      metodoRaw: lc(overrides.metodo_perf0_pedido) || lc(cliente.metodo_perf0) || general.metodoRaw,
    }
  }
  // perf_plus
  return {
    listaId: lc(overrides.lista_perf_plus_pedido_id) || lc(cliente.lista_perf_plus_id) || general.listaId,
    metodoRaw: lc(overrides.metodo_perf_plus_pedido) || lc(cliente.metodo_perf_plus) || general.metodoRaw,
  }
}

// ─── Condiciones por proveedor (Feature 1) ───────────────────────────────────
// El proveedor sólo identifica QUÉ mercadería (articulos.proveedor_id) recibe estas
// condiciones para este cliente. lista/método se aplican al precio; los 3 descuentos
// se aplican como líneas en el comprobante (general/viajante) o como bonificada (mercadería).
// Condición de segmento (lista/método/descuentos). El segmento se identifica por
// proveedor o por marca. Marca gana sobre proveedor cuando un artículo cae en ambos.
export type CondicionSegmento = {
  lista_precio_id: string | null
  metodo_facturacion: string | null
  dto_general_pct: number | null
  dto_viajante_pct: number | null
  dto_mercaderia_pct: number | null
}
export type CondicionProveedor = CondicionSegmento & { proveedor_id: string }
export type CondicionMarca = CondicionSegmento & { marca_id: string }

const CONDICION_PROVEEDOR_COLS =
  "proveedor_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct"
const CONDICION_MARCA_COLS =
  "marca_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct"

// Mapa proveedor_id → condición. Si se pasa pedidoId, el override del pedido pisa al del cliente.
async function fetchCondicionesProveedor(
  supabase: any,
  clienteId: string,
  pedidoId?: string | null,
): Promise<Map<string, CondicionProveedor>> {
  const map = new Map<string, CondicionProveedor>()
  const { data: cli } = await supabase
    .from("cliente_proveedor_condicion")
    .select(CONDICION_PROVEEDOR_COLS)
    .eq("cliente_id", clienteId)
  for (const r of cli || []) map.set(r.proveedor_id, r as CondicionProveedor)
  if (pedidoId) {
    const { data: ped } = await supabase
      .from("pedido_proveedor_condicion")
      .select(CONDICION_PROVEEDOR_COLS)
      .eq("pedido_id", pedidoId)
    for (const r of ped || []) map.set(r.proveedor_id, r as CondicionProveedor)
  }
  return map
}

// Mapa marca_id → condición. Espejo de fetchCondicionesProveedor.
async function fetchCondicionesMarca(
  supabase: any,
  clienteId: string,
  pedidoId?: string | null,
): Promise<Map<string, CondicionMarca>> {
  const map = new Map<string, CondicionMarca>()
  const { data: cli } = await supabase
    .from("cliente_marca_condicion")
    .select(CONDICION_MARCA_COLS)
    .eq("cliente_id", clienteId)
  for (const r of cli || []) map.set(r.marca_id, r as CondicionMarca)
  if (pedidoId) {
    const { data: ped } = await supabase
      .from("pedido_marca_condicion")
      .select(CONDICION_MARCA_COLS)
      .eq("pedido_id", pedidoId)
    for (const r of ped || []) map.set(r.marca_id, r as CondicionMarca)
  }
  return map
}

// Combina las condiciones del cliente con overrides de formulario (al crear el pedido,
// cuando todavía no existe pedido_proveedor_condicion).
function mergeCondicionesProveedor(
  base: Map<string, CondicionProveedor>,
  overrides?: CondicionProveedor[] | null,
): Map<string, CondicionProveedor> {
  const map = new Map(base)
  for (const o of overrides || []) if (o?.proveedor_id) map.set(o.proveedor_id, o)
  return map
}

function mergeCondicionesMarca(
  base: Map<string, CondicionMarca>,
  overrides?: CondicionMarca[] | null,
): Map<string, CondicionMarca> {
  const map = new Map(base)
  for (const o of overrides || []) if (o?.marca_id) map.set(o.marca_id, o)
  return map
}

// Resuelve la condición de segmento de un artículo: MARCA gana sobre PROVEEDOR.
function resolverCondSegmento(
  articulo: { proveedor_id?: string | null; marca_id?: string | null },
  condProvMap: Map<string, CondicionProveedor>,
  condMarcaMap: Map<string, CondicionMarca>,
): { cond: CondicionSegmento | null; segKey: string | null } {
  const marcaCond = (articulo.marca_id && condMarcaMap.get(articulo.marca_id)) || null
  if (marcaCond) return { cond: marcaCond, segKey: `marca:${articulo.marca_id}` }
  const provCond = (articulo.proveedor_id && condProvMap.get(articulo.proveedor_id)) || null
  if (provCond) return { cond: provCond, segKey: `prov:${articulo.proveedor_id}` }
  return { cond: null, segKey: null }
}

// ─── Helper: fetch todas las reglas de fórmulas (una sola vez por request) ────
async function fetchFormulasReglas(
  supabase: any,
): Promise<Record<string, Record<string, string>>> {
  const { data } = await supabase
    .from("listas_precio_reglas")
    .select("grupo_precio,iva_compras,iva_ventas,formulas")
  if (!data) return {}
  const map: Record<string, Record<string, string>> = {}
  for (const row of data) {
    const key = `${row.grupo_precio}|${row.iva_compras}|${row.iva_ventas}`
    map[key] = row.formulas || {}
  }
  return map
}

// ─── Helper: fetch lista datos por id (con caché en-memoria por llamada) ──────
async function fetchListaDatos(
  supabase: any,
  listaId: string | null,
  cache: Record<string, DatosLista>,
  formulasReglas?: Record<string, Record<string, string>>,
): Promise<DatosLista> {
  const empty: DatosLista = { recargo_limpieza_bazar: 0, recargo_perfumeria_negro: 0, recargo_perfumeria_blanco: 0 }
  if (!listaId) return empty
  if (cache[listaId]) return cache[listaId]
  const { data } = await supabase
    .from("listas_precio")
    .select("codigo,recargo_limpieza_bazar,recargo_perfumeria_negro,recargo_perfumeria_blanco")
    .eq("id", listaId)
    .single()
  const result: DatosLista = data
    ? {
        recargo_limpieza_bazar: data.recargo_limpieza_bazar || 0,
        recargo_perfumeria_negro: data.recargo_perfumeria_negro || 0,
        recargo_perfumeria_blanco: data.recargo_perfumeria_blanco || 0,
        lista_codigo: data.codigo || undefined,
        formulas_reglas: formulasReglas,
      }
    : empty
  cache[listaId] = result
  return result
}

// ─── Helper legacy: fetch lista + metodo (usado en agregarItemPedido) ─────────
async function fetchListaYMetodo(
  supabase: any,
  clienteInfo: any,
  metodo_facturacion_pedido?: string,
  lista_precio_pedido_id?: string,
): Promise<{ listaDatos: DatosLista; metodo: MetodoFacturacion }> {
  const listaId = lista_precio_pedido_id || clienteInfo.lista_precio_id
  const [formulasReglas] = await Promise.all([fetchFormulasReglas(supabase)])
  const listaDatos = await fetchListaDatos(supabase, listaId || null, {}, formulasReglas)
  const metodoRaw = metodo_facturacion_pedido || clienteInfo.metodo_facturacion || "Final"
  const metodo = toMetodoFacturacion(metodoRaw)
  return { listaDatos, metodo }
}

// Campos de override de segmento que guarda el pedido (para resolver al agregar ítems en edición).
const SEGMENTO_PEDIDO_COLS =
  "metodo_facturacion_pedido,lista_precio_pedido_id," +
  "lista_limpieza_pedido_id,metodo_limpieza_pedido," +
  "lista_perf0_pedido_id,metodo_perf0_pedido," +
  "lista_perf_plus_pedido_id,metodo_perf_plus_pedido," +
  "bonif_viajante_pedido_pct"
const SEGMENTO_CLIENTE_COLS =
  "metodo_facturacion,lista_precio_id,lista_limpieza_id,metodo_limpieza," +
  "lista_perf0_id,metodo_perf0,lista_perf_plus_id,metodo_perf_plus"

/**
 * Resuelve lista + método de UN ítem respetando la segmentación (igual que createPedido):
 * condición por proveedor > override por segmento del pedido > config del cliente > general.
 * Devuelve listaId/metodoRaw (para guardar en pedidos_detalle) + listaDatos + metodo + provCond.
 */
async function resolverListaMetodoItem(
  supabase: any,
  articulo: { proveedor_id?: string | null; marca_id?: string | null },
  segmento: Segmento,
  pedidoOverrides: any,
  clienteInfo: any,
  condProvMap: Map<string, CondicionProveedor>,
  condMarcaMap: Map<string, CondicionMarca>,
  listasCache: Record<string, DatosLista>,
  formulasReglas: Record<string, Record<string, string>>,
): Promise<{ listaId: string | null; metodoRaw: string; metodo: MetodoFacturacion; listaDatos: DatosLista; cond: CondicionSegmento | null }> {
  const { cond } = resolverCondSegmento(articulo, condProvMap, condMarcaMap)
  let listaId: string | null
  let metodoRaw: string
  if (cond) {
    listaId = cond.lista_precio_id
    metodoRaw = cond.metodo_facturacion || "Final"
  } else {
    const r = resolverListaSegmento(segmento, pedidoOverrides, clienteInfo)
    listaId = r.listaId
    metodoRaw = r.metodoRaw
  }
  const listaDatos = await fetchListaDatos(supabase, listaId, listasCache, formulasReglas)
  const metodo = toMetodoFacturacion(metodoRaw)
  return { listaId, metodoRaw, metodo, listaDatos, cond }
}

async function fetchArticuloConDescuentos(supabase: any, productoId: string) {
  const [{ data: articulo }, { data: descuentosDB }] = await Promise.all([
    supabase.from("articulos").select("id,proveedor_id,marca_id,precio_compra,precio_base,precio_base_contado,precio_lista_especial,oferta_lista_especial,porcentaje_ganancia,bonif_recargo,categoria,iva_compras,iva_ventas,descuento_propio,segmento_precio,rubros:rubro_id(slug),proveedor:proveedores(tipo_descuento)").eq("id", productoId).single(),
    supabase.from("articulos_descuentos").select("tipo,porcentaje,orden").eq("articulo_id", productoId).order("orden"),
  ])
  if (!articulo) throw new Error("Artículo no encontrado")
  const descuentos: DescuentoTipado[] = (descuentosDB || []).map((d: any) => ({ tipo: d.tipo, porcentaje: d.porcentaje, orden: d.orden }))
  return { ...articulo, descuentos }
}

function round2(n: number) { return Math.round(n * 100) / 100 }

// Mapeo entre Segmento interno y clave de bonificaciones en DB
const SEGMENTO_BONIF: Record<Segmento, string> = {
  limpieza:  "limpieza_bazar",
  perf0:     "perf0",
  perf_plus: "perf_plus",
}

/**
 * Devuelve el descuento_viajante (%) aplicable al segmento dado.
 * Prioriza segmento específico sobre segmento NULL (todos).
 */
function getDescuentoViajante(
  bonifs: Array<{ segmento: string | null; porcentaje: number }>,
  segmento: Segmento,
): number {
  const key = SEGMENTO_BONIF[segmento]
  const especifico = bonifs.find(b => b.segmento === key)
  if (especifico) return especifico.porcentaje
  const general = bonifs.find(b => b.segmento === null || b.segmento === "")
  return general?.porcentaje ?? 0
}

/**
 * Devuelve la bonificación general (%) aplicable al segmento dado.
 * Misma resolución que viajante: segmento específico > segmento NULL (todos).
 */
function getDescuentoGeneral(
  bonifs: Array<{ segmento: string | null; porcentaje: number }>,
  segmento: Segmento,
): number {
  const key = SEGMENTO_BONIF[segmento]
  const especifico = bonifs.find(b => b.segmento === key)
  if (especifico) return especifico.porcentaje
  const general = bonifs.find(b => b.segmento === null || b.segmento === "")
  return general?.porcentaje ?? 0
}

/** Trae las bonificaciones general + viajante activas de un cliente. */
// `pedidoOverrides.bonif_viajante_pedido_pct` (columna pedidos.bonif_viajante_pedido_pct
// o override en memoria del preview): si es número, pisa la bonificación
// viajante de la ficha para TODOS los segmentos en este pedido ("solo este
// pedido" desde la app vendedor). null/undefined = heredar del cliente.
async function fetchBonifGeneralViajante(
  supabase: any,
  clienteId: string,
  pedidoOverrides?: { bonif_viajante_pedido_pct?: number | null } | null,
): Promise<{
  general: Array<{ segmento: string | null; porcentaje: number }>
  viajante: Array<{ segmento: string | null; porcentaje: number }>
}> {
  const { data } = await supabase
    .from("bonificaciones")
    .select("tipo, segmento, porcentaje")
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .in("tipo", ["general", "viajante"])
  const ovr = pedidoOverrides?.bonif_viajante_pedido_pct
  const viajante =
    typeof ovr === "number" && Number.isFinite(ovr)
      ? [{ segmento: null, porcentaje: ovr }]
      : (data ?? []).filter((b: any) => b.tipo === "viajante")
  return {
    general:  (data ?? []).filter((b: any) => b.tipo === "general"),
    viajante,
  }
}

/** Resuelve los % de general/viajante para un ítem (condición de segmento > bonificación por segmento). */
function resolverBonifItem(
  cond: CondicionSegmento | null,
  general: Array<{ segmento: string | null; porcentaje: number }>,
  viajante: Array<{ segmento: string | null; porcentaje: number }>,
  segmento: Segmento,
): { generalPct: number; viajantePct: number } {
  if (cond) {
    return { generalPct: cond.dto_general_pct || 0, viajantePct: cond.dto_viajante_pct || 0 }
  }
  return { generalPct: getDescuentoGeneral(general, segmento), viajantePct: getDescuentoViajante(viajante, segmento) }
}

/**
 * Arma el desglose de descuentos por línea para el kardex.
 * Cascada escalonada (neto basis, pre-IVA adj): P.Lista bruto −oferta −general −viajante.
 *   - oferta (descuento_propio): YA viene incluida en precioLista; back-calculamos su monto.
 *   - general: sobre precioLista.
 *   - viajante: sobre el neto post-general (= precioConDescuento).
 * kardex.precio_lista se mantiene = precioLista (post-oferta, pre-bonif) para no alterar el margen.
 */
function buildKardexDescuentos(
  precioLista: number,        // engine: post-recargo, post-oferta, PRE-bonif (pre-IVA adj)
  precioConDescuento: number, // engine: precioLista * (1-general/100)*(1-viajante/100)
  ofertaPct: number,          // descuento_propio del artículo
  generalPct: number,         // bonificación general del cliente (por segmento)
  viajantePct: number,        // bonificación viajante del cliente (por segmento)
): {
  precio_lista: number
  descuentos_json: DescuentoKardex[]
  descuento_oferta_pct: number | null
  descuento_oferta_monto: number | null
  descuento_general_pct: number | null
  descuento_general_monto: number | null
  descuento_viajante_pct: number | null
  descuento_viajante_monto: number | null
} {
  const descuentos_json: DescuentoKardex[] = []

  let descuento_oferta_pct: number | null = null
  let descuento_oferta_monto: number | null = null
  if (ofertaPct > 0) {
    const bruto = round2(precioLista / (1 - ofertaPct / 100))
    descuento_oferta_pct = ofertaPct
    descuento_oferta_monto = round2(bruto - precioLista)
    descuentos_json.push({ tipo: 'oferta', porcentaje: ofertaPct, monto_unitario: descuento_oferta_monto })
  }

  const afterGeneral = round2(precioLista * (1 - generalPct / 100))
  let descuento_general_pct: number | null = null
  let descuento_general_monto: number | null = null
  if (generalPct > 0) {
    descuento_general_pct = generalPct
    descuento_general_monto = round2(precioLista - afterGeneral)
    descuentos_json.push({ tipo: 'general', porcentaje: generalPct, monto_unitario: descuento_general_monto })
  }

  let descuento_viajante_pct: number | null = null
  let descuento_viajante_monto: number | null = null
  if (viajantePct > 0) {
    descuento_viajante_pct = viajantePct
    descuento_viajante_monto = round2(afterGeneral - precioConDescuento)
    descuentos_json.push({ tipo: 'viajante', porcentaje: viajantePct, monto_unitario: descuento_viajante_monto })
  }

  return {
    precio_lista: precioLista,
    descuentos_json,
    descuento_oferta_pct,
    descuento_oferta_monto,
    descuento_general_pct,
    descuento_general_monto,
    descuento_viajante_pct,
    descuento_viajante_monto,
  }
}

// ─── Preview precio (sin escribir a DB) — para mostrador ─────────────────────
export async function previewPrecioArticulo(
  clienteId: string,
  articuloId: string,
  overrides: {
    metodo_facturacion_pedido?: string
    lista_precio_pedido_id?: string
    lista_limpieza_pedido_id?: string; metodo_limpieza_pedido?: string
    lista_perf0_pedido_id?: string;    metodo_perf0_pedido?: string
    lista_perf_plus_pedido_id?: string; metodo_perf_plus_pedido?: string
    // Bonificación viajante SOLO para este pedido (pisa la de la ficha)
    bonif_viajante_pedido_pct?: number | null
    // Condiciones por proveedor (este pedido) — pisan al rubro para esa mercadería
    condiciones_proveedor?: CondicionProveedor[]
    // Condiciones por marca (este pedido) — ganan sobre proveedor
    condiciones_marca?: CondicionMarca[]
  } = {},
): Promise<{ precio: number; precioNeto: number; contado: number; especial: { bruto: number; oferta_pct: number } | null; descripcion: string; sku: string; unidades_por_bulto: number; bonifViajantePct: number }> {
  const supabase = await createClient()

  const [clienteRes, articuloRes] = await Promise.all([
    supabase.from("clientes").select(`
      id, vendedor_id, metodo_facturacion, lista_precio_id,
      lista_limpieza_id, metodo_limpieza, lista_perf0_id, metodo_perf0,
      lista_perf_plus_id, metodo_perf_plus
    `).eq("id", clienteId).single(),
    fetchArticuloConDescuentos(supabase, articuloId),
  ])

  if (!clienteRes.data) throw new Error("Cliente no encontrado")
  const clienteInfo = clienteRes.data
  const articulo = articuloRes

  const { data: artMeta } = await supabase
    .from("articulos").select("descripcion, sku, unidades_por_bulto").eq("id", articuloId).single()

  const formulasReglas = await fetchFormulasReglas(supabase)
  const listasCache: Record<string, DatosLista> = {}

  // Condición por proveedor + marca (del cliente + override del formulario). Marca gana.
  const condicionesProveedor = mergeCondicionesProveedor(
    await fetchCondicionesProveedor(supabase, clienteId),
    overrides.condiciones_proveedor,
  )
  const condicionesMarca = mergeCondicionesMarca(
    await fetchCondicionesMarca(supabase, clienteId),
    overrides.condiciones_marca,
  )
  const { cond } = resolverCondSegmento(articulo, condicionesProveedor, condicionesMarca)

  const segmento = detectarSegmento(articulo)
  let listaId: string | null
  let metodoRaw: string
  if (cond) {
    listaId = cond.lista_precio_id
    metodoRaw = cond.metodo_facturacion || "Final"
  } else {
    const resuelto = resolverListaSegmento(segmento, overrides, clienteInfo)
    listaId = resuelto.listaId
    metodoRaw = resuelto.metodoRaw
  }
  const { general, viajante } = await fetchBonifGeneralViajante(supabase, clienteId, overrides)
  const bonif = resolverBonifItem(cond, general, viajante, segmento)
  const listaDatos = await fetchListaDatos(supabase, listaId, listasCache, formulasReglas)
  const metodo = toMetodoFacturacion(metodoRaw)

  const precio = calcularPrecioPedido(articulo, listaDatos, metodo, bonif)

  return {
    precio: precio.precioAlCliente,
    precioNeto: precio.precioNeto,
    // Contado = 10% menos (regla de la NC de pago contado).
    // Lista Especial NO tiene precio contado: es neto fijo + IVA.
    contado: precio.esListaEspecial ? precio.precioAlCliente : round2(precio.precioAlCliente * 0.9),
    especial: precio.esListaEspecial
      ? { bruto: precio.precioBrutoEspecial, oferta_pct: precio.ofertaEspecialPct }
      : null,
    descripcion: artMeta?.descripcion || "",
    sku: artMeta?.sku || "",
    unidades_por_bulto: artMeta?.unidades_por_bulto || 1,
    // Ya aplicada en `precio`; se expone para que la app del vendedor lo muestre
    bonifViajantePct: precio.bonifViajantePct,
  }
}

// Precios de una LISTA de artículos para un cliente en una sola llamada
// (para mostrar precios en el catálogo del vendedor). Misma resolución que
// previewPrecioArticulo pero con fetches batcheados y caches compartidos.
export async function previewPreciosArticulos(
  clienteId: string,
  articuloIds: string[],
  overrides: {
    metodo_facturacion_pedido?: string
    lista_precio_pedido_id?: string
    lista_limpieza_pedido_id?: string; metodo_limpieza_pedido?: string
    lista_perf0_pedido_id?: string;    metodo_perf0_pedido?: string
    lista_perf_plus_pedido_id?: string; metodo_perf_plus_pedido?: string
    bonif_viajante_pedido_pct?: number | null
  } = {},
): Promise<Array<{ articulo_id: string; precio: number; precioNeto: number; contado: number; ivaIncluido: boolean; especial: { bruto: number; oferta_pct: number } | null; bonifViajantePct: number }>> {
  if (!articuloIds?.length) return []
  const ids = [...new Set(articuloIds)].slice(0, 600)
  const supabase = await createClient()

  const { data: clienteInfo } = await supabase
    .from("clientes")
    .select(`
      id, vendedor_id, metodo_facturacion, lista_precio_id,
      lista_limpieza_id, metodo_limpieza, lista_perf0_id, metodo_perf0,
      lista_perf_plus_id, metodo_perf_plus
    `)
    .eq("id", clienteId)
    .single()
  if (!clienteInfo) throw new Error("Cliente no encontrado")

  const [{ data: articulos }, { data: descuentosDB }] = await Promise.all([
    supabase
      .from("articulos")
      .select("id,proveedor_id,marca_id,precio_compra,precio_base,precio_base_contado,precio_lista_especial,oferta_lista_especial,porcentaje_ganancia,bonif_recargo,categoria,iva_compras,iva_ventas,descuento_propio,segmento_precio,rubros:rubro_id(slug),proveedor:proveedores(tipo_descuento)")
      .in("id", ids),
    supabase
      .from("articulos_descuentos")
      .select("articulo_id,tipo,porcentaje,orden")
      .in("articulo_id", ids)
      .order("orden"),
  ])

  const descPorArt = new Map<string, DescuentoTipado[]>()
  for (const d of descuentosDB || []) {
    const list = descPorArt.get(d.articulo_id) || []
    list.push({ tipo: d.tipo, porcentaje: d.porcentaje, orden: d.orden })
    descPorArt.set(d.articulo_id, list)
  }

  const formulasReglas = await fetchFormulasReglas(supabase)
  const listasCache: Record<string, DatosLista> = {}
  const condicionesProveedor = await fetchCondicionesProveedor(supabase, clienteId)
  const condicionesMarca = await fetchCondicionesMarca(supabase, clienteId)
  const { general, viajante } = await fetchBonifGeneralViajante(supabase, clienteId, overrides)

  const out: Array<{ articulo_id: string; precio: number; precioNeto: number; contado: number; ivaIncluido: boolean; especial: { bruto: number; oferta_pct: number } | null; bonifViajantePct: number }> = []
  for (const art of articulos || []) {
    try {
      const articulo = { ...art, descuentos: descPorArt.get(art.id) || [] }
      const segmento = detectarSegmento(articulo)
      const { cond } = resolverCondSegmento(articulo, condicionesProveedor, condicionesMarca)
      let listaId: string | null
      let metodoRaw: string
      if (cond) {
        listaId = cond.lista_precio_id
        metodoRaw = cond.metodo_facturacion || "Final"
      } else {
        const r = resolverListaSegmento(segmento, overrides, clienteInfo)
        listaId = r.listaId
        metodoRaw = r.metodoRaw
      }
      const listaDatos = await fetchListaDatos(supabase, listaId, listasCache, formulasReglas)
      const metodo = toMetodoFacturacion(metodoRaw)
      const bonif = resolverBonifItem(cond, general, viajante, segmento)
      const precio = calcularPrecioPedido(articulo, listaDatos, metodo, bonif)
      out.push({
        articulo_id: art.id,
        precio: precio.precioAlCliente,
        precioNeto: precio.precioNeto,
        // Contado = 10% menos (misma regla que la NC de pago contado / precio_base_contado).
        // Lista Especial NO tiene precio contado: es neto fijo + IVA.
        contado: precio.esListaEspecial ? precio.precioAlCliente : round2(precio.precioAlCliente * 0.9),
        // precio > neto → el precio mostrado lleva IVA incluido; iguales → sin IVA (presupuesto)
        ivaIncluido: Math.abs(precio.precioAlCliente - precio.precioNeto) > 0.01,
        especial: precio.esListaEspecial
          ? { bruto: precio.precioBrutoEspecial, oferta_pct: precio.ofertaEspecialPct }
          : null,
        bonifViajantePct: precio.bonifViajantePct,
      })
    } catch {
      // artículo sin precio calculable: se omite de la respuesta
    }
  }
  return out
}

// ─── CRUD condiciones por proveedor (Feature 1) ──────────────────────────────

// Condiciones por proveedor guardadas en la ficha del cliente (con nombre del proveedor)
export async function getCondicionesProveedorCliente(clienteId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("cliente_proveedor_condicion")
    .select(`id, proveedor_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct,
             proveedores:proveedor_id(nombre), listas_precio:lista_precio_id(nombre, codigo)`)
    .eq("cliente_id", clienteId)
    .order("created_at")
  if (error) throw error
  return data || []
}

// Upsert (una condición por cliente+proveedor)
export async function saveCondicionProveedorCliente(input: {
  cliente_id: string
  proveedor_id: string
  lista_precio_id?: string | null
  metodo_facturacion?: string | null
  dto_general_pct?: number | null
  dto_viajante_pct?: number | null
  dto_mercaderia_pct?: number | null
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")
  if (!input.proveedor_id) throw new Error("Falta el proveedor")

  const { error } = await supabase
    .from("cliente_proveedor_condicion")
    .upsert({
      cliente_id:         input.cliente_id,
      proveedor_id:       input.proveedor_id,
      lista_precio_id:    input.lista_precio_id ?? null,
      metodo_facturacion: input.metodo_facturacion ?? null,
      dto_general_pct:    input.dto_general_pct ?? null,
      dto_viajante_pct:   input.dto_viajante_pct ?? null,
      dto_mercaderia_pct: input.dto_mercaderia_pct ?? null,
    }, { onConflict: "cliente_id,proveedor_id" })
  if (error) throw error
  revalidatePath(`/clientes/${input.cliente_id}`)
  return { success: true }
}

export async function deleteCondicionProveedorCliente(id: string, clienteId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("cliente_proveedor_condicion").delete().eq("id", id)
  if (error) throw error
  revalidatePath(`/clientes/${clienteId}`)
  return { success: true }
}

// ─── CRUD condiciones por marca (espejo de proveedor) ────────────────────────

export async function getCondicionesMarcaCliente(clienteId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("cliente_marca_condicion")
    .select(`id, marca_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct,
             marcas:marca_id(descripcion), listas_precio:lista_precio_id(nombre, codigo)`)
    .eq("cliente_id", clienteId)
    .order("created_at")
  if (error) throw error
  return data || []
}

export async function saveCondicionMarcaCliente(input: {
  cliente_id: string
  marca_id: string
  lista_precio_id?: string | null
  metodo_facturacion?: string | null
  dto_general_pct?: number | null
  dto_viajante_pct?: number | null
  dto_mercaderia_pct?: number | null
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")
  if (!input.marca_id) throw new Error("Falta la marca")

  const { error } = await supabase
    .from("cliente_marca_condicion")
    .upsert({
      cliente_id:         input.cliente_id,
      marca_id:           input.marca_id,
      lista_precio_id:    input.lista_precio_id ?? null,
      metodo_facturacion: input.metodo_facturacion ?? null,
      dto_general_pct:    input.dto_general_pct ?? null,
      dto_viajante_pct:   input.dto_viajante_pct ?? null,
      dto_mercaderia_pct: input.dto_mercaderia_pct ?? null,
    }, { onConflict: "cliente_id,marca_id" })
  if (error) throw error
  revalidatePath(`/clientes/${input.cliente_id}`)
  return { success: true }
}

export async function deleteCondicionMarcaCliente(id: string, clienteId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("cliente_marca_condicion").delete().eq("id", id)
  if (error) throw error
  revalidatePath(`/clientes/${clienteId}`)
  return { success: true }
}

// Condiciones por proveedor efectivas para un pedido (override del pedido > ficha del cliente)
export async function getCondicionesProveedorPedido(pedidoId: string, clienteId: string) {
  const supabase = await createClient()
  const map = await fetchCondicionesProveedor(supabase, clienteId, pedidoId)
  return Array.from(map.values())
}

export async function createPedido(data: {
  cliente_id: string
  items: Array<{
    producto_id: string
    cantidad: number
    precio_unitario: number  // ignored — price is always calculated from lista/metodo
    descuento: number
  }>
  observaciones?: string
  zona_entrega?: string
  // Condiciones generales (todo el pedido)
  metodo_facturacion_pedido?: string
  lista_precio_pedido_id?: string
  // Condiciones por segmento de rubro (limpieza / perf0 / perf_plus)
  lista_limpieza_pedido_id?: string
  metodo_limpieza_pedido?: string
  lista_perf0_pedido_id?: string
  metodo_perf0_pedido?: string
  lista_perf_plus_pedido_id?: string
  metodo_perf_plus_pedido?: string
  // Condiciones por proveedor — override por pedido de la mercadería de un proveedor
  condiciones_proveedor?: CondicionProveedor[]
  // Condiciones por marca — override por pedido de la mercadería de una marca (gana sobre proveedor)
  condiciones_marca?: CondicionMarca[]
  // Descuentos por segmento cargados en el pedido (general/viajante/mercadería).
  // Si vienen, se usan en lugar de las bonificaciones permanentes del cliente.
  bonificaciones_pedido?: Array<{ tipo: string; segmento: string | null; porcentaje: number }>
  // Bonificación viajante SOLO para este pedido (todos los segmentos). Se
  // persiste en pedidos.bonif_viajante_pedido_pct para que los ítems que se
  // agreguen después y los re-precios la respeten.
  bonif_viajante_pedido_pct?: number | null
  // Mercadería bonificada elegida al crear el pedido: artículos a regalar + % .
  // Las unidades se calculan por monto (% × neto) repartido parejo, y luego se
  // reajustan en vivo al preparar en depósito.
  mercaderia_bonificada?: { pct: number; articulo_ids: string[] }
  // "en_venta": el vendedor está armando el pedido en vivo (autoguardado);
  // pasa a "pendiente" al confirmar (confirmarPedidoVendedor).
  estado_inicial?: "en_venta" | "pendiente"
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const numeroPedido = await getNextOrderNumber(supabase)

  const { data: clienteInfo, error: clienteError } = await supabase
    .from("clientes")
    .select(`
      id, vendedor_id, metodo_facturacion, lista_precio_id,
      lista_limpieza_id, metodo_limpieza,
      lista_perf0_id, metodo_perf0,
      lista_perf_plus_id, metodo_perf_plus, provincia
    `)
    .eq("id", data.cliente_id)
    .single()
  if (clienteError || !clienteInfo) throw new Error(`Cliente no encontrado: ${clienteError?.message || data.cliente_id}`)

  // Cache de listas para evitar múltiples queries a la misma lista
  const listasCache: Record<string, DatosLista> = {}
  // Cargar todas las reglas de fórmulas una sola vez para el pedido
  const formulasReglas = await fetchFormulasReglas(supabase)

  // Bonificaciones general + viajante (escalonadas en el neto por línea).
  // Prioridad: las cargadas en el pedido (inline) > las permanentes del cliente.
  let bonifData: Array<{ tipo: string; segmento: string | null; porcentaje: number }>
  if (data.bonificaciones_pedido && data.bonificaciones_pedido.length > 0) {
    bonifData = data.bonificaciones_pedido
  } else {
    const { data: bonifTabla } = await supabase
      .from("bonificaciones")
      .select("tipo, segmento, porcentaje")
      .eq("cliente_id", data.cliente_id)
      .eq("activo", true)
      .in("tipo", ["general", "viajante"])
    bonifData = bonifTabla ?? []
  }
  const bonifGeneral: Array<{ segmento: string | null; porcentaje: number }> =
    bonifData.filter((b: any) => b.tipo === "general")
  const bonificacionesViajante: Array<{ segmento: string | null; porcentaje: number }> =
    typeof data.bonif_viajante_pedido_pct === "number"
      ? [{ segmento: null, porcentaje: data.bonif_viajante_pedido_pct }]
      : bonifData.filter((b: any) => b.tipo === "viajante")

  // Condiciones por proveedor: del cliente + overrides del formulario (este pedido)
  const condicionesProveedor = mergeCondicionesProveedor(
    await fetchCondicionesProveedor(supabase, data.cliente_id),
    data.condiciones_proveedor,
  )
  // Condiciones por marca: del cliente + overrides del formulario (este pedido)
  const condicionesMarca = mergeCondicionesMarca(
    await fetchCondicionesMarca(supabase, data.cliente_id),
    data.condiciones_marca,
  )

  // Overrides de segmento del pedido (vienen del formulario)
  const segmentoOverrides = {
    lista_precio_pedido_id:    data.lista_precio_pedido_id,
    metodo_facturacion_pedido: data.metodo_facturacion_pedido,
    lista_limpieza_pedido_id:  data.lista_limpieza_pedido_id,
    metodo_limpieza_pedido:    data.metodo_limpieza_pedido,
    lista_perf0_pedido_id:     data.lista_perf0_pedido_id,
    metodo_perf0_pedido:       data.metodo_perf0_pedido,
    lista_perf_plus_pedido_id: data.lista_perf_plus_pedido_id,
    metodo_perf_plus_pedido:   data.metodo_perf_plus_pedido,
  }

  // ── Calculate real price for each item ──────────────────────────────────
  type ItemCalc = {
    producto_id: string; cantidad: number
    precioAlCliente: number; precioNeto: number; precio_costo: number
    listaUsadaId: string | null; metodoUsado: string
    descuentoPropioPct: number; precioLista: number
    bonifGeneralPct: number; bonifViajantePct: number; precioConDescuento: number
    segmento: Segmento
    cond: CondicionSegmento | null
    segKey: string | null
    esEspecial: boolean
  }
  const itemsCalc: ItemCalc[] = []
  for (const item of data.items) {
    const articulo = await fetchArticuloConDescuentos(supabase, item.producto_id)
    const segmento = detectarSegmento(articulo)
    // ¿Este artículo cae en un segmento (marca o proveedor)? Marca gana sobre proveedor.
    const { cond, segKey } = resolverCondSegmento(articulo, condicionesProveedor, condicionesMarca)
    let listaId: string | null
    let metodoRaw: string
    let generalPct: number
    let viajantePct: number
    if (cond) {
      // La mercadería del segmento se cotiza con su lista/método y sus propios
      // descuentos general/viajante (escalonados en el neto por línea).
      listaId = cond.lista_precio_id
      metodoRaw = cond.metodo_facturacion || "Final"
      generalPct = cond.dto_general_pct || 0
      viajantePct = cond.dto_viajante_pct || 0
    } else {
      const resuelto = resolverListaSegmento(segmento, segmentoOverrides, clienteInfo)
      listaId = resuelto.listaId
      metodoRaw = resuelto.metodoRaw
      generalPct = getDescuentoGeneral(bonifGeneral, segmento)
      viajantePct = getDescuentoViajante(bonificacionesViajante, segmento)
    }
    const listaDatos = await fetchListaDatos(supabase, listaId, listasCache, formulasReglas)
    const metodo = toMetodoFacturacion(metodoRaw)
    const precio = calcularPrecioPedido(articulo, listaDatos, metodo, { generalPct, viajantePct })
    // Lista especial: la oferta es oferta_lista_especial (no la oferta común descuento_propio).
    const esEspecial = (listaDatos.lista_codigo || "").toLowerCase() === "especial"
    const ofertaPropia = esEspecial ? (articulo.oferta_lista_especial || 0) : (articulo.descuento_propio || 0)
    itemsCalc.push({
      producto_id: item.producto_id,
      cantidad: item.cantidad,
      precioAlCliente: precio.precioAlCliente,
      precioNeto: precio.precioNeto,
      precio_costo: articulo.precio_compra || 0,
      listaUsadaId: listaId,
      metodoUsado: metodoRaw,
      descuentoPropioPct: ofertaPropia,
      precioLista: precio.precioLista,
      bonifGeneralPct: precio.bonifGeneralPct,
      bonifViajantePct: precio.bonifViajantePct,
      precioConDescuento: precio.precioConDescuento,
      segmento,
      cond,
      segKey,
      esEspecial,
    })
  }

  const total = Math.round(itemsCalc.reduce((s, i) => s + i.precioAlCliente * i.cantidad, 0) * 100) / 100
  const percepciones = 0 // aplica_percepciones no implementado aún en DB

  const { data: pedido, error: pedidoError } = await supabase
    .from("pedidos")
    .insert({
      numero_pedido: numeroPedido,
      cliente_id: data.cliente_id,
      vendedor_id: clienteInfo.vendedor_id,
      fecha: todayArgentina(),
      estado: data.estado_inicial === "en_venta" ? "en_venta" : "pendiente",
      subtotal: total,
      descuento_general: 0,
      ...(limpiarCentinela(data.metodo_facturacion_pedido) ? { metodo_facturacion_pedido: limpiarCentinela(data.metodo_facturacion_pedido) } : {}),
      ...(limpiarCentinela(data.lista_precio_pedido_id)    ? { lista_precio_pedido_id:    limpiarCentinela(data.lista_precio_pedido_id) }    : {}),
      ...(data.lista_limpieza_pedido_id     ? { lista_limpieza_pedido_id:     data.lista_limpieza_pedido_id }     : {}),
      ...(data.metodo_limpieza_pedido       ? { metodo_limpieza_pedido:       data.metodo_limpieza_pedido }       : {}),
      ...(data.lista_perf0_pedido_id        ? { lista_perf0_pedido_id:        data.lista_perf0_pedido_id }        : {}),
      ...(data.metodo_perf0_pedido          ? { metodo_perf0_pedido:          data.metodo_perf0_pedido }          : {}),
      ...(data.lista_perf_plus_pedido_id    ? { lista_perf_plus_pedido_id:    data.lista_perf_plus_pedido_id }    : {}),
      ...(data.metodo_perf_plus_pedido      ? { metodo_perf_plus_pedido:      data.metodo_perf_plus_pedido }      : {}),
      ...(typeof data.bonif_viajante_pedido_pct === "number" ? { bonif_viajante_pedido_pct: data.bonif_viajante_pedido_pct } : {}),
      total_flete: 0,
      total_impuestos: percepciones,
      total: Math.round((total + percepciones) * 100) / 100,
      observaciones: data.observaciones,
      creado_por: user.id,
    })
    .select()
    .single()

  if (pedidoError) throw pedidoError

  // Persistir las condiciones por proveedor de este pedido (override del formulario)
  if (data.condiciones_proveedor?.length) {
    const rows = data.condiciones_proveedor
      .filter(c => c?.proveedor_id)
      .map(c => ({
        pedido_id:          pedido.id,
        proveedor_id:       c.proveedor_id,
        lista_precio_id:    c.lista_precio_id ?? null,
        metodo_facturacion: c.metodo_facturacion ?? null,
        dto_general_pct:    c.dto_general_pct ?? null,
        dto_viajante_pct:   c.dto_viajante_pct ?? null,
        dto_mercaderia_pct: c.dto_mercaderia_pct ?? null,
      }))
    if (rows.length) {
      const { error: condError } = await supabase.from("pedido_proveedor_condicion").insert(rows)
      if (condError) console.error("[createPedido] Error guardando condiciones por proveedor:", condError.message)
    }
  }

  // Persistir las condiciones por marca de este pedido (override del formulario)
  if (data.condiciones_marca?.length) {
    const rows = data.condiciones_marca
      .filter(c => c?.marca_id)
      .map(c => ({
        pedido_id:          pedido.id,
        marca_id:           c.marca_id,
        lista_precio_id:    c.lista_precio_id ?? null,
        metodo_facturacion: c.metodo_facturacion ?? null,
        dto_general_pct:    c.dto_general_pct ?? null,
        dto_viajante_pct:   c.dto_viajante_pct ?? null,
        dto_mercaderia_pct: c.dto_mercaderia_pct ?? null,
      }))
    if (rows.length) {
      const { error: condError } = await supabase.from("pedido_marca_condicion").insert(rows)
      if (condError) console.error("[createPedido] Error guardando condiciones por marca:", condError.message)
    }
  }

  // Obtener stock actual de todos los artículos en una sola query
  const productIds = itemsCalc.map(i => i.producto_id)
  const { data: articulosInfo } = await supabase
    .from("articulos")
    .select("id, sku, descripcion, categoria, marca_id, proveedor_id, iva_compras, iva_ventas, segmento_precio, stock_actual")
    .in("id", productIds)
  const articulosMap = Object.fromEntries((articulosInfo || []).map((a: any) => [a.id, a]))

  // Obtener tasas de comisión del viajante antes del loop
  let vendedorComisiones: { comision_limpieza_bazar: number; comision_perfumeria_0: number; comision_perfumeria_plus: number } | null = null
  if (clienteInfo.vendedor_id) {
    const { data: vd } = await supabase
      .from("vendedores")
      .select("comision_limpieza_bazar, comision_perfumeria_0, comision_perfumeria_plus")
      .eq("id", clienteInfo.vendedor_id)
      .single()
    vendedorComisiones = vd ?? null
  }

  for (const item of itemsCalc) {
    // P.Lista bruto (pre-oferta) para mostrar en el comprobante: precioLista ya es post-oferta.
    const precioListaBruto = item.descuentoPropioPct > 0
      ? Math.round(item.precioLista / (1 - item.descuentoPropioPct / 100) * 100) / 100
      : item.precioLista
    const { error: itemError } = await supabase.from("pedidos_detalle").insert({
      pedido_id: pedido.id,
      articulo_id: item.producto_id,
      cantidad: item.cantidad,
      precio_base: item.precioNeto,
      precio_final: item.precioAlCliente,
      subtotal: Math.round(item.precioAlCliente * item.cantidad * 100) / 100,
      precio_costo: item.precio_costo,
      lista_precio_id: item.listaUsadaId,
      metodo_facturacion_item: item.metodoUsado,
      precio_lista: precioListaBruto,
      descuento_propio_pct: item.descuentoPropioPct,
      bonif_general_pct: item.bonifGeneralPct,
      bonif_viajante_pct: item.bonifViajantePct,
    })
    if (itemError) throw itemError

    // ── Insertar en kardex ────────────────────────────────────────────────
    const art = articulosMap[item.producto_id]
    const ivaIncluido = item.precioAlCliente === item.precioNeto   // presupuesto
    const ivaMonto = ivaIncluido ? 0 : Math.round((item.precioAlCliente - item.precioNeto) * 100) / 100
    const ivaPct = ivaMonto > 0 && item.precioNeto > 0
      ? Math.round((ivaMonto / item.precioNeto) * 10000) / 100
      : 0
    const stockActual = art?.stock_actual ?? null
    const metodoColor = item.metodoUsado
    const colorDinero = metodoColor === "Factura (21% IVA)" || metodoColor === "Factura" ? "BLANCO" : "NEGRO"
    const kardexDesc = buildKardexDescuentos(
      item.precioLista, item.precioConDescuento, item.descuentoPropioPct, item.bonifGeneralPct, item.bonifViajantePct,
    )

    await insertarKardex(
      createAdminClient(),
      {
        tipo_movimiento: "venta",
        fecha: nowArgentina(),
        articulo_id: item.producto_id,
        cantidad: item.cantidad,
        precio_costo: item.precio_costo,
        precio_lista: kardexDesc.precio_lista,
        precio_unitario_final: item.precioAlCliente,
        iva_porcentaje: ivaPct,
        iva_monto_unitario: ivaMonto,
        iva_incluido: ivaIncluido,
        descuentos_json: kardexDesc.descuentos_json.length > 0 ? kardexDesc.descuentos_json : undefined,
        descuento_oferta_pct: kardexDesc.descuento_oferta_pct,
        descuento_oferta_monto: kardexDesc.descuento_oferta_monto,
        descuento_general_pct: kardexDesc.descuento_general_pct,
        descuento_general_monto: kardexDesc.descuento_general_monto,
        descuento_viajante_pct: kardexDesc.descuento_viajante_pct,
        descuento_viajante_monto: kardexDesc.descuento_viajante_monto,
        subtotal_neto: Math.round(item.precioNeto * item.cantidad * 100) / 100,
        subtotal_iva: Math.round(ivaMonto * item.cantidad * 100) / 100,
        subtotal_total: Math.round(item.precioAlCliente * item.cantidad * 100) / 100,
        cliente_id: data.cliente_id,
        vendedor_id: clienteInfo.vendedor_id ?? null,
        provincia_destino: clienteInfo.provincia ?? null,
        pedido_id: pedido.id,
        lista_precio_id: item.listaUsadaId,
        metodo_facturacion: metodoColor,
        color_dinero: colorDinero,
        stock_antes: stockActual,
        stock_despues: stockActual !== null ? stockActual - item.cantidad : null,
        operador_id: user.id,
        // Comisión del viajante embebida en kardex (fórmula única: base = neto final,
        // tasa = comisión% − viajante%, restado una sola vez). El descuento_viajante (precio)
        // ya lo aporta buildKardexDescuentos. Mercadería/financiero reducen al cobrar.
        ...(() => {
          if (!vendedorComisiones || !art?.segmento_precio) return {}
          const comisionPct = getComisionPorcentaje(vendedorComisiones, art.segmento_precio, art.iva_ventas)
          const viajantePct = item.bonifViajantePct
          if (comisionPct <= 0 && viajantePct <= 0) return {}
          const { monto, tasaEfectivaPct } = calcularComisionMonto({
            precioNetoUnitario: item.precioNeto,
            cantidad: item.cantidad,
            metodoFacturacion: item.metodoUsado,
            ivaVentas: art.iva_ventas,
            comisionPct,
            viajantePct,
          })
          return {
            comision_viajante_pct: tasaEfectivaPct,
            comision_viajante_monto: monto,
          }
        })(),
      },
      {
        sku: art?.sku,
        descripcion: art?.descripcion,
        categoria: art?.categoria,
        marca_id: art?.marca_id,
        proveedor_id: art?.proveedor_id,
        iva_compras: art?.iva_compras,
        iva_ventas: art?.iva_ventas,
      },
    )
  }

  // NOTA (Fase A2): acá había escrituras a las tablas cuenta_corriente y
  // movimientos_cuenta, que NO EXISTEN en la DB — fallaban silenciosamente en
  // cada pedido dentro de un try/catch. La cuenta corriente del cliente se
  // postea al facturar (cc_postear via comprobantes), no al crear el pedido.

  // ── Mercadería bonificada elegida al crear el pedido ──────────────────────
  // Monto a bonificar = % × total (sin bonificados), repartido parejo entre los
  // artículos elegidos. Crea las líneas es_bonificado; las cantidades se
  // reajustan en vivo al preparar el pedido en depósito.
  const merc = data.mercaderia_bonificada
  if (merc && merc.pct > 0 && merc.articulo_ids.length > 0) {
    try {
      await supabase.from("pedidos").update({ bonif_mercaderia_pct: merc.pct }).eq("id", pedido.id)
      // Base = NETO (sin IVA ni percepciones), excluyendo los artículos segmentados
      // (proveedor/marca con condición propia): esos usan SOLO su propia mercadería.
      const netoBonifBase = itemsCalc.reduce((s, i) => s + (i.cond ? 0 : i.precioNeto * i.cantidad), 0)
      const monto = netoBonifBase * merc.pct / 100
      const share = monto / merc.articulo_ids.length
      for (const artId of merc.articulo_ids) {
        const preview = await previewPrecioArticulo(data.cliente_id, artId, {})
        const precioNetoArt = preview.precioNeto || 0  // neto: consistente con la base neta
        const units = precioNetoArt > 0 ? Math.round(share / precioNetoArt) : 0
        if (units > 0) await agregarItemBonificado(pedido.id, artId, units)
      }
    } catch (bonifErr) {
      console.error("Error creando mercadería bonificada:", bonifErr)
    }
  }

  // ── Mercadería bonificada POR SEGMENTO (proveedor/marca con dto_mercaderia_pct) ──
  // Cada segmento regala % × su propio neto, repartido entre SUS artículos, como
  // líneas es_bonificado. Como esos artículos pertenecen al segmento, la línea cae
  // en el comprobante aparte del segmento (igual que la mercadería a nivel pedido).
  try {
    const segGroups = new Map<string, { cond: CondicionSegmento; items: ItemCalc[] }>()
    for (const i of itemsCalc) {
      if (i.cond && i.segKey && (i.cond.dto_mercaderia_pct || 0) > 0) {
        if (!segGroups.has(i.segKey)) segGroups.set(i.segKey, { cond: i.cond, items: [] })
        segGroups.get(i.segKey)!.items.push(i)
      }
    }
    for (const { cond, items } of segGroups.values()) {
      const base = items.reduce((s, i) => s + i.precioNeto * i.cantidad, 0)
      const monto = base * (cond.dto_mercaderia_pct || 0) / 100
      if (monto <= 0 || items.length === 0) continue
      const share = monto / items.length
      for (const it of items) {
        const units = it.precioNeto > 0 ? Math.round(share / it.precioNeto) : 0
        if (units > 0) await agregarItemBonificado(pedido.id, it.producto_id, units)
      }
    }
  } catch (segMercErr) {
    console.error("Error creando mercadería bonificada por segmento:", segMercErr)
  }

  revalidatePath("/clientes-pedidos")
  return pedido
}

export async function getPedidoById(pedidoId: string) {
  const supabase = createAdminClient()

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: userRolesData } = await supabase
    .from("usuarios_roles")
    .select("roles(nombre)")
    .eq("usuario_id", user.id)

  const roles = userRolesData?.map((ur: any) => ur.roles?.nombre) || []

  const { data, error } = await supabase
    .from("pedidos")
    .select(`
      *,
      clientes:cliente_id (
        razon_social,
        direccion,
        zona,
        telefono,
        vendedor_id
      ),
      pedidos_detalle (
        *,
        articulos:articulo_id (
          descripcion,
          sku,
          proveedores:proveedor_id (
            nombre
          )
        )
      )
    `)
    .eq("id", pedidoId)
    .single()

  if (error) throw error
  if (!data) throw new Error("Pedido no encontrado")

  // Verify authorization
  const cliente = data.clientes as any

  if (roles.includes("admin")) {
    // Admin can see everything
  } else if (roles.includes("vendedor")) {
    if (cliente.vendedor_id !== user.id) {
      throw new Error("No autorizado para ver este pedido")
    }
  } else if (roles.includes("cliente")) {
    if (data.cliente_id !== user.id) {
      throw new Error("No autorizado para ver este pedido")
    }
  } else {
    throw new Error("No autorizado")
  }

  return data
}

export async function updatePedidoStatus(pedidoId: string, status: string) {
  const supabase = createAdminClient()

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: userRolesData } = await supabase
    .from("usuarios_roles")
    .select("roles(nombre)")
    .eq("usuario_id", user.id)

  const roles = userRolesData?.map((ur: any) => ur.roles?.nombre) || []

  if (!roles.includes("vendedor") && !roles.includes("admin")) {
    throw new Error("No autorizado")
  }

  const { data, error } = await supabase.from("pedidos").select("cliente_id").eq("id", pedidoId).single()

  if (error) throw error
  if (!data) throw new Error("Pedido no encontrado")

  const { data: cliente } = await supabase.from("clientes").select("vendedor_id").eq("id", data.cliente_id).single()

  if (!cliente) throw new Error("Cliente no encontrado")

  if (roles.includes("vendedor") && !roles.includes("admin")) {
    if (cliente.vendedor_id !== user.id) {
      throw new Error("No autorizado para actualizar este pedido")
    }
  }

  const { error: updateError } = await supabase.from("pedidos").update({ status }).eq("id", pedidoId)

  if (updateError) throw updateError

  revalidatePath("/viajante/pedidos")
  return { success: true }
}

export async function marcarPedidoImpreso(pedidoId: string) {
  const admin = createAdminClient()
  const { error } = await admin
    .from("pedidos")
    .update({ estado: "impreso" })
    .eq("id", pedidoId)
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function softDeletePedido(pedidoId: string) {
  const supabase = await createClient()

  // Verify the order exists and is in 'pendiente' state
  const { data: pedido, error: fetchError } = await supabase
    .from("pedidos")
    .select("id, estado, numero_pedido")
    .eq("id", pedidoId)
    .single()

  if (fetchError || !pedido) {
    throw new Error("Pedido no encontrado")
  }

  if (pedido.estado !== "pendiente" && pedido.estado !== "en_venta") {
    throw new Error("Solo se pueden eliminar pedidos en estado 'pendiente' o 'en venta'")
  }

  // Soft-delete: change state and record timestamp
  const { error: updateError } = await supabase
    .from("pedidos")
    .update({
      estado: "eliminado",
      eliminado_at: nowArgentina(),
    })
    .eq("id", pedidoId)

  if (updateError) {
    console.error("Error soft-deleting pedido:", updateError)
    throw new Error("Error al eliminar el pedido")
  }

  // Excluir las entradas de kardex de los reportes de ventas y comisiones
  await supabase
    .from("kardex")
    .update({ pedido_eliminado: true })
    .eq("pedido_id", pedidoId)

  revalidatePath("/clientes-pedidos")
  return { success: true, numero_pedido: pedido.numero_pedido }
}

// ─── Edición de pedidos pendientes ─────────────────────────────────────────

async function assertPedidoEditable(supabase: any, pedidoId: string) {
  const { data, error } = await supabase
    .from("pedidos")
    .select("id, estado")
    .eq("id", pedidoId)
    .single()
  if (error || !data) throw new Error("Pedido no encontrado")
  if (data.estado === "eliminado") throw new Error("El pedido está eliminado y no puede modificarse")
  if (data.estado === "facturado" || data.estado === "entregado")
    throw new Error("El pedido ya fue facturado/entregado y no puede modificarse")
  return data
}

// Total del pedido = Σ subtotales de líneas no bonificadas (mismo criterio que
// createPedido/guardarItemsPedido). Se llama tras cada alta/edición/baja de ítem.
async function recalcularTotalPedido(supabase: any, pedidoId: string) {
  const { data: allItems } = await supabase
    .from("pedidos_detalle")
    .select("subtotal, es_bonificado")
    .eq("pedido_id", pedidoId)
  const total = Math.round(
    (allItems || []).filter((i: any) => !i.es_bonificado).reduce((s: number, i: any) => s + (i.subtotal || 0), 0) * 100
  ) / 100
  await supabase.from("pedidos").update({ total, subtotal: total }).eq("id", pedidoId)
  return total
}

export async function agregarItemPedido(
  pedidoId: string,
  productoId: string,
  cantidad: number
) {
  const supabase = await createClient()
  await assertPedidoEditable(supabase, pedidoId)

  const { data: { user } } = await supabase.auth.getUser()

  // Fetch pedido con TODOS los overrides de segmento + cliente con su config de segmento
  const { data: pedido } = await supabase
    .from("pedidos")
    .select(`cliente_id,numero_pedido,${SEGMENTO_PEDIDO_COLS},clientes:cliente_id(${SEGMENTO_CLIENTE_COLS},provincia,vendedor_id)`)
    .eq("id", pedidoId)
    .single()
  if (!pedido) throw new Error("Pedido no encontrado")

  const clienteInfo = { ...(pedido.clientes as any), id: pedido.cliente_id }
  const formulasReglas = await fetchFormulasReglas(supabase)
  const listasCache: Record<string, DatosLista> = {}
  const condProvMap = await fetchCondicionesProveedor(supabase, pedido.cliente_id, pedidoId)
  const condMarcaMap = await fetchCondicionesMarca(supabase, pedido.cliente_id, pedidoId)

  const articuloConDescuentos = await fetchArticuloConDescuentos(supabase, productoId)
  const segmentoArt = detectarSegmento(articuloConDescuentos)
  // Resolución por segmento (igual que createPedido): marca > proveedor > override pedido > cliente > general
  const { listaId, metodoRaw: metodoItemRaw, metodo, listaDatos, cond } =
    await resolverListaMetodoItem(supabase, articuloConDescuentos, segmentoArt, pedido, clienteInfo, condProvMap, condMarcaMap, listasCache, formulasReglas)

  const { general, viajante } = await fetchBonifGeneralViajante(supabase, pedido.cliente_id, pedido)
  const bonif = resolverBonifItem(cond, general, viajante, segmentoArt)
  const precio = calcularPrecioPedido(articuloConDescuentos, listaDatos, metodo, bonif)

  const esEspecial = (listaDatos.lista_codigo || "").toLowerCase() === "especial"
  const ofertaPct = esEspecial ? (articuloConDescuentos.oferta_lista_especial || 0) : (articuloConDescuentos.descuento_propio || 0)
  const precioListaBruto = ofertaPct > 0 ? round2(precio.precioLista / (1 - ofertaPct / 100)) : precio.precioLista

  const { error } = await supabase.from("pedidos_detalle").insert({
    pedido_id: pedidoId,
    articulo_id: productoId,
    cantidad,
    precio_base: precio.precioNeto,
    precio_final: precio.precioAlCliente,
    subtotal: Math.round(precio.precioAlCliente * cantidad * 100) / 100,
    precio_costo: articuloConDescuentos.precio_compra || 0,
    lista_precio_id: listaId,
    metodo_facturacion_item: metodoItemRaw,
    precio_lista: precioListaBruto,
    descuento_propio_pct: ofertaPct,
    bonif_general_pct: precio.bonifGeneralPct,
    bonif_viajante_pct: precio.bonifViajantePct,
  })

  if (error) throw error

  // ── Insertar en kardex ──────────────────────────────────────────────────
  const [{ data: artInfo }, { data: clienteVendedor }] = await Promise.all([
    supabase.from("articulos").select("sku, descripcion, categoria, marca_id, proveedor_id, iva_compras, iva_ventas, stock_actual, segmento_precio").eq("id", productoId).single(),
    supabase.from("clientes").select("vendedor_id").eq("id", pedido.cliente_id).single(),
  ])
  const vendedorId = (clienteVendedor as any)?.vendedor_id ?? (pedido.clientes as any)?.vendedor_id ?? null
  let vendedorComisionesAgregar: { comision_limpieza_bazar: number; comision_perfumeria_0: number; comision_perfumeria_plus: number } | null = null
  if (vendedorId) {
    const { data: vd } = await supabase.from("vendedores").select("comision_limpieza_bazar, comision_perfumeria_0, comision_perfumeria_plus").eq("id", vendedorId).single()
    vendedorComisionesAgregar = vd ?? null
  }

  const ivaIncluido = precio.precioAlCliente === precio.precioNeto
  const ivaMonto = ivaIncluido ? 0 : Math.round((precio.precioAlCliente - precio.precioNeto) * 100) / 100
  const ivaPct = ivaMonto > 0 && precio.precioNeto > 0
    ? Math.round((ivaMonto / precio.precioNeto) * 10000) / 100 : 0
  const metodoRaw = metodoItemRaw
  const colorDinero = metodoRaw === "Factura (21% IVA)" || metodoRaw === "Factura" ? "BLANCO" : "NEGRO"
  const kardexDesc = buildKardexDescuentos(
    precio.precioLista, precio.precioConDescuento,
    ofertaPct, precio.bonifGeneralPct, precio.bonifViajantePct,
  )

  const comisionBlockAgregar = (() => {
    if (!vendedorComisionesAgregar || !artInfo?.segmento_precio) return {}
    const comisionPct = getComisionPorcentaje(vendedorComisionesAgregar, artInfo.segmento_precio, artInfo.iva_ventas)
    const viajantePct = precio.bonifViajantePct
    if (comisionPct <= 0 && viajantePct <= 0) return {}
    const { monto, tasaEfectivaPct } = calcularComisionMonto({
      precioNetoUnitario: precio.precioNeto,
      cantidad,
      metodoFacturacion: metodoRaw,
      ivaVentas: artInfo.iva_ventas,
      comisionPct,
      viajantePct,
    })
    return { comision_viajante_pct: tasaEfectivaPct, comision_viajante_monto: monto }
  })()

  await insertarKardex(
    createAdminClient(),
    {
      tipo_movimiento: "venta",
      fecha: nowArgentina(),
      articulo_id: productoId,
      cantidad,
      precio_costo: articuloConDescuentos.precio_compra || 0,
      precio_lista: precio.precioNeto,
      precio_unitario_final: precio.precioAlCliente,
      iva_porcentaje: ivaPct,
      iva_monto_unitario: ivaMonto,
      iva_incluido: ivaIncluido,
      descuentos_json: kardexDesc.descuentos_json.length > 0 ? kardexDesc.descuentos_json : undefined,
      descuento_oferta_pct: kardexDesc.descuento_oferta_pct,
      descuento_oferta_monto: kardexDesc.descuento_oferta_monto,
      descuento_general_pct: kardexDesc.descuento_general_pct,
      descuento_general_monto: kardexDesc.descuento_general_monto,
      descuento_viajante_pct: kardexDesc.descuento_viajante_pct,
      descuento_viajante_monto: kardexDesc.descuento_viajante_monto,
      subtotal_neto: Math.round(precio.precioNeto * cantidad * 100) / 100,
      subtotal_iva: Math.round(ivaMonto * cantidad * 100) / 100,
      subtotal_total: Math.round(precio.precioAlCliente * cantidad * 100) / 100,
      cliente_id: pedido.cliente_id,
      vendedor_id: vendedorId,
      provincia_destino: (pedido.clientes as any)?.provincia ?? null,
      pedido_id: pedidoId,
      numero_pedido: (pedido as any).numero_pedido ?? null,
      lista_precio_id: pedido.lista_precio_pedido_id || (pedido.clientes as any)?.lista_precio_id || null,
      metodo_facturacion: metodoRaw,
      color_dinero: colorDinero,
      stock_antes: artInfo?.stock_actual ?? null,
      stock_despues: artInfo?.stock_actual != null ? artInfo.stock_actual - cantidad : null,
      operador_id: user?.id ?? null,
      ...comisionBlockAgregar,
    },
    {
      sku: artInfo?.sku,
      descripcion: artInfo?.descripcion,
      categoria: artInfo?.categoria,
      marca_id: artInfo?.marca_id,
      proveedor_id: artInfo?.proveedor_id,
      iva_compras: artInfo?.iva_compras,
      iva_ventas: artInfo?.iva_ventas,
    },
  )

  // Marcar actualizado_por en el pedido
  if (user?.id) {
    await supabase.from("pedidos").update({ actualizado_por: user.id }).eq("id", pedidoId)
  }

  await recalcularTotalPedido(supabase, pedidoId)

  revalidatePath("/clientes-pedidos")
  return { success: true }
}

export async function agregarItemBonificado(
  pedidoId: string,
  productoId: string,
  cantidad: number
) {
  const supabase = await createClient()
  await assertPedidoEditable(supabase, pedidoId)

  const { data: { user } } = await supabase.auth.getUser()

  const { data: pedido } = await supabase
    .from("pedidos")
    .select(`cliente_id,numero_pedido,${SEGMENTO_PEDIDO_COLS},clientes:cliente_id(${SEGMENTO_CLIENTE_COLS},provincia,vendedor_id)`)
    .eq("id", pedidoId)
    .single()
  if (!pedido) throw new Error("Pedido no encontrado")

  const clienteInfo = { ...(pedido.clientes as any), id: pedido.cliente_id }
  const formulasReglas = await fetchFormulasReglas(supabase)
  const listasCache: Record<string, DatosLista> = {}
  const condProvMap = await fetchCondicionesProveedor(supabase, pedido.cliente_id, pedidoId)
  const condMarcaMap = await fetchCondicionesMarca(supabase, pedido.cliente_id, pedidoId)

  const articuloConDescuentos = await fetchArticuloConDescuentos(supabase, productoId)
  const segmentoBonif = detectarSegmento(articuloConDescuentos)
  // Resolución por segmento del producto bonificado (lista/método correctos)
  const { listaId: listaIdBonif, metodoRaw: metodoItemRaw, metodo, listaDatos } =
    await resolverListaMetodoItem(supabase, articuloConDescuentos, segmentoBonif, pedido, clienteInfo, condProvMap, condMarcaMap, listasCache, formulasReglas)
  // La mercadería bonificada es gratis (net $0): general/viajante no aplican a su precio.
  const precio = calcularPrecioPedido(articuloConDescuentos, listaDatos, metodo, {})
  const ofertaPctBonif = articuloConDescuentos.descuento_propio || 0
  const precioListaRef = precio.precioLista  // P.Lista real del producto bonificado
  // Viajante del segmento: se guarda en la línea para que la comisión "cobrada" use
  // la misma tasa (comisión% − viajante%) al restar el valor regalado.
  const { viajante: bonifViajante } = await fetchBonifGeneralViajante(supabase, pedido.cliente_id, pedido)
  const viajantePctBonif = getDescuentoViajante(bonifViajante, segmentoBonif)

  const { error } = await supabase.from("pedidos_detalle").insert({
    pedido_id: pedidoId,
    articulo_id: productoId,
    cantidad,
    precio_base: precio.precioNeto,
    precio_final: precio.precioAlCliente,
    subtotal: Math.round(precio.precioAlCliente * cantidad * 100) / 100,
    precio_costo: articuloConDescuentos.precio_compra || 0,
    es_bonificado: true,
    lista_precio_id: listaIdBonif,
    metodo_facturacion_item: metodoItemRaw,
    precio_lista: ofertaPctBonif > 0 ? round2(precioListaRef / (1 - ofertaPctBonif / 100)) : precioListaRef,
    descuento_propio_pct: ofertaPctBonif,
    bonif_general_pct: 0,
    bonif_viajante_pct: viajantePctBonif,
  })
  if (error) throw error

  const { data: artInfo } = await supabase
    .from("articulos")
    .select("sku, descripcion, categoria, marca_id, proveedor_id, iva_compras, iva_ventas, stock_actual, segmento_precio")
    .eq("id", productoId)
    .single()

  const metodoRaw = metodoItemRaw
  const colorDinero = metodoRaw === "Factura (21% IVA)" || metodoRaw === "Factura" ? "BLANCO" : "NEGRO"

  // Reducción de comisión por mercadería bonificada ("la venta real es $90"):
  // comisión negativa = − valor regalado × (comisión% − viajante%). El vendedor no
  // cobra comisión sobre lo que se entregó gratis.
  const vendedorIdBonif = (pedido.clientes as any)?.vendedor_id ?? null
  const comisionReduccion = await (async () => {
    if (!vendedorIdBonif || !artInfo?.segmento_precio) return {}
    const { data: vd } = await supabase.from("vendedores").select("comision_limpieza_bazar, comision_perfumeria_0, comision_perfumeria_plus").eq("id", vendedorIdBonif).single()
    if (!vd) return {}
    const comisionPct = getComisionPorcentaje(vd, artInfo.segmento_precio, artInfo.iva_ventas)
    if (comisionPct <= 0 && viajantePctBonif <= 0) return {}
    const { monto, tasaEfectivaPct } = calcularComisionMonto({
      precioNetoUnitario: precio.precioNeto,
      cantidad,
      metodoFacturacion: metodoRaw,
      ivaVentas: artInfo.iva_ventas,
      comisionPct,
      viajantePct: viajantePctBonif,
    })
    return { comision_viajante_pct: tasaEfectivaPct, comision_viajante_monto: -monto }
  })()

  await insertarKardex(
    createAdminClient(),
    {
      tipo_movimiento: "venta",
      fecha: nowArgentina(),
      articulo_id: productoId,
      cantidad,
      precio_costo: articuloConDescuentos.precio_compra || 0,
      precio_lista: precioListaRef,
      precio_unitario_final: 0,
      iva_porcentaje: 0,
      iva_monto_unitario: 0,
      iva_incluido: false,
      descuentos_json: [{ tipo: 'mercaderia' as const, porcentaje: 100, monto_unitario: precioListaRef }],
      descuento_cliente_pct: 0,
      descuento_mercaderia_pct: 100,
      descuento_mercaderia_monto: precioListaRef,
      descuento_general_pct: null,
      descuento_general_monto: null,
      subtotal_neto: 0,
      subtotal_iva: 0,
      subtotal_total: 0,
      cliente_id: pedido.cliente_id,
      vendedor_id: vendedorIdBonif,
      provincia_destino: (pedido.clientes as any)?.provincia ?? null,
      pedido_id: pedidoId,
      numero_pedido: (pedido as any).numero_pedido ?? null,
      lista_precio_id: pedido.lista_precio_pedido_id || (pedido.clientes as any)?.lista_precio_id || null,
      metodo_facturacion: metodoRaw,
      color_dinero: colorDinero,
      stock_antes: artInfo?.stock_actual ?? null,
      stock_despues: artInfo?.stock_actual != null ? artInfo.stock_actual - cantidad : null,
      operador_id: user?.id ?? null,
      ...comisionReduccion,
    },
    {
      sku: artInfo?.sku,
      descripcion: artInfo?.descripcion,
      categoria: artInfo?.categoria,
      marca_id: artInfo?.marca_id,
      proveedor_id: artInfo?.proveedor_id,
      iva_compras: artInfo?.iva_compras,
      iva_ventas: artInfo?.iva_ventas,
    },
  )

  if (user?.id) {
    await supabase.from("pedidos").update({ actualizado_por: user.id }).eq("id", pedidoId)
  }

  revalidatePath("/clientes-pedidos")
  return { success: true }
}

export async function actualizarCantidadItem(
  itemId: string,
  pedidoId: string,
  cantidad: number
) {
  if (cantidad <= 0) throw new Error("La cantidad debe ser mayor a 0")
  const supabase = await createClient()
  await assertPedidoEditable(supabase, pedidoId)

  const { data: item, error: fetchError } = await supabase
    .from("pedidos_detalle")
    .select("precio_final")
    .eq("id", itemId)
    .single()

  if (fetchError || !item) throw new Error("Ítem no encontrado")

  const { error } = await supabase
    .from("pedidos_detalle")
    .update({ cantidad, subtotal: item.precio_final * cantidad })
    .eq("id", itemId)

  if (error) throw error

  await recalcularTotalPedido(supabase, pedidoId)

  revalidatePath("/clientes-pedidos")
  return { success: true }
}

export async function eliminarItemPedido(itemId: string, pedidoId: string) {
  const supabase = await createClient()
  await assertPedidoEditable(supabase, pedidoId)

  const { error } = await supabase.from("pedidos_detalle").delete().eq("id", itemId)
  if (error) throw error

  await recalcularTotalPedido(supabase, pedidoId)

  revalidatePath("/clientes-pedidos")
  return { success: true }
}

export async function guardarItemsPedido(
  pedidoId: string,
  changes: Array<{ id: string; cantidad: number; precio_final: number; estado_item: string }>
) {
  const supabase = await createClient()
  await assertPedidoEditable(supabase, pedidoId)

  for (const change of changes) {
    const { error } = await supabase
      .from("pedidos_detalle")
      .update({
        cantidad: change.cantidad,
        precio_final: change.precio_final,
        subtotal: Math.round(change.precio_final * change.cantidad * 100) / 100,
        estado_item: change.estado_item,
      })
      .eq("id", change.id)
      .eq("pedido_id", pedidoId)
    if (error) throw error
  }

  const { data: allItems } = await supabase
    .from("pedidos_detalle")
    .select("subtotal, es_bonificado")
    .eq("pedido_id", pedidoId)

  const total = Math.round(
    (allItems || []).filter(i => !i.es_bonificado).reduce((s, i) => s + (i.subtotal || 0), 0) * 100
  ) / 100

  await supabase.from("pedidos").update({ total }).eq("id", pedidoId)

  revalidatePath("/clientes-pedidos")
  return { success: true }
}

// Re-precia todas las líneas no bonificadas de un pedido con sus overrides
// actuales (misma resolución que agregarItemPedido: marca > proveedor >
// override pedido > cliente). `pedido` debe traer SEGMENTO_PEDIDO_COLS +
// clientes(SEGMENTO_CLIENTE_COLS).
async function repreciarItemsPedido(supabase: any, pedido: any, pedidoId: string) {
  const clienteInfo = { ...(pedido.clientes as any), id: pedido.cliente_id }
  const formulasReglas = await fetchFormulasReglas(supabase)
  const listasCache: Record<string, DatosLista> = {}
  const condProvMap = await fetchCondicionesProveedor(supabase, pedido.cliente_id, pedidoId)
  const condMarcaMap = await fetchCondicionesMarca(supabase, pedido.cliente_id, pedidoId)
  const { general, viajante } = await fetchBonifGeneralViajante(supabase, pedido.cliente_id, pedido)

  const { data: items } = await supabase
    .from("pedidos_detalle")
    .select("id, articulo_id, cantidad, es_bonificado")
    .eq("pedido_id", pedidoId)

  for (const it of items || []) {
    if (it.es_bonificado) continue
    const articulo = await fetchArticuloConDescuentos(supabase, it.articulo_id)
    const segmentoArt = detectarSegmento(articulo)
    const { listaId, metodoRaw, metodo, listaDatos, cond } = await resolverListaMetodoItem(
      supabase, articulo, segmentoArt, pedido, clienteInfo, condProvMap, condMarcaMap, listasCache, formulasReglas
    )
    const bonif = resolverBonifItem(cond, general, viajante, segmentoArt)
    const precio = calcularPrecioPedido(articulo, listaDatos, metodo, bonif)
    const esEspecial = (listaDatos.lista_codigo || "").toLowerCase() === "especial"
    const ofertaPct = esEspecial ? (articulo.oferta_lista_especial || 0) : (articulo.descuento_propio || 0)
    const precioListaBruto = ofertaPct > 0 ? round2(precio.precioLista / (1 - ofertaPct / 100)) : precio.precioLista

    const { error: itemError } = await supabase
      .from("pedidos_detalle")
      .update({
        precio_base: precio.precioNeto,
        precio_final: precio.precioAlCliente,
        subtotal: round2(precio.precioAlCliente * it.cantidad),
        lista_precio_id: listaId,
        metodo_facturacion_item: metodoRaw,
        precio_lista: precioListaBruto,
        descuento_propio_pct: ofertaPct,
        bonif_general_pct: precio.bonifGeneralPct,
        bonif_viajante_pct: precio.bonifViajantePct,
      })
      .eq("id", it.id)
    if (itemError) throw itemError
  }
}

// Re-precia UN pedido (cualquier estado editable) con sus overrides actuales
// y la config vigente del cliente. Lo usa el ERP al guardar el encabezado del
// pedido (método/lista/segmentación del pedido) desde /clientes-pedidos/[id].
export async function repreciarPedido(pedidoId: string) {
  const supabase = await createClient()
  await assertPedidoEditable(supabase, pedidoId)
  const { data: pedido, error } = await supabase
    .from("pedidos")
    .select(`id,estado,cliente_id,numero_pedido,${SEGMENTO_PEDIDO_COLS},clientes:cliente_id(${SEGMENTO_CLIENTE_COLS},provincia,vendedor_id)`)
    .eq("id", pedidoId)
    .single()
  if (error || !pedido) throw new Error("Pedido no encontrado")
  await repreciarItemsPedido(supabase, pedido, pedidoId)
  const total = await recalcularTotalPedido(supabase, pedidoId)
  revalidatePath("/clientes-pedidos")
  return { success: true, total }
}

// Re-precia los pedidos ABIERTOS de un cliente (en_venta / pendiente: todavía
// no impresos ni facturados) con su configuración comercial ACTUAL: lista,
// método, bonificaciones y condiciones por proveedor/marca. Se invoca cada vez
// que cambia algo de eso en la ficha (ERP o app vendedor) para que lo que se
// factura coincida con lo que el cliente tiene asignado, no con el snapshot
// tomado al armar el carrito. Los pedidos ya impresos no se tocan: el papel
// que salió es el compromiso con el cliente. Best-effort por pedido.
export async function repreciarPedidosAbiertosCliente(clienteId: string) {
  const supabase = await createClient()
  const { data: pedidos, error } = await supabase
    .from("pedidos")
    .select(`id,estado,cliente_id,numero_pedido,${SEGMENTO_PEDIDO_COLS},clientes:cliente_id(${SEGMENTO_CLIENTE_COLS},provincia,vendedor_id)`)
    .eq("cliente_id", clienteId)
    .in("estado", ["en_venta", "pendiente"])
  if (error) throw error

  let repreciados = 0
  const errores: string[] = []
  for (const pedido of pedidos || []) {
    try {
      await repreciarItemsPedido(supabase, pedido, pedido.id)
      await recalcularTotalPedido(supabase, pedido.id)
      repreciados++
    } catch (e: any) {
      errores.push(`${(pedido as any).numero_pedido || pedido.id}: ${e?.message || e}`)
    }
  }
  if (repreciados > 0) revalidatePath("/clientes-pedidos")
  if (errores.length) console.error("[repreciarPedidosAbiertosCliente]", clienteId, errores)
  return { success: true, repreciados, errores }
}

// Condiciones "solo este pedido" desde el módulo vendedor: método, lista y/o
// bonificación viajante del pedido. Guarda los overrides que vengan definidos
// (""/null = volver a lo del cliente) y re-precia TODO el carrito al instante
// (incluye pedidos ya "pendientes"). `forzarReprecio` re-precia aunque nada
// cambie (p. ej. cuando cambió la config guardada del CLIENTE).
export async function aplicarCondicionesPedidoVendedor(
  pedidoId: string,
  cond: {
    metodo_facturacion_pedido?: string | null
    lista_precio_pedido_id?: string | null
    bonif_viajante_pedido_pct?: number | null
  },
  opts: { forzarReprecio?: boolean } = {}
) {
  const supabase = await createClient()
  await assertPedidoEditable(supabase, pedidoId)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: pedido } = await supabase
    .from("pedidos")
    .select(`id,estado,cliente_id,numero_pedido,${SEGMENTO_PEDIDO_COLS},clientes:cliente_id(${SEGMENTO_CLIENTE_COLS},provincia,vendedor_id)`)
    .eq("id", pedidoId)
    .single()
  if (!pedido) throw new Error("Pedido no encontrado")

  const patch: Record<string, any> = {}
  if (cond.metodo_facturacion_pedido !== undefined) {
    const v = limpiarCentinela(cond.metodo_facturacion_pedido || "") || null
    if (v !== ((pedido as any).metodo_facturacion_pedido || null)) patch.metodo_facturacion_pedido = v
  }
  if (cond.lista_precio_pedido_id !== undefined) {
    const v = limpiarCentinela(cond.lista_precio_pedido_id || "") || null
    if (v !== ((pedido as any).lista_precio_pedido_id || null)) patch.lista_precio_pedido_id = v
  }
  if (cond.bonif_viajante_pedido_pct !== undefined) {
    const raw = cond.bonif_viajante_pedido_pct
    const v = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : null
    if (v !== ((pedido as any).bonif_viajante_pedido_pct ?? null)) patch.bonif_viajante_pedido_pct = v
  }

  if (!Object.keys(patch).length && !opts.forzarReprecio) return { success: true, sinCambios: true }

  if (Object.keys(patch).length) {
    const { error } = await supabase
      .from("pedidos")
      .update({ ...patch, actualizado_por: user.id })
      .eq("id", pedidoId)
    if (error) throw error
    Object.assign(pedido as any, patch)
  }

  await repreciarItemsPedido(supabase, pedido, pedidoId)
  const total = await recalcularTotalPedido(supabase, pedidoId)

  revalidatePath("/clientes-pedidos")
  return { success: true, total }
}

// Compat: solo método (lo usaba la primera versión de la app)
export async function aplicarMetodoPedidoVendedor(
  pedidoId: string,
  metodoFacturacion: string,
  opts: { forzarReprecio?: boolean } = {}
) {
  return aplicarCondicionesPedidoVendedor(pedidoId, { metodo_facturacion_pedido: metodoFacturacion }, opts)
}

// ─── Confirmación del pedido armado en vivo por el vendedor ─────────────────
// El pedido nace "en_venta" (autoguardado ítem a ítem desde la tablet). Al
// confirmar: aplica observaciones, re-precia si cambió el método de facturación
// y pasa a "pendiente". Sobre pedidos ya pendientes/impresos actúa como
// "guardar cambios" (no toca el estado).
export async function confirmarPedidoVendedor(
  pedidoId: string,
  opts: { observaciones?: string; metodo_facturacion_pedido?: string } = {}
) {
  const supabase = await createClient()
  await assertPedidoEditable(supabase, pedidoId)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: pedido } = await supabase
    .from("pedidos")
    .select(`id,estado,cliente_id,numero_pedido,${SEGMENTO_PEDIDO_COLS},clientes:cliente_id(${SEGMENTO_CLIENTE_COLS},provincia,vendedor_id)`)
    .eq("id", pedidoId)
    .single()
  if (!pedido) throw new Error("Pedido no encontrado")

  // ¿Cambió el override de método del pedido? ("" limpia el override → método del cliente)
  const metodoNuevo = limpiarCentinela(opts.metodo_facturacion_pedido) || null
  const metodoActual = (pedido as any).metodo_facturacion_pedido || null
  const cambioMetodo = opts.metodo_facturacion_pedido !== undefined && metodoNuevo !== metodoActual

  if (cambioMetodo) {
    await supabase.from("pedidos").update({ metodo_facturacion_pedido: metodoNuevo }).eq("id", pedidoId)
    ;(pedido as any).metodo_facturacion_pedido = metodoNuevo
  }
  // Al confirmar un carrito en_venta se re-precia SIEMPRE: las líneas traen el
  // precio de cuando se agregaron y la lista/método/bonificación del cliente
  // pudo cambiar mientras tanto (ficha ERP o app). Lo que pasa a pendiente
  // queda con la configuración vigente, que es la que se factura.
  if (cambioMetodo || pedido.estado === "en_venta") {
    await repreciarItemsPedido(supabase, pedido, pedidoId)
  }

  const patch: Record<string, any> = { actualizado_por: user.id }
  if (opts.observaciones !== undefined) patch.observaciones = opts.observaciones || null
  if (pedido.estado === "en_venta") patch.estado = "pendiente"
  const { error: updError } = await supabase.from("pedidos").update(patch).eq("id", pedidoId)
  if (updError) throw updError

  const total = await recalcularTotalPedido(supabase, pedidoId)

  revalidatePath("/clientes-pedidos")
  return {
    success: true,
    numero_pedido: (pedido as any).numero_pedido as string | null,
    estado: (patch.estado || pedido.estado) as string,
    total,
  }
}
