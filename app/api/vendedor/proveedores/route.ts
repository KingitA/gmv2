import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/proveedores
// Proveedores que tienen artículos activos en el catálogo, con su cantidad —
// alimenta la navegación "por proveedor" del catálogo del vendedor.
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()

    const { data: arts } = await supabase
      .from("articulos")
      .select("proveedor_id")
      .eq("activo", true)
      .gt("precio_base", 0) // sin precio no se vende: fuera del catálogo del vendedor
      .not("proveedor_id", "is", null)

    const cantidadPorProv = new Map<string, number>()
    for (const a of arts || []) {
      cantidadPorProv.set(a.proveedor_id, (cantidadPorProv.get(a.proveedor_id) || 0) + 1)
    }
    if (!cantidadPorProv.size) return NextResponse.json({ proveedores: [] })

    const { data: provs } = await supabase
      .from("proveedores")
      .select("id, nombre, sigla")
      .in("id", [...cantidadPorProv.keys()])
      .eq("activo", true)

    const proveedores = (provs || [])
      .map((p: any) => ({
        id: p.id,
        nombre: p.nombre,
        sigla: p.sigla || null,
        cantidad: cantidadPorProv.get(p.id) || 0,
      }))
      .sort((a: any, b: any) => b.cantidad - a.cantidad)

    return NextResponse.json({ proveedores })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/proveedores:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
