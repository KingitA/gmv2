import { NextResponse } from "next/server"
import { requireAuth, getUserRoles } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { nombreDe } from "@/lib/mobile/auth-server"
import { mensajeResultado, motivoNoSuena, puedeSonar, sonarEquipo, type AccionSonar } from "@/lib/mobile/sonar"

// Lógica compartida de POST /api/mobile/dispositivos/[id]/sonar y /detener (20/11/2026).
// [id] = device_id; body { app }. Sirve para el ERP (sesión con cookie, solo admin) y para
// la app depósito (bearer, solo hacia equipos de depósito). Ver MOBILE.md → "Hacer sonar un equipo".
export async function accionSonar(request: Request, deviceId: string, accion: AccionSonar) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({}))
  const app = String(body?.app || "")
  const roles = await getUserRoles(auth.user.id)
  if (!puedeSonar(roles, app)) return NextResponse.json({ error: "No podés hacer sonar ese equipo." }, { status: 403 })

  const admin = createAdminClient()
  const { data: equipo, error } = await admin.from("mobile_dispositivos").select("*").eq("device_id", deviceId).eq("app", app).maybeSingle()
  if (error) return NextResponse.json({ error: "Falta aplicar la migración 20261120_mobile_sonar_equipo.sql." }, { status: 500 })
  if (!equipo) return NextResponse.json({ error: "Ese equipo no está en la lista." }, { status: 404 })
  const motivo = accion === "sonar" ? motivoNoSuena(equipo) : equipo.fcm_token ? null : motivoNoSuena(equipo)
  if (motivo) return NextResponse.json({ ok: false, resultado: "sin_token", mensaje: motivo }, { status: 409 })

  const origen = request.headers.get("x-device-id") ? "app" : "erp"
  const resultado = await sonarEquipo(admin, { equipo, accion, pedidoPor: auth.user.id, nombrePide: await nombreDe(auth.user.id), origen })
  const ok = resultado === "enviado"
  return NextResponse.json({ ok, resultado, mensaje: mensajeResultado(accion, resultado) }, { status: ok ? 200 : resultado === "sin_firebase" ? 503 : 502 })
}
