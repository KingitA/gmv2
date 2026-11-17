/**
 * Mail de la orden de compra al proveedor (E-03): la plantilla del mensaje y el armado del
 * mensaje MIME (RFC 2822) con los adjuntos, listo para `users.messages.send` de Gmail.
 *
 * Archivo PURO (sin base ni red, sin Buffer: corre igual en el servidor y en el test).
 * Test: mobile/packages/core/test/entrada-orden-compra.test.ts (por eso los imports son relativos)
 */
import { fecha, moneda } from "../formato"

// ─── Plantilla ──────────────────────────────────────────────────────────────────────────────
export interface DatosPlantillaMail {
  numero_orden: string
  proveedor: string
  empresa: string
  fecha_entrega: string | null
  /** Una línea por condición de pago */
  condiciones: string[]
  renglones: number
  /** Total del pedido SIN impuestos (un solo total: el proveedor recibe un solo pedido) */
  total: number
  observaciones?: string | null
  /** Quién firma (nombre del usuario) */
  firma?: string | null
  telefono?: string | null
  /** Es un reenvío de una orden que cambió después del primer envío */
  reemplaza?: boolean
}

export function asuntoOrden(d: Pick<DatosPlantillaMail, "numero_orden" | "empresa" | "reemplaza">): string {
  return `${d.reemplaza ? "ACTUALIZADA — " : ""}Orden de compra ${d.numero_orden} — ${d.empresa}`
}

export function cuerpoOrden(d: DatosPlantillaMail): string {
  const lineas: string[] = []
  lineas.push(`Hola, buen día.`)
  lineas.push("")
  lineas.push(d.reemplaza
    ? `Les enviamos la orden de compra ${d.numero_orden} ACTUALIZADA. Reemplaza a la que les mandamos antes: por favor tomen esta versión.`
    : `Les enviamos adjunta la orden de compra ${d.numero_orden}.`)
  lineas.push("")
  lineas.push(`• Artículos: ${d.renglones}`)
  lineas.push(`• Total: ${moneda(d.total)} (precios sin IVA)`)
  if (d.fecha_entrega) lineas.push(`• Fecha de entrega pedida: ${fecha(d.fecha_entrega)}`)
  if (d.condiciones.length === 1) lineas.push(`• Condición de pago: ${d.condiciones[0]}`)
  else if (d.condiciones.length > 1) {
    lineas.push(`• Condición de pago:`)
    for (const c of d.condiciones) lineas.push(`    - ${c}`)
  }
  if (d.observaciones && d.observaciones.trim()) {
    lineas.push("")
    lineas.push(`Observaciones: ${d.observaciones.trim()}`)
  }
  lineas.push("")
  lineas.push("Por favor confirmen la recepción del pedido y, si hay faltantes o cambios de precio, avísennos antes de despachar.")
  lineas.push("")
  lineas.push("Muchas gracias.")
  lineas.push("")
  if (d.firma) lineas.push(d.firma)
  lineas.push(d.empresa)
  if (d.telefono) lineas.push(`Tel. ${d.telefono}`)
  return lineas.join("\n")
}

// ─── MIME ───────────────────────────────────────────────────────────────────────────────────
export interface AdjuntoMail {
  nombre: string
  tipo: string
  /** Contenido en base64 estándar (sin saltos de línea) */
  base64: string
}

export interface MensajeMail {
  de: string
  /** Nombre que ve el destinatario ("Compras GM") */
  nombreDe?: string | null
  para: string[]
  cc?: string[]
  responderA?: string | null
  asunto: string
  texto: string
  adjuntos?: AdjuntoMail[]
  /** Para que un reenvío quede en la misma conversación */
  enRespuestaA?: string | null
}

const RE_MAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/
export const mailValido = (m: string) => RE_MAIL.test(m)

