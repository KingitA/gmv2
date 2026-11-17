/**
 * Carga TODO lo que necesita la verificación de una orden de compra en el servidor, con
 * las consultas en paralelo (E-96: la pantalla hacía 8 consultas en fila desde el navegador
 * + una por comprobante y tardaba 12–35 s). Devuelve también cuánto tardó cada etapa, para
 * poder ver en los registros del servidor cuál es la lenta si vuelve a pasar.
 *
 * Solo lee. La cuenta la hace lib/compras/verificacion.ts (puro).
 */

import { aUnidadesBase, conversionLinea } from "@/lib/deposito/unidades"
import { faltaLaColumna } from "@/lib/utils/migracion-pendiente"
import { evaluarFinalizarOC, esComprobanteConPrecios, type ControlFinalizarOC } from "./finalizar-oc"
import { armarVerificacion, type DatosVerificacion, type Verificacion } from "./verificacion"
import { controlSuma } from "./control-suma"

export interface DocumentoRecepcion {
  id: string
  recepcion_id: string
  comprobante_id: string | null
  tipo_documento: string | null
  nombre_archivo: string | null
  tipo_mime: string | null
  procesado: boolean
  /** La lectura automática falló o no encontró renglones: quedó adjunto sin comprobante */
  no_leido: boolean
  /** Detalle técnico del fallo (para sistemas; la pantalla lo muestra escondido) */
  motivo: string | null
  /** Enlace firmado para ver la foto o el PDF (1 hora) */
  url: string | null
  created_at: string | null
}

export interface VerificacionOC {
  orden: { id: string; numero_orden: string; estado: string; proveedor_id: string | null; proveedor_nombre: string | null; observaciones: string | null }
  verificacion: Verificacion
  comprobantes: any[]
  /**
   * Entregas de la orden, con el control de bultos que hizo el depósito contra el remito del
   * transporte (E-45): si faltaron bultos, es la base para cargarle el faltante al transporte.
   */
  recepciones: Array<{
    id: string; estado: string; numero_tanda: number | null; fecha_fin: string | null; transporte_id: string | null
    conformidad_transporte: string | null; bultos_declarados: number | null; bultos_recibidos: number | null; conformidad_observaciones: string | null
  }>
  documentos: DocumentoRecepcion[]
  control: ControlFinalizarOC & { /** Artículos de la orden que no llegaron completos (E-92) */ pendientes: Array<{ articulo_id: string; sku: string; unidades: number }> }
  /** Comprobantes sin validar cuyos renglones no suman lo que dice el comprobante (E-46): no se pueden validar así */
  descuadres: Array<{ comprobante_id: string; comprobante: string; faltas: string[] }>
  /** La orden ya está cerrada o cancelada: se puede mirar, no tocar */
  solo_lectura: boolean
  tiempos: Record<string, number>
}

const tablaNoExiste = (e: any) => !!e && (e.code === "42P01" || e.code === "PGRST205")

