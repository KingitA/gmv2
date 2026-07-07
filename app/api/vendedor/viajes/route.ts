import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/viajes — viajes de levantamiento del vendedor
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()

    const { data: viajes, error } = await supabase
      .from("viajes")
      .select("id, nombre, estado, fecha_inicio, fecha_fin_estimada, created_at, viaje_zonas(zona_id, zonas(id, nombre))")
      .eq("tipo", "levantamiento")
      .in("vendedor_id", session.vendedorIds)
      .neq("estado", "cancelado")
      .order("created_at", { ascending: false })
      .limit(50)
    if (error) throw error

    return NextResponse.json({
      viajes: (viajes || []).map((v: any) => ({
        id: v.id,
        nombre: v.nombre,
        estado: v.estado,
        fecha_inicio: v.fecha_inicio,
        fecha_fin_estimada: v.fecha_fin_estimada,
        zonas: (v.viaje_zonas || []).map((vz: any) => vz.zonas).filter(Boolean),
      })),
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/viajes:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/vendedor/viajes — crear viaje de levantamiento
// Body: { nombre?, fecha_inicio, fecha_fin_estimada?, zona_ids: string[] }
export async function POST(request: Request) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const body = await request.json()
    const { nombre, fecha_inicio, fecha_fin_estimada, zona_ids } = body

    if (!fecha_inicio || !Array.isArray(zona_ids) || !zona_ids.length) {
      return NextResponse.json({ error: "Se requieren fecha_inicio y al menos una zona." }, { status: 400 })
    }

    const { data: zonas } = await supabase.from("zonas").select("id, nombre").in("id", zona_ids)
    if (!zonas || zonas.length !== zona_ids.length) {
      return NextResponse.json({ error: "Alguna de las zonas no existe." }, { status: 400 })
    }

    const nombreFinal =
      (typeof nombre === "string" && nombre.trim()) ||
      `Levantamiento ${zonas.map((z: any) => z.nombre).join(" + ")} · ${fecha_inicio}`

    const { data: viaje, error } = await supabase
      .from("viajes")
      .insert({
        nombre: nombreFinal,
        tipo: "levantamiento",
        vendedor_id: session.vendedorIds[0],
        estado: "en_curso",
        fecha: fecha_inicio, // compat: viajes.fecha legacy
        fecha_inicio,
        fecha_fin_estimada: fecha_fin_estimada || null,
        zona_id: zona_ids[0], // compat: zona principal
      })
      .select("id")
      .single()
    if (error) throw error

    const { error: vzError } = await supabase
      .from("viaje_zonas")
      .insert(zona_ids.map((z: string) => ({ viaje_id: viaje.id, zona_id: z })))
    if (vzError) throw vzError

    return NextResponse.json({ success: true, viaje_id: viaje.id }, { status: 201 })
  } catch (error: any) {
    console.error("[vendedor] Error en POST /api/vendedor/viajes:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
