import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { padEan13 } from "@/lib/utils/ean"
import { hybridSearchIds } from "@/lib/search/hybrid"

const SELECT = "*,proveedor:proveedores(nombre,tipo_descuento),marca:marca_id(codigo,descripcion)"

export async function GET(request: NextRequest) {
    try {
        const auth = await requireAuth()
        if (auth.error) return auth.error

        const { searchParams } = new URL(request.url)
        const q = searchParams.get("q")?.trim()

        if (!q || q.length < 2) return NextResponse.json([])

        const supabase = createAdminClient()

        // EAN / codigo_bulto exacto primero (scanner)
        if (/^\d{8,14}$/.test(q)) {
            const qPadded = padEan13(q)
            const queries = qPadded !== q ? [qPadded, q] : [qPadded]
            for (const code of queries) {
                const { data: porEan } = await supabase
                    .from("articulos")
                    .select(SELECT)
                    .or(`ean13.cs.{"${code}"},codigo_bulto.eq.${code}`)
                    .eq("activo", true)
                if (porEan && porEan.length > 0) return NextResponse.json(porEan)
            }
        }

        // Búsqueda híbrida unificada (léxica trigram + vector como complemento)
        const ids = await hybridSearchIds("articulos", q, 50)
        if (ids.length === 0) return NextResponse.json([])

        const { data, error } = await supabase
            .from("articulos")
            .select(SELECT)
            .in("id", ids)
            .eq("activo", true)

        if (error) {
            console.error("[articulos/buscar] Supabase error:", error)
            throw error
        }

        // Conservar el orden de relevancia que devolvió el motor
        const map = new Map((data || []).map((r: any) => [r.id, r]))
        return NextResponse.json(ids.map((id) => map.get(id)).filter(Boolean))
    } catch (error: any) {
        console.error("[articulos/buscar] Error:", error)
        return NextResponse.json({ error: error.message || "Error buscando artículos" }, { status: 500 })
    }
}