/** UTF-8 → base64 (sin Buffer, para que el test corra en cualquier lado) */
export function base64DeTexto(texto: string): string {
  const bytes = new TextEncoder().encode(texto)
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const partir76 = (b64: string) => b64.replace(/(.{76})/g, "$1\r\n").replace(/\r\n$/, "")

/** Encabezado con acentos: =?UTF-8?B?…?= (RFC 2047), partido en tramos cortos. */
export function encabezadoUtf8(texto: string): string {
  if (/^[\x20-\x7e]*$/.test(texto)) return texto
  const tramos: string[] = []
  let actual = ""
  for (const ch of texto) {
    if (new TextEncoder().encode(actual + ch).length > 39) { tramos.push(actual); actual = "" }
    actual += ch
  }
  if (actual) tramos.push(actual)
  return tramos.map((t) => `=?UTF-8?B?${base64DeTexto(t)}?=`).join("\r\n ")
}

/** Nada de saltos de línea en un encabezado (inyección de encabezados). */
const limpio = (v: string) => v.replace(/[\r\n]+/g, " ").trim()

const escaparHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** El mismo texto como HTML sencillo (párrafos y saltos), para que se lea bien en cualquier cliente. */
export function htmlDeTexto(texto: string): string {
  const cuerpo = escaparHtml(texto).split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`).join("")
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.45">${cuerpo}</body></html>`
}

/**
 * Arma el mensaje completo. Lanza Error (en español) si falta el destinatario o hay un mail inválido.
 * `frontera` se puede fijar para probar.
 */
export function armarMime(m: MensajeMail, frontera = `gm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`): string {
  const para = (m.para || []).map(limpio).filter(Boolean)
  const cc = (m.cc || []).map(limpio).filter(Boolean).filter((x) => !para.includes(x))
  if (para.length === 0) throw new Error("Falta el destinatario del mail.")
  const malos = [...para, ...cc, ...(m.responderA ? [limpio(m.responderA)] : [])].filter((x) => !mailValido(x))
  if (malos.length > 0) throw new Error(`Hay direcciones de mail inválidas: ${malos.join(", ")}`)
  if (!mailValido(limpio(m.de))) throw new Error("La cuenta de envío no es una dirección de mail válida.")
  if (!limpio(m.asunto)) throw new Error("El mail no tiene asunto.")

  const mixta = `${frontera}_m`
  const alterna = `${frontera}_a`
  const L: string[] = []
  const nombreDe = m.nombreDe ? limpio(m.nombreDe).replace(/["<>]/g, "") : ""
  L.push(`From: ${nombreDe ? `${encabezadoUtf8(nombreDe)} <${limpio(m.de)}>` : limpio(m.de)}`)
  L.push(`To: ${para.join(", ")}`)
  if (cc.length > 0) L.push(`Cc: ${cc.join(", ")}`)
  if (m.responderA) L.push(`Reply-To: ${limpio(m.responderA)}`)
  L.push(`Subject: ${encabezadoUtf8(limpio(m.asunto))}`)
  if (m.enRespuestaA) { L.push(`In-Reply-To: ${limpio(m.enRespuestaA)}`); L.push(`References: ${limpio(m.enRespuestaA)}`) }
  L.push("MIME-Version: 1.0")
  L.push(`Content-Type: multipart/mixed; boundary="${mixta}"`)
  L.push("")
  L.push(`--${mixta}`)
  L.push(`Content-Type: multipart/alternative; boundary="${alterna}"`)
  L.push("")
  L.push(`--${alterna}`)
  L.push('Content-Type: text/plain; charset="UTF-8"')
  L.push("Content-Transfer-Encoding: base64")
  L.push("")
  L.push(partir76(base64DeTexto(m.texto.replace(/\r?\n/g, "\r\n"))))
  L.push(`--${alterna}`)
  L.push('Content-Type: text/html; charset="UTF-8"')
  L.push("Content-Transfer-Encoding: base64")
  L.push("")
  L.push(partir76(base64DeTexto(htmlDeTexto(m.texto))))
  L.push(`--${alterna}--`)
  for (const a of m.adjuntos || []) {
    // nombre de archivo solo ASCII seguro (los nuestros son OC_OC-000012.pdf)
    const nombre = limpio(a.nombre).replace(/[^A-Za-z0-9._-]/g, "_") || "adjunto"
    L.push(`--${mixta}`)
    L.push(`Content-Type: ${limpio(a.tipo)}; name="${nombre}"`)
    L.push(`Content-Disposition: attachment; filename="${nombre}"`)
    L.push("Content-Transfer-Encoding: base64")
    L.push("")
    L.push(partir76(a.base64.replace(/\s+/g, "")))
  }
  L.push(`--${mixta}--`)
  L.push("")
  return L.join("\r\n")
}

/** El mensaje MIME como lo pide Gmail en el campo `raw`: base64 "url-safe" sin relleno. */
export function rawParaGmail(mime: string): string {
  return base64DeTexto(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
