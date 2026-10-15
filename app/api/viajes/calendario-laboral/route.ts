import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireOficina, errorJson } from "@/lib/viajes/servidor"
import { ausenciasEntre, diasEspeciales } from "@/lib/viajes/calendario-laboral"

// GET /api/viajes/calendario-laboral?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
// Feriados (y si se trabaja) y vacaciones del personal, para los calendarios.
// Service key: las tablas tienen RLS; el permiso lo controla requireOficina.
export async function GET(request: NextRequest) {
  const auth = await requireOficina()
  if (auth.error) return auth.error
  const u = new URL(request.url).searchParams
  const desde = u.get("desde") || ""
  const hasta = u.get("hasta") || ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || hasta < desde) return errorJson("desde y hasta (AAAA-MM-DD) son requeridos")
  try {
    const db = createAdminClient()
    const [especiales, ausencias] = await Promise.all([diasEspeciales(db, desde, hasta), ausenciasEntre(db, desde, hasta)])
    return NextResponse.json({ especiales, ausencias })
  } catch (error: any) {
    console.error("[viajes/calendario-laboral] GET:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
