"use server"

import { createClient } from "@/lib/supabase/server"

export async function loginUser(email: string, password: string) {
    const supabase = await createClient()

    console.log("[v0] lib/actions/auth: Attempting login for", email)

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    })

    if (error) {
        console.error("[v0] Auth error:", error.message)
        return { success: false, error: error.message }
    }

    // Get user profile/role
    const { data: profile, error: profileError } = await supabase
        .from("usuarios_crm")
        .select("*")
        .eq("id", data.user.id)
        .single()

    if (profileError || !profile) {
        console.error("[v0] Profile error:", profileError?.message)
        return { success: false, error: "Perfil de usuario no encontrado" }
    }

    return {
        success: true,
        user: {
            id: data.user.id,
            email: data.user.email,
            rol: profile.rol,
            ...profile,
        },
    }
}

export async function logoutUser() {
    const supabase = await createClient()
    await supabase.auth.signOut()
}
