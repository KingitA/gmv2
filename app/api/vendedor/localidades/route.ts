import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// POST /api/vendedor/localidades
// Alta de localidad desde la calle (el vendedor abre una zona nueva y no
// depende de oficina): nombre + provincia obligatorios, código postal y zona
// opcionales. Anti-duplicado por nombre+provincia (case-insensitive).
export async function POST(request: Request) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const body = await request.json()
    const nombre = String(body.nombre || "").trim().toUpperCase()
    const provincia = String(body.provincia || "").trim()
    const codigoPostal = String(body.codigo_postal || "").trim() || null
    const zonaId = body.zona_id || null

    if (!nombre || !provincia) {
      return NextResponse.json({ error: "Nombre y provincia son obligatorios." }, { status: 400 })
    }

    const { data: existente } = await supabase
      .from("localidades")
      .select("id, nombre, provincia")
      .ilike("nombre", nombre)
      .ilike("provincia", provincia)
      .maybeSingle()
    if (existente) {
      return NextResponse.json(
        { error: `La localidad "${existente.nombre}" (${existente.provincia}) ya existe.`, localidad_existente: existente },
        { status: 409 }
      )
    }

    if (zonaId) {
      const { data: zona } = await supabase.from("zonas").select("id").eq("id", zonaId).maybeSingle()
      if (!zona) return NextResponse.json({ error: "Zona inexistente." }, { status: 400 })
    }

    const { data: localidad, error } = await supabase
      .from("localidades")
      .insert({ nombre, provincia, codigo_postal: codigoPostal, zona_id: zonaId })
      .select("id, nombre, provincia, codigo_postal, zona_id")
      .single()
    if (error) throw error

    return NextResponse.json({ success: true, localidad })
  } catch (error: any) {
    console.error("[vendedor] Error en POST /api/vendedor/localidades:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
