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

    // Repetida = mismo nombre sin importar provincia, mayúsculas ni acentos: es lo que
    // exige la base (índice único uq_localidades_nombre sobre norm_txt(nombre)). Antes se
    // comparaba nombre + provincia y "NEUQUEN" con otra provincia pasaba el chequeo y
    // reventaba en la base con el error en inglés (17/11/2026).
    const existente = await localidadConMismoNombre(supabase, nombre)
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
    if (error) {
      // Otro la creó en el mismo instante: se usa esa
      if ((error as { code?: string }).code === "23505") {
        const otra = await localidadConMismoNombre(supabase, nombre)
        if (otra) return NextResponse.json({ error: `La localidad "${otra.nombre}" (${otra.provincia || "sin provincia"}) ya existe.`, localidad_existente: otra }, { status: 409 })
        return NextResponse.json({ error: `Ya existe una localidad llamada "${nombre}".` }, { status: 409 })
      }
      throw error
    }

    return NextResponse.json({ success: true, localidad })
  } catch (error: any) {
    console.error("[vendedor] Error en POST /api/vendedor/localidades:", error)
    return NextResponse.json({ error: "No se pudo crear la localidad. Probá de nuevo o pedíselo a la oficina." }, { status: 500 })
  }
}

/** Igual que norm_txt() de la base: minúsculas, sin espacios en los bordes y sin acentos. */
function normTxt(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
}

async function localidadConMismoNombre(supabase: Awaited<ReturnType<typeof createClient>>, nombre: string) {
  const n = normTxt(nombre)
  // Son pocas (cientos): se comparan todas igual que la base
  const { data } = await supabase.from("localidades").select("id, nombre, provincia, codigo_postal, zona_id").limit(5000)
  return (data || []).find((l) => normTxt(l.nombre) === n) ?? null
}
