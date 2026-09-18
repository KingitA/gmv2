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
import { nowArgentina } from "@/lib/utils"
import { estadoLineaRecepcion } from "./bonificados"
import { ErrorDeposito } from "./picking"

const SELECT_FULL = `*, recepciones_items(*), recepciones_documentos(*)`
/** Un finalizador que lleva más que esto sin terminar se considera caído y se retoma */
const CANDADO_FINALIZAR_MS = 2 * 60_000

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
 * Órdenes de compra pendientes de recibir, cada una con su última recepción
 * (GET /api/deposito/recepciones y dataset deposito_recepciones de la app).
 * Con `ordenId` trae solo esa (o [] si ya no está pendiente).
 */
export async function cargarOrdenesPendientes(supabase: any, ordenId?: string): Promise<any[]> {
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
          articulo_id,
          precio_unitario,
          articulos(id, sku, descripcion, ean13, unidades_por_bulto)
        )
      `)
    .in("estado", ["pendiente", "recibida_parcial"])
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
            recepciones_items(id, articulo_id, cantidad_oc, cantidad_fisica, estado_linea, fuera_de_oc),
            recepciones_documentos(id, tipo_documento, url_imagen, procesado)
          `)
        .eq("orden_compra_id", orden.id)
        .neq("estado", "cancelada")
        .order("numero_tanda", { ascending: false })
        .limit(1)
        .maybeSingle()
      return { ...orden, recepcion: recepcion || null }
    }),
  )
}

