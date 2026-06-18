import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { hybridSearchIds } from "@/lib/search/hybrid"

const SELECT = "id, nombre, cuit, email, telefono, direccion, activo"

export async function GET(request: NextRequest) {
    try {
        const auth = await requireAuth()
        if (auth.error) return auth.error

        const { searchParams } = new URL(request.url)
        const q = searchParams.get("q")?.trim()

        if (!q || q.length < 2) return NextResponse.json([])

        const supabase = createAdminClient()

        const ids = await hybridSearchIds("proveedores", q, 20)
        if (ids.length === 0) return NextResponse.json([])

        const { data, error } = await supabase
            .from("proveedores")
            .select(SELECT)
            .in("id", ids)

        if (error) {
            console.error("[proveedores/buscar] Supabase error:", error)
            throw error
        }

        const map = new Map((data || []).map((r: any) => [r.id, r]))
        return NextResponse.json(ids.map((id) => map.get(id)).filter(Boolean))
    } catch (error: any) {
        console.error("[proveedores/buscar] Error:", error)
        return NextResponse.json({ error: error.message || "Error buscando proveedores" }, { status: 500 })
    }
}
