import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/catalogos-ficha
// Catálogos para los selects de la ficha del cliente: condiciones de pago,
// condiciones de entrega (código + nombre) y localidades (con provincia).
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()

    const [{ data: pagoCat }, { data: entregaCat }, { data: localidades }] = await Promise.all([
      supabase.from("condiciones_pago").select("id, nombre").eq("activo", true).order("nombre"),
      supabase.from("condiciones_entrega").select("id, codigo, nombre").eq("activo", true).order("nombre"),
      supabase.from("localidades").select("id, nombre, provincia").order("provincia").order("nombre"),
    ])

    return NextResponse.json({
      condiciones_pago: pagoCat || [],
      condiciones_entrega: entregaCat || [],
      localidades: localidades || [],
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/catalogos-ficha:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
