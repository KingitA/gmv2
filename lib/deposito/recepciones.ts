/**
 * Recepción de mercadería — lógica compartida por /api/deposito/recepciones (web)
 * y los handlers del outbox de la app Depósito.
 *
 * Idempotencia (imprescindible para el outbox: un reintento NUNCA duplica stock):
 *  - iniciar: get-or-create de la tanda de la OC (si dos equipos la crean a la
 *    vez, queda la más vieja y la otra se descarta).
 *  - item: conteo ABSOLUTO por artículo ⇒ reenviar es inocuo.
 *  - finalizar: candado por `fecha_fin` (un solo finalizador a la vez) + guarda
 *    por artículo contra el kardex de esa recepción. Finalizar dos veces = una.
 */

import { insertarKardex } from "@/lib/kardex/insertar-kardex"
import { createAdminClient } from "@/lib/supabase/admin"
import { nowArgentina } from "@/lib/utils"
import { estadoLineaRecepcion } from "./bonificados"
import { ErrorDeposito } from "./picking"
import { faltaLaColumna, faltaLaFuncion } from "@/lib/utils/migracion-pendiente"
import { aUnidadesBase, conversionLinea, esUnidadConteo, pendienteDeLinea, unidadesPorBultoDe, type ConversionLinea, type UnidadConteo, abreEntregaSiguiente } from "./unidades"

const SELECT_FULL = `*, recepciones_items(*), recepciones_documentos(*)`
/** Un finalizador que lleva más que esto sin terminar se considera caído y se retoma */
const CANDADO_FINALIZAR_MS = 2 * 60_000
/**
 * Estados de la ORDEN en los que el depósito la puede recibir. "enviada", "confirmada" y
 * "en_camino" los escribe la pantalla de órdenes de compra (envío al proveedor): una orden
 * enviada tiene que seguir viéndose en depósito.
 */
export const ESTADOS_A_RECIBIR = ["pendiente", "enviada", "confirmada", "en_camino", "recibida_parcial"]

/** Estados en los que una recepción todavía se puede contar y finalizar */
const ABIERTA = ["en_proceso", "borrador"]

// ── Migración 20261116a_recepcion_unidades.sql (E-30 / E-40) ─────────────────
// Agrega recepciones_items.unidad_conteo (+ rastro de lo aplicado al stock) y la
// función recepcion_aplicar_stock. Mientras no esté aplicada todo sigue andando:
// se cuenta en la unidad de la línea de la OC y el stock se suma como antes
// (leer y escribir), pero YA convertido a unidades.

let columnasConteo: boolean | null = null
let columnasConteoAt = 0
/** ¿Existe recepciones_items.unidad_conteo? Sí = se recuerda; no = se vuelve a mirar cada minuto. */
export async function hayColumnasConteo(supabase: any): Promise<boolean> {
  if (columnasConteo === true) return true
  if (columnasConteo === false && Date.now() - columnasConteoAt < 60_000) return false
  const { error } = await supabase.from("recepciones_items").select("unidad_conteo").limit(1)
  // Un corte de red o cualquier otro error NO es "no hay columnas": se propaga (el outbox reintenta)
  // y no se recuerda nada. Solo "la columna no existe" significa migración sin aplicar.
  if (error && !faltaLaColumna(error)) throw error
  columnasConteoAt = Date.now()
  columnasConteo = !error
  return columnasConteo
}

