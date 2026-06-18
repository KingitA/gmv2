// Matcher local para filtrar arrays YA cargados en memoria (sin ir al servidor).
// Misma filosofía que el motor: normaliza (minúsculas + sin acentos), token-AND,
// y variante compactada para siglas pegadas. No hace trigram (eso es server-side),
// pero resuelve orden de palabras, acentos y siglas — ideal para listas acotadas.

export function normalizeLocal(s: string | null | undefined): string {
    return (s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
}

type Field = string | null | undefined | (string | null | undefined)[]

/**
 * Devuelve true si TODOS los tokens de `query` aparecen (como substring) en el
 * texto combinado de `fields` o en su versión compactada (sin espacios).
 */
export function localMatch(query: string, ...fields: Field[]): boolean {
    const flat = fields.flat()
    const text = normalizeLocal(flat.filter(Boolean).join(" "))
    const compact = text.replace(/ /g, "")
    const toks = normalizeLocal(query).split(" ").filter(Boolean)
    if (toks.length === 0) return true
    return toks.every((t) => text.includes(t) || compact.includes(t))
}
