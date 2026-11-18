import { createClient } from '@supabase/supabase-js';
import { normalizeText, extractFeatures } from './normalizer';
import { porcentaje } from '../formato';
import { MatchCandidate, MatchResult, ImportItemRaw, MatchSignal } from './types';
import { codigoComparable, elegirCandidatoCompra, elegirPorCodigo, parecidoPorPalabras, type ContextoCompra } from './compra';

const getSupabase = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export class MatchingEngine {

    /**
     * Main entry point to resolve a single item.
     */
    /**
     * `compra`: el renglón es de un comprobante de compra de ese proveedor (lib/matching/compra.ts):
     * el código exacto gana siempre, se busca primero en la orden y en el proveedor, y un artículo
     * de otro proveedor es el último recurso (queda como sugerencia, marcado). Sin `compra` el
     * motor se comporta como siempre (listas de precios, etc.).
     */
    async resolveItem(item: ImportItemRaw, providerId: string, compra?: ContextoCompra | null): Promise<MatchResult> {
        // 1. DEFENSIVE CASTING: Ensure we work with strings
        const descriptionStr = item.description ? String(item.description) : "";
        const codeStr = item.code ? String(item.code) : undefined;
        const eanStr = item.ean ? String(item.ean) : undefined;

        const normDesc = normalizeText(descriptionStr);
        const features = extractFeatures(descriptionStr);

        // LAYER 0: Exact Match (Fastest, Highest Confidence)
        // Pass the original item but we use our safe variables for internal logic if needed, 
        // though findExactMatch queries DB which handles types mostly fine, 
        // let's ensure we pass safe values if we modify findExactMatch.
        // Actually, we should update item's properties or create a safe copy? 
        // Let's pass the raw item to findExactMatch but use normalized string for logic.

        // Let's override the item properties for the subsequent logic to be safe
        const safeItem = { ...item, description: descriptionStr, code: codeStr, ean: eanStr };

        const exactMatch = await this.findExactMatch(safeItem, providerId, normDesc, compra);
        if (exactMatch) {
            return {
                bestCandidate: exactMatch,
                allCandidates: [exactMatch],
                status: 'matched'
            };
        }

        // LAYER 1: Candidate generation — trigram (search_articulos, léxico) + vector (semántico)
        if (!descriptionStr) {
            return { bestCandidate: null, allCandidates: [], status: 'pending' };
        }

        const [trigramCandidates, vectorCandidates, ordenCandidates] = await Promise.all([
            this.findTrigramMatches(descriptionStr),
            this.generateEmbedding(descriptionStr).then(emb => this.findVectorMatches(emb)),
            // Compras: los artículos de la orden SIEMPRE son candidatos (la búsqueda general trae
            // los 10 más parecidos de todo el catálogo y el de la orden puede no estar entre ellos)
            compra ? this.findOrdenMatches(descriptionStr, compra) : Promise.resolve([] as MatchCandidate[]),
        ]);

        // Merge pools by article id, keeping the best score (both scales are 0-1)
        const pool = new Map<string, MatchCandidate>();
        for (const c of [...trigramCandidates, ...vectorCandidates, ...ordenCandidates]) {
            const existing = pool.get(c.sku_id);
            if (!existing) {
                pool.set(c.sku_id, c);
            } else if (c.score > existing.score) {
                pool.set(c.sku_id, { ...c, signals: [...existing.signals, ...c.signals] });
            } else {
                existing.signals.push(...c.signals);
            }
        }

        // LAYER 2: Re-ranking
        const reranked = [...pool.values()].map(candidate => {
            return this.applyReranking(candidate, safeItem, features); // Use safeItem
        });

        // Sort by new score
        reranked.sort((a, b) => b.score - a.score);

        // Determine status based on best score
        let best = reranked.length > 0 ? reranked[0] : null;
        // Compras: primero la orden, después el proveedor; otro proveedor solo como último recurso
        let otroProveedor = false;
        if (compra && reranked.length > 0) {
            const elegido = elegirCandidatoCompra(reranked, providerId, compra);
            if (elegido) {
                best = elegido.candidato;
                otroProveedor = elegido.otro_proveedor;
                best.otro_proveedor = elegido.otro_proveedor;
                best.en_orden = elegido.en_orden;
                if (elegido.otro_proveedor) best.signals.push({ type: 'brand', score_impact: 0, description: 'Artículo de otro proveedor' });
            }
        }

        // Thresholds
        const AUTO_APPROVE_THRESHOLD = 0.93;
        const SUGGESTION_THRESHOLD = 0.75;

        if (best) {
            if (best.score >= AUTO_APPROVE_THRESHOLD && !otroProveedor) {
                best.confidence_level = 'auto_approve';
            } else if (best.score >= SUGGESTION_THRESHOLD) {
                best.confidence_level = 'suggestion';
            } else {
                best.confidence_level = 'low';
            }
        }

        return {
            bestCandidate: best,
            allCandidates: reranked,
            status: best && best.confidence_level === 'auto_approve' ? 'matched' : 'pending'
        };
    }

    private async findExactMatch(item: ImportItemRaw, providerId: string, normDesc: string, compra?: ContextoCompra | null): Promise<MatchCandidate | null> {
        // 0. El código leído ES el SKU de un artículo de la orden o de este proveedor.
        //    (Antes el código solo se comparaba con las equivalencias aprendidas: un artículo cuyo SKU
        //    era exactamente el código de la factura no se encontraba y se iba a buscar por parecido.)
        if (item.code && providerId) {
            const codigo = String(item.code).trim();
            const variantes = [...new Set([codigo, codigoComparable(codigo), codigo.replace(/^0+(?=.)/, '')].filter(Boolean))];
            const { data: porSku } = await getSupabase()
                .from('articulos')
                .select('id, descripcion, sku, proveedor_id')
                .eq('activo', true)
                .in('sku', variantes)
                .limit(50);
            const art: any = elegirPorCodigo(codigo, (porSku || []) as any[], providerId, compra);
            if (art) {
                return {
                    sku_id: art.id,
                    sku_code: art.sku,
                    sku_name: art.descripcion,
                    score: 1.0,
                    method: 'exact_sku',
                    signals: [{ type: 'unit', score_impact: 0, description: 'El código del renglón es el SKU del artículo' }],
                    confidence_level: 'auto_approve',
                    proveedor_id: art.proveedor_id ?? null,
                };
            }
        }

        // 1. Check by Provider Code
        if (item.code) {
            // ... existing logic ...
            // (We assume DB query handles strings fine, Supabase client serializes correctly)
            const { data } = await getSupabase()
                .from('articulos_proveedores')
                .select(`
                  articulo_id,
                  articulos!inner ( id, descripcion, sku, activo )
                `)
                .eq('proveedor_id', providerId)
                .eq('codigo_proveedor', item.code)
                .eq('articulos.activo', true)
                .limit(1)
                .maybeSingle();

            if (data && data.articulos) {
                const art = Array.isArray(data.articulos) ? data.articulos[0] : data.articulos;
                return {
                    sku_id: data.articulo_id,
                    sku_code: art.sku,
                    sku_name: art.descripcion,
                    score: 1.0,
                    method: 'exact_code',
                    signals: [{ type: 'unit', score_impact: 0, description: 'Matched by Provider Code' }],
                    confidence_level: 'auto_approve'
                };
            }
        }

        // 2. Check by EAN (Global check, ignoring provider)
        // articulos.ean13 es TEXT[] desde 20260424_ean13_array.sql
        // (el "código" de un renglón de compra muchas veces ES el código de barras)
        const posibleEan = item.ean ? String(item.ean) : (compra && item.code && /^\d{12,14}$/.test(String(item.code).trim()) ? String(item.code).trim() : '');
        if (posibleEan) {
            const { data: eanRows } = await getSupabase()
                .from('articulos')
                .select('id, descripcion, sku, proveedor_id')
                .eq('activo', true)
                .contains('ean13', [posibleEan])
                .limit(10);

            // Con el mismo código de barras en más de un artículo: el de la orden, después el del proveedor
            const enOrden = new Set(compra?.ordenArticuloIds || []);
            const data: any = (eanRows || []).find((a: any) => enOrden.has(a.id))
                || (eanRows || []).find((a: any) => a.proveedor_id === providerId)
                || eanRows?.[0];
            if (data) {
                return {
                    sku_id: data.id,
                    sku_code: data.sku,
                    sku_name: data.descripcion,
                    score: 1.0,
                    method: 'exact_ean',
                    signals: [{ type: 'unit', score_impact: 0, description: 'Matched by EAN' }],
                    confidence_level: 'auto_approve'
                };
            }
        }

        // 3. Check by Normalized Description (Mapped previously)
        if (normDesc) {
            const { data } = await getSupabase()
                .from('articulos_proveedores')
                .select(`
                  articulo_id,
                  articulos!inner ( id, descripcion, sku, activo )
                `)
                .eq('proveedor_id', providerId)
                .eq('descripcion_proveedor_norm', normDesc)
                .eq('articulos.activo', true) // una equivalencia aprendida no revive un artículo dado de baja
                .limit(1)
                .maybeSingle();

            if (data && data.articulos) {
                const art = Array.isArray(data.articulos) ? data.articulos[0] : data.articulos;
                return {
                    sku_id: data.articulo_id,
                    sku_code: art.sku,
                    sku_name: art.descripcion,
                    score: 1.0,
                    method: 'exact_name',
                    signals: [{ type: 'unit', score_impact: 0, description: 'Matched by previously learned description' }],
                    confidence_level: 'auto_approve'
                };
            }
        }

        return null;
    }

    private async generateEmbedding(text: any): Promise<number[]> {
        try {
            const str = String(text || "").replace(/\n/g, " ").trim();
            if (!str) return [];
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) return [];

            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1/models/gemini-embedding-001:embedContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'models/gemini-embedding-001',
                        content: { parts: [{ text: str }] },
                    }),
                }
            );
            if (!res.ok) {
                console.warn("Embedding API error:", res.status, await res.text());
                return [];
            }
            const data = await res.json();
            return data.embedding?.values || [];
        } catch (e) {
            console.error("Error generating embedding:", e);
            return []; // Non-fatal: fall back to exact/fuzzy matching
        }
    }

    // Hidrata sku/descripcion de una lista de (id, score) contra articulos.
    private async hydrateCandidates(
        rows: { id: string; score: number }[],
        method: MatchCandidate['method'],
        signalLabel: string
    ): Promise<MatchCandidate[]> {
        if (rows.length === 0) return [];
        const { data: arts } = await getSupabase()
            .from('articulos')
            .select('id, descripcion, sku, proveedor_id')
            .in('id', rows.map(r => r.id))
            .eq('activo', true); // los dados de baja no son candidatos
        const byId = new Map((arts || []).map((a: any) => [a.id, a]));
        return rows
            .filter(r => byId.has(r.id))
            .map(r => {
                const art = byId.get(r.id)!;
                return {
                    sku_id: r.id,
                    sku_code: art.sku,
                    sku_name: art.descripcion,
                    score: r.score,
                    method,
                    signals: [{ type: 'embedding_score' as const, score_impact: 0, description: `${signalLabel}: ${porcentaje(r.score * 100, 1)}` }],
                    confidence_level: 'low' as const,
                    proveedor_id: art.proveedor_id ?? null,
                };
            });
    }

    // Compras: los artículos de la orden, puntuados por parecido de palabras con el renglón.
    // El puntaje va de 0,60 a 0,92: por parecido solo, nunca se asigna sin que alguien lo confirme.
    private async findOrdenMatches(description: string, compra: ContextoCompra): Promise<MatchCandidate[]> {
        const ids = [...new Set(compra.ordenArticuloIds || [])];
        if (ids.length === 0) return [];
        const { data: arts } = await getSupabase()
            .from('articulos')
            .select('id, descripcion, sku, proveedor_id')
            .in('id', ids.slice(0, 500))
            .eq('activo', true);
        return (arts || [])
            .map((a: any) => ({ a, parecido: parecidoPorPalabras(description, a.descripcion) }))
            .filter((x: any) => x.parecido >= 0.34)
            .map((x: any) => ({
                sku_id: x.a.id,
                sku_code: x.a.sku,
                sku_name: x.a.descripcion,
                score: Math.min(0.60 + 0.32 * x.parecido, 0.92),
                method: 'trigram' as const,
                signals: [{ type: 'embedding_score' as const, score_impact: 0, description: `Artículo de la orden, parecido ${porcentaje(x.parecido * 100, 0)}` }],
                confidence_level: 'low' as const,
                proveedor_id: x.a.proveedor_id ?? null,
            }));
    }

    // Capa léxica: RPC search_articulos (trigram token-AND typo-tolerante sobre
    // search_text, que ya indexa los alias/códigos de proveedor). El score crudo
    // (word_similarity + bonos de prefijo/substring) se mapea a 0.60-0.90 para
    // que un hit trigram solo nunca auto-apruebe sin verificación de medida.
    private async findTrigramMatches(description: string): Promise<MatchCandidate[]> {
        const { data, error } = await getSupabase().rpc('search_articulos', {
            q: description,
            match_count: 10
        });
        if (error) {
            console.error("Trigram search error:", error);
            return [];
        }
        const rows = (data || []).map((r: any) => ({
            id: r.id as string,
            score: Math.min(0.60 + 0.30 * Math.min(Number(r.score) || 0, 1), 0.90),
        }));
        return this.hydrateCandidates(rows, 'trigram', 'Trigram score');
    }

    private async findVectorMatches(embedding: number[]): Promise<MatchCandidate[]> {
        if (!embedding || embedding.length === 0) return [];

        const { data: candidates, error } = await getSupabase().rpc('match_articulos', {
            query_embedding: embedding,
            match_threshold: 0.5, // Pre-filter
            match_count: 10
        });

        if (error) {
            console.error("Vector search error:", error);
            return [];
        }

        // match_articulos devuelve solo (id, similarity) — hidratar nombres
        const rows = (candidates || []).map((c: any) => ({ id: c.id as string, score: Number(c.similarity) || 0 }));
        return this.hydrateCandidates(rows, 'vector', 'Vector similarity');
    }

    private applyReranking(candidate: MatchCandidate, inputItem: ImportItemRaw, inputFeatures: ReturnType<typeof extractFeatures>): MatchCandidate {
        const candidateFeatures = extractFeatures(candidate.sku_name); // Parse candidate name too

        let score = candidate.score;
        const signals: MatchSignal[] = [...candidate.signals];

        // 1. Measure Mismatch Penalty (Critical)
        // If input says 500ml and candidate says 1L, big penalty.
        if (inputFeatures.measure_val && candidateFeatures.measure_val) {
            // Check unit compatibility
            if (inputFeatures.measure_unit === candidateFeatures.measure_unit) {
                if (inputFeatures.measure_val !== candidateFeatures.measure_val) {
                    const penalty = 0.3; // Huge penalty
                    score -= penalty;
                    signals.push({ type: 'measure', score_impact: -penalty, description: `Mismatch: ${inputFeatures.measure_val} vs ${candidateFeatures.measure_val}` });
                } else {
                    const bonus = 0.05;
                    score += bonus;
                    signals.push({ type: 'measure', score_impact: bonus, description: 'Measure match verified' });
                }
            }
        }

        // 2. Multiplier Mismatch
        // If input says "x12" and candidate has no indication or different...
        // This is heuristic.
        if (inputFeatures.multiplier && candidateFeatures.multiplier) {
            if (inputFeatures.multiplier !== candidateFeatures.multiplier) {
                const penalty = 0.15;
                score -= penalty;
                signals.push({ type: 'unit', score_impact: -penalty, description: `Pack size mismatch: x${inputFeatures.multiplier} vs x${candidateFeatures.multiplier}` });
            }
        }

        // Cap score at 0.99 (1.0 is reserved for exact matches)
        score = Math.min(score, 0.99);
        score = Math.max(score, 0); // No negative scores

        candidate.score = score;
        candidate.signals = signals;
        return candidate;
    }
}
