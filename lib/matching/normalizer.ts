/**
 * Normalizes text for strict comparison (Capa 0)
 * Lowercase, remove accents, remove duplicate spaces, trim.
 */
export function normalizeText(text: string | number | null | undefined): string {
    if (!text) return '';
    const str = String(text); // Force string (e.g. for numbers)
    return str
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/[^a-z0-9\s]/g, "") // Remove symbols (keep strictly alphanumeric + space)
        .replace(/\s+/g, " ") // Collapse spaces
        .trim();
}

export interface ExtractedFeatures {
    measure_val?: number;
    measure_unit?: string; // ml, l, kg, g, cc
    multiplier?: number; // x6, x12, etc.
    pack_type?: string; // caja, bulto, pack
}

/**
 * Extracts structured features from a raw description string.
 * Used for Layer 2 Re-ranking rules.
 */
export function extractFeatures(text: string | number | null | undefined): ExtractedFeatures {
    if (!text) return {};
    const str = String(text);
    const norm = str.toLowerCase();
    const features: ExtractedFeatures = {};

    // 1. Detect measure (e.g., 500ml, 1.5l, 1kg)
    // Regex looks for number followed optionally by space then unit
    const measureRegex = /(\d+(?:[.,]\d+)?)\s*(ml|cc|lts?|l|gr?s?|kgs?|kg)/i;
    const measureMatch = norm.match(measureRegex);

    if (measureMatch) {
        features.measure_val = parseFloat(measureMatch[1].replace(',', '.'));
        let unit = measureMatch[2];

        // Normalize units
        if (unit.startsWith('l')) unit = 'l';
        if (unit === 'cc') unit = 'ml';
        if (unit.startsWith('g')) unit = 'g';
        if (unit.startsWith('k')) unit = 'kg';

        features.measure_unit = unit;
    }

    // 2. Detect Multipliers (e.g., x6, x12, 6x..., pack 12)
    const multiplierRegex = /(?:x\s*(\d+))|(?:(\d+)\s*x)|(?:pack\s*(\d+))|(?:caja\s*(\d+))/i;
    const multMatch = norm.match(multiplierRegex);

    if (multMatch) {
        // Determine which group matched
        const val = multMatch[1] || multMatch[2] || multMatch[3] || multMatch[4];
        if (val) features.multiplier = parseInt(val, 10);
    }

    // 3. Pack Type keywords
    if (norm.includes('caja')) features.pack_type = 'caja';
    if (norm.includes('bulto')) features.pack_type = 'bulto';
    if (norm.includes('pack')) features.pack_type = 'pack';

    return features;
}
