import { NextResponse } from "next/server"
import { authClient, aSesionMovil, habilitado, nombreDe, rolesDe, tocarDispositivo } from "@/lib/mobile/auth-server"
import type { AppMovil } from "@/lib/mobile/contrato"

// POST /api/mobile/auth/refresh  { refresh_token, app }
// 401 = sesión revocada/vencida ⇒ el dispositivo vuelve al login.
// Cualquier otro error ⇒ el dispositivo sigue con la sesión que tiene y reintenta.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const refresh_token = String(body?.refresh_token || "")
  const app = body?.app as AppMovil
  if (!refresh_token || !["vendedor", "chofer", "deposito"].includes(app)) {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 })
  }

  const { data, error } = await authClient().auth.refreshSession({ refresh_token })
  if (error || !data.session || !data.user) {
    const status = error?.status && error.status >= 500 ? 503 : 401
    return NextResponse.json({ error: "La sesión expiró. Volvé a ingresar." }, { status })
  }

  const roles = await rolesDe(data.user.id)
  if (!habilitado(app, roles)) {
    return NextResponse.json({ error: `Tu usuario ya no tiene acceso a la app ${app}.` }, { status: 401 })
  }
  const revocado = await tocarDispositivo({
    deviceId: request.headers.get("x-device-id"),
    userId: data.user.id,
    app,
    appVersion: request.headers.get("x-app-version"),
  })
  if (revocado) return NextResponse.json({ error: "Este dispositivo fue dado de baja." }, { status: 401 })

  return NextResponse.json(aSesionMovil(data.session, roles, await nombreDe(data.user.id)))
}
