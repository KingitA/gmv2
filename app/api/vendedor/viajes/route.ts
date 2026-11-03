import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { listarViajesVendedor } from "@/lib/vendedor/viajes-reparto"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/viajes — CALENDARIO de reparto que arma la oficina (03/11/2026):
// viajes que tocan zonas donde el vendedor tiene clientes, de los últimos 3 meses a fin del
// mes que viene, con chofer (si ya está) y sus pedidos cargados. lib/vendedor/viajes-reparto.ts
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const viajes = await listarViajesVendedor(supabase as any, createAdminClient() as any, session.vendedorIds)
    return NextResponse.json({ viajes })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/viajes:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/vendedor/viajes — ya no: los viajes los programa la oficina (decisión de Juan
// 03/11/2026). Una APK vieja que cree un "levantamiento" recibe este rechazo.
export async function POST() {
  const session = await requireVendedor()
  if (session.error) return session.error
  return NextResponse.json(
    { error: "Los viajes los programa la oficina: entrá al viaje del calendario y cargá los pedidos ahí.", codigo: "VIAJES_LOS_PROGRAMA_OFICINA" },
    { status: 403 },
  )
}
