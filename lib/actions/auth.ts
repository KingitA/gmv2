"use server"

import { createClient } from "@/lib/supabase/server"

/**
 * Login para el ERP principal.
 * Autentica con Supabase Auth y verifica que el usuario exista en la tabla `usuarios`.
 */
export async function loginUser(email: string, password: string) {
    const supabase = await createClient()

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    })

    if (error) {
        console.error("[Auth] Login error:", error.message)
        if (error.message.includes("Invalid login credentials")) {
            return { success: false, error: "Email o contraseña incorrectos" }
        }
        return { success: false, error: error.message }
    }

    // Verificar que el usuario exista en la tabla usuarios del ERP
    const { data: usuario, error: userError } = await supabase
        .from("usuarios")
        .select("id, email, nombre, estado, debe_cambiar_password")
        .eq("id", data.user.id)
        .single()

    if (userError || !usuario) {
        // El usuario existe en Supabase Auth pero no en la tabla usuarios del ERP
        console.error("[Auth] Usuario no encontrado en tabla usuarios:", userError?.message)
        await supabase.auth.signOut()
        return { success: false, error: "Tu cuenta no tiene acceso al sistema. Contactá al administrador." }
    }

    if (usuario.estado !== "activo") {
        await supabase.auth.signOut()
        return { success: false, error: "Tu cuenta está inactiva. Contactá al administrador." }
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

    return {
        success: true,
        user: {
            id: data.user.id,
            email: data.user.email,
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
