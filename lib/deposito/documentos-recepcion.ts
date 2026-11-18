/**
 * Documentos de una recepción subidos desde la app Depósito (E-38): varias hojas = UN documento,
 * cola sin señal, y lectura automática aparte.
 *
 *   1. GUARDAR (outbox `recepcion.documento`, lib/mobile/outbox/deposito.ts): sube las hojas al
 *      bucket y deja una fila "pendiente de leer". No llama a la lectura automática.
 *   2. LEER (POST /api/recepciones/[id]/ocr/leer): lee TODAS las hojas en una sola lectura (o en
 *      tandas si pesan más de lo que acepta el lector) y sigue el camino de siempre (duplicados,
 *      no leído, comprobante). Una sola vez por documento: la compuerta es
 *      `recepcion_documento_tomar_lectura` (migración 20261118d). TODO O NADA: una lectura que se
 *      cortó a medias se limpia antes de leer de nuevo.
 *
 * Las fotos NO se guardan con una dirección firmada (vencía a los 7 días): se guarda la RUTA del
 * bucket y se firma al mostrar (firmarDocumentosRecepcion, cargar-verificacion).
 *
 * Solo servidor.
 */
import { faltaLaColumna, faltaLaFuncion } from "@/lib/utils/migracion-pendiente"
import { inferirTipoComprobante, processWithGemini, type ParseResult } from "@/lib/services/ocr"
import { revertirComprobanteOCR } from "@/lib/services/detalle"
import { buscarComprobanteDuplicado, comprobanteDesdeOCR, datosNoLeido, mensajeDuplicado, motivoNoLeido } from "@/lib/services/documento-compra"

import { documentoCompleto, hojasDeDocumento, motivoParaOperario, tandasDeLectura, unirLecturas, type EnvioDocumento } from "./documentos-reglas"

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

/** Lo que se le dice al operario si el servidor todavía no tiene la migración de documentos. */
export const MENSAJE_FALTA_ACTUALIZAR = "Falta actualizar el sistema para recibir documentos desde la app: avisá a la oficina. Las hojas quedaron en el equipo."

/** La ruta del bucket, escrita de forma que todo lo que firma al mostrar la reconoce (no es una dirección para abrir). */
export const rutaComoReferencia = (path: string) => `/${BUCKET}/${path}`

/**
 * ¿En qué recepción va este documento? Se pregunta ANTES de subir nada:
 *   · si falta la migración ⇒ rechazo claro (no se sube ni se reintenta cada vez con todas las hojas);
 *   · si el documento ya existe (llegó otra de sus partes) ⇒ su recepción, aunque después se haya
 *     abierto otra tanda de la orden: todas las partes van juntas.
 * null = documento nuevo (va a la recepción vigente).
 */
export async function recepcionDeDocumento(admin: any, documentoLocalId: string, ordenCompraId: string): Promise<{ ok: true; recepcion_id: string | null } | { ok: false; mensaje: string; codigo: string }> {
  const { data, error } = await admin.from("recepciones_documentos").select("id, recepcion_id").eq("documento_local_id", documentoLocalId).maybeSingle()
  if (error) {
    if (faltaLaColumna(error)) return { ok: false, mensaje: MENSAJE_FALTA_ACTUALIZAR, codigo: "migracion_pendiente" }
    throw new Error(`No se pudo consultar el documento: ${error.message}`)
  }
  if (!data?.recepcion_id) return { ok: true, recepcion_id: null }
  const { data: rec } = await admin.from("recepciones").select("id, orden_compra_id").eq("id", data.recepcion_id).maybeSingle()
  if (rec && rec.orden_compra_id !== ordenCompraId) return { ok: false, mensaje: "Ese documento ya se subió en otra orden de compra.", codigo: "otra_recepcion" }
  return { ok: true, recepcion_id: data.recepcion_id }
}

/**
 * Sube las hojas de un envío y las deja en el documento. Idempotente: las rutas del bucket
 * dependen solo de (recepción, documento, parte, orden), así que repetir el envío pisa los mismos
 * archivos; la fila la resuelve `recepcion_documento_guardar_hojas`.
 * Lanza Error ante un problema transitorio (bucket, red): el outbox reintenta. Si la base RECHAZA
 * el envío, lo que se subió en este intento se borra del bucket (no quedan hojas huérfanas).
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

  const { data, error } = await admin.rpc("recepcion_documento_guardar_hojas", {
    p_recepcion_id: recepcionId,
    p_documento_local_id: p.documento_local_id,
    p_tipo_documento: p.tipo_documento,
    p_parte: parte,
    p_partes: partes,
    p_hojas: hojas,
    // la RUTA, no una dirección firmada: se firma al mostrar
    p_url_primera: parte === 0 ? rutaComoReferencia(hojas[0].path) : null,
  })
  if (error) {
    const definitivo = error.code === "P0001" || faltaLaFuncion(error, "recepcion_documento_guardar_hojas")
    if (definitivo) {
      // Rechazo: lo subido en este intento no queda huérfano en el bucket
      await admin.storage.from(BUCKET).remove(hojas.map((h) => h.path)).catch(() => null)
      if (error.code === "P0001") return { ok: false, mensaje: error.message, codigo: typeof error.details === "string" ? error.details : "documento" }
      return { ok: false, mensaje: MENSAJE_FALTA_ACTUALIZAR, codigo: "migracion_pendiente" }
    }
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
 * Lee las hojas de un documento. Casi siempre es UNA lectura con todas las hojas; si pesan más de
 * lo que acepta el lector (TOPE_BYTES_POR_LECTURA) se leen en tandas y se unen los renglones.
 * Nunca lanza: un error del lector vuelve como `error` (el documento queda "no leído").
 */
