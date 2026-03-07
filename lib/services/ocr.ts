import { GoogleGenerativeAI } from "@google/generative-ai";
import * as XLSX from "xlsx";

// Interfaces for structured output
export interface ExtractedItem {
    descripcion: string;
    codigo: string | null;
    cantidad: number;
    precio_unitario: number | null;
    precio_bulto: number | null; // New field
    unidades_por_bulto: number | null; // New field
    descuento: number | null;
    unidad_medida: string | null;
    source_row?: any; // For Excel debugging
}

export interface ParseResult {
    items: ExtractedItem[];
    raw_text?: string;
    metadata?: any;
    error?: string;
}

// --- GEMINI OCR LOGIC ---

export async function processWithGemini(
    file: File,
    context: {
        proveedorNombre?: string,
        tipoDocumento?: string
    }
): Promise<ParseResult> {
    try {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error("Missing GEMINI_API_KEY");
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // Using flash-lite as per original implementation
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const base64 = buffer.toString('base64');

        const prompt = `Sos un asistente experto en procesamiento de documentos comerciales.
        
        CONTEXTO:
        - Proveedor: ${context.proveedorNombre || "Desconocido"}
        - Tipo de documento: ${context.tipoDocumento || "Pedido/Orden"}

        TAREA:
        Extraé los ítems de este documento en formato JSON.
        Importante: Priorizá la exactitud de los códigos y descripciones.
        Si hay precios por bulto/pack y precios unitarios, extraé ambos si es posible, o indicá las unidades por bulto.
        
        FORMATO JSON ESPERADO:
        {
            "items": [
                {
                    "descripcion": "string (texto exacto de la descripción del producto)",
                    "codigo": "string (EAN, SKU, o código de proveedor si visible)",
                    "cantidad": number (1 si no se especifica),
                    "precio_unitario": number (null si no hay explícito),
                    "precio_bulto": number (precio por caja/pack/bulto, null si no hay),
                    "unidades_por_bulto": number (cantidad de unidades que trae el bulto, null si no se deduce),
                    "descuento": number (porcentaje, null si no hay),
                    "unidad_medida": "string"
                }
            ],
            "total_documento": number
        }
        
        Devolvé SOLO el JSON.`;

        const result = await model.generateContent([
            {
                inlineData: {
                    mimeType: file.type,
                    data: base64
                }
            },
            prompt
        ]);

        const response = await result.response;
        const text = response.text();

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("No se pudo extraer JSON de la respuesta de IA");
        }

        const parsedData = JSON.parse(jsonMatch[0]);

        return {
            items: parsedData.items || [],
            raw_text: text,
            metadata: {
                model: "gemini-2.0-flash-lite",
                total_documento: parsedData.total_documento
            }
        };

    } catch (error: any) {
        console.error("Gemini OCR Error:", error);
        return { items: [], error: error.message };
    }
}

// --- EXCEL PARSING LOGIC ---

