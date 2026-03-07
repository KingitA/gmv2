import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 })
    }

    const { data: usuarioCRM, error: usuarioError } = await supabase
      .from("usuarios_crm")
      .select("id, email, rol, vendedor_id")
      .eq("email", user.email)
      .single()

    if (usuarioError || !usuarioCRM) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
    }

    return NextResponse.json({
      id: usuarioCRM.id,
      email: usuarioCRM.email,
      rol: usuarioCRM.rol,
      vendedor_id: usuarioCRM.vendedor_id,
    })
  } catch (error) {
    console.error("[v0] Error in /api/user/me:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
