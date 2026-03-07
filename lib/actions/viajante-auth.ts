"use server"

import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"

export async function loginViajante(prevState: any, formData: FormData) {
    const nombre = formData.get("nombre") as string
    const password = formData.get("password") as string

    if (!nombre || !password) {
        return { error: "Nombre y contraseña son requeridos" }
    }

    const supabase = await createClient()

    let usuario = null

    console.log(`Intento de login para: ${nombre}`)

    // 0. Revisar si es un email
    if (nombre.includes("@")) {
        const { data: userByEmail } = await supabase
            .from("usuarios_crm")
            .select("id, email, rol, nombre")
            .eq("email", nombre.toLowerCase().trim())
            .single()
        usuario = userByEmail
    }

    // 1. Si no es email o no se encontró, buscar por nombre
    if (!usuario) {
        const { data: userByName, error: userError } = await supabase
            .from("usuarios_crm")
            .select("id, email, rol, nombre")
            .ilike("nombre", nombre)
            .single()
        usuario = userByName

        if (!usuario) {
            const { data: userByFullName } = await supabase
                .from("usuarios_crm")
                .select("id, email, rol, nombre")
                .ilike("nombre_completo", nombre)
                .single()
            usuario = userByFullName
        }
    }

    if (!usuario) {
        console.log("Usuario no encontrado en usuarios_crm")
        return { error: "Usuario no encontrado" }
    }

    console.log(`Usuario encontrado: ${usuario.email} (${usuario.rol})`)

    if (usuario.rol !== 'viajante' && usuario.rol !== 'vendedor') {
        console.log("Rol no autorizado:", usuario.rol)
        return { error: "El usuario no tiene permisos de viajante" }
    }

    // Login with Supabase Auth
    const { error: authError } = await supabase.auth.signInWithPassword({
        email: usuario.email,
        password: password,
    })

    if (authError) {
        console.error("Error AUTH Supabase:", authError.message)
        return { error: "Contraseña incorrecta o error de autenticación" }
    }

    redirect("/viajante")
}

export async function logoutViajante() {
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect("/viajante/login")
}
