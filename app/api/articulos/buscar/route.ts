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

        const [{ data: textResults, error }, vectorResults] = await Promise.all([
            supabase
                .from("articulos")
                .select("*,proveedor:proveedores(nombre,tipo_descuento),marca:marca_id(codigo,descripcion)")
                .or(`sku.ilike.%${q}%,descripcion.ilike.%${q}%`)
                .eq("activo", true)
                .limit(30),
            searchProductsByVector(q, 0.35, 20),
        ])

        if (error) {
            console.error("[articulos/buscar] Supabase error:", error)
            throw error
        }

        const textIds = new Set((textResults || []).map((r: any) => r.id))
        const merged = [
            ...(textResults || []),
            ...vectorResults.filter((r: any) => !textIds.has(r.id)),
        ].slice(0, 20)

        return NextResponse.json(merged)
    } catch (error: any) {
        console.error("[articulos/buscar] Error:", error)
        return NextResponse.json({ error: error.message || "Error buscando artículos" }, { status: 500 })
    }
}
