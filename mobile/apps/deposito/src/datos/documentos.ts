// Documentos de una recepción (fotos de remito / factura, PDF): reglas puras de qué se puede
// subir y de cómo contarle al operario lo que leyó el sistema. Sin red ni pantalla (test:
// packages/core/test/entrada-recepcion-app.test.ts).

import { numero, parseMonto } from "@gm/formato"

/** Vercel corta el pedido en 4,5 MB: con margen para el resto del formulario. */
export const LIMITE_SUBIDA_BYTES = 4 * 1024 * 1024

export interface DocumentoRecepcion {
  id: string
  tipo_documento?: string
  url_imagen?: string | null
  nombre_archivo?: string | null
  tipo_mime?: string | null
  procesado?: boolean
  comprobante_id?: string | null
  /** Hojas del documento, en orden (documentos subidos por la cola de la app) */
  hojas?: { path?: string; nombre?: string; mime?: string; parte?: number; orden?: number }[] | null
  partes_esperadas?: number | null
  /** pendiente (subido, falta leer) | leyendo | leido | no_leido | duplicado · null = documento de antes */
  lectura_estado?: string | null
  /** no_leido: la lectura automática falló o no encontró renglones (queda adjunto, sin comprobante). E-37 */
  datos_ocr?: {
    comprobante?: { numero_comprobante?: string | null; tipo_comprobante?: string | null; total_factura?: number | string | null } | null
    items?: unknown[] | null
    no_leido?: boolean
    /** Esa factura del proveedor ya estaba cargada: el motivo es el mensaje para mostrar tal cual */
    duplicado?: boolean
    motivo?: string | null
  } | null
}

const TIPOS: Record<string, string> = {
  FA: "Factura A", FB: "Factura B", FC: "Factura C", REMITO: "Remito", ADQUISICION: "Adquisición",
  NC: "Nota de crédito", NCA: "Nota de crédito A", NCB: "Nota de crédito B", NCC: "Nota de crédito C",
  ND: "Nota de débito", NDA: "Nota de débito A", NDB: "Nota de débito B", NDC: "Nota de débito C", REVERSA: "Reversa",
}

/** "FA" → "Factura A". Lo que no se conoce se muestra como vino. */
export function nombreTipoComprobante(tipo: string | null | undefined): string | null {
  const t = String(tipo ?? "").trim()
  if (!t) return null
  return TIPOS[t.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")] ?? t
}

/**
 * Por qué no se pudo leer, en castellano. El servidor a veces devuelve el error crudo del
 * lector (en inglés): al operario se le dice qué hacer, no el error técnico.
 */
export function motivoNoLeido(motivo: string | null | undefined): string {
  const m = String(motivo ?? "").toLowerCase()
  if (/sin renglones|no.*rengl|no items|empty|vac[ií]/.test(m)) return "No se encontraron renglones en la foto. Sacala de nuevo, de frente, con buena luz y que entre toda la hoja."
  if (/quota|credit|402|429|billing|saldo/.test(m)) return "El lector automático no está disponible en este momento. La foto quedó adjunta: la oficina carga el comprobante a mano."
  if (/timeout|timed out|deadline|504|503|network|fetch/.test(m)) return "El lector tardó demasiado. La foto quedó adjunta: probá leerla de nuevo más tarde o avisá a la oficina."
  return "No se pudo leer el documento. Quedó adjunto: la oficina lo carga a mano. Si la foto salió movida u oscura, sacala de nuevo."
}

export interface LecturaDocumento {
  /**
   * leido = el sistema armó el comprobante · no_leido = quedó adjunto sin leer ·
   * adjunto = foto de respaldo (no se lee) · pendiente = subido, todavía no se leyó ·
   * incompleto = faltan llegar hojas · duplicado = esa factura ya estaba cargada
   */
  estado: "leido" | "no_leido" | "adjunto" | "pendiente" | "incompleto" | "duplicado"
  tipo: string | null
  numero: string | null
  total: number | null
  renglones: number
  /** Explicación para el operario cuando no se leyó */
  motivo: string | null
}

const aNumero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : parseMonto(String(v))
  return n != null && Number.isFinite(n) ? n : null
}

