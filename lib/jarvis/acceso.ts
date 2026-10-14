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

/** Tipos de decisión que mueven plata: solo admin. */
export const DECISIONES_SOLO_ADMIN = new Set<string>(["pago", "transferencia", "cobro", "movimiento_dinero"])

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

export function puedeConfirmar(roles: string[], tipoDecision: string): boolean {
  if (roles.includes("admin")) return true
  if (DECISIONES_SOLO_ADMIN.has(tipoDecision)) return false
  return roles.includes("administrativo")
}
