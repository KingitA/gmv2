"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { requireAuth } from "@/lib/auth"

export type CrearUsuarioInput = {
    nombre: string        // nombre de usuario para login (único)
    email?: string        // email real opcional
    roles: string[]
    passwordTemporal: string
}

export async function crearUsuario(input: CrearUsuarioInput) {
    const auth = await requireAuth()
    if (auth.error) throw new Error("No autorizado")

    if (!input.roles || input.roles.length === 0) throw new Error("Debe asignar al menos un rol")
    if (!input.nombre?.trim()) throw new Error("El nombre de usuario es obligatorio")

    const adminClient = createAdminClient()

    // Solo admins pueden crear usuarios
    const { data: rolData } = await adminClient
        .from("usuarios_roles")
        .select("roles(nombre)")
        .eq("usuario_id", auth.user.id)
    const callerRoles = rolData?.map((r: any) => r.roles?.nombre).filter(Boolean) || []
    if (!callerRoles.includes("admin")) throw new Error("Solo los administradores pueden crear usuarios")

    // Verificar que el nombre no esté en uso
    const { data: existing } = await adminClient
        .from("usuarios")
        .select("id")
        .ilike("nombre", input.nombre.trim())
        .maybeSingle()
    if (existing) throw new Error(`El nombre de usuario "${input.nombre.trim()}" ya está en uso`)

    // Email para Supabase Auth: real si se proveyó, sino generado internamente
    const nombreSlug = input.nombre.trim().toLowerCase().replace(/\s+/g, '_')
    const authEmail = input.email?.trim() || `${nombreSlug}@gmv2.internal`

    // 1. Crear en Supabase Auth
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
        email: authEmail,
        password: input.passwordTemporal,
        email_confirm: true,
    })
    if (authError) throw new Error(authError.message)
    const userId = authData.user.id

    // 2. Insertar en tabla usuarios
    const { error: userError } = await adminClient.from("usuarios").insert({
        id: userId,
        email: authEmail,
        nombre: input.nombre.trim(),
        estado: "activo",
        debe_cambiar_password: true,
    })
    if (userError) {
        await adminClient.auth.admin.deleteUser(userId)
        throw new Error(userError.message)
    }

    // 3. Obtener ids de los roles solicitados
    const { data: rolesRows, error: rolesError } = await adminClient
        .from("roles")
        .select("id, nombre")
        .in("nombre", input.roles)
    if (rolesError || !rolesRows?.length) {
        await adminClient.auth.admin.deleteUser(userId)
        throw new Error("Uno o más roles no encontrados")
    }

    // 4. Asignar todos los roles
    const inserts = rolesRows.map((r: any) => ({ usuario_id: userId, rol_id: r.id }))
    const { error: rolAsignError } = await adminClient.from("usuarios_roles").insert(inserts)
    if (rolAsignError) throw new Error(rolAsignError.message)

    return { success: true, userId }
}