export async function leerHojas(archivos: File[], contexto: { proveedorNombre?: string; tipoDocumento?: string }): Promise<ParseResult> {
  const tandas = tandasDeLectura(archivos.map((a) => a.size))
  const lecturas: ParseResult[] = []
  for (const tanda of tandas) {
    let lectura: ParseResult
    try {
      lectura = await processWithGemini(tanda.map((i) => archivos[i]), contexto)
    } catch (e: any) {
      lectura = { items: [], error: String(e?.message || e) }
    }
    lecturas.push(lectura)
    if (lectura.error) break // todo o nada: con una tanda sin leer el comprobante no sirve
  }
  return unirLecturas(lecturas)
}

/**
 * Deshace lo que dejó una lectura que se cortó a medias (comprobante vinculado, renglones
 * incompletos), para poder leer de nuevo desde cero. No toca nada si el comprobante lo comparte
 * otro documento (provisorio al que se le sumaron hojas) o si ya está validado: ahí lo tiene que
 * mirar la oficina.
 */
async function limpiarLecturaAMedias(supabase: any, doc: { id: string; comprobante_id?: string | null }): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const comprobanteId = doc.comprobante_id
  if (!comprobanteId) return { ok: true }
  const { count, error } = await supabase.from("recepciones_documentos").select("id", { count: "exact", head: true }).eq("comprobante_id", comprobanteId).neq("id", doc.id)
  if (error) return { ok: false, motivo: error.message }
  if ((count ?? 0) > 0) return { ok: false, motivo: "el comprobante lo comparte otro documento de la orden" }
  // Primero se desvincula (el borrado del comprobante no puede quedar trabado por el documento)
  await supabase.from("recepciones_documentos").update({ comprobante_id: null }).eq("id", doc.id)
  const r = await revertirComprobanteOCR(supabase, comprobanteId)
  if (r.error) {
    await supabase.from("recepciones_documentos").update({ comprobante_id: comprobanteId }).eq("id", doc.id)
    return { ok: false, motivo: r.error }
  }
  return { ok: true }
}

/**
 * Lee un documento ya subido: TODAS sus hojas, y con eso el camino de siempre (no leído → queda
 * adjunto; factura repetida → se avisa; si no, comprobante de compra).
 *
 * IDEMPOTENTE: la compuerta `recepcion_documento_tomar_lectura` deja pasar una sola lectura a la
 * vez y ninguna si el documento ya quedó leído. Dos llamadas (doble toque, la app y la oficina a
 * la vez, un reintento por tiempo agotado) no crean dos comprobantes: la segunda devuelve el
 * documento como está.
 *
 * TODO O NADA: el documento queda "leido" recién cuando el comprobante tiene todos sus renglones.
 * Si la lectura se corta antes (error, o el servidor la corta por tiempo), lo que haya quedado a
 * medias se deshace: acá mismo si se llega, o en la lectura siguiente (la compuerta deja retomar
 * un documento "leyendo" de hace más de 6 minutos).
 * Límite conocido: si el corte cae DENTRO de la carga de renglones (lib/services/detalle.ts suma
 * lo documentado renglón por renglón y guarda el detalle al final), las cantidades ya sumadas a la
 * recepción no tienen renglón que las respalde y no se pueden restar solas. Cerrarlo del todo
 * necesita que esa carga sea una sola transacción en la base.
 */