/** Lo que el sistema leyó de un documento, listo para mostrar. */
export function lecturaDeDocumento(doc: DocumentoRecepcion): LecturaDocumento {
  const d = doc.datos_ocr
  const renglones = Array.isArray(d?.items) ? d!.items!.length : 0
  const c = d?.comprobante
  const base = { tipo: nombreTipoComprobante(c?.tipo_comprobante), numero: c?.numero_comprobante ? String(c.numero_comprobante) : null, total: aNumero(c?.total_factura), renglones }
  // Documentos subidos por la cola: el estado de lectura lo dice el servidor
  if (!doc.procesado && !doc.comprobante_id) {
    if (doc.lectura_estado === "duplicado" || d?.duplicado) return { ...base, estado: "duplicado", motivo: d?.motivo ? String(d.motivo) : "Ese comprobante ya estaba cargado." }
    if (doc.lectura_estado === "pendiente" || doc.lectura_estado === "leyendo") {
      return documentoCompleto(doc)
        ? { ...base, estado: "pendiente", motivo: null }
        : { ...base, estado: "incompleto", motivo: "Todavía están llegando hojas de este documento." }
    }
  }
  if (doc.tipo_documento === "foto" && doc.procesado && !doc.comprobante_id && renglones === 0) return { ...base, estado: "adjunto", motivo: null }
  if (d?.no_leido || (!doc.procesado && d && renglones === 0 && !c?.numero_comprobante)) {
    return { ...base, estado: "no_leido", motivo: motivoNoLeido(d?.motivo) }
  }
  if (doc.procesado && (renglones > 0 || base.numero || base.total != null)) return { ...base, estado: "leido", motivo: null }
  return { ...base, estado: "adjunto", motivo: null }
}

export type ArchivoRechazado = { ok: false; motivo: string }
export type ArchivoAceptado = { ok: true; esImagen: boolean; esPdf: boolean }

/** ¿Este archivo se puede subir como documento? Imágenes (se comprimen) y PDF. */
export function revisarArchivo(a: { type?: string | null; name?: string | null; size: number }): ArchivoAceptado | ArchivoRechazado {
  const tipo = String(a.type ?? "").toLowerCase()
  const nombre = String(a.name ?? "").toLowerCase()
  const esPdf = tipo === "application/pdf" || nombre.endsWith(".pdf")
  const esImagen = tipo.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/.test(nombre)
  if (!esPdf && !esImagen) return { ok: false, motivo: "Ese archivo no sirve: tiene que ser una foto o un PDF." }
  if (a.size <= 0) return { ok: false, motivo: "El archivo está vacío." }
  // Las fotos se achican antes de subir; un PDF viaja como está
  if (esPdf && a.size > LIMITE_SUBIDA_BYTES) {
    return { ok: false, motivo: `El PDF pesa ${megas(a.size)} y el máximo es ${megas(LIMITE_SUBIDA_BYTES)}. Sacale fotos a las hojas en vez de subir el PDF.` }
  }
  return { ok: true, esImagen: esImagen && !esPdf, esPdf }
}

/** "3,2 MB" */
export function megas(bytes: number): string {
  return `${numero(bytes / (1024 * 1024), 0, 1)} MB`
}

// ─── Varias hojas = un documento, y envío por partes (E-38) ──────────────────

/** Tope de un envío del outbox, en caracteres de base64 (~2,2 MB de archivo): Vercel corta el pedido en 4,5 MB. */
export const LIMITE_BASE64_ENVIO = 3_000_000
export const MAX_HOJAS_DOCUMENTO = 30

export interface HojaLocal {
  /** id local de la hoja (para la lista en pantalla) */
  id: string
  nombre: string
  mime: string
  base64: string
}

export interface EnvioDocumento {
  orden_compra_id: string
  documento_local_id: string
  tipo_documento: string
  parte: number
  partes: number
  hojas: { nombre: string; mime: string; base64: string }[]
}

