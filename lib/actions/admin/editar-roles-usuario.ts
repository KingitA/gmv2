"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { requireAuth } from "@/lib/auth"

export async function editarRolesUsuario(targetUserId: string, roles: string[]) {
    const auth = await requireAuth()
    if (auth.error) throw new Error("No autorizado")

    const adminClient = createAdminClient()

    // Solo admins pueden editar roles
    const { data: rolData } = await adminClient
        .from("usuarios_roles")
        .select("roles(nombre)")
        .eq("usuario_id", auth.user.id)
    const callerRoles = rolData?.map((r: any) => r.roles?.nombre).filter(Boolean) || []
    if (!callerRoles.includes("admin")) throw new Error("Solo los administradores pueden editar roles")

    if (roles.length === 0) throw new Error("El usuario debe tener al menos un rol")

    // Obtener ids de los roles solicitados
    const { data: rolesRows, error: rolesError } = await adminClient
        .from("roles")
        .select("id, nombre")
        .in("nombre", roles)
    if (rolesError || !rolesRows?.length) throw new Error("Roles no válidos")

    const roleIds = rolesRows.map((r: any) => r.id)

    // Reemplazar todos los roles del usuario
    await adminClient.from("usuarios_roles").delete().eq("usuario_id", targetUserId)

    const inserts = roleIds.map((rol_id: string) => ({ usuario_id: targetUserId, rol_id }))
    const { error: insertError } = await adminClient.from("usuarios_roles").insert(inserts)
    if (insertError) throw new Error(insertError.message)

    return { success: true }
}
