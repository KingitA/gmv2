// A dónde vuelve el navegador después de conectar Gmail con Google.
// La pantalla que pide la conexión manda ?volver=/ruta; viaja a Google dentro de "state" y el
// callback vuelve ahí con ?gmail_connected= o ?gmail_error=. SOLO rutas internas del sistema:
// nunca una dirección de afuera (si no, el enlace serviría para mandar a alguien a otro sitio).

export const VUELTA_POR_DEFECTO = "/"

/** Devuelve la ruta si es interna y segura; si no, la de por defecto. */
export function rutaInterna(v: string | null | undefined): string {
  const s = String(v ?? "").trim()
  if (!s.startsWith("/")) return VUELTA_POR_DEFECTO          // tiene que ser una ruta del sistema
  if (s.startsWith("//") || s.includes("\\")) return VUELTA_POR_DEFECTO   // "//otro-sitio" o barras invertidas
  if (s.startsWith("/api/")) return VUELTA_POR_DEFECTO       // no se vuelve a una ruta de servicio
  if (s.length > 200 || /[\s<>"']/.test(s) || s.includes("\n")) return VUELTA_POR_DEFECTO
  return s
}

/** "state" de Google: quién pidió la conexión y a dónde volver. */
export function armarEstado(userId: string, volver: string): string {
  return Buffer.from(JSON.stringify({ u: userId, v: rutaInterna(volver) }), "utf8").toString("base64url")
}

/** Lee el "state". Acepta el formato anterior (solo el id del usuario). */
export function leerEstado(state: string | null | undefined): { userId: string | null; volver: string } {
  const s = String(state ?? "").trim()
  if (!s) return { userId: null, volver: VUELTA_POR_DEFECTO }
  try {
    const o = JSON.parse(Buffer.from(s, "base64url").toString("utf8"))
    if (o && typeof o.u === "string") return { userId: o.u, volver: rutaInterna(o.v) }
  } catch { /* formato anterior */ }
  return { userId: s, volver: VUELTA_POR_DEFECTO }
}

/** Agrega un parámetro a una ruta interna (respeta si ya trae "?"). */
export function conParametro(ruta: string, clave: string, valor: string): string {
  return ruta + (ruta.includes("?") ? "&" : "?") + clave + "=" + encodeURIComponent(valor)
}
