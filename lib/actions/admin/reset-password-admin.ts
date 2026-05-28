"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { requireAuth } from "@/lib/auth"

export async function resetPasswordAdmin(targetUserId: string, newPassword: string) {
    const auth = await requireAuth()
    if (auth.error) throw new Error("No autorizado")

    if (newPassword.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres")

    const adminClient = createAdminClient()

    // Solo admins pueden resetear contraseñas
    const { data: rolData } = await adminClient
        .from("usuarios_roles")
        .select("roles(nombre)")
        .eq("usuario_id", auth.user.id)
    const callerRoles = rolData?.map((r: any) => r.roles?.nombre).filter(Boolean) || []
    if (!callerRoles.includes("admin")) throw new Error("Solo los administradores pueden resetear contraseñas")

    // Actualizar contraseña en Supabase Auth
    const { error: authError } = await adminClient.auth.admin.updateUserById(targetUserId, {
        password: newPassword,
    })
    if (authError) throw new Error(authError.message)

    // Forzar cambio de contraseña en el próximo login
    const { error: dbError } = await adminClient
        .from("usuarios")
        .update({ debe_cambiar_password: true })
        .eq("id", targetUserId)
    if (dbError) throw new Error(dbError.message)

    return { success: true }
}