/** Cómo se convierte cada línea de una recepción a unidades base (clave = id de recepciones_items). */
export async function conversionesDeRecepcion(
  supabase: any,
  ordenCompraId: string | null,
  items: Array<{ id: string; articulo_id: string; fuera_de_oc?: boolean | null; unidad_conteo?: string | null }>,
): Promise<{ porItem: Map<string, ConversionLinea>; articulos: Map<string, any> }> {
  const tipoOC = new Map<string, string | null>()
  if (ordenCompraId) {
    const { data: detalle, error } = await supabase
      .from("ordenes_compra_detalle")
      .select("articulo_id, tipo_cantidad")
      .eq("orden_compra_id", ordenCompraId)
    if (error) throw error
    for (const d of detalle || []) tipoOC.set(d.articulo_id, d.tipo_cantidad)
  }
  const ids = [...new Set(items.map((i) => i.articulo_id).filter(Boolean))]
  const articulos = new Map<string, any>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("articulos")
      .select("id, stock_actual, sku, descripcion, categoria, proveedor_id, iva_compras, iva_ventas, precio_compra, unidades_por_bulto")
      .in("id", ids.slice(i, i + 200))
    if (error) throw error
    for (const a of data || []) articulos.set(a.id, a)
  }
  const porItem = new Map<string, ConversionLinea>()
  for (const it of items) {
    porItem.set(
      it.id,
      conversionLinea({
        enOC: !it.fuera_de_oc && tipoOC.has(it.articulo_id),
        tipoCantidadOC: tipoOC.get(it.articulo_id),
        unidadElegida: it.unidad_conteo,
        unidadesPorBulto: articulos.get(it.articulo_id)?.unidades_por_bulto,
      }),
    )
  }
  return { porItem, articulos }
}

/**
 * Qué falta recibir de una orden (E-39/E-92): por cada línea, lo pedido menos lo recibido en las
 * entregas YA FINALIZADAS. Clave = articulo_id. Solo líneas con algo pendiente.
 *
 * Antes, finalizar la recepción cerraba la orden aunque faltara mercadería ("los faltantes se
 * repiden"). Ahora la orden queda "recibida en parte" y el resto se puede recibir en otra entrega
 * sobre la misma orden, hasta que llegue todo o la oficina la cierre sin el resto.
 */
export async function pendientesDeOrden(supabase: any, orden_compra_id: string): Promise<Map<string, { enUnidadOC: number; base: number; precio_unitario: number }>> {
  const { data: detalle, error: detErr } = await supabase
    .from("ordenes_compra_detalle")
    .select("articulo_id, cantidad_pedida, tipo_cantidad, precio_unitario, articulos(unidades_por_bulto)")
    .eq("orden_compra_id", orden_compra_id)
  if (detErr) throw detErr
  const { data: recs, error: recErr } = await supabase.from("recepciones").select("id").eq("orden_compra_id", orden_compra_id).eq("estado", "finalizada")
  if (recErr) throw recErr
  const recIds = (recs || []).map((r: any) => r.id)
  const recibido = new Map<string, number>()
  if (recIds.length > 0) {
    const { data: items, error: itErr } = await supabase.from("recepciones_items").select("*").in("recepcion_id", recIds)
    if (itErr) throw itErr
    // Una línea "fuera de la orden" (el depósito contó algo que esa entrega no esperaba) NO descuenta
    // lo pendiente de la orden: la oficina la resuelve en la verificación como mercadería no pedida.
    const filas: any[] = (items || []).filter((i: any) => Number(i.cantidad_fisica) > 0 && !i.fuera_de_oc)
    const { porItem } = await conversionesDeRecepcion(supabase, orden_compra_id, filas)
    for (const i of filas) {
      const base = i.cantidad_fisica_base != null ? Number(i.cantidad_fisica_base) : aUnidadesBase(i.cantidad_fisica, porItem.get(i.id)?.factorConteo ?? 1)
      recibido.set(i.articulo_id, (recibido.get(i.articulo_id) || 0) + base)
    }
  }
  const pendientes = new Map<string, { enUnidadOC: number; base: number; precio_unitario: number }>()
  // Lo recibido se descuenta UNA vez por artículo, aunque esté en más de un renglón de la orden:
  // se va consumiendo renglón por renglón, y lo pendiente de cada uno se suma.
  const queda = new Map<string, number>(recibido)
  for (const d of detalle || []) {
    const art = Array.isArray(d.articulos) ? d.articulos[0] : d.articulos
    const factor = d.tipo_cantidad === "unidad" ? 1 : unidadesPorBultoDe(art?.unidades_por_bulto)
    const yaRecibido = queda.get(d.articulo_id) || 0
    const p = pendienteDeLinea(d.cantidad_pedida, factor, yaRecibido)
    queda.set(d.articulo_id, Math.max(0, yaRecibido - aUnidadesBase(d.cantidad_pedida, factor)))
    if (p.base > 0) {
      const previo = pendientes.get(d.articulo_id)
      pendientes.set(d.articulo_id, previo
        ? { ...previo, enUnidadOC: Math.round((previo.enUnidadOC + p.enUnidadOC) * 100) / 100, base: previo.base + p.base }
        : { ...p, precio_unitario: Number(d.precio_unitario || 0) })
    }
  }
  return pendientes
}

