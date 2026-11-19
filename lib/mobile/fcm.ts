// Firebase Cloud Messaging (HTTP v1) para hacer sonar un equipo perdido (20/11/2026).
// Ver MOBILE.md → "Hacer sonar un equipo".
//
// La cuenta de servicio sale SOLO de la variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON
// (el JSON entero, cargado en Vercel). Nunca en el repo ni en un APK. Sin la variable,
// enviar devuelve "sin_firebase" y nada se rompe.

import { google } from "googleapis"

export type ResultadoFcm = "enviado" | "sin_firebase" | "token_invalido" | `error: ${string}`

interface CuentaServicio {
  project_id: string
  client_email: string
  private_key: string
}

export function cuentaServicio(): CuentaServicio | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  try {
    const j = JSON.parse(raw)
    if (!j.project_id || !j.client_email || !j.private_key) return null
    return { project_id: j.project_id, client_email: j.client_email, private_key: String(j.private_key).replace(/\\n/g, "\n") }
  } catch {
    return null
  }
}

let cache: { token: string; vence: number } | null = null

async function accessToken(c: CuentaServicio): Promise<string> {
  if (cache && cache.vence > Date.now() + 60_000) return cache.token
  const jwt = new google.auth.JWT({ email: c.client_email, key: c.private_key, scopes: ["https://www.googleapis.com/auth/firebase.messaging"] })
  const r = await jwt.authorize()
  if (!r.access_token) throw new Error("Firebase no dio acceso")
  cache = { token: r.access_token, vence: r.expiry_date ?? Date.now() + 30 * 60_000 }
  return r.access_token
}

/**
 * Mensaje de DATOS de prioridad alta: lo recibe el servicio nativo GmAlarmaMensajes aunque
 * la app esté cerrada (no hay notificación "visible" de Firebase: la arma el equipo).
 */
export async function enviarFcm(token: string, datos: Record<string, string>): Promise<ResultadoFcm> {
  const c = cuentaServicio()
  if (!c) return "sin_firebase"
  try {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${c.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken(c)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token, data: datos, android: { priority: "HIGH", ttl: "120s" } } }),
    })
    if (r.ok) return "enviado"
    const body = await r.json().catch(() => null)
    const codigo = body?.error?.details?.find?.((d: any) => d?.errorCode)?.errorCode || body?.error?.status
    // Token viejo (app desinstalada o reinstalada): hay que esperar que el equipo mande uno nuevo
    if (codigo === "UNREGISTERED" || codigo === "INVALID_ARGUMENT") return "token_invalido"
    return `error: ${codigo || r.status}`
  } catch (e: any) {
    return `error: ${e?.message || "sin respuesta"}`
  }
}
