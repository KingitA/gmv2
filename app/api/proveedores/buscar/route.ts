import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { buscarEntidad } from "@/lib/search/hybrid"

const SELECT = "id, nombre, cuit, email, telefono, direccion, activo"

// ?q=texto  ?limit=N (1..300, por defecto 20)  ?inactivos=1 (incluye dados de baja)
// Orden de relevancia; `_parecido: true` en los que vinieron solo por parecido.
export async function GET(request: NextRequest) {
    try {
        const auth = await requireAuth()
        if (auth.error) return auth.error

        const { searchParams } = new URL(request.url)
        const q = searchParams.get("q")?.trim()
        const limit = Math.min(300, Math.max(1, Number(searchParams.get("limit")) || 20))
        const incluirInactivos = searchParams.get("inactivos") === "1"

        if (!q || q.length < 2) return NextResponse.json([])

        const supabase = createAdminClient()

        const { ids, parecidos } = await buscarEntidad("proveedores", q, { limit, incluirInactivos })
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
        return NextResponse.json(
            ids.map((id) => {
                const r = map.get(id)
                return r && parecidos.has(id) ? { ...r, _parecido: true } : r
            }).filter(Boolean),
        )
    } catch (error: any) {
        console.error("[proveedores/buscar] Error:", error)
        return NextResponse.json({ error: error.message || "Error buscando proveedores" }, { status: 500 })
    }
}
