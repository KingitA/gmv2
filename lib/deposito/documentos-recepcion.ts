/**
 * Documentos de una recepción subidos desde la app Depósito (E-38): varias hojas = UN documento,
 * cola sin señal, y lectura automática aparte.
 *
 *   1. GUARDAR (outbox `recepcion.documento`, lib/mobile/outbox/deposito.ts): sube las hojas al
 *      bucket y deja una fila "pendiente de leer". No llama a la lectura automática.
 *   2. LEER (POST /api/recepciones/[id]/ocr/leer): lee TODAS las hojas en una sola llamada y sigue
 *      el camino de siempre (duplicados, no leído, comprobante). Una sola vez por documento: la
 *      compuerta es `recepcion_documento_tomar_lectura` (migración 20261118d).
 *
 * Solo servidor.
 */
import { faltaLaFuncion } from "@/lib/utils/migracion-pendiente"
import { inferirTipoComprobante, processWithGemini } from "@/lib/services/ocr"
import { buscarComprobanteDuplicado, comprobanteDesdeOCR, datosNoLeido, mensajeDuplicado, motivoNoLeido } from "@/lib/services/documento-compra"

import { documentoCompleto, hojasDeDocumento, type EnvioDocumento } from "./documentos-reglas"

export * from "./documentos-reglas"

export const MIGRACION_DOCUMENTOS = "20261118d_recepciones_documentos_hojas.sql"
const BUCKET = "comprobantes"
const extensionDe = (h: { nombre?: string; mime?: string }) => {
  if (h.mime === "application/pdf") return "pdf"
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(h.nombre ?? ""))
  if (m) return m[1].toLowerCase()
  return h.mime === "image/png" ? "png" : h.mime === "image/webp" ? "webp" : "jpg"
}

export type ResultadoGuardar =
  | { ok: true; resultado: { documento_id: string; recepcion_id: string; hojas: number; completo: boolean; partes_recibidas: number; partes_esperadas: number; lectura_estado: string | null } }
  | { ok: false; mensaje: string; codigo: string }

/**
 * Sube las hojas de un envío y las deja en el documento. Idempotente: las rutas del bucket
 * dependen solo de (recepción, documento, parte, orden), así que repetir el envío pisa los mismos
 * archivos; la fila la resuelve `recepcion_documento_guardar_hojas`.
 * Lanza Error ante un problema transitorio (bucket, red, migración sin aplicar): el outbox reintenta.
 */
export async function guardarHojasDocumento(admin: any, recepcionId: string, p: EnvioDocumento): Promise<ResultadoGuardar> {
  const parte = p.parte ?? 0
  const partes = p.partes ?? 1
  const hojas: { path: string; nombre: string; mime: string; orden: number }[] = []
  for (let i = 0; i < p.hojas.length; i++) {
    const h = p.hojas[i]
    const path = `${recepcionId}/${p.documento_local_id}/p${parte}-${i}.${extensionDe(h)}`
    const { error } = await admin.storage.from(BUCKET).upload(path, Buffer.from(h.base64, "base64"), { contentType: h.mime, upsert: true })
    if (error) throw new Error(`No se pudo guardar la hoja ${i + 1} del documento: ${error.message}`)
    hojas.push({ path, nombre: String(h.nombre || `hoja-${i + 1}.${extensionDe(h)}`).slice(0, 120), mime: h.mime, orden: i })
  }

  let urlPrimera: string | null = null
  if (parte === 0) {
    const { data: firmada } = await admin.storage.from(BUCKET).createSignedUrl(hojas[0].path, 3600 * 24 * 7)
    urlPrimera = firmada?.signedUrl || null
  }

  const { data, error } = await admin.rpc("recepcion_documento_guardar_hojas", {
    p_recepcion_id: recepcionId,
    p_documento_local_id: p.documento_local_id,
    p_tipo_documento: p.tipo_documento,
    p_parte: parte,
    p_partes: partes,
    p_hojas: hojas,
    p_url_primera: urlPrimera,
  })
  if (error) {
    if (error.code === "P0001") return { ok: false, mensaje: error.message, codigo: typeof error.details === "string" ? error.details : "documento" }
    // Falta la migración: NO es un rechazo (se perdería la foto). Queda en la cola y sale sola al aplicarla.
    if (faltaLaFuncion(error, "recepcion_documento_guardar_hojas")) throw new Error(`Falta aplicar la migración ${MIGRACION_DOCUMENTOS}: el documento queda en la cola del equipo hasta entonces.`)
    throw new Error(`No se pudo registrar el documento: ${error.message}`)
  }
  return { ok: true, resultado: data }
}

