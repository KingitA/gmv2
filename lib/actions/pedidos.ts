"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { getNextOrderNumber } from "@/lib/utils/next-order-number"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { calcularPrecioPedido } from "@/lib/pricing/calcular-precio-pedido"
import type { DatosLista, MetodoFacturacion, DescuentoTipado } from "@/lib/pricing/calculator"
import { insertarKardex } from "@/lib/kardex/insertar-kardex"
import { buildKardexDescuentos } from "@/lib/kardex/descuentos"
import { sincronizarKardexPedido } from "@/lib/kardex/sincronizar-pedido"
import { getComisionPorcentaje, getPrecioNeto, calcularComisionMonto } from "@/lib/comisiones/calcular"

// ─── Segmento de artículo: helper compartido (lib/pricing/segmento.ts) ───────
import {
  detectarSegmento,
  SEGMENTO_BONIF,
  SEGMENTOS_BONIF,
  normalizarBonifPedido,
  bonifSegAFilas,
  type Segmento,
  type BonifPedido,
} from "@/lib/pricing/segmento"
import {
  esPedidoEditable,
  puedeEliminarPedido,
  puedeEditarEntrega,
  puedeCambiarEstado,
  motivoBloqueo,
  ESTADO_LABEL,
} from "@/lib/pedidos/estados"
// Resolución lista/método/bonificaciones: módulo puro compartido con las apps
// móviles (lib/pricing/resolver.ts). Ver MOBILE.md → "Precios".
import {
  toMetodoFacturacion,
  limpiarCentinela,
  getDescuentoViajante,
  resolverListaMetodoConCondicion,
  resolverCondSegmento,
  mezclarOverride,
  resolverBonifItem,
  resolverContadoItem,
  resolverMercaderiaItem,
  type CondicionSegmento,
  type CondicionProveedor,
  type CondicionMarca,
  type FilaBonifTipo,
} from "@/lib/pricing/resolver"
import { conPreciosDelPedido, leerFichaComercial, TIPOS_BONIF_FICHA } from "@/lib/pedidos/condiciones-pedido"
import { recalcularBonificadosPedido } from "@/lib/pedidos/mercaderia-bonificada"
import { ErrorReglaPedido, MSG_SIN_LISTA } from "@/lib/pedidos/errores"
export type { CondicionSegmento, CondicionProveedor, CondicionMarca } from "@/lib/pricing/resolver"
import { prepararMotorCliente, precioArticuloParaCliente, descuentosPorArticulo, formulasReglasDesdeFilas, datosListaDesdeFila, type ArticuloMotor } from "@/lib/pricing/motor"
// Pedidos tomados en un dispositivo: insumos de precio vigentes a la captura
// (solo existe dentro del handler del outbox; en la web siempre es null). Ver el archivo.
import { capturaActual, clienteCapturado } from "@/lib/mobile/contexto-captura"
import { cargarInsumosCliente, ARTICULO_PRECIO_COLS } from "@/lib/pricing/cargar-insumos"

const CONDICION_PROVEEDOR_COLS =
  "proveedor_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, contado"
const CONDICION_MARCA_COLS =
  "marca_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, contado"

// Mapa proveedor_id → condición. Si se pasa pedidoId, el override del pedido pisa al del cliente.
async function fetchCondicionesProveedor(
  supabase: any,
  clienteId: string,
  pedidoId?: string | null,
): Promise<Map<string, CondicionProveedor>> {
  const map = new Map<string, CondicionProveedor>()
  const captura = capturaActual(clienteId)
  const { data: cli } = captura
    ? { data: captura.insumos.condicionesProveedor }
    : await supabase
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
  const captura = capturaActual(clienteId)
  const { data: cli } = captura
    ? { data: captura.insumos.condicionesMarca }
    : await supabase
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


// ─── Helper: fetch todas las reglas de fórmulas (una sola vez por request) ────
async function fetchFormulasReglas(
  supabase: any,
): Promise<Record<string, Record<string, string>>> {
  const captura = capturaActual()
  if (captura) return formulasReglasDesdeFilas(captura.insumos.reglas)
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
  const captura = capturaActual()
  if (captura) {
    const fila = captura.insumos.listas.find((l) => l.id === listaId)
    return (cache[listaId] = fila ? datosListaDesdeFila(fila, formulasReglas) : empty)
  }
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
  "bonif_pedido,bonif_mercaderia_pct,condiciones_cliente,precios_al"
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
): Promise<{ listaId: string | null; metodoRaw: string; metodo: MetodoFacturacion; listaDatos: DatosLista; cond: CondicionSegmento | null; segKey: string | null }> {
  const { cond, segKey } = resolverCondSegmento(articulo, condProvMap, condMarcaMap)
  const { listaId, metodoRaw } = resolverListaMetodoConCondicion(segmento, cond, pedidoOverrides, clienteCapturado(clienteInfo))
  // Regla del dueño: nunca se toma un pedido sin lista de precios
  if (!listaId) throw new ErrorReglaPedido(MSG_SIN_LISTA)
  const listaDatos = await fetchListaDatos(supabase, listaId, listasCache, formulasReglas)
  const metodo = toMetodoFacturacion(metodoRaw)
  return { listaId, metodoRaw, metodo, listaDatos, cond, segKey }
}

/**
 * Vista previa con las condiciones por proveedor/marca del pedido en armado: si
 * la pantalla manda la lista (completa, precargada de la ficha), esa REEMPLAZA a
 * la de la ficha — mismo criterio que createPedido.
 */
function insumosConCondicionesDelPedido<T extends { condicionesProveedor: any[]; condicionesMarca: any[] }>(
  insumos: T,
  overrides: { condiciones_proveedor?: unknown; condiciones_marca?: unknown },
): T {
  return {
    ...insumos,
    ...(Array.isArray(overrides.condiciones_proveedor) ? { condicionesProveedor: [] } : {}),
    ...(Array.isArray(overrides.condiciones_marca) ? { condicionesMarca: [] } : {}),
  }
}

/** Filas de mercadería / contado de la ficha (las congeladas del pedido si hay captura). */
async function fetchFichaFilas(supabase: any, clienteId: string): Promise<FilaBonifTipo[]> {
  const captura = capturaActual(clienteId)
  if (captura) return (captura.insumos.bonificaciones || []) as FilaBonifTipo[]
  const { data } = await supabase
    .from("bonificaciones")
    .select("tipo, segmento, porcentaje, proveedor_id")
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .in("tipo", ["mercaderia", "contado"])
  return ((data || []) as any[]).filter((b) => !b.proveedor_id) as FilaBonifTipo[]
}

/** Contado y cupo de mercadería de un renglón (se guardan en pedidos_detalle). */
function extrasRenglon(
  cond: CondicionSegmento | null,
  segKey: string | null,
  segmento: Segmento,
  esEspecial: boolean,
  pedido: { bonif_pedido?: BonifPedido | null; bonif_mercaderia_pct?: number | null },
  fichaFilas: FilaBonifTipo[],
) {
  const merc = resolverMercaderiaItem(cond, segKey, pedido.bonif_pedido, pedido.bonif_mercaderia_pct, fichaFilas, segmento, esEspecial)
  return {
    contado: resolverContadoItem(cond, pedido.bonif_pedido, fichaFilas, segmento, esEspecial),
    bonif_merc_origen: merc.origen,
    bonif_merc_pct: merc.pct > 0 ? merc.pct : null,
  }
}

async function fetchArticuloConDescuentos(supabase: any, productoId: string) {
  // Incluye sku/descripcion/stock/unidades_por_bulto para que agregarItem y
  // previewPrecio no necesiten una segunda consulta al artículo.
  const [{ data: articulo }, { data: descuentosDB }] = await Promise.all([
    supabase.from("articulos").select("id,sku,descripcion,unidades_por_bulto,stock_actual,proveedor_id,marca_id,precio_compra,precio_base,precio_base_contado,precio_lista_especial,oferta_lista_especial,porcentaje_ganancia,bonif_recargo,categoria,iva_compras,iva_ventas,descuento_propio,segmento_precio,rubros:rubro_id(slug),proveedor:proveedores(tipo_descuento)").eq("id", productoId).single(),
    supabase.from("articulos_descuentos").select("tipo,porcentaje,orden").eq("articulo_id", productoId).order("orden"),
  ])
  if (!articulo) throw new Error("Artículo no encontrado")
  const descuentos: DescuentoTipado[] = (descuentosDB || []).map((d: any) => ({ tipo: d.tipo, porcentaje: d.porcentaje, orden: d.orden }))
  // Pedido de un dispositivo: columnas de precio y descuentos vigentes a la captura
  const capturado = capturaActual()?.articulos.get(productoId)
  if (capturado) return { ...articulo, ...capturado, descuentos: (capturado.descuentos || []) as DescuentoTipado[] } as typeof articulo & { descuentos: DescuentoTipado[] }
  return { ...articulo, descuentos }
}

function round2(n: number) { return Math.round(n * 100) / 100 }

/** Trae las bonificaciones general + viajante activas de un cliente. */
// `pedidoOverrides.bonif_pedido` (columna pedidos.bonif_pedido jsonb o override
// en memoria del preview): { viajante: {limpieza_bazar, perf0, perf_plus} }.
// Si trae `viajante`, pisa la bonificación viajante de la ficha por segmento
// en este pedido ("solo este pedido" desde la app vendedor); los segmentos
// que no defina heredan del cliente. Sin override = ficha del cliente.
async function fetchBonifGeneralViajante(
  supabase: any,
  clienteId: string,
  pedidoOverrides?: { bonif_pedido?: BonifPedido | null } | null,
): Promise<{
  general: Array<{ segmento: string | null; porcentaje: number }>
  viajante: Array<{ segmento: string | null; porcentaje: number }>
}> {
  const captura = capturaActual(clienteId)
  const { data } = captura
    ? { data: captura.insumos.bonificaciones }
    : await supabase
        .from("bonificaciones")
        .select("tipo, segmento, porcentaje")
        .eq("cliente_id", clienteId)
        .eq("activo", true)
        .in("tipo", ["general", "viajante"])
  const rows = data ?? []
  return {
    general:  mezclarOverride(rows.filter((b: any) => b.tipo === "general"),  pedidoOverrides?.bonif_pedido, "general"),
    viajante: mezclarOverride(rows.filter((b: any) => b.tipo === "viajante"), pedidoOverrides?.bonif_pedido, "viajante"),
  }
}


// buildKardexDescuentos vive en lib/kardex/descuentos.ts (la comparte el
// sincronizador de kardex desde los renglones: lib/kardex/sincronizar-pedido.ts).

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
    // Bonificaciones SOLO para este pedido por segmento (pisan la ficha)
    bonif_pedido?: BonifPedido | null
    // Condiciones por proveedor (este pedido) — pisan al rubro para esa mercadería
    condiciones_proveedor?: CondicionProveedor[]
    // Condiciones por marca (este pedido) — ganan sobre proveedor
    condiciones_marca?: CondicionMarca[]
  } = {},
): Promise<{ precio: number; precioNeto: number; contado: number; especial: { bruto: number; oferta_pct: number } | null; descripcion: string; sku: string; unidades_por_bulto: number; bonifViajantePct: number }> {
  const supabase = await createClient()

  // Insumos del cliente + artículo en paralelo; el precio sale del motor
  // isomórfico (lib/pricing/motor.ts), el mismo que ejecutan las apps móviles.
  const [insumos, articulo] = await Promise.all([
    cargarInsumosCliente(supabase, clienteId),
    fetchArticuloConDescuentos(supabase, articuloId),
  ])
  const p = precioArticuloParaCliente(insumosConCondicionesDelPedido(insumos, overrides), articulo, overrides)

  return {
    precio: p.precio,
    precioNeto: p.precioNeto,
    // Contado = 10% menos (regla de la NC de pago contado).
    // Lista Especial NO tiene precio contado: es neto fijo + IVA.
    contado: p.contado,
    especial: p.especial,
    descripcion: articulo?.descripcion || "",
    sku: articulo?.sku || "",
    unidades_por_bulto: articulo?.unidades_por_bulto || 1,
    // Ya aplicada en `precio`; se expone para que la app del vendedor lo muestre
    bonifViajantePct: p.bonifViajantePct,
  }
}

