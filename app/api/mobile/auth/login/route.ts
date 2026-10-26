import { NextResponse } from "next/server"
import { authClient, aSesionMovil, habilitado, nombreDe, rolesDe, tocarDispositivo } from "@/lib/mobile/auth-server"
import type { AppMovil } from "@/lib/mobile/contrato"
import { ERROR_LOGIN, usuarioPorNombre } from "@/lib/usuario-por-nombre"

// POST /api/mobile/auth/login  { email, password, app }
// `email` acepta también el NOMBRE DE USUARIO (#2, 26/10/2026): sin "@" se resuelve igual
// que el login del ERP (lib/usuario-por-nombre.ts), con los mismos errores.
// Devuelve SesionMovil (access + refresh token). Headers: X-Device-Id, X-App-Version.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const usuarioOEmail = String(body?.email || "").trim()
  const password = String(body?.password || "")
  const app = body?.app as AppMovil
  if (!usuarioOEmail || !password || !["vendedor", "chofer", "deposito"].includes(app)) {
    return NextResponse.json({ error: "Faltan datos de ingreso." }, { status: 400 })
  }

  let email = usuarioOEmail
  if (!usuarioOEmail.includes("@")) {
    const u = await usuarioPorNombre(usuarioOEmail)
    if (!u.ok) return NextResponse.json({ error: `${u.error}.` }, { status: 401 })
    email = u.email
  }

  const { data, error } = await authClient().auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    return NextResponse.json({ error: `${ERROR_LOGIN}.` }, { status: 401 })
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
