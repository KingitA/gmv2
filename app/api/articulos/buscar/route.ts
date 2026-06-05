import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { searchProductsByVector } from "@/lib/actions/embeddings"
import { padEan13 } from "@/lib/utils/ean"

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
                    .select("*,proveedor:proveedores(nombre,tipo_descuento),marca:marca_id(codigo,descripcion)")
                    .or(`ean13.cs.{"${code}"},codigo_bulto.eq.${code}`)
                    .eq("activo", true)
                if (porEan && porEan.length > 0) return NextResponse.json(porEan)
            }
        }

        // Buscar proveedores y marcas que coincidan con el término
        const [provRes, marcaRes] = await Promise.all([
            supabase.from("proveedores").select("id").ilike("nombre", `%${q}%`),
            supabase.from("marcas").select("id").or(`descripcion.ilike.%${q}%,codigo.ilike.%${q}%`),
        ])

        const provIds = (provRes.data || []).map((r: any) => r.id)
        const marcaIds = (marcaRes.data || []).map((r: any) => r.id)

        // Construir filtro OR: descripcion, sku, proveedor, marca
        let orParts = [`descripcion.ilike.%${q}%`, `sku.ilike.%${q}%`]
        if (provIds.length > 0) orParts.push(`proveedor_id.in.(${provIds.join(",")})`)
        if (marcaIds.length > 0) orParts.push(`marca_id.in.(${marcaIds.join(",")})`)

        const [{ data: textResults, error }, vectorResults] = await Promise.all([
            supabase
                .from("articulos")
                .select("*,proveedor:proveedores(nombre,tipo_descuento),marca:marca_id(codigo,descripcion)")
                .or(orParts.join(","))
                .eq("activo", true)
                .order("descripcion", { ascending: true }),
            searchProductsByVector(q, 0.35, 50),
        ])

        if (error) {
            console.error("[articulos/buscar] Supabase error:", error)
            throw error
        }

        // Relevancia: primero los que empiezan con el término, luego el resto
        const qLower = q.toLowerCase()
        const sorted = (textResults || []).sort((a: any, b: any) => {
            const aStarts = a.descripcion?.toLowerCase().startsWith(qLower) ? 0 : 1
            const bStarts = b.descripcion?.toLowerCase().startsWith(qLower) ? 0 : 1
            if (aStarts !== bStarts) return aStarts - bStarts
            return (a.descripcion || "").localeCompare(b.descripcion || "")
        })

        const textIds = new Set(sorted.map((r: any) => r.id))
        const vectorOnly = vectorResults.filter((r: any) => !textIds.has(r.id))

        // Los resultados vectoriales no traen joins — completarlos con una sola query
        let vectorFull: any[] = []
        if (vectorOnly.length > 0) {
            const { data } = await supabase
                .from("articulos")
                .select("*,proveedor:proveedores(nombre,tipo_descuento),marca:marca_id(codigo,descripcion)")
                .in("id", vectorOnly.map((r: any) => r.id))
                .eq("activo", true)
            vectorFull = data || []
        }

        return NextResponse.json([...sorted, ...vectorFull])
    } catch (error: any) {
        console.error("[articulos/buscar] Error:", error)
        return NextResponse.json({ error: error.message || "Error buscando artículos" }, { status: 500 })
    }
}
