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
