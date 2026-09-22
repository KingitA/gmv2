import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireOficina, errorJson } from "@/lib/viajes/servidor"
import { armarHojaRuta } from "@/lib/viajes/hoja-ruta"

// GET /api/viajes/[id]/hoja-ruta — la hoja de ruta calculada (oficina).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireOficina()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { id } = await params
    const hoja = await armarHojaRuta(supabase, id)
    if (!hoja) return errorJson("Viaje no encontrado", 404)
    return NextResponse.json(hoja)
  } catch (error: any) {
    console.error("[viajes] Error en GET hoja-ruta:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
