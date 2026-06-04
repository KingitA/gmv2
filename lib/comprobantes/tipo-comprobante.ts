/**
 * Lógica centralizada para determinar tipo de comprobante según condición IVA.
 *
 * Regla vigente (RI emisor):
 *  - Responsable Inscripto → FA (discrimina IVA)
 *  - Monotributo           → FA (es sujeto inscripto, recibe FA con IVA discriminado)
 *  - Sujeto Exento         → FB (IVA incluido)
 *  - Consumidor Final      → FB (pero esta empresa no emite a CF sin CUIT)
 *  - Desconocido / null    → null (bloquear — nunca asumir un tipo por defecto)
 *
 * FC, FE, FM no aplican para este emisor (Responsable Inscripto).
 */

export type TipoFactura = "FA" | "FB"
export type TipoNC = "NCA" | "NCB"
export type TipoND = "NDA" | "NDB"

/**
 * Retorna el tipo de factura correspondiente a la condición IVA del receptor.
 * Retorna null si la condición es desconocida o no está cargada.
 */
export function determinarTipoFactura(condicionIva: string | null | undefined): TipoFactura | null {
  const c = (condicionIva ?? "").toLowerCase().trim()
  if (c.includes("responsable inscri")) return "FA"
  if (c.includes("monotributo"))        return "FA"
  if (c.includes("exento"))             return "FB"
  if (c.includes("consumidor final"))   return "FB"
  return null
}

/**
 * Retorna el tipo de NC/ND a partir del tipo de la factura original.
 * Si la factura original era FA → NCA / NDA, si era FB → NCB / NDB.
 * Retorna null si el tipo original no es un tipo de factura conocido.
 */
export function determinarTipoNCADesdeOriginal(tipoOriginal: string): TipoNC | "REV" | null {
  if (tipoOriginal === "FA")   return "NCA"
  if (tipoOriginal === "FB")   return "NCB"
  if (tipoOriginal === "PRES") return "REV"
  return null
}

export function determinarTipoNDA(condicionIva: string | null | undefined): TipoND | null {
  const tipo = determinarTipoFactura(condicionIva)
  if (tipo === "FA") return "NDA"
  if (tipo === "FB") return "NDB"
  return null
}

/**
 * Mensaje de error legible para el operario cuando la condición de IVA no está configurada.
 */
export function mensajeErrorCondicionIva(nombreCliente: string): string {
  return `El cliente "${nombreCliente}" no tiene condición de IVA configurada. Editá el cliente y completá ese campo antes de emitir el comprobante.`
}
