import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// GET /api/chofer/me
// Retorna el usuario actual + viaje activo + historial de viajes del chofer
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const userId = auth.user.id

    // Datos del usuario
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("id, nombre, email")
      .eq("id", userId)
      .single()

    // Viaje activo: estado='en_viaje' asignado a este chofer
    const { data: viajeActivo } = await supabase
      .from("viajes")
      .select("id, nombre, fecha, estado, zona_id, zonas(nombre)")
      .eq("chofer_id", userId)
      .eq("estado", "en_viaje")
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle()

    // Historial: viajes completados/en_rendicion del chofer
    const { data: historial } = await supabase
      .from("viajes")
      .select("id, nombre, fecha, estado, zona_id, zonas(nombre)")
      .eq("chofer_id", userId)
      .in("estado", ["completado", "en_rendicion"])
      .order("fecha", { ascending: false })
      .limit(20)

    return NextResponse.json({
      usuario: usuario || { id: userId, nombre: auth.user.email, email: auth.user.email },
      viaje_activo: viajeActivo,
      historial: historial || [],
    })
  } catch (error: any) {
    console.error("[chofer] Error en GET /api/chofer/me:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
