import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// POST /api/vendedor/buscar-foto/confirmar
// Aprendizaje de la búsqueda por foto: cuando el vendedor elige una
// sugerencia, la descripción detectada queda como alias del artículo
// (articulos_alias, confianza='foto'). El trigger de articulos_alias refresca
// el search_text del artículo, así la próxima foto del mismo producto
// matchea directo por la búsqueda híbrida.
// Body: { articulo_id, descripcion_detectada }

export async function POST(request: Request) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const { articulo_id, descripcion_detectada } = await request.json()
    const alias = String(descripcion_detectada || "").trim()
    if (!articulo_id || alias.length < 4) {
      return NextResponse.json({ error: "articulo_id y descripcion_detectada son requeridos" }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: articulo } = await supabase
      .from("articulos")
      .select("id, proveedor_id")
      .eq("id", articulo_id)
      .maybeSingle()
    if (!articulo) {
      return NextResponse.json({ error: "Artículo inexistente" }, { status: 404 })
    }

    const admin = createAdminClient()

    // Si el alias ya existe para este artículo, solo suma un uso
    const { data: existente } = await admin
      .from("articulos_alias")
      .select("id, veces_usado")
      .eq("articulo_id", articulo_id)
      .ilike("alias_texto", alias)
      .maybeSingle()

    if (existente) {
      await admin
        .from("articulos_alias")
        .update({ veces_usado: (existente.veces_usado || 0) + 1, updated_at: new Date().toISOString() })
        .eq("id", existente.id)
    } else {
      const { error: insErr } = await admin.from("articulos_alias").insert({
        articulo_id,
        proveedor_id: articulo.proveedor_id || null,
        alias_texto: alias,
        confianza: "foto",
        veces_usado: 1,
      })
      if (insErr) throw insErr
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[vendedor] Error en POST /api/vendedor/buscar-foto/confirmar:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
