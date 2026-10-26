import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Login por NOMBRE DE USUARIO (regla única del ERP y de las apps, #2 del 26/10/2026).
 * Busca el usuario en `usuarios` por nombre (sin distinguir mayúsculas) y devuelve el
 * email interno con el que se autentica en Supabase Auth. La usan
 * `loginUser` (lib/actions/auth.ts, login del ERP) y `/api/mobile/auth/login` (apps).
 */
export type UsuarioLogin =
  | { ok: true; id: string; email: string; nombre: string; debe_cambiar_password: boolean }
  | { ok: false; error: string }

export const ERROR_LOGIN = "Usuario o contraseña incorrectos"

export async function usuarioPorNombre(nombreUsuario: string): Promise<UsuarioLogin> {
  const { data: usuario } = await createAdminClient()
    .from("usuarios")
    .select("id, email, nombre, estado, debe_cambiar_password")
    .ilike("nombre", nombreUsuario.trim())
    .single()

  if (!usuario) return { ok: false, error: ERROR_LOGIN }
  if (usuario.estado !== "activo") return { ok: false, error: "Tu cuenta está inactiva. Contactá al administrador." }
  return { ok: true, id: usuario.id, email: usuario.email, nombre: usuario.nombre, debe_cambiar_password: !!usuario.debe_cambiar_password }
}
