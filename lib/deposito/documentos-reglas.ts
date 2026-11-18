/**
 * Documentos de una recepción subidos desde la app Depósito (E-38): reglas PURAS, sin base ni red
 * (las usan el servidor y los tests: mobile/packages/core/test/entrada-recepcion-app.test.ts).
 * Lo que guarda y lee está en lib/deposito/documentos-recepcion.ts.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Lo que entra en un envío del outbox (el pedido completo no puede pasar los 4,5 MB de Vercel). */
export const LIMITE_BASE64_POR_ENVIO = 3_700_000
export const MAX_HOJAS_POR_ENVIO = 12
export const MAX_PARTES = 10
/** Tipos que la app puede mandar. "foto" es una foto de respaldo: se guarda y NO se lee. */
export const TIPOS_DOCUMENTO_APP = ["remito", "factura", "foto"] as const

export interface HojaEnvio { nombre: string; mime: string; base64: string }
export interface EnvioDocumento {
  orden_compra_id: string
  /** UUID que genera el equipo: identifica al documento entre reintentos y entre partes */
  documento_local_id: string
  tipo_documento: string
  /** 0..partes-1 (un documento con muchas hojas viaja en varios envíos) */
  parte?: number
  partes?: number
  hojas: HojaEnvio[]
}

const mimeValido = (m: unknown) => typeof m === "string" && (m.startsWith("image/") || m === "application/pdf")

/** Validación de forma del envío. string = rechazo definitivo (lo ve el operario). Función pura. */
export function validarEnvioDocumento(p: EnvioDocumento | null | undefined): string | null {
  if (!p || !UUID.test(String(p.orden_compra_id ?? ""))) return "Orden inválida"
  if (!UUID.test(String(p.documento_local_id ?? ""))) return "Documento sin identificador"
  if (!(TIPOS_DOCUMENTO_APP as readonly string[]).includes(p.tipo_documento)) return "Tipo de documento inválido"
  const partes = p.partes ?? 1
  const parte = p.parte ?? 0
  if (!Number.isInteger(partes) || partes < 1 || partes > MAX_PARTES) return "Cantidad de envíos inválida"
  if (!Number.isInteger(parte) || parte < 0 || parte >= partes) return "Número de envío inválido"
  if (!Array.isArray(p.hojas) || p.hojas.length === 0) return "El documento no tiene hojas"
  if (p.hojas.length > MAX_HOJAS_POR_ENVIO) return `Son demasiadas hojas en un envío (máximo ${MAX_HOJAS_POR_ENVIO})`
  let total = 0
  for (const h of p.hojas) {
    if (!h || typeof h.base64 !== "string" || h.base64.length === 0) return "Hay una hoja vacía"
    if (!mimeValido(h.mime)) return "Hay una hoja que no es una foto ni un PDF"
    total += h.base64.length
  }
  if (total > LIMITE_BASE64_POR_ENVIO) return "El documento pesa demasiado para un solo envío: actualizá la app (lo parte sola)"
  return null
}

/** Las hojas de un documento, en orden (documentos de antes: una sola, la de storage_path). */
export function hojasDeDocumento(doc: any): { path: string; nombre: string; mime: string }[] {
  const lista: any[] = Array.isArray(doc?.hojas) ? doc.hojas : []
  const hojas = lista
    .filter((h) => h && typeof h.path === "string" && h.path)
    .sort((a, b) => (Number(a.parte) || 0) - (Number(b.parte) || 0) || (Number(a.orden) || 0) - (Number(b.orden) || 0))
    .map((h) => ({ path: h.path as string, nombre: String(h.nombre || "hoja"), mime: String(h.mime || "image/jpeg") }))
  if (hojas.length > 0) return hojas
  return doc?.storage_path ? [{ path: doc.storage_path, nombre: doc.nombre_archivo || "documento", mime: doc.tipo_mime || "image/jpeg" }] : []
}

/** ¿Llegaron todos los envíos del documento? (función pura) */
export function documentoCompleto(doc: any): boolean {
  const esperadas = Math.max(1, Number(doc?.partes_esperadas) || 1)
  const recibidas = new Set((Array.isArray(doc?.hojas) ? doc.hojas : []).map((h: any) => Number(h?.parte) || 0)).size
  return Array.isArray(doc?.hojas) ? recibidas >= esperadas : !!doc?.storage_path
}

// ─── Lectura: tope de peso, tandas de hojas y motivo para el operario ────────

/**
 * El lector recibe las hojas dentro del pedido y tiene un tope (~20 MB con todo): por encima
 * devuelve un error. 12 MB de archivos son ~16 MB ya codificados, con margen para el resto.
 */
export const TOPE_BYTES_POR_LECTURA = 12 * 1024 * 1024

/**
 * Reparte las hojas (por su peso, en orden) en tandas que entran en una lectura. Casi siempre es
 * una sola. Devuelve los índices de cada tanda. Una hoja que sola pasa el tope va sola (la lectura
 * dirá si la pudo leer). Función pura.
 */