/** Baja las hojas del bucket como archivos, en orden. Lanza si alguna no se puede abrir. */
export async function archivosDeDocumento(supabase: any, doc: any): Promise<File[]> {
  const archivos: File[] = []
  for (const h of hojasDeDocumento(doc)) {
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(h.path)
    if (error || !blob) throw new Error(`No se pudo abrir una hoja guardada del documento (${h.nombre}).`)
    archivos.push(new File([blob], h.nombre, { type: h.mime || blob.type || "application/octet-stream" }))
  }
  return archivos
}

export interface RespuestaLeer {
  status: number
  body: Record<string, unknown>
}

/**
 * Lee un documento ya subido: TODAS sus hojas en una sola lectura, y con eso el camino de siempre
 * (no leído → queda adjunto; factura repetida → se avisa; si no, comprobante de compra).
 *
 * IDEMPOTENTE: la compuerta `recepcion_documento_tomar_lectura` deja pasar una sola lectura a la
 * vez y ninguna si el documento ya tiene comprobante. Dos llamadas (doble toque, la app y la
 * oficina a la vez, un reintento por tiempo agotado) no crean dos comprobantes: la segunda
 * devuelve el documento como está.
 */
export async function leerDocumentoRecepcion(supabase: any, p: { recepcion_id: string; documento_id: string }): Promise<RespuestaLeer> {
  const traer = async () => (await supabase.from("recepciones_documentos").select("*").eq("id", p.documento_id).maybeSingle()).data
  const doc = await traer()
  if (!doc) return { status: 404, body: { error: "El documento ya no existe." } }
  if (doc.recepcion_id !== p.recepcion_id) return { status: 400, body: { error: "Ese documento no es de esta recepción." } }
  if (doc.comprobante_id || doc.procesado) return { status: 200, body: { success: true, ya_leido: true, document: doc } }
  if (!documentoCompleto(doc)) {
    return { status: 409, body: { error: "Todavía faltan subir hojas de este documento. Esperá a que la app termine de enviarlas.", codigo: "faltan_hojas", document: doc } }
  }
  if (hojasDeDocumento(doc).length === 0) return { status: 409, body: { error: "No quedó guardado el archivo de este documento: subilo de nuevo.", codigo: "sin_archivo" } }

  // Foto de respaldo: se guarda, no se lee ni genera comprobante
  if (doc.tipo_documento === "foto") {
    const { data: act } = await supabase.from("recepciones_documentos").update({ lectura_estado: "leido", procesado: true }).eq("id", doc.id).is("comprobante_id", null).select().maybeSingle()
    return { status: 200, body: { success: true, adjunto: true, document: act ?? doc } }
  }

  // ── Compuerta: una sola lectura por documento ──
  const { data: tomada, error: errTomar } = await supabase.rpc("recepcion_documento_tomar_lectura", { p_documento_id: doc.id })
  if (errTomar) {
    if (faltaLaFuncion(errTomar, "recepcion_documento_tomar_lectura")) return { status: 503, body: { error: `Falta aplicar la migración ${MIGRACION_DOCUMENTOS}.`, codigo: "migracion_pendiente" } }
    throw errTomar
  }
  if (!tomada) {
    const actual = await traer()
    return { status: 200, body: { success: true, ya_leido: !!(actual?.comprobante_id || actual?.procesado), en_curso: actual?.lectura_estado === "leyendo", document: actual ?? doc } }
  }

  const soltar = async (estado: "pendiente" | "no_leido" | "duplicado" | "leido", cambios: Record<string, unknown> = {}) =>
    (await supabase.from("recepciones_documentos").update({ lectura_estado: estado, ...cambios }).eq("id", doc.id).select().maybeSingle()).data

  try {
    const { data: recepcion } = await supabase.from("recepciones").select("id, orden_compra_id, proveedor_id").eq("id", p.recepcion_id).maybeSingle()
    const ordenCompraId: string | null = recepcion?.orden_compra_id ?? null
    let proveedorId: string | null = recepcion?.proveedor_id ?? null
    if (!proveedorId && ordenCompraId) {
      const { data: oc } = await supabase.from("ordenes_compra").select("proveedor_id").eq("id", ordenCompraId).maybeSingle()
      if (oc?.proveedor_id) {
        proveedorId = oc.proveedor_id
        await supabase.from("recepciones").update({ proveedor_id: proveedorId }).eq("id", p.recepcion_id)
      }
    }
    let proveedorNombre: string | undefined
    if (proveedorId) {
      const { data: prv } = await supabase.from("proveedores").select("nombre").eq("id", proveedorId).maybeSingle()
      proveedorNombre = prv?.nombre || undefined
    }

    const archivos = await archivosDeDocumento(supabase, doc)
    const ocr = await processWithGemini(archivos, { proveedorNombre, tipoDocumento: doc.tipo_documento })
    const noLeido = motivoNoLeido(ocr)
    if (noLeido) {
      const act = await soltar("no_leido", { datos_ocr: datosNoLeido(ocr, noLeido), procesado: false })
      return {
        status: 200,
        body: {
          success: true, document: act ?? doc, comprobante: null, no_leido: true, motivo: noLeido,
          aviso: "No se pudo leer el documento. Quedó adjunto pero NO generó comprobante: sacalo de nuevo (derecho, con luz, la hoja entera) o avisá a la oficina para que lo cargue a mano.",
        },
      }
    }

    // ¿Esa factura del proveedor ya está cargada (en esta orden o en otra)? Se avisa; no se crea otra.
    if (ordenCompraId && proveedorId && ocr.comprobante?.numero_comprobante) {
      const dup = await buscarComprobanteDuplicado(supabase, {
        proveedor_id: proveedorId,
        tipo: inferirTipoComprobante(ocr, doc.tipo_documento),
        numero: ocr.comprobante.numero_comprobante,
      })
      if (dup) {
        const mensaje = mensajeDuplicado(dup, ordenCompraId)
        const act = await soltar("duplicado", { datos_ocr: { ...ocr, duplicado: true, motivo: mensaje }, procesado: false })
        return { status: 409, body: { error: mensaje, codigo: "comprobante_duplicado", comprobante_id: dup.id, document: act ?? doc } }
      }
    }

    let comprobante: any = null
    let aviso: string | undefined
    if (ordenCompraId && proveedorId) {
      const r = await comprobanteDesdeOCR(supabase, {
        orden_compra_id: ordenCompraId, proveedor_id: proveedorId, recepcion_id: p.recepcion_id,
        documento_id: doc.id, ocr, tipo_documento: doc.tipo_documento, foto_url: doc.url_imagen,
      })
      comprobante = r.comprobante
      if (r.error) {
        // Se leyó pero el comprobante no se creó: queda para volver a leer, no "procesado" a medias
        const act = await soltar("no_leido", { datos_ocr: { ...ocr, no_leido: true, motivo: `La lectura salió bien pero no se pudo crear el comprobante: ${r.error}` }, procesado: false })
        return { status: 200, body: { success: true, document: act ?? doc, comprobante: null, no_leido: true, aviso: `El documento se leyó pero no se pudo crear el comprobante (${r.error}). Avisá a la oficina.` } }
      }
      if (r.sumado_a_provisorio) aviso = "No se leyó el número del comprobante: los renglones se sumaron al comprobante provisorio de esta orden. La oficina tiene que completarle el número."
      else if (r.otro_provisorio) aviso = "No se leyó el número del comprobante y ya había otro sin número en esta orden: se cargó como un comprobante aparte. La oficina tiene que completarles el número."
      else if (!ocr.comprobante?.numero_comprobante) aviso = "No se leyó el número del comprobante: quedó como provisorio. La oficina tiene que completarle el número."
      if (r.avisos?.length) aviso = [aviso, ...r.avisos].filter(Boolean).join(" ")
    }

    const act = await soltar("leido", { datos_ocr: ocr, procesado: true })
    return { status: 200, body: { success: true, document: act ?? doc, comprobante, ...(aviso ? { aviso } : {}) } }
  } catch (e) {
    // Cualquier falla deja el documento como estaba: se puede volver a leer
    await soltar("pendiente").catch(() => null)
    throw e
  }
}
