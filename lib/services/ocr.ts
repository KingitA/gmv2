import * as XLSX from "xlsx";

// Native fetch to Gemini REST API — no SDK dependency, immune to SDK deprecations
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`;

export interface ExtractedItem {
    descripcion: string;
    codigo: string | null;
    cantidad: number;
    precio_unitario: number | null;
    precio_bulto: number | null;
    unidades_por_bulto: number | null;
    descuento: number | null;
    unidad_medida: string | null;
    source_row?: any;
}

export interface ComprobanteMeta {
    numero_comprobante: string | null;
    tipo_comprobante: string | null;
    fecha: string | null;
    total_factura: number | null;
    subtotal_neto: number | null;
    total_iva: number | null;
    percepcion_iva: number | null;
    percepcion_iibb: number | null;
    retencion_ganancias: number | null;
    descuento_global: number | null;
}

export interface ParseResult {
    items: ExtractedItem[];
    comprobante?: ComprobanteMeta | null;
    raw_text?: string;
    metadata?: any;
    error?: string;
}

export async function processWithGemini(
    file: File,
    context: {
        proveedorNombre?: string,
        tipoDocumento?: string
    }
): Promise<ParseResult> {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

        const bytes = await file.arrayBuffer();
        const base64 = Buffer.from(bytes).toString('base64');
        const mimeType = file.type || 'image/jpeg';

        const prompt = `Sos un asistente experto en procesamiento de documentos comerciales argentinos.

CONTEXTO:
- Proveedor: ${context.proveedorNombre || "Desconocido"}
- Tipo de documento: ${context.tipoDocumento || "Comprobante"}

TAREA:
Extraé TODA la información del documento: encabezado del comprobante Y los ítems de detalle.
Priorizá exactitud en códigos, descripciones y valores monetarios.
Si hay precios por bulto/pack y precios unitarios, extraé ambos.

FORMATO JSON:
{
  "comprobante": {
    "numero_comprobante": "string (ej: '0001-00000123') o null si no visible",
    "tipo_comprobante": "FA, FB, FC, Remito, Adquisicion, NC, ND o null",
    "fecha": "YYYY-MM-DD o null",
    "total_factura": number o null,
    "subtotal_neto": number o null,
    "total_iva": number o null,
    "percepcion_iva": number o null,
    "percepcion_iibb": number o null,
    "retencion_ganancias": number o null,
    "descuento_global": number o null
  },
  "items": [
    {
      "descripcion": "texto exacto del producto",
      "codigo": "EAN/SKU/codigo proveedor o null",
      "cantidad": number,
      "precio_unitario": number o null,
      "precio_bulto": number o null,
      "unidades_por_bulto": number o null,
      "descuento": number o null,
      "unidad_medida": "UN/BTO/CJ/etc o null"
    }
  ]
}`;

        const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { inlineData: { mimeType, data: base64 } },
                        { text: prompt }
                    ]
                }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.1,
                }
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Gemini API ${res.status}: ${errText}`);
        }

        const data = await res.json();
        const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

        // responseMimeType: application/json should give clean JSON, strip markdown just in case
        const jsonStr = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsedData = JSON.parse(jsonStr || '{}');

        return {
            items: parsedData.items || [],
            comprobante: parsedData.comprobante || null,
            raw_text: text,
            metadata: { model: GEMINI_MODEL }
        };

    } catch (error: any) {
        console.error("Gemini OCR Error:", error);
        return { items: [], error: error.message };
    }
}

// --- EXCEL PARSING (unchanged) ---

export async function parseExcel(file: File): Promise<ParseResult> {
    try {
        const bytes = await file.arrayBuffer();
        const workbook = XLSX.read(bytes, { type: 'array' });

        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        if (rows.length === 0) return { items: [] };

        const keywords = ["descripcion", "producto", "detalle", "codigo", "sku", "ean", "cantidad", "cant", "precio", "unitario", "importe", "total", "descuento", "dto", "bulto", "pack", "caja"];
        let headerRowIndex = -1;
        let maxKeywords = 0;

        for (let i = 0; i < Math.min(rows.length, 20); i++) {
            const rowStr = rows[i].map((c: any) => String(c).toLowerCase()).join(" ");
            let matches = 0;
            keywords.forEach(k => { if (rowStr.includes(k)) matches++; });
            if (matches > maxKeywords) { maxKeywords = matches; headerRowIndex = i; }
        }

        if (headerRowIndex === -1) headerRowIndex = 0;

        const headers = rows[headerRowIndex].map((h: any) => String(h).toLowerCase().trim());

        const colMap = { descripcion: -1, codigo: -1, cantidad: -1, precio_unitario: -1, precio_bulto: -1, unidades_por_bulto: -1, descuento: -1 };

        headers.forEach((h: string, idx: number) => {
            if (h.includes("descripcion") || h.includes("detalle") || h.includes("producto")) colMap.descripcion = idx;
            if (h.includes("codigo") || h.includes("sku") || h.includes("ean") || h.includes("art") || h === "id") colMap.codigo = idx;
            if (h.includes("cant") || h.includes("unidades")) colMap.cantidad = idx;
            if ((h.includes("precio") || h.includes("costo") || h.includes("importe")) && !h.includes("total")) {
                if (h.includes("bulto") || h.includes("pack") || h.includes("caja")) colMap.precio_bulto = idx;
                else colMap.precio_unitario = idx;
            }
            if (h.includes("desc") || h.includes("dto") || h.includes("bonif")) colMap.descuento = idx;
            if (h.includes("unidades") && (h.includes("bulto") || h.includes("pack") || h.includes("x"))) colMap.unidades_por_bulto = idx;
        });

        const dataStart = headerRowIndex + 1;
        const extracted: ExtractedItem[] = [];

        for (let i = dataStart; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;
            const desc = colMap.descripcion > -1 ? row[colMap.descripcion] : "";
            const code = colMap.codigo > -1 ? row[colMap.codigo] : "";
            if (!desc && !code && !row[0]) continue;
            const hasPrice = (colMap.precio_unitario > -1 && parseNumber(row[colMap.precio_unitario]) !== 0) ||
                (colMap.precio_bulto > -1 && parseNumber(row[colMap.precio_bulto]) !== 0);
            if (!code && !hasPrice) continue;

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

        return { items: extracted, metadata: { rowsProcessed: extracted.length, detectedHeaders: headers } };

    } catch (error: any) {
        console.error("Excel Parsing Error:", error);
        return { items: [], error: error.message };
    }
}

function parseNumber(val: any): number {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const str = String(val).replace(/[^0-9.,]/g, '').replace(/,/g, '.');
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
}
