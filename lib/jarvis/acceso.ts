/**
 * Quién puede usar Jarvis y quién puede confirmar cada cosa.
 *
 * Decisiones de Juan (14/10/2026, PLAN.md §9):
 * - Usan Jarvis: admin y administrativo (más adelante, vendedores y choferes
 *   con una versión recortada).
 * - Confirman decisiones: admin y administrativo.
 * - Todo lo que mueva plata: SOLO admin.
 */
import { NextResponse } from "next/server"
import type { User } from "@supabase/supabase-js"
import { requireAuth, getUserRoles } from "@/lib/auth"

export const ROLES_JARVIS = ["admin", "administrativo"] as const


type Resultado =
  | { user: User; roles: string[]; error: null }
  | { user: null; roles: null; error: NextResponse }

export async function requireJarvis(): Promise<Resultado> {
  const auth = await requireAuth()
  if (auth.error) return { user: null, roles: null, error: auth.error }
  const roles = await getUserRoles(auth.user.id)
  if (!roles.some((r) => (ROLES_JARVIS as readonly string[]).includes(r))) {
    return {
      user: null,
      roles: null,
      error: NextResponse.json({ error: "Jarvis es solo para admin y administrativo." }, { status: 403 }),
    }
  }
  return { user: auth.user, roles, error: null }
}

/** Confirman admin y administrativo; lo que mueve plata, solo admin (lib/jarvis/acciones.ts → mueveDinero). */
export function puedeConfirmar(roles: string[], mueveDinero: boolean): boolean {
  if (roles.includes("admin")) return true
  if (mueveDinero) return false
  return roles.includes("administrativo")
}

export const esAdmin = (roles: string[]) => roles.includes("admin")
