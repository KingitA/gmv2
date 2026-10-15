import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireOficina, errorJson } from "@/lib/viajes/servidor"

// PATCH /api/viajes/plan/zona — datos de la zona para armar el calendario.
// Body: { zona_id, dias_viaje?, en_calendario?, frecuencia_dias? }
//   dias_viaje      → duración habitual del viaje a esa zona (1..15)
//   frecuencia_dias → 1 = todos los días hábiles · N = cada N días · null = cuando haga falta
//   en_calendario   → (pantalla vieja) false = cuando haga falta. La base los mantiene sincronizados.
export async function PATCH(request: NextRequest) {
  const auth = await requireOficina()
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    if (!body.zona_id) return errorJson("zona_id es requerido")
    const cambios: Record<string, any> = {}
    if (body.dias_viaje !== undefined) cambios.dias_viaje = Math.min(15, Math.max(1, Math.round(Number(body.dias_viaje)) || 1))
    if (body.en_calendario !== undefined) cambios.en_calendario = Boolean(body.en_calendario)
    if (body.frecuencia_dias !== undefined) {
      if (body.frecuencia_dias === null) cambios.frecuencia_dias = null
      else {
        const n = Math.round(Number(body.frecuencia_dias))
        if (!(n >= 1 && n <= 365)) return errorJson("Frecuencia inválida (1 a 365 días)")
        cambios.frecuencia_dias = n
      }
    }
    if (!Object.keys(cambios).length) return errorJson("Nada para cambiar")
    const supabase = await createClient()
    const { error } = await supabase.from("zonas").update(cambios).eq("id", body.zona_id)
    if (error) throw error
    return NextResponse.json({ success: true, ...cambios })
  } catch (error: any) {
    console.error("[viajes/plan/zona] PATCH:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
