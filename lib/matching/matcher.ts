import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { normalizeText, extractFeatures } from './normalizer';
import { MatchCandidate, MatchResult, ImportItemRaw, MatchSignal } from './types';

// Initialize clients lazily to prevent Vercel build crashes
const getSupabase = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const getGenAI = () => new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy');

export class MatchingEngine {

    /**
     * Main entry point to resolve a single item.
     */
    async resolveItem(item: ImportItemRaw, providerId: string): Promise<MatchResult> {
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

        const exactMatch = await this.findExactMatch(safeItem, providerId, normDesc);
        if (exactMatch) {
            return {
                bestCandidate: exactMatch,
                allCandidates: [exactMatch],
                status: 'matched'
            };
        }

        // LAYER 1: Vector Search (Semantic)
        if (!descriptionStr) {
            return { bestCandidate: null, allCandidates: [], status: 'pending' };
        }

        const embedding = await this.generateEmbedding(descriptionStr);
        const vectorCandidates = await this.findVectorMatches(embedding);

        // LAYER 2: Re-ranking
        const reranked = vectorCandidates.map(candidate => {
            return this.applyReranking(candidate, safeItem, features); // Use safeItem
        });

        // Sort by new score
        reranked.sort((a, b) => b.score - a.score);

        // Determine status based on best score
        const best = reranked.length > 0 ? reranked[0] : null;

        // Thresholds
        const AUTO_APPROVE_THRESHOLD = 0.93;
        const SUGGESTION_THRESHOLD = 0.75;

        if (best) {
            if (best.score >= AUTO_APPROVE_THRESHOLD) {
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

    private async findExactMatch(item: ImportItemRaw, providerId: string, normDesc: string): Promise<MatchCandidate | null> {
        // 1. Check by Provider Code
        if (item.code) {
            // ... existing logic ...
            // (We assume DB query handles strings fine, Supabase client serializes correctly)
            const { data } = await getSupabase()
                .from('articulos_proveedores')
                .select(`
                  articulo_id,
                  articulos ( id, descripcion, sku )
                `)
                .eq('proveedor_id', providerId)
                .eq('codigo_proveedor', item.code)
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
        if (item.ean) {
            const { data } = await getSupabase()
                .from('articulos')
                .select('id, descripcion, sku')
                .eq('codigo_barras', item.ean)
                .maybeSingle();

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
                  articulos ( id, descripcion, sku )
                `)
                .eq('proveedor_id', providerId)
                .eq('descripcion_proveedor_norm', normDesc)
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
            const str = String(text || ""); // Force string
            if (!str.trim()) return [];

            const model = getGenAI().getGenerativeModel({ model: "text-embedding-004" });
            const result = await model.embedContent(str.replace(/\n/g, " "));
            return result.embedding.values;
        } catch (e) {
            console.error("Error generating embedding:", e);
            throw e;
        }
    }

    private async findVectorMatches(embedding: number[]): Promise<MatchCandidate[]> {
        // using rpc to call pgvector function provided by Supabase or raw SQL
        // We'll use a direct RPC call if we set up a function, or raw query.
        // For simplicity and safety with RLS/types, direct RPC is best if the function exists.
        // BUT we didn't create a match_articulos function in the migration yet. 
        // Let's assume we can query directly or we need to add the function.
        // Adding the function via migration is cleaner. I will use the 'match_documents' style pattern.

        // WAIT: I didn't create the rpc function in 051. I should probably add it or do a raw query.
        // Raw query from client is harder. I will assume I can create the function in a follow-up or just use `supabase.rpc`.
        // Let's implement dynamic SQL via rpc or just fetch all? No fetching all is bad.
        // We will use the standard Supabase pgvector 'match_documents' pattern.

        // For now, I'll assume we can't easily add the RPC function from here without another migration step.
        // I will write the code assuming 'match_articulos' exists, and I will ADD A MIGRATION STEP shortly to create it.

        const { data: candidates, error } = await getSupabase().rpc('match_articulos', {
            query_embedding: embedding,
            match_threshold: 0.5, // Pre-filter
            match_count: 10
        });

        if (error) {
            console.error("Vector search error:", error);
            return [];
        }

        return (candidates || []).map((c: any) => ({
            sku_id: c.id,
            sku_code: c.codigo_interno,
            sku_name: c.descripcion,
            score: c.similarity, // Base cosine similarity
            method: 'vector',
            signals: [{ type: 'embedding_score', score_impact: 0, description: `Vector similarity: ${(c.similarity * 100).toFixed(1)}%` }],
            confidence_level: 'low'
        }));
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