export async function cargarVerificacionOC(supabase: any, ordenId: string): Promise<VerificacionOC | null> {
  const tiempos: Record<string, number> = {}
  const t0 = Date.now()
  const medir = async <T>(nombre: string, p: PromiseLike<T>): Promise<T> => {
    const t = Date.now()
    const r = await p
    tiempos[nombre] = Date.now() - t
    return r
  }
  const ok = <T>(r: { data: T | null; error: any }, que: string): T => {
    if (r.error) throw new Error(`${que}: ${r.error.message}`)
    return r.data as T
  }

  // ── Etapa 1: todo lo que cuelga directo de la orden, a la vez ──
  const [rOrden, rItems, rComps, rRecs] = await Promise.all([
    medir("orden", supabase.from("ordenes_compra").select("id, numero_orden, estado, proveedor_id, observaciones, proveedor:proveedores(nombre)").eq("id", ordenId).maybeSingle()),
    medir("detalle_oc", supabase.from("ordenes_compra_detalle").select("articulo_id, cantidad_pedida, tipo_cantidad, precio_unitario, descuento1, descuento2, descuento3, descuento4").eq("orden_compra_id", ordenId)),
    medir("comprobantes", supabase.from("comprobantes_compra").select("id, tipo_comprobante, numero_comprobante, fecha_comprobante, estado, total_factura_declarado, total_neto, total_iva, percepcion_iva_monto, percepcion_iibb_monto, retencion_ganancias_monto, impuestos_internos, otros_impuestos, descuento_fuera_factura, origen_nc, foto_url, created_at").eq("orden_compra_id", ordenId).order("created_at", { ascending: true })),
    medir("recepciones", supabase.from("recepciones").select("id, estado, numero_tanda, fecha_fin, transporte_id, conformidad_transporte, bultos_declarados, bultos_recibidos, conformidad_observaciones, created_at").eq("orden_compra_id", ordenId).neq("estado", "cancelada").order("created_at", { ascending: true })),
  ])
  const ordenFila: any = ok(rOrden as any, "orden")
  if (!ordenFila) return null
  const ocItems: any[] = ok(rItems as any, "detalle de la orden") || []
  const comprobantes: any[] = ok(rComps as any, "comprobantes") || []
  const recepciones: any[] = ok(rRecs as any, "recepciones") || []
  const compIds = comprobantes.map((c) => c.id)
  const recIds = recepciones.map((r) => r.id)

  // ── Etapa 2: renglones de comprobantes, líneas recibidas, documentos y resoluciones, a la vez ──
  const vacio = Promise.resolve({ data: [], error: null })
  const [rDet, rRecItems, rDocs, rRes] = await Promise.all([
    medir("renglones", compIds.length
      ? supabase.from("comprobantes_compra_detalle").select("id, comprobante_id, articulo_id, cantidad_facturada, precio_unitario, descuento1, descuento2, descuento3, descuento4, tipo_cantidad, recepcion_item_id, iva_porcentaje, match_estado, descripcion_proveedor").in("comprobante_id", compIds)
      : vacio),
    medir("lineas_recibidas", recIds.length ? supabase.from("recepciones_items").select("*").in("recepcion_id", recIds).order("id", { ascending: true }) : vacio),
    medir("documentos", recIds.length
      ? supabase.from("recepciones_documentos").select("id, recepcion_id, comprobante_id, tipo_documento, nombre_archivo, tipo_mime, procesado, datos_ocr, storage_path, url_imagen, created_at").in("recepcion_id", recIds).order("created_at", { ascending: true })
      : vacio),
    medir("resoluciones", recIds.length ? supabase.from("recepciones_diferencias").select("recepcion_item_id, articulo_id, tipo, destino, importe_total, unidades_devueltas, created_at, usuario_id").in("recepcion_id", recIds) : vacio),
  ])
  const detalle: any[] = ok(rDet as any, "renglones de comprobantes") || []
  const recItemsCrudos: any[] = ok(rRecItems as any, "líneas recibidas") || []
  const docsCrudos: any[] = ok(rDocs as any, "documentos") || []
  // La tabla de resoluciones llega con la migración 20261117b: sin ella valen las marcas de la línea
  const res: any = rRes
  if (res.error && !tablaNoExiste(res.error) && !faltaLaColumna(res.error)) throw new Error(`resoluciones: ${res.error.message}`)
  const resoluciones: any[] = res.error ? [] : res.data || []

  // ── Etapa 3: artículos (de la orden, recibidos y facturados) y enlaces a las fotos ──
  const idsArt = [...new Set([...ocItems.map((i) => i.articulo_id), ...recItemsCrudos.map((r) => r.articulo_id), ...detalle.map((l) => l.articulo_id)].filter(Boolean))]
  const storage = supabase.storage.from("comprobantes")
  const articulosP: Promise<any[]> = medir("articulos", (async (): Promise<any[]> => {
      const todos: any[] = []
      for (let i = 0; i < idsArt.length; i += 200) {
        const r = await supabase.from("articulos").select("id, sku, descripcion, unidades_por_bulto").in("id", idsArt.slice(i, i + 200))
        todos.push(...(ok<any[]>(r, "artículos") || []))
      }
      return todos
    })())
  const documentosP: Promise<DocumentoRecepcion[]> = medir("fotos", Promise.all(docsCrudos.map(async (doc): Promise<DocumentoRecepcion> => {
      const ruta = doc.storage_path || doc.url_imagen?.match(/\/comprobantes\/(.+?)(\?|$)/)?.[1] || null
      let url: string | null = null
      if (ruta) {
        try {
          const { data } = await storage.createSignedUrl(decodeURIComponent(ruta), 3600)
          url = data?.signedUrl ?? null
        } catch { /* sin enlace: se muestra el documento igual */ }
      }
      return {
        id: doc.id, recepcion_id: doc.recepcion_id, comprobante_id: doc.comprobante_id ?? null,
        tipo_documento: doc.tipo_documento ?? null, nombre_archivo: doc.nombre_archivo ?? null, tipo_mime: doc.tipo_mime ?? null,
        procesado: !!doc.procesado,
        no_leido: !doc.procesado && !!doc.datos_ocr?.no_leido,
        motivo: doc.datos_ocr?.motivo ?? doc.datos_ocr?.error ?? null,
        url, created_at: doc.created_at ?? null,
      }
    })))
  const [articulos, documentos] = [await articulosP, await documentosP]

  // Lo contado, en unidades (lo que sumó al stock, o lo contado × su factor: misma regla que al finalizar)
  const tipoOC = new Map<string, string | null>(ocItems.map((i) => [i.articulo_id, i.tipo_cantidad]))
  const upb = new Map<string, any>(articulos.map((a: any) => [a.id, a.unidades_por_bulto]))
  const recItems: DatosVerificacion["recItems"] = recItemsCrudos.map((ri) => ({
    ...ri,
    unidades: ri.cantidad_fisica_base != null
      ? Number(ri.cantidad_fisica_base)
      : aUnidadesBase(ri.cantidad_fisica, conversionLinea({
          enOC: !ri.fuera_de_oc && tipoOC.has(ri.articulo_id),
          tipoCantidadOC: tipoOC.get(ri.articulo_id),
          unidadElegida: ri.unidad_conteo,
          unidadesPorBulto: upb.get(ri.articulo_id),
        }).factorConteo),
  }))

  const verificacion = armarVerificacion({ ocItems, articulos, comprobantes, detalle, recItems, resoluciones })

  // ¿Se puede finalizar? (misma regla que POST /finalizar)
  const validados = new Set(comprobantes.filter((c) => esComprobanteConPrecios(c.tipo_comprobante) && ["validado", "cerrado"].includes(c.estado)).map((c) => c.id))
  const skuDe = new Map<string, any>(articulos.map((a: any) => [a.id, a]))
  const control = evaluarFinalizarOC({
    comprobantes,
    recibidos: recItems.filter((r) => Number(r.unidades) > 0).map((r) => ({ articulo_id: r.articulo_id, sku: skuDe.get(r.articulo_id)?.sku ?? null, descripcion: skuDe.get(r.articulo_id)?.descripcion ?? null })),
    cubiertos: detalle.filter((l) => l.articulo_id && validados.has(l.comprobante_id)).map((l) => l.articulo_id),
  })
  const pendientes = verificacion.filas
    .filter((f) => f.banderas.includes("pendiente"))
    .map((f) => ({ articulo_id: f.articulo_id, sku: f.sku, unidades: f.dif.pendiente_oc }))

  // E-46: comprobantes todavía sin validar que no cierran
  const descuadres = comprobantes
    .filter((c) => !["validado", "cerrado", "esperada"].includes(c.estado))
    .map((c) => ({ c, suma: controlSuma(c, detalle.filter((l) => l.comprobante_id === c.id)) }))
    .filter((x) => !x.suma.ok)
    .map((x) => ({ comprobante_id: x.c.id, comprobante: `${x.c.tipo_comprobante} ${x.c.numero_comprobante}`, faltas: x.suma.faltas }))

  tiempos.total = Date.now() - t0
  if (tiempos.total > 3000) console.warn(`[verificación OC ${ordenFila.numero_orden}] lenta: ${JSON.stringify(tiempos)}`)

  const prov = Array.isArray(ordenFila.proveedor) ? ordenFila.proveedor[0] : ordenFila.proveedor
  return {
    orden: { id: ordenFila.id, numero_orden: ordenFila.numero_orden, estado: ordenFila.estado, proveedor_id: ordenFila.proveedor_id ?? null, proveedor_nombre: prov?.nombre ?? null, observaciones: ordenFila.observaciones ?? null },
    verificacion,
    comprobantes,
    recepciones: recepciones.map((r) => ({
      id: r.id, estado: r.estado, numero_tanda: r.numero_tanda ?? null, fecha_fin: r.fecha_fin ?? null, transporte_id: r.transporte_id ?? null,
      conformidad_transporte: r.conformidad_transporte ?? null, bultos_declarados: r.bultos_declarados ?? null, bultos_recibidos: r.bultos_recibidos ?? null,
      conformidad_observaciones: r.conformidad_observaciones ?? null,
    })),
    documentos,
    control: { ...control, pendientes },
    descuadres,
    solo_lectura: ["finalizada", "cancelada"].includes(ordenFila.estado),
    tiempos,
  }
}
