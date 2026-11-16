import * as XLSX from "xlsx";
import { parseFecha, parseMonto } from "@/lib/formato";

import { GEMINI_MODEL, GEMINI_MODEL_FALLBACK } from "@/lib/ai/gemini-model";

// Native fetch to Gemini REST API — no SDK dependency, immune to SDK deprecations.
// El modelo sale de lib/ai/gemini-model.ts (env GEMINI_MODEL, sin deploy). E-37: si el
// principal falla (Google lo dio de baja, cuota, error del servicio) se reintenta con el
// de respaldo. El principal sigue por la API v1, como siempre; el respaldo es un alias
// ("…-latest") y va por v1beta, que es la versión que usa el SDK en el resto del sistema.
const urlGemini = (modelo: string, version: "v1" | "v1beta") =>
    `https://generativelanguage.googleapis.com/${version}/models/${modelo}:generateContent`;

export interface ExtractedItem {
    descripcion: string;
    codigo: string | null;
    cantidad: number;
    precio_unitario: number | null;
    precio_bulto: number | null;
    unidades_por_bulto: number | null;
    descuento: number | null;
    total_linea: number | null;
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
    impuestos_discriminados: boolean | null;
    leyenda_no_valido_factura: boolean | null;
    tiene_precios: boolean | null;
}

export interface ParseResult {
    items: ExtractedItem[];
    comprobante?: ComprobanteMeta | null;
    raw_text?: string;
    metadata?: any;
    error?: string;
}