export async function parseExcel(file: File): Promise<ParseResult> {
    try {
        const bytes = await file.arrayBuffer();
        const workbook = XLSX.read(bytes, { type: 'array' });

        // Assume first sheet
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Convert to array of arrays to inspect structure
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        if (rows.length === 0) return { items: [] };

        // Heuristic to find header row
        // We look for common keywords
        const keywords = ["descripcion", "producto", "detalle", "codigo", "sku", "ean", "cantidad", "cant", "precio", "unitario", "importe", "total", "descuento", "dto", "bulto", "pack", "caja"];
        let headerRowIndex = -1;
        let maxKeywords = 0;

        // Scan first 20 rows for a header
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
            const rowStr = rows[i].map(c => String(c).toLowerCase()).join(" ");
            let matches = 0;
            keywords.forEach(k => {
                if (rowStr.includes(k)) matches++;
            });
            if (matches > maxKeywords) {
                maxKeywords = matches;
                headerRowIndex = i;
            }
        }

        // If no header row found with confidence, let's try to detect content types
        // But for now, default to 0 if nothing found
        if (headerRowIndex === -1 && maxKeywords === 0) {
            headerRowIndex = 0; // Use 0, but we will reassess column mapping below
        } else if (headerRowIndex === -1) {
            headerRowIndex = 0;
        }

        const headers = rows[headerRowIndex].map(h => String(h).toLowerCase().trim());

        // Map columns based on headers first
        const colMap = {
            descripcion: -1,
            codigo: -1,
            cantidad: -1,
            precio_unitario: -1,
            precio_bulto: -1,
            unidades_por_bulto: -1,
            descuento: -1
        };

        headers.forEach((h, idx) => {
            if (h.includes("descripcion") || h.includes("detalle") || h.includes("producto")) colMap.descripcion = idx;
            if (h.includes("codigo") || h.includes("sku") || h.includes("ean") || h.includes("art") || h === "id") colMap.codigo = idx;
            if (h.includes("cant") || h.includes("unidades")) colMap.cantidad = idx;

            // Logic for distinguishing unit vs bulk price
            if ((h.includes("precio") || h.includes("costo") || h.includes("importe")) && !h.includes("total")) {
                if (h.includes("bulto") || h.includes("pack") || h.includes("caja")) {
                    colMap.precio_bulto = idx;
                } else {
                    colMap.precio_unitario = idx;
                }
            }

            if (h.includes("desc") || h.includes("dto") || h.includes("bonif")) colMap.descuento = idx;

            // Units per pack detection
            if (h.includes("unidades") && (h.includes("bulto") || h.includes("pack") || h.includes("x"))) {
                colMap.unidades_por_bulto = idx;
            }
        });

        // FALLBACK: Content-based detection if headers failed (or were ambiguous)
        // We analyze the first few data rows to guess columns

        let sampleRowsCount = 0;
        let avgStringLengths = new Array(headers.length).fill(0);
        let numericCounts = new Array(headers.length).fill(0);
        let eanCounts = new Array(headers.length).fill(0);

        const dataStart = headerRowIndex + 1;
        const maxSamples = Math.min(rows.length, dataStart + 10);

        for (let i = dataStart; i < maxSamples; i++) {
            const row = rows[i];
            if (!row) continue;
            sampleRowsCount++;
            row.forEach((cell, colIdx) => {
                const str = String(cell).trim();
                avgStringLengths[colIdx] += str.length;

                // Check if numeric
                // Remove currency symbols first
                const cleanNum = str.replace(/[$]/g, '').replace(/,/g, '.');
                if (!isNaN(parseFloat(cleanNum)) && isFinite(parseFloat(cleanNum))) {
                    numericCounts[colIdx]++;
                }

                // Check if looks like EAN (8-14 digits)
                if (/^\d{8,14}$/.test(str)) {
                    eanCounts[colIdx]++;
                }
            });
        }

        if (sampleRowsCount > 0) {
            avgStringLengths = avgStringLengths.map(l => l / sampleRowsCount);

            // 1. Fix Description: If NOT found by header, find longest non-numeric column
            if (colMap.descripcion === -1 || headers[colMap.descripcion]?.includes("ean")) { // Check if we mapped EAN to desc by accident
                let bestDescCol = -1;
                let maxLen = 0;

                avgStringLengths.forEach((len, idx) => {
                    // It must act like a text column (low numeric count) or just very long
                    // EANs are numeric-ish strings, but descriptions are longer and have spaces
                    // Descriptions usually > 15 chars
                    if (len > maxLen) {
                        maxLen = len;
                        bestDescCol = idx;
                    }
                });

                // Only override if meaningful
                if (maxLen > 10 && bestDescCol !== colMap.codigo && bestDescCol !== colMap.precio_unitario) {
                    colMap.descripcion = bestDescCol;
                }
            }

            // 2. Fix Code: If NOT found, find column with high EAN count
            if (colMap.codigo === -1) {
                let bestCodeCol = -1;
                let maxEans = 0;
                eanCounts.forEach((count, idx) => {
                    if (count > maxEans) {
                        maxEans = count;
                        bestCodeCol = idx;
                    }
                });
                if (bestCodeCol > -1) colMap.codigo = bestCodeCol;
            }

            // 3. Fix Price: If NOT found, look for numeric column with "$" or typical price values
            // (Skipping for now to avoid breaking existing logic, handled by header matching mostly)
        }

        // --- EXTRACT ---

        const extracted: ExtractedItem[] = [];

        for (let i = dataStart; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            const desc = colMap.descripcion > -1 ? row[colMap.descripcion] : "";
            const code = colMap.codigo > -1 ? row[colMap.codigo] : "";

            // Skip empty rows
            if (!desc && !code && !row[0]) continue;

            // Strict Filter: Ignore "Section Headers" or "Notes"
            // A valid item must have at least a Code OR a Price (Unit or Bulk)
            // Just a description is not enough for a price list item.
            const hasPrice = (colMap.precio_unitario > -1 && parseNumber(row[colMap.precio_unitario]) !== 0) ||
                (colMap.precio_bulto > -1 && parseNumber(row[colMap.precio_bulto]) !== 0);

            if (!code && !hasPrice) {
                continue;
            }

            extracted.push({
                descripcion: String(desc || "").trim(),
                codigo: code ? String(code).trim() : null,
                cantidad: colMap.cantidad > -1 ? parseNumber(row[colMap.cantidad]) : 1,
                precio_unitario: colMap.precio_unitario > -1 ? parseNumber(row[colMap.precio_unitario]) : null,
                precio_bulto: colMap.precio_bulto > -1 ? parseNumber(row[colMap.precio_bulto]) : null,
                unidades_por_bulto: colMap.unidades_por_bulto > -1 ? parseNumber(row[colMap.unidades_por_bulto]) : null,
                descuento: colMap.descuento > -1 ? parseNumber(row[colMap.descuento]) : null,
                unidad_medida: null,
                source_row: row
            });
        }

        return {
            items: extracted,
            metadata: {
                rowsProcessed: extracted.length,
                detectedHeaders: headers
            }
        };

    } catch (error: any) {
        console.error("Excel Parsing Error:", error);
        return { items: [], error: error.message };
    }
}

function parseNumber(val: any): number {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const str = String(val).replace(/[^0-9.,]/g, '').replace(/,/g, '.'); // More robust cleanup
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
}
