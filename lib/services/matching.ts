import { createClient } from "@supabase/supabase-js";
import { SupabaseClient } from "@supabase/supabase-js";

// Helper to normalize text for consistent matching
export const normalizeText = (text: string | null | undefined): string => {
    if (!text) return "";
    return text
        .toLowerCase()
        .trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/[\/\.\-\,]/g, " ") // Replace /, . , - and , with spaces to separate tokens
        .replace(/[^a-z0-9\s]/g, "") // Remove other non-alphanumeric
        .replace(/\s+/g, " "); // Collapse multiple spaces
};

// Helper for fuzzy token matching (Jaccard)
export const getJaccardSimilarity = (str1: string, str2: string): number => {
    const tokenize = (s: string) => {
        const stopWords = new Set(["de", "para", "con", "el", "la", "los", "las", "un", "una", "y", "x"]);
        return new Set(s.split(" ").filter(t => t.length > 0 && !stopWords.has(t)));
    };

    const set1 = tokenize(str1);
    const set2 = tokenize(str2);

    if (set1.size === 0 || set2.size === 0) return 0;

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
};

export type MatchResult = {
    status: "found" | "suggested" | "not_found";
    match_type: "CODE" | "DESC" | "TOKEN" | "NONE";
    articulo_id: string | null;
    mapping_id: string | null;
    score: number;
    candidate_list: any[];
    articulo?: any; // The full article object if found
};

export async function matchItems(
    supabase: SupabaseClient,
    items: any[],
    proveedorId: string
): Promise<{ items: any[], unmatchedDbArticles: any[] }> {
    if (!items || items.length === 0) return { items: [], unmatchedDbArticles: [] };
    if (!proveedorId) return { items, unmatchedDbArticles: [] };

    // 1. Fetch provider mappings
    const { data: allProviderMappings } = await supabase
        .from("articulos_proveedores")
        .select(`
            id,
            articulo_id,
            descripcion_proveedor,
            descripcion_proveedor_norm,
            codigo_proveedor,
            veces_usado,
            unidad_factura,
            factor_conversion
        `)
        .eq("proveedor_id", proveedorId);

    // 2. Fetch active articles for this provider to ensure we only match active stuff
    // Optimization: We could fetch ALL articles for provider, or just rely on mappings + a verify step.
    // Let's fetch basic info for mapped articles later or now.
    // To minimize query size, let's just trust mappings first, then verify existence if needed, 
    // OR fetch all articles for this provider.
    const { data: articulosMaster } = await supabase
        .from("articulos")
        .select("id, descripcion, sku, unidades_por_bulto, precio_compra, descuento1, descuento2, descuento3, descuento4")
        .eq("proveedor_id", proveedorId)
        .eq("activo", true);

    // Create a map for fast lookup of internal articles
    const articulosMap = new Map(articulosMaster?.map((a: any) => [a.id, a]) || []);

    const results = [];

    for (const item of items) {
        let matchResult: MatchResult = {
            status: "not_found",
            match_type: "NONE",
            articulo_id: null,
            mapping_id: null,
            score: 0.0,
            candidate_list: []
        };

        const descripcion = item.descripcion || item.descripcion_ocr || "";
        const codigo = item.codigo || item.codigo_visible || "";
        const normalizedDesc = normalizeText(descripcion);

        // --- LAYER 1: EXACT MATCH ---

        // A. Match by Code
        if (codigo) {
            // 1. Check against articulos_proveedores
            const mapping = allProviderMappings?.find((m: any) => m.codigo_proveedor === codigo);
            if (mapping) {
                matchResult = { status: "found", match_type: "CODE", articulo_id: mapping.articulo_id, mapping_id: mapping.id, score: 1.0, candidate_list: [] };
            }
            // 2. Check against internal SKU directly (sometimes they match)
            else {
                const artBySku = articulosMaster?.find((a: any) => a.sku === codigo);
                if (artBySku) {
                    matchResult = { status: "found", match_type: "CODE", articulo_id: artBySku.id, mapping_id: null, score: 1.0, candidate_list: [] };
                }
            }
        }

        // B. Match by Normalized Description
        if (matchResult.status === "not_found" && normalizedDesc) {
            const mapping = allProviderMappings?.find((m: any) => m.descripcion_proveedor_norm === normalizedDesc);
            if (mapping) {
                matchResult = { status: "found", match_type: "DESC", articulo_id: mapping.articulo_id, mapping_id: mapping.id, score: 1.0, candidate_list: [] };
            }
        }

        // C. Match by RAW Description
        if (matchResult.status === "not_found" && descripcion) {
            const raw = descripcion.trim();
            const mapping = allProviderMappings?.find((m: any) => m.descripcion_proveedor?.trim() === raw);
            if (mapping) {
                matchResult = { status: "found", match_type: "DESC", articulo_id: mapping.articulo_id, mapping_id: mapping.id, score: 1.0, candidate_list: [] };
            }
        }

        // --- LAYER 2: FUZZY MATCH ---
        if (matchResult.status === "not_found" && normalizedDesc && allProviderMappings) {
            const candidates = allProviderMappings.map((m: any) => ({
                ...m,
                score: getJaccardSimilarity(normalizedDesc, m.descripcion_proveedor_norm || "")
            }))
                .filter((c: any) => c.score >= 0.75)
                .sort((a: any, b: any) => b.score - a.score);

            if (candidates.length > 0) {
                const best = candidates[0];
                matchResult = {
                    status: "suggested",
                    match_type: "TOKEN",
                    articulo_id: best.articulo_id,
                    mapping_id: best.id,
                    score: best.score,
                    candidate_list: candidates.slice(0, 3)
                };
            }
        }

        if ((matchResult.status === "found" || matchResult.status === "suggested") && matchResult.articulo_id) {
            matchResult.articulo = articulosMap.get(matchResult.articulo_id);
        }

        results.push({
            ...item,
            match_result: matchResult
        });
    }

    // Identify DB items that were NOT matched
    const matchedIds = new Set(results
        .filter(r => r.match_result.status === "found" || r.match_result.status === "suggested")
        .map(r => r.match_result.articulo_id)
        .filter(Boolean));

    const unmatchedDbArticles = (articulosMaster || []).filter((a: any) => !matchedIds.has(a.id));

    return {
        items: results,
        unmatchedDbArticles
    };
}
