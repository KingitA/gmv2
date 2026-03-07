export type MatchMethod = 'exact_code' | 'exact_ean' | 'exact_name' | 'vector' | 'manual' | 'none';

export interface MatchSignal {
    type: 'brand' | 'measure' | 'unit' | 'content' | 'embedding_score';
    score_impact: number;
    description: string;
}

export interface MatchCandidate {
    sku_id: string;
    sku_code: string;
    sku_name: string;
    score: number; // 0 to 1
    method: MatchMethod;
    signals: MatchSignal[];
    confidence_level: 'auto_approve' | 'suggestion' | 'low';
}

export interface MatchResult {
    bestCandidate: MatchCandidate | null;
    allCandidates: MatchCandidate[];
    status: 'matched' | 'pending' | 'rejected';
}

export interface ImportItemRaw {
    description: string;
    code?: string;
    ean?: string;
    brand?: string;
    unit?: string;
    price?: number;
    [key: string]: any;
}
