import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { updateProductEmbedding, updateClienteEmbedding, updateProveedorEmbedding } from "@/lib/actions/embeddings"

export async function POST(request: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { entity, id } = await request.json()

    if (!entity || !id) {
        return NextResponse.json({ error: "entity and id required" }, { status: 400 })
    }

    try {
        switch (entity) {
            case "articulos":  await updateProductEmbedding(id);  break
            case "clientes":   await updateClienteEmbedding(id);  break
            case "proveedores": await updateProveedorEmbedding(id); break
            default:
                return NextResponse.json({ error: `Unknown entity: ${entity}` }, { status: 400 })
        }
        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error(`[embed] Error updating ${entity} ${id}:`, error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
