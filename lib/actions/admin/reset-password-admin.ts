"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { requireAuth } from "@/lib/auth"

/**
 * Reseteo de contraseña por un admin. Devuelve { success } o { error } con el
 * mensaje REAL — nunca tira: en producción Next enmascara los throws de las
 * server actions con "An unexpected response was received from the server".
 */
export async function resetPasswordAdmin(
    targetUserId: string,
    newPassword: string
): Promise<{ success?: true; error?: string }> {
    try {
        const auth = await requireAuth()
        if (auth.error) return { error: "No autorizado — volvé a iniciar sesión" }

        if (!newPassword || newPassword.length < 6) {
            return { error: "La contraseña debe tener al menos 6 caracteres" }
        }

        const adminClient = createAdminClient()

        // Solo admins pueden resetear contraseñas (roles() puede venir como
        // objeto o como array según la relación detectada por PostgREST)
        const { data: rolData, error: rolError } = await adminClient
            .from("usuarios_roles")
            .select("roles(nombre)")
            .eq("usuario_id", auth.user.id)
        if (rolError) return { error: `No se pudieron verificar tus roles: ${rolError.message}` }
        const callerRoles = (rolData ?? []).flatMap((r: any) =>
            Array.isArray(r.roles) ? r.roles.map((x: any) => x?.nombre) : [r.roles?.nombre]
        ).filter(Boolean)
        if (!callerRoles.includes("admin")) {
            return { error: "Solo los administradores pueden resetear contraseñas" }
        }

        // Verificar que el usuario exista en Auth antes de actualizar
        const { data: target, error: getErr } = await adminClient.auth.admin.getUserById(targetUserId)
        if (getErr || !target?.user) {
            return { error: `El usuario no existe en Auth (${getErr?.message ?? "sin detalle"}) — id ${targetUserId}` }
        }

        const { error: authError } = await adminClient.auth.admin.updateUserById(targetUserId, {
            password: newPassword,
        })
        if (authError) return { error: `Auth: ${authError.message}` }

        // Forzar cambio de contraseña en el próximo login
        const { error: dbError } = await adminClient
            .from("usuarios")
            .update({ debe_cambiar_password: true })
            .eq("id", targetUserId)
        if (dbError) return { error: `La contraseña se cambió pero no se pudo marcar el cambio obligatorio: ${dbError.message}` }

        return { success: true }
    } catch (e: any) {
        console.error("[resetPasswordAdmin] error:", e)
        return { error: e?.message || "Error inesperado al resetear la contraseña" }
    }
}
