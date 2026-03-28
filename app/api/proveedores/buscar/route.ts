import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { searchProveedoresByVector } from "@/lib/actions/embeddings"

export async function GET(request: NextRequest) {
    try {
        const auth = await requireAuth()
        if (auth.error) return auth.error

        const { searchParams } = new URL(request.url)
        const q = searchParams.get("q")?.trim()

        if (!q || q.length < 2) return NextResponse.json([])

        const supabase = createAdminClient()

        const [{ data: textResults }, vectorResults] = await Promise.all([
            supabase
                .from("proveedores")
                .select("id, nombre, cuit, email, telefono, direccion, activo")
                .or(`nombre.ilike.%${q}%,cuit.ilike.%${q}%`)
                .limit(20),
            searchProveedoresByVector(q, 0.35, 20),
        ])

        const textIds = new Set((textResults || []).map((r: any) => r.id))
        const merged = [
            ...(textResults || []),
            ...vectorResults.filter((r: any) => !textIds.has(r.id)),
        ].slice(0, 20)

        return NextResponse.json(merged)
    } catch (error: any) {
        console.error("[proveedores/buscar] Error:", error)
        return NextResponse.json({ error: error.message || "Error buscando proveedores" }, { status: 500 })
    }
}