export function tandasDeLectura(pesos: number[], tope: number = TOPE_BYTES_POR_LECTURA): number[][] {
  const tandas: number[][] = []
  let actual: number[] = []
  let suma = 0
  pesos.forEach((peso, i) => {
    const p = Math.max(0, Number(peso) || 0)
    if (actual.length > 0 && suma + p > tope) { tandas.push(actual); actual = []; suma = 0 }
    actual.push(i)
    suma += p
  })
  if (actual.length > 0) tandas.push(actual)
  return tandas
}

interface LecturaParcial {
  items?: unknown[] | null
  comprobante?: object | null
  avisos?: string[]
  error?: string
}

const ES_IMPORTE = /total|subtotal|percepcion|retencion|impuestos_internos|otros_impuestos|descuento/
const vacio = (v: unknown) => v === null || v === undefined || v === ""

/**
 * Une las lecturas de varias tandas de hojas del MISMO comprobante: los renglones de todas, en
 * orden; la cabecera (número, tipo, fecha) de la primera tanda que la trae; los importes de la
 * última que los trae (los totales están en la última hoja). Si una tanda falló, falla todo: un
 * comprobante con hojas sin leer no sirve. Función pura.
 */
export function unirLecturas<T extends LecturaParcial>(lecturas: T[]): T {
  if (lecturas.length === 1) return lecturas[0]
  const conError = lecturas.findIndex((l) => !!l.error)
  if (conError >= 0) return { ...lecturas[conError], items: [], error: `tanda ${conError + 1} de ${lecturas.length}: ${lecturas[conError].error}` }
  const cabecera: Record<string, unknown> = {}
  for (const l of lecturas) {
    for (const [k, v] of Object.entries(l.comprobante ?? {})) {
      if (ES_IMPORTE.test(k)) {
        if (!vacio(v) && Number(v) !== 0) cabecera[k] = v
        else if (!(k in cabecera)) cabecera[k] = v
      } else if (vacio(cabecera[k])) cabecera[k] = v
    }
  }
  const avisos = lecturas.flatMap((l) => l.avisos ?? [])
  avisos.push(`El documento pesa mucho y se leyó en ${lecturas.length} tandas de hojas: revisá que no falte ni se repita ningún renglón.`)
  return {
    ...lecturas[0],
    items: lecturas.flatMap((l) => l.items ?? []),
    comprobante: Object.keys(cabecera).length > 0 ? cabecera : (lecturas[0].comprobante ?? null),
    avisos,
  } as T
}

/**
 * Por qué no se pudo leer, para el operario: en castellano y diciéndole qué hacer. El error crudo
 * del lector (a veces en inglés) va aparte, como detalle técnico para sistemas. Función pura.
 */
export function motivoParaOperario(tecnico: string | null | undefined): string {
  const m = String(tecnico ?? "").toLowerCase()
  if (/ning[uú]n rengl|sin renglones|no items|empty/.test(m)) return "No se encontraron renglones en el documento. Sacalo de nuevo: de frente, con buena luz y que entre toda la hoja."
  if (/quota|credit|402|429|billing|saldo|resource_exhausted/.test(m)) return "El lector automático no está disponible en este momento. El documento quedó adjunto: probá leerlo más tarde o avisá a la oficina."
  if (/timeout|timed out|deadline|504|503|network|fetch|unavailable|overloaded/.test(m)) return "El lector tardó demasiado o no respondió. El documento quedó adjunto: probá leerlo de nuevo en un rato."
  if (/too large|payload|size|413|exceeds|400/.test(m)) return "El lector no aceptó el documento (pesa mucho o alguna hoja no se puede abrir). Quedó adjunto: sacá las hojas de nuevo o avisá a la oficina."
  return "No se pudo leer el documento. Quedó adjunto: si salió movido u oscuro sacalo de nuevo; si no, avisá a la oficina para que lo cargue a mano."
}

/**
 * Lo que ve una app VIEJA (hasta la v0.5.5 no conoce "pendiente de leer"): un documento subido y
 * todavía sin leer se le manda como "no leído" con el motivo, para que no lo muestre como leído
 * ni como foto de respaldo. La app nueva mira `lectura_estado` y no usa este agregado. Pura.
 */
export function documentoParaApp<D extends { lectura_estado?: string | null; datos_ocr?: unknown; procesado?: boolean | null; tipo_documento?: string | null }>(doc: D): D {
  if (doc.datos_ocr || doc.procesado) return doc
  if (doc.lectura_estado !== "pendiente" && doc.lectura_estado !== "leyendo") return doc
  return { ...doc, datos_ocr: { items: [], no_leido: true, pendiente_de_lectura: true, motivo: "Pendiente de lectura: el documento se subió y el sistema todavía no lo leyó." } }
}
