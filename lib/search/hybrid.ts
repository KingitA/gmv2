import { createAdminClient } from "@/lib/supabase/admin"
import {
    searchProductsByVector,
    searchClientesByVector,
    searchProveedoresByVector,
} from "@/lib/actions/embeddings"

export type SearchEntity = "articulos" | "clientes" | "proveedores"

const RPC: Record<SearchEntity, string> = {
    articulos: "search_articulos",
    clientes: "search_clientes",
    proveedores: "search_proveedores",
}

// Si la búsqueda léxica trae al menos esto, NO se llama al vector (instantáneo/gratis).
// El vector (Gemini) solo complementa cuando lo léxico trae poco/nada.
const FALLBACK_MIN = 4

// Devuelve null si la RPC no está disponible (aún no aplicado el SQL) para poder
// degradar a ilike sin regresión; [] significa "RPC OK pero sin resultados".
async function lexicalIds(entity: SearchEntity, q: string, matchCount: number): Promise<string[] | null> {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc(RPC[entity], { q, match_count: matchCount })
    if (error) {
        console.error(`[search] RPC ${RPC[entity]} error:`, error.message)
        return null
    }
    return (data || []).map((r: any) => r.id as string)
}

// Fallback léxico básico (ilike) equivalente al comportamiento previo, por si la
// RPC todavía no fue aplicada en la base. Garantiza que nunca haya regresión.
async function ilikeFallbackIds(entity: SearchEntity, q: string, matchCount: number): Promise<string[]> {
    const supabase = createAdminClient()
    const like = `%${q}%`
    if (entity === "clientes") {
        const { data } = await supabase
            .from("clientes")
            .select("id")
            .eq("activo", true)
            .or(`nombre.ilike.${like},razon_social.ilike.${like},nombre_razon_social.ilike.${like},direccion.ilike.${like},localidad.ilike.${like},cuit.ilike.${like}`)
            .limit(matchCount)
        return (data || []).map((r: any) => r.id)
    }
    if (entity === "proveedores") {
        const { data } = await supabase
            .from("proveedores")
            .select("id")
            .eq("activo", true)
            .or(`nombre.ilike.${like},cuit.ilike.${like}`)
            .limit(matchCount)
        return (data || []).map((r: any) => r.id)
    }
    // articulos
    const { data } = await supabase
        .from("articulos")
        .select("id")
        .eq("activo", true)
        .or(`descripcion.ilike.${like},sku.ilike.${like}`)
        .limit(matchCount)
    return (data || []).map((r: any) => r.id)
}

async function vectorIds(entity: SearchEntity, q: string, matchCount: number): Promise<string[]> {
    try {
        if (entity === "articulos") return (await searchProductsByVector(q, 0.35, matchCount)).map((r: any) => r.id)
        if (entity === "clientes") return (await searchClientesByVector(q, 0.35, matchCount)).map((r: any) => r.id)
        return (await searchProveedoresByVector(q, 0.35, matchCount)).map((r: any) => r.id)
    } catch (e: any) {
        console.error(`[search] vector ${entity} error:`, e?.message)
        return []
    }
}

// Reciprocal Rank Fusion: combina varias listas ordenadas en una sola ranking.
function rrf(lists: string[][], k = 60): string[] {
    const score = new Map<string, number>()
    for (const list of lists) {
        list.forEach((id, i) => score.set(id, (score.get(id) || 0) + 1 / (k + i + 1)))
    }
    return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

/**
 * Búsqueda híbrida: léxica (trigram, Postgres) primaria; vector (Gemini) como
 * complemento solo cuando lo léxico trae menos de FALLBACK_MIN resultados.
 * Devuelve ids ordenados por relevancia. El caller hidrata las columnas que necesita.
 */
export async function hybridSearchIds(entity: SearchEntity, q: string, matchCount = 30): Promise<string[]> {
    const lex = await lexicalIds(entity, q, matchCount)

    // RPC no disponible todavía → degradar a ilike (sin regresión).
    if (lex === null) return ilikeFallbackIds(entity, q, matchCount)

    if (lex.length >= FALLBACK_MIN || q.length < 3) return lex

    const vec = await vectorIds(entity, q, matchCount)
    if (vec.length === 0) return lex

    return rrf([lex, vec]).slice(0, matchCount)
}