// Infiere el tipo de comprobante combinando el texto del documento con señales
// fiscales, para no tener que elegirlo a mano en cada carga:
// - Dice "Factura A/B/C" Y discrimina impuestos → FA/FB/FC
// - Dice factura pero SIN impuestos discriminados, o leyenda "no válido como
//   factura" → Adquisición (entra stock, se debe y se paga, pero sin circuito fiscal)
// - No dice factura pero tiene precios → Adquisición
// - Sin precios → Remito (solo respaldo de cantidades)
// - NC/ND explícitas se respetan
export function inferirTipoComprobante(parsed: ParseResult, tipoDocumento?: string): string {
    const meta = parsed.comprobante;
    const texto = (meta?.tipo_comprobante || '').toUpperCase().trim();

    // La letra (NCA/NDB…) no se infiere: queda el tipo genérico, que la base acepta.
    if (texto === 'NC' || /^NC[ABC]$/.test(texto) || texto.includes('NOTA DE CR')) return 'NC';
    // E-35: una nota de DÉBITO no es una nota de crédito. Antes devolvía 'NC' y al validar
    // RESTABA deuda; una ND la SUMA (movimiento 'nota_debito' positivo + vencimiento).
    if (texto === 'ND' || /^ND[ABC]$/.test(texto) || texto.includes('NOTA DE D')) return 'ND';

    const tienePrecios = meta?.tiene_precios ?? (parsed.items || []).some(i => Number(i.precio_unitario || 0) > 0 || Number(i.total_linea || 0) > 0);
    if (!tienePrecios) return 'Remito';

    const noValido = meta?.leyenda_no_valido_factura === true;
    const impuestosOK = (meta?.impuestos_discriminados === true)
        || Number(meta?.total_iva || 0) > 0
        || Number(meta?.percepcion_iva || 0) > 0
        || Number(meta?.percepcion_iibb || 0) > 0;

    const diceFactura = texto === 'FA' || texto === 'FB' || texto === 'FC' || texto.includes('FACTURA');

    if (diceFactura && impuestosOK && !noValido) {
        if (texto === 'FB' || texto.includes('FACTURA B')) return 'FB';
        if (texto === 'FC' || texto.includes('FACTURA C')) return 'FC';
        return 'FA';
    }

    // Con precios pero sin respaldo fiscal (o leyenda no-válido): adquisición de stock
    return 'Adquisicion';
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
Los documentos son de Argentina: las fechas vienen dd/mm/aaaa (día primero, NUNCA mes/día) y los montos 1.234,56 (punto = miles, coma = decimales). Devolvé las fechas como AAAA-MM-DD y los montos como número JSON con punto decimal y sin separador de miles (ej: 1234.56).

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
    "descuento_global": number o null,
    "impuestos_discriminados": boolean (true si el documento discrimina IVA/percepciones como conceptos separados),
    "leyenda_no_valido_factura": boolean (true si dice "documento no válido como factura" o similar),
    "tiene_precios": boolean (true si los ítems tienen precios)
  },
  "items": [
    {
      "descripcion": "texto exacto del producto",
      "codigo": "EAN/SKU/codigo proveedor o null",
      "cantidad": number,
      "precio_unitario": number o null (el precio de lista BRUTO, ANTES de bonificaciones; si la factura muestra unitario bruto, bonificaciones y unitario neto, usá el BRUTO acá),
      "precio_bulto": number o null,
      "unidades_por_bulto": number o null,
      "descuento": number o null (PORCENTAJE total de bonificaciones de la línea, ej 5 para 5%; si son escalonadas como -2 -38 -5 listalas asi: "2+38+5" NO, devolvé el porcentaje EQUIVALENTE combinado; si la factura solo muestra el descuento en pesos, calculá el porcentaje sobre precio x cantidad),
      "total_linea": number o null (el IMPORTE final de la línea tal como figura en el documento — es el dato más confiable),
      "unidad_medida": "UN/BTO/CJ/etc o null"
    }
  ]
}`;

        const cuerpo = JSON.stringify({
            contents: [{
                parts: [
                    { inlineData: { mimeType, data: base64 } },
                    { text: prompt }
                ]
            }],
            generationConfig: {
                temperature: 0.1,
            }
        });
        const llamar = async (modelo: string, version: "v1" | "v1beta") => {
            const res = await fetch(`${urlGemini(modelo, version)}?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: cuerpo,
            });
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Gemini API ${res.status} (${modelo}): ${errText.slice(0, 500)}`);
            }
            return res.json();
        };

        let modeloUsado = GEMINI_MODEL;
        let data: any;
        try {
            data = await llamar(GEMINI_MODEL, "v1");
        } catch (e: any) {
            if (!GEMINI_MODEL_FALLBACK || GEMINI_MODEL_FALLBACK === GEMINI_MODEL) throw e;
            console.warn(`[OCR] ${GEMINI_MODEL} falló, se reintenta con ${GEMINI_MODEL_FALLBACK}:`, e?.message);
            modeloUsado = GEMINI_MODEL_FALLBACK;
            data = await llamar(GEMINI_MODEL_FALLBACK, "v1beta");
        }

        const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!text.trim()) {
            // Respuesta vacía (bloqueo de seguridad, corte): es un fallo de lectura, no "0 ítems"
            const motivo = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'sin texto';
            throw new Error(`La IA no devolvió ninguna lectura (${motivo})`);
        }

        // responseMimeType: application/json should give clean JSON, strip markdown just in case
        const jsonStr = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsedData = JSON.parse(jsonStr || '{}');

        const saneado = sanearOcr(parsedData);
        return {
            items: saneado.items,
            comprobante: saneado.comprobante,
            raw_text: text,
            metadata: { model: modeloUsado }
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
                total_linea: null,
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
    // Formato argentino ("1.500" = mil quinientos, "12,5" = doce y medio); si la celda
    // trae texto alrededor ("12 un"), se reintenta solo con los números.
    return parseMonto(String(val)) ?? parseMonto(String(val).replace(/[^0-9.,-]/g, '')) ?? 0;
}

/** La IA a veces devuelve montos/fechas como texto: todo pasa por parseMonto / parseFecha. */
function sanearOcr(parsed: any): any {
    const num = (v: any) => (v == null || v === '' ? null : parseMonto(v));
    const items = Array.isArray(parsed?.items) ? parsed.items.map((it: any) => ({
        ...it,
        cantidad: num(it?.cantidad),
        precio_unitario: num(it?.precio_unitario),
        precio_bulto: num(it?.precio_bulto),
        unidades_por_bulto: num(it?.unidades_por_bulto),
        descuento: num(it?.descuento),
        total_linea: num(it?.total_linea),
    })) : [];
    const c = parsed?.comprobante;
    const comprobante = c ? {
        ...c,
        fecha: parseFecha(c.fecha),
        total_factura: num(c.total_factura),
        subtotal_neto: num(c.subtotal_neto),
        total_iva: num(c.total_iva),
        percepcion_iva: num(c.percepcion_iva),
        percepcion_iibb: num(c.percepcion_iibb),
        retencion_ganancias: num(c.retencion_ganancias),
        descuento_global: num(c.descuento_global),
    } : null;
    return { items, comprobante };
}
