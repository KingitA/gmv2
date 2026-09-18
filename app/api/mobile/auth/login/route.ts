import { NextResponse } from "next/server"
import { authClient, aSesionMovil, habilitado, nombreDe, rolesDe, tocarDispositivo } from "@/lib/mobile/auth-server"
import type { AppMovil } from "@/lib/mobile/contrato"

// POST /api/mobile/auth/login  { email, password, app }
// Devuelve SesionMovil (access + refresh token). Headers: X-Device-Id, X-App-Version.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const email = String(body?.email || "").trim()
  const password = String(body?.password || "")
  const app = body?.app as AppMovil
  if (!email || !password || !["vendedor", "chofer", "deposito"].includes(app)) {
    return NextResponse.json({ error: "Faltan datos de ingreso." }, { status: 400 })
  }

  const { data, error } = await authClient().auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    return NextResponse.json({ error: "Email o contraseña incorrectos." }, { status: 401 })
  }

  const roles = await rolesDe(data.user.id)
  if (!habilitado(app, roles)) {
    return NextResponse.json({ error: `Tu usuario no tiene acceso a la app ${app}.` }, { status: 403 })
  }
  const revocado = await tocarDispositivo({
    deviceId: request.headers.get("x-device-id"),
    userId: data.user.id,
    app,
    appVersion: request.headers.get("x-app-version"),
  })
  if (revocado) return NextResponse.json({ error: "Este dispositivo fue dado de baja." }, { status: 403 })

  return NextResponse.json(aSesionMovil(data.session, roles, await nombreDe(data.user.id)))
}
