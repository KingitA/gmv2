import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { searchProductsByVector } from "@/lib/actions/embeddings"

export async function GET(request: NextRequest) {
    try {
        const auth = await requireAuth()
        if (auth.error) return auth.error

        const { searchParams } = new URL(request.url)
        const q = searchParams.get("q")?.trim()

        if (!q || q.length < 2) return NextResponse.json([])

        const supabase = createAdminClient()

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
        const merged = [
            ...sorted,
            ...vectorResults.filter((r: any) => !textIds.has(r.id)),
        ]

        return NextResponse.json(merged)
    } catch (error: any) {
        console.error("[articulos/buscar] Error:", error)
        return NextResponse.json({ error: error.message || "Error buscando artículos" }, { status: 500 })
    }
}
