import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { fetchAllRows } from "@/lib/supabase/fetch-all"

// GET /api/vendedor/articulos-ventas
// Mapa articulo_id → unidades vendidas (últimos 180 días) para "ordenar por
// ventas" en los listados de la app. Lee la vista v_articulos_ventas
// (migración 20260826); si todavía no está aplicada devuelve un mapa vacío
// (el orden por ventas queda neutro, nada se rompe).
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    let rows: any[] = []
    try {
      rows = await fetchAllRows(
        () => supabase.from("v_articulos_ventas").select("articulo_id, unidades_180d, pedidos_180d"),
        "articulo_id"
      )
    } catch (e: any) {
      console.warn("[vendedor] v_articulos_ventas no disponible:", e?.message)
      return NextResponse.json({ ventas: {}, disponible: false })
    }
    const ventas: Record<string, number> = {}
    for (const r of rows) ventas[r.articulo_id] = Number(r.unidades_180d) || 0
    return NextResponse.json({ ventas, disponible: true })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/articulos-ventas:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
