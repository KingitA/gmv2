import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { cargarComprados } from "@/lib/vendedor/comprados"

// GET /api/vendedor/cliente/[id]/comprados?q=
// Artículos que el cliente COMPRÓ (facturados en comprobantes_venta), con el
// último precio al que se LE FACTURÓ y el comprobante de origen — es la base
// de la pantalla de devoluciones: se devuelve lo que se vendió, al precio
// facturado, y la NC después se asocia a ese comprobante.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { id } = await params
    const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() || ""

    const { data: cliente } = await supabase
      .from("clientes")
      .select("id")
      .eq("id", id)
      .in("vendedor_id", session.vendedorIds)
      .maybeSingle()
    if (!cliente) {
      return NextResponse.json({ error: "Cliente inexistente o no asignado a vos." }, { status: 404 })
    }

    let comprados = await cargarComprados(supabase, id)
    if (!comprados.length) return NextResponse.json({ comprados: [] })

    if (q) {
      comprados = comprados.filter(
        (c: any) =>
          c.descripcion?.toLowerCase().includes(q) ||
          c.sku?.toLowerCase?.().includes(q) ||
          (Array.isArray(c.ean13) ? c.ean13.some((e: string) => e?.includes(q)) : String(c.ean13 || "").includes(q))
      )
    }

    comprados.sort((a: any, b: any) => (b.ultima_fecha || "").localeCompare(a.ultima_fecha || ""))
    return NextResponse.json({ comprados: comprados.slice(0, 100) })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/cliente/[id]/comprados:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
