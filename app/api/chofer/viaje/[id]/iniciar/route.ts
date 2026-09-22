import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { accesoViajeChofer } from "@/lib/viajes/chofer"

// POST /api/chofer/viaje/[id]/iniciar
// El chofer (titular o acompañante) arranca un viaje que oficina ya despachó:
// despachado → en_curso. Un chofer no puede tener dos viajes en curso.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id } = await params
    const { acceso, error: accErr } = await accesoViajeChofer(supabase, id, auth.user.id)
    if (accErr) return accErr

    if (acceso.viaje.estado === "en_curso") return NextResponse.json({ success: true, estado: "en_curso" })
    if (acceso.viaje.estado !== "despachado") {
      return NextResponse.json({ error: "Oficina todavía no despachó este viaje" }, { status: 400 })
    }

    const { data: otro } = await supabase
      .from("viajes")
      .select("id, nombre")
      .eq("chofer_id", acceso.viaje.chofer_id)
      .eq("estado", "en_curso")
      .neq("id", id)
      .limit(1)
    if (otro?.length) {
      return NextResponse.json({ error: `Primero finalizá el viaje en curso: ${otro[0].nombre}` }, { status: 409 })
    }

    const { error } = await supabase
      .from("viajes")
      .update({ estado: "en_curso", iniciado_at: new Date().toISOString() })
      .eq("id", id)
      .eq("estado", "despachado")
    if (error) throw error

    return NextResponse.json({ success: true, estado: "en_curso" })
  } catch (error: any) {
    console.error("[chofer] Error en POST iniciar:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
