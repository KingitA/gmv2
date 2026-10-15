import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireOficina, errorJson } from "@/lib/viajes/servidor"
import { decidirDia } from "@/lib/viajes/calendario-laboral"

// POST /api/viajes/plan/dia — ¿se trabaja ese día?
// Body: { fecha, trabajamos: true | false | null, nombre?, nota? }
//   Feriados: se decide si se trabaja (se puede cambiar después; ej. un feriado en debate).
//   Cualquier otro día: se puede marcar como "no trabajamos" (o un sábado como "trabajamos").
//   Queda quién y cuándo en la bitácora (trigger de calendario_dias).
export async function POST(request: NextRequest) {
  const auth = await requireOficina()
  if (auth.error) return auth.error
  try {
    const b = await request.json()
    if (typeof b.fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) return errorJson("fecha (AAAA-MM-DD) es requerida")
    if (b.trabajamos !== true && b.trabajamos !== false && b.trabajamos !== null) return errorJson("trabajamos tiene que ser sí, no o sin decidir")
    const db = createAdminClient()
    await decidirDia(db, { fecha: b.fecha, trabajamos: b.trabajamos, nombre: typeof b.nombre === "string" ? b.nombre : null, nota: typeof b.nota === "string" ? b.nota : null, usuarioId: auth.user.id })
    // si Jarvis había dejado la pregunta en "Para decidir", se cierra (ya se decidió acá)
    if (b.trabajamos !== null) {
      await db.from("ai_agenda_events").update({ status: "completada", cerrado_por: auth.user.id, cerrado_at: new Date().toISOString(), cierre_nota: "Decidido desde el calendario", updated_at: new Date().toISOString() })
        .eq("event_type", "propuesta").eq("clave", `dia_laboral:${b.fecha}`).eq("status", "pendiente")
    }
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[viajes/plan/dia] POST:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
