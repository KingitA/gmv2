import * as XLSX from 'xlsx';

export interface PriceListConfig {
    price_mode: 'UNITARIO' | 'BULTO';
    provider_id?: string;
}

export interface ParsedItem {
    description: string;
    description_norm: string;
    code: string | undefined;
    ean: string | undefined;
    supplier_code: string | undefined;
    pack_qty: number | null; // Paq x Bulto
    unit_price: number | null; // Precio Unitario Detectado
    case_price: number | null; // Precio Bulto Detectado
    cost_unit: number; // Costo Final (Calculado)
    cost_case: number; // Costo Final (Calculado)
    requires_review: boolean;
    parse_notes: string[]; // Reasons for review/discard
    original_row: number;
}

export async function parsePriceList(file: File, config: PriceListConfig): Promise<ParsedItem[]> {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Get raw matrix (array of arrays) to bypass header issues
    const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    // 1. ANALYZE COLUMNS (Smart Detection)
    const maxCol = 20; // Check first 20 columns
    const colScores = [];

    // Analyze first 50 rows for density
    const sampleRows = Math.min(matrix.length, 50);

    for (let c = 0; c < maxCol; c++) {
        let numCount = 0;
        let textCount = 0;
        let priceHeaderScore = 0;
        let descHeaderScore = 0;
        let packHeaderScore = 0;

        for (let r = 0; r < sampleRows; r++) {
            const cell = matrix[r] ? matrix[r][c] : undefined;
            if (!cell) continue;

            const strVal = String(cell).trim();
            const lowerVal = strVal.toLowerCase();

            // Numeric check (allow currency formats)
            const isNumber = typeof cell === 'number' ||
                (/^[0-9$.,\s]+$/.test(strVal) && /[0-9]/.test(strVal) && strVal.length < 15);

            if (isNumber) numCount++;

            // Text check (exclude pure numbers)
            const isText = /[a-zA-Z]/.test(strVal) && strVal.length > 2;
            if (isText) textCount++;

            // Header Keywords (Bonus for first 10 rows)
            if (r < 10) {
                if (/precio|costo|valor|price|importe|unitario/i.test(strVal)) priceHeaderScore += 20;
                if (/bulto|caja|pack/i.test(strVal)) packHeaderScore += 20;
                if (/desc|nombre|prod|articulo|detalle|linea/i.test(strVal)) descHeaderScore += 20;
            }
        }
        colScores.push({ idx: c, num: numCount, text: textCount, priceHeader: priceHeaderScore, descHeader: descHeaderScore, packHeader: packHeaderScore });
    }

    // DETERMINE ROLES
    // Price Column: Highest numeric density + price header bonus
    const priceCol = colScores.reduce((prev, curr) =>
        (curr.num + curr.priceHeader) > (prev.num + prev.priceHeader) ? curr : prev
        , { idx: -1, num: -1, priceHeader: -1 });

    // Desc Column: Highest text density (excluding price col) + desc header bonus
    const descCol = colScores.reduce((prev, curr) => {
        if (curr.idx === priceCol.idx) return prev;
        return (curr.text + curr.descHeader) > (prev.text + prev.descHeader) ? curr : prev;
    }, { idx: -1, text: -1, descHeader: -1 });

    // Pack/Bulto Column: Look for "bulto" keyword or secondary numeric column
    // This is optional.
    const packCol = colScores.find(c => c.packHeader > 10 && c.idx !== priceCol.idx && c.idx !== descCol.idx);

    // Code Column: Leftover column with some text/nums, usually left of description
    const codeCol = colScores.find(c =>
        c.idx !== priceCol.idx &&
        c.idx !== descCol.idx &&
        c.idx !== (packCol?.idx || -1) &&
        (c.text + c.num > 5)
    );

    console.log(`[Parser] Cols -> Price:${priceCol.idx}, Desc:${descCol.idx}, Code:${codeCol?.idx}, Pack:${packCol?.idx}`);

    // 2. EXTRACT & NORMALIZE
    const parsedItems: ParsedItem[] = [];

    for (let r = 0; r < matrix.length; r++) {
        const row = matrix[r];
        if (!row) continue;

        // Extract Raw Values
        const valPrice = row[priceCol.idx];
        const valDesc = row[descCol.idx];
        const valCode = codeCol ? row[codeCol.idx] : undefined;
        const valPack = packCol ? row[packCol.idx] : undefined;

        // Clean & Validate Description
        const descRaw = valDesc ? String(valDesc).trim() : "";
        // FILTER: Discard titles (no price usually, or explicit "LINEA")
        // FILTER: Discard garbage (short text, purely numeric descriptions)
        const isGarbage = descRaw.length < 3 || !isNaN(Number(descRaw));
        const isHeader = /precio|fecha|codigo|pagina/i.test(descRaw) && descRaw.length < 20; // Re-header detection
        if (isGarbage || isHeader) continue;

        // Clean & Validate Price
        let rawAmount = 0;
        if (typeof valPrice === 'number') rawAmount = valPrice;
        else if (valPrice) {
            // "1.200,50" -> 1200.50
            const clean = String(valPrice).replace('$', '').replace(/\./g, '').replace(',', '.').trim();
            if (clean && !clean.includes('fecha')) rawAmount = parseFloat(clean);
        }
        if (!rawAmount || isNaN(rawAmount) || rawAmount <= 0) continue;

        // Clean Pack Qty
        let packQty: number | null = null;
        if (valPack) {
            const cleanPack = String(valPack).replace(/[^0-9.]/g, '');
            const p = parseFloat(cleanPack);
            if (!isNaN(p) && p > 0) packQty = p;
        }

        // 3. APPLY PRICING LOGIC (Unit vs Case)
        let unitPrice: number | null = null;
        let casePrice: number | null = null;
        let finalCostUnit = 0;
        let finalCostCase = 0;
        let requiresReview = false;
        const notes: string[] = [];

        // Interpret the "rawAmount" based on config
        // Is this column Unit Price or Case Price?
        // Heuristic: If we detected "Bulto" in the header of THIS column, trust it.
        // Otherwise use global config.

        // Simpler approach per requirements:
        // "Determina por configuración si el precio importado es UNITARIO o BULTO"

        if (config.price_mode === 'UNITARIO') {
            unitPrice = rawAmount;
            finalCostUnit = unitPrice;

            // Calculate case if pack exists
            if (packQty) {
                casePrice = unitPrice * packQty;
                finalCostCase = casePrice;
            }
        } else {
            // BULTO Mode
            casePrice = rawAmount;
            finalCostCase = casePrice;

            // Calculate unit if pack exists
            if (packQty) {
                unitPrice = casePrice / packQty;
                finalCostUnit = unitPrice;
            } else {
                // If we have Case Price but NO pack quantity, we can't get unit cost!
                // Critical for system that bases on unit cost.
                requiresReview = true;
                notes.push("Falta Pack Qty para calcular Unitario");
                finalCostUnit = 0; // Or keep casePrice as placeholder? No, dangerous.
            }
        }

        // 4. NORMALIZE STRINGS
        const normDesc = descRaw.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
            .replace(/[^a-z0-9\s]/g, " ") // validation chars
            .replace(/\s+/g, " ").trim();

        parsedItems.push({
            description: descRaw,
            description_norm: normDesc,
            code: valCode ? String(valCode).trim() : undefined,
            ean: undefined, // Add specific detector if needed
            supplier_code: valCode ? String(valCode).trim() : undefined,
            pack_qty: packQty,
            unit_price: unitPrice,
            case_price: casePrice,
            cost_unit: finalCostUnit,
            cost_case: finalCostCase,
            requires_review: requiresReview,
            parse_notes: notes,
            original_row: r
        });
    }

    return parsedItems;
}
