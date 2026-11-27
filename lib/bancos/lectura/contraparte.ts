/**
 * Quién está del otro lado de un movimiento (nombre, CUIT, CBU) a partir del texto del banco.
 * Solo se da un CUIT por bueno si el dígito verificador coincide: un CUIT mal leído por la IA
 * NO se guarda (sería un cliente equivocado más adelante, en la tanda de transferencias).
 */
import { cuitValido, formatCuit } from "../../formato"

const GUIONES = /[‐-―−]/g

/** Texto con los guiones raros del PDF (−, –) pasados a "-" y espacios simples. */
export function limpiarTexto(s: string | null | undefined): string {
  return String(s ?? "").replace(GUIONES, "-").replace(/\s+/g, " ").trim()
}

/** Primer CUIT válido del texto ("20389197891", "30-50001091-2", "(30501460423)"), formateado. */
export function cuitEnTexto(s: string | null | undefined): string | null {
  const t = limpiarTexto(s)
  const re = /(?<!\d)(\d{2})-?(\d{8})-?(\d)(?!\d)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const d = m[1] + m[2] + m[3]
    if (/^(20|23|24|25|26|27|30|33|34)/.test(d) && cuitValido(d)) return formatCuit(d)
  }
  return null
}

/** CBU/CVU de 22 dígitos (con o sin espacio en el medio, como lo imprime Credicoop). */
export function cbuEnTexto(s: string | null | undefined): string | null {
  const t = limpiarTexto(s)
  const m = /CBU\s*(?:Origen|Destino)?\s*:?\s*(\d{8})\s?(\d{14})(?!\d)/i.exec(t) ?? /(?<!\d)(\d{8})(\d{14})(?!\d)/.exec(t)
  return m ? m[1] + m[2] : null
}

/** Nombre en mayúsculas prolijas: sin dobles espacios, sin la coma pegada ("DANIEL OMAR,GENTILI"). */
function prolijo(s: string): string | null {
  const t = s.replace(/,(?=\S)/g, ", ").replace(/\s+/g, " ").replace(/^[\s\-:]+|[\s\-:]+$/g, "")
  return t.length >= 2 ? t : null
}

/**
 * Contraparte de un renglón. `detalle` es lo que el banco pone aparte del concepto (Nación:
 * "AGUSTIN MANUEL PENA GIMEN 20389197891"; Credicoop: "27953018549-VAR-REBECA SOLABARRIETA" +
 * "CBU Origen: …"; Provincia: "TRANSF A LOREAL ARGENTINA SA (30501460423) FAC …"; MP:
 * "Transferencia recibida X").
 */
export function extraerContraparte(concepto: string | null | undefined, detalle: string | null | undefined): {
  nombre: string | null; cuit: string | null; cbu: string | null
} {
  const c = limpiarTexto(concepto), d = limpiarTexto(detalle)
  const todo = `${c} ${d}`.trim()
  const cuit = cuitEnTexto(d) ?? cuitEnTexto(c)
  const cbu = cbuEnTexto(todo)
  let nombre: string | null = null

  // Credicoop: "CUIT-COD-NOMBRE" (también "Ord.:CUIT-NOMBRE")
  let m = /(?:Ord\.?:\s*)?\d{11}-(?:[A-Z]{3}-)?([^]*?)(?:CBU\b|$)/i.exec(d)
  if (m && /\d{11}-/.test(d)) nombre = prolijo(m[1])
  // Provincia: "TRANSF A NOMBRE (CUIT)"
  if (!nombre) {
    m = /TRANSF(?:ERENCIA)?\s+A\s+(.+?)\s*\(\d{11}\)/i.exec(todo)
    if (m) nombre = prolijo(m[1])
  }
  // MercadoPago: "Transferencia recibida X" / "Transferencia enviada X" / "Pago … X"
  if (!nombre) {
    m = /^Transferencia (?:recibida|enviada)\s+(.+)$/i.exec(c)
    if (m) nombre = prolijo(m[1])
  }
  // Nación y genérico: "NOMBRE CUIT" (o el detalle entero si no trae CUIT ni otra cosa)
  if (!nombre && d && d !== "-") {
    const sinNumeros = d.replace(/CBU.*$/i, "").replace(/(?<!\d)\d{2}-?\d{8}-?\d(?!\d)/g, "").replace(/[()]/g, " ")
    if (/[A-Za-zÑñ]{2}/.test(sinNumeros)) nombre = prolijo(sinNumeros)
  }
  return { nombre, cuit, cbu }
}
