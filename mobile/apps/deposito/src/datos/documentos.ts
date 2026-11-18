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
  /** no_leido: la lectura automática falló o no encontró renglones (queda adjunto, sin comprobante). E-37 */
  datos_ocr?: {
    comprobante?: { numero_comprobante?: string | null; tipo_comprobante?: string | null; total_factura?: number | string | null } | null
    items?: unknown[] | null
    no_leido?: boolean
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
  /** leido = el sistema armó el comprobante · no_leido = quedó adjunto sin leer · adjunto = foto sin lectura (tipo "foto") */
  estado: "leido" | "no_leido" | "adjunto"
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
