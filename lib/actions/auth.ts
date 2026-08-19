"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getHomeForRoles } from "@/lib/role-utils"

/**
 * Login por nombre de usuario + contraseña.
 * Busca el usuario en la tabla `usuarios` por nombre (case-insensitive),
 * obtiene el email interno y autentica con Supabase Auth.
 */
export async function loginUser(nombreUsuario: string, password: string) {
    const supabase = await createClient()
    const adminClient = createAdminClient()

    // Buscar usuario por nombre (case-insensitive)
    const { data: usuario } = await adminClient
        .from("usuarios")
        .select("id, email, nombre, estado, debe_cambiar_password")
        .ilike("nombre", nombreUsuario.trim())
        .single()

    if (!usuario) {
        return { success: false, error: "Usuario o contraseña incorrectos" }
    }

    if (usuario.estado !== "activo") {
        return { success: false, error: "Tu cuenta está inactiva. Contactá al administrador." }
    }

    // Autenticar con Supabase Auth usando el email interno del usuario
    const { data, error } = await supabase.auth.signInWithPassword({
        email: usuario.email,
        password,
    })

    if (error) {
        return { success: false, error: "Usuario o contraseña incorrectos" }
    }

    // Forzar cambio de contraseña si corresponde
    if (usuario.debe_cambiar_password) {
        return { success: true, mustChangePassword: true }
    }

    // Obtener roles del usuario
    const { data: rolesData } = await supabase
        .from("usuarios_roles")
        .select("roles(nombre)")
        .eq("usuario_id", data.user.id)

    const roles = rolesData?.map((r: any) => r.roles?.nombre).filter(Boolean) || []

    // Sin módulo activo: no dejar pasar. La fuente de verdad de qué roles
    // tienen módulo es getHomeForRoles (role-utils) — antes había acá una
    // lista fija sin 'vendedor' ni 'mostrador' y los usuarios con ese rol
    // puro rebotaban con "tu módulo aún no está disponible".
    if (!getHomeForRoles(roles)) {
        await supabase.auth.signOut()
        return { success: false, error: 'Tu módulo aún no está disponible. Contactá al administrador.' }
    }

    return {
        success: true,
        user: {
            id: data.user.id,
            nombre: usuario.nombre,
            estado: usuario.estado,
            roles,
        },
    }
}

export async function logoutUser() {
    const supabase = await createClient()
    await supabase.auth.signOut()
}
