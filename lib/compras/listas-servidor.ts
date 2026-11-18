/**
 * Listas de precios de proveedor, del lado del servidor (Tanda 2-C): un solo lugar para crear una
 * lista (la carga de la oficina y la que llega por mail usan lo mismo), armar la vista previa y
 * firmar el enlace al archivo.
 */
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { MatchingEngine } from "@/lib/matching/matcher"
import { avisoPrecioVenta, cambioDeItem, UMBRAL_ALERTA_PCT, type AvisoVenta, type CambioLista, type FilaLista } from "./lista-proveedor"
import { tipoDescuentoDe } from "./neto-compra"

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Enlace al archivo de la lista. El bucket es privado: se firma por una hora. */
export async function enlaceArchivoLista(supabase: any, lista: { storage_path?: string | null; archivo_url?: string | null }): Promise<string | null> {
  let bucket = "comprobantes"
  let ruta = lista.storage_path || null
  if (ruta && ruta.startsWith("attachments:")) { bucket = "attachments"; ruta = ruta.slice("attachments:".length) }
  // listas viejas: solo quedó la URL "pública" (que un bucket privado no sirve)
  if (!ruta && lista.archivo_url) ruta = lista.archivo_url.match(/\/comprobantes\/(.+?)(\?|$)/)?.[1] || null
  if (!ruta) return null
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(decodeURIComponent(ruta), 3600)
  if (error) { console.warn("[listas] no se pudo firmar el archivo:", error.message); return null }
  return data?.signedUrl || null
}

export interface ItemParaLista extends FilaLista {
  /** Si ya viene resuelto (mail): artículo y qué tan seguro es */
  articulo_id?: string | null
  confianza?: "segura" | "dudosa" | null
}

/**
 * Crea la lista con sus renglones. Cada renglón queda:
 *   pendiente  → artículo encontrado con seguridad: se aplica;
 *   revisar    → artículo sugerido (parecido, o de otro proveedor): falta confirmarlo;
 *   ignorado   → sin artículo.
 */
export async function crearListaProveedor(supabase: any, p: {
  proveedor_id: string | null
  nombre: string
  fecha_vigencia: string
  fecha_fin?: string | null
  observaciones?: string | null
  storage_path?: string | null
  archivo_url?: string | null
  origen: "manual" | "mail"
  email_id?: string | null
  creado_por?: string | null
  items: ItemParaLista[]
}): Promise<{ lista_id: string; stats: { total: number; pendientes: number; revisar: number; sin_articulo: number } }> {
  const cabecera: Record<string, unknown> = {
    proveedor_id: p.proveedor_id || null,
    nombre: p.nombre,
    fecha_vigencia: p.fecha_vigencia,
    fecha_fin: p.fecha_fin || null,
    archivo_url: p.archivo_url || null,
    observaciones: p.observaciones || null,
    estado: "pendiente",
    creado_por: p.creado_por || null,
  }
  // columnas de la migración 20261119a: si todavía no está, la lista se crea igual sin ellas
  let { data: lista, error } = await supabase.from("listas_proveedores")
    .insert({ ...cabecera, storage_path: p.storage_path || null, origen: p.origen, email_id: p.email_id || null }).select("id").single()
  if (error && (error.code === "PGRST204" || error.code === "42703")) {
    ({ data: lista, error } = await supabase.from("listas_proveedores").insert(cabecera).select("id").single())
  }
  if (error || !lista) throw new Error(error?.message || "No se pudo crear la lista")

  const engine = new MatchingEngine()
  const filas: any[] = []
  for (const it of p.items) {
    let articuloId: string | null = it.articulo_id && it.confianza === "segura" ? it.articulo_id : null
    let sugeridoId: string | null = it.articulo_id && it.confianza !== "segura" ? it.articulo_id : null
    if (!articuloId && !sugeridoId && (it.codigo || it.descripcion)) {
      try {
        // contexto de compra: el código exacto y los artículos del proveedor primero; uno de otro
        // proveedor nunca se asigna solo
        const m = await engine.resolveItem({ description: it.descripcion || "", code: it.codigo || undefined, price: it.precio_compra ?? undefined }, p.proveedor_id || "", p.proveedor_id ? {} : null)
        const best = m.bestCandidate
        if (m.status === "matched" && best?.sku_id && !best.otro_proveedor) articuloId = best.sku_id
        else if (best?.sku_id && (best.confidence_level === "suggestion" || best.otro_proveedor)) sugeridoId = best.sku_id
      } catch (e: any) {
        console.warn("[listas] matching:", e?.message || e)
      }
    }
    filas.push({
      lista_id: lista.id,
      articulo_id: articuloId,
      articulo_sugerido_id: sugeridoId,
      codigo_proveedor: it.codigo || null,
      descripcion_proveedor: it.descripcion || null,
      precio_compra: it.precio_compra ?? null,
      // vacío = null ("no tocar"); 0 = 0
      descuento1: it.descuento1 ?? null, descuento2: it.descuento2 ?? null, descuento3: it.descuento3 ?? null, descuento4: it.descuento4 ?? null,
      estado_item: articuloId ? "pendiente" : sugeridoId ? "revisar" : "ignorado",
    })
  }
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500)
    let ins = await supabase.from("listas_proveedores_items").insert(lote)
    if (ins.error && (ins.error.code === "PGRST204" || ins.error.code === "42703")) {
      // sin la migración: no hay dónde anotar el sugerido; el renglón queda sin artículo
      ins = await supabase.from("listas_proveedores_items").insert(lote.map(({ articulo_sugerido_id: _s, ...r }) => ({ ...r, estado_item: r.articulo_id ? "pendiente" : "ignorado" })))
    }
    if (ins.error) throw new Error(`No se pudieron guardar los renglones de la lista: ${ins.error.message}`)
  }
  return {
    lista_id: lista.id,
    stats: {
      total: filas.length,
      pendientes: filas.filter((f) => f.estado_item === "pendiente").length,
      revisar: filas.filter((f) => f.estado_item === "revisar").length,
      sin_articulo: filas.filter((f) => f.estado_item === "ignorado").length,
    },
  }
}

