import { NextResponse } from "next/server"
import type { User } from "@supabase/supabase-js"
import { requireAuth, getUserRoles } from "@/lib/auth"
import { ROLES_APP, type AppMovil } from "./contrato"

// Sesión de un request de las apps móviles (bearer, ver lib/supabase/server.ts).
// Los endpoints existentes (/api/vendedor/*, /api/chofer/*, /api/deposito/*)
// siguen usando requireAuth/requireVendedor tal cual: el bearer ya les llega.

export interface SesionMobile {
  user: User
  roles: string[]
  deviceId: string | null
  appVersion: string | null
  error: null
}

export async function requireMobile(
  request: Request,
  app?: AppMovil,
): Promise<SesionMobile | { error: NextResponse }> {
  const auth = await requireAuth()
  if (auth.error) return { error: auth.error }
  const roles = await getUserRoles(auth.user.id)
  if (app && !ROLES_APP[app].some((r) => roles.includes(r))) {
    return { error: NextResponse.json({ error: `Tu usuario no tiene acceso a la app ${app}.` }, { status: 403 }) }
  }
  return {
    user: auth.user,
    roles,
    deviceId: request.headers.get("x-device-id"),
    appVersion: request.headers.get("x-app-version"),
    error: null,
  }
}

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status })
}