/** Crear o retomar la recepción de una OC (POST /api/deposito/recepciones). */
export async function obtenerOCrearRecepcion(supabase: any, orden_compra_id: string, usuarioId?: string | null) {
  if (!orden_compra_id) throw new ErrorDeposito("orden_compra_id requerido", 400)

  // Tanda en curso → retomarla. Si ya está finalizada, NO se abre otra:
  // los faltantes no se reciben después, se repiden con una OC nueva.
  const ultima = await ultimaTanda(supabase, orden_compra_id)
  if (ultima) return ultima

  // Detalle de la OC (cantidades pedidas y precios) + proveedor
  const { data: ocData } = await supabase.from("ordenes_compra").select("id, proveedor_id").eq("id", orden_compra_id).maybeSingle()
  if (!ocData) throw new ErrorDeposito("Orden de compra no encontrada", 404)

  const { data: detalles } = await supabase
    .from("ordenes_compra_detalle")
    .select("articulo_id, cantidad_pedida, precio_unitario")
    .eq("orden_compra_id", orden_compra_id)

  const { data: nueva, error } = await supabase
    .from("recepciones")
    .insert({
      orden_compra_id,
      proveedor_id: ocData?.proveedor_id || null,
      estado: "en_proceso",
      usuario_id: usuarioId ?? null,
      numero_tanda: 1,
    })
    .select()
    .single()
  if (error) throw error

  // Dos equipos abrieron la misma OC a la vez: se queda la primera que se creó.
  const { data: todas } = await supabase
    .from("recepciones")
    .select("id, created_at")
    .eq("orden_compra_id", orden_compra_id)
    .not("estado", "eq", "cancelada")
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

/** Conteo de un artículo. cantidad_fisica: -1 = volver a pendiente · 0 = faltante · n = recibido. */
export async function aplicarItemRecepcion(supabase: any, recepcion_id: string, articulo_id: string, cantidad_fisica: number) {
  const { estado_linea, cantidad } = estadoLineaRecepcion(Number(cantidad_fisica))
  const { data: actualizados, error } = await supabase
    .from("recepciones_items")
    .update({ cantidad_fisica: cantidad, estado_linea })
    .eq("recepcion_id", recepcion_id)
    .eq("articulo_id", articulo_id)
    .select()
  if (error) throw error

  // Artículo escaneado que NO está en la OC: registrarlo igual como
  // fuera_de_oc para que la verificación lo muestre (pedido 0, recibido N).
  if (!actualizados || actualizados.length === 0) {
    const { data: nuevo, error: insError } = await supabase
      .from("recepciones_items")
      .insert({ recepcion_id, articulo_id, cantidad_oc: 0, cantidad_fisica: cantidad, estado_linea, fuera_de_oc: true })
      .select()
      .single()
    if (insError) throw insError
    return { ...nuevo, fuera_de_oc: true }
  }
  return actualizados[0]
}

/** Finalizar recepción: sube stock, deja kardex y cierra la OC. Idempotente. */
export async function finalizarRecepcion(supabase: any, recepcion_id: string, opts: { exigirResuelta?: boolean } = {}) {
  const { data: rec } = await supabase
    .from("recepciones")
    .select("id, estado, fecha_fin, orden_compra_id")
    .eq("id", recepcion_id)
    .maybeSingle()
  if (!rec) throw new ErrorDeposito("Recepción no encontrada", 404)
  if (rec.estado === "finalizada") return { ok: true, ya_finalizada: true }
  if (rec.estado === "cancelada") throw new ErrorDeposito("La recepción fue cancelada.", 409, { codigo: "recepcion_cancelada" })

  const { data: items } = await supabase
    .from("recepciones_items")
    .select("articulo_id, cantidad_fisica, precio_documentado, precio_oc, estado_linea")
    .eq("recepcion_id", recepcion_id)

  if (opts.exigirResuelta) {
    const pend = (items || []).filter((i: any) => !i.estado_linea || i.estado_linea === "pendiente").length
    if (pend > 0) throw new ErrorDeposito(`Faltan ${pend} artículos por escanear o marcar`, 400, { codigo: "lineas_pendientes" })
  }

  // ── Candado: un solo finalizador a la vez (fecha_fin hace de marca) ──
  const ahora = nowArgentina()
  const candadoVencido = rec.fecha_fin && Date.now() - Date.parse(rec.fecha_fin) > CANDADO_FINALIZAR_MS
  let q = supabase.from("recepciones").update({ fecha_fin: ahora }).eq("id", recepcion_id).eq("estado", "en_proceso")
  q = rec.fecha_fin && candadoVencido ? q.eq("fecha_fin", rec.fecha_fin) : q.is("fecha_fin", null)
  const { data: tomado, error: candErr } = await q.select("id")
  if (candErr) throw candErr
  if (!tomado || tomado.length === 0) {
    // Otro equipo la está finalizando ahora mismo: error transitorio (el outbox reintenta)
    throw new ErrorDeposito("Otro equipo está finalizando esta recepción. Se reintenta en unos segundos.", 503, { codigo: "finalizando" })
  }

  // Artículos que ya tienen su movimiento (finalización anterior interrumpida)
  const { data: yaHechos } = await supabase.from("kardex").select("articulo_id").eq("recepcion_id", recepcion_id).eq("tipo_movimiento", "compra")
  const hechos = new Set((yaHechos || []).map((k: any) => k.articulo_id))

  for (const item of items || []) {
    if (!(item.cantidad_fisica > 0) || hechos.has(item.articulo_id)) continue
    const { data: art } = await supabase
      .from("articulos")
      .select("stock_actual, sku, descripcion, categoria, proveedor_id, iva_compras, iva_ventas, precio_compra")
      .eq("id", item.articulo_id)
      .single()

    const stockAntes = art?.stock_actual || 0
    const nuevoStock = stockAntes + item.cantidad_fisica

    await supabase.from("articulos").update({ stock_actual: nuevoStock }).eq("id", item.articulo_id)

    // Movimiento de stock (legacy — mantener para compatibilidad)
    await supabase.from("movimientos_stock").insert({
      articulo_id: item.articulo_id,
      tipo_movimiento: "entrada",
      cantidad: item.cantidad_fisica,
      observaciones: `Recepción depósito #${recepcion_id}`,
    })

    // Kardex unificado, valorizado con el mejor precio disponible:
    // factura OCR → precio de la OC → costo del artículo. Si todo es 0,
    // validar el comprobante después lo revaloriza.
    const precio = Number(item.precio_documentado || item.precio_oc || art?.precio_compra || 0)
    const subtotal = Math.round(precio * item.cantidad_fisica * 100) / 100

    await insertarKardex(
      supabase,
      {
        tipo_movimiento: "compra",
        fecha: ahora,
        articulo_id: item.articulo_id,
        cantidad: item.cantidad_fisica,
        precio_lista: precio,
        precio_unitario_final: precio,
        subtotal_neto: subtotal,
        subtotal_total: subtotal,
        recepcion_id,
        stock_antes: stockAntes,
        stock_despues: nuevoStock,
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

  await supabase.from("recepciones").update({ estado: "finalizada", fecha_fin: nowArgentina() }).eq("id", recepcion_id)

  // El proveedor NO envía los pendientes después: la recepción cierra la OC; lo
  // que no vino queda visible en verificación como "incompleto vs OC".
  if (rec.orden_compra_id) {
    await supabase.from("ordenes_compra").update({ estado: "recibida_completa" }).eq("id", rec.orden_compra_id)
  }
  return { ok: true }
}
