import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// POST /api/chofer/viaje/[id]/finalizar
// El chofer finaliza su viaje, quedando en estado 'en_rendicion' para que el admin lo confirme.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id: viajeId } = await params

    const { data: viaje } = await supabase
      .from("viajes")
      .select("id, chofer_id, estado")
      .eq("id", viajeId)
      .single()

    if (!viaje || viaje.chofer_id !== auth.user.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }
    if (viaje.estado !== "en_curso") {
      return NextResponse.json({ error: "El viaje no está en curso" }, { status: 400 })
    }

    const { error } = await supabase
      .from("viajes")
      .update({ estado: "en_rendicion" })
      .eq("id", viajeId)

    if (error) throw error

    return NextResponse.json({
      success: true,
      estado: "en_rendicion",
      mensaje: "Viaje enviado a rendición. El administrador lo confirmará.",
    })
  } catch (error: any) {
    console.error("[chofer] Error en POST finalizar:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
