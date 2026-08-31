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

// De los ids ya rankeados por lo léxico, cuáles contienen el texto buscado
// completo en su search_text (normalizado sin acentos, como lo guarda el
// trigger). Preserva el orden de entrada.
async function substringMatchIds(entity: SearchEntity, q: string, ids: string[]): Promise<string[]> {
    if (!ids.length) return []
    try {
        const supabase = createAdminClient()
        const nq = q
            .toLowerCase()
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/%/g, "")
            .trim()
        if (!nq) return []
        const { data } = await supabase
            .from(entity)
            .select("id")
            .in("id", ids)
            .ilike("search_text", `%${nq}%`)
        const match = new Set((data || []).map((r: any) => r.id))
        return ids.filter((id) => match.has(id))
    } catch {
        return []
    }
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

// ¿La consulta parece un código (SKU/EAN)? Solo dígitos, 3+ caracteres.
// Los SKU del catálogo son numéricos; el trigram los rankea mal (99915 puede
// ganarle a 99912 buscando "99912"), así que los códigos se resuelven por
// igualdad/prefijo ANTES del ranking difuso.
function esCodigo(q: string): boolean {
    return /^[0-9]{3,}$/.test(q.trim())
}

// Ids por código: exactos primero (sku = q, ean13 = q, codigo_bulto = q),
// después prefijo (sku/ean13 que EMPIEZAN con q, orden por sku). El trigram
// que sigue aporta lo demás (coincidencias en descripción, etc.).
async function codigoIds(q: string, matchCount: number): Promise<string[]> {
    const supabase = createAdminClient()
    const [exactos, prefijo] = await Promise.all([
        // ean13 es text[] (un artículo puede tener varios códigos): cs = contiene
        supabase
            .from("articulos")
            .select("id")
            .eq("activo", true)
            .or(`sku.eq.${q},codigo_bulto.eq.${q},ean13.cs.{${q}}`)
            .limit(matchCount),
        // Prefijo solo por sku (el EAN se escanea completo, no tiene sentido a medias)
        supabase
            .from("articulos")
            .select("id")
            .eq("activo", true)
            .like("sku", `${q}%`)
            .order("sku")
            .limit(matchCount),
    ])
    const out: string[] = []
    const seen = new Set<string>()
    for (const r of [...(exactos.data || []), ...(prefijo.data || [])]) {
        if (!seen.has(r.id)) { seen.add(r.id); out.push(r.id) }
    }
    return out
}

/**
 * Búsqueda híbrida: léxica (trigram, Postgres) primaria; vector (Gemini) como
 * complemento solo cuando lo léxico trae menos de FALLBACK_MIN resultados.
 * Para artículos, una consulta numérica resuelve primero por código exacto/prefijo.
 * Devuelve ids ordenados por relevancia. El caller hidrata las columnas que necesita.
 */
export async function hybridSearchIds(entity: SearchEntity, q: string, matchCount = 30): Promise<string[]> {
    // Códigos: exacto > prefijo > difuso. La coincidencia exacta SIEMPRE primera.
    const porCodigo = entity === "articulos" && esCodigo(q) ? await codigoIds(q, matchCount) : []

    const lex = await lexicalIds(entity, q, matchCount)

    // RPC no disponible todavía → degradar a ilike (sin regresión).
    const difuso =
        lex === null
            ? await ilikeFallbackIds(entity, q, matchCount)
            : lex.length >= FALLBACK_MIN || q.length < 3
              ? lex
              : await (async () => {
                    const vec = await vectorIds(entity, q, matchCount)
                    if (vec.length === 0) return lex
                    // Lo ESCRITO manda: los resultados que contienen el texto
                    // buscado van SIEMPRE primero (en su orden léxico); los
                    // "parecidos" del vector van después. Sin esto, la fusión
                    // posicional (RRF) podía colar un cliente semánticamente
                    // parecido por encima del nombre exacto — y en el registro
                    // de cobros eso terminó en un cobro al cliente equivocado.
                    const exactos = await substringMatchIds(entity, q, lex)
                    const setExactos = new Set(exactos)
                    const resto = rrf([lex, vec]).filter((id) => !setExactos.has(id))
                    return [...exactos, ...resto]
                })()

    if (!porCodigo.length) return difuso.slice(0, matchCount)
    const setCodigo = new Set(porCodigo)
    return [...porCodigo, ...difuso.filter((id) => !setCodigo.has(id))].slice(0, matchCount)
}
