/**
 * Roles del usuario guardados unos minutos en una cookie FIRMADA (P2-49).
 *
 * El middleware consultaba usuarios_roles en CADA pedido de página (la tabla
 * llevaba 300.000 lecturas). Ahora la primera vez consulta y guarda los roles en
 * la cookie `gm-roles`, firmada con una clave que solo tiene el servidor (HMAC
 * SHA-256): el navegador no puede inventar ni cambiar roles. La cookie dice de
 * qué usuario es y cuándo vence (ROLES_TTL_S); vencida, de otro usuario o mal
 * firmada, se ignora y se vuelve a consultar.
 *
 * Efecto: un cambio de roles tarda hasta ROLES_TTL_S en aplicarse.
 * Corre en el middleware (Edge): solo Web Crypto, nada de Node.
 */

export const COOKIE_ROLES = "gm-roles"
export const ROLES_TTL_S = 5 * 60

function clave(): string | null {
  return process.env.ROLES_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null
}

const enc = new TextEncoder()

function aBase64Url(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function deBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/")
  return atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
}

async function firmar(datos: string, secreto: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return aBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(datos))))
}

/** Comparación en tiempo constante (no dar pistas por tiempo de respuesta) */
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

/** Arma el valor de la cookie, o null si el servidor no tiene clave para firmar. */
export async function cookieDeRoles(usuarioId: string, roles: string[]): Promise<string | null> {
  const secreto = clave()
  if (!secreto) return null
  const datos = aBase64Url(enc.encode(JSON.stringify({ u: usuarioId, r: roles, e: Math.floor(Date.now() / 1000) + ROLES_TTL_S })))
  return `${datos}.${await firmar(datos, secreto)}`
}

/** Roles de la cookie si es válida, del mismo usuario y no venció; si no, null. */
export async function rolesDeCookie(valor: string | undefined, usuarioId: string): Promise<string[] | null> {
  const secreto = clave()
  if (!secreto || !valor) return null
  const [datos, firma] = valor.split(".")
  if (!datos || !firma) return null
  try {
    if (!iguales(firma, await firmar(datos, secreto))) return null
    const p = JSON.parse(deBase64Url(datos)) as { u?: string; r?: unknown; e?: number }
    if (p.u !== usuarioId || typeof p.e !== "number" || p.e < Date.now() / 1000) return null
    if (!Array.isArray(p.r) || !p.r.every((x) => typeof x === "string")) return null
    return p.r as string[]
  } catch {
    return null
  }
}

/** Id del usuario (claim `sub`) leído del access token, sin tocar `session.user`. */
export function usuarioDelToken(accessToken: string | null | undefined): string | null {
  if (!accessToken) return null
  try {
    const p = JSON.parse(deBase64Url(accessToken.split(".")[1] ?? "")) as { sub?: string }
    return typeof p.sub === "string" && p.sub ? p.sub : null
  } catch {
    return null
  }
}
