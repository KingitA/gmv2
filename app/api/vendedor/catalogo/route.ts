import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/catalogo
// Devuelve la taxonomía completa (rubros → categorías → subcategorías)
// con el conteo de artículos activos de cada nodo. Solo lectura.
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()

    const [{ data: rubros }, { data: categorias }, { data: subcategorias }] = await Promise.all([
      supabase.from("rubros").select("id, nombre, slug, orden").order("orden"),
      supabase.from("categorias").select("id, rubro_id, nombre, orden").order("orden"),
      supabase.from("subcategorias").select("id, categoria_id, nombre, orden").order("orden"),
    ])

    // Conteo de artículos activos por categoría/subcategoría (paginado: PostgREST corta en 1000)
    const countCat = new Map<string, number>()
    const countSub = new Map<string, number>()
    const pageSize = 1000
    for (let from = 0; ; from += pageSize) {
      const { data: page, error } = await supabase
        .from("articulos")
        .select("categoria_id, subcategoria_id")
        .eq("activo", true)
        .range(from, from + pageSize - 1)
      if (error) throw error
      for (const a of page || []) {
        if (a.categoria_id) countCat.set(a.categoria_id, (countCat.get(a.categoria_id) || 0) + 1)
        if (a.subcategoria_id) countSub.set(a.subcategoria_id, (countSub.get(a.subcategoria_id) || 0) + 1)
      }
      if (!page || page.length < pageSize) break
    }

    const subsPorCategoria = new Map<string, any[]>()
    for (const s of subcategorias || []) {
      const cant = countSub.get(s.id) || 0
      if (!cant) continue
      const list = subsPorCategoria.get(s.categoria_id) || []
      list.push({ id: s.id, nombre: s.nombre, cantidad: cant })
      subsPorCategoria.set(s.categoria_id, list)
    }

    const resultado = (rubros || []).map((r) => ({
      id: r.id,
      nombre: r.nombre,
      slug: r.slug,
      categorias: (categorias || [])
        .filter((c) => c.rubro_id === r.id)
        .map((c) => ({
          id: c.id,
          nombre: c.nombre,
          cantidad: countCat.get(c.id) || 0,
          subcategorias: subsPorCategoria.get(c.id) || [],
        }))
        .filter((c) => c.cantidad > 0),
    }))

    return NextResponse.json({ rubros: resultado })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/catalogo:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