// ─── Consulta de precios por lista+método (módulo PRECIOS del vendedor) ──────
// Precio "de tabla": motor completo (recargos de lista, fórmulas, oferta,
// IVA según método) SIN cliente — sin bonificaciones ni condiciones por
// proveedor/marca. Sirve para comparar cómo queda un artículo en Neco
// Factura vs Neco Final vs Viajante, etc.
// Seguridad: solo listas permitidas para el usuario — admin ve todas; un
// vendedor ve Neco más las listas que imponen sus viajantes (ej. Freije:
// Neco + Viajante). Un combo con lista no permitida corta con error.
export async function previewPreciosListas(
  articuloIds: string[],
  combos: Array<{ lista_id: string; metodo: string }>,
): Promise<Array<{ articulo_id: string; precios: Array<{ cc: number; contado: number } | null> }>> {
  if (!articuloIds?.length || !combos?.length) return []
  const ids = [...new Set(articuloIds)].slice(0, 400)
  const combosOk = combos.slice(0, 6)
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const [{ data: rolesData }, { data: vendedores }, { data: listas }] = await Promise.all([
    supabase.from("usuarios_roles").select("roles(nombre)").eq("usuario_id", user.id),
    supabase.from("vendedores").select("id, lista_precio_id").eq("usuario_id", user.id).eq("activo", true),
    supabase.from("listas_precio").select("id, codigo").eq("activo", true),
  ])
  const roles = (rolesData || []).map((r: any) => r.roles?.nombre)
  const esAdmin = roles.includes("admin")
  const necoId = (listas || []).find((l: any) => l.codigo === "neco")?.id
  const permitidas = new Set<string>(
    esAdmin
      ? (listas || []).map((l: any) => l.id)
      : [necoId, ...(vendedores || []).map((v: any) => v.lista_precio_id)].filter(Boolean)
  )
  for (const c of combosOk) {
    if (!permitidas.has(c.lista_id)) throw new Error("No tenés acceso a una de las listas pedidas.")
  }

  const [articulosRes, descuentosRes, formulasReglas] = await Promise.all([
    supabase
      .from("articulos")
      .select("id,proveedor_id,marca_id,precio_compra,precio_base,precio_base_contado,precio_lista_especial,oferta_lista_especial,porcentaje_ganancia,bonif_recargo,categoria,iva_compras,iva_ventas,descuento_propio,segmento_precio,rubros:rubro_id(slug),proveedor:proveedores(tipo_descuento)")
      .in("id", ids),
    supabase.from("articulos_descuentos").select("articulo_id,tipo,porcentaje,orden").in("articulo_id", ids).order("orden"),
    fetchFormulasReglas(supabase),
  ])

  const descPorArt = new Map<string, DescuentoTipado[]>()
  for (const d of descuentosRes.data || []) {
    const list = descPorArt.get(d.articulo_id) || []
    list.push({ tipo: d.tipo, porcentaje: d.porcentaje, orden: d.orden })
    descPorArt.set(d.articulo_id, list)
  }

  const listasCache: Record<string, DatosLista> = {}
  const combosDatos = await Promise.all(
    combosOk.map(async (c) => ({
      listaDatos: await fetchListaDatos(supabase, c.lista_id, listasCache, formulasReglas),
      metodo: toMetodoFacturacion(c.metodo),
    }))
  )

  const out: Array<{ articulo_id: string; precios: Array<{ cc: number; contado: number } | null> }> = []
  for (const art of articulosRes.data || []) {
    const articulo = { ...art, descuentos: descPorArt.get(art.id) || [] }
    const precios = combosDatos.map((cd) => {
      try {
        const p = calcularPrecioPedido(articulo as any, cd.listaDatos, cd.metodo, {})
        // Contado = 10% menos (regla de la NC por pago contado). La lista
        // Especial no tiene contado: es neto fijo + IVA.
        return {
          cc: p.precioAlCliente,
          contado: p.esListaEspecial ? p.precioAlCliente : round2(p.precioAlCliente * 0.9),
        }
      } catch {
        return null
      }
    })
    out.push({ articulo_id: art.id, precios })
  }
  return out
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
    bonif_pedido?: BonifPedido | null
    // Condiciones por proveedor / marca del pedido en armado (lista completa)
    condiciones_proveedor?: CondicionProveedor[]
    condiciones_marca?: CondicionMarca[]
  } = {},
): Promise<Array<{ articulo_id: string; precio: number; precioNeto: number; contado: number; ivaIncluido: boolean; especial: { bruto: number; oferta_pct: number } | null; bonifViajantePct: number }>> {
  if (!articuloIds?.length) return []
  const ids = [...new Set(articuloIds)].slice(0, 600)
  const supabase = await createClient()

  const [insumos, { data: articulos }, { data: descuentosDB }] = await Promise.all([
    cargarInsumosCliente(supabase, clienteId),
    supabase.from("articulos").select(ARTICULO_PRECIO_COLS).in("id", ids),
    supabase
      .from("articulos_descuentos")
      .select("articulo_id,tipo,porcentaje,orden")
      .in("articulo_id", ids)
      .order("orden"),
  ])

  const descPorArt = descuentosPorArticulo(descuentosDB || [])
  // Misma resolución que previewPrecioArticulo: motor isomórfico (lib/pricing/motor.ts)
  const motor = prepararMotorCliente(insumosConCondicionesDelPedido(insumos, overrides), overrides)

  const out: Array<{ articulo_id: string; precio: number; precioNeto: number; contado: number; ivaIncluido: boolean; especial: { bruto: number; oferta_pct: number } | null; bonifViajantePct: number }> = []
  for (const art of articulos || []) {
    try {
      // supabase-js tipa los joins to-one (rubros, proveedor) como arrays; en runtime son objetos
      const p = motor.precio({ ...art, descuentos: descPorArt.get(art.id) || [] } as unknown as ArticuloMotor)
      out.push({
        articulo_id: art.id,
        precio: p.precio,
        precioNeto: p.precioNeto,
        contado: p.contado,
        ivaIncluido: p.ivaIncluido,
        especial: p.especial,
        bonifViajantePct: p.bonifViajantePct,
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

/** Artículos a regalar por cupo de mercadería bonificada. */
export type MercaderiaBonificadaInput =
  // compat: un solo % para todo el pedido + artículos (pantallas viejas)
  | { pct: number; articulo_ids: string[] }
  // por cupo: origen = "todo" | "seg:<segmento>" | "prov:<id>" | "marca:<id>"
  | Array<{ origen: string; articulo_ids: string[] }>

function mercaderiaElegida(m: MercaderiaBonificadaInput | undefined | null): Array<{ origen: string; articulo_ids: string[] }> {
  if (!m) return []
  if (Array.isArray(m)) return m.filter((e) => e?.origen && Array.isArray(e.articulo_ids))
  return m.articulo_ids?.length ? [{ origen: "todo", articulo_ids: m.articulo_ids }] : []
}

/** Contexto para cotizar renglones de UN pedido (lo comparten alta, agregado y bonificados). */
interface CtxCotizacion {
  pedidoOverrides: any
  clienteInfo: any
  condProvMap: Map<string, CondicionProveedor>
  condMarcaMap: Map<string, CondicionMarca>
  viajanteFilas: Array<{ segmento: string | null; porcentaje: number }>
  listasCache: Record<string, DatosLista>
  formulasReglas: Record<string, Record<string, string>>
}

/**
 * Inserta un renglón de mercadería bonificada (a $0 en el comprobante) para el
 * cupo `origen`, con cantidad 0: las unidades las fija recalcularBonificadosPedido
 * (estimadas al armar, definitivas al cerrar el picking). Sin kardex: lo crea el
 * sincronizador cuando el renglón tiene cantidad.
 */
async function insertarRenglonBonificado(supabase: any, pedidoId: string, productoId: string, origen: string | null, ctx: CtxCotizacion, cantidad = 0) {
  const articulo = await fetchArticuloConDescuentos(supabase, productoId)
  const segmento = detectarSegmento(articulo)
  const { listaId, metodoRaw, metodo, listaDatos } = await resolverListaMetodoItem(
    supabase, articulo, segmento, ctx.pedidoOverrides, ctx.clienteInfo, ctx.condProvMap, ctx.condMarcaMap, ctx.listasCache, ctx.formulasReglas,
  )
  // Gratis: general/viajante no aplican a su precio (P.Lista real en el comprobante)
  const precio = calcularPrecioPedido(articulo, listaDatos, metodo, {})
  const ofertaPct = articulo.descuento_propio || 0
  // Viajante del segmento: la comisión que se resta por lo regalado usa la misma tasa
  const viajantePct = getDescuentoViajante(ctx.viajanteFilas, segmento)
  const { error } = await supabase.from("pedidos_detalle").insert({
    pedido_id: pedidoId,
    articulo_id: productoId,
    cantidad,
    precio_base: precio.precioNeto,
    precio_final: precio.precioAlCliente,
    subtotal: round2(precio.precioAlCliente * cantidad),
    precio_costo: articulo.precio_compra || 0,
    es_bonificado: true,
    lista_precio_id: listaId,
    metodo_facturacion_item: metodoRaw,
    precio_lista: ofertaPct > 0 ? round2(precio.precioLista / (1 - ofertaPct / 100)) : precio.precioLista,
    descuento_propio_pct: ofertaPct,
    bonif_general_pct: 0,
    bonif_viajante_pct: viajantePct,
    contado: false,
    bonif_merc_origen: origen,
  })
  if (error) throw error
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
  // Condiciones por proveedor / marca de ESTE pedido. Si vienen, son la lista
  // COMPLETA (la pantalla precarga las de la ficha: sacar una = este pedido sin
  // esa condición). Si no vienen, rigen las de la ficha del cliente.
  condiciones_proveedor?: CondicionProveedor[]
  condiciones_marca?: CondicionMarca[]
  // Compat (pantallas viejas): descuentos inline por segmento. Se convierten en
  // override del pedido (bonif_pedido) sobre la ficha; NO la reemplazan.
  bonificaciones_pedido?: Array<{ tipo: string; segmento: string | null; porcentaje: number }>
  // Descuentos SOLO para este pedido, por tipo y segmento (general / viajante /
  // mercadería / contado). Un 0 explícito = "sin ese descuento en este pedido".
  bonif_pedido?: BonifPedido | null
  // Mercadería bonificada "todo el pedido" solo para este pedido (0 = sin).
  bonif_mercaderia_pct?: number | null
  // Artículos a regalar por cupo. Sin artículos el cupo queda pendiente.
  mercaderia_bonificada?: MercaderiaBonificadaInput
  // "en_venta": el vendedor está armando el pedido en vivo (autoguardado);
  // pasa a "pendiente" al confirmar (confirmarPedidoVendedor).
  estado_inicial?: "en_venta" | "pendiente" | "en_revision"
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: clienteInfo, error: clienteError } = await supabase
    .from("clientes")
    .select("id, vendedor_id, provincia")
    .eq("id", data.cliente_id)
    .single()
  if (clienteError || !clienteInfo) throw new Error(`Cliente no encontrado: ${clienteError?.message || data.cliente_id}`)
  // Pedido tomado en un dispositivo (null en la web): ver lib/mobile/contexto-captura.ts
  const captura = capturaActual(data.cliente_id)

  // Ficha comercial que se CONGELA en el pedido (lib/pedidos/condiciones-pedido.ts)
  const ficha = await leerFichaComercial(supabase, data.cliente_id)
  const clienteListas = { ...ficha.snapshot.cliente, id: data.cliente_id }

  // Cache de listas para evitar múltiples queries a la misma lista
  const listasCache: Record<string, DatosLista> = {}
  // Cargar todas las reglas de fórmulas una sola vez para el pedido
  const formulasReglas = await fetchFormulasReglas(supabase)

  // ── Descuentos: ficha + "solo este pedido" ────────────────────────────────
  // Las filas inline (compat) se convierten en override del pedido por segmento.
  // La mercadería inline "todos" va a bonif_mercaderia_pct (cupo "todo").
  const filasAOverride = (tipo: string): Record<string, number> | undefined => {
    const filas = (data.bonificaciones_pedido || []).filter((x) => x.tipo === tipo)
    if (!filas.length) return undefined
    const o: Record<string, number> = {}
    for (const b of filas) {
      const todos = !b.segmento || b.segmento === "todos"
      if (tipo === "mercaderia" && todos) continue
      const pct = Number(b.porcentaje) || 0
      for (const s of todos ? [...SEGMENTOS_BONIF] : [b.segmento as string]) if (o[s] === undefined) o[s] = pct
    }
    return Object.keys(o).length ? o : undefined
  }
  const inline: Record<string, Record<string, number>> = {}
  for (const tipo of TIPOS_BONIF_FICHA) {
    const o = filasAOverride(tipo)
    if (o) inline[tipo] = o
  }
  const bonifPedidoNorm = normalizarBonifPedido({ ...(data.bonif_pedido || {}), ...inline })
  const fichaBonif = ficha.snapshot.bonificaciones
  const bonifGeneral = mezclarOverride(fichaBonif.filter((b) => b.tipo === "general"), bonifPedidoNorm, "general")
  const bonificacionesViajante = mezclarOverride(fichaBonif.filter((b) => b.tipo === "viajante"), bonifPedidoNorm, "viajante")
  // Mercadería "todo el pedido" solo para este pedido (null = hereda la ficha)
  const mercInline = (data.bonificaciones_pedido || []).find((b) => b.tipo === "mercaderia" && (!b.segmento || b.segmento === "todos"))
  let mercTodo: number | null =
    data.bonif_mercaderia_pct !== undefined && data.bonif_mercaderia_pct !== null && Number.isFinite(Number(data.bonif_mercaderia_pct))
      ? Number(data.bonif_mercaderia_pct)
      : mercInline ? Number(mercInline.porcentaje) || 0 : null
  if (mercTodo === null && data.mercaderia_bonificada && !Array.isArray(data.mercaderia_bonificada) && data.mercaderia_bonificada.pct > 0) {
    mercTodo = Number(data.mercaderia_bonificada.pct)   // compat: % + artículos de la pantalla vieja
  }

  // ── Condiciones por proveedor / marca: lista completa del pedido ───────────
  const condicionesProveedor = new Map<string, CondicionProveedor>(
    (data.condiciones_proveedor ?? ficha.condicionesProveedor).filter((c) => c?.proveedor_id).map((c) => [c.proveedor_id, c]),
  )
  const condicionesMarca = new Map<string, CondicionMarca>(
    (data.condiciones_marca ?? ficha.condicionesMarca).filter((c) => c?.marca_id).map((c) => [c.marca_id, c]),
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
  const pedidoCtx = { bonif_pedido: bonifPedidoNorm, bonif_mercaderia_pct: mercTodo }

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
    extras: ReturnType<typeof extrasRenglon>
  }
  const itemsCalc: ItemCalc[] = []
  for (const item of data.items) {
    const articulo = await fetchArticuloConDescuentos(supabase, item.producto_id)
    const segmento = detectarSegmento(articulo)
    // ¿Este artículo cae en un segmento (marca o proveedor)? Marca gana sobre proveedor.
    const { cond, segKey } = resolverCondSegmento(articulo, condicionesProveedor, condicionesMarca)
    // Lista/método: la condición define los suyos; lo que deja vacío hereda.
    const { listaId, metodoRaw } = resolverListaMetodoConCondicion(segmento, cond, segmentoOverrides, clienteListas)
    if (!listaId) throw new ErrorReglaPedido(MSG_SIN_LISTA)
    // Descuentos que la condición define pisan; los que deja en null se heredan.
    const { generalPct, viajantePct } = resolverBonifItem(cond, bonifGeneral, bonificacionesViajante, segmento)
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
      extras: extrasRenglon(cond, segKey, segmento, esEspecial, pedidoCtx, fichaBonif),
    })
  }

  const total = Math.round(itemsCalc.reduce((s, i) => s + i.precioAlCliente * i.cantidad, 0) * 100) / 100
  const percepciones = 0 // aplica_percepciones no implementado aún en DB

  // El número se pide recién acá: un pedido rechazado (sin lista, etc.) no consume número
  const numeroPedido = await getNextOrderNumber(supabase)

  const { data: pedido, error: pedidoError } = await supabase
    .from("pedidos")
    .insert({
      numero_pedido: numeroPedido,
      cliente_id: data.cliente_id,
      vendedor_id: clienteInfo.vendedor_id,
      fecha: captura?.fecha || todayArgentina(),
      ...(captura?.localId ? { movil_local_id: captura.localId } : {}),
      estado: data.estado_inicial === "en_venta" || data.estado_inicial === "en_revision" ? data.estado_inicial : "pendiente",
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
      ...(bonifPedidoNorm ? { bonif_pedido: bonifPedidoNorm } : {}),
      ...(mercTodo !== null ? { bonif_mercaderia_pct: mercTodo } : {}),
      // Condiciones congeladas: el pedido ya no depende de la ficha del cliente
      condiciones_cliente: ficha.snapshot,
      precios_al: captura?.vigenciaAt || new Date().toISOString(),
      total_flete: 0,
      total_impuestos: percepciones,
      total: Math.round((total + percepciones) * 100) / 100,
      observaciones: data.observaciones,
      creado_por: user.id,
    })
    .select()
    .single()

  if (pedidoError) throw pedidoError

  // Condiciones por proveedor / marca que rigen el pedido (ficha + este pedido)
  const condRow = (c: CondicionSegmento) => ({
    lista_precio_id:    limpiarCentinela(c.lista_precio_id) ?? null,
    metodo_facturacion: limpiarCentinela(c.metodo_facturacion) ?? null,
    dto_general_pct:    c.dto_general_pct ?? null,
    dto_viajante_pct:   c.dto_viajante_pct ?? null,
    dto_mercaderia_pct: c.dto_mercaderia_pct ?? null,
    contado:            c.contado ?? null,
  })
  if (condicionesProveedor.size) {
    const rows = [...condicionesProveedor.values()].map((c) => ({ pedido_id: pedido.id, proveedor_id: c.proveedor_id, ...condRow(c) }))
    const { error: condError } = await supabase.from("pedido_proveedor_condicion").insert(rows)
    if (condError) throw new Error(`Condiciones por proveedor del pedido: ${condError.message}`)
  }
  if (condicionesMarca.size) {
    const rows = [...condicionesMarca.values()].map((c) => ({ pedido_id: pedido.id, marca_id: c.marca_id, ...condRow(c) }))
    const { error: condError } = await supabase.from("pedido_marca_condicion").insert(rows)
    if (condError) throw new Error(`Condiciones por marca del pedido: ${condError.message}`)
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
      ...item.extras,
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
        // Comisión del viajante embebida en kardex (fórmula única: base = neto sin
        // el viajante, tasa = max(0, comisión% − viajante%)). El descuento_viajante
        // (precio) ya lo aporta buildKardexDescuentos. Mercadería/financiero reducen al cobrar.
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

  // ── Mercadería bonificada: artículos elegidos por cupo ────────────────────
  // Solo cupos que existen en el pedido (algún renglón aporta con % > 0). Las
  // unidades las calcula recalcularTotalPedido → recalcularBonificadosPedido.
  const cuposDelPedido = new Set(itemsCalc.map((i) => i.extras.bonif_merc_origen).filter((o): o is string => !!o))
  const elegidos = mercaderiaElegida(data.mercaderia_bonificada).filter((e) => cuposDelPedido.has(e.origen))
  if (elegidos.length) {
    const ctx: CtxCotizacion = {
      pedidoOverrides: { ...segmentoOverrides, ...pedidoCtx },
      clienteInfo: clienteListas,
      condProvMap: condicionesProveedor,
      condMarcaMap: condicionesMarca,
      viajanteFilas: bonificacionesViajante,
      listasCache,
      formulasReglas,
    }
    for (const e of elegidos) {
      for (const artId of [...new Set(e.articulo_ids)]) {
        await insertarRenglonBonificado(supabase, pedido.id, artId, e.origen, ctx)
      }
    }
    await recalcularTotalPedido(supabase, pedido.id)
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

  // Misma regla que editar: en_venta / pendiente / impreso / en_preparacion.
  if (!puedeEliminarPedido(pedido.estado)) {
    throw new Error(`No se puede eliminar un pedido ${(ESTADO_LABEL[pedido.estado] || pedido.estado).toLowerCase()}. Solo se eliminan pedidos en venta, pendientes, impresos o en preparación.`)
  }

  // Un pedido con comprobante VIVO no se elimina: el comprobante seguiría
  // generando deuda pero quedaría huérfano (invisible en las pantallas de
  // imputación, que agrupan por pedido). Primero se anula el comprobante.
  const { data: compVivo } = await supabase
    .from("comprobantes_venta")
    .select("tipo_comprobante, numero_comprobante")
    .eq("pedido_id", pedidoId)
    .is("anulado_en", null)
    .neq("estado_pago", "anulado")
    .limit(1)
    .maybeSingle()
  if (compVivo) {
    throw new Error(`El pedido tiene el comprobante ${compVivo.tipo_comprobante} ${compVivo.numero_comprobante} vivo — anulá primero el comprobante.`)
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

// ─── Cambio manual de estado (desplegable del ERP) ───────────────────────────
// Solo transiciones del flujo (lib/pedidos/estados.ts). Facturado lo pone la
// emisión de comprobantes; en_viaje la asignación de viaje. Nunca se vuelve
// atrás de facturado.
export async function cambiarEstadoPedidoManual(pedidoId: string, nuevoEstado: string) {
  const supabase = await createClient()
  const { data: pedido, error } = await supabase
    .from("pedidos").select("id, estado").eq("id", pedidoId).single()
  if (error || !pedido) throw new Error("Pedido no encontrado")
  if (pedido.estado === nuevoEstado) return { success: true, estado: nuevoEstado }
  if (!puedeCambiarEstado(pedido.estado, nuevoEstado)) {
    throw new Error(
      `No se puede pasar un pedido de "${ESTADO_LABEL[pedido.estado] || pedido.estado}" a "${ESTADO_LABEL[nuevoEstado] || nuevoEstado}".`
    )
  }
  const { error: upErr } = await supabase
    .from("pedidos").update({ estado: nuevoEstado }).eq("id", pedidoId)
  if (upErr) throw new Error(upErr.message)
  revalidatePath("/clientes-pedidos")
  return { success: true, estado: nuevoEstado }
}

// ─── Encabezado del pedido (ficha /clientes-pedidos/[id]) ────────────────────
// Aplica la traba por estado del lado del servidor:
// - editable: se guarda todo el encabezado (estado solo si es transición válida).
// - facturado / listo / pendiente_facturacion: SOLO condicion_entrega (+ estado
//   listo_para_retirar ↔ listo_para_enviar). El resto se descarta.
// - en_viaje: solo estado (entregado / rechazado). Finales: nada.
const CAMPOS_ENCABEZADO = [
  "metodo_facturacion_pedido", "condicion_entrega", "vendedor_id",
  "lista_precio_pedido_id", "lista_limpieza_pedido_id", "metodo_limpieza_pedido",
  "lista_perf0_pedido_id", "metodo_perf0_pedido", "lista_perf_plus_pedido_id",
  "metodo_perf_plus_pedido", "observaciones", "bonif_mercaderia_pct",
  // Descuentos por segmento "solo este pedido" (viajante/mercadería), mismo
  // jsonb que usa la app del vendedor — el ERP los ve y edita en la misma columna.
  "bonif_pedido",
] as const

export async function actualizarEncabezadoPedido(
  pedidoId: string,
  patch: Partial<Record<(typeof CAMPOS_ENCABEZADO)[number] | "estado", any>>,
) {
  const supabase = await createClient()
  const { data: pedido, error } = await supabase
    .from("pedidos").select("id, estado").eq("id", pedidoId).single()
  if (error || !pedido) throw new Error("Pedido no encontrado")

  const editable = esPedidoEditable(pedido.estado)
  const update: Record<string, any> = {}

  if (editable) {
    for (const k of CAMPOS_ENCABEZADO) if (k in patch) update[k] = patch[k]
    if ("bonif_pedido" in update) update.bonif_pedido = normalizarBonifPedido(update.bonif_pedido)
  } else if (puedeEditarEntrega(pedido.estado)) {
    if ("condicion_entrega" in patch) update.condicion_entrega = patch.condicion_entrega
  }

  if (patch.estado && patch.estado !== pedido.estado) {
    if (!puedeCambiarEstado(pedido.estado, patch.estado)) {
      throw new Error(
        `No se puede pasar un pedido de "${ESTADO_LABEL[pedido.estado] || pedido.estado}" a "${ESTADO_LABEL[patch.estado] || patch.estado}".`
      )
    }
    update.estado = patch.estado
  }

  if (Object.keys(update).length === 0) {
    // Nada aplicable: si intentaron tocar campos bloqueados, avisar.
    const intentoBloqueado = Object.keys(patch).some(k => k !== "estado" && !(k in update))
    if (intentoBloqueado && !editable) throw new Error(motivoBloqueo(pedido.estado) || "El pedido no puede modificarse")
    return { success: true, aplicado: [] as string[], editable }
  }

  const { error: upErr } = await supabase.from("pedidos").update(update).eq("id", pedidoId)
  if (upErr) throw new Error(upErr.message)
  revalidatePath("/clientes-pedidos")
  return { success: true, aplicado: Object.keys(update), editable }
}

// ─── Edición de pedidos pendientes ─────────────────────────────────────────

async function assertPedidoEditable(supabase: any, pedidoId: string) {
  const { data, error } = await supabase
    .from("pedidos")
    .select("id, estado")
    .eq("id", pedidoId)
    .single()
  if (error || !data) throw new Error("Pedido no encontrado")
  // Lista blanca: solo en_venta / pendiente / impreso / en_preparacion (lib/pedidos/estados.ts)
  if (!esPedidoEditable(data.estado)) throw new Error(motivoBloqueo(data.estado) || "El pedido no puede modificarse")
  return data
}

// Total del pedido = Σ subtotales de líneas no bonificadas (mismo criterio que
// createPedido/guardarItemsPedido). Se llama tras cada alta/edición/baja de ítem.
async function recalcularTotalPedido(supabase: any, pedidoId: string) {
  // Unidades de mercadería bonificada según lo que va del pedido (no suman al total)
  await recalcularBonificadosPedido(supabase, pedidoId)

  const { data: allItems } = await supabase
    .from("pedidos_detalle")
    .select("subtotal, es_bonificado")
    .eq("pedido_id", pedidoId)
  const total = Math.round(
    (allItems || []).filter((i: any) => !i.es_bonificado).reduce((s: number, i: any) => s + (i.subtotal || 0), 0) * 100
  ) / 100
  await supabase.from("pedidos").update({ total, subtotal: total }).eq("id", pedidoId)

  // El kardex es el espejo de los renglones: cada vez que cambian (cantidad,
  // precio, reprecio por cabecera, alta/baja) se vuelve a alinear. Best-effort:
  // no bloquea la edición del pedido, pero deja rastro si falla.
  try {
    await sincronizarKardexPedido(createAdminClient(), pedidoId)
  } catch (e: any) {
    console.error("[recalcularTotalPedido] kardex desalineado para", pedidoId, e?.message || e)
  }
  return total
}

/** Datos mínimos para abrir el contexto de precios congelados de un pedido. */
async function pedidoCongelable(supabase: any, pedidoId: string) {
  const { data, error } = await supabase
    .from("pedidos")
    .select("id, cliente_id, condiciones_cliente, precios_al")
    .eq("id", pedidoId)
    .single()
  if (error || !data) throw new Error("Pedido no encontrado")
  return data as { id: string; cliente_id: string; condiciones_cliente: unknown; precios_al: string | null }
}

/** ¿El pedido tiene cupos de mercadería o renglones bonificados? (para no recalcular de más) */
async function tieneMercaderia(supabase: any, pedidoId: string): Promise<boolean> {
  const { data } = await supabase
    .from("pedidos_detalle")
    .select("id")
    .eq("pedido_id", pedidoId)
    .or("es_bonificado.eq.true,bonif_merc_origen.not.is.null")
    .limit(1)
  return !!data?.length
}

// Agrega un artículo con las condiciones CONGELADAS del pedido y sus precios
// (pedidos.precios_al): "mismo pedido, mismas condiciones".
export async function agregarItemPedido(
  pedidoId: string,
  productoId: string,
  cantidad: number
) {
  const supabase = await createClient()
  const ped = await pedidoCongelable(supabase, pedidoId)
  return conPreciosDelPedido(ped, { vigencia: "pedido", articuloIds: [productoId] }, () =>
    agregarItemPedidoEnContexto(pedidoId, productoId, cantidad),
  )
}

async function agregarItemPedidoEnContexto(
  pedidoId: string,
  productoId: string,
  cantidad: number
) {
  const supabase = await createClient()

  // Etapa 1 (paralelo): pedido+estado+cliente, usuario, fórmulas, artículo.
  // Mismas consultas que antes, pero en una sola ida y vuelta.
  const [{ data: pedido }, { data: { user } }, formulasReglas, articuloConDescuentos] = await Promise.all([
    supabase
      .from("pedidos")
      .select(`estado,cliente_id,numero_pedido,${SEGMENTO_PEDIDO_COLS},clientes:cliente_id(${SEGMENTO_CLIENTE_COLS},provincia,vendedor_id)`)
      .eq("id", pedidoId)
      .single(),
    supabase.auth.getUser(),
    fetchFormulasReglas(supabase),
    fetchArticuloConDescuentos(supabase, productoId),
  ])
  if (!pedido) throw new Error("Pedido no encontrado")
  if (pedido.estado === "eliminado") throw new Error("El pedido está eliminado y no puede modificarse")
  if (pedido.estado === "facturado" || pedido.estado === "entregado")
    throw new Error("El pedido ya fue facturado/entregado y no puede modificarse")

  const clienteInfo = { ...(pedido.clientes as any), id: pedido.cliente_id }
  const listasCache: Record<string, DatosLista> = {}
  const vendedorId = (pedido.clientes as any)?.vendedor_id ?? null

  // Etapa 2 (paralelo): lo que depende del cliente/pedido.
  const [condProvMap, condMarcaMap, { general, viajante }, vendedorRes] = await Promise.all([
    fetchCondicionesProveedor(supabase, pedido.cliente_id, pedidoId),
    fetchCondicionesMarca(supabase, pedido.cliente_id, pedidoId),
    fetchBonifGeneralViajante(supabase, pedido.cliente_id, pedido),
    vendedorId
      ? supabase.from("vendedores").select("comision_limpieza_bazar, comision_perfumeria_0, comision_perfumeria_plus").eq("id", vendedorId).single()
      : Promise.resolve({ data: null }),
  ])
  const vendedorComisionesAgregar: { comision_limpieza_bazar: number; comision_perfumeria_0: number; comision_perfumeria_plus: number } | null =
    (vendedorRes as any)?.data ?? null

  const segmentoArt = detectarSegmento(articuloConDescuentos)
  // Resolución por segmento (igual que createPedido): marca > proveedor > override pedido > cliente > general
  const { listaId, metodoRaw: metodoItemRaw, metodo, listaDatos, cond, segKey } =
    await resolverListaMetodoItem(supabase, articuloConDescuentos, segmentoArt, pedido, clienteInfo, condProvMap, condMarcaMap, listasCache, formulasReglas)

  const bonif = resolverBonifItem(cond, general, viajante, segmentoArt)
  const precio = calcularPrecioPedido(articuloConDescuentos, listaDatos, metodo, bonif)

  const esEspecial = (listaDatos.lista_codigo || "").toLowerCase() === "especial"
  const ofertaPct = esEspecial ? (articuloConDescuentos.oferta_lista_especial || 0) : (articuloConDescuentos.descuento_propio || 0)
  const precioListaBruto = ofertaPct > 0 ? round2(precio.precioLista / (1 - ofertaPct / 100)) : precio.precioLista
  const extras = extrasRenglon(cond, segKey, segmentoArt, esEspecial, pedido as any, await fetchFichaFilas(supabase, pedido.cliente_id))

  const subtotalLinea = Math.round(precio.precioAlCliente * cantidad * 100) / 100
  const { data: lineaInsertada, error } = await supabase
    .from("pedidos_detalle")
    .insert({
      pedido_id: pedidoId,
      articulo_id: productoId,
      cantidad,
      precio_base: precio.precioNeto,
      precio_final: precio.precioAlCliente,
      subtotal: subtotalLinea,
      precio_costo: articuloConDescuentos.precio_compra || 0,
      lista_precio_id: listaId,
      metodo_facturacion_item: metodoItemRaw,
      precio_lista: precioListaBruto,
      descuento_propio_pct: ofertaPct,
      bonif_general_pct: precio.bonifGeneralPct,
      bonif_viajante_pct: precio.bonifViajantePct,
      ...extras,
    })
    .select("id")
    .single()

  if (error) throw error

  // ── Insertar en kardex ──────────────────────────────────────────────────
  // artInfo sale del mismo fetch del artículo (ya trae sku/descripcion/stock)
  const artInfo = articuloConDescuentos

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

  const kardexPromise = insertarKardex(
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

  // Kardex y total en paralelo; actualizado_por va en el mismo update del total.
  const [, { data: allItems }] = await Promise.all([
    kardexPromise,
    supabase.from("pedidos_detalle").select("subtotal, es_bonificado").eq("pedido_id", pedidoId),
  ])
  const total = Math.round(
    (allItems || []).filter((i: any) => !i.es_bonificado).reduce((s: number, i: any) => s + (i.subtotal || 0), 0) * 100
  ) / 100
  const { error: totErr } = await supabase
    .from("pedidos")
    .update({ total, subtotal: total, ...(user?.id ? { actualizado_por: user.id } : {}) })
    .eq("id", pedidoId)
  if (totErr) throw totErr

  // El renglón nuevo cambia la base de los cupos de mercadería bonificada (estimación)
  if (await tieneMercaderia(supabase, pedidoId)) await recalcularBonificadosPedido(supabase, pedidoId)

  // Sin revalidatePath: las pantallas del ERP que muestran pedidos cargan por
  // cliente (supabase-js), y el re-render RSC sumaba latencia a cada tap.
  // Se devuelve la línea para que la app actualice el carrito sin refetch.
  return {
    success: true,
    item: {
      id: lineaInsertada?.id as string,
      articulo_id: productoId,
      cantidad,
      precio_final: precio.precioAlCliente,
      precio_base: precio.precioNeto,
      subtotal: subtotalLinea,
      sku: artInfo?.sku ?? null,
      descripcion: artInfo?.descripcion ?? null,
      unidades_por_bulto: artInfo?.unidades_por_bulto ?? null,
    },
    total,
  }
}

// Agrega un artículo a regalar. Con `origen` (cupo: "todo" | "seg:x" | "prov:id" |
// "marca:id") las unidades las calcula el sistema (estimadas hasta cerrar el
// picking); sin origen (pedidos viejos) queda la cantidad indicada a mano.
export async function agregarItemBonificado(
  pedidoId: string,
  productoId: string,
  cantidad: number,
  origen?: string | null,
) {
  const supabase = await createClient()
  await assertPedidoEditable(supabase, pedidoId)
  const { data: { user } } = await supabase.auth.getUser()

  const ped = await pedidoCongelable(supabase, pedidoId)
  await conPreciosDelPedido(ped, { vigencia: "pedido", articuloIds: [productoId] }, async () => {
    const { data: pedido } = await supabase
      .from("pedidos")
      .select(`cliente_id,${SEGMENTO_PEDIDO_COLS},clientes:cliente_id(${SEGMENTO_CLIENTE_COLS})`)
      .eq("id", pedidoId)
      .single()
    if (!pedido) throw new Error("Pedido no encontrado")
    const [formulasReglas, condProvMap, condMarcaMap, { viajante }] = await Promise.all([
      fetchFormulasReglas(supabase),
      fetchCondicionesProveedor(supabase, pedido.cliente_id, pedidoId),
      fetchCondicionesMarca(supabase, pedido.cliente_id, pedidoId),
      fetchBonifGeneralViajante(supabase, pedido.cliente_id, pedido),
    ])
    await insertarRenglonBonificado(supabase, pedidoId, productoId, origen || null, {
      pedidoOverrides: pedido,
      clienteInfo: { ...(pedido.clientes as any), id: pedido.cliente_id },
      condProvMap,
      condMarcaMap,
      viajanteFilas: viajante,
      listasCache: {},
      formulasReglas,
    }, origen ? 0 : Math.max(0, Number(cantidad) || 0))
  })

  if (user?.id) {
    await supabase.from("pedidos").update({ actualizado_por: user.id }).eq("id", pedidoId)
  }
  // Fija las unidades del cupo y alinea el kardex (comisión negativa por lo regalado)
  await recalcularTotalPedido(supabase, pedidoId)

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

  const [, itemRes] = await Promise.all([
    assertPedidoEditable(supabase, pedidoId),
    supabase.from("pedidos_detalle").select("precio_final").eq("id", itemId).eq("pedido_id", pedidoId).single(),
  ])
  const item = itemRes.data
  if (itemRes.error || !item) throw new Error("Ítem no encontrado")

  const subtotal = Math.round(item.precio_final * cantidad * 100) / 100
  const { error } = await supabase
    .from("pedidos_detalle")
    .update({ cantidad, subtotal })
    .eq("id", itemId)

  if (error) throw error

  const total = await recalcularTotalPedido(supabase, pedidoId)
  return { success: true, subtotal, total }
}

export async function eliminarItemPedido(itemId: string, pedidoId: string) {
  const supabase = await createClient()
  await assertPedidoEditable(supabase, pedidoId)

  const { error } = await supabase.from("pedidos_detalle").delete().eq("id", itemId).eq("pedido_id", pedidoId)
  if (error) throw error

  const total = await recalcularTotalPedido(supabase, pedidoId)
  return { success: true, total }
}

export async function guardarItemsPedido(
  pedidoId: string,
  changes: Array<{ id: string; cantidad: number; precio_final: number; estado_item: string }>
) {
  const supabase = await createClient()
  await assertPedidoEditable(supabase, pedidoId)

  // Precio actual de cada línea, para acompañar el neto cuando se toca el precio a mano.
  const { data: actuales } = await supabase
    .from("pedidos_detalle")
    .select("id, precio_final, precio_base")
    .in("id", changes.map((c) => c.id))
    .eq("pedido_id", pedidoId)
  const actualPorId = new Map((actuales || []).map((r: any) => [r.id, r]))

  for (const change of changes) {
    const upd: Record<string, any> = {
      cantidad: change.cantidad,
      precio_final: change.precio_final,
      subtotal: Math.round(change.precio_final * change.cantidad * 100) / 100,
      estado_item: change.estado_item,
    }
    // Precio editado a mano: el NETO (precio_base) tiene que moverse en la misma
    // proporción. Si no, la Factura A usa el neto viejo y la diferencia se cuela
    // como "IVA" (la línea y el IVA discriminado salen mal).
    const act = actualPorId.get(change.id)
    if (act && Number(act.precio_final) !== Number(change.precio_final)) {
      const viejoFinal = Number(act.precio_final) || 0
      const viejoNeto = Number(act.precio_base) || 0
      upd.precio_base = viejoFinal > 0 && viejoNeto > 0
        ? Math.round(viejoNeto * (change.precio_final / viejoFinal) * 100) / 100
        : Math.round((change.precio_final / 1.21) * 100) / 100
    }
    const { error } = await supabase
      .from("pedidos_detalle")
      .update(upd)
      .eq("id", change.id)
      .eq("pedido_id", pedidoId)
    if (error) throw error
  }

  await recalcularTotalPedido(supabase, pedidoId)

  revalidatePath("/clientes-pedidos")
  return { success: true }
}

// Re-precia todas las líneas de un pedido con sus condiciones (misma resolución
// que agregarItemPedido: marca > proveedor > override pedido > ficha congelada).
// `vigencia`: "pedido" = precios de cuando se tomó (cambio de condiciones del
// pedido); "ahora" = precios de hoy (botón Repreciar). Los renglones bonificados
// actualizan su precio de referencia (las unidades las recalcula
// recalcularTotalPedido). `pedido` debe traer SEGMENTO_PEDIDO_COLS + clientes(SEGMENTO_CLIENTE_COLS).
async function repreciarItemsPedido(supabase: any, pedido: any, pedidoId: string, vigencia: "pedido" | "ahora" = "pedido") {
  const { data: items } = await supabase
    .from("pedidos_detalle")
    .select("id, articulo_id, cantidad, es_bonificado")
    .eq("pedido_id", pedidoId)

  const congelable = { id: pedidoId, cliente_id: pedido.cliente_id, condiciones_cliente: pedido.condiciones_cliente, precios_al: pedido.precios_al }
  await conPreciosDelPedido(congelable, { vigencia, articuloIds: (items || []).map((i: any) => i.articulo_id) }, async () => {
    const clienteInfo = { ...(pedido.clientes as any), id: pedido.cliente_id }
    const listasCache: Record<string, DatosLista> = {}
    const [formulasReglas, condProvMap, condMarcaMap, { general, viajante }, fichaFilas] = await Promise.all([
      fetchFormulasReglas(supabase),
      fetchCondicionesProveedor(supabase, pedido.cliente_id, pedidoId),
      fetchCondicionesMarca(supabase, pedido.cliente_id, pedidoId),
      fetchBonifGeneralViajante(supabase, pedido.cliente_id, pedido),
      fetchFichaFilas(supabase, pedido.cliente_id),
    ])

    for (const it of items || []) {
      const articulo = await fetchArticuloConDescuentos(supabase, it.articulo_id)
      const segmentoArt = detectarSegmento(articulo)
      const { listaId, metodoRaw, metodo, listaDatos, cond, segKey } = await resolverListaMetodoItem(
        supabase, articulo, segmentoArt, pedido, clienteInfo, condProvMap, condMarcaMap, listasCache, formulasReglas
      )
      const esEspecial = (listaDatos.lista_codigo || "").toLowerCase() === "especial"

      if (it.es_bonificado) {
        // Mercadería regalada: precio de referencia (P.Lista real), sin general/viajante
        const precio = calcularPrecioPedido(articulo, listaDatos, metodo, {})
        const ofertaB = articulo.descuento_propio || 0
        const { error: bErr } = await supabase
          .from("pedidos_detalle")
          .update({
            precio_base: precio.precioNeto,
            precio_final: precio.precioAlCliente,
            subtotal: round2(precio.precioAlCliente * it.cantidad),
            lista_precio_id: listaId,
            metodo_facturacion_item: metodoRaw,
            precio_lista: ofertaB > 0 ? round2(precio.precioLista / (1 - ofertaB / 100)) : precio.precioLista,
            descuento_propio_pct: ofertaB,
            bonif_viajante_pct: getDescuentoViajante(viajante, segmentoArt),
          })
          .eq("id", it.id)
        if (bErr) throw bErr
        continue
      }

      const bonif = resolverBonifItem(cond, general, viajante, segmentoArt)
      const precio = calcularPrecioPedido(articulo, listaDatos, metodo, bonif)
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
          ...extrasRenglon(cond, segKey, segmentoArt, esEspecial, pedido, fichaFilas),
        })
        .eq("id", it.id)
      if (itemError) throw itemError
    }
  })
}

// Re-precia UN pedido (cualquier estado editable) con sus condiciones y los
// precios de cuando se tomó. Lo usa el ERP al guardar el encabezado del pedido
// (método/lista/segmentación/descuentos del pedido) desde /clientes-pedidos/[id].
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

// ─── Botón "Repreciar" (modal del pedido en /clientes-pedidos) ───────────────
// Regla del dueño (06/10/2026): el precio de un pedido se cierra al tomarlo y
// los cambios de la ficha del cliente NO lo tocan. Repreciar es la acción
// explícita que lo lleva a los precios de HOY, con las condiciones (listas,
// método, descuentos, segmentación) que el pedido ya tiene. Se puede hasta que
// el pedido tenga comprobantes vivos: facturado, el precio queda blindado; si se
// anulan los comprobantes, se puede repreciar antes de volver a facturar.
export async function repreciarPedidoPreciosActuales(pedidoId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: pedido, error } = await supabase
    .from("pedidos")
    .select(`id,estado,total,cliente_id,numero_pedido,eliminado_at,${SEGMENTO_PEDIDO_COLS},clientes:cliente_id(${SEGMENTO_CLIENTE_COLS},provincia,vendedor_id)`)
    .eq("id", pedidoId)
    .single()
  if (error || !pedido) throw new Error("Pedido no encontrado")
  if (pedido.estado === "eliminado" || (pedido as any).eliminado_at) throw new Error("El pedido está eliminado.")

  const { data: vivo } = await supabase
    .from("comprobantes_venta")
    .select("tipo_comprobante, numero_comprobante")
    .eq("pedido_id", pedidoId)
    .is("anulado_en", null)
    .limit(1)
    .maybeSingle()
  if (vivo) {
    throw new Error(`El pedido ya está facturado (${vivo.tipo_comprobante} ${vivo.numero_comprobante}): el precio quedó cerrado. Para cambiarlo hay que anular los comprobantes.`)
  }

  const totalAnterior = Number((pedido as any).total) || 0
  await repreciarItemsPedido(supabase, pedido, pedidoId, "ahora")
  const { error: upErr } = await supabase
    .from("pedidos")
    .update({ precios_al: new Date().toISOString(), actualizado_por: user.id })
    .eq("id", pedidoId)
  if (upErr) throw new Error(upErr.message)
  const total = await recalcularTotalPedido(supabase, pedidoId)
  revalidatePath("/clientes-pedidos")
  return { success: true, total, total_anterior: totalAnterior }
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
    // { viajante?: {seg:%}, mercaderia?: {seg:%} } — null = heredar todo de la ficha
    bonif_pedido?: BonifPedido | null
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
  if (cond.bonif_pedido !== undefined) {
    // MERGE por tipo, no reemplazo: la app (≤ 0.2.3) solo maneja viajante/mercadería;
    // un `general` o `contado` "solo este pedido" cargado desde el ERP debe sobrevivir.
    // Un tipo que la app manda explícitamente (aunque sea vacío) sí se pisa.
    const actual = normalizarBonifPedido((pedido as any).bonif_pedido)
    const entrante = (cond.bonif_pedido || {}) as Record<string, unknown>
    const fusion: Record<string, unknown> = { ...(actual || {}) }
    for (const tipo of TIPOS_BONIF_FICHA) {
      if (tipo in entrante) fusion[tipo] = entrante[tipo]
      else if (cond.bonif_pedido === null && (tipo === "viajante" || tipo === "mercaderia")) delete fusion[tipo]
    }
    const v = normalizarBonifPedido(fusion)
    if (JSON.stringify(v) !== JSON.stringify(actual)) patch.bonif_pedido = v
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

// ─── Condiciones por proveedor / marca "solo este pedido" (ficha del pedido, ERP) ───
// Reemplaza las condiciones del pedido por las recibidas y re-precia todas las
// líneas (la condición cambia lista/método/descuentos de esa mercadería y se
// factura aparte). Antes solo se podían cargar al crear el pedido.
export async function guardarCondicionesPedido(
  pedidoId: string,
  cond: { proveedor: CondicionProveedor[]; marca: CondicionMarca[] },
) {
  const supabase = await createClient()
  await assertPedidoEditable(supabase, pedidoId)

  const { data: pedido } = await supabase
    .from("pedidos")
    .select(`id,estado,cliente_id,numero_pedido,${SEGMENTO_PEDIDO_COLS},clientes:cliente_id(${SEGMENTO_CLIENTE_COLS},provincia,vendedor_id)`)
    .eq("id", pedidoId)
    .single()
  if (!pedido) throw new Error("Pedido no encontrado")

  const { error: dp } = await supabase.from("pedido_proveedor_condicion").delete().eq("pedido_id", pedidoId)
  if (dp) throw dp
  const { error: dm } = await supabase.from("pedido_marca_condicion").delete().eq("pedido_id", pedidoId)
  if (dm) throw dm

  const provRows = (cond.proveedor || []).filter((c) => c?.proveedor_id).map((c) => ({
    pedido_id: pedidoId, proveedor_id: c.proveedor_id,
    lista_precio_id: limpiarCentinela(c.lista_precio_id) ?? null, metodo_facturacion: limpiarCentinela(c.metodo_facturacion) ?? null,
    dto_general_pct: c.dto_general_pct ?? null, dto_viajante_pct: c.dto_viajante_pct ?? null, dto_mercaderia_pct: c.dto_mercaderia_pct ?? null,
    contado: c.contado ?? null,
  }))
  if (provRows.length) {
    const { error } = await supabase.from("pedido_proveedor_condicion").insert(provRows)
    if (error) throw error
  }
  const marcaRows = (cond.marca || []).filter((c) => c?.marca_id).map((c) => ({
    pedido_id: pedidoId, marca_id: c.marca_id,
    lista_precio_id: limpiarCentinela(c.lista_precio_id) ?? null, metodo_facturacion: limpiarCentinela(c.metodo_facturacion) ?? null,
    dto_general_pct: c.dto_general_pct ?? null, dto_viajante_pct: c.dto_viajante_pct ?? null, dto_mercaderia_pct: c.dto_mercaderia_pct ?? null,
    contado: c.contado ?? null,
  }))
  if (marcaRows.length) {
    const { error } = await supabase.from("pedido_marca_condicion").insert(marcaRows)
    if (error) throw error
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
  // Al confirmar un carrito en_venta el precio se CIERRA: se re-precia con los
  // precios de ese momento (las líneas traen el precio de cuando se agregaron).
  // Las condiciones son las congeladas del pedido. Un pedido ya confirmado que
  // solo cambia de método conserva sus precios (los de cuando se tomó).
  const cierraCarrito = pedido.estado === "en_venta"
  if (cambioMetodo || cierraCarrito) {
    await repreciarItemsPedido(supabase, pedido, pedidoId, cierraCarrito ? "ahora" : "pedido")
  }

  const patch: Record<string, any> = { actualizado_por: user.id }
  if (cierraCarrito) patch.precios_al = capturaActual(pedido.cliente_id)?.vigenciaAt || new Date().toISOString()
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