/** ¿Llegaron al servidor todos los envíos del documento? */
export function documentoCompleto(doc: Pick<DocumentoRecepcion, "hojas" | "partes_esperadas">): boolean {
  if (!Array.isArray(doc.hojas)) return true // documento de antes: una sola hoja
  const recibidas = new Set(doc.hojas.map((h) => Number(h?.parte) || 0)).size
  return recibidas >= Math.max(1, Number(doc.partes_esperadas) || 1)
}

export type Reparto = { ok: true; grupos: HojaLocal[][] } | { ok: false; motivo: string }

/**
 * Reparte las hojas de UN documento en los envíos que hagan falta para que ninguno pase el
 * tope. Mantiene el orden. Todas las partes son del MISMO documento (un solo comprobante).
 * Una hoja sola que pasa el tope no se puede enviar.
 */
export function repartirEnEnvios(hojas: HojaLocal[], limite = LIMITE_BASE64_ENVIO): Reparto {
  if (hojas.length === 0) return { ok: false, motivo: "El documento no tiene hojas." }
  if (hojas.length > MAX_HOJAS_DOCUMENTO) return { ok: false, motivo: `Son demasiadas hojas (máximo ${MAX_HOJAS_DOCUMENTO}). Subilas en dos documentos.` }
  const grupos: HojaLocal[][] = []
  let actual: HojaLocal[] = []
  let peso = 0
  for (let i = 0; i < hojas.length; i++) {
    const h = hojas[i]!
    if (h.base64.length > limite) return { ok: false, motivo: `La hoja ${i + 1} pesa demasiado para enviarse. Sacala de nuevo${h.mime === "application/pdf" ? " como foto" : ""}.` }
    if (actual.length > 0 && peso + h.base64.length > limite) { grupos.push(actual); actual = []; peso = 0 }
    actual.push(h)
    peso += h.base64.length
  }
  grupos.push(actual)
  return { ok: true, grupos }
}

/** Los envíos del outbox de un documento (uno por grupo de hojas). */
export function enviosDeDocumento(p: { orden_compra_id: string; documento_local_id: string; tipo_documento: string; grupos: HojaLocal[][] }): EnvioDocumento[] {
  return p.grupos.map((g, parte) => ({
    orden_compra_id: p.orden_compra_id, documento_local_id: p.documento_local_id, tipo_documento: p.tipo_documento,
    parte, partes: p.grupos.length,
    hojas: g.map((h) => ({ nombre: h.nombre, mime: h.mime, base64: h.base64 })),
  }))
}

export interface DocumentoEnCola {
  documento_local_id: string
  tipo_documento: string
  hojas: number
  partes: number
  /** enviando | pendiente | rechazado */
  estado: "enviando" | "pendiente" | "rechazado"
  error: string | null
  /** claves del outbox de las partes que todavía no salieron */
  claves: string[]
}

/** Documentos de una orden que todavía están en la cola del equipo, agrupados (uno por documento). */
export function documentosEnCola(ops: { key: string; tipo: string; estado: string; error?: string | null; payload: unknown }[], ordenId: string): DocumentoEnCola[] {
  const porDoc = new Map<string, DocumentoEnCola>()
  for (const op of ops) {
    if (op.tipo !== "recepcion.documento") continue
    const p = op.payload as Partial<EnvioDocumento> | null
    if (!p || p.orden_compra_id !== ordenId || !p.documento_local_id) continue
    const d = porDoc.get(p.documento_local_id) ?? { documento_local_id: p.documento_local_id, tipo_documento: String(p.tipo_documento || "documento"), hojas: 0, partes: Number(p.partes) || 1, estado: "pendiente" as const, error: null, claves: [] }
    d.hojas += Array.isArray(p.hojas) ? p.hojas.length : 0
    d.claves.push(op.key)
    if (op.estado === "rechazado") { d.estado = "rechazado"; d.error = op.error ?? d.error }
    else if (op.estado === "enviando" && d.estado !== "rechazado") d.estado = "enviando"
    porDoc.set(p.documento_local_id, d)
  }
  return [...porDoc.values()]
}