async function ultimaTanda(supabase: any, orden_compra_id: string) {
  const { data } = await supabase
    .from("recepciones")
    .select(SELECT_FULL)
    .eq("orden_compra_id", orden_compra_id)
    .not("estado", "eq", "cancelada")
    .order("numero_tanda", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as any | null
}

/**
 * Fotos de remitos/facturas: viven en el bucket PRIVADO `comprobantes`. Lo que queda
 * guardado en `url_imagen` es una URL firmada por 7 días (o una URL "public" que un
 * bucket privado nunca sirve): pasada la semana, desde depósito no abría ninguna foto.
 * Igual que /api/ordenes-compra/[id]/documentos, se firma de nuevo AL SERVIR.
 * Devuelve los documentos con `url_imagen` lista para abrir (1 h).
 */
export async function firmarDocumentosRecepcion<T extends { url_imagen?: string | null; storage_path?: string | null }>(docs: T[] | null | undefined): Promise<T[]> {
  const lista = (docs || []).filter(Boolean)
  if (lista.length === 0) return []
  const storage = createAdminClient().storage.from("comprobantes")
  return Promise.all(
    lista.map(async (doc) => {
      const ruta = doc.storage_path || doc.url_imagen?.match(/\/comprobantes\/(.+?)(\?|$)/)?.[1] || null
      if (!ruta) return doc
      try {
        const { data } = await storage.createSignedUrl(decodeURIComponent(ruta), 3600)
        return data?.signedUrl ? { ...doc, url_imagen: data.signedUrl } : doc
      } catch {
        return doc
      }
    }),
  )
}

/** La recepción tal como la devuelve POST /api/deposito/recepciones, con las fotos abribles. */
export async function conFotosFirmadas<R extends { recepciones_documentos?: any[] | null }>(recepcion: R): Promise<R> {
  if (!recepcion?.recepciones_documentos?.length) return recepcion
  return { ...recepcion, recepciones_documentos: await firmarDocumentosRecepcion(recepcion.recepciones_documentos) }
}

/**
 * Órdenes de compra pendientes de recibir, cada una con su última recepción
 * (GET /api/deposito/recepciones y dataset deposito_recepciones de la app).
 * Con `ordenId` trae solo esa (o [] si ya no está pendiente).
 */
export async function cargarOrdenesPendientes(supabase: any, ordenId?: string): Promise<any[]> {
  // unidad_conteo: en qué contó el operario (null = la unidad de la línea de la OC). Ver unidades.ts
  const colsItem = `id, articulo_id, cantidad_oc, cantidad_fisica, estado_linea, fuera_de_oc${(await hayColumnasConteo(supabase)) ? ", unidad_conteo" : ""}`
  let q = supabase
    .from("ordenes_compra")
    .select(`
        id,
        numero_orden,
        estado,
        fecha_orden,
        observaciones,
        proveedores(id, nombre),
        ordenes_compra_detalle(
          id,
          cantidad_pedida,
          tipo_cantidad,
          articulo_id,
          precio_unitario,
          articulos(id, sku, descripcion, ean13, unidades_por_bulto)
        )
      `)
    .in("estado", ESTADOS_A_RECIBIR)
    .order("fecha_orden", { ascending: true })
  if (ordenId) q = q.eq("id", ordenId)
  const { data: ordenes, error } = await q
  if (error) throw error

  return Promise.all(
    (ordenes || []).map(async (orden: any) => {
      const { data: recepcion } = await supabase
        .from("recepciones")
        .select(`
            id, estado, fecha_inicio, numero_tanda, conformidad_transporte,
            recepciones_items(${colsItem}),
            recepciones_documentos(id, tipo_documento, url_imagen, procesado)
          `)
        .eq("orden_compra_id", orden.id)
        .neq("estado", "cancelada")
        .order("numero_tanda", { ascending: false })
        .limit(1)
        .maybeSingle()
      // E-39: la última entrega ya se finalizó y la orden sigue abierta ⇒ falta mercadería.
      // Se muestra como una orden sin empezar con SOLO lo que falta (en la unidad de la línea):
      // así la app instalada (que arma la pantalla con estas líneas) recibe la segunda entrega
      // sin cambios, y al entrar el servidor abre la tanda siguiente.
      if (recepcion?.estado === "finalizada") {
        const pendientes = await pendientesDeOrden(supabase, orden.id)
        return {
          ...orden,
          ordenes_compra_detalle: (orden.ordenes_compra_detalle || [])
            .filter((d: any) => pendientes.has(d.articulo_id))
            .map((d: any) => ({ ...d, cantidad_pedida: pendientes.get(d.articulo_id)!.enUnidadOC })),
          recepcion: null,
          entrega_numero: Number(recepcion.numero_tanda || 1) + 1,
        }
      }
      return { ...orden, recepcion: recepcion || null }
    }),
  )
}

/**
 * Crear o retomar la recepción de una OC (POST /api/deposito/recepciones).
 * `abrirSiguiente`: la última entrega ya se finalizó y falta mercadería ⇒ abrir la siguiente.
 * Solo lo piden "Iniciar recepción" (app: `recepcion.iniciar`; web: entrar a la orden). Sin eso se
 * devuelve la entrega finalizada tal cual, y quien llama decide (rechazar el conteo tardío, etc.).
 */
export async function obtenerOCrearRecepcion(supabase: any, orden_compra_id: string, usuarioId?: string | null, opts?: { abrirSiguiente?: boolean; capturadoAt?: string | null }) {
  if (!orden_compra_id) throw new ErrorDeposito("orden_compra_id requerido", 400)

  // Entrega en curso → retomarla.
  const ultima = await ultimaTanda(supabase, orden_compra_id)
  if (ultima && ultima.estado !== "finalizada") return ultima

  // Detalle de la OC (cantidades pedidas y precios) + proveedor
  const { data: ocData } = await supabase.from("ordenes_compra").select("id, proveedor_id, estado").eq("id", orden_compra_id).maybeSingle()
  if (!ocData) {
    if (ultima) return ultima
    throw new ErrorDeposito("Orden de compra no encontrada", 404)
  }

  let detalles: Array<{ articulo_id: string; cantidad_pedida: number; precio_unitario: number }>
  if (ultima) {
    // E-39: la entrega anterior ya se finalizó. Se abre OTRA sobre la misma orden solo si la
    // orden sigue abierta y falta mercadería; la entrega nueva lleva únicamente lo que falta.
    // Si la oficina ya la cerró (finalizada / cancelada) o no falta nada, no se abre nada.
    if (!abreEntregaSiguiente(opts, ultima.fecha_fin)) return ultima
    if (!ESTADOS_A_RECIBIR.includes(ocData.estado)) return ultima
    const pendientes = await pendientesDeOrden(supabase, orden_compra_id)
    if (pendientes.size === 0) return ultima
    detalles = [...pendientes].map(([articulo_id, p]) => ({ articulo_id, cantidad_pedida: p.enUnidadOC, precio_unitario: p.precio_unitario }))
  } else {
    const { data } = await supabase
      .from("ordenes_compra_detalle")
      .select("articulo_id, cantidad_pedida, precio_unitario")
      .eq("orden_compra_id", orden_compra_id)
    detalles = data || []
  }
  const numeroTanda = ultima ? Number(ultima.numero_tanda || 1) + 1 : 1

  const { data: nueva, error } = await supabase
    .from("recepciones")
    .insert({
      orden_compra_id,
      proveedor_id: ocData?.proveedor_id || null,
      estado: "en_proceso",
      usuario_id: usuarioId ?? null,
      numero_tanda: numeroTanda,
    })
    .select()
    .single()
  if (error) throw error

  // Dos equipos abrieron la misma OC a la vez: se queda la primera que se creó.
  // (solo entre las entregas ABIERTAS: las ya finalizadas son entregas anteriores, no duplicados)
  const { data: todas } = await supabase
    .from("recepciones")
    .select("id, created_at")
    .eq("orden_compra_id", orden_compra_id)
    .not("estado", "in", "(cancelada,finalizada)")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
  if (todas && todas.length > 1 && todas[0].id !== nueva.id) {
    await supabase.from("recepciones").delete().eq("id", nueva.id)
    const ganadora = await ultimaTanda(supabase, orden_compra_id)
    if (ganadora) return ganadora
  }

  const itemsNuevos = (detalles || []).map((d: any) => ({
    recepcion_id: nueva.id,
    articulo_id: d.articulo_id,
    cantidad_oc: Number(d.cantidad_pedida || 0),
    cantidad_fisica: 0,
    estado_linea: "pendiente",
    precio_oc: d.precio_unitario || 0,
  }))
  if (itemsNuevos.length > 0) await supabase.from("recepciones_items").insert(itemsNuevos)

  await supabase.from("ordenes_compra").update({ estado: "recibida_parcial" }).eq("id", orden_compra_id)

  const { data: full } = await supabase.from("recepciones").select(SELECT_FULL).eq("id", nueva.id).single()
  return full
}

export interface ConformidadTransporte {
  transporte_id?: string | null
  bultos_declarados?: number | null
  bultos_recibidos?: number | null
  estado: "conforme" | "no_conforme" | "omitida"
  observaciones?: string | null
}

/** Control de bultos / conformidad al transporte (paso previo al escaneo). */
export async function guardarConformidad(supabase: any, recepcion_id: string, conformidad: ConformidadTransporte, fecha?: string) {
  const { transporte_id, bultos_declarados, bultos_recibidos, estado, observaciones } = conformidad
  if (!["conforme", "no_conforme", "omitida"].includes(estado)) throw new ErrorDeposito("Estado de conformidad inválido", 400)
  if (estado === "no_conforme" && !observaciones?.trim()) {
    throw new ErrorDeposito("Si los bultos no coinciden, la observación es obligatoria", 400)
  }
  const { data, error } = await supabase
    .from("recepciones")
    .update({
      transporte_id: transporte_id || null,
      bultos_declarados: bultos_declarados ?? null,
      bultos_recibidos: bultos_recibidos ?? null,
      conformidad_transporte: estado,
      conformidad_observaciones: observaciones || null,
      conformidad_at: fecha || nowArgentina(),
    })
    .eq("id", recepcion_id)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Conteo de un artículo. cantidad_fisica: -1 = volver a pendiente · 0 = faltante · n = recibido.
 *
 * `unidad` (E-30): en qué contó el operario. Sin `unidad` (web y APK anteriores a la
 * 0.5.2) vale la unidad de la línea de la OC —que es el número que esas pantallas
 * muestran— y "unidad" para lo que no estaba en la OC. La conversión a unidades base
 * se hace al finalizar (finalizarRecepcion), nunca acá.
 */
export async function aplicarItemRecepcion(
  supabase: any,
  recepcion_id: string,
  articulo_id: string,
  cantidad_fisica: number,
  unidad?: UnidadConteo | null,
) {
  const { estado_linea, cantidad } = estadoLineaRecepcion(Number(cantidad_fisica))
  const elegida: UnidadConteo | null = cantidad > 0 && esUnidadConteo(unidad) ? unidad : null
  const conColumnas = await hayColumnasConteo(supabase)

  if (elegida && !conColumnas) {
    // Sin la columna no hay dónde guardar la elección: solo se acepta si coincide con la unidad por defecto.
    const { data: rec } = await supabase.from("recepciones").select("orden_compra_id").eq("id", recepcion_id).maybeSingle()
    const { data: fila } = await supabase
      .from("recepciones_items")
      .select("id, articulo_id, fuera_de_oc")
      .eq("recepcion_id", recepcion_id)
      .eq("articulo_id", articulo_id)
      .limit(1)
      .maybeSingle()
    const porDefecto = fila
      ? (await conversionesDeRecepcion(supabase, rec?.orden_compra_id ?? null, [fila])).porItem.get(fila.id)!.unidadConteo
      : "unidad"
    if (porDefecto !== elegida) {
      throw new ErrorDeposito(
        `Todavía no se puede contar este artículo por ${elegida}: cargalo por ${porDefecto} (falta una actualización del sistema).`,
        409,
        { codigo: "unidad_no_disponible" },
      )
    }
  }
  // Conteo absoluto: la unidad también se pisa (null = la de la línea), así un reconteo
  // desde otro equipo no hereda la unidad del conteo anterior.
  const conteo = conColumnas ? { unidad_conteo: elegida } : {}

  const { data: actualizados, error } = await supabase
    .from("recepciones_items")
    .update({ cantidad_fisica: cantidad, estado_linea, ...conteo })
    .eq("recepcion_id", recepcion_id)
    .eq("articulo_id", articulo_id)
    .select()
  if (error) throw error

  // Artículo escaneado que NO está en la OC: registrarlo igual como
  // fuera_de_oc para que la verificación lo muestre (pedido 0, recibido N).
  if (!actualizados || actualizados.length === 0) {
    const { data: nuevo, error: insError } = await supabase
      .from("recepciones_items")
      .insert({ recepcion_id, articulo_id, cantidad_oc: 0, cantidad_fisica: cantidad, estado_linea, fuera_de_oc: true, ...conteo })
      .select()
      .single()
    if (insError) throw insError
    return { ...nuevo, fuera_de_oc: true }
  }
  return actualizados[0]
}

interface StockAplicado {
  item_id: string
  articulo_id: string
  /** Unidades base sumadas al stock por esta línea (null = lo sumó una finalización anterior a la migración) */
  cantidad_base: number | null
  stock_antes: number | null
  stock_despues: number | null
}

/**
 * Suma al stock SIN la función SQL (migración 20261116a sin aplicar): leer y escribir,
 * como se hizo siempre, pero en unidades base. La doble suma la evita el candado de
 * finalizarRecepcion + la guarda por kardex (`hechos`): por eso cada artículo deja su
 * kardex (`registrar`) apenas se le suma, antes de pasar al siguiente.
 */
async function aplicarStockSinFuncion(
  supabase: any,
  lineas: Array<{ id: string; articulo_id: string; base: number }>,
  hechos: Set<string>,
  registrar: (articuloId: string, g: { base: number; antes: number | null; despues: number | null }) => Promise<void>,
): Promise<void> {
  const porArticulo = new Map<string, number>()
  for (const l of lineas) porArticulo.set(l.articulo_id, (porArticulo.get(l.articulo_id) || 0) + l.base)
  for (const [articuloId, base] of porArticulo) {
    const l = { articulo_id: articuloId, base }
    if (hechos.has(l.articulo_id)) continue
    const { data: art, error: errLeer } = await supabase.from("articulos").select("stock_actual").eq("id", l.articulo_id).single()
    if (errLeer) throw errLeer
    const antes = Number(art?.stock_actual || 0)
    const despues = antes + l.base
    const { error: errEscribir } = await supabase.from("articulos").update({ stock_actual: despues }).eq("id", l.articulo_id)
    if (errEscribir) throw errEscribir
    await registrar(articuloId, { base, antes, despues })
    hechos.add(articuloId)
  }
}

/**
 * Finalizar recepción: sube stock (SIEMPRE en unidades base), deja kardex y cierra la OC.
 *
 * Idempotente (E-40): con la migración 20261116a la suma la hace `recepcion_aplicar_stock`
 * en una sola transacción, con la recepción bloqueada y una marca por línea
 * (`stock_aplicado_at`): finalizar dos veces, o dos equipos a la vez, suma una sola vez.
 * Sin la migración queda el candado por `fecha_fin` + la guarda por kardex de antes.
 */
export async function finalizarRecepcion(supabase: any, recepcion_id: string, opts: { exigirResuelta?: boolean } = {}) {
  const { data: rec } = await supabase
    .from("recepciones")
    .select("id, estado, fecha_fin, orden_compra_id")
    .eq("id", recepcion_id)
    .maybeSingle()
  if (!rec) throw new ErrorDeposito("Recepción no encontrada", 404)
  if (rec.estado === "finalizada") return { ok: true, ya_finalizada: true }
  if (rec.estado === "cancelada") throw new ErrorDeposito("La recepción fue cancelada.", 409, { codigo: "recepcion_cancelada" })

  const conColumnas = await hayColumnasConteo(supabase)
  const { data: items, error: itemsErr } = await supabase
    .from("recepciones_items")
    .select(`id, articulo_id, cantidad_fisica, precio_documentado, precio_oc, estado_linea, fuera_de_oc, factor_conversion${conColumnas ? ", unidad_conteo" : ""}`)
    .eq("recepcion_id", recepcion_id)
    .order("id", { ascending: true })
  if (itemsErr) throw itemsErr

  if (opts.exigirResuelta) {
    const pend = (items || []).filter((i: any) => !i.estado_linea || i.estado_linea === "pendiente").length
    if (pend > 0) throw new ErrorDeposito(`Faltan ${pend} artículos por escanear o marcar`, 400, { codigo: "lineas_pendientes" })
  }

  // ── Candado: un solo finalizador a la vez (fecha_fin hace de marca) ──
  const ahora = nowArgentina()
  const candadoVencido = rec.fecha_fin && Date.now() - Date.parse(rec.fecha_fin) > CANDADO_FINALIZAR_MS
  // "borrador": la recepción la creó la oficina al subir la factura antes de que llegue la
  // mercadería (/api/ordenes-compra/[id]/documentos). Con solo "en_proceso" esa recepción no se
  // podía finalizar nunca desde depósito (quedaba reintentando "otro equipo está finalizando").
  let q = supabase.from("recepciones").update({ fecha_fin: ahora }).eq("id", recepcion_id).in("estado", ABIERTA)
  q = rec.fecha_fin && candadoVencido ? q.eq("fecha_fin", rec.fecha_fin) : q.is("fecha_fin", null)
  const { data: tomado, error: candErr } = await q.select("id")
  if (candErr) throw candErr
  if (!tomado || tomado.length === 0) {
    // Otro equipo la está finalizando ahora mismo: error transitorio (el outbox reintenta)
    throw new ErrorDeposito("Otro equipo está finalizando esta recepción. Se reintenta en unos segundos.", 503, { codigo: "finalizando" })
  }

  const sinUnidadesPorBulto: string[] = []
  try {
    // Cada línea a unidades base: bulto ⇒ × unidades por bulto del artículo (unidades.ts)
    const { porItem, articulos } = await conversionesDeRecepcion(supabase, rec.orden_compra_id, items || [])
    const contadas = (items || [])
      .filter((i: any) => Number(i.cantidad_fisica) > 0)
      .map((i: any) => {
        const conv = porItem.get(i.id)!
        return { ...i, conv, base: aUnidadesBase(i.cantidad_fisica, conv.factorConteo) }
      })

    // Artículos que ya tienen su movimiento (finalización anterior interrumpida)
    const { data: yaHechos, error: kardexErr } = await supabase
      .from("kardex")
      .select("articulo_id")
      .eq("recepcion_id", recepcion_id)
      .eq("tipo_movimiento", "compra")
    if (kardexErr) throw kardexErr
    const hechos = new Set<string>((yaHechos || []).map((k: any) => k.articulo_id))

    // ── Stock ──
    // ── Kardex y movimiento de stock: uno por artículo, en unidades base ──
    const registrar = async (articuloId: string, g: { base: number; antes: number | null; despues: number | null }) => {
      if (hechos.has(articuloId) || !(g.base > 0)) return
      const art = articulos.get(articuloId)
      const linea = contadas.find((l: any) => l.articulo_id === articuloId)
      if (linea?.conv.sinUnidadesPorBulto) sinUnidadesPorBulto.push(art?.descripcion || articuloId)

      // Movimiento de stock (legacy — mantener para compatibilidad)
      await supabase.from("movimientos_stock").insert({
        articulo_id: articuloId,
        tipo_movimiento: "entrada",
        cantidad: g.base,
        observaciones: `Recepción depósito #${recepcion_id}`,
      })

      // Kardex unificado, valorizado POR UNIDAD con el mejor precio disponible:
      // factura OCR (llevada a unidad con su factor) → precio de la OC → costo del
      // artículo. Si todo es 0, validar el comprobante después lo revaloriza.
      const factorDoc = Number(linea?.factor_conversion) > 0 ? Number(linea.factor_conversion) : 1
      const precioDoc = Number(linea?.precio_documentado || 0) / factorDoc
      const precio = Number(precioDoc || linea?.precio_oc || art?.precio_compra || 0)
      const subtotal = Math.round(precio * g.base * 100) / 100

      await insertarKardex(
        supabase,
        {
          tipo_movimiento: "compra",
          fecha: ahora,
          articulo_id: articuloId,
          cantidad: g.base,
          precio_lista: precio,
          precio_unitario_final: precio,
          subtotal_neto: subtotal,
          subtotal_total: subtotal,
          recepcion_id,
          stock_antes: g.antes ?? undefined,
          stock_despues: g.despues ?? undefined,
        },
        {
          sku: art?.sku,
          descripcion: art?.descripcion,
          categoria: art?.categoria,
          proveedor_id: art?.proveedor_id,
          iva_compras: art?.iva_compras,
          iva_ventas: art?.iva_ventas,
        },
      )
    }

    let aplicados: StockAplicado[] = []
    // La función lee de la base en qué se contó cada línea y las unidades por bulto (no recibe
    // factores). Se llama con el cliente de servicio: no tiene permiso para usuarios; el acceso a
    // esta recepción ya se comprobó arriba con la sesión del usuario (lectura + candado).
    const rpc = await createAdminClient().rpc("recepcion_aplicar_stock", { p_recepcion_id: recepcion_id })
    if (!rpc.error) aplicados = (rpc.data || []) as StockAplicado[]
    // Solo si la función que falta es ESA (migración sin aplicar). Un error adentro de la función se propaga.
    else if (faltaLaFuncion(rpc.error, "recepcion_aplicar_stock")) await aplicarStockSinFuncion(supabase, contadas, hechos, registrar)
    else throw rpc.error

    const porArticulo = new Map<string, { base: number; antes: number | null; despues: number | null }>()
    for (const a of aplicados) {
      if (a.cantidad_base == null) continue // sumado por una finalización vieja: ya tiene su kardex
      const g = porArticulo.get(a.articulo_id)
      if (!g) porArticulo.set(a.articulo_id, { base: Number(a.cantidad_base), antes: a.stock_antes, despues: a.stock_despues })
      else {
        g.base += Number(a.cantidad_base)
        g.despues = a.stock_despues
      }
    }

    for (const [articuloId, g] of porArticulo) await registrar(articuloId, g)
  } catch (e) {
    // Se suelta el candado para que el reintento no espere 2 minutos. Lo ya sumado
    // no se repite: lo marca la función SQL (o el kardex, sin la migración).
    await supabase.from("recepciones").update({ fecha_fin: null }).eq("id", recepcion_id).in("estado", ABIERTA).eq("fecha_fin", ahora)
    throw e
  }

  await supabase.from("recepciones").update({ estado: "finalizada", fecha_fin: nowArgentina() }).eq("id", recepcion_id)

  // E-92: un faltante no cierra la orden. Si después de esta entrega todavía falta mercadería,
  // la orden queda "recibida en parte": el depósito puede recibir el resto en otra entrega, y la
  // oficina decide en la verificación si la cierra sin el resto. Completa solo si llegó todo.
  // (Solo se toca una orden que está en recepción: nunca una que la oficina ya finalizó o canceló.)
  let faltaRecibir = 0
  if (rec.orden_compra_id) {
    faltaRecibir = (await pendientesDeOrden(supabase, rec.orden_compra_id)).size
    await supabase.from("ordenes_compra")
      .update({ estado: faltaRecibir > 0 ? "recibida_parcial" : "recibida_completa" })
      .eq("id", rec.orden_compra_id)
      .in("estado", [...ESTADOS_A_RECIBIR, "recibida_completa"])
    // Lo que estaba "en camino" de esta orden (kardex pendiente) baja a lo que todavía falta recibir:
    // lo que entró ya tiene su movimiento de compra de esta recepción (E-31). No frena la recepción.
    try {
      const { sincronizarKardexEnCamino } = await import("@/lib/compras/costo-y-kardex")
      await sincronizarKardexEnCamino(createAdminClient(), rec.orden_compra_id)
    } catch (e: any) {
      console.error("[deposito] kardex en camino:", e?.message || e)
    }
  }
  return { ok: true, ...(sinUnidadesPorBulto.length ? { sin_unidades_por_bulto: sinUnidadesPorBulto } : {}), ...(faltaRecibir > 0 ? { falta_recibir: faltaRecibir } : {}) }
}
