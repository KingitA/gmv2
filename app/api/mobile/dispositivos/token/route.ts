import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { jsonError, requireMobile } from "@/lib/mobile/sesion"
import { tocarDispositivo } from "@/lib/mobile/auth-server"
import type { AppMovil } from "@/lib/mobile/contrato"

// POST /api/mobile/dispositivos/token  { app, token } — token de Firebase de ESTE equipo
// (hacer sonar un equipo perdido, 20/11/2026). La app lo manda al iniciar sesión y cuando
// cambia. Sin la migración 20261120_mobile_sonar_equipo.sql no se guarda (y nada se rompe).
export const dynamic = "force-dynamic"

const APPS: AppMovil[] = ["vendedor", "chofer", "deposito"]

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const app = body?.app as AppMovil
  const token = typeof body?.token === "string" ? body.token.trim() : ""
  if (!APPS.includes(app)) return jsonError(400, "App inválida")
  if (!token || token.length > 4096) return jsonError(400, "Token inválido")
  const sesion = await requireMobile(request, app)
  if (sesion.error) return sesion.error
  if (!sesion.deviceId) return jsonError(400, "Falta el equipo")

  // La fila del equipo existe desde el login; por las dudas se crea acá
  const revocado = await tocarDispositivo({ deviceId: sesion.deviceId, userId: sesion.user.id, app, appVersion: sesion.appVersion })
  if (revocado) return jsonError(401, "Este dispositivo fue dado de baja.")
  const admin = createAdminClient()
  // Un token es de UN equipo: si quedó en otra fila (reinstalación), se limpia
  await admin.from("mobile_dispositivos").update({ fcm_token: null }).eq("fcm_token", token).neq("device_id", sesion.deviceId).then(() => {}, () => {})
  const { error } = await admin
    .from("mobile_dispositivos")
    .update({ fcm_token: token, fcm_token_at: new Date().toISOString() })
    .eq("device_id", sesion.deviceId)
    .eq("app", app)
  if (error) {
    console.error("[mobile/dispositivos/token]", error.message)
    return NextResponse.json({ ok: false })
  }
  return NextResponse.json({ ok: true })
}
