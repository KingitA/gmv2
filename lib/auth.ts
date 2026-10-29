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

// ─── Permisos por rol (regla del dueño, 16/10/2026) ─────────────────────
// Quién puede hacer qué con la plata y las devoluciones. Una sola tabla para
// que las pantallas y las APIs digan lo mismo. Roles reales de la base:
// admin, administrativo, deposito, chofer, vendedor, mostrador.
export const PERMISOS = {
  /** Cargar cobros desde /pagos-clientes ("Cobros"): quedan pendientes */
  cargar_cobros: ["admin", "administrativo", "mostrador"],
  /** /caja: confirmar, imputar, dejar a cuenta, anular cobros, rendiciones */
  caja: ["admin"],
  /** Aceptar / rechazar / modificar devoluciones desde el ERP */
  revisar_devoluciones: ["admin", "administrativo"],
  /** Aceptar devoluciones desde depósito (app y pantalla de depósito) */
  revisar_devoluciones_deposito: ["admin", "administrativo", "deposito"],
  /** Emitir comprobantes (facturas, NC, reversas, ND) */
  emitir_comprobantes: ["admin", "administrativo"],
  /** Eliminar clientes (P2-02): borra o esconde, según su historial */
  eliminar_clientes: ["admin"],
} as const satisfies Record<string, readonly string[]>

export type Permiso = keyof typeof PERMISOS

interface RolesSuccess { user: User; roles: string[]; error: null }
type RolesResult = RolesSuccess | AuthFailure

/**
 * Como requireAuth, pero además exige uno de los roles del permiso.
 *   const auth = await requirePermiso("caja")
 *   if (auth.error) return auth.error
 */
export async function requirePermiso(permiso: Permiso): Promise<RolesResult> {
  const auth = await requireAuth()
  if (auth.error) return auth
  const roles = await getUserRoles(auth.user.id)
  const permitidos = PERMISOS[permiso] as readonly string[]
  if (!roles.some((r) => permitidos.includes(r))) {
    return {
      user: null,
      error: NextResponse.json(
        { error: "No tenés permiso para esta operación.", error_code: "SIN_PERMISO", permiso },
        { status: 403 },
      ),
    }
  }
  return { user: auth.user, roles, error: null }
}

/** ¿Estos roles alcanzan para el permiso? (para decidir sin cortar el request) */
export function tienePermiso(roles: string[], permiso: Permiso): boolean {
  const permitidos = PERMISOS[permiso] as readonly string[]
  return roles.some((r) => permitidos.includes(r))
}
