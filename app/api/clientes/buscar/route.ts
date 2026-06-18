import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { hybridSearchIds } from "@/lib/search/hybrid"

const SELECT = "id, nombre, razon_social, nombre_razon_social, cuit, codigo_cliente, direccion, localidad, provincia, tipo_canal, activo, metodo_facturacion, lista_precio_id, condicion_pago, condicion_entrega, lista_limpieza_id, metodo_limpieza, lista_perf0_id, metodo_perf0, lista_perf_plus_id, metodo_perf_plus, vendedor_id"

export async function GET(request: NextRequest) {
    try {
        const auth = await requireAuth()
        if (auth.error) return auth.error

        const { searchParams } = new URL(request.url)
        const q = searchParams.get("q")?.trim()

        if (!q || q.length < 2) return NextResponse.json([])

        const supabase = createAdminClient()

        const ids = await hybridSearchIds("clientes", q, 20)
        if (ids.length === 0) return NextResponse.json([])

        const { data, error } = await supabase
            .from("clientes")
            .select(SELECT)
            .in("id", ids)

        if (error) {
            console.error("[clientes/buscar] Supabase error:", error)
            throw error
        }

        const map = new Map((data || []).map((r: any) => [r.id, r]))
        return NextResponse.json(ids.map((id) => map.get(id)).filter(Boolean))
    } catch (error: any) {
        console.error("[clientes/buscar] Error:", error)
        return NextResponse.json({ error: error.message || "Error buscando clientes" }, { status: 500 })
    }
}
