import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { viajesDelChofer } from "@/lib/viajes/chofer"

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

    // Viajes donde es titular o acompañante
    const misViajes = await viajesDelChofer(supabase, userId)

    // Viaje activo: despachado (listo para iniciar) o en curso. Primero el en_curso.
    let viajeActivo: any = null
    let historial: any[] = []
    if (misViajes.length) {
      const [{ data: activos }, { data: hist }] = await Promise.all([
        supabase
          .from("viajes")
          .select("id, nombre, fecha, estado, chofer_id, zona_id, zonas!zona_id(nombre)")
          .in("id", misViajes)
          .in("estado", ["despachado", "en_curso"])
          .order("fecha", { ascending: true }),
        supabase
          .from("viajes")
          .select("id, nombre, fecha, estado, chofer_id, zona_id, zonas!zona_id(nombre)")
          .in("id", misViajes)
          .in("estado", ["completado", "en_rendicion"])
          .order("fecha", { ascending: false })
          .limit(20),
      ])
      viajeActivo = (activos || []).find((v: any) => v.estado === "en_curso") || (activos || [])[0] || null
      historial = hist || []
    }

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
