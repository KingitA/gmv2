"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { requireAuth } from "@/lib/auth"

export type CrearUsuarioInput = {
    email: string
    nombre: string
    rolNombre: "admin" | "vendedor"
    passwordTemporal: string
}

export async function crearUsuario(input: CrearUsuarioInput) {
    const auth = await requireAuth()
    if (auth.error) throw new Error("No autorizado")

    // Solo admins pueden crear usuarios
    const adminClient = createAdminClient()
    const { data: rolData } = await adminClient
        .from("usuarios_roles")
        .select("roles(nombre)")
        .eq("usuario_id", auth.user.id)
    const roles = rolData?.map((r: any) => r.roles?.nombre).filter(Boolean) || []
    if (!roles.includes("admin")) throw new Error("Solo los administradores pueden crear usuarios")

    // 1. Crear en Supabase Auth
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
        email: input.email,
        password: input.passwordTemporal,
        email_confirm: true,
    })
    if (authError) throw new Error(authError.message)
    const userId = authData.user.id

    // 2. Insertar en tabla usuarios
    const { error: userError } = await adminClient.from("usuarios").insert({
        id: userId,
        email: input.email,
        nombre: input.nombre,
        estado: "activo",
        debe_cambiar_password: true,
    })
    if (userError) {
        // Rollback: eliminar el usuario de Auth
        await adminClient.auth.admin.deleteUser(userId)
        throw new Error(userError.message)
    }

    // 3. Obtener el rol_id por nombre
    const { data: rolRow, error: rolError } = await adminClient
        .from("roles")
        .select("id")
        .eq("nombre", input.rolNombre)
        .single()
    if (rolError || !rolRow) {
        await adminClient.auth.admin.deleteUser(userId)
        throw new Error(`Rol "${input.rolNombre}" no encontrado`)
    }

    // 4. Asignar rol
    const { error: rolAsignError } = await adminClient.from("usuarios_roles").insert({
        usuario_id: userId,
        rol_id: rolRow.id,
    })
    if (rolAsignError) throw new Error(rolAsignError.message)

    return { success: true, userId }
}