export interface ItemVistaPrevia {
  id: string
  estado_item: string
  error: string | null
  codigo_proveedor: string | null
  descripcion_proveedor: string | null
  articulo: { id: string; sku: string | null; descripcion: string | null } | null
  sugerido: { id: string; sku: string | null; descripcion: string | null; otro_proveedor: string | null } | null
  /** Lo que trae el archivo (null = no toca ese dato) */
  archivo: { precio_compra: number | null; descuentos: Array<number | null> }
  cambio: CambioLista | null
  venta: AvisoVenta | null
}

export interface VistaPreviaLista {
  lista: any
  proveedor_nombre: string | null
  tipo_descuento: string
  archivo_enlace: string | null
  umbral_pct: number
  items: ItemVistaPrevia[]
  resumen: {
    total: number
    /** Renglones que se aplicarían (pendientes con artículo) */
    se_aplican: number
    con_cambio: number
    sin_cambio: number
    subas_grandes: number
    bajas_grandes: number
    por_revisar: number
    sin_articulo: number
    con_error: number
    aplicados: number
    venta_desactualizados: number
    venta_cambian_solos: number
  }
}

/** Todo lo que muestra la pantalla de una lista, armado en el servidor. */
export async function vistaPreviaLista(supabase: any, listaId: string, umbralPct?: number | null): Promise<VistaPreviaLista | null> {
  const { data: lista, error } = await supabase.from("listas_proveedores").select("*, proveedor:proveedores(*)").eq("id", listaId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!lista) return null
  const prov: any = Array.isArray(lista.proveedor) ? lista.proveedor[0] : lista.proveedor
  const tipoDescuento = tipoDescuentoDe(prov?.tipo_descuento)
  const umbral = umbralPct && umbralPct > 0 ? umbralPct : UMBRAL_ALERTA_PCT

  const items: any[] = await fetchAllRows(() => supabase.from("listas_proveedores_items").select("*").eq("lista_id", listaId).order("created_at").order("id"))
  const idsArt = [...new Set(items.flatMap((i) => [i.articulo_id, i.articulo_sugerido_id]).filter(Boolean))] as string[]
  const arts = new Map<string, any>()
  for (let i = 0; i < idsArt.length; i += 200) {
    const { data, error: artErr } = await supabase.from("articulos")
      .select("id, sku, descripcion, proveedor_id, precio_compra, descuento1, descuento2, descuento3, descuento4, precio_base, porcentaje_ganancia, bonif_recargo")
      .in("id", idsArt.slice(i, i + 200))
    if (artErr) throw new Error(artErr.message)
    for (const a of data || []) arts.set(a.id, a)
  }
  const idsProv = [...new Set([...arts.values()].map((a) => a.proveedor_id).filter((id) => id && id !== lista.proveedor_id))] as string[]
  const nombreProv = new Map<string, string>()
  if (idsProv.length > 0) {
    const { data } = await supabase.from("proveedores").select("id, nombre").in("id", idsProv)
    for (const pr of data || []) nombreProv.set(pr.id, pr.nombre)
  }

  const salida: ItemVistaPrevia[] = items.map((it) => {
    const a = it.articulo_id ? arts.get(it.articulo_id) : null
    const s = it.articulo_sugerido_id ? arts.get(it.articulo_sugerido_id) : null
    const archivo = { precio_compra: it.precio_compra != null ? num(it.precio_compra) : null, descuentos: [it.descuento1, it.descuento2, it.descuento3, it.descuento4].map((d: unknown) => (d == null ? null : num(d))) }
    // Ya aplicado: el "antes" es el que se guardó al aplicar, no el artículo de hoy
    const base = it.estado_item === "aplicado" && it.precio_anterior != null
      ? { ...a, precio_compra: it.precio_anterior, descuento1: it.descuento1_anterior, descuento2: it.descuento2_anterior, descuento3: it.descuento3_anterior, descuento4: it.descuento4_anterior }
      : a
    const cambio = a ? cambioDeItem({ precio_compra: archivo.precio_compra, descuento1: archivo.descuentos[0], descuento2: archivo.descuentos[1], descuento3: archivo.descuentos[2], descuento4: archivo.descuentos[3] }, base, tipoDescuento, umbral) : null
    return {
      id: it.id, estado_item: it.estado_item, error: it.error ?? null,
      codigo_proveedor: it.codigo_proveedor ?? null, descripcion_proveedor: it.descripcion_proveedor ?? null,
      articulo: a ? { id: a.id, sku: a.sku ?? null, descripcion: a.descripcion ?? null } : null,
      sugerido: s ? { id: s.id, sku: s.sku ?? null, descripcion: s.descripcion ?? null, otro_proveedor: s.proveedor_id && s.proveedor_id !== lista.proveedor_id ? (nombreProv.get(s.proveedor_id) || "otro proveedor") : null } : null,
      archivo,
      cambio,
      venta: a && cambio ? avisoPrecioVenta(a, cambio.actual.neto, cambio.nuevo.neto) : null,
    }
  })

  const seAplican = salida.filter((i) => i.estado_item === "pendiente" && i.articulo)
  const conCambio = seAplican.filter((i) => i.cambio && Object.keys(i.cambio.cambios).length > 0)
  return {
    lista: { ...lista, proveedor: undefined },
    proveedor_nombre: prov?.nombre ?? null,
    tipo_descuento: tipoDescuento,
    archivo_enlace: await enlaceArchivoLista(supabase, lista),
    umbral_pct: umbral,
    items: salida,
    resumen: {
      total: salida.length,
      se_aplican: seAplican.length,
      con_cambio: conCambio.length,
      sin_cambio: seAplican.length - conCambio.length,
      subas_grandes: conCambio.filter((i) => i.cambio?.alerta === "suba").length,
      bajas_grandes: conCambio.filter((i) => i.cambio?.alerta === "baja").length,
      por_revisar: salida.filter((i) => i.estado_item === "revisar").length,
      sin_articulo: salida.filter((i) => i.estado_item === "ignorado").length,
      con_error: salida.filter((i) => i.estado_item === "error").length,
      aplicados: salida.filter((i) => i.estado_item === "aplicado").length,
      venta_desactualizados: conCambio.filter((i) => i.venta?.tipo === "desactualizado").length,
      venta_cambian_solos: conCambio.filter((i) => i.venta?.tipo === "cambia_solo").length,
    },
  }
}
