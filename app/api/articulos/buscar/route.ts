import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { padEan13 } from "@/lib/utils/ean"
import { hybridSearchIds } from "@/lib/search/hybrid"
import { buscarConFiltros } from "@/lib/search/buscar-con-filtros"

const SELECT = "*,proveedor:proveedores(nombre,tipo_descuento),marca:marca_id(codigo,descripcion)"

export async function GET(request: NextRequest) {
    try {
        const auth = await requireAuth()
        if (auth.error) return auth.error

        const { searchParams } = new URL(request.url)
        const q = searchParams.get("q")?.trim()
        const proveedor = searchParams.get("proveedor")?.trim() || null

        if (!q || q.length < 2) return NextResponse.json([])

        const supabase = createAdminClient()

        // EAN / codigo_bulto exacto primero (scanner)
        if (/^\d{8,14}$/.test(q)) {
            const qPadded = padEan13(q)
            const queries = qPadded !== q ? [qPadded, q] : [qPadded]
            for (const code of queries) {
                let ean = supabase
                    .from("articulos")
                    .select(SELECT)
                    .or(`ean13.cs.{"${code}"},codigo_bulto.eq.${code}`)
                    .eq("activo", true)
                if (proveedor) ean = ean.eq("proveedor_id", proveedor)
                const { data: porEan } = await ean
                if (porEan && porEan.length > 0) return NextResponse.json(porEan)
            }
        }

        // Con proveedor filtrado, buscamos DENTRO del proveedor combinando relevancia
        // (léxico + embeddings) y completitud literal (todos los que matchean por
        // descripción/marca/proveedor en search_text). No es el top-50 global recortado.
        if (proveedor) {
            const data = await buscarConFiltros({
                sb: supabase, table: "articulos", entity: "articulos", q, select: SELECT, hayFiltro: true,
                literalLimit: 5000, // el export por proveedor+texto no debe cortarse
                aplicarFiltros: (qb) => qb.eq("activo", true).eq("proveedor_id", proveedor),
            })
            return NextResponse.json(data)
        }

        // Sin filtro: búsqueda híbrida unificada global (léxica trigram + vector), top-50
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
