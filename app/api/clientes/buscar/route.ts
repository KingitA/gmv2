import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { searchClientesByVector } from "@/lib/actions/embeddings"

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
                .from("clientes")
                .select("id, nombre, razon_social, nombre_razon_social, cuit, codigo_cliente, direccion, localidad, provincia, tipo_canal, activo, metodo_facturacion, lista_precio_id, condicion_pago, condicion_entrega, lista_limpieza_id, metodo_limpieza, lista_perf0_id, metodo_perf0, lista_perf_plus_id, metodo_perf_plus, vendedor_id")
                .eq("activo", true)
                .or(
                    `nombre.ilike.%${q}%,` +
                    `razon_social.ilike.%${q}%,` +
                    `direccion.ilike.%${q}%,` +
                    `localidad.ilike.%${q}%,` +
                    `cuit.ilike.%${q}%`
                )
                .limit(20),
            searchClientesByVector(q, 0.35, 20),
        ])

        const textIds = new Set((textResults || []).map((r: any) => r.id))
        const merged = [
            ...(textResults || []),
            ...vectorResults.filter((r: any) => !textIds.has(r.id)),
        ].slice(0, 20)

        return NextResponse.json(merged)
    } catch (error: any) {
        console.error("[clientes/buscar] Error:", error)
        return NextResponse.json({ error: error.message || "Error buscando clientes" }, { status: 500 })
    }
}
