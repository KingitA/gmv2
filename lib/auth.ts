import { createClient } from "@/lib/supabase/server"
import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'

// ─── Auth Helper para API Routes ─────────────────────

interface AuthSuccess {
    user: User
    error: null
}

interface AuthFailure {
    user: null
    error: NextResponse
}

type AuthResult = AuthSuccess | AuthFailure

/**
 * Verifica que el request venga de un usuario autenticado.
 * Uso en API routes:
 *   const auth = await requireAuth()
 *   if (auth.error) return auth.error
 *   // auth.user disponible
 */
export async function requireAuth(): Promise<AuthResult> {
    try {
        const supabase = await createClient()
        const { data: { user }, error } = await supabase.auth.getUser()

        if (error || !user) {
            return {
                user: null,
                error: NextResponse.json(
                    { error: 'No autorizado. Iniciá sesión para continuar.' },
                    { status: 401 }
                ),
            }
        }

        return { user, error: null }
    } catch {
        return {
            user: null,
            error: NextResponse.json(
                { error: 'Error de autenticación.' },
                { status: 401 }
            ),
        }
    }
}

// ─── Funciones de Roles existentes ───────────────────

export async function getUserRoles(userId: string): Promise<string[]> {
  const supabase = await createClient()

  const { data: userRoles } = await supabase
    .from("usuarios_roles")
    .select("roles(nombre)")
    .eq("usuario_id", userId)

  if (!userRoles) return []

  return userRoles.map((ur: any) => ur.roles?.nombre).filter(Boolean)
}

export async function checkUserRole(userId: string, allowedRoles: string[]): Promise<boolean> {
  const roles = await getUserRoles(userId)
  return roles.some(role => allowedRoles.includes(role))
}

export async function getCurrentUserWithRoles() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const roles = await getUserRoles(user.id)

  return {
    ...user,
    roles
  }
}