export async function leerDocumentoRecepcion(supabase: any, p: { recepcion_id: string; documento_id: string }): Promise<RespuestaLeer> {
  const traer = async () => (await supabase.from("recepciones_documentos").select("*").eq("id", p.documento_id).maybeSingle()).data
  const yaLeido = (d: any) => !!d && (!!d.procesado || d.lectura_estado === "leido" || (d.lectura_estado == null && !!d.comprobante_id))
  const doc = await traer()
  if (!doc) return { status: 404, body: { error: "El documento ya no existe." } }
  if (doc.recepcion_id !== p.recepcion_id) return { status: 400, body: { error: "Ese documento no es de esta recepción." } }
  if (yaLeido(doc)) return { status: 200, body: { success: true, ya_leido: true, document: doc } }
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
    if (faltaLaFuncion(errTomar, "recepcion_documento_tomar_lectura")) return { status: 503, body: { error: MENSAJE_FALTA_ACTUALIZAR, codigo: "migracion_pendiente", detalle_tecnico: `Falta aplicar la migración ${MIGRACION_DOCUMENTOS}.` } }
    throw errTomar
  }
  if (!tomada) {
    const actual = await traer()
    return { status: 200, body: { success: true, ya_leido: yaLeido(actual), en_curso: actual?.lectura_estado === "leyendo", document: actual ?? doc } }
  }

  const soltar = async (estado: "pendiente" | "no_leido" | "duplicado" | "leido", cambios: Record<string, unknown> = {}) =>
    (await supabase.from("recepciones_documentos").update({ lectura_estado: estado, ...cambios }).eq("id", doc.id).select().maybeSingle()).data
  const noLeido = async (tecnico: string, datos: Record<string, unknown>, aviso: string): Promise<RespuestaLeer> => {
    const motivo = motivoParaOperario(tecnico)
    // `motivo` = detalle técnico (lo que usa la verificación de la oficina); `motivo_operario` = lo que ve depósito
    const act = await soltar("no_leido", { datos_ocr: { ...datos, items: (datos as any).items || [], no_leido: true, motivo: tecnico, motivo_operario: motivo }, procesado: false })
    return { status: 200, body: { success: true, document: act ?? doc, comprobante: null, no_leido: true, motivo, detalle_tecnico: tecnico, aviso } }
  }

  try {
    // ¿Quedó algo a medias de una lectura anterior que se cortó? Se deshace antes de leer de nuevo.
    const tomado = (await traer()) ?? doc
    if (tomado.comprobante_id) {
      const limpio = await limpiarLecturaAMedias(supabase, tomado)
      if (!limpio.ok) {
        const tecnico = `La lectura anterior quedó a medias y no se pudo deshacer sola: ${limpio.motivo}`
        const act = await soltar("no_leido", { datos_ocr: { items: [], no_leido: true, motivo: tecnico, motivo_operario: "La lectura de este documento quedó a medias. Avisá a la oficina para que revise el comprobante." }, procesado: false })
        return { status: 200, body: { success: true, document: act ?? doc, comprobante: null, no_leido: true, motivo: "La lectura de este documento quedó a medias. Avisá a la oficina para que revise el comprobante.", detalle_tecnico: tecnico, aviso: "La lectura de este documento quedó a medias. Avisá a la oficina para que revise el comprobante." } }
      }
    }

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
    const ocr = await leerHojas(archivos, { proveedorNombre, tipoDocumento: doc.tipo_documento })
    const tecnicoNoLeido = motivoNoLeido(ocr)
    if (tecnicoNoLeido) {
      return noLeido(tecnicoNoLeido, datosNoLeido(ocr, tecnicoNoLeido),
        "No se pudo leer el documento. Quedó adjunto pero NO generó comprobante: sacalo de nuevo (derecho, con luz, la hoja entera) o avisá a la oficina para que lo cargue a mano.")
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
        documento_id: doc.id, ocr, tipo_documento: doc.tipo_documento,
        // la ruta del bucket (no una dirección firmada, que vence): se firma al mostrar
        foto_url: doc.storage_path ? rutaComoReferencia(doc.storage_path) : doc.url_imagen,
      })
      comprobante = r.comprobante
      if (r.error) {
        // Se leyó pero el comprobante no se creó: queda para volver a leer, no "procesado" a medias
        return noLeido(`La lectura salió bien pero no se pudo crear el comprobante: ${r.error}`, { ...ocr },
          "El documento se leyó pero no se pudo crear el comprobante. Avisá a la oficina.")
      }
      if (r.sumado_a_provisorio) aviso = "No se leyó el número del comprobante: los renglones se sumaron al comprobante provisorio de esta orden. La oficina tiene que completarle el número."
      else if (r.otro_provisorio) aviso = "No se leyó el número del comprobante y ya había otro sin número en esta orden: se cargó como un comprobante aparte. La oficina tiene que completarles el número."
      else if (!ocr.comprobante?.numero_comprobante) aviso = "No se leyó el número del comprobante: quedó como provisorio. La oficina tiene que completarle el número."
      if (r.avisos?.length) aviso = [aviso, ...r.avisos].filter(Boolean).join(" ")
    }

    // Recién acá el documento queda "leido": el comprobante ya tiene todos sus renglones
    const act = await soltar("leido", { datos_ocr: ocr, procesado: true })
    return { status: 200, body: { success: true, document: act ?? doc, comprobante, ...(aviso ? { aviso } : {}) } }
  } catch (e) {
    // Todo o nada: lo que haya quedado a medias se deshace y el documento vuelve a "pendiente".
    // Si no se pudo deshacer acá, queda vinculado y lo deshace la lectura siguiente.
    try {
      const fresco = await traer()
      if (fresco?.comprobante_id && !yaLeido(fresco)) await limpiarLecturaAMedias(supabase, fresco)
    } catch { /* se intenta de nuevo al releer */ }
    await soltar("pendiente").catch(() => null)
    throw e
  }
}
